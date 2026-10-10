import { describe, expect, test } from "vitest";
import { runBatchSync } from "../../fast-fighting/scripts/engine/simulator.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";

const strike = (over = {}) => ({ id: over.id ?? "s", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, damage: [parseFormula("1d8+4", "slashing")], ...over });
const creature = over => ({
  side: "friendly", kind: "npc", level: 1, hp: { value: 20, max: 20 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [strike()], iwr: {}, flags: {}, diesAtZero: true,
  traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  ...over
});
const battle = list => ({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: false } });

describe("PF2e rules in the core engine", () => {
  test("identical creatures are roughly even", () => {
    const r = runBatchSync(battle([creature({ id: "a" }), creature({ id: "b", side: "hostile" })]), pf2eRules, { runs: 3000, seed: 4 });
    expect(r.sides.friendly.pWin).toBeGreaterThan(0.43);
    expect(r.sides.friendly.pWin).toBeLessThan(0.57);
  });

  test("PCs go dying, not dead, at 0 HP", () => {
    const ogre = creature({ id: "ogre", side: "hostile", hp: { value: 60, max: 60 }, actions: [strike({ bonus: 11, damage: [parseFormula("2d10+6", "bludgeoning")] })] });
    const r = runBatchSync(battle([creature({ id: "pc", kind: "pc", diesAtZero: false }), ogre]), pf2eRules, { runs: 800 });
    expect(r.combatants.pc.pDowned).toBeGreaterThan(r.combatants.pc.pDead);
  });
});
