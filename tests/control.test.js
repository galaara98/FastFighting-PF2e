import { describe, expect, test } from "vitest";
import { parseControl, parseCritRider, durationRounds } from "../scripts/control.js";

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
    expect(o[1].endsOnDamage).toBe(true);
    expect(o[1].rounds).toBe(10);
  });

  test("Command: an action lost, or the whole turn", () => {
    const o = parseControl({ description: COMMAND, duration: "until the end of the target's next turn" });
    expect(o[1].conditions).toEqual({ slowed: 1 });
    expect(o[0].conditions).toEqual({ incapacitated: 1 });
    expect(o[0].rounds).toBe(1);
  });

  test("a damage spell's critical-failure rider", () => {
    expect(parseCritRider(DAZE)).toMatchObject({ kind: "condition", conditions: { stunned: 1 }, critOnly: true });
    expect(parseCritRider("<p>Deals 2d6 fire damage.</p>")).toBeNull();
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
    expect(o[2]).toBeNull();
  });
});
