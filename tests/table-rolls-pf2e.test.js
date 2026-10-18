/**
 * PF2e's own dice in a live battle, where the rules roll them themselves (not the system's roller): each a table roll
 * the core shows in the chat (its recording rng: rng.mark and rng.record), with what it was for and its DC. A recovery
 * check, a flat check (persistent damage's end), the Stealth a sneak rolls as the fight begins, cutting free of a
 * gullet. A plain rng (a simulation's) records nothing.
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle } from "../../fast-fighting/scripts/engine/simulator.js";
import { createRng } from "../../fast-fighting/scripts/engine/rng.js";
import { recordingRng, takeRolls } from "../../fast-fighting/scripts/engine/table-rolls.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";

const dying = (n = 1) => ({ id: "hero", status: "down", stable: false, dying: n, wounded: 0, spec: { name: "hero" } });

describe("PF2e's own dice, shown in a live battle", () => {
  test("a recovery check: a flat check against 10 + dying, the dying creature's", () => {
    const rng = recordingRng(createRng(4));
    const hero = dying(2);
    pf2eRules.recoveryCheck(hero, rng);
    const [roll, ...more] = rng.tray.rolls;
    expect(more).toEqual([]);
    expect(roll).toMatchObject({ by: "hero", kind: "flat", what: "recovery", dc: 12, mod: 0 });
    expect(roll.total).toBe(roll.dice[0].result);
    expect(roll.dice[0].faces).toBe(20);
  });

  test("persistent damage's end: its DC 15 flat check, named for what it's for", () => {
    const run = { rng: recordingRng(createRng(9)) };
    pf2eRules.persistentFlatCheck(run.rng, { run, unit: dying(), type: "fire" });
    const [roll] = takeRolls(run);
    expect(roll).toMatchObject({ by: "hero", kind: "flat", dc: 15 });
    expect(roll.label).toBeTruthy();
  });

  test("a sneak's Stealth as the fight begins, against its foes' best Perception DC: rolled once, shown", () => {
    const unit = (id, side, over = {}) => ({
      id, name: id, side, kind: "npc", level: 1, hp: { value: 30, max: 30 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
      initiative: { mod: 5, stealth: 6 }, speeds: { walk: 25 }, iwr: {}, flags: { fearless: true }, diesAtZero: true, perception: 5, ...over,
      actions: [{ id: "blade", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, damage: [parseFormula("1d8+4", "slashing")] }]
    });
    const spec = { combatants: [unit("hero", "friendly", { perception: 9 }), unit("orc", "hostile", { hidden: true })], sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { maxRounds: 2, surprise: "system" } };
    const run = beginRun(prepareBattle(spec, pf2eRules), 3, { record: true });
    const shown = takeRolls(run).filter(r => r.what === "stealth");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ by: "orc", kind: "check", mod: 6, dc: 19 });
    expect(shown[0].total).toBe(shown[0].dice[0].result + 6);
    expect(run.surprise.hidden.includes("orc")).toBe(shown[0].total >= 19);
    // (A simulation's own: nothing recorded.)
    expect(takeRolls(beginRun(prepareBattle(spec, pf2eRules), 3))).toEqual([]);
  });

  test("a plain rng (a simulation's) rolls as ever and records nothing", () => {
    const rng = createRng(4);
    const taped = recordingRng(createRng(4));
    const a = dying(2);
    const b = dying(2);
    pf2eRules.recoveryCheck(a, rng);
    pf2eRules.recoveryCheck(b, taped);
    expect(a).toEqual(b);
    expect(rng.tray).toBeUndefined();
  });
});
