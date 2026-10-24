/**
 * Food in PF2e (scripts/food.js, the core's API 27): what a creature eats and how likely it comes hungry, by its kind;
 * the meat a body leaves, by size, none from a body of no flesh; and what counts as food.
 */
import { describe, expect, test } from "vitest";
import { pf2eAppetite, pf2eMeatFor, pf2eIsFood, pf2eCorpseKind, CORPSES, HUNGER, MEAT_ICON } from "../scripts/food.js";

const creature = (traits = [], { size = "med", strikes = [], type = "npc" } = {}) => ({
  type, system: { traits: { value: traits, size: { value: size } } }, itemTypes: { melee: strikes.map(slug => ({ slug })) }
});

describe("what it eats", () => {
  test("an animal that bites eats meat, and comes hungry most often; one that doesn't, anything", () => {
    expect(pf2eAppetite(creature(["animal"], { strikes: ["jaws"] }))).toEqual({ diet: "meat", hunger: HUNGER.biter, cannibal: false });
    expect(pf2eAppetite(creature(["beast"], { strikes: ["mandibles", "claw"] }))).toMatchObject({ diet: "meat" });
    expect(pf2eAppetite(creature(["animal"], { strikes: ["hoof"] }))).toEqual({ diet: "any", hunger: HUNGER.beast, cannibal: false });
  });

  test("any other living creature eats anything, rarely hungry in a fight; mindless, constructs, undead, elementals, the bodiless never eat", () => {
    expect(pf2eAppetite(creature(["humanoid", "kobold"]))).toEqual({ diet: "any", hunger: HUNGER.living, cannibal: false });
    for ( const t of ["mindless", "construct", "undead", "elemental", "incorporeal"] ) expect(pf2eAppetite(creature([t]))).toMatchObject({ diet: null });
    expect(pf2eAppetite(creature([], { type: "loot" }))).toBeNull();
  });
});

describe("the corpse a body leaves", () => {
  test("a Fresh Corpse: one item, equipment, a creature's Bulk, its portions by size, food", () => {
    const meat = pf2eMeatFor(creature(["animal"], { size: "lg" }));
    expect(meat.quantity).toBe(8);
    expect(meat.item).toMatchObject({ type: "equipment", img: MEAT_ICON, system: { quantity: 1, bulk: { value: 12 } }, flags: { "fast-fighting": { corpse: "fresh", food: "meat", portions: 8 } } });
    expect(pf2eMeatFor(creature(["humanoid"], { size: "tiny" })).quantity).toBe(1);
    expect(pf2eMeatFor(creature(["dragon"], { size: "grg" })).quantity).toBe(32);
    expect(pf2eIsFood(meat.item)).toEqual({ portions: 8, meat: true });
  });

  test("an undead's a Rotten Corpse, a body of metal or a machine's a Scrap Corpse: never food", () => {
    for ( const [traits, kind] of [[["undead"], "rotten"], [["undead", "mindless"], "rotten"], [["construct", "clockwork"], "scrap"], [["metal", "elemental"], "scrap"], [["robot"], "scrap"]] ) {
      const corpse = pf2eMeatFor(creature(traits));
      expect(pf2eCorpseKind(creature(traits))).toBe(kind);
      expect(corpse.quantity).toBe(0);
      expect(corpse.item).toMatchObject({ type: "equipment", img: CORPSES[kind].img, flags: { "fast-fighting": { corpse: kind } } });
      expect(corpse.item.flags["fast-fighting"].food).toBeUndefined();
      expect(pf2eIsFood(corpse.item)).toBeNull();
    }
  });

  test("none from another body of no flesh, nor an incorporeal undead", () => {
    for ( const t of ["construct", "elemental", "incorporeal", "ooze", "plant", "fungus", "swarm"] ) expect(pf2eMeatFor(creature([t]))).toBeNull();
    expect(pf2eMeatFor(creature(["undead", "incorporeal"]))).toBeNull();
  });

  test("a fresh corpse eaten to its last portion is no food", () => {
    expect(pf2eIsFood({ system: { quantity: 1 }, flags: { "fast-fighting": { corpse: "fresh", food: "meat", portions: 0 } } })).toBeNull();
  });
});

describe("what counts as food", () => {
  test("the meat of before, rations, alchemical food: as many portions as there are", () => {
    expect(pf2eIsFood({ system: { quantity: 3 }, flags: { "fast-fighting": { food: "meat" } } })).toEqual({ portions: 3, meat: true });
    expect(pf2eIsFood({ system: { slug: "rations", quantity: 2 } })).toEqual({ portions: 2, meat: false });
    expect(pf2eIsFood({ system: { quantity: 1, traits: { otherTags: ["alchemical-food"] } } })).toEqual({ portions: 1, meat: false });
    expect(pf2eIsFood({ system: { slug: "rope", quantity: 1 } })).toBeNull();
  });
});
