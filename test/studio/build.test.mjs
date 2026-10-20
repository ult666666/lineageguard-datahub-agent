import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildStudio, verifyStudio } from '../../scripts/build-studio.mjs';
const temporary = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-build-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
test('static release contains exact public bytes and never overwrites an existing directory', (t) => {
  const dir = temporary(t),
    out = path.join(dir, 'dist');
  buildStudio(out);
  const manifest = verifyStudio(out);
  assert(manifest.files['index.html']);
  assert(manifest.files['classic.html']);
  assert(!manifest.files['src/studio/store.mjs']);
  assert.throws(() => buildStudio(out), /exist|overwrite/i);
  fs.writeFileSync(path.join(out, 'index.html'), 'tamper');
  assert.throws(() => verifyStudio(out), /hash|byte|mismatch/i);
});
test('an unlisted private file or symlink cannot enter the public release', (t) => {
  const dir = temporary(t),
    source = path.join(dir, 'public');
  fs.cpSync(new URL('../../public/', import.meta.url), source, { recursive: true });
  fs.writeFileSync(path.join(source, '.env'), 'SYNTHETIC_PRIVATE_FILE');
  assert.throws(
    () => buildStudio(path.join(dir, 'out'), { publicRoot: source }),
    /inventory|unlisted/i,
  );
  assert(!fs.existsSync(path.join(dir, 'out')));
  fs.unlinkSync(path.join(source, '.env'));
  fs.renameSync(path.join(source, 'studio.css'), path.join(dir, 'held.css'));
  fs.symlinkSync(path.join(dir, 'held.css'), path.join(source, 'studio.css'));
  assert.throws(() => buildStudio(path.join(dir, 'out'), { publicRoot: source }), /link|file/i);
});
