import { describe, expect, test } from "vitest";
import { parseControl, parseCritRider, durationRounds, escapeAt, escapeIn, failureRiders } from "../scripts/control.js";
import { holdsOf, tryHold, release } from "../../fast-fighting/scripts/engine/behavior/holds.js";
import { applyOutcome } from "../../fast-fighting/scripts/engine/behavior/effects.js";
import { pf2eRules } from "../scripts/rules.js";

// Abridged from the PF2e 8.6 compendium.
const FEAR = `<p>You plant fear in the target; it must attempt a Will save.</p> <hr /> <p><strong>Critical Success</strong> The target is unaffected.</p> <p><strong>Success</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 1}.</p> <p><strong>Failure</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 2}.</p> <p><strong>Critical Failure</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 3} and @UUID[Compendium.pf2e.conditionitems.Item.sDPxOjQ9kx2RZE8D]{Fleeing} for 1 round.</p> <hr /> <p><strong>Heightened (3rd)</strong> You can target up to five creatures.</p>`;
const SLOW = `<p>You dilate the flow of time around the target, slowing its actions.</p> <hr /> <p><strong>Critical Success</strong> The target is unaffected.</p> <p><strong>Success</strong> The target is @UUID[x]{Slowed 1} for 1 round.</p> <p><strong>Failure</strong> The target is @UUID[x]{Slowed 1} for 1 minute.</p> <p><strong>Critical Failure</strong> The target is @UUID[x]{Slowed 2} for 1 minute.</p> <hr /> <p><strong>Heightened (6th)</strong> You can target up to 10 creatures.</p>`;
const SLEEP = `<p>Each creature in the area becomes drowsy.</p><hr /><p><strong>Critical Success</strong> The creature is unaffected.</p> <p><strong>Success</strong> The creature takes a –1 status penalty to Perception checks for 1 round.</p> <p><strong>Failure</strong> The creature falls unconscious. If it's still unconscious after 1 minute, it wakes up automatically.</p> <p><strong>Critical Failure</strong> The creature falls unconscious. If it's still unconscious after 1 hour, it wakes up automatically.</p><hr /><p><strong>Heightened (4th)</strong> ...</p>`;
const COMMAND = `<p>You shout a command.</p> <hr /> <p><strong>Success</strong> The creature is unaffected.</p> <p><strong>Failure</strong> For the first action on its next turn, the creature must use a single action to do as you command.</p> <p><strong>Critical Failure</strong> The target must use all its actions on its next turn to obey your command.</p> <hr />`;
const DAZE = `<p>The jolt deals 1d6 mental damage, with a basic Will save. If the target critically fails the save, it is also @UUID[x]{Stunned 1}.</p>`;

describe("PF2e crowd control", () => {
  test("Fear: frightened by degree, fleeing on a critical failure", () => {
    const o = parseControl({ description: FEAR, duration: "varies" });
    expect(o[3]).toBeNull();
    expect(o[2].conditions).toEqual({ frightened: 1 });
    expect(o[1].conditions).toEqual({ frightened: 2 });
    expect(o[0].conditions).toEqual({ frightened: 3, fleeing: 1 });
    expect(o[0].rounds).toBe(1);
    expect(o[1].rounds).toBe(2);
  });

  test("Slow: a round on a success, a minute on a failure", () => {
    const o = parseControl({ description: SLOW, duration: "1 minute" });
    expect(o[2]).toMatchObject({ conditions: { slowed: 1 }, rounds: 1 });
    expect(o[1]).toMatchObject({ conditions: { slowed: 1 }, rounds: 10 });
    expect(o[0]).toMatchObject({ conditions: { slowed: 2 }, rounds: 10 });
  });

  test("Sleep: helpless until hurt; a success does nothing the engine plays out", () => {
    const o = parseControl({ description: SLEEP, duration: "" });
    expect(o[2]).toBeNull();
    expect(o[1].conditions.incapacitated).toBe(1);
    // (Unconscious, as PF2e's sheet says it: not Command's loss of a turn, which no PF2e condition says.)
    expect(o[1].conditions.unconscious).toBe(1);
    expect(o[1].endsOnDamage).toBe(true);
    expect(o[1].rounds).toBe(10);
  });

  test("Command: an action lost, or the whole turn", () => {
    const o = parseControl({ description: COMMAND, duration: "until the end of the target's next turn" });
    expect(o[1].conditions).toEqual({ slowed: 1 });
    expect(o[0].conditions).toEqual({ incapacitated: 1 });
    expect(o[0].conditions.unconscious).toBeUndefined();
    expect(o[0].rounds).toBe(1);
  });

  test("a damage spell's critical-failure rider", () => {
    expect(parseCritRider(DAZE)).toMatchObject({ kind: "condition", conditions: { stunned: 1 }, critOnly: true });
    expect(parseCritRider("<p>Deals 2d6 fire damage.</p>")).toBeNull();
    // (The sentence that says it, ended by a full stop; and a long text a player wrote, read in one pass.)
    expect(parseCritRider("<p>If it critically fails, it is also frightened 2</p>")).toBeNull();
    expect(parseCritRider("<p>It critically fails. It is also frightened 2.</p>")).toBeNull();
    const start = Date.now();
    expect(parseCritRider(`<p>${"critically fails is also ".repeat(4000)}</p>`)).toBeNull();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("durations", () => {
    expect(durationRounds("for 1 round")).toBe(1);
    expect(durationRounds("1 minute")).toBe(10);
    expect(durationRounds("until the end of its next turn")).toBe(1);
    expect(durationRounds("varies")).toBeNull();
  });
});

describe("PF2e control by spell attack", () => {
  test("Tangle Vine: immobilized on a critical success", () => {
    const VINE = `<p>Attempt a spell attack roll against the target.</p> <hr> <p><strong>Critical Success</strong> The target gains the @UUID[x]{Immobilized} condition and takes a –10-foot circumstance penalty to its Speeds for 1 round.</p> <p><strong>Success</strong> The target takes a –10-foot circumstance penalty to its Speeds for 1 round.</p>`;
    const o = parseControl({ description: VINE, duration: "" });
    expect(o[3]).toMatchObject({ conditions: { immobilized: 1 }, rounds: 1 });
    expect(o[3].escape).toBeUndefined();
    expect(o[2]).toBeNull();
  });
});

// Abridged from the PF2e 8.6 compendium (Player Core: Tangle Vine, Impaling Spike; Player Core 2: Web).
const VINE = `<p>A vine lashes itself to the target. Attempt a spell attack roll against the target.</p><hr /><p><strong>Critical Success</strong> The target gains the @UUID[x]{Immobilized} condition and takes a –10-foot circumstance penalty to its Speeds for 1 round. It can attempt to @UUID[y]{Escape} against your spell DC to remove the penalty and the immobilized condition.</p>\n<p><strong>Success</strong> The target takes a –10-foot circumstance penalty to its Speeds for 1 round. It can attempt to Escape against your spell DC to remove the penalty.</p>\n<p><strong>Failure</strong> The target is unaffected.</p>`;
const WEB = `<p>You create a sticky web in the area.</p><hr /><p><strong>Critical Success</strong> The creature is unaffected.</p>\n<p><strong>Success</strong> The creature is unaffected during its action.</p>\n<p><strong>Failure</strong> The creature takes a –10-foot circumstance penalty to its Speeds until the start of its next turn.</p>\n<p><strong>Critical Failure</strong> The creature is immobilized until the start of its next turn, after which it takes a –10-foot circumstance penalty to its Speeds for 1 round. It can attempt to @UUID[y]{Escape} to remove its immobilized condition.</p>`;
const SPIKE = `<p>You conjure a spike that deals 8d6 piercing damage. The target must attempt a Reflex save.</p>\n<hr />\n<p><strong>Critical Success</strong> The target dodges the spike and is unaffected.</p>\n<p><strong>Success</strong> The target takes half damage.</p>\n<p><strong>Failure</strong> The creature takes full damage and, if it's standing on solid ground, becomes @UUID[x]{Immobilized}. It can attempt to @UUID[y]{Escape} (the DC is your spell DC).</p>\n<p><strong>Critical Failure</strong> As failure, but the creature takes double damage, and it is @UUID[z]{Off-Guard} as long as it's impaled.</p>`;

describe("holds an Escape breaks", () => {
  test("Tangle Vine and Web: immobilized, an Escape away (against the spell DC, filled in by whoever reads it)", () => {
    const vine = parseControl({ description: VINE });
    expect(vine[3]).toMatchObject({ conditions: { immobilized: 1 }, escape: { key: "immobilized", dc: null, others: null, with: [] } });
    expect(escapeAt(vine, 18)[3].escape.dc).toBe(18);
    const web = parseControl({ description: WEB, duration: "1 minute" });
    expect(web[0]).toMatchObject({ conditions: { immobilized: 1 }, escape: { key: "immobilized" } });
    expect(web[1]).toBeNull();
  });

  test("Impaling Spike: a failure's hold, and a critical failure's (as a failure, but off-guard too, which goes with it)", () => {
    const o = escapeAt(parseControl({ description: SPIKE, duration: "1 minute" }), 22);
    expect(o[1]).toMatchObject({ conditions: { immobilized: 1 }, escape: { key: "immobilized", dc: 22 } });
    expect(o[0]).toMatchObject({ conditions: { immobilized: 1, offGuard: 1 }, escape: { key: "immobilized", dc: 22, with: ["offGuard"] } });
    // (A damage spell: a failure's outcome, laid as a rider on a failure or worse.)
    expect(failureRiders(o)).toEqual([{ kind: "condition", ...o[1], critOnly: false }]);
    expect(failureRiders([o[0], null, null, null])).toEqual([{ kind: "condition", ...o[0], critOnly: true }]);
    expect(failureRiders(null)).toEqual([]);
  });

  test("an Escape DC its words name; no hold to break, no escape", () => {
    expect(escapeIn("It is immobilized until it Escapes (Escape DC 25).", { immobilized: 1 })).toMatchObject({ key: "immobilized", dc: 25 });
    expect(escapeIn("It can attempt to Escape to remove the penalty.", {})).toBeNull();
    expect(escapeIn("It is immobilized for 1 round.", { immobilized: 1 })).toBeNull();
  });

  test("laid on a creature: a hold the PF2e Escape breaks, against the spell DC; broken, the off-guard goes with it", () => {
    const o = escapeAt(parseControl({ description: SPIKE, duration: "1 minute" }), 22)[0];
    const u = { id: "u", spec: { level: 1, escapeWork: { mod: 12 } }, conds: {}, baseConds: {}, effects: [], turnsTaken: 0 };
    applyOutcome(u, o, "caster", { id: "spike" });
    const run = { prep: { rules: pf2eRules }, rng: { d20: () => 10 }, byId: new Map(), units: [u] };
    const [hold] = holdsOf(run, u);
    expect(hold).toMatchObject({ key: "immobilized", dc: 22, others: null, byId: "caster" });
    expect(tryHold(run, u, hold)).toMatchObject({ success: true, total: 22, dc: 22 });
    release(run, u, hold);
    expect(u.conds).toEqual({});
  });
});
