pragma circom 2.1.0;

// DEV FIXTURE — the playground's preloaded circuit until occulta-sdk ships compiled circuits
// (packages/circuits/circuits/apps/ is still empty upstream). Delete this directory and the
// matching public/fixtures/playground/ artefacts once the playground can load real circuits
// from @occulta/circuits.
//
// Statement: "I know a and b such that Poseidon(a, b) = hash", bound to a public `scope`
// (the same role an external nullifier plays in the app circuits). No new cryptography:
// this only instantiates circomlib's Poseidon, whose BN254 t=3 parameters are the ones
// occulta-contracts asserts against the Soroban host in fixtures/poseidon/bn254.json.
//
// Public signals, in public.json order: [hash, scope].

include "circomlib/circuits/poseidon.circom";

template PoseidonPreimage() {
    signal input a;      // private
    signal input b;      // private
    signal input scope;  // public
    signal output hash;

    component h = Poseidon(2);
    h.inputs[0] <== a;
    h.inputs[1] <== b;
    hash <== h.out;

    // Bind `scope` into the constraint system so a proof can't be replayed under another
    // scope by editing the public signal (the usual square trick from Tornado/Semaphore).
    signal scopeSquare;
    scopeSquare <== scope * scope;
}

component main { public [scope] } = PoseidonPreimage();
