#!/usr/bin/env node
import path from 'node:path';
import { createStudioServer } from '../src/studio/http.mjs';

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) throw new Error('Use Node 22.13+ or Node 24 for the local SQLite runtime.');
const args = process.argv.slice(2);
if (
  args.some(
    (arg) => !arg.startsWith('--port=') && !arg.startsWith('--store=') && arg !== '--preview',
  )
)
  throw new Error(
    'Usage: studio-server.mjs [--port=4183] [--store=/absolute/directory] [--preview]',
  );
const port = Number(args.find((arg) => arg.startsWith('--port='))?.slice(7) || 4183);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid loopback port.');
const storeDirectory = path.resolve(
  args.find((arg) => arg.startsWith('--store='))?.slice(8) || '.lineageguard',
);
const app = createStudioServer({ storeDirectory, previewOnly: args.includes('--preview') });
await app.listen(port);
console.log(
  JSON.stringify({
    app: 'LineageGuard Studio',
    version: '2.0.0',
    url: `http://127.0.0.1:${port}`,
    runtime: args.includes('--preview') ? 'browser-session' : 'durable-local',
    catalog: 'synthetic-fixture',
    sqlExecution: false,
    modelInference: false,
  }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  process.exitCode = 0;
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
