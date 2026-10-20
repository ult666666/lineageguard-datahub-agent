const assert = require('node:assert/strict');

// Uses only a test-created browser context. Restores its original checkpoint bytes.
module.exports = async function checkExportBoundary(page, base) {
  const { hash } = await import('../public/studio/core/contract.js');
  const key = 'lineageguard.studio.v2';
  const original = await page.evaluate((k) => localStorage.getItem(k), key);
  assert(original);
  const data = JSON.parse(original),
    run = data.history.find((r) => r.id === data.currentId);
  assert.equal(run.status, 'completed');
  run.result.artifacts.sql = '-- SYNTHETIC DRAFT THAT DOES NOT MATCH THE COMPLETED STEP';
  const body = { ...run };
  delete body.checksum;
  run.checksum = await hash(body);
  const downloads = [],
    onDownload = (d) => downloads.push(d);
  try {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(data)]);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => document.querySelector('#run-status').dataset.status === 'completed',
    );
    await page.locator('[data-view="artifacts"]').first().click();
    page.on('download', onDownload);
    await page.locator('#download-sql').click();
    await page.waitForTimeout(250);
    assert.equal(
      downloads.length,
      0,
      'an internally inconsistent rehashed draft must not be downloaded',
    );
    assert.match(
      await page.locator('#global-message').innerText(),
      /differs from its completed step outputs/i,
    );
  } finally {
    page.removeListener('download', onDownload);
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, original]);
    await page.goto(base, { waitUntil: 'networkidle' });
  }
};
