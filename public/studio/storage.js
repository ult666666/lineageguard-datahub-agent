import { canonical, snapshot, requireThat, StudioError } from './core/contract.js';
import { verifyRun } from './core/runtime.js';
const KEY = 'lineageguard.studio.v2';
/** One atomic localStorage value; never erase corrupt or quota-limited evidence. */
export class BrowserCheckpoints {
  constructor(storage) {
    this.storage = storage;
    this.expected = null;
    this.history = [];
    this.currentId = null;
    this.loaded = false;
  }
  async load() {
    try {
      const raw = this.storage.getItem(KEY);
      if (raw !== null) {
        requireThat(raw.length <= 2_500_000, 'CHECKPOINT_FAILED');
        const data = snapshot(JSON.parse(raw), {
          maxBytes: 2_500_000,
          maxNodes: 120000,
          maxDepth: 30,
        });
        requireThat(
          data.schema === 'lineageguard.checkpoints/2' &&
            Array.isArray(data.history) &&
            data.history.length <= 6,
          'CHECKPOINT_FAILED',
        );
        const seen = new Set();
        for (const run of data.history) {
          await verifyRun(run);
          requireThat(!seen.has(run.id), 'CHECKPOINT_FAILED');
          seen.add(run.id);
        }
        requireThat(
          data.history.some((r) => r.id === data.currentId),
          'CHECKPOINT_FAILED',
        );
        this.history = data.history;
        this.currentId = data.currentId;
      } else {
        this.history = [];
        this.currentId = null;
      }
      this.expected = raw;
      this.loaded = true;
      return {
        current: this.currentId ? this.history.find((r) => r.id === this.currentId) : null,
        history: snapshot(this.history),
      };
    } catch (cause) {
      throw new StudioError(
        'CHECKPOINT_FAILED',
        'Browser checkpoint storage could not be read; existing bytes were preserved',
        { cause },
      );
    }
  }
  async save(raw) {
    const run = snapshot(raw);
    await verifyRun(run);
    requireThat(this.loaded, 'CHECKPOINT_FAILED', 'Load checkpoint storage before saving');
    const write = async () => {
      requireThat(
        this.storage.getItem(KEY) === this.expected,
        'STORAGE_CONFLICT',
        'Another tab changed the checkpoint; reload before continuing',
      );
      const history = [run, ...this.history.filter((r) => r.id !== run.id)].slice(0, 6);
      const value = canonical({ schema: 'lineageguard.checkpoints/2', currentId: run.id, history });
      requireThat(
        value.length <= 2_500_000,
        'CHECKPOINT_FAILED',
        'Checkpoint storage capacity reached',
      );
      try {
        this.storage.setItem(KEY, value);
        requireThat(
          this.storage.getItem(KEY) === value,
          'CHECKPOINT_FAILED',
          'Checkpoint read-back failed',
        );
      } catch (cause) {
        throw new StudioError(
          'CHECKPOINT_FAILED',
          'Browser checkpoint storage write failed; do not assume the run was saved',
          { cause },
        );
      }
      this.expected = value;
      this.history = history;
      this.currentId = run.id;
    };
    if (globalThis.navigator?.locks?.request)
      return navigator.locks.request('lineageguard-studio-checkpoint', write);
    return write();
  }
}
