// @ts-check
// Background: records when each game starts and stops.
/** @typedef {import("../../../packages/plugin-api").TN} TN */
/** @typedef {{ instanceId: string; start: number; end: number | null; code: number | null }} Session */

/** @param {TN} tn */
export function activate(tn) {
  /** @type {Promise<unknown>} serializes read-modify-write of the log */
  let queue = Promise.resolve();
  /** @param {(log: Session[]) => void} change */
  const edit = (change) =>
    (queue = queue.then(async () => {
      const log = (await tn.storage.get("log")) ?? [];
      const sessions = /** @type {Session[]} */ (log);
      change(sessions);
      const keep = Number((await tn.settings.get()).keep) || 100;
      await tn.storage.set("log", sessions.slice(-keep));
    }));

  tn.events.on("game-started", ({ instanceId }) => edit((log) => log.push({ instanceId, start: Date.now(), end: null, code: null })));
  tn.events.on("game-exited", ({ instanceId, code }) =>
    edit((log) => {
      const open = log.findLast((s) => s.instanceId === instanceId && s.end === null);
      if (open) Object.assign(open, { end: Date.now(), code });
    })
  );
}
