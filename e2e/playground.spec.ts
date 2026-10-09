import { expect, test } from '@playwright/test';

test('one click proves in the worker and verifies locally', async ({ page }) => {
  const thirdParty: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    const local =
      url.protocol === 'data:' || url.protocol === 'blob:' || url.hostname === 'localhost';
    if (!local) thirdParty.push(req.url());
  });

  await page.goto('/playground');
  await page.getByRole('button', { name: 'Prove and verify' }).click();

  await expect(page.getByText('Verified locally')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Poseidon parameters match')).toBeVisible();
  await expect(page.getByText('Not available yet: no registry is deployed')).toBeVisible();
  expect(thirdParty).toEqual([]);
});

test('each injected fault gets its specific diagnosis', async ({ page }) => {
  await page.goto('/playground');
  await page.getByRole('button', { name: 'Prove and verify' }).click();
  await expect(page.getByText('Verified locally')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Swap public-signal order' }).click();
  await expect(page.getByText('Public-signal order mismatch')).toBeVisible();

  await page.getByRole('button', { name: 'Use a VK from another setup' }).click();
  await expect(
    page.getByText('Verification key is for a different circuit or setup'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Check against other Poseidon parameters' }).click();
  await expect(page.getByText('Poseidon parameter mismatch')).toBeVisible();
});

test('every page hydrates under the nonce CSP', async ({ page }) => {
  const blocked: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) blocked.push(msg.text());
  });
  for (const route of ['/', '/playground']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
  }
  expect(blocked).toEqual([]);
});
