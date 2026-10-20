/**
 * The planner's fights on background workers (the core's API 22): this helper opens its rules to them
 * (adapter.workerRules), and rules.js loads and plays with nothing of Foundry's, as a worker has it. On real threads
 * (node's worker_threads, tests/fixtures/batch-thread.js), a batch of PF2e fights split among workers and put back in
 * order is exactly what the main thread's runBatchSync gives.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { runBatchSync } from "../../fast-fighting/scripts/engine/simulator.js";
import { openPool } from "../../fast-fighting/scripts/engine/batch-pool.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { Pf2eAdapter, gulletsOf } from "../scripts/adapter.js";
import { gulletAction } from "../scripts/gullet.js";

const RULES = new Pf2eAdapter().workerRules();
const SCRIPTS = fileURLToPath(new URL("../scripts/", import.meta.url));

const threads = [];
/** A worker thread running the core's batch-worker.js, shaped like a browser's Worker. */
function thread(workerData = null) {
  const t = new NodeWorker(new URL("./fixtures/batch-thread.js", import.meta.url), { workerData });
  threads.push(t);
  const w = { onmessage: null, onerror: null, onmessageerror: null };
  t.on("message", data => w.onmessage?.({ data }));
  t.on("error", err => w.onerror?.({ message: err.message }));
  w.postMessage = message => t.postMessage(message);
  w.terminate = () => { t.terminate(); };
  return w;
}
afterAll(async () => { await Promise.all(threads.map(t => t.terminate())); });

const at = (x, y = 0) => ({ x, y, size: 5 });
const minded = (tactical = 60, brave = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: brave, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const strike = (id, over = {}) => ({ id, name: id, kind: "strike", cost: 1, bonus: 10, maps: [0, -5, -10], melee: true, reach: 5, hands: 1, damage: [parseFormula("1d8+4", "slashing")], ...over });
const bow = id => strike(id, { name: "Shortbow", melee: false, reach: undefined, range: { increment: 60, max: 360 }, hands: 2, damage: [parseFormula("1d6+2", "piercing")] });
const creature = (id, side, position, over = {}) => ({
  id, name: id, side, kind: side === "friendly" ? "pc" : "npc", level: 3, size: 2, hp: { value: 45, max: 45 },
  defenses: { ac: 19, fortitude: 9, reflex: 9, will: 9 }, perception: 9, initiative: { mod: 7, stealth: 9 }, speeds: { walk: 25 },
  actions: [strike(`${id}.sword`)], iwr: {}, flags: { reactiveStrike: true }, diesAtZero: side !== "friendly", traits: minded(), escapeWork: { mod: 9 },
  position, ...over
});
const battle = (combatants, options = {}) => ({
  combatants, sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } },
  options: { positioning: true, maxRounds: 8, ...options }
});

/** Sixteen creatures, two blocks 40 feet apart, a third of each shooting, a wall across part of the field. */
function sixteen() {
  const list = [];
  for ( let i = 0; i < 8; i++ ) {
    const row = i % 4;
    const col = Math.floor(i / 4);
    const shoots = i % 3 === 2;
    list.push(creature(`pc${i}`, "friendly", at(col * 5, row * 5), shoots ? { actions: [bow(`pc${i}.bow`), strike(`pc${i}.dagger`, { light: true })] } : {}));
    list.push(creature(`foe${i}`, "hostile", at(45 + col * 5, row * 5), shoots ? { actions: [bow(`foe${i}.bow`)] } : {}));
  }
  const spec = battle(list);
  spec.walls = [{ a: [22.5, 7.5], b: [22.5, 40], s: 20, d: 0, door: null, open: false }];
  return spec;
}

/** What PF2e's rules play their own way: Ferocity, persistent fire and its flat checks, dying, a heal, a sneak, a gullet. */
function pf2eFeatures() {
  const SWALLOW = "<p>Huge, @Damage[(2d8+5)[bludgeoning]], Rupture 20</p>\n<hr />\n<p>@Localize[PF2E.NPC.Abilities.Glossary.SwallowWhole]</p>";
  const { action, gullet } = gulletAction({ id: "worm.swallow", name: "Swallow Whole", slug: "swallow-whole", html: SWALLOW, traits: ["attack"], actions: 1, athletics: 14, athleticsDC: 24, size: 4, reach: 10 });
  const swallow = [{ ...action, gullet }, strike("worm.jaws", { bonus: 13, reach: 10, damage: [parseFormula("2d8+6", "piercing")] })];
  const fire = [parseFormula("1d6+3", "slashing"), { ...parseFormula("1d4", "fire"), persistent: true }];
  return battle([
    creature("hero", "friendly", at(0), { hp: { value: 60, max: 60 }, actions: [strike("hero.dagger", { light: true, damage: [parseFormula("1d4+4", "piercing")] }), strike("hero.axe", { damage: fire })], resources: { fate: 1 }, fateLabel: "Hero Points" }),
    creature("cleric", "friendly", at(0, 10), { actions: [strike("cleric.mace"), { id: "cleric.heal", name: "Heal", kind: "heal", cost: 2, heal: [parseFormula("2d8+8", "healing")], traits: ["healing", "vitality"], resource: "slot", range: { increment: 30, max: 30, noPenalty: true } }], resources: { slot: 2 } }),
    creature("orc", "hostile", at(40), { ferocity: { label: "Orc Ferocity", uses: 1, untilWounded: null, temp: 0 }, creatureTraits: ["orc", "humanoid"] }),
    creature("sneak", "hostile", at(45, 15), { hidden: true, initiative: { mod: 8, stealth: 30 }, conditions: {}, actions: [strike("sneak.knife", { light: true })] }),
    creature("worm", "hostile", at(50, 5), { size: 4, hp: { value: 120, max: 120 }, actions: swallow, gullet: gulletsOf(swallow), escapeDC: 24, flags: { fearless: true } })
  ], { surprise: "system" });
}

describe("this helper's rules for the planner's workers", () => {
  test("workerRules: rules.js beside the adapter, its pf2eRules, no settings to send (loreBoost travels on the spec)", async () => {
    expect(RULES).toEqual({ url: new URL("../scripts/rules.js", import.meta.url).href, exportName: "pf2eRules" });
    expect((await import(RULES.url))[RULES.exportName]).toBe(pf2eRules);
  });

  test("rules.js imports nothing of the Foundry side (no sheets, cards or chat)", () => {
    const seen = new Set();
    const walk = file => {
      if ( seen.has(file) ) return;
      seen.add(file);
      const src = fs.readFileSync(file, "utf8");
      for ( const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+"(\.\/[^"]+)"/g) ) walk(path.join(path.dirname(file), m[1]));
    };
    walk(path.join(SCRIPTS, "rules.js"));
    const names = [...seen].map(f => path.basename(f)).sort();
    for ( const foundrySide of ["adapter.js", "commit.js", "cards.js", "read-turn.js", "granted.js", "strike-roll.js", "check-roll.js", "action-roll.js", "table-cards.js", "ready.js", "ammo.js", "main.js", "lore.js"] ) {
      expect(names).not.toContain(foundrySide);
    }
  });

  test("loaded on a thread with nothing of Foundry's, it reads none of Foundry's globals", async () => {
    const w = thread({ trap: RULES.url });
    const said = await new Promise((resolve, reject) => { w.onmessage = e => resolve(e.data); w.onerror = reject; });
    expect(said).toEqual({ type: "touched", names: [] });
  }, 30000);
});

describe("PF2e fights on real threads: what runBatchSync gives", () => {
  for ( const [name, make, runs] of [["sixteen creatures on a walled field", sixteen, 24], ["Ferocity, persistent fire, dying, a heal, a sneak and a creature with Swallow Whole", pf2eFeatures, 80]] ) {
    test(name, async () => {
      const warn = vi.spyOn(console, "warn");
      const spec = make();
      const pool = openPool(RULES, { size: 4, makeWorker: () => thread() });
      const r = await pool.run(spec, pf2eRules, { runs, seed: 17 });
      pool.close();
      expect(pool.used).toBe(4);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      expect(r).toEqual(runBatchSync(spec, pf2eRules, { runs, seed: 17 }));
    }, 60000);
  }
});
