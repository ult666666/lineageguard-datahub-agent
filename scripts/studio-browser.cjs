const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const { createStudioServer } = await import('../src/studio/http.mjs');
  const { createFixtureAdapter } = await import('../public/studio/core/fixtures.js');
  const { verifyRun } = await import('../public/studio/core/runtime.js');
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-browser-')));
  const evidence = path.resolve('test-results');
  fs.mkdirSync(evidence, { recursive: true });
  const results = [];
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.STUDIO_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.STUDIO_CHROMIUM_EXECUTABLE }
        : {}),
    });
    for (const previewOnly of [true, false]) {
      const mode = previewOnly ? 'browser-session' : 'durable-local';
      const app = createStudioServer({
        storeDirectory: path.join(directory, mode),
        previewOnly,
        adapterFactory: (id, options) => createFixtureAdapter(id, { ...options, delayMs: 40 }),
      });
      await app.listen(0);
      const base = `http://127.0.0.1:${app.server.address().port}`;
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
        reducedMotion: 'reduce',
        acceptDownloads: true,
      });
      try {
        const page = await context.newPage();
        const errors = [],
          external = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.route('**/*', (route) => {
          if (new URL(route.request().url()).origin === base) return route.continue();
          external.push(route.request().url());
          return route.abort();
        });
        await page.goto(base, { waitUntil: 'networkidle' });
        assert.equal(
          await page.locator('#studio-title').count(),
          1,
          'Studio shell must be installed',
        );
        await page.waitForFunction(() => !document.querySelector('#run-button').disabled);
        assert.equal(await page.locator('#runtime-mode').getAttribute('data-mode'), mode);
        const done = async (status) => {
          try {
            await page.waitForFunction(
              (s) => document.querySelector('#run-status').dataset.status === s,
              status,
              { timeout: 12000 },
            );
          } catch (error) {
            console.error(
              JSON.stringify({
                mode,
                expected: status,
                actual: await page.locator('#run-status').getAttribute('data-status'),
                notice: await page.locator('#global-message').innerText(),
                errors,
                trace: await page.locator('#trace-list').innerText(),
              }),
            );
            throw error;
          }
        };
        const select = async (id) => {
          await page.locator('#scenario-select').selectOption(id);
        };
        results.push(
          ...(await require('./saved-comparison-browser.cjs')(page, { evidence, mode })),
        );
        await page.locator('[data-view="overview"]').first().click();
        await select('rename');
        await page.locator('#run-button').click();
        await done('completed');
        assert.match(await page.locator('#decision-title').innerText(), /human review/i);
        results.push(`${mode}: real review`);
        assert.equal(await page.locator('[data-step-status="completed"]').count(), 8);
        await page.locator('[data-view="evidence"]').first().click();
        assert.equal(await page.locator('#lineage-graph [data-asset]').count(), 5);
        await page.locator('#evidence-select').selectOption('schema');
        assert.match(await page.locator('#evidence-json').innerText(), /order_total/);
        await page.locator('[data-view="artifacts"]').first().click();
        const dlPromise = page.waitForEvent('download');
        await page.locator('#download-run').click();
        const dl = await dlPromise;
        const file = path.join(evidence, `run-${mode}.json`);
        await dl.saveAs(file);
        const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(await verifyRun(exported), true);
        assert.equal(exported.result.policy.executionAuthorized, false);
        results.push(`${mode}: verified export`);
        results.push(
          ...(await require('./inspection-browser.cjs')(page, { file, evidence, mode })),
        );
        if (previewOnly) {
          await require('./inspection-export-browser.cjs')(page, base);
          results.push('browser-session: rehashed inconsistent export is refused');
        }
        await page.locator('[data-view="compare"]').first().click();
        await page.locator('#compare-additive').click();
        await page.waitForFunction(
          () => document.querySelector('#comparison-result').dataset.ready === 'true',
        );
        assert.match(await page.locator('#comparison-result').innerText(), /requests differ/i);
        results.push(`${mode}: alternative comparison`);
        await page.locator('[data-view="overview"]').first().click();
        await select('safe-add');
        assert.match(await page.locator('#decision-title').innerText(), /not evaluated/i);
        assert.equal(await page.locator('#download-run').isDisabled(), true);
        await page.locator('#run-button').click();
        await done('completed');
        assert.match(await page.locator('#decision-title').innerText(), /additive change/i);
        results.push(`${mode}: stale result invalidation`);
        await select('missing-usage');
        await page.locator('#run-button').click();
        await done('completed');
        assert.match(await page.locator('#decision-title').innerText(), /evidence is required/i);
        results.push(`${mode}: uncertainty`);
        await select('narrowing');
        await page.locator('#run-button').click();
        await done('completed');
        assert.match(await page.locator('#decision-title').innerText(), /blocked/i);
        results.push(`${mode}: numeric narrowing`);
        await select('rename');
        await page.locator('#pause-toggle').check();
        await page.locator('#run-button').click();
        await done('paused');
        await page.reload({ waitUntil: 'networkidle' });
        await done('paused');
        await page.locator('#resume-button').click();
        await done('completed');
        assert.match(await page.locator('#run-identity').innerText(), /generation 2/i);
        results.push(`${mode}: reload and resume`);
        await select('lineage-outage');
        await page.locator('#run-button').click();
        await done('failed');
        await page.locator('#restore-toggle').check();
        await page.locator('#resume-button').click();
        await done('completed');
        results.push(`${mode}: outage recovery`);
        await select('rename');
        if (previewOnly)
          await page.route('**/api/studio', async (route) => {
            if (route.request().method() === 'POST') {
              await new Promise((r) => setTimeout(r, 180));
            }
            return route.continue();
          });
        await page.locator('#run-button').click();
        await done('running');
        await page.locator('#cancel-button').click();
        await done('cancelled');
        results.push(`${mode}: cancellation`);
        await page.locator('#request-json').fill('{"broken":true}');
        assert.equal(await page.locator('#run-button').isDisabled(), true);
        assert.match(
          await page.locator('#validation-message').innerText(),
          /invalid|missing|unsupported/i,
        );
        results.push(`${mode}: invalid input refused`);
        await select('rename');
        await page.locator('[data-view="evaluations"]').first().click();
        await page.locator('#evaluate-button').click();
        await page.waitForFunction(
          () => document.querySelector('#eval-report').dataset.result === 'pass',
          {},
          { timeout: 20000 },
        );
        assert.equal(await page.locator('#eval-rows tr').count(), 19);
        results.push(`${mode}: executed evaluations`);
        await page.locator('[data-view="overview"]').first().click();
        await select('rename');
        await page.locator('#run-button').click();
        await done('completed');
        await page.screenshot({
          path: path.join(evidence, `studio-${mode}-desktop.png`),
          fullPage: true,
        });
        for (const width of [390, 768, 1440]) {
          await page.setViewportSize({ width, height: 950 });
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `overflow ${mode} ${width}`,
          );
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: path.join(evidence, `studio-${mode}-mobile.png`),
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        results.push(`${mode}: responsive and no external runtime requests`);
      } finally {
        await context.close();
        await app.close();
      }
    }
    fs.writeFileSync(
      path.join(evidence, 'browser-verification.json'),
      JSON.stringify(
        { observedAt: new Date().toISOString(), checks: results, result: 'pass' },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ result: 'pass', journeyChecks: results.length, checks: results }));
  } finally {
    if (browser) await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
