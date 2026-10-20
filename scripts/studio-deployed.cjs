/* Explicit, opt-in acceptance checks for the public synthetic Studio.
 * No credentials, live tenant, persistent cloud queue or mutation endpoint.
 * TLS validation stays enabled. The only permitted origin is the published demo.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ORIGIN = 'https://lineageguard-datahub-agent.vercel.app';
const ROOT = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(ROOT, 'test-results', 'deployed-' + stamp);
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
  if (process.argv.length !== 2) throw new Error('No custom hosts or execution options accepted');
  const manifestBytes = fs.readFileSync(path.join(ROOT, 'dist/release-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const { verifyRun } = await import('../public/studio/core/runtime.js');
  const { makeRecipe, compileRecipe } = await import('../public/studio/core/recipe.js');
  const checks = [],
    assets = [],
    errors = [],
    external = [];
  const record = (name) => checks.push({ name, pass: true });
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  try {
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === ORIGIN) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const request = async (route, data, options = {}) => {
      assert(route.startsWith('/') && !route.startsWith('//'));
      const response =
        data === undefined
          ? await context.request.get(ORIGIN + route, {
              timeout: 20000,
              maxRedirects: 0,
              ...options,
            })
          : await context.request.post(ORIGIN + route, {
              data,
              timeout: 20000,
              maxRedirects: 0,
              ...options,
            });
      return response;
    };
    const release = await request('/release-manifest.json');
    assert.equal(release.status(), 200);
    assert.equal(hash(await release.body()), hash(manifestBytes));
    for (const [name, expected] of Object.entries(manifest.files)) {
      assert(/^[A-Za-z0-9/_.-]+$/.test(name) && !name.includes('..'));
      const response = await request('/' + name);
      assert.equal(response.status(), 200, name);
      const bytes = await response.body();
      assert.equal(bytes.length, expected.bytes, name);
      assert.equal(hash(bytes), expected.sha256, name);
      assets.push({ path: name, sha256: expected.sha256, bytes: bytes.length });
    }
    record('all allowlisted deployed static bytes and release manifest match the local build');
    const index = await request('/');
    assert.equal(hash(await index.body()), manifest.files['index.html'].sha256);
    assert.match(index.headers()['content-security-policy'], /default-src 'self'/);
    assert.match(index.headers()['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(index.headers()['x-content-type-options'], 'nosniff');
    record('root alias and published browser security headers');
    const metadata = await request('/api/studio');
    assert.equal(metadata.status(), 200);
    const config = await metadata.json();
    assert.equal(config.version, manifest.version);
    assert.equal(config.runtime, 'browser-session');
    for (const flag of ['modelInference', 'catalogWrites', 'sqlExecution'])
      assert.equal(config[flag], false);
    const health = await request('/api/health');
    assert.equal(health.status(), 200);
    const healthInfo = await health.json();
    assert.equal(healthInfo.ok, true);
    assert.equal(healthInfo.mode, 'mock-datahub-snapshot');
    record('deployed backend identifies the synthetic browser runtime and disabled capabilities');
    const compiled = await request('/api/studio', {
      action: 'compile',
      recipe: makeRecipe('standard'),
    });
    assert.equal(compiled.status(), 200);
    assert.deepEqual(await compiled.json(), compileRecipe(makeRecipe('standard')));
    record('serverless recipe compiler matches the shared compiler');
    const denied = await request('/api/studio', { action: 'execute-sql' });
    assert.equal(denied.status(), 403);
    assert.equal((await denied.json()).error.code, 'CAPABILITY_DENIED');
    const crossOrigin = await request(
      '/api/studio',
      { action: 'compile', recipe: makeRecipe('standard') },
      { headers: { Origin: 'https://example.invalid' } },
    );
    assert.equal(crossOrigin.status(), 403);
    record('unsupported capabilities and cross-origin requests are refused');
    const evaluation = await request('/api/studio', { action: 'evaluate' });
    assert.equal(evaluation.status(), 200);
    const evaluated = await evaluation.json();
    assert.equal(evaluated.total, 19);
    assert.equal(evaluated.failed, 0);
    assert(evaluated.checks.every((check) => check.pass));
    record('deployed API actually executes 19 named synthetic evaluation assertions');
    const example = await request('/api/demo');
    const classic = await request('/api/analyze', await example.json());
    assert.equal(classic.status(), 200);
    const classicResult = await classic.json();
    assert.equal(classicResult.decision, 'block');
    assert.equal(classicResult.mode, 'mock-datahub-snapshot');
    record('preserved classic demo and analysis API');
    await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('#run-button').disabled);
    assert.equal(await page.locator('#runtime-mode').getAttribute('data-mode'), 'browser-session');
    const done = (state) =>
      page.waitForFunction(
        (expected) => document.querySelector('#run-status').dataset.status === expected,
        state,
        { timeout: 20000 },
      );
    const select = (id) => page.locator('#scenario-select').selectOption(id);
    await select('rename');
    await page.locator('#run-button').click();
    await done('completed');
    assert.match(await page.locator('#decision-title').innerText(), /human review/i);
    assert.equal(await page.locator('[data-step-status="completed"]').count(), 8);
    await page.screenshot({ path: path.join(output, 'studio-desktop.png'), fullPage: true });
    record('published interface executes the actual eight-step graph');
    await page.locator('[data-view="artifacts"]').first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download-run').click();
    const download = await downloadPromise;
    const exportPath = path.join(output, 'synthetic-review.json');
    await download.saveAs(exportPath);
    const exported = JSON.parse(fs.readFileSync(exportPath));
    assert.equal(await verifyRun(exported), true);
    assert.equal(exported.result.policy.executionAuthorized, false);
    record('published JSON export passes the source verifier; no execution authority');
    await page.locator('[data-view="compare"]').first().click();
    await page.locator('#compare-additive').click();
    await page.waitForFunction(
      () => document.querySelector('#comparison-result').dataset.ready === 'true',
    );
    assert.match(await page.locator('#comparison-result').innerText(), /requests differ/i);
    record('alternative comparison executes and discloses different inputs');
    await page.locator('[data-view="overview"]').first().click();
    for (const [scenario, title] of [
      ['missing-usage', /evidence is required/i],
      ['narrowing', /blocked/i],
    ]) {
      await select(scenario);
      assert.match(await page.locator('#decision-title').innerText(), /not evaluated/i);
      assert.equal(await page.locator('#download-run').isDisabled(), true);
      await page.locator('#run-button').click();
      await done('completed');
      assert.match(await page.locator('#decision-title').innerText(), title);
      record(scenario + ': old result invalidated and expected policy outcome observed');
    }
    await select('rename');
    await page.locator('#pause-toggle').check();
    await page.locator('#run-button').click();
    await done('paused');
    const identity = await page.locator('#run-identity').innerText();
    await page.reload({ waitUntil: 'networkidle' });
    await done('paused');
    assert.equal(await page.locator('#run-identity').innerText(), identity);
    await page.locator('#resume-button').click();
    await done('completed');
    assert.match(await page.locator('#run-identity').innerText(), /generation 2/i);
    record('browser checkpoint survives reload and resumes in a new generation');
    await select('lineage-outage');
    await page.locator('#run-button').click();
    await done('failed');
    await page.locator('#restore-toggle').check();
    await page.locator('#resume-button').click();
    await done('completed');
    record('real synthetic endpoint outage fails the run; restoration allows recovery');
    await select('rename');
    await page.route('**/api/studio', async (route) => {
      if (route.request().method() === 'POST')
        await new Promise((resolve) => setTimeout(resolve, 180));
      return route.continue();
    });
    await page.locator('#run-button').click();
    await done('running');
    await page.locator('#cancel-button').click();
    await done('cancelled');
    record('cancellation preserves a cancelled result instead of accepting late evidence');
    await page.locator('[data-view="evaluations"]').first().click();
    await page.locator('#evaluate-button').click();
    await page.waitForFunction(
      () => document.querySelector('#eval-report').dataset.result === 'pass',
      {},
      { timeout: 20000 },
    );
    assert.equal(await page.locator('#eval-rows tr').count(), 19);
    record('evaluation interface renders executed expected-versus-observed outcomes');
    await page.locator('[data-view="overview"]').first().click();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'studio-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    record('three responsive widths; no JavaScript page errors or external runtime requests');
    const report = {
      schema: 'lineageguard.deployed-verification/1',
      observedAt: new Date().toISOString(),
      origin: ORIGIN,
      version: manifest.version,
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim(),
      sourceTreeClean:
        execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() ===
        '',
      manifestSha256: hash(manifestBytes),
      assets,
      checks,
      errors,
      externalRequests: external,
      result: 'pass',
      scope:
        'Synthetic public acceptance only. Local SQLite recovery is covered by the separate offline suite. No tenant, model or mutation was invoked.',
    };
    fs.writeFileSync(
      path.join(output, 'verification.json'),
      JSON.stringify(report, null, 2) + '\n',
      { flag: 'wx' },
    );
    console.log(
      JSON.stringify({
        result: 'pass',
        checks: checks.length,
        assets: assets.length,
        report: path.relative(ROOT, path.join(output, 'verification.json')),
      }),
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
