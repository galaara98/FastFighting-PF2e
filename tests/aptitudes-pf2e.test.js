/**
 * A PF2e creature's aptitudes (the core's spec.aptitudes, core API 23): its Intelligence, Strength, Dexterity, Wisdom
 * and Charisma modifiers on the core's 0 to 4 scale (2 average); a mindless creature as dumb as it gets.
 */
import { expect, test } from "vitest";
import { aptitudeBand, aptitudesOf } from "../scripts/traits.js";
import { APTITUDES, APTITUDE_MOST } from "../scripts/core.js";

test("each modifier banded: -3 or lower 0, -2 to -1 1, +0 to +2 2, +3 to +4 3, +5 or higher 4", () => {
  expect([-5, -3, -2, -1, 0, 2, 3, 4, 5, 8].map(aptitudeBand)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  expect(aptitudeBand(undefined)).toBe(2);
});

test("all five, from the attribute each is read from", () => {
  const a = aptitudesOf({ abilities: { str: 4, dex: -2, int: 5, wis: 0, cha: -4 }, traits: ["humanoid"] });
  expect(a).toEqual({ smart: 4, strong: 3, fast: 1, wise: 2, charismatic: 0 });
  expect(Object.keys(a)).toEqual([...APTITUDES]);
  expect(Math.max(...Object.values(a))).toBeLessThanOrEqual(APTITUDE_MOST);
});

test("a wolf is dumb, a zombie mindless whatever its Intelligence, a sage sharp", () => {
  expect(aptitudesOf({ abilities: { str: 1, dex: 2, int: -4, wis: 1, cha: -2 }, traits: ["animal"] }).smart).toBe(0);
  expect(aptitudesOf({ abilities: { str: 3, dex: -1, int: 0, wis: 0, cha: -2 }, traits: ["undead", "mindless", "zombie"] }).smart).toBe(0);
  expect(aptitudesOf({ abilities: { int: 4, wis: 3 }, traits: ["human"] })).toMatchObject({ smart: 3, wise: 3, strong: 2 });
});
