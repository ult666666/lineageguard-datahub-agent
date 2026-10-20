import { randomUUID } from 'node:crypto';
import { snapshot, exact, requireThat, publicError } from '../../public/studio/core/contract.js';
import { createRun, executeRun, acknowledgeRun } from '../../public/studio/core/runtime.js';
import { scenario, createFixtureAdapter } from '../../public/studio/core/fixtures.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
export class RunService {
  constructor(
    store,
    { adapterFactory = (id, options) => createFixtureAdapter(id, options), maxActive = 3 } = {},
  ) {
    this.store = store;
    this.adapterFactory = adapterFactory;
    requireThat(
      Number.isInteger(maxActive) && maxActive >= 1 && maxActive <= 10,
      'INVALID_CAPACITY',
    );
    this.maxActive = maxActive;
    this.reservations = 0;
    this.active = new Map();
    this.errors = new Map();
  }
  async start(raw) {
    const input = snapshot(raw, { maxBytes: 60000 });
    exact(input, ['scenarioId'], ['request', 'recipe', 'pauseBeforePolicy']);
    requireThat(typeof input.scenarioId === 'string', 'INVALID_SCENARIO');
    const spec = scenario(input.scenarioId);
    if (Object.hasOwn(input, 'pauseBeforePolicy'))
      requireThat(typeof input.pauseBeforePolicy === 'boolean', 'INVALID_INPUT');
    requireThat(
      this.active.size + this.reservations < this.maxActive,
      'SERVICE_BUSY',
      'Local concurrent-run limit reached',
    );
    this.reservations++;
    try {
      const adapter = this.adapterFactory(input.scenarioId, {});
      const run = await createRun(
        input.request || spec.request,
        input.recipe || makeRecipe('standard'),
        adapter,
      );
      await this.store.create(run);
      await this.launch(
        run,
        adapter,
        { pauseBeforePolicy: input.pauseBeforePolicy === true },
        true,
      );
      return run;
    } finally {
      this.reservations--;
    }
  }
  async launch(run, adapter, options = {}, reserved = false) {
    requireThat(
      !this.active.has(run.id) &&
        (reserved || this.active.size + this.reservations < this.maxActive),
      'RUN_BUSY',
      'Run already active or local capacity reached',
    );
    if (!reserved) this.reservations++;
    try {
      const owner = randomUUID();
      const saved = await this.store.claim(run.id, owner);
      let revision = saved.revision;
      const controller = new AbortController();
      const record = { controller, promise: null };
      this.active.set(run.id, record);
      this.errors.delete(run.id);
      record.promise = executeRun(saved.run, {
        adapter,
        signal: controller.signal,
        ...options,
        onCheckpoint: async (state) => {
          revision = await this.store.save(state.id, state, revision, owner);
        },
      })
        .catch((error) => {
          this.errors.set(run.id, publicError(error));
        })
        .finally(async () => {
          await this.store.release(run.id, owner);
          this.active.delete(run.id);
        });
    } finally {
      if (!reserved) this.reservations--;
    }
  }
  async resume(id, raw = {}) {
    const options = snapshot(raw);
    exact(options, [], ['restored', 'pauseBeforePolicy']);
    for (const key of Object.keys(options))
      requireThat(
        typeof options[key] === 'boolean',
        'INVALID_INPUT',
        'Recovery options must be booleans',
      );
    const { run } = await this.store.read(id);
    requireThat(run.status !== 'completed', 'RUN_COMPLETE', 'Completed reviews cannot be resumed');
    const adapter = this.adapterFactory(run.context.scenarioId, {
      restored: options.restored === true,
    });
    await this.launch(run, adapter, { pauseBeforePolicy: options.pauseBeforePolicy === true });
    return run;
  }
  async cancel(id) {
    const active = this.active.get(id);
    requireThat(active, 'RUN_NOT_ACTIVE', 'No execution is active in this local process');
    active.controller.abort();
    return { requested: true, id };
  }
  async read(id) {
    const row = await this.store.read(id);
    return { ...row, storageError: this.errors.get(id) || null };
  }
  async acknowledge(id, reviewer, note) {
    requireThat(!this.active.has(id), 'RUN_BUSY', 'Wait until the review finishes');
    const owner = randomUUID();
    const saved = await this.store.claim(id, owner);
    try {
      const run = await acknowledgeRun(saved.run, reviewer, note);
      await this.store.save(id, run, saved.revision, owner);
      return run;
    } finally {
      await this.store.release(id, owner);
    }
  }
  async wait(id) {
    await this.active.get(id)?.promise;
    return this.read(id);
  }
  async close() {
    for (const entry of this.active.values()) entry.controller.abort();
    await Promise.all([...this.active.values()].map((x) => x.promise));
    this.store.close();
  }
}
