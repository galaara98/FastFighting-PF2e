/**
 * Food in PF2e (scripts/food.js, the core's API 27): what a creature eats and how likely it comes hungry, by its kind;
 * the meat a body leaves, by size, none from a body of no flesh; and what counts as food.
 */
import { describe, expect, test } from "vitest";
import { pf2eAppetite, pf2eMeatFor, pf2eIsFood, HUNGER, MEAT_ICON } from "../scripts/food.js";

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

describe("the meat a body leaves", () => {
  test("by size, as our own uncooked meat, marked as meat", () => {
    const meat = pf2eMeatFor(creature(["animal"], { size: "lg" }));
    expect(meat.quantity).toBe(8);
    expect(meat.item).toMatchObject({ type: "consumable", img: MEAT_ICON, system: { category: "other", quantity: 8 }, flags: { "fast-fighting": { food: "meat" } } });
    expect(pf2eMeatFor(creature(["humanoid"], { size: "tiny" })).quantity).toBe(1);
    expect(pf2eMeatFor(creature(["dragon"], { size: "grg" })).quantity).toBe(32);
  });

  test("none from a body of no flesh", () => {
    for ( const t of ["construct", "elemental", "incorporeal", "ooze", "plant", "fungus", "undead", "swarm"] ) expect(pf2eMeatFor(creature([t]))).toBeNull();
  });
});

describe("what counts as food", () => {
  test("our meat, rations, alchemical food: as many portions as there are", () => {
    expect(pf2eIsFood({ system: { quantity: 3 }, flags: { "fast-fighting": { food: "meat" } } })).toEqual({ portions: 3, meat: true });
    expect(pf2eIsFood({ system: { slug: "rations", quantity: 2 } })).toEqual({ portions: 2, meat: false });
    expect(pf2eIsFood({ system: { quantity: 1, traits: { otherTags: ["alchemical-food"] } } })).toEqual({ portions: 1, meat: false });
    expect(pf2eIsFood({ system: { slug: "rope", quantity: 1 } })).toBeNull();
  });
});
