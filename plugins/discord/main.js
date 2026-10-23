// @ts-check
// Discord status. Facts (instance, version, loader, mods) stay exact; flavor lives in the idle line
// and the logo tooltip. A phrase is picked once per state change and the idle one rotates slowly,
// so friends see variety without the status flickering.
/** @typedef {import("../../packages/plugin-api").TN} TN */
/** @typedef {import("../../packages/plugin-api").Instance} Instance */

const IDLE_ROTATE_MS = 5 * 60_000;
const IDLE = ["Выбирает, где копать", "Точит кирку", "Перебирает сборки", "Решает: ванилла или моды", "Готовится к спавну", "Ищет алмазы в меню", "Пересчитывает сундуки", "Сверяет карту мира"];
const LAUNCHING = ["Разжигает печь…", "Прогревает JVM…", "Собирает сборку…", "Открывает портал…"];
const TOOLTIP = ["TNLauncher", "Крафтим через TNLauncher", "TNLauncher · моды без боли", "TNLauncher · копаем глубже"];
const LOADER = /** @type {Record<string, string>} */ ({ fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" });

/** Russian plural: 1 мод, 2 мода, 5 модов. @param {number} n @param {[string, string, string]} forms */
export function plural(n, [one, few, many]) {
  const [d, h] = [n % 10, n % 100];
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return few;
  return many;
}

/** "1.21.1 · Fabric · 42 мода", or "1.21.1 · Ванилла". @param {Pick<Instance, "version" | "loader" | "mods">} i */
export function line(i) {
  if (i.loader === "vanilla") return `${i.version} · Ванилла`;
  const loader = LOADER[i.loader] ?? i.loader;
  return i.mods ? `${i.version} · ${loader} · ${i.mods} ${plural(i.mods, ["мод", "мода", "модов"])}` : `${i.version} · ${loader}`;
}

const pick = (/** @type {string[]} */ pool) => pool[Math.floor(Math.random() * pool.length)];

/** @param {TN} tn */
export function activate(tn) {
  /** Instances in the game now; the status shows the latest. */
  const playing = new Set();
  let idleTimer = 0;

  const idle = () => {
    clearInterval(idleTimer);
    const show = () => tn.presence.set({ details: pick(IDLE), state: "В лаунчере", tooltip: pick(TOOLTIP) });
    void show();
    idleTimer = setInterval(show, IDLE_ROTATE_MS);
  };
  const busy = (/** @type {import("../../packages/plugin-api").Presence} */ p) => {
    clearInterval(idleTimer);
    void tn.presence.set({ ...p, tooltip: pick(TOOLTIP) });
  };

  tn.events.on("game-launching", async ({ instanceId }) => {
    if (playing.size) return;
    busy({ details: (await tn.instances.get(instanceId)).name, state: pick(LAUNCHING) });
  });
  tn.events.on("game-started", async ({ instanceId }) => {
    playing.add(instanceId);
    const i = await tn.instances.get(instanceId);
    busy({ details: i.name, state: line(i), startedAt: Math.floor(Date.now() / 1000) });
  });
  tn.events.on("game-exited", ({ instanceId }) => {
    playing.delete(instanceId);
    if (!playing.size) idle();
  });
  idle();
}
