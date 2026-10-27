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

  test("holy and unholy, the remaster's: by what deals it (its traits), once a blow, whatever its damage", () => {
    const fiend = { weak: { holy: 10 }, resist: { physical: 5 } };
    expect(pf2eRules.applyIwr(fiend, { slashing: 8, spirit: 4 }, null, { traits: ["holy", "magical"] })).toBe(3 + 4 + 10);
    expect(pf2eRules.applyIwr(fiend, { slashing: 8, spirit: 4 }, null, { traits: ["magical"] })).toBe(3 + 4);
    expect(pf2eRules.applyIwr(fiend, { slashing: 8 })).toBe(3);
    // (Resisted by trait too, and none of it to one immune.)
    expect(pf2eRules.applyIwr({ resist: { unholy: 5 } }, { void: 8 }, null, { traits: ["unholy"] })).toBe(3);
    expect(pf2eRules.applyIwr({ immune: ["holy"] }, { fire: 8 }, null, { traits: ["holy"] })).toBe(0);
    // (An older item's alignment trait, as the remaster has it: good is holy, evil unholy.)
    expect(pf2eRules.applyIwr(fiend, { slashing: 8 }, null, { traits: ["good"] })).toBe(13);
    expect(pf2eRules.applyIwr({ weak: { unholy: 5 } }, { piercing: 6 }, null, { traits: ["evil"] })).toBe(11);
    // (Nothing dealt, nothing for it.)
    expect(pf2eRules.applyIwr(fiend, { slashing: 0 }, null, { traits: ["holy"] })).toBe(0);
  });

  test("the story: an older damage type as the remaster has it (alignment damage, spirit; good, holy light)", () => {
    expect(["positive", "negative", "good", "evil", "lawful", "chaotic", "fire"].map(t => pf2eRules.storyDamageType(t)))
      .toEqual(["vitality", "void", "radiant", "unholy", "spirit", "spirit", "fire"]);
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

  test("stable at 0 and hit again: it gains dying anew, its wounded value added (Wounded: gaining dying while wounded)", () => {
    const a = { ...pc(), status: STATUS.DOWN, stable: true, dying: 0, wounded: 1 };
    pf2eRules.onDropped(a);
    expect([a.status, a.dying, a.stable]).toEqual([STATUS.DOWN, 2, false]);
    const b = { ...pc(), status: STATUS.DOWN, stable: true, dying: 0, wounded: 2 };
    pf2eRules.onDropped(b, { crit: true });
    expect(b.status).toBe(STATUS.DEAD);
    // (Dying already: it goes up by 1, 2 for a critical, its wounded value not added again.)
    const c = { ...pc(), status: STATUS.DOWN, dying: 2, wounded: 1 };
    pf2eRules.onDropped(c);
    expect(c.dying).toBe(3);
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

  test("Diehard: dying 5 is death (spec.dyingMax), doomed still lowers it", () => {
    const a = { ...pc(), spec: { diesAtZero: false, dyingMax: 5 }, wounded: 2 };
    pf2eRules.onDropped(a, { crit: true });
    expect([a.status, a.dying]).toEqual([STATUS.DOWN, 4]);
    const b = { ...pc(), spec: { diesAtZero: false, dyingMax: 5 }, wounded: 2, doomed: 1 };
    pf2eRules.onDropped(b, { crit: true });
    expect(b.status).toBe(STATUS.DEAD);
  });

  test("Administer First Aid stabilizes against 5 + its recovery check's DC (the Player Core's): 15 + dying, 14 with Toughness", () => {
    expect(pf2eRules.firstAidDC({ ...pc(), dying: 2 })).toBe(17);
    expect(pf2eRules.firstAidDC({ ...pc(), spec: { recoveryDC: 9 }, dying: 2 })).toBe(16);
  });

  test("Toughness: recovery checks against 9 + dying (spec.recoveryDC)", () => {
    const ten = { d20: () => 10 };
    const plain = { ...pc(), status: STATUS.DOWN, dying: 1 };
    pf2eRules.recoveryCheck(plain, ten);
    expect(plain.dying).toBe(2);
    const tough = { ...pc(), spec: { diesAtZero: false, recoveryDC: 9 }, status: STATUS.DOWN, dying: 1 };
    pf2eRules.recoveryCheck(tough, ten);
    expect([tough.dying, tough.stable]).toEqual([0, true]);
  });
});

describe("pf2e Ferocity", () => {
  const orc = (extra = {}) => ({ spec: { diesAtZero: false, ferocity: { label: "Orc Ferocity", uses: 1, untilWounded: null, temp: 0 } }, status: STATUS.STANDING,
    hp: 0, temp: 0, maxHp: 20, dying: 0, wounded: 0, doomed: 0, reactionsLeft: 1, conds: {}, ...extra });

  test("Orc Ferocity: its reaction keeps it up at 1 Hit Point, wounded 1, once; said once the blow is done", () => {
    const a = orc();
    expect(pf2eRules.onDropped(a)).toBe(STATUS.STANDING);
    expect([a.hp, a.wounded, a.dying, a.reactionsLeft]).toEqual([1, 1, 0, 0]);
    expect(pf2eRules.afterHarm({}, a)).toEqual({ text: "Orc Ferocity", data: { type: "holdOn", label: "Orc Ferocity" } });
    expect(pf2eRules.afterHarm({}, a)).toBeNull();
    // (Its reaction back, the next blow drops it: once a day, and it's spent. Wounded 1 makes it dying 2.)
    a.reactionsLeft = 1;
    a.hp = 0;
    pf2eRules.onDropped(a);
    expect([a.status, a.dying]).toEqual([STATUS.DOWN, 2]);
  });

  test("not without its reaction, not stunned, not when today's use is gone; Undying Ferocity's temporary Hit Points", () => {
    expect(pf2eRules.onDropped(orc({ reactionsLeft: 0 }))).toBe(STATUS.DOWN);
    expect(pf2eRules.onDropped(orc({ conds: { stunned: 1 } }))).toBe(STATUS.DOWN);
    expect(pf2eRules.onDropped(orc({ spec: { diesAtZero: false, ferocity: { label: "Orc Ferocity", uses: 0 } } }))).toBe(STATUS.DOWN);
    const undying = orc({ spec: { diesAtZero: false, ferocity: { label: "Orc Ferocity", uses: 1, temp: 7 } } });
    pf2eRules.onDropped(undying);
    expect([undying.hp, undying.temp]).toEqual([1, 7]);
  });

  test("a creature's Ferocity: as often as it can react, until it's wounded 3 (then it dies at 0, as creatures do)", () => {
    const boar = orc({ spec: { diesAtZero: true, ferocity: { label: "Ferocity", uses: null, untilWounded: 3, temp: 0 } }, wounded: 1 });
    for ( const wounded of [2, 3] ) {
      boar.hp = 0;
      boar.reactionsLeft = 1;
      expect(pf2eRules.onDropped(boar)).toBe(STATUS.STANDING);
      expect(boar.wounded).toBe(wounded);
    }
    boar.hp = 0;
    boar.reactionsLeft = 1;
    expect(pf2eRules.onDropped(boar)).toBe(STATUS.DEAD);
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

describe("leadership by slug", () => {
  test("a slug is enough (names change with translations); the name is what's shown", async () => {
    const { rankLeaders } = await import("../scripts/leadership.js");
    const base = { level: 3, skills: { diplomacy: 7, intimidation: 5 }, isCommander: false, tactics: 0 };
    const [plain] = rankLeaders([{ id: "a", ...base, abilities: [{ key: "attack-of-opportunity", name: "Gelegenheitsangriff" }] }]);
    const [banner] = rankLeaders([{ id: "b", ...base, abilities: [{ key: "commanders-banner", name: "Banner des Kommandanten" }] }]);
    expect(banner.score).toBe(plain.score + 3);
    expect(banner.reason).toMatch(/Banner des Kommandanten/);
  });
});

describe("immunity covers effects that simply happen", () => {
  test("a fear aura with no save doesn't touch the immune", () => {
    const dirge = { id: "dirge", kind: "control", auto: true, traits: ["fear", "mental"], outcome: { conditions: { frightened: 1 }, rounds: 1 } };
    const fearless = { spec: { iwr: { immune: ["frightened"] }, creatureTraits: [] } };
    const plain = { spec: { iwr: { immune: [] }, creatureTraits: [] } };
    expect(pf2eRules.isImmune(fearless, { ...dirge, traits: [] })).toBe(true);
    expect(pf2eRules.isImmune(plain, dirge)).toBe(false);
    // A backfire on the user isn't what the target would suffer.
    const trip = { id: "trip", kind: "control", check: {}, onHit: [{ conditions: { prone: 1 }, self: true }, null, { conditions: { prone: 1 } }, null] };
    expect(pf2eRules.isImmune({ spec: { iwr: { immune: ["prone"] } } }, trip)).toBe(true);
  });
});

describe("what kind of creature (for grouping neutrals)", () => {
  test("its ancestry if it has one, else its creature types", async () => {
    const { creatureKindOf } = await import("../scripts/traits.js");
    const ancestries = ["goblin", "human", "kobold"];
    expect(creatureKindOf(["goblin", "humanoid"], ancestries)).toBe("goblin");
    expect(creatureKindOf(["human", "humanoid"], ancestries)).toBe("human");
    expect(creatureKindOf(["animal"], ancestries)).toBe("animal");
    expect(creatureKindOf(["elemental", "fire", "dragon"], ancestries)).toBe("dragon:elemental");
    expect(creatureKindOf(["mindless"], ancestries)).toBeNull();
  });
});
