import { describe, expect, test } from "vitest";
import { pf2eRules } from "../scripts/rules.js";
import { degreeDistribution } from "../scripts/core.js";
import { STATUS } from "../scripts/core.js";

describe("pf2e degrees of success", () => {
  test("thresholds and natural 20/1 adjustments", () => {
    expect(pf2eRules.degreeOfSuccess(10, 30, 20)).toBe(3);
    expect(pf2eRules.degreeOfSuccess(10, 20, 20)).toBe(2);
    expect(pf2eRules.degreeOfSuccess(10, 19, 20)).toBe(1);
    expect(pf2eRules.degreeOfSuccess(10, 10, 20)).toBe(0);
    expect(pf2eRules.degreeOfSuccess(20, 15, 20)).toBe(2); // natural 20 bumps a failure to success
    expect(pf2eRules.degreeOfSuccess(1, 25, 20)).toBe(1); // natural 1 drops a success to failure
  });

  test("distribution sums to 1", () => {
    const dist = degreeDistribution(pf2eRules, 9, 16);
    expect(dist.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    // +9 vs AC 16: hit on 7+, critical on 17+
    expect(dist[3]).toBeCloseTo(0.2);
    expect(dist[2] + dist[3]).toBeCloseTo(0.7);
  });

  test("multiple attack penalty", () => {
    const action = { maps: [0, -4, -8] };
    expect([0, 1, 2, 3].map(i => pf2eRules.attackPenalty(action, i))).toEqual([0, -4, -8, -8]);
    expect(pf2eRules.attackPenalty({ subjectToMAP: false }, 2)).toBe(0);
  });

  test("immunities, weaknesses and resistances", () => {
    const iwr = { immune: ["fire"], weak: { cold: 5 }, resist: { physical: 3 } };
    expect(pf2eRules.applyIwr(iwr, { fire: 10, cold: 2, slashing: 2, piercing: 10 })).toBe(7 + 0 + 7);
  });
});

describe("pf2e dying", () => {
  const pc = () => ({ spec: { diesAtZero: false }, status: STATUS.STANDING, hp: 0, maxHp: 20, dying: 0, wounded: 0, doomed: 0 });

  test("drop to 0 gives dying 1 + wounded, a critical gives 2", () => {
    const a = pc();
    pf2eRules.onDropped(a);
    expect(a.dying).toBe(1);
    const b = { ...pc(), wounded: 1 };
    pf2eRules.onDropped(b, { crit: true });
    expect(b.dying).toBe(3);
  });

  test("dying 4 is death and doomed lowers the limit", () => {
    const a = { ...pc(), wounded: 2 };
    pf2eRules.onDropped(a, { crit: true });
    expect(a.status).toBe(STATUS.DEAD);
    const b = { ...pc(), doomed: 2 };
    pf2eRules.onDropped(b, { crit: true });
    expect(b.status).toBe(STATUS.DEAD);
  });

  test("healing revives, adds wounded, leaves prone", () => {
    const a = pc();
    pf2eRules.onDropped(a);
    pf2eRules.onHealed(a, 8);
    expect(a.status).toBe(STATUS.STANDING);
    expect(a.wounded).toBe(1);
    expect(a.prone).toBe(true);
    expect(a.hp).toBe(8);
  });

  test("NPCs die at zero", () => {
    const a = { ...pc(), spec: { diesAtZero: true } };
    pf2eRules.onDropped(a);
    expect(a.status).toBe(STATUS.DEAD);
  });
});

describe("pf2e Reactive Strike", () => {
  test("only creatures that have it react; a Step gets clear", async () => {
    const { derivePf2eTraits } = await import("../scripts/traits.js");
    const fighter = derivePf2eTraits({ type: "character", level: 1, traits: [], int: 0, wis: 1, will: 5, abilities: ["reactive-strike"] });
    const wizard = derivePf2eTraits({ type: "character", level: 1, traits: [], int: 4, wis: 1, will: 7, abilities: [] });
    const legacy = derivePf2eTraits({ type: "npc", level: 2, traits: ["humanoid"], int: 0, wis: 0, will: 6, abilities: ["attack-of-opportunity"] });
    expect(fighter.flags.reactiveStrike).toBe(true);
    expect(wizard.flags.reactiveStrike).toBeUndefined();
    expect(legacy.flags.reactiveStrike).toBe(true);
    const sword = { kind: "strike", melee: true, damage: [{ dice: [{ n: 1, faces: 8, mult: 1 }], flat: 4, type: "slashing" }], bonus: 7 };
    const unit = flags => ({ spec: { flags }, conds: {}, prep: { offense: [sword] } });
    expect(pf2eRules.opportunity(unit({ reactiveStrike: true }))).toBe(sword);
    expect(pf2eRules.opportunity(unit({}))).toBeNull();
    expect(pf2eRules.disengage().cost).toEqual({ actions: 1 });
  });
});
