/** Setting a character up by itself, as PF2e reads it: class and ancestry by slug, a creature's traits, gear. */
import { describe, expect, test } from "vitest";
import { pf2eHints, pf2eTactics, textOf } from "../scripts/auto.js";

describe("the playstyles PF2e says fit", () => {
  test("a class; a shield and heavy armor make a Tank likelier", () => {
    const h = pf2eHints({ cls: "champion", shield: true, heavy: true });
    expect(h.tank).toBeCloseTo(0.9);
    expect(pf2eHints({ cls: "rogue" }).thief).toBe(0.5);
    expect(pf2eHints({ cls: "commander" }).leader).toBe(0.7);
  });

  test("a creature's traits (an ancestry among them counts once)", () => {
    expect(pf2eHints({ traits: ["undead", "mindless"] }).relentless).toBeCloseTo(0.8);
    expect(pf2eHints({ traits: ["fiend", "unholy"] }).cruel).toBeCloseTo(0.7);
    expect(pf2eHints({ ancestry: "goblin", traits: ["goblin", "humanoid"] })).toEqual({ impatient: 0.15 });
  });
});

describe("PF2e's answers to the tactics questions", () => {
  test("a class's style; a champion guards; the mindless never run", () => {
    expect(pf2eTactics({ cls: "guardian" })).toMatchObject({ style: "protector", target: "protect" });
    expect(pf2eTactics({ cls: "wizard" }).style).toBe("caster");
    expect(pf2eTactics({ traits: ["mindless"] }).retreat).toBe("never");
  });

  test("a biography's every field as text", () => {
    expect(textOf({ backstory: "<p>A greedy <b>sellsword</b>.</p>", edicts: ["Never back down"], anathema: [] })).toBe("A greedy sellsword .. Never back down");
  });
});
