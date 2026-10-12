import { describe, test, expect } from "vitest";
import { derivePf2eTraits, ruleLeans } from "../scripts/traits.js";
import { PC_BASELINE } from "../../FastFighting/scripts/constants.js";

/** A level-1 player character: the usual hero's numbers unless told otherwise. */
const pc = extra => derivePf2eTraits({ type: "character", level: 5, traits: ["human", "humanoid"], int: 1, wis: 1, con: 1, will: 10, abilities: [], items: [], skills: {}, perception: 1, inParty: true, ...extra });

// Rules as PF2e's own feats and features have them (Player Core).
const BRAVERY = [{ key: "AdjustDegreeOfSuccess", selector: "will", predicate: ["item:trait:fear"], adjustment: { success: "one-degree-better" } }];
const COOPERATIVE_NATURE = [{ key: "FlatModifier", selector: "check", predicate: ["action:aid"], type: "circumstance", value: 4 }];
const HAUGHTY_OBSTINACY = [{ key: "AdjustDegreeOfSuccess", selector: "will", type: "save", predicate: ["mental", "inflicts:controlled"], adjustment: { success: "one-degree-better" } }];
const FORLORN = [{ key: "FlatModifier", selector: "saving-throw", predicate: ["emotion"], type: "circumstance", value: 1 }];

describe("a PF2e player character's traits, from its sheet", () => {
  test("the usual hero's numbers make the usual hero", () => {
    expect(pc().traits).toEqual(PC_BASELINE);
  });

  test("no two alike: a wizard thinks ahead, a cleric's Will steadies her, a criminal looks out for itself", () => {
    const wizard = pc({ level: 1, int: 4, wis: 1, con: 2, will: 6, cls: "wizard", background: "merchant" }).traits;
    const cleric = pc({ level: 1, int: 0, wis: 4, con: 0, will: 9, cls: "cleric", background: "acolyte", traits: ["human", "humanoid", "holy"], skills: { medicine: 1 } }).traits;
    const fighter = pc({ level: 1, int: 1, wis: 0, con: 2, will: 3, cls: "fighter", background: "farmhand", skills: { "warfare-lore": 1 }, perception: 2 }).traits;
    const rogue = pc({ level: 1, int: 0, wis: 2, con: 1, will: 7, cls: "rogue", background: "criminal", skills: { thievery: 1, deception: 1, "underworld-lore": 1 } }).traits;
    expect(wizard.tactical).toBeGreaterThan(Math.max(cleric.tactical, fighter.tactical, rogue.tactical));
    expect(cleric.brave).toBeGreaterThan(Math.max(wizard.brave, fighter.brave));
    expect(fighter.brave).toBeLessThan(PC_BASELINE.brave);
    expect(rogue.selfish).toBeGreaterThan(wizard.selfish);
    expect(cleric.selfish).toBeLessThan(PC_BASELINE.selfish - 10);
    expect(new Set([wizard, cleric, fighter, rogue].map(x => JSON.stringify(x))).size).toBe(4);
  });

  test("feats and features by what their rules do", () => {
    expect(ruleLeans(BRAVERY)).toEqual({ brave: 6 });
    expect(ruleLeans(COOPERATIVE_NATURE)).toEqual({ loyal: 3, selfish: -2 });
    expect(ruleLeans(HAUGHTY_OBSTINACY)).toEqual({ brave: 2, loyal: -3 });
    expect(ruleLeans(FORLORN)).toEqual({ brave: 2 });
    expect(ruleLeans([{ key: "Immunity", type: "frightened" }])).toEqual({ brave: 10 });
    expect(ruleLeans([{ key: "FlatModifier", selector: "athletics", value: 1 }])).toEqual({});
    const brave = pc({ items: [{ slug: "bravery", name: "Bravery", rules: BRAVERY }] });
    expect(brave.traits.brave).toBe(PC_BASELINE.brave + 6);
    expect(brave.reasons.brave).toContain("Bravery");
    // (A few have no rules to read, and are known by slug.)
    expect(pc({ items: [{ slug: "aura-of-courage", name: "Aura of Courage", rules: [] }] }).traits.brave).toBeGreaterThan(PC_BASELINE.brave);
  });

  test("one who isn't in a party is less bound to the others", () => {
    expect(pc({ inParty: false }).traits.loyal).toBe(PC_BASELINE.loyal - 10);
    expect(pc({ inParty: undefined }).traits.loyal).toBe(PC_BASELINE.loyal);
  });

  test("each trait's reason says where it started and what moved it", () => {
    const { reasons } = pc({ cls: "champion", names: { cls: "Champion" } });
    expect(reasons.selfish).toContain("Champion");
    expect(reasons.tactical).toContain(String(PC_BASELINE.tactical));
  });
});

describe("a PF2e creature's traits", () => {
  test("holy, unholy, and its kind's loyalty move it from what it is", () => {
    const plain = derivePf2eTraits({ type: "npc", level: 3, traits: ["humanoid"], int: 0, wis: 0, will: 8 }).traits;
    const holy = derivePf2eTraits({ type: "npc", level: 3, traits: ["humanoid", "holy"], int: 0, wis: 0, will: 8 }).traits;
    const unholy = derivePf2eTraits({ type: "npc", level: 3, traits: ["humanoid", "unholy"], int: 0, wis: 0, will: 8 }).traits;
    expect(holy.selfish).toBeLessThan(plain.selfish);
    expect(unholy.selfish).toBeGreaterThan(plain.selfish);
    const devil = derivePf2eTraits({ type: "npc", level: 3, traits: ["fiend", "devil"], int: 2, wis: 1, will: 9 }).traits;
    const demon = derivePf2eTraits({ type: "npc", level: 3, traits: ["fiend", "demon"], int: 2, wis: 1, will: 9 }).traits;
    expect(devil.loyal).toBeGreaterThan(plain.loyal);
    expect(demon.loyal).toBeLessThan(plain.loyal);
  });

  test("a minion is its master's, whatever else it is", () => {
    const companion = derivePf2eTraits({ type: "character", level: 1, traits: ["animal", "minion"], int: -4, wis: 2, will: 4 }).traits;
    expect(companion.selfish).toBe(10);
    expect(companion.loyal).toBe(85);
  });

  test("the mindless don't change: nothing moves them", () => {
    const zombie = derivePf2eTraits({ type: "npc", level: 1, traits: ["undead", "mindless", "unholy"], int: -5, wis: 0, will: 4 }).traits;
    expect(zombie).toEqual({ tactical: 5, brave: 100, selfish: 60, loyal: 80 });
  });
});
