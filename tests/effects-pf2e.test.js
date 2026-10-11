import { describe, expect, test } from "vitest";
import { replay } from "../../fast-fighting/scripts/engine/simulator.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { ruleValue, modsFromRules, spellRounds, spellReach, helps, predicateHolds, effectRounds } from "../scripts/effects.js";
import { parseControl } from "../scripts/control.js";

// Rule elements as the PF2e 8.6 Spell Effect items carry them.
const RULES = {
  bless: [{ key: "Aura" }, { key: "FlatModifier", selector: "attack-roll", value: 1, type: "status" }],
  bane: [{ key: "FlatModifier", selector: "attack", value: -1, type: "status" }],
  heroism: [{ key: "FlatModifier", selector: ["attack", "saving-throw", "skill-check", "perception"], value: "ternary(gte(@item.level,9),3,ternary(gte(@item.level,6),2,1))", type: "status" }],
  anthem: [
    { key: "FlatModifier", selector: ["attack-roll", "damage"], value: 1, type: "status" },
    { key: "FlatModifier", selector: "saving-throw", value: 1, type: "status", predicate: ["fear"] },
    { key: "DamageDice", selector: "strike-damage", predicate: ["x"] }
  ],
  protection: [{ key: "FlatModifier", selector: ["ac", "saving-throw"], value: 1, type: "status" }],
  rayOfFrost: [{ key: "FlatModifier", selector: "speed", value: -10, type: "status" }],
  sureStrike: [{ key: "RollTwice", selector: "attack-roll", keep: "higher" }],
  splash: [{ key: "TempHP", value: "@item.badge.value" }]
};

const DOMINATE = `<p>You take command of the target.</p> <hr /> <p><strong>Critical Success</strong> The target is unaffected.</p> <p><strong>Success</strong> The target is @UUID[x]{Stunned 1} as it fights off your commands.</p> <p><strong>Failure</strong> You control the target. It gains the @UUID[x]{Controlled} condition, but it can attempt a Will save at the end of each of its turns. On a success, the spell ends.</p> <p><strong>Critical Failure</strong> As a failure, but the target receives a new save only if you give it a new order that is against its nature.</p> <hr />`;

describe("reading PF2e spell effects", () => {
  test("heightened numbers, worked out without eval", () => {
    const f = RULES.heroism[0].value;
    expect(ruleValue(f, { rank: 3 })).toBe(1);
    expect(ruleValue(f, { rank: 6 })).toBe(2);
    expect(ruleValue(f, { rank: 9 })).toBe(3);
    expect(ruleValue("5*ceil(@item.level/2)", { rank: 3 })).toBe(10);
    expect(ruleValue("@item.badge.value")).toBeNull();
    expect(ruleValue("alert(1)")).toBeNull();
  });

  test("Bless, Bane, Heroism, Courageous Anthem, Protection, Ray of Frost, Sure Strike", () => {
    expect(modsFromRules(RULES.bless).mods).toEqual({ attack: 1 });
    expect(modsFromRules(RULES.bane).mods).toEqual({ attack: -1 });
    expect(modsFromRules(RULES.heroism, { rank: 6 }).mods).toEqual({ attack: 2, saves: 2, checks: 2 });
    // Its bonus to saves only counts against fear: left out.
    expect(modsFromRules(RULES.anthem).mods).toEqual({ attack: 1, damage: 1 });
    expect(modsFromRules(RULES.protection).mods).toEqual({ ac: 1, saves: 1 });
    expect(modsFromRules(RULES.rayOfFrost).mods).toEqual({ speed: -10 });
    expect(modsFromRules(RULES.sureStrike).mods).toEqual({ adv: 1 });
    expect(modsFromRules(RULES.splash)).toEqual({ mods: {}, tempHp: 0, oneRoll: false });
    // Guidance: a bonus its own roll option switches on, spent by the roll it helps.
    const guidance = [{ key: "FlatModifier", predicate: ["guidance"], removeAfterRoll: "if-enabled", selector: ["attack", "perception", "saving-throw", "skill-check"], type: "status", value: 1 }];
    expect(modsFromRules(guidance)).toEqual({ mods: {}, tempHp: 0, oneRoll: false });
    expect(modsFromRules(guidance, { options: new Set(["guidance"]) })).toEqual({ mods: { attack: 1, saves: 1, checks: 1 }, tempHp: 0, oneRoll: true });
    expect(helps({ attack: 1 })).toBe(true);
    expect(helps({ attack: -1 })).toBe(false);
  });

  test("durations and who it reaches", () => {
    expect(spellRounds("1 minute")).toBe(10);
    expect(spellRounds("10 minutes")).toBe(100);
    expect(spellRounds("until the start of your next turn")).toBe(1);
    expect(spellReach({ area: { type: "emanation", value: 15 }, target: "you and allies in the area" })).toEqual({ aura: 15 });
    expect(spellReach({ area: { type: "emanation", value: 60 }, target: "" })).toEqual({ aura: 60 });
    expect(spellReach({ range: "touch", target: "1 creature" })).toEqual({ reach: 5 });
    expect(spellReach({ range: "30 feet", target: "1 creature" })).toEqual({ range: { increment: 30, max: 30, noPenalty: true } });
    expect(spellReach({})).toEqual({ targets: "self" });
  });

  test("Dominate: controlled on a failure, with a save each turn; stunned on a success", () => {
    const o = parseControl({ description: DOMINATE, duration: "until the next time you make your daily preparations" });
    expect(o[1].conditions).toEqual({ controlled: 1 });
    expect(o[1].repeatSave).toBe(true);
    expect(o[0].conditions).toEqual({ controlled: 1 });
    expect(o[0].repeatSave).toBeUndefined();
    expect(o[2].conditions).toEqual({ stunned: 1 });
    expect(o[3]).toBeNull();
  });
});

describe("PF2e buffs, debuffs and skill actions in a fight", () => {
  const strike = (over = {}) => ({ id: over.id ?? "s", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, damage: [parseFormula("1d8+4", "slashing")], ...over });
  const creature = over => ({
    side: "friendly", kind: "npc", level: 3, hp: { value: 60, max: 60 }, defenses: { ac: 18, fortitude: 9, reflex: 9, will: 9 }, perception: 9,
    initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [strike()], iwr: {}, flags: {}, diesAtZero: true,
    traits: { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
    ...over
  });
  const battle = list => ({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: false } });
  const demoralize = { id: "demoralize", name: "Demoralize", kind: "control", cost: 1, traits: ["auditory", "concentrate", "emotion", "fear", "mental"], melee: false, range: { increment: 30, max: 30, noPenalty: true },
    check: { mod: 12, against: "will" }, oncePerTarget: true,
    onHit: [null, null, { conditions: { frightened: 1 }, rounds: 1, label: "frightened 1" }, { conditions: { frightened: 2 }, rounds: 2, label: "frightened 2" }] };
  const prone = { conditions: { prone: 1 }, rounds: 1, label: "prone" };
  const trip = { id: "trip", name: "Trip", kind: "control", cost: 1, traits: ["attack"], melee: true, reach: 5, check: { mod: 12, against: "reflex", attack: true }, onHit: [{ ...prone, self: true }, null, prone, prone] };
  const feint = { id: "feint", name: "Feint", kind: "control", cost: 1, traits: ["mental"], melee: true, reach: 5, check: { mod: 12, against: "perception" },
    onHit: [null, null, { conditions: { offGuard: 1 }, onlyVs: true, rounds: 1, label: "off-guard" }, { conditions: { offGuard: 1 }, onlyVs: true, rounds: 1, label: "off-guard" }] };

  test("Demoralize: Intimidation against Will DC, once per foe", () => {
    let uses = 0;
    for ( let s = 1; s <= 30; s++ ) {
      const r = replay(battle([creature({ id: "a", actions: [strike(), demoralize] }), creature({ id: "b", side: "hostile", hp: { value: 120, max: 120 } })]), pf2eRules, s);
      const mine = r.log.filter(e => e.type === "control" && e.actorId === "a");
      expect(mine.length).toBeLessThanOrEqual(1);
      for ( const e of mine ) expect(e.dc).toBe(19); // 10 + Will 9
      uses += mine.length;
    }
    expect(uses).toBeGreaterThan(10);
  });

  test("a fighter trips a heavy hitter; a rogue feints to set up its sneak attack", () => {
    const brute = () => creature({ id: "b", side: "hostile", hp: { value: 200, max: 200 }, actions: [strike({ bonus: 14, damage: [parseFormula("2d10+8", "slashing")] })] });
    let trips = 0;
    for ( let s = 1; s <= 20; s++ ) trips += replay(battle([creature({ id: "a", hp: { value: 300, max: 300 }, actions: [strike(), trip] }), brute()]), pf2eRules, s).log.filter(e => e.action === "Trip").length;
    expect(trips).toBeGreaterThan(5);

    const sneak = { id: "sneak", when: ["offGuard"], oncePerTurn: true, parts: [{ ...parseFormula("2d6", "slashing"), category: "precision" }] };
    let feints = 0;
    let setUp = 0;
    for ( let s = 1; s <= 20; s++ ) {
      const rogue = creature({ id: "r", hp: { value: 300, max: 300 }, actions: [strike({ id: "rapier", bonusDamage: [sneak] }), feint] });
      const r = replay(battle([rogue, creature({ id: "b", side: "hostile", hp: { value: 200, max: 200 } })]), pf2eRules, s);
      const fooled = r.log.filter(e => e.action === "Feint" && e.took);
      feints += fooled.length;
      for ( const f of fooled ) {
        const next = r.log.slice(r.log.indexOf(f) + 1).find(e => e.actorId === "r" && e.type === "attack");
        if ( next?.round === f.round && next.degree >= 2 && next.sneak ) setUp += 1;
      }
    }
    expect(feints).toBeGreaterThan(5);
    expect(setUp).toBeGreaterThan(0);
  });

  test("Bless goes up first, and the d20 still adds up", () => {
    const bless = { id: "bless", name: "Bless", kind: "buff", cost: 2, aura: 15, resource: "slot", outcome: { mods: { attack: 1 }, rounds: 10, label: "emboldened" } };
    const cleric = creature({ id: "cleric", kind: "pc", diesAtZero: false, resources: { slot: 1 }, actions: [strike({ id: "mace", bonus: 5, damage: [parseFormula("1d6+1", "bludgeoning")] }), bless] });
    const r = replay(battle([cleric, creature({ id: "f1" }), creature({ id: "f2" }), creature({ id: "boss", side: "hostile", hp: { value: 200, max: 200 }, actions: [strike({ bonus: 14, damage: [parseFormula("2d10+8", "slashing")] })] })]), pf2eRules, 3);
    const b = r.log.find(e => e.type === "buff");
    expect(b?.round).toBe(1);
    expect(b.targetIds).toEqual(expect.arrayContaining(["cleric", "f1", "f2"]));
  });
});

describe("actions that put an effect on their user", () => {
  // The shapes of the PF2e system's own Rage action and Effect: Rage rules.
  const effectRules = [
    { key: "ActiveEffectLike", mode: "upgrade", path: "flags.system.rageTempHP", value: 1 },
    { key: "ActiveEffectLike", mode: "upgrade", path: "flags.system.rageTempHP", phase: "beforeDerived", predicate: [{ nor: ["self:type:familiar", "self:type:hazard", "self:type:vehicle"] }], value: "@actor.level + @actor.abilities.con.mod" },
    { key: "TempHP", value: "@actor.flags.system.rageTempHP" },
    { key: "RollOption", option: "rage" }
  ];
  const actionRules = [
    { key: "FlatModifier", predicate: ["self:effect:rage", { or: [{ not: "item:ranged" }, { and: ["feat:raging-thrower", "item:thrown"] }] }], selector: "strike-damage", slug: "rage", value: 2 },
    { key: "AdjustModifier", mode: "multiply", predicate: ["item:trait:agile"], selector: "strike-damage", slug: "rage", value: 0.5 }
  ];
  const actor = { level: 5, abilities: { con: { mod: 3 } } };
  const options = new Set(["item:melee", "item:type:weapon", "self:effect:rage"]);

  test("Rage: level + Constitution in temporary hit points, and +2 to melee Strike damage while it lasts", () => {
    expect(modsFromRules(effectRules, { actor, options })).toEqual({ mods: {}, tempHp: 8, oneRoll: false });
    expect(modsFromRules(actionRules, { actor, options, only: "self:effect:rage" }).mods).toEqual({ damage: 2 });
    // Without options (a spell effect), rules that only sometimes apply stay out.
    expect(modsFromRules(actionRules, { actor }).mods).toEqual({});
  });

  test("predicates and durations", () => {
    expect(predicateHolds(["a", { not: "b" }], new Set(["a"]))).toBe(true);
    expect(predicateHolds([{ or: ["x", { and: ["a", "c"] }] }], new Set(["a", "c"]))).toBe(true);
    expect(predicateHolds([{ nor: ["a"] }], new Set(["a"]))).toBe(false);
    expect(predicateHolds([{ gte: ["level", 3] }], new Set())).toBe(false);
    expect(effectRounds({ value: 1, unit: "minutes" })).toBe(10);
    expect(effectRounds({ value: -1, unit: "unlimited" })).toBeNull();
    expect(ruleValue("@actor.level + @actor.abilities.con.mod", { actor })).toBe(8);
  });
});
