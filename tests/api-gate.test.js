/**
 * Whether this helper runs with a core is its own call, by the core's API major (main.js KNOWN_API): older than it
 * knows, it stays out and says the core is too old; one it knows, it registers; a newer one, it registers and tells
 * the GM it hasn't been tried with that core.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

const was = { Hooks: globalThis.Hooks, ui: globalThis.ui, game: globalThis.game };
afterEach(() => Object.assign(globalThis, was));

/** main.js loaded afresh into a stand-in Foundry; then its fastFighting.init and ready hooks run with a core of this major. */
async function start(major) {
  const hooks = new Map();
  const said = { error: [], warn: [] };
  globalThis.Hooks = { once: (name, fn) => hooks.set(name, fn), on: () => {} };
  globalThis.ui = { notifications: { error: m => said.error.push(m), warn: m => said.warn.push(m), info: () => {} } };
  Object.assign(globalThis.game, {
    system: { id: "pf2e", title: "PF2e" }, user: { isGM: true }, modules: { get: () => ({ active: true }) }, settings: { register: () => {}, get: () => undefined }
  });
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await import("../scripts/main.js");
  const registered = [];
  const api = { major, bug: 0, version: `${major}.0`, registerAdapter: (...a) => registered.push(a), adviseTranslation: () => {}, keepEnglish: () => {} };
  hooks.get("fastFighting.init")?.(api);
  hooks.get("ready")?.();
  return { registered, said };
}

describe("the core's API major, as this helper sees it", () => {
  test("older than it knows: it stays out, and says the core is too old", async () => {
    const { registered, said } = await start(20);
    expect(registered).toHaveLength(0);
    expect(said.error).toEqual([game.i18n.localize("FFPF2E.CoreTooOld")]);
  });

  test("one it knows (21 to 28): it registers, and says nothing", async () => {
    for ( const major of [21, 22, 23, 24, 25, 26, 27, 28] ) {
      const { registered, said } = await start(major);
      expect(registered).toHaveLength(1);
      expect([...said.error, ...said.warn]).toEqual([]);
    }
  });

  test("a newer one: it registers, and the GM is told it hasn't been tried with that core", async () => {
    const { registered, said } = await start(29);
    expect(registered).toHaveLength(1);
    expect(said.warn).toEqual([game.i18n.format("FFPF2E.CoreUntested", { major: 29 })]);
  });
});
