/**
 * Whether a PF2e creature fights as an animal (the core's spec.animalistic): its own traits first (an animal; a beast
 * with no language), else animal wits (Intelligence +0 or lower) and no language. Never a mindless one.
 */
import { expect, test } from "vitest";
import { animalisticOf } from "../scripts/traits.js";

test("an animal always; a beast unless it speaks", () => {
  expect(animalisticOf({ traits: ["animal"], int: -4, languages: [] })).toBe(true);
  expect(animalisticOf({ traits: ["animal"], int: 1, languages: ["common"] })).toBe(true);
  expect(animalisticOf({ traits: ["beast"], int: -3, languages: [] })).toBe(true);
  expect(animalisticOf({ traits: ["beast"], int: 3, languages: ["common", "sphinx"] })).toBe(false);
});

test("otherwise animal wits and no language; a mindless one never; a speaker or a sharp mind, no", () => {
  expect(animalisticOf({ traits: ["dragon"], int: -1, languages: [] })).toBe(true);
  expect(animalisticOf({ traits: ["undead", "mindless", "zombie"], int: -5, languages: [] })).toBe(false);
  expect(animalisticOf({ traits: ["construct", "mindless"], int: -5, languages: [] })).toBe(false);
  expect(animalisticOf({ traits: ["humanoid", "goblin"], int: 0, languages: ["goblin"] })).toBe(false);
  expect(animalisticOf({ traits: ["aberration"], int: 2, languages: [] })).toBe(false);
});
