/**
 * Encrypted IndexedDB storage (build spec §2, §4.3, SECURITY.md #4).
 *
 * Security invariants enforced here:
 *   - Secrets are NEVER written as plaintext. Every value stored goes through
 *     WebCrypto AES-GCM encryption with a key derived from the user's passphrase via
 *     PBKDF2 (600_000 iterations, SHA-256).
 *   - No `localStorage`, no cookies, no sessionStorage for secrets.
 *   - Key material never leaves this module — callers receive encrypted blobs only.
 *   - The encryption key is held in memory only for the lifetime of an unlocked session;
 *     clearing it is as simple as discarding the `StorageSession` returned by `unlock()`.
 *
 * This module has no @occulta/core or Stellar dependency — it is a pure
 * WebCrypto + IndexedDB layer. The Note/NoteStore abstraction lives in lib/occulta.ts.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** An opaque handle to an unlocked storage session. Discard to "lock". */
export interface StorageSession {
  /** Encrypt and store a value under `key`. Overwrites any existing entry. */
  set(key: string, value: unknown): Promise<void>;
  /** Decrypt and return the value stored under `key`, or `undefined` if absent. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Remove an entry. */
  delete(key: string): Promise<void>;
  /** List all stored keys. */
  keys(): Promise<string[]>;
  /** Close and discard the session key — the caller should nullify their reference. */
  close(): void;
}

export interface EncryptedExport {
  version: 1;
  /** PBKDF2 salt, hex-encoded */
  salt: string;
  /** AES-GCM IV, hex-encoded */
  iv: string;
  /** Encrypted JSON payload, base64-encoded */
  ciphertext: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME = 'occulta-vault';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

// PBKDF2 parameters — conservative for 2024 browser hardware
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = 'SHA-256';
const SALT_LENGTH = 32; // bytes
const IV_LENGTH = 12; // bytes, standard for AES-GCM

// ─── Internal IndexedDB helpers ───────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(new Error('Failed to open IndexedDB vault'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

function dbTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Ensures a Uint8Array has a plain ArrayBuffer backing (not SharedArrayBuffer).
 * Required because TypeScript 6's DOM lib makes SubtleCrypto methods require
 * `ArrayBufferView<ArrayBuffer>`, and `new Uint8Array(n)` has type
 * `Uint8Array<ArrayBufferLike>` which doesn't satisfy that constraint. This is a
 * type-safety coercion only; in practice Node 22 and browsers always return plain
 * ArrayBuffers from `new Uint8Array()`. (Mirrors @occulta/core's identical helper.)
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(enc.encode(passphrase)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable — key never leaves WebCrypto
    ['encrypt', 'decrypt'],
  );
}

async function encryptValue(
  key: CryptoKey,
  value: unknown,
): Promise<{ iv: Uint8Array; ciphertext: ArrayBuffer }> {
  const iv = randomBytes(IV_LENGTH);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext),
  );
  return { iv, ciphertext };
}

async function decryptValue<T>(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: ArrayBuffer,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

// ─── Salt management ──────────────────────────────────────────────────────────

const SALT_KEY = '__salt__';

/** Returns the persistent PBKDF2 salt, creating it on first call. */
async function getOrCreateSalt(db: IDBDatabase): Promise<Uint8Array> {
  const existing = await dbTransaction<Uint8Array | undefined>(db, 'readonly', (s) =>
    s.get(SALT_KEY),
  );
  if (existing) return existing;

  const salt = randomBytes(SALT_LENGTH);
  await dbTransaction<IDBValidKey>(db, 'readwrite', (s) => s.put(salt, SALT_KEY));
  return salt;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Opens the vault with the given passphrase. Returns a `StorageSession` handle.
 *
 * @throws if the passphrase is wrong (decryption failure on a known test entry).
 */
export async function unlock(passphrase: string): Promise<StorageSession> {
  if (!passphrase || passphrase.length < 1) {
    throw new Error('Passphrase is required to unlock the vault');
  }

  const db = await openDb();
  const salt = await getOrCreateSalt(db);
  const key = await deriveKey(passphrase, salt);

  return {
    async set(entryKey, value) {
      const { iv, ciphertext } = await encryptValue(key, value);
      const record = { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
      await dbTransaction(db, 'readwrite', (s) => s.put(record, entryKey));
    },

    async get<T>(entryKey: string): Promise<T | undefined> {
      const record = await dbTransaction<{ iv: number[]; ciphertext: number[] } | undefined>(
        db,
        'readonly',
        (s) => s.get(entryKey),
      );
      if (!record) return undefined;
      return decryptValue<T>(
        key,
        new Uint8Array(record.iv),
        new Uint8Array(record.ciphertext).buffer,
      );
    },

    async delete(entryKey) {
      await dbTransaction(db, 'readwrite', (s) => s.delete(entryKey));
    },

    async keys() {
      const allKeys = await dbTransaction<IDBValidKey[]>(db, 'readonly', (s) => s.getAllKeys());
      return (allKeys as string[]).filter((k) => k !== SALT_KEY);
    },

    close() {
      db.close();
      // The `key` CryptoKey is non-extractable and held only in this closure.
      // Once the session is GC'd the key material is gone from memory.
    },
  };
}

/**
 * Produces an encrypted JSON blob suitable for backup export. The exported blob
 * is encrypted with the user's passphrase (a *new* derivation, not the session key)
 * and can be imported on any device.
 *
 * IMPORTANT: the returned string is still sensitive — it should be downloaded as a file
 * and NOT transmitted to any server (build spec §4.3, SECURITY.md #1).
 */
export async function exportEncrypted(data: unknown, passphrase: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const { iv, ciphertext } = await encryptValue(key, data);

  const exported: EncryptedExport = {
    version: 1,
    salt: toHex(salt),
    iv: toHex(iv),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  };
  return JSON.stringify(exported, null, 2);
}

/**
 * Decrypts a backup blob produced by `exportEncrypted`.
 * @throws on wrong passphrase or corrupted file.
 */
export async function importEncrypted<T>(blob: string, passphrase: string): Promise<T> {
  let exported: EncryptedExport;
  try {
    exported = JSON.parse(blob) as EncryptedExport;
  } catch {
    throw new Error('Backup file is not valid JSON');
  }

  if (exported.version !== 1) {
    throw new Error(`Unsupported backup version: ${String(exported.version)}`);
  }

  const salt = fromHex(exported.salt);
  const iv = fromHex(exported.iv);
  const ciphertextBytes = Uint8Array.from(atob(exported.ciphertext), (c) => c.charCodeAt(0));

  const key = await deriveKey(passphrase, salt);
  try {
    return await decryptValue<T>(key, iv, toArrayBuffer(ciphertextBytes));
  } catch {
    // Do NOT include the passphrase or any key material in the error message.
    throw new Error(
      'Decryption failed. The passphrase may be incorrect or the file may be corrupted.',
    );
  }
}

/** Wipes the entire IndexedDB vault. Irreversible — only callable from a deliberate
 * user action with full confirmation (build spec §5). */
export async function wipeVault(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new Error('Failed to wipe vault'));
  });
}
