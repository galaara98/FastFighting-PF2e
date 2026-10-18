/**
 * PF2e's immunities, weaknesses and resistances as its own applyIWR applies them (iwr.js, rules.applyIwr), told what
 * deals the damage (the core's ctx): precision, critical hits, area and splash damage, materials, exceptions and
 * doubleVs, vitality and void; and what the adapter reads for them (iwrOf, strikeMaterials, propertyRunesOf).
 */
import { describe, expect, test } from "vitest";
import { pf2eRules } from "../scripts/rules.js";
import { applyPf2eIwr, critImmune, healsIt, unaffected } from "../scripts/iwr.js";
import { iwrOf, strikeMaterials, propertyRunesOf } from "../scripts/adapter.js";

const unit = (spec = {}) => ({ spec: { iwr: {}, ...spec } });
const living = unit();
const zombie = unit({ voidHealing: true, creatureTraits: ["undead", "zombie", "mindless"], iwr: { weak: { vitality: 5, slashing: 5 } } });

describe("precision", () => {
  const ctx = { byCategory: { precision: { piercing: 7 } } };

  test("immune to precision: none of a sneak attack's precision, the rest of the blow as it is", () => {
    expect(pf2eRules.applyIwr({ immune: ["precision"] }, { piercing: 12 }, living, ctx)).toBe(5);
    expect(pf2eRules.applyIwr({}, { piercing: 12 }, living, ctx)).toBe(12);
    // (Precision only: nothing at all.)
    expect(pf2eRules.applyIwr({ immune: ["precision"] }, { piercing: 7 }, living, ctx)).toBe(0);
  });

  test("resistance to precision: no more than the precision; a weakness to it only where there's precision", () => {
    expect(pf2eRules.applyIwr({ resist: { precision: 10 } }, { piercing: 12 }, living, ctx)).toBe(5);
    expect(pf2eRules.applyIwr({ resist: { precision: 3 } }, { piercing: 12 }, living, ctx)).toBe(9);
    expect(pf2eRules.applyIwr({ weak: { precision: 4 } }, { piercing: 12 }, living, ctx)).toBe(16);
    expect(pf2eRules.applyIwr({ weak: { precision: 4 } }, { piercing: 12 }, living, {})).toBe(12);
  });
});

describe("critical hits", () => {
  const golem = unit({ iwr: { immune: ["critical-hits", "precision"] } });
  const sword = { damage: [{ type: "slashing" }] };

  test("immune to critical hits: a critical hit is a normal hit's damage (rules.critImmune), its exceptions aside", () => {
    expect(pf2eRules.critImmune(golem, sword)).toBe(true);
    expect(pf2eRules.critImmune(living, sword)).toBe(false);
    const jelly = unit({ iwr: { immune: ["critical-hits"], except: { immune: { "critical-hits": ["slashing"] } } } });
    expect(critImmune(jelly, sword)).toBe(false);
    expect(critImmune(jelly, { damage: [{ type: "bludgeoning" }] })).toBe(true);
    // (Its applyIwr leaves that to the roll: a critical hit's damage isn't halved again.)
    expect(pf2eRules.applyIwr({ immune: ["critical-hits"] }, { slashing: 9 }, living, { crit: true })).toBe(9);
  });

  test("a weakness to critical hits on one; a resistance to them, no more than what the critical added", () => {
    expect(pf2eRules.applyIwr({ weak: { "critical-hits": 5 } }, { slashing: 10 }, living, { crit: true })).toBe(15);
    expect(pf2eRules.applyIwr({ weak: { "critical-hits": 5 } }, { slashing: 10 }, living, { crit: false })).toBe(10);
    expect(pf2eRules.applyIwr({ resist: { "critical-hits": 20 } }, { slashing: 10 }, living, { crit: true })).toBe(5);
  });
});

describe("area and splash damage", () => {
  test("immune to area damage: none of an area's; a single target's as it is", () => {
    expect(pf2eRules.applyIwr({ immune: ["area-damage"] }, { fire: 20 }, living, { area: true })).toBe(0);
    expect(pf2eRules.applyIwr({ immune: ["area-damage"] }, { fire: 20 }, living, { area: false })).toBe(20);
  });

  test("a swarm's weakness to area and splash damage: an area's, a splash's; the higher, once for each type", () => {
    const swarm = { weak: { "area-damage": 5, "splash-damage": 5 }, resist: { physical: 5 } };
    expect(pf2eRules.applyIwr(swarm, { fire: 10 }, living, { area: true })).toBe(15);
    expect(pf2eRules.applyIwr(swarm, { fire: 3 }, living, { byCategory: { splash: { fire: 1 } } })).toBe(8);
    expect(pf2eRules.applyIwr(swarm, { slashing: 8 }, living, {})).toBe(3);
    expect(pf2eRules.applyIwr({ weak: { "area-damage": 5, fire: 3 } }, { fire: 10 }, living, { area: true })).toBe(15);
  });
});

describe("materials, exceptions and doubleVs", () => {
  test("a weakness to silver: a silver weapon's blow (dawnsilver too); not a plain one's", () => {
    const werewolf = { weak: { silver: 5 } };
    expect(pf2eRules.applyIwr(werewolf, { slashing: 6 }, living, { materials: ["silver"] })).toBe(11);
    expect(pf2eRules.applyIwr(werewolf, { slashing: 6 }, living, { materials: ["dawnsilver"] })).toBe(11);
    expect(pf2eRules.applyIwr(werewolf, { slashing: 6 }, living, {})).toBe(6);
  });

  test("cold iron: sovereign steel counts as it for a weakness", () => {
    expect(pf2eRules.applyIwr({ weak: { "cold-iron": 5 } }, { piercing: 4 }, living, { materials: ["sovereign-steel"] })).toBe(9);
    expect(pf2eRules.applyIwr({ weak: { "cold-iron": 5 } }, { piercing: 4 }, living, { materials: ["adamantine"] })).toBe(4);
  });

  test("a resistance but to silver: a silver weapon gets through, any other is resisted; keep-stone counts as adamantine", () => {
    const devil = { resist: { physical: 5 }, except: { resist: { physical: ["silver"] } } };
    expect(pf2eRules.applyIwr(devil, { slashing: 8 }, living, { materials: ["silver"] })).toBe(8);
    expect(pf2eRules.applyIwr(devil, { slashing: 8 }, living, {})).toBe(3);
    const golem = { resist: { physical: 5 }, except: { resist: { physical: ["adamantine"] } } };
    expect(pf2eRules.applyIwr(golem, { bludgeoning: 8 }, living, { materials: ["keep-stone"] })).toBe(8);
  });

  test("a ghost's: all damage but force, ghost touch and vitality, doubled against non-magical damage", () => {
    const ghost = { resist: { "all-damage": 5 }, except: { resist: { "all-damage": ["force", "ghost-touch", "vitality"] } }, doubleVs: { "all-damage": ["non-magical"] } };
    expect(pf2eRules.applyIwr(ghost, { slashing: 12 }, living, {})).toBe(2);
    expect(pf2eRules.applyIwr(ghost, { slashing: 12 }, living, { traits: ["magical"] })).toBe(7);
    expect(pf2eRules.applyIwr(ghost, { slashing: 12 }, living, { magical: true })).toBe(7);
    expect(pf2eRules.applyIwr(ghost, { slashing: 12 }, living, { action: { propertyRunes: ["ghost-touch"] } })).toBe(12);
    expect(pf2eRules.applyIwr(ghost, { force: 12 }, living, { magical: true })).toBe(12);
  });
});

describe("vitality and void (PF2e's isAffectedBy)", () => {
  test("vitality harms only one with void healing: a zombie, its weakness too; a living foe, not at all", () => {
    expect(pf2eRules.applyIwr(zombie.spec.iwr, { vitality: 8 }, zombie, {})).toBe(13);
    expect(pf2eRules.applyIwr({}, { vitality: 8 }, living, {})).toBe(0);
    expect(unaffected("vitality", living)).toBe(true);
  });

  test("void harms the living, not one with void healing", () => {
    expect(pf2eRules.applyIwr(zombie.spec.iwr, { void: 8 }, zombie, {})).toBe(0);
    expect(pf2eRules.applyIwr({}, { void: 8 }, living, {})).toBe(8);
    // (A hazard: neither, unless it has a weakness or resistance to it.)
    expect(unaffected("void", unit({ hazard: { once: true } }))).toBe(true);
    expect(unaffected("void", unit({ hazard: { once: true }, iwr: { weak: { void: 5 } } }))).toBe(false);
    // (No one known: as it is.)
    expect(pf2eRules.applyIwr({}, { void: 8 }, null, {})).toBe(8);
  });

  test("a heal by vitality mends the living only; Harm's void healing, one with void healing only", () => {
    const heal = { kind: "heal", traits: ["healing", "manipulate", "vitality"] };
    const harm = { kind: "heal", traits: ["manipulate", "void"] };
    expect([healsIt(heal, living), healsIt(heal, zombie), healsIt(harm, living), healsIt(harm, zombie)]).toEqual([true, false, false, true]);
    expect(pf2eRules.usable({}, living, heal, zombie)).toBe(false);
    expect(pf2eRules.usable({}, living, harm, zombie)).toBe(true);
    // (Battle Medicine and an elixir of life: no vitality, anyone.)
    expect(healsIt({ kind: "heal", traits: ["alchemical", "elixir", "healing"] }, zombie)).toBe(true);
  });
});

describe("what the adapter reads", () => {
  test("its immunities, weaknesses and resistances, their exceptions and a resistance's doubleVs; of two of a key, the higher", () => {
    const iwr = iwrOf({
      immunities: [{ type: "precision", exceptions: [] }, { type: "critical-hits", exceptions: ["slashing"] }],
      weaknesses: [{ type: "silver", value: 5 }, { type: "fire", value: 3 }, { type: "fire", value: 5 }],
      resistances: [{ type: "all-damage", value: 5, exceptions: ["force", "ghost-touch", { label: "custom" }], doubleVs: ["non-magical"] }]
    });
    expect(iwr).toEqual({
      immune: ["precision", "critical-hits"], weak: { silver: 5, fire: 5 }, resist: { "all-damage": 5 },
      except: { immune: { "critical-hits": ["slashing"] }, resist: { "all-damage": ["force", "ghost-touch"] } }, doubleVs: { "all-damage": ["non-magical"] }
    });
    expect(iwrOf(undefined)).toEqual({ immune: [], weak: {}, resist: {} });
  });

  test("a Strike's materials: its weapon's precious material, a creature's attack's material traits, its strike adjustments", () => {
    const materialKeys = ["silver", "cold-iron", "adamantine"];
    expect(strikeMaterials({ type: "weapon", system: { material: { type: "silver" } } }, { materialKeys })).toEqual(["silver"]);
    expect(strikeMaterials({ type: "weapon", system: { material: { type: "steel" } } }, { materialKeys })).toEqual([]);
    expect(strikeMaterials({ type: "melee", system: { traits: { value: ["cold-iron", "magical"] }, material: {} } }, { materialKeys })).toEqual(["cold-iron"]);
    const adjust = { adjustDamageRoll: (item, { materials }) => materials.add("adamantine") };
    expect(strikeMaterials({ type: "weapon", system: { material: {} } }, { materialKeys, adjustments: [adjust, { adjustDamageRoll: () => { throw new Error("no"); } }] })).toEqual(["adamantine"]);
    expect(propertyRunesOf({ system: { runes: { property: ["ghost-touch", "flaming"] } } })).toEqual(["ghost-touch", "flaming"]);
    expect(propertyRunesOf({ system: {} })).toEqual([]);
  });
});
