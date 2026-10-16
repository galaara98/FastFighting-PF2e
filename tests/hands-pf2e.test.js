/**
 * The free hands each action needs (hands.js): a weapon by its grip, a fist or a claw its hand, jaws none; anything
 * else one with the manipulate trait (a somatic or material component, before the remaster), none without. Every
 * action the adapter builds says so (rules.handsKnown).
 */
import { afterEach, describe, expect, test } from "vitest";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { strikeHands, traitHands } from "../scripts/hands.js";
import { aidAction } from "../scripts/edges.js";
import { classActions } from "../scripts/class-actions.js";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { needsHands } from "../../fast-fighting/scripts/engine/behavior/holds.js";

const weapon = (usage, over = {}) => ({ type: "weapon", category: "martial", system: { usage: { value: usage }, traits: { value: [] }, ...over } });
const melee = (traits, over = {}) => ({ type: "melee", category: traits.includes("unarmed") ? "unarmed" : null, system: { traits: { value: traits } }, ...over });

describe("a Strike's hands", () => {
  test("a weapon by its grip: one hand, two, a bow's 1+ (both to shoot), two-handed for its two-hand trait; worn, none", () => {
    expect(strikeHands(weapon("held-in-one-hand"))).toBe(1);
    expect(strikeHands(weapon("held-in-two-hands"))).toBe(2);
    expect(strikeHands(weapon("held-in-one-plus-hands"))).toBe(2);
    expect(strikeHands(weapon("held-in-one-hand", { equipped: { handsHeld: 2 } }))).toBe(2);
    expect(strikeHands(weapon("worngloves"))).toBe(0);
    expect(strikeHands(weapon(undefined))).toBe(1);
  });

  test("unarmed: a grasping appendage (a fist, a claw) needs its hand; jaws, none", () => {
    expect(strikeHands({ type: "weapon", category: "unarmed", system: { graspingAppendage: true, traits: { value: ["agile", "unarmed"] } } })).toBe(1);
    expect(strikeHands({ type: "weapon", category: "unarmed", system: { graspingAppendage: false, traits: { value: ["unarmed"] } } })).toBe(0);
  });

  test("a creature's attack: its linked weapon's grip; its own body otherwise (a fist still a hand)", () => {
    expect(strikeHands(melee(["deadly-d10", "reach-10"], { linkedWeapon: weapon("held-in-two-hands") }))).toBe(2);
    expect(strikeHands(melee(["unarmed"], { baseType: "jaws" }))).toBe(0);
    expect(strikeHands(melee(["unarmed"], { baseType: "fist" }))).toBe(1);
    expect(strikeHands(melee(["agile", "reach-15"]))).toBe(0); // (a tail, a wing, an octopus's arm)
    expect(strikeHands(null)).toBe(0);
  });
});

describe("everything else's hands", () => {
  test("the manipulate trait, or a somatic or material component before the remaster", () => {
    expect(traitHands(["concentrate", "manipulate"])).toBe(1);
    expect(traitHands(["concentrate"])).toBe(0);
    expect(traitHands([], { verbal: true, somatic: true })).toBe(1);
    expect(traitHands([], { verbal: true, material: false })).toBe(0);
    expect(traitHands(undefined)).toBe(0);
  });

  test("Aid takes its best way's: a Strike's grip, a healer's hand, none for words", () => {
    expect(aidAction({ id: "a", name: "Aid", strikes: [{ bonus: 9, hands: 2 }], skills: [{ mod: 5, rank: 1, hands: 0 }] }).hands).toBe(2);
    expect(aidAction({ id: "a", name: "Aid", strikes: [{ bonus: 3, hands: 2 }], skills: [{ mod: 8, rank: 1 }] }).hands).toBe(0);
  });

  test("Double Slice: both hands, a weapon in each", () => {
    const blade = (name, hands) => ({ id: name, name, kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, traits: [], hands, damage: [parseFormula("1d6+3", "slashing")] });
    const [slice] = classActions({ actorId: "a", slugs: new Set(["double-slice"]), level: 1, strikes: [blade("Shortsword", 1), blade("Hatchet", 1)] }).actions;
    expect(slice.hands).toBe(2);
    expect(slice.sequence.map(s => s.hands)).toEqual([1, 1]);
  });
});

describe("every action the adapter builds says how many hands it needs", () => {
  const before = { CONFIG: globalThis.CONFIG };
  afterEach(() => { globalThis.CONFIG = before.CONFIG; });

  /**
   * An ogre as PF2e lists it: a two-handed hook (linked to its weapon), jaws, Athletics and Intimidation, and two
   * innate spells: one cast with a gesture (the manipulate trait), one of words alone.
   */
  const strikeData = (label, slug, mod, item) => ({ type: "strike", label, slug, totalModifier: mod, visible: true, ready: true, item,
    damage: async () => "1d10+7 piercing", critical: async () => "2d10+14 piercing" });
  const spell = (id, traits) => ({ id, name: id, slug: id, isCantrip: true, rank: 1, isAttack: true,
    system: { time: { value: "2" }, traits: { value: traits }, range: { value: "30 feet" }, target: { value: "1 creature" }, location: {} },
    getDamage: async () => ({ template: { damage: { roll: { formula: "2d4 fire", kinds: new Set(["damage"]) } } } }) });
  const ogre = () => ({
    id: "ogre", uuid: "Actor.ogre", type: "npc", name: "Ogre", img: "", level: 3, items: [],
    itemTypes: { condition: [], consumable: [], feat: [], action: [] },
    system: {
      attributes: { hp: { value: 50, max: 50, temp: 0 }, ac: { value: 17 } },
      traits: { value: ["giant", "humanoid"], size: { value: "lg" }, rarity: "common" },
      details: { languages: { value: ["common", "jotun"] } },
      movement: { speeds: { land: 25 } },
      abilities: {}, resources: {}, skills: { athletics: {}, intimidation: {} },
      actions: [
        strikeData("Ogre Hook", "ogre-hook", 12, melee(["deadly-d10", "reach-10", "trip"], { linkedWeapon: weapon("held-in-two-hands") })),
        strikeData("Jaws", "jaws", 10, melee(["unarmed"], { baseType: "jaws" }))
      ]
    },
    skills: { athletics: { mod: 12, rank: 1, dc: { value: 22 } }, intimidation: { mod: 9, rank: 1 }, acrobatics: { mod: 5 }, thievery: { mod: 1 } },
    saves: { fortitude: { mod: 12 }, reflex: { mod: 6 }, will: { mod: 5, dc: { value: 15 } } },
    perception: { mod: 8, dc: { value: 18 }, senses: [] },
    initiative: { mod: 8 },
    attributes: {},
    spellcasting: { regular: [{ id: "innate", statistic: { dc: { value: 18 }, check: { mod: 8 } }, system: { prepared: { value: "innate" } },
      spells: { contents: [spell("ignition", ["cantrip", "concentrate", "fire", "manipulate"]), spell("roar", ["cantrip", "concentrate", "fire"])] } }] }
  });

  test("its Strikes by their grips, its skill actions as the rules have them; and how it breaks free", async () => {
    globalThis.CONFIG = { PF2E: {} };
    const spec = await new Pf2eAdapter().toCombatantSpec({ id: "t1", name: "Ogre", actor: ogre(), texture: { src: "" } });
    expect(pf2eRules.handsKnown).toBe(true);
    expect(spec.actions.length).toBeGreaterThan(4);
    for ( const a of spec.actions ) expect([a.id, Number.isInteger(a.hands)]).toEqual([a.id, true]);
    const hands = Object.fromEntries(spec.actions.map(a => [a.id.split(".").slice(1).join("."), a.hands]));
    expect(hands).toMatchObject({ "strike.ogre-hook.0": 2, "strike.jaws.1": 0, "spell.ignition": 1, "spell.roar": 0, trip: 1, grapple: 1, disarm: 1, demoralize: 0, aid: 2 });
    // (As the core reads it: tied up, its jaws and its words still serve, its hook and its gestures don't.)
    const byId = Object.fromEntries(spec.actions.map(a => [a.id, a]));
    expect(["ogre.strike.ogre-hook.0", "ogre.strike.jaws.1", "ogre.spell.ignition", "ogre.spell.roar"].map(id => needsHands(pf2eRules, byId[id]))).toEqual([true, false, true, false]);
    // (Breaking free: its jaws or its Athletics, the better; its grab's Athletics DC, its knots' Thievery DC.)
    expect(spec).toMatchObject({ escapeWork: { mod: 12 }, escapeDC: 22, tiesDC: 11 });
  });
});
