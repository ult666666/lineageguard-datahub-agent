import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const PUBLIC_FILES = [
  'app.js',
  'classic.html',
  'index.html',
  'studio.css',
  'studio.js',
  'studio/core/artifacts.js',
  'studio/core/comparison.js',
  'studio/core/contract.js',
  'studio/core/evaluations.js',
  'studio/core/evidence.js',
  'studio/core/fixtures.js',
  'studio/core/policy.js',
  'studio/core/recipe.js',
  'studio/core/runtime.js',
  'studio/mark.svg',
  'studio/storage.js',
  'studio/transport.js',
  'studio/view.js',
  'styles.css',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function safePath(file) {
  let current = path.resolve(file);
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked file paths are refused');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function inventory(root) {
  safePath(root);
  const files = [];
  const walk = (relative) => {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const rel = path.posix.join(relative, item.name);
      const stat = fs.lstatSync(path.join(root, rel));
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)))
        throw new Error('Linked or special public file refused');
      if (stat.isDirectory()) walk(rel);
      else {
        if (stat.size > 4_000_000) throw new Error('Public file exceeds limit');
        files.push(rel);
      }
    }
  };
  walk('');
  return files.sort();
}
export function buildStudio(
  destination = path.join(ROOT, 'dist'),
  { publicRoot = path.join(ROOT, 'public') } = {},
) {
  safePath(destination);
  if (fs.existsSync(destination))
    throw new Error('Refusing to overwrite an existing release directory');
  const actual = inventory(publicRoot);
  if (JSON.stringify(actual) !== JSON.stringify([...PUBLIC_FILES].sort()))
    throw new Error('Public inventory contains unlisted or missing files');
  const snapshots = Object.fromEntries(
    actual.map((name) => [name, fs.readFileSync(path.join(publicRoot, name))]),
  );
  if (Object.values(snapshots).reduce((n, data) => n + data.length, 0) > 12_000_000)
    throw new Error('Public payload exceeds limit');
  fs.mkdirSync(destination, { recursive: true });
  const manifest = { schema: 'lineageguard.static-release/2', version: '2.0.0', files: {} };
  for (const [name, bytes] of Object.entries(snapshots)) {
    const target = path.join(destination, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: 'wx' });
    manifest.files[name] = { sha256: digest(bytes), bytes: bytes.length };
  }
  fs.writeFileSync(
    path.join(destination, 'release-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  );
  verifyStudio(destination);
  return manifest;
}
export function verifyStudio(directory) {
  const actual = inventory(directory);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'),
  );
  if (
    manifest.schema !== 'lineageguard.static-release/2' ||
    manifest.version !== '2.0.0' ||
    JSON.stringify(Object.keys(manifest.files).sort()) !==
      JSON.stringify([...PUBLIC_FILES].sort()) ||
    JSON.stringify(actual) !== JSON.stringify([...PUBLIC_FILES, 'release-manifest.json'].sort())
  )
    throw new Error('Static release inventory mismatch');
  for (const [name, record] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(directory, name));
    if (bytes.length !== record.bytes || digest(bytes) !== record.sha256)
      throw new Error('Static release byte hash mismatch');
  }
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest =
    process.argv[2] === '--verify'
      ? verifyStudio(path.resolve(process.argv[3] || 'dist'))
      : buildStudio();
  console.log(
    JSON.stringify({
      version: manifest.version,
      staticFiles: Object.keys(manifest.files).length,
      verified: true,
    }),
  );
}
