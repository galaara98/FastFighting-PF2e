/**
 * Playstyle perks in PF2e's terms: Avoid Notice (Stealth for initiative) for one keeping a low profile; a nonlethal
 * blow for one who spares the fallen; Disarm only against a weapon in hand.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../../fast-fighting/scripts/engine/simulator.js";
import { parseFormula, STATUS } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";

const strike = (over = {}) => ({ id: over.id ?? "s", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, damage: [parseFormula("1d8+4", "slashing")], traits: [], ...over });
const creature = over => ({
  side: "friendly", kind: "npc", level: 1, hp: { value: 20, max: 20 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [strike()], iwr: {}, flags: {}, diesAtZero: true,
  traits: { tactical: { base: 70, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  ...over
});
const battle = (list, options = {}) => ({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: false, ...options } });

describe("keeping a low profile", () => {
  test("Avoid Notice: it rolls Stealth for initiative, when that's better", () => {
    const first = behavior => replay(battle([creature({ id: "sneak", name: "sneak", initiative: { mod: -10, stealth: 40 }, behavior }), creature({ id: "foe", name: "foe", side: "hostile", initiative: { mod: 10 } })], { maxRounds: 1 }), pf2eRules, 2)
      .log.find(e => e.type === "initiative").order[0];
    expect(first({ lowProfile: 0.3 })).toBe("sneak");
    expect(first({})).toBe("foe");
  });
});

describe("the fallen", () => {
  test("one who spares the fallen knocks a foe out with any Strike, as PF2e lets it (a sword's at -2)", () => {
    const fate = (behavior, weapon) => {
      const monk = creature({ id: "monk", behavior, actions: [weapon] });
      const thug = creature({ id: "thug", side: "hostile", hp: { value: 4, max: 4 }, defenses: { ac: 5, fortitude: 0, reflex: 0, will: 0 }, flags: { fearless: true }, actions: [strike({ bonus: -20 })] });
      return replay(battle([monk, thug], { maxRounds: 2 }), pf2eRules, 1).units.thug.status;
    };
    const fist = strike({ id: "fist", name: "Fist", bonus: 30, damage: [parseFormula("20", "bludgeoning")], traits: ["agile", "nonlethal", "unarmed"] });
    const sword = strike({ id: "sword", bonus: 30, damage: [parseFormula("20", "slashing")] });
    expect(fate({ spareDowned: 1 }, fist)).toBe(STATUS.DOWN);
    expect(fate({}, fist)).toBe(STATUS.DEAD);
    expect(fate({ spareDowned: 1 }, sword)).toBe(STATUS.DOWN);
    expect(fate({}, sword)).toBe(STATUS.DEAD);
    // (What pulling costs: a sword -2, fists nothing.)
    expect(pf2eRules.pullPenalty({}, sword)).toBe(-2);
    expect(pf2eRules.pullPenalty({}, fist)).toBe(0);
    expect(pf2eRules.pullsBlow({}, { kind: "save", traits: [] })).toBe(false);
  });
});

describe("Disarm", () => {
  test("only a weapon in hand can be knocked away: claws and jaws can't", () => {
    const disarm = { kind: "control", disarm: true, traits: ["attack"], onHit: [null, null, { mods: { attack: -2 }, rounds: 1 }, { mods: { attack: -2, actions: -1 }, rounds: 1 }] };
    expect(pf2eRules.isImmune({ spec: { actions: [strike({ held: true })], iwr: {} } }, disarm)).toBe(false);
    expect(pf2eRules.isImmune({ spec: { actions: [strike({ name: "Jaws" })], iwr: {} } }, disarm)).toBe(true);
  });
});
