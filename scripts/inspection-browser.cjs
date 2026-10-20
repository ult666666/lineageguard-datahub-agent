const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function inspectBrowser(page, { file, evidence, mode }) {
  assert.equal(
    await page.locator('#inspection-file').count(),
    1,
    'Review package must include the local inspector',
  );
  const before = await page.evaluate(() =>
    JSON.stringify(Object.fromEntries(Object.entries(localStorage))),
  );
  const runId = await page.locator('#run-identity').innerText();
  const requests = [],
    handler = (request) => requests.push(request.method() + ' ' + new URL(request.url()).pathname);
  page.on('request', handler);
  await page.context().setOffline(true);
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  const state = (value) =>
    page.waitForFunction(
      (s) => document.querySelector('#inspection-result').dataset.state === s,
      value,
    );
  try {
    await page.locator('#inspect-current').click();
    await state('pass');
    assert.match(await page.locator('#inspection-result').innerText(), /not authenticated/i);
    await page.locator('#inspection-file').setInputFiles(file);
    await state('pass');
    assert.match(await page.locator('#inspection-result').innerText(), /Recorded decision/);
    const pending = page.waitForEvent('download');
    await page.locator('#inspection-download').click();
    const download = await pending;
    const output = path.join(evidence, 'inspection-' + mode + '.json');
    await download.saveAs(output);
    const report = JSON.parse(fs.readFileSync(output));
    assert.equal(report.schema, 'lineageguard.inspection/1');
    assert.equal(report.sourceAuthenticated, false);
    assert.equal(report.executionAuthorized, false);
    assert.equal(report.toolCalls, 0);
    assert.equal(report.resumableImport, false);
    assert.equal(report.fileSha256.length, 64);
    const broken = JSON.parse(fs.readFileSync(file));
    broken.result.artifacts.sql = 'SYNTHETIC MODIFIED CONTENT';
    await page.locator('#inspection-file').setInputFiles({
      name: 'changed.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(broken)),
    });
    await state('error');
    assert.equal(await page.locator('#inspection-download').isDisabled(), true);
    assert.doesNotMatch(
      await page.locator('#inspection-result').innerText(),
      /SYNTHETIC MODIFIED CONTENT|Recorded decision/,
    );
    await page.locator('#inspection-file').setInputFiles({
      name: 'oversized.json',
      mimeType: 'application/json',
      buffer: Buffer.alloc(4_000_001),
    });
    await state('error');
    assert.match(await page.locator('#inspection-result').innerText(), /DATA_LIMIT/);
    await page.locator('#inspection-file').setInputFiles(file);
    await state('pass');
    await page.screenshot({
      path: path.join(evidence, 'inspector-' + mode + '.png'),
      fullPage: true,
    });
    await page
      .locator('#review-inspector')
      .screenshot({ path: path.join(evidence, 'inspector-panel-' + mode + '.png') });
    const originalViewport = page.viewportSize();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))) {
        console.error(
          'INSPECTION_OVERFLOW ' +
            JSON.stringify(
              await page.evaluate(() =>
                [...document.querySelectorAll('body *')]
                  .filter(
                    (e) =>
                      e.getBoundingClientRect().right > innerWidth + 1 &&
                      e.getBoundingClientRect().width > 0,
                  )
                  .slice(-20)
                  .map((e) => ({
                    tag: e.tagName,
                    id: e.id,
                    class: e.className,
                    right: e.getBoundingClientRect().right,
                    width: e.getBoundingClientRect().width,
                    minWidth: getComputedStyle(e).minWidth,
                    overflow: getComputedStyle(e).overflowX,
                  })),
              ),
            ),
        );
        await page.screenshot({
          path: path.join(evidence, 'inspection-overflow.png'),
          fullPage: true,
        });
      }
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'inspector overflow at ' + width,
      );
    }
    await page.setViewportSize(originalViewport);
    await page.locator('#inspection-clear').click();
    await state('empty');
    assert.equal(await page.locator('#inspection-download').isDisabled(), true);
    // An earlier file read cannot resurrect a result after Clear.
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      window.__inspectorOriginalRead = original;
      File.prototype.arrayBuffer = async function () {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return original.call(this);
      };
    });
    await page.locator('#inspection-file').setInputFiles(file);
    await page.locator('#inspection-clear').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#inspection-result').getAttribute('data-state'), 'empty');
    await page.evaluate(() => {
      File.prototype.arrayBuffer = window.__inspectorOriginalRead;
      delete window.__inspectorOriginalRead;
    });
    assert.deepEqual(requests, [], 'inspection must not upload or fetch anything');
    assert.equal(
      await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))),
      before,
    );
    assert.equal(await page.locator('#run-identity').innerText(), runId);
    return [
      `${mode}: offline inspection and summary export`,
      `${mode}: tampering and oversize refusal clears stale success`,
      `${mode}: no upload, checkpoint mutation or late-result resurrection`,
    ];
  } finally {
    await page.context().setOffline(false);
    await page.evaluate(() => {
      if (window.__inspectorOriginalRead) {
        File.prototype.arrayBuffer = window.__inspectorOriginalRead;
        delete window.__inspectorOriginalRead;
      }
    });
    page.removeListener('request', handler);
  }
};
