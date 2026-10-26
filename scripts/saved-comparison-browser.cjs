const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function savedComparisonBrowser(page, { evidence, mode }) {
  const { scenario, createFixtureAdapter } = await import('../public/studio/core/fixtures.js');
  const { makeRecipe } = await import('../public/studio/core/recipe.js');
  const { createRun, executeRun } = await import('../public/studio/core/runtime.js');
  const { hash } = await import('../public/studio/core/contract.js');
  const { compareReviewBytes } = await import('../public/studio/core/review-comparison.js');
  async function fixture(id = 'safe-add', profile = 'standard', options = {}, summary) {
    const adapter = createFixtureAdapter(id);
    const request = structuredClone(scenario(id).request);
    if (summary) request.changeRequest.summary = summary;
    return executeRun(await createRun(request, makeRecipe(profile), adapter), {
      adapter,
      ...options,
    });
  }
  const encode = (value) => Buffer.from(JSON.stringify(value));
  const standard = await fixture(),
    strict = await fixture('safe-add', 'strict');
  const left = encode(standard),
    right = encode(strict);
  const payload = (buffer, name) => ({ name, mimeType: 'application/json', buffer });
  const input = (side) => page.locator('#saved-' + side + '-file');
  const result = page.locator('#saved-result');
  const state = (value) =>
    page.waitForFunction((s) => document.querySelector('#saved-result').dataset.state === s, value);
  const select = async (a, b, leftName = 'left.json') => {
    await input('left').setInputFiles(payload(a, leftName));
    await input('right').setInputFiles(payload(b, 'right.json'));
    assert.equal(await page.locator('#saved-download').isDisabled(), true);
    assert.equal(await result.getAttribute('data-state'), 'empty');
  };
  const compare = async (expected = 'pass') => {
    await page.locator('#saved-compare').click();
    await state(expected);
  };
  const download = async (name) => {
    const pending = page.waitForEvent('download');
    await page.locator('#saved-download').click();
    const saved = await pending;
    const filename = path.join(evidence, 'saved-comparison-' + mode + '-' + name + '.json');
    await saved.saveAs(filename);
    const bytes = fs.readFileSync(filename, 'utf8');
    return { bytes, report: JSON.parse(bytes) };
  };
  await page.locator('[data-view="compare"]').first().click();
  assert.equal(
    await page.getByLabel('Left exported review JSON', { exact: true }).count(),
    1,
    'Compare tab must accept the left saved review without a running workflow',
  );
  assert.equal(await page.getByLabel('Right exported review JSON', { exact: true }).count(), 1);
  assert.equal(
    await page.locator('#compare-additive').isDisabled(),
    true,
    'Saved comparison must work before a current review exists',
  );
  const storage = await page.evaluate(() =>
    JSON.stringify(Object.fromEntries(Object.entries(localStorage))),
  );
  const runId = await page.locator('#run-identity').innerText();
  const originalViewport = page.viewportSize();
  const requests = [],
    handler = (r) => requests.push(r.method() + ' ' + r.url());
  page.on('request', handler);
  await page.context().setOffline(true);
  try {
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    assert.equal(await page.locator('#saved-compare').isDisabled(), true);
    await input('left').setInputFiles(payload(left, 'left.json'));
    assert.equal(await page.locator('#saved-compare').isDisabled(), true);
    await input('right').setInputFiles(payload(right, 'right.json'));
    assert.equal(await page.locator('#saved-compare').isDisabled(), false);
    // A keyboard action starts the comparison; selecting a file alone never does.
    await page.locator('#saved-compare').focus();
    await page.keyboard.press('Enter');
    await state('pass');
    assert.match(await result.innerText(), /Internally consistent.*not authenticated/i);
    const normal = await download('standard-strict');
    assert.equal(normal.report.comparison.left.decision, 'proceed-with-checks');
    assert.equal(normal.report.comparison.right.decision, 'review-required');
    assert.equal(normal.report.comparison.sameRequest, true);
    assert.equal(normal.report.comparison.sameRecipe, false);
    assert.equal(normal.report.comparison.sameSourceRevision, true);
    assert.equal(normal.report.toolCalls, 0);
    assert.equal(normal.report.executionAuthorized, false);
    assert.equal(normal.report.sourceAuthenticated, false);
    // Cross-runtime report parity uses the same displayed instant, not a timing tolerance.
    const native = await compareReviewBytes(left, right, {
      now: Date.parse(normal.report.inspectedAt),
    });
    assert.equal(normal.bytes, JSON.stringify(native, null, 2) + '\n');
    await select(left, left);
    await compare();
    const same = (await download('same')).report;
    assert.equal(same.comparison.sameRecipe, true);
    assert.equal(same.comparison.sameRequest, true);
    assert.deepEqual(same.comparison.addedGaps, []);
    await select(encode(await fixture('rename')), left);
    await compare();
    assert.match(await result.innerText(), /alternative-plan comparison/);
    assert.equal((await download('alternative')).report.comparison.sameRequest, false);

    // The recorded result remains visible separately from today's embedded-evidence check.
    await page.evaluate(
      (now) => {
        window.__savedOriginalNow = Date.now;
        Date.now = () => now;
      },
      Date.parse(strict.updatedAt) + 3 * 86400000,
    );
    await select(left, right);
    await compare();
    const stale = (await download('stale')).report;
    assert.equal(stale.comparison.left.decision, 'proceed-with-checks');
    assert.equal(stale.comparison.right.decision, 'review-required');
    assert.equal(stale.inspections.left.currentDecision, 'needs-evidence');
    assert.equal(stale.inspections.right.currentDecision, 'needs-evidence');
    assert.match(await result.innerText(), /Current check.*embedded evidence only/);
    assert.match(await result.innerText(), /needs-evidence/);
    await page.evaluate(() => {
      Date.now = window.__savedOriginalNow;
      delete window.__savedOriginalNow;
    });

    const changed = structuredClone(standard);
    changed.result.artifacts.sql = '-- SYNTHETIC_PRIVATE_CANARY';
    const body = { ...changed };
    delete body.checksum;
    changed.checksum = await hash(body);
    const failures = [
      [Buffer.from([0xc3, 0x28]), 'INVALID_JSON'],
      [Buffer.from('{"id":1,"\\u0069d":2}'), 'DUPLICATE_JSON_KEY'],
      [Buffer.alloc(4_000_001), 'DATA_LIMIT'],
      [Buffer.alloc(0), 'DATA_LIMIT'],
      [
        encode(await fixture('safe-add', 'standard', { pauseBeforePolicy: true })),
        'COMPARISON_NOT_READY',
      ],
      [encode(changed), 'RESULT_PROJECTION_MISMATCH'],
    ];
    for (const [bytes, code] of failures)
      for (const side of ['left', 'right']) {
        await select(side === 'left' ? bytes : left, side === 'right' ? bytes : right);
        await compare('error');
        const text = await result.innerText();
        assert.match(text, new RegExp(code));
        assert.match(text, new RegExp(side, 'i'));
        assert.doesNotMatch(text, /SYNTHETIC_PRIVATE_CANARY|Recorded decision/);
        assert.equal(await page.locator('#saved-download').isDisabled(), true);
      }

    const hostile =
      '<img src="https://invalid.example/private" onerror="alert(1)"> ' + 'S'.repeat(160);
    await select(encode(await fixture('safe-add', 'standard', {}, hostile)), right);
    await compare();
    assert.match(await result.innerText(), /<img src=/);
    assert.equal(await result.locator('img, script, iframe').count(), 0);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1050 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Saved comparison must wrap at ' + width,
      );
    }
    await page.setViewportSize(originalViewport);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Saved comparison must remain usable at 200% zoom',
    );
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });
    await page
      .locator('#saved-comparison')
      .screenshot({ path: path.join(evidence, 'saved-comparison-' + mode + '.png') });

    // Real File bytes, held by an explicit barrier: no sleeps or simulated validator.
    for (const clear of [true, false]) {
      await page.evaluate(() => {
        window.__savedReadNames = [];
        window.__savedOriginalRead = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = async function () {
          window.__savedReadNames.push(this.name);
          const bytes = await window.__savedOriginalRead.call(this);
          if (this.name === 'held-left.json')
            await new Promise((resolve) => {
              window.__savedRelease = resolve;
            });
          return bytes;
        };
      });
      await select(left, right, 'held-left.json');
      await page.locator('#saved-compare').click();
      await page.waitForFunction(() => typeof window.__savedRelease === 'function');
      if (clear) {
        await page.locator('#saved-clear').click();
        assert.equal(await input('left').inputValue(), '');
        assert.equal(await input('right').inputValue(), '');
      }
      await select(right, left);
      assert.equal(
        await page.locator('#saved-compare').isDisabled(),
        true,
        'Replacement cannot overlap the pending read',
      );
      await page.evaluate(() => window.__savedRelease());
      await page.waitForFunction(() => !document.querySelector('#saved-compare').disabled);
      assert.equal(await result.getAttribute('data-state'), 'empty');
      assert.deepEqual(
        await page.evaluate(() => window.__savedReadNames),
        ['held-left.json'],
        'Obsolete right file must not be read',
      );
      await page.evaluate(() => {
        File.prototype.arrayBuffer = window.__savedOriginalRead;
        delete window.__savedOriginalRead;
        delete window.__savedRelease;
        delete window.__savedReadNames;
      });
      await compare();
      const replacement = (await download(clear ? 'after-clear' : 'after-replace')).report;
      assert.equal(replacement.comparison.left.id, strict.id);
      assert.equal(replacement.comparison.right.id, standard.id);
    }
    await page.locator('#saved-clear').click();
    await state('empty');
    assert.equal(await page.locator('#saved-download').isDisabled(), true);
    assert.deepEqual(requests, [], 'Saved comparison must perform no upload or source/API request');
    assert.equal(
      await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))),
      storage,
    );
    assert.equal(await page.locator('#run-identity').innerText(), runId);
    return [
      `${mode}: offline saved standard/strict, same-file and alternative comparisons`,
      `${mode}: exact shared-core report download and separate current freshness`,
      `${mode}: both-side malformed, ambiguous, oversized, incomplete and rehashed tampering refusal`,
      `${mode}: literal hostile text, responsive layouts and keyboard comparison`,
      `${mode}: bounded pending reads, Clear/replacement invalidation and unchanged current storage`,
    ];
  } finally {
    await page.evaluate(() => {
      window.__savedRelease?.();
      if (window.__savedOriginalRead) File.prototype.arrayBuffer = window.__savedOriginalRead;
      if (window.__savedOriginalNow) Date.now = window.__savedOriginalNow;
      document.documentElement.style.zoom = '';
      for (const name of [
        '__savedRelease',
        '__savedOriginalRead',
        '__savedOriginalNow',
        '__savedReadNames',
      ])
        delete window[name];
    });
    await page.setViewportSize(originalViewport);
    await page.context().setOffline(false);
    page.removeListener('request', handler);
  }
};
