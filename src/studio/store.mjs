import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  canonical,
  requireThat,
  StudioError,
  snapshot,
} from '../../public/studio/core/contract.js';
import { verifyRun } from '../../public/studio/core/runtime.js';
const validId = (id) =>
  requireThat(
    typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id),
    'INVALID_ID',
    'Invalid run identifier',
  );
const ownerId = (id) =>
  requireThat(
    typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id),
    'INVALID_OWNER',
    'Invalid lease owner',
  );
function statIfPresent(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function checkPath(input) {
  let p = path.resolve(input);
  while (true) {
    {
      const stat = statIfPresent(p);
      if (stat)
        requireThat(!stat.isSymbolicLink(), 'UNSAFE_PATH', 'Linked storage paths are refused');
    }
    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }
}
/** Single-host durable checkpoints. Revisions + leases fence obsolete writers. */
export class RunStore {
  constructor(directory, { now = () => Date.now(), leaseMs = 30000, maxRuns = 100 } = {}) {
    requireThat(Number.isInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 120000, 'INVALID_STORE');
    requireThat(Number.isInteger(maxRuns) && maxRuns >= 1 && maxRuns <= 1000, 'INVALID_STORE');
    this.directory = path.resolve(directory);
    checkPath(this.directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    requireThat(fs.statSync(this.directory).isDirectory(), 'UNSAFE_PATH');
    const file = path.join(this.directory, 'runs.sqlite');
    for (const p of [file, file + '-wal', file + '-shm']) {
      const stat = statIfPresent(p);
      if (!stat) continue;
      requireThat(
        stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
        'UNSAFE_PATH',
        'Linked or nonregular database file refused',
      );
    }
    this.db = new DatabaseSync(file);
    fs.chmodSync(file, 0o600);
    this.now = now;
    this.leaseMs = leaseMs;
    this.maxRuns = maxRuns;
    this.closed = false;
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);',
    );
  }
  async create(run) {
    await verifyRun(run);
    validId(run.id);
    const raw = canonical(run);
    requireThat(Buffer.byteLength(raw) <= 2_000_000, 'STORE_LIMIT');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      requireThat(
        this.db.prepare('SELECT COUNT(*) AS count FROM runs').get().count < this.maxRuns,
        'STORE_LIMIT',
        'Local run capacity reached',
      );
      this.db
        .prepare('INSERT INTO runs(id,payload,updated_at) VALUES(?,?,?)')
        .run(run.id, raw, this.now());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { run: snapshot(run), revision: 0, leaseActive: false };
  }
  async read(id) {
    validId(id);
    const row = this.db.prepare('SELECT payload,revision,lease_until FROM runs WHERE id=?').get(id);
    requireThat(row, 'NOT_FOUND', 'Run not found');
    requireThat(
      Buffer.byteLength(row.payload) <= 2_000_000,
      'INVALID_CHECKPOINT',
      'Stored checkpoint is oversized',
    );
    let run;
    try {
      run = JSON.parse(row.payload);
      await verifyRun(run);
    } catch (cause) {
      throw new StudioError('INVALID_CHECKPOINT', 'Stored checkpoint failed integrity checks', {
        cause,
      });
    }
    return { run, revision: row.revision, leaseActive: row.lease_until > this.now() };
  }
  async list() {
    const rows = this.db
      .prepare('SELECT id,updated_at FROM runs ORDER BY updated_at DESC LIMIT ?')
      .all(this.maxRuns);
    const result = [];
    for (const row of rows) {
      try {
        const { run, revision, leaseActive } = await this.read(row.id);
        result.push({
          id: run.id,
          status: run.status,
          summary: run.request.changeRequest.summary,
          updatedAt: run.updatedAt,
          decision: run.result?.policy.decision || null,
          revision,
          leaseActive,
        });
      } catch {
        result.push({
          id: row.id,
          status: 'unavailable',
          summary: 'Stored checkpoint failed integrity checks',
          updatedAt: new Date(row.updated_at).toISOString(),
          decision: null,
        });
      }
    }
    return result;
  }
  async claim(id, owner) {
    validId(id);
    ownerId(owner);
    const now = this.now();
    const outcome = this.db
      .prepare(
        'UPDATE runs SET lease_owner=?,lease_until=? WHERE id=? AND (lease_owner IS NULL OR lease_until<=?)',
      )
      .run(owner, now + this.leaseMs, id, now);
    requireThat(
      outcome.changes === 1,
      'RUN_BUSY',
      'Run has an active writer lease or does not exist',
    );
    return this.read(id);
  }
  async save(id, run, revision, owner) {
    validId(id);
    ownerId(owner);
    requireThat(
      run.id === id && Number.isSafeInteger(revision) && revision >= 0,
      'REVISION_CONFLICT',
      'Run or revision conflict',
    );
    await verifyRun(run);
    const raw = canonical(run);
    requireThat(Buffer.byteLength(raw) <= 2_000_000, 'STORE_LIMIT');
    const now = this.now();
    const outcome = this.db
      .prepare(
        'UPDATE runs SET payload=?,revision=revision+1,lease_until=?,updated_at=? WHERE id=? AND revision=? AND lease_owner=? AND lease_until>?',
      )
      .run(raw, now + this.leaseMs, now, id, revision, owner, now);
    requireThat(outcome.changes === 1, 'REVISION_CONFLICT', 'Writer lease or revision conflict');
    return revision + 1;
  }
  async release(id, owner) {
    validId(id);
    ownerId(owner);
    this.db
      .prepare('UPDATE runs SET lease_owner=NULL,lease_until=0 WHERE id=? AND lease_owner=?')
      .run(id, owner);
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }
}
