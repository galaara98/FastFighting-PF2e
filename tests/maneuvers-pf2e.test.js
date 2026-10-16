/**
 * PF2e's maneuvers as the core plays them (maneuvers.js, the core's engine/maneuvers.js): each names its maneuver and
 * gives PF2e's outcomes by degree; a Shove or a Reposition by a drop sends the foe over it, and the fall is PF2e's
 * (half the distance in bludgeoning damage, prone); a Grapple grabs, and on a critical success restrains as well, both
 * broken by one Escape.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle, endOfTurn } from "../../fast-fighting/scripts/engine/simulator.js";
import { MANEUVERS, MANEUVER_IDS, withManeuver } from "../../fast-fighting/scripts/engine/maneuvers.js";
import { holdsOf, tryHold, release } from "../../fast-fighting/scripts/engine/behavior/holds.js";
import { applyOutcome } from "../../fast-fighting/scripts/engine/behavior/effects.js";
import { controlValue } from "../../fast-fighting/scripts/engine/behavior/control.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { skillManeuvers } from "../scripts/maneuvers.js";

const all = (over = {}) => Object.fromEntries(skillManeuvers({ actorId: "a", maxSize: 3, athletics: 10, deception: 8, intimidation: 6, ...over }).map(a => [a.maneuver, a]));
const move = o => o?.move ?? null;

describe("PF2e's maneuvers, by degree (critical failure, failure, success, critical success)", () => {
  test("each names a maneuver the core knows, keeps its own outcomes, and rolls as PF2e does", () => {
    const m = all();
    expect(Object.keys(m)).toEqual(["demoralize", "trip", "grapple", "disarm", "shove", "reposition", "feint"]);
    for ( const a of Object.values(m) ) {
      expect(MANEUVER_IDS).toContain(a.maneuver);
      expect(a).toMatchObject({ id: `a.${a.maneuver}`, kind: "control", cost: 1 });
      expect(a.name).toBeTruthy();
      expect(withManeuver(a)).toBe(a);
      for ( const o of a.onHit.filter(Boolean) ) expect(o.label).toBeTruthy();
    }
    // (Athletics against Fortitude or Reflex: an attack, a free hand, no more than one size larger.)
    for ( const [id, against] of [["shove", "fortitude"], ["reposition", "fortitude"], ["grapple", "fortitude"], ["trip", "reflex"], ["disarm", "reflex"]] ) {
      expect(m[id]).toMatchObject({ check: { mod: 10, against, attack: true }, traits: ["attack"], hands: 1, melee: true, maxSize: 3 });
    }
    expect(m.feint).toMatchObject({ check: { mod: 8, against: "perception" }, traits: ["mental"], melee: true });
    expect(m.feint.check.attack).toBeUndefined();
    expect(m.demoralize).toMatchObject({ check: { mod: 6, against: "will" }, oncePerTarget: true, melee: false, range: { max: 30 } });
  });

  test("Shove: pushed 5 feet, 10 on a critical success; a critical failure, you fall (the core's own)", () => {
    const { onHit } = all().shove;
    expect(onHit.map(move)).toEqual([null, null, { kind: "push", feet: 5 }, { kind: "push", feet: 10 }]);
    expect(onHit[0]).toMatchObject({ self: true, conditions: { prone: 1 } });
    expect([onHit[2].move, onHit[3].move, onHit[0].conditions]).toEqual([MANEUVERS.shove.success.move, MANEUVERS.shove.crit.move, MANEUVERS.shove.critFail.conditions]);
  });

  test("Reposition: moved 5 feet within your reach, 10 on a critical success; a critical failure does nothing here", () => {
    expect(all().reposition.onHit.map(move)).toEqual([null, null, { kind: "place", feet: 5 }, { kind: "place", feet: 10 }]);
    expect(all().reposition.onHit[0]).toBeNull();
  });

  test("Trip: prone; a critical failure, you are", () => {
    const { onHit } = all().trip;
    expect(onHit.map(o => o?.conditions ?? null)).toEqual([{ prone: 1 }, null, { prone: 1 }, { prone: 1 }]);
    expect(onHit.map(o => !!o?.self)).toEqual([true, false, false, false]);
  });

  test("Grapple: grabbed, restrained on a critical success, for a round; a critical failure, you fall", () => {
    const { onHit } = all().grapple;
    expect(onHit[2]).toMatchObject({ grab: true, conditions: { grabbed: 1 }, rounds: 1 });
    expect(onHit[3]).toMatchObject({ grab: true, conditions: { restrained: 1 }, rounds: 1 });
    expect(onHit[0]).toMatchObject({ self: true, conditions: { prone: 1 } });
    expect(onHit[1]).toBeNull();
  });

  test("Disarm: -2 to its attacks with it; knocked out of its hand on a critical success; a critical failure, you're off-guard", () => {
    const { onHit, disarm } = all().disarm;
    expect(disarm).toBe(true);
    expect(onHit[2]).toMatchObject({ mods: { attack: -2 }, rounds: 1 });
    expect(onHit[2].conditions).toBeUndefined();
    expect(onHit[3]).toMatchObject({ conditions: { disarmed: 1 }, mods: { actions: -1 } });
    expect(onHit[0]).toMatchObject({ self: true, conditions: { offGuard: 1 } });
  });

  test("Feint: off-guard to you alone, for this turn; on a critical success through your next", () => {
    const { onHit } = all().feint;
    expect(onHit[2]).toMatchObject({ conditions: { offGuard: 1 }, onlyVs: true, rounds: 1 });
    expect(onHit[3]).toMatchObject({ conditions: { offGuard: 1 }, onlyVs: true, rounds: 2 });
    expect([onHit[0], onHit[1]]).toEqual([null, null]);
  });

  test("Demoralize: frightened 1, 2 on a critical success", () => {
    expect(all().demoralize.onHit.map(o => o?.conditions ?? null)).toEqual([null, null, { frightened: 1 }, { frightened: 2 }]);
  });

  test("only what it can: untrained in Athletics or Deception, none of theirs; no Intimidation at all, no Demoralize", () => {
    expect(Object.keys(all({ athletics: null, deception: null }))).toEqual(["demoralize"]);
    expect(Object.keys(all({ intimidation: null, deception: null }))).toEqual(["trip", "grapple", "disarm", "shove", "reposition"]);
  });
});

describe("a fall, as PF2e has it", () => {
  test("bludgeoning damage of half the distance fallen, in feet; prone on landing", () => {
    expect(pf2eRules.fallDamage(20)).toEqual([expect.objectContaining({ dice: [], flat: 10, type: "bludgeoning" })]);
    expect(pf2eRules.fallDamage(35)[0].flat).toBe(17);
    expect(pf2eRules.fallDamage(5)).toEqual([]);
    expect(pf2eRules.fallProne).toBe(true);
  });
});

const minded = (tactical = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const fist = () => ({ id: "fist", name: "Fist", kind: "strike", cost: 1, bonus: 10, maps: [0, -4, -8], melee: true, reach: 5, hands: 1, damage: [parseFormula("1d4", "bludgeoning")] });
/** Only the one maneuver, with an Athletics no Fortitude stands up to. */
const only = id => skillManeuvers({ actorId: "hero", maxSize: 3, athletics: 40 }).find(a => a.maneuver === id);
const unit = (id, side, x, over = {}) => ({
  id, name: id, side, kind: "npc", level: 1, hp: { value: 60, max: 60 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [fist()], iwr: {}, flags: {}, diesAtZero: true, traits: minded(), position: { x, y: 0, size: 5 }, ...over
});
/** A fight on a map (cells: [[i, j, cell]]), a round in, with PF2e's rules. */
function fight(list, cells = null, seed = 2) {
  const spec = { combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: true, maxRounds: 4, aftermath: "none" } };
  if ( cells ) spec.ground = { size: 5, cells };
  const run = beginRun(prepareBattle(spec, pf2eRules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
/** The ground falls away 20 feet behind the orc (x = 10 on). */
const ledge = () => Array.from({ length: 6 }, (_, k) => [2 + k, 0, { g: -20 }]);

describe("PF2e's maneuvers in a fight", () => {
  test("a Shove by a ledge: over it goes, 10 bludgeoning for the 20 feet, and it lands prone", () => {
    const run = fight([unit("hero", "friendly", 0, { hp: { value: 300, max: 300 }, actions: [fist(), only("shove")] }), unit("orc", "hostile", 5, { traits: minded(40) })], ledge());
    const orc = run.byId.get("orc");
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "control" && e.actorId === "hero")).toMatchObject({ maneuver: "shove", against: "fortitude" });
    expect(run.log.find(e => e.type === "forced" && e.targetId === "orc")).toMatchObject({ how: "push", fall: 20 });
    expect(run.log.find(e => e.type === "fall" && e.actorId === "orc")).toMatchObject({ feet: 20, amount: 10 });
    expect(orc.hp).toBeLessThanOrEqual(50);
    expect(orc.prone).toBe(true);
  });

  test("a Reposition by a pit: put in it, within the hero's reach (15 for the 30 feet)", () => {
    const run = fight([unit("hero", "friendly", 0, { hp: { value: 300, max: 300 }, actions: [only("reposition")] }), unit("orc", "hostile", 5, { traits: minded(40) })], [[0, 1, { g: -30 }]]);
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "forced" && e.targetId === "orc")).toMatchObject({ how: "place", fall: 30, to: { x: 0, y: 5 } });
    expect(run.log.find(e => e.type === "fall" && e.actorId === "orc")).toMatchObject({ feet: 30, amount: 15 });
  });

  test("a Grapple done well: grabbed and restrained, one hold (the grabber's Athletics DC), and one Escape out of both", () => {
    const run = fight([unit("hero", "friendly", 0, { escapeDC: 25, actions: [only("grapple")] }), unit("orc", "hostile", 5, { traits: minded(40), escapeWork: { mod: 60 } })]);
    const orc = run.byId.get("orc");
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.find(e => e.type === "control" && e.actorId === "hero")).toMatchObject({ maneuver: "grapple", degree: 3, conditions: ["restrained"] });
    expect(orc.grabbedBy).toBe("hero");
    expect(orc.conds.restrained).toBe(1);
    const holds = holdsOf(run, orc);
    expect(holds).toEqual([expect.objectContaining({ key: "grabbed", byId: "hero", dc: 25 })]);
    expect(tryHold(run, orc, holds[0])).toMatchObject({ success: true, dc: 25 });
    release(run, orc, holds[0]);
    expect([orc.grabbedBy, orc.conds.restrained]).toEqual([null, undefined]);
  });

  test("grabbed, it isn't grappled again while the grab's fresh; a round on, it's worth keeping up", () => {
    const run = fight([unit("hero", "friendly", 0, { actions: [fist(), only("grapple")] }), unit("orc", "hostile", 5, { traits: minded(40) })]);
    const [hero, orc] = ["hero", "orc"].map(id => run.byId.get(id));
    const grapple = hero.prep.offense.find(a => a.maneuver === "grapple");
    expect(controlValue(run, hero, grapple, orc)).toBeGreaterThan(0);
    // (A success, as the core lands it: the grab, and the condition.)
    applyOutcome(orc, grapple.onHit[2], hero.id, grapple);
    orc.grabbedBy = hero.id;
    expect(orc.conds.grabbed).toBe(1);
    expect(holdsOf(run, orc)).toEqual([expect.objectContaining({ key: "grabbed", byId: "hero" })]);
    expect(controlValue(run, hero, grapple, orc)).toBe(0);
    endOfTurn(run, orc);
    expect(orc.conds.grabbed).toBeUndefined();
    expect(controlValue(run, hero, grapple, orc)).toBeGreaterThan(0);
  });
});
