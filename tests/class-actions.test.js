import { describe, expect, test } from "vitest";
import { classActions, extraParts } from "../scripts/class-actions.js";
import { parseFormula } from "../scripts/core.js";

const strike = (name, formula, traits = []) => ({ id: `a.${name}`, name, kind: "strike", cost: 1, bonus: 10, maps: traits.includes("agile") ? [0, -4, -8] : [0, -5, -10], melee: true, reach: 5,
  damage: [parseFormula(formula, "slashing")], critDamage: null, traits });
const greataxe = strike("Greataxe", "1d12+4");
const shortsword = strike("Shortsword", "1d6+4", ["agile", "finesse"]);
const fist = strike("Fist", "1d6+4", ["agile", "unarmed"]);
const build = (slugs, strikes, level = 5) => classActions({ actorId: "a", slugs: new Set(slugs), level, strikes });

describe("martial class actions", () => {
  test("Vicious Swing: two actions, one more weapon die (two at 10th), counting as two attacks", () => {
    const [swing] = build(["vicious-swing"], [greataxe, shortsword]).actions;
    expect(swing).toMatchObject({ name: "Vicious Swing (Greataxe)", cost: 2, attacks: 2 });
    expect(swing.damage.at(-1).dice).toEqual([{ n: 1, faces: 12 }]);
    expect(build(["power-attack"], [greataxe], 10).actions[0].damage.at(-1).dice).toEqual([{ n: 2, faces: 12 }]);
  });

  test("Double Slice: a Strike with each of two weapons, both at the same penalty", () => {
    const [slice] = build(["double-slice"], [greataxe, shortsword, fist]).actions;
    expect(slice).toMatchObject({ name: "Double Slice", cost: 2, sameMap: true });
    expect(slice.sequence.map(s => s.name)).toEqual(["Greataxe", "Shortsword"]);
    expect(build(["double-slice"], [greataxe, fist]).actions).toEqual([]); // (one weapon and a fist: no)
  });

  test("Sudden Charge: two Strides and a Strike", () => {
    expect(build(["sudden-charge"], [greataxe]).actions[0]).toMatchObject({ cost: 2, charge: 2 });
  });

  test("Flurry of Blows: two unarmed Strikes for one action, once a turn", () => {
    const [flurry] = build(["flurry-of-blows"], [greataxe, fist]).actions;
    expect(flurry).toMatchObject({ name: "Flurry of Blows", cost: 1, oncePerTurn: true });
    expect(flurry.sequence.map(s => s.name)).toEqual(["Fist", "Fist"]);
  });

  test("Hunter's Edge: Flurry eases the penalty, Precision adds precision damage once a turn", () => {
    const flurry = build(["hunt-prey", "flurry"], [greataxe, shortsword]).strikes;
    expect(flurry.map(s => s.maps)).toEqual([[0, -3, -6], [0, -2, -4]]);
    const precision = build(["hunt-prey", "precision"], [greataxe], 11).strikes[0].bonusDamage[0];
    expect(precision).toMatchObject({ oncePerTurn: true, parts: [{ dice: [{ n: 2, faces: 8 }], category: "precision" }] });
  });
});

describe("what a roll option adds to a Strike", () => {
  const part = (dice, flat, type = "piercing", category = null) => ({ dice: dice.map(([n, faces]) => ({ n, faces, mult: 1 })), flat, type, persistent: false, category });
  test("the extra dice and flat damage, of the same type, as precision when asked", () => {
    expect(extraParts([part([[1, 6]], 4)], [part([[1, 6], [1, 6]], 4)], "precision")).toEqual([part([[1, 6]], 0, "piercing", "precision")]);
    expect(extraParts([part([[1, 6]], 2)], [part([[1, 6]], 6)])).toEqual([part([], 4)]);
    // A new type of damage is all extra; nothing new is nothing.
    expect(extraParts([part([[1, 6]], 2)], [part([[1, 6]], 2), part([[1, 6]], 0, "fire")])).toEqual([part([[1, 6]], 0, "fire")]);
    expect(extraParts([part([[1, 6]], 2)], [part([[1, 6]], 2)])).toEqual([]);
  });
});
