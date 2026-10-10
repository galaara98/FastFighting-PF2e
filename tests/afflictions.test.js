import { describe, expect, test } from "vitest";
import { parseAffliction } from "../scripts/afflictions.js";
import { meanPart } from "../scripts/core.js";

// Shape of the PF2e Monster Core Hunting Spider Venom description.
const VENOM = `<p><strong>Saving Throw</strong> @Check[fortitude|dc:16]</p><hr><p><strong>Maximum Duration</strong> 6 rounds</p>
<p><strong>Stage 1</strong> @Damage[1d4[poison]] damage and @UUID[Compendium.pf2e.conditionitems.Item.x]{Off-Guard} (1 round)</p>
<p><strong>Stage 2</strong> @Damage[1d6[poison]] damage, @UUID[Compendium.pf2e.conditionitems.Item.y]{Clumsy 1}, and off-guard (1 round)</p>
<p><strong>Stage 3</strong> 1d6 poison damage, @UUID[Compendium.pf2e.conditionitems.Item.y]{Clumsy 2}, and off-guard (1 round)</p>`;

describe("pf2e afflictions", () => {
  test("parses save, duration and stages", () => {
    const a = parseAffliction({ id: "v", name: "Hunting Spider Venom", description: VENOM, traits: ["poison"] });
    expect(a.save).toEqual({ type: "fortitude", dc: 16 });
    expect(a.maxDuration).toBe(6);
    expect(a.stages).toHaveLength(3);
    expect(a.stages[0].damage[0].type).toBe("poison");
    expect(meanPart(a.stages[0].damage[0])).toBeCloseTo(2.5);
    expect(a.stages[0].conditions).toEqual({ offGuard: true });
    expect(a.stages[1].conditions).toEqual({ offGuard: true, clumsy: 1 });
    expect(a.stages[2].conditions.clumsy).toBe(2);
    expect(a.stages[2].damage).toHaveLength(1);
    expect(meanPart(a.stages[2].damage[0])).toBeCloseTo(3.5);
  });

  test("returns null without a save", () => {
    expect(parseAffliction({ id: "x", name: "Knockdown", description: "<p>The wolf knocks its target prone.</p>" })).toBeNull();
  });

  test("diseases with day-long stages", () => {
    const text = `<p><strong>Saving Throw</strong> DC 15 Fortitude; <strong>Onset</strong> 1 day</p>
      <p><strong>Stage 1</strong> carrier with no ill effect (1 day)</p><p><strong>Stage 2</strong> enfeebled 1 (1 day)</p>`;
    const d = parseAffliction({ id: "d", name: "Filth Fever", description: text, traits: ["disease"] });
    expect(d.save).toEqual({ type: "fortitude", dc: 15 });
    expect(d.onset).toBe(14400);
    expect(d.stages[1].conditions).toEqual({ enfeebled: 1 });
    expect(d.stages[1].duration).toBe(14400);
  });
});
