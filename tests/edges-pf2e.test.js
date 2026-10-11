import { describe, expect, test } from "vitest";
import { replay } from "../../fast-fighting/scripts/engine/simulator.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { aidAction, AID_DC } from "../scripts/edges.js";
import { ONE_ROLL } from "../scripts/effects.js";

const strike = (over = {}) => ({ id: over.id ?? "s", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, damage: [parseFormula("1d8+4", "slashing")], ...over });
const minded = { tactical: { base: 70, fudge: 0 }, brave: { base: 80, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const creature = over => ({
  side: "friendly", kind: "pc", level: 1, hp: { value: 60, max: 60 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [strike()], iwr: {}, flags: {}, diesAtZero: false, traits: minded,
  ...over
});
const battle = (list, options = {}) => ({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: false, ...options } });

describe("Aid", () => {
  test("its best way to help, against DC 15; more on a critical success for a master", () => {
    const aid = aidAction({ id: "a.aid", name: "Aid", strikes: [{ bonus: 4 }, { bonus: 7 }], skills: [{ mod: 9, rank: 3 }] });
    expect(aid.check).toEqual({ mod: 9, dc: AID_DC, label: "Aid" });
    expect(aid.onDegree.map(o => o?.mods.attack ?? null)).toEqual([-1, null, 1, 3]);
    expect(aid.onDegree[2]).toMatchObject({ uses: 1, vsFocus: true });
    expect(aidAction({ id: "x", name: "Aid" })).toBeNull();
  });

  test("a friend who can't hurt the foe much lends a hand instead", () => {
    const aid = aidAction({ id: "squire.aid", name: "Aid", strikes: [{ bonus: 12 }] });
    const squire = creature({ id: "squire", initiative: { mod: -20 }, actions: [strike({ id: "jab", bonus: 12, damage: [parseFormula("1", "bludgeoning")] }), aid] });
    const hero = creature({ id: "hero", initiative: { mod: 20 }, actions: [strike({ id: "greatsword", bonus: 9, damage: [parseFormula("2d12+4", "slashing")] })] });
    const troll = creature({ id: "troll", side: "hostile", kind: "npc", hp: { value: 300, max: 300 }, defenses: { ac: 24, fortitude: 12, reflex: 8, will: 6 }, flags: { fearless: true } });
    const r = replay(battle([hero, squire, troll], { maxRounds: 3 }), pf2eRules, 6);
    const given = r.log.filter(e => e.type === "buff" && e.actorId === "squire");
    expect(given.length).toBeGreaterThan(0);
    expect(given[0].check.dc).toBe(15);
    expect(given[0].targetIds).toEqual(["hero"]);
  });
});

describe("spells good for one roll", () => {
  test("Guidance and Sure Strike read as one roll's worth; Bless and Heroism don't", () => {
    expect(ONE_ROLL.test("The target gains a +1 status bonus to one attack roll, Perception check, saving throw, or skill check the target attempts before the duration ends.")).toBe(true);
    expect(ONE_ROLL.test("The next time you make an attack roll before the end of your turn, roll the attack twice and use the better result.")).toBe(true);
    expect(ONE_ROLL.test("You and your allies gain a +1 status bonus to attack rolls while within the emanation.")).toBe(false);
    expect(ONE_ROLL.test("The target gains a +1 status bonus to attack rolls, Perception checks, saving throws, and skill checks.")).toBe(false);
  });
});
