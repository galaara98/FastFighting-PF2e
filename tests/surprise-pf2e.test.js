/**
 * Surprise as PF2e has it (the planner's Follow System, rules.surprise): no surprise round, no one surprised. Those
 * sneaking up (hidden tokens: Avoiding Notice) roll Stealth for initiative, and one whose Stealth beats every foe's
 * Perception DC starts hidden, unnoticed: its first blow finds its target off-guard.
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle } from "../../fast-fighting/scripts/engine/simulator.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";

const blade = () => ({ id: "blade", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, hands: 1, damage: [parseFormula("1d8+4", "slashing")] });
const unit = (id, side, over = {}) => ({
  id, name: id, side, kind: "npc", level: 1, hp: { value: 30, max: 30 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
  initiative: { mod: 5, stealth: 6 }, speeds: { walk: 25 }, actions: [blade()], iwr: {}, flags: { fearless: true }, diesAtZero: true, perception: 5, ...over
});
const begin = (combatants, seed = 1) => beginRun(prepareBattle({ combatants, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { maxRounds: 2, surprise: "system" } }, pf2eRules), seed);

describe("PF2e's surprise", () => {
  test("nobody sneaking: none", () => {
    expect(pf2eRules.surprise(begin([unit("hero", "friendly"), unit("orc", "hostile")]))).toBeNull();
  });

  test("those sneaking roll Stealth for initiative, as a side; no round of their own, no one surprised", () => {
    const run = begin([unit("hero", "friendly"), unit("orc", "hostile", { hidden: true })]);
    expect(run.surprise).toMatchObject({ by: [], round: false, stealthSides: ["hostile"], surprised: [], disadvantage: [] });
  });

  test("a sneak whose Stealth beats every foe's Perception DC starts hidden; against a keen eye, never", () => {
    // (Stealth +40 against a DC of 15: always; Stealth +0 against a DC of 50: never.)
    const sly = begin([unit("hero", "friendly"), unit("orc", "hostile", { hidden: true, initiative: { mod: 5, stealth: 40 } })]);
    expect(sly.surprise.hidden).toEqual(["orc"]);
    expect(sly.byId.get("orc").conds.hidden).toBeGreaterThan(0);
    const seen = begin([unit("hero", "friendly", { perception: 40 }), unit("orc", "hostile", { hidden: true, initiative: { mod: 5, stealth: 0 } })]);
    expect(seen.surprise.hidden).toEqual([]);
    expect(seen.byId.get("orc").conds.hidden ?? 0).toBe(0);
  });
});
