/**
 * PF2e's maneuvers as the core plays them (maneuvers.js, the core's engine/maneuvers.js): each names its maneuver and
 * gives PF2e's outcomes by degree; a Shove or a Reposition by a drop sends the foe over it, and the fall is PF2e's
 * (half the distance in bludgeoning damage, prone); a Grapple grabs until the end of the grappler's next turn, and on a
 * critical success restrains as well, both broken by one Escape; botched, the foe grabs you, and a botched Reposition
 * has the foe move you. A creature's attack effects as the remaster's glossary has them, by slug: Grab, Knockdown, Push
 * and Pull an action after a hit with the Strike that lists them, their maneuver's check; the Improved ones free, at
 * once; Grab used again to keep hold.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle, endOfTurn } from "../../fast-fighting/scripts/engine/simulator.js";
import { MANEUVERS, MANEUVER_IDS, withManeuver } from "../../fast-fighting/scripts/engine/maneuvers.js";
import { holdsOf, tryHold, release } from "../../fast-fighting/scripts/engine/behavior/holds.js";
import { applyOutcome } from "../../fast-fighting/scripts/engine/behavior/effects.js";
import { controlValue } from "../../fast-fighting/scripts/engine/behavior/control.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { followUpWorth, freshTurn } from "../../fast-fighting/scripts/engine/behavior/requires.js";
import { Turn } from "../../fast-fighting/scripts/engine/turn.js";
import { skillManeuvers, attackEffectOf, effectManeuver, keepHold } from "../scripts/maneuvers.js";
import { attackEffects, effectFollowUps } from "../scripts/adapter.js";

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

  test("Reposition: moved 5 feet within your reach, 10 on a critical success; a critical failure, it moves you 5", () => {
    expect(all().reposition.onHit.map(move)).toEqual([{ kind: "place", feet: 5 }, null, { kind: "place", feet: 5 }, { kind: "place", feet: 10 }]);
    expect(all().reposition.onHit.map(o => !!o?.self)).toEqual([true, false, false, false]);
  });

  test("Trip: prone, and 1d6 bludgeoning on a critical success only; a critical failure, you are", () => {
    const { onHit } = all().trip;
    expect(onHit.map(o => o?.conditions ?? null)).toEqual([{ prone: 1 }, null, { prone: 1 }, { prone: 1 }]);
    expect(onHit.map(o => !!o?.self)).toEqual([true, false, false, false]);
    expect(onHit[3].damage).toEqual([parseFormula("1d6", "bludgeoning")]);
    expect([onHit[0].damage, onHit[2].damage]).toEqual([undefined, undefined]);
  });

  test("Grapple: grabbed, restrained on a critical success, for a round; a critical failure, the foe grabs you", () => {
    const { onHit } = all().grapple;
    expect(onHit[2]).toMatchObject({ grab: true, conditions: { grabbed: 1 }, rounds: 1 });
    expect(onHit[3]).toMatchObject({ grab: true, conditions: { restrained: 1 }, rounds: 1 });
    expect(onHit[0]).toMatchObject({ self: true, grab: true });
    expect(onHit[0].conditions).toBeUndefined();
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

describe("a creature's attack effects, as the remaster's glossary has them (by slug)", () => {
  const grapple = { maneuver: "grapple", action: "grapple", against: "fortitude" };
  const trip = { maneuver: "trip", action: "trip", against: "reflex" };
  const shove = { maneuver: "shove", action: "shove", against: "fortitude" };
  const drag = { maneuver: "drag", action: "reposition", against: "fortitude" };

  test("Grab a Grapple, Knockdown a Trip, Push a Shove, Pull a Reposition toward it; the Improved ones free", () => {
    expect(attackEffectOf("grab")).toEqual({ free: false, attack: false, feet: null, maneuvers: [grapple] });
    expect(attackEffectOf("improved-grab")).toEqual({ free: true, attack: false, feet: null, maneuvers: [grapple] });
    expect(attackEffectOf("knockdown")).toMatchObject({ free: false, maneuvers: [trip] });
    expect(attackEffectOf("improved-knockdown")).toMatchObject({ free: true, maneuvers: [trip] });
    expect(attackEffectOf("push")).toMatchObject({ free: false, maneuvers: [shove] });
    expect(attackEffectOf("improved-push", "Improved Push 20 feet")).toMatchObject({ free: true, feet: 20, maneuvers: [shove] });
    expect(attackEffectOf("pull", "Pull 10 feet")).toMatchObject({ free: false, feet: 10, maneuvers: [drag] });
    // (Its choice: either.)
    expect(attackEffectOf("push-or-pull-10-feet")).toMatchObject({ free: false, feet: 10, maneuvers: [shove, drag] });
    // (A listed Trip is PF2e's Trip action: an attack, as any Trip.)
    expect(attackEffectOf("trip")).toMatchObject({ free: false, attack: true, maneuvers: [trip] });
  });

  test("the distance a Push or a Pull lists, in its slug or its name, however the books write it", () => {
    expect(attackEffectOf("push").feet).toBeNull();
    expect(attackEffectOf("push-15-feet", "Push 15 feet").feet).toBe(15);
    expect(attackEffectOf("improved-push-10-feet").feet).toBe(10);
    for ( const name of ["Push 10ft", "Push (10 feet)", "Push 10 Feet", "Improved Push (10 Feet)"] ) expect(attackEffectOf("push", name).feet).toBe(10);
  });

  test("nothing else: a creature's own Tongue Pull, an Improved Trip no creature has", () => {
    for ( const slug of ["tongue-pull", "improved-trip", "pushy", "constrict", "", null] ) expect(attackEffectOf(slug)).toBeNull();
  });

  test("the maneuver: its Athletics against the defense, no hand, no multiple attack penalty, its own card first", () => {
    const a = effectManeuver({ id: "croc.g1", name: "Grab", how: grapple, athletics: 12, maxSize: 3, reach: 10 });
    expect(a).toMatchObject({ id: "croc.g1.grapple", name: "Grab", kind: "control", maneuver: "grapple", cost: 1, hands: 0, melee: true, reach: 10, maxSize: 3, card: true,
      check: { mod: 12, against: "fortitude" } });
    expect(a.check.attack).toBeUndefined();
    // (Grabbed until the end of its next turn; restrained on a critical success; botched, the foe has hold of it.)
    expect(a.onHit[2]).toMatchObject({ grab: true, conditions: { grabbed: 1 }, rounds: 1, until: "source" });
    expect(a.onHit[3]).toMatchObject({ grab: true, conditions: { restrained: 1 }, until: "source" });
    expect(a.onHit[0]).toMatchObject({ self: true, grab: true });
    // (A Push that lists 20 feet: 20 on a success, no less on a critical one.)
    const push = effectManeuver({ id: "giant.p1", name: "Push", how: shove, feet: 20, athletics: 12, maxSize: 4 });
    expect(push.onHit.map(move)).toEqual([null, null, { kind: "push", feet: 20 }, { kind: "push", feet: 20 }]);
    expect(effectManeuver({ id: "giant.p1", name: "Push", how: shove, athletics: 12, maxSize: 4 }).onHit.map(move)).toEqual([null, null, { kind: "push", feet: 5 }, { kind: "push", feet: 10 }]);
    expect(effectManeuver({ id: "eel.p2", name: "Pull", how: drag, feet: 10, athletics: 12, maxSize: 3 }).onHit[2].move).toEqual({ kind: "pull", feet: 10 });
    expect(effectManeuver({ id: "wolf.k1", name: "Knockdown", how: trip, athletics: 9, maxSize: 3 }).onHit.map(o => o?.conditions ?? null)).toEqual([{ prone: 1 }, null, { prone: 1 }, { prone: 1 }]);
  });

  test("Grab kept up: an action, no roll, only on one it holds", () => {
    expect(keepHold({ id: "croc.g1", name: "Grab" })).toMatchObject({ id: "croc.g1.keep", kind: "control", auto: true, cost: 1, card: true,
      requires: { holding: true }, outcome: { renew: true, rounds: 1 } });
  });

  const item = (id, slug, name, extra = {}) => ({ id, name, system: { slug, traits: { value: [] } }, ...extra });
  const croc = (...items) => ({ id: "croc", items, skills: { athletics: { mod: 14 } }, size: "med" });
  const strike = list => ({ system: { attackEffects: { value: list }, traits: { value: [] } } });

  test("on the Strike: only the Improved ones, a maneuver rider tried free at once; the distance from the English name", () => {
    const actor = croc(item("g1", "improved-grab", "Improved Grab"), item("p1", "improved-push", "Poussée améliorée 6 m", { flags: { babele: { originalName: "Improved Push 20 feet" } } }), item("k1", "knockdown", "Knockdown"));
    const riders = attackEffects(actor, strike(["improved-grab", "improved-push", "knockdown", "grab"]));
    expect(riders.map(r => r.kind)).toEqual(["control", "control"]);
    expect(riders[0].control).toMatchObject({ id: "croc.g1.grapple", name: "Improved Grab", maneuver: "grapple", cost: 0, check: { mod: 14, against: "fortitude" }, maxSize: 3 });
    expect(riders[1].control).toMatchObject({ id: "croc.p1.shove", name: "Poussée améliorée 6 m", maneuver: "shove", cost: 0 });
    expect(riders[1].control.onHit[2].move).toEqual({ kind: "push", feet: 20 });
    // (No ability on the creature: PF2e's word for the effect, its slug for the id.)
    expect(attackEffects(croc(), strike(["improved-knockdown"]))[0].control).toMatchObject({ id: "croc.improved-knockdown.trip", maneuver: "trip" });
  });

  test("after the hit: the plain ones, an action each, after any Strike that lists them; Grab kept up beside them", () => {
    const actor = croc(item("g1", "grab", "Grab"), item("k1", "knockdown", "Knockdown"), item("w1", "push-or-pull", "Push or Pull 10 feet"));
    const out = effectFollowUps(actor, [{ id: "jaws", slugs: ["grab", "knockdown"], reach: 10 }, { id: "tail", slugs: ["grab", "push-or-pull"], reach: 5 }]);
    const by = Object.fromEntries(out.map(a => [a.id, a]));
    expect(Object.keys(by).sort()).toEqual(["croc.g1.grapple", "croc.g1.keep", "croc.k1.trip", "croc.w1.reposition", "croc.w1.shove"]);
    expect(by["croc.g1.grapple"]).toMatchObject({ cost: 1, reach: 10, requires: { lastHit: { with: ["jaws", "tail"] } } });
    expect(by["croc.k1.trip"].requires).toEqual({ lastHit: { with: ["jaws"] } });
    expect(by["croc.w1.shove"].requires).toEqual({ lastHit: { with: ["tail"] } });
    expect(by["croc.w1.shove"].onHit[2].move).toEqual({ kind: "push", feet: 10 });
    expect(by["croc.w1.reposition"].onHit[2].move).toEqual({ kind: "pull", feet: 10 });
    expect(by["croc.w1.shove"].name).not.toBe(by["croc.w1.reposition"].name);
    expect(by["croc.g1.keep"]).toMatchObject({ requires: { holding: true }, reach: 10 });
    // (Improved Grab: nothing after the hit, its rider does that; but kept up as an action, all the same.)
    expect(effectFollowUps(croc(item("g2", "improved-grab", "Improved Grab")), [{ id: "jaws", slugs: ["improved-grab"], reach: 5 }]).map(a => a.id)).toEqual(["croc.g2.keep"]);
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

  test("grabbed until the end of the grappler's next turn: not grappled again while that's to come; then worth keeping up", () => {
    const run = fight([unit("hero", "friendly", 0, { actions: [fist(), only("grapple")] }), unit("orc", "hostile", 5, { traits: minded(40) })]);
    const [hero, orc] = ["hero", "orc"].map(id => run.byId.get(id));
    const grapple = hero.prep.offense.find(a => a.maneuver === "grapple");
    expect(controlValue(run, hero, grapple, orc)).toBeGreaterThan(0);
    // (A success in its own turn, as the core lands it: the grab, and the condition.)
    run.acting = hero;
    const e = applyOutcome(orc, grapple.onHit[2], hero.id, grapple);
    orc.grabbedBy = hero.id;
    orc.grabKey = e.key;
    expect(orc.conds.grabbed).toBe(1);
    expect(holdsOf(run, orc)).toEqual([expect.objectContaining({ key: "grabbed", byId: "hero" })]);
    expect(controlValue(run, hero, grapple, orc)).toBe(0);
    endOfTurn(run, hero);
    endOfTurn(run, orc);
    // (The orc's turn over, still held: the hero's next turn ends it, unless grappled again.)
    expect(orc.conds.grabbed).toBe(1);
    expect(controlValue(run, hero, grapple, orc)).toBeGreaterThan(0);
    endOfTurn(run, hero);
    expect([orc.conds.grabbed, orc.grabbedBy]).toEqual([undefined, null]);
  });

  test("a Trip done well: prone, and the 1d6 bludgeoning as it lands", () => {
    const run = fight([unit("hero", "friendly", 0, { actions: [only("trip")] }), unit("orc", "hostile", 5, { traits: minded(40) })]);
    const orc = run.byId.get("orc");
    takeTurn(run, run.byId.get("hero"));
    const trips = run.log.filter(e => e.type === "control" && e.actorId === "hero");
    expect(trips[0]).toMatchObject({ maneuver: "trip", degree: 3 });
    for ( const trip of trips ) {
      expect(trip.damage).toBeGreaterThanOrEqual(1);
      expect(trip.damage).toBeLessThanOrEqual(6);
    }
    expect(orc.prone).toBe(true);
    expect(orc.hp).toBe(60 - trips.reduce((s, e) => s + e.damage, 0));
  });

  test("botched: a Grapple leaves the foe holding you; a Reposition has it move you", () => {
    const botch = id => skillManeuvers({ actorId: "hero", maxSize: 3, athletics: -60 }).find(a => a.maneuver === id);
    const run = fight([unit("hero", "friendly", 0, { actions: [botch("grapple")] }), unit("orc", "hostile", 5, { traits: minded(40) })]);
    const hero = run.byId.get("hero");
    takeTurn(run, hero);
    expect(run.log.find(e => e.type === "control" && e.actorId === "hero")).toMatchObject({ maneuver: "grapple", degree: 0, backfired: true });
    expect(hero.grabbedBy).toBe("orc");
    const moved = fight([unit("hero", "friendly", 0, { actions: [botch("reposition")] }), unit("orc", "hostile", 5, { traits: minded(40) })]);
    takeTurn(moved, moved.byId.get("hero"));
    expect(moved.log.find(e => e.type === "control" && e.actorId === "hero")).toMatchObject({ maneuver: "reposition", degree: 0, backfired: true });
    expect(moved.log.find(e => e.type === "forced")).toMatchObject({ how: "place", actorId: "orc", targetId: "hero" });
  });

});

/** A creature whose Strikes list these attack effects (each its ability, by slug), as the adapter builds it. */
function lister(id, side, x, { jaws = {}, claw = null, effects = [], names = {}, athletics = 40, over = {} } = {}) {
  const items = effects.map((slug, i) => ({ id: `i${i}`, name: names[slug] ?? slug, system: { slug, traits: { value: [] } } }));
  const actor = { id, items, skills: { athletics: { mod: athletics } }, size: "med" };
  const strikeItem = { system: { attackEffects: { value: effects }, traits: { value: [] } } };
  const bite = { ...fist(), id: `${id}.jaws`, name: "Jaws", hands: 0, effects: attackEffects(actor, strikeItem), ...jaws };
  const follows = effectFollowUps(actor, [{ id: bite.id, slugs: effects.filter(slug => attackEffectOf(slug)?.free === false), reach: 5 }]);
  return unit(id, side, x, { actions: [bite, ...(claw ? [claw] : []), ...follows], escapeDC: 25, ...over });
}
/** What one did in its turn: its attacks and maneuvers, in order. */
const doings = (run, id) => run.log.filter(e => e.actorId === id && ["attack", "control"].includes(e.type));

describe("Grab, Knockdown and Push, as the remaster's glossary has them", () => {
  const claw = () => ({ ...fist(), id: "croc.claw", name: "Claw", hands: 0 });

  test("Grab: an action straight after a hit with the Strike that lists it, its Grapple at the foe it hit; never after a miss or the other Strike", () => {
    let grabs = 0;
    for ( let seed = 1; seed <= 12; seed++ ) {
      const run = fight([unit("hero", "friendly", 0, { hp: { value: 300, max: 300 }, escapeWork: { mod: -40 } }), lister("croc", "hostile", 5, { effects: ["grab"], claw: claw() })], null, seed);
      takeTurn(run, run.byId.get("croc"));
      const mine = doings(run, "croc");
      mine.forEach((e, i) => {
        if ( e.type !== "control" ) return;
        grabs += 1;
        expect(e).toMatchObject({ maneuver: "grapple", roll: "check", against: "fortitude", targetId: "hero" });
        expect(mine[i - 1]).toMatchObject({ type: "attack", action: "Jaws", targetId: "hero" });
        expect(mine[i - 1].degree).toBeGreaterThanOrEqual(2);
      });
      // (It costs an action: three things in the turn at most, the Grab one of them.)
      expect(mine.length).toBeLessThanOrEqual(3);
      if ( mine.some(e => e.type === "control" && e.degree >= 2) ) expect(run.byId.get("hero").grabbedBy).toBe("croc");
    }
    expect(grabs).toBeGreaterThan(2);
  });

  test("the Grab's Grapple neither takes nor adds to the multiple attack penalty", () => {
    for ( let seed = 1; seed <= 12; seed++ ) {
      const run = fight([unit("hero", "friendly", 0, { hp: { value: 300, max: 300 }, escapeWork: { mod: -40 } }), lister("croc", "hostile", 5, { effects: ["grab"] })], null, seed);
      takeTurn(run, run.byId.get("croc"));
      const mine = doings(run, "croc");
      const grab = mine.findIndex(e => e.type === "control");
      if ( grab < 0 ) continue;
      expect(mine[grab].mod).toBe(40);
      const after = mine.slice(grab + 1).find(e => e.type === "attack");
      if ( after ) expect(after.attackNumber).toBe(2);
      return;
    }
    throw new Error("no Grab in twelve tries");
  });

  test("Improved Grab: free, at once, after every hit; the turn's three Strikes still made", () => {
    const run = fight([unit("hero", "friendly", 0, { hp: { value: 300, max: 300 }, escapeWork: { mod: -40 } }), lister("croc", "hostile", 5, { effects: ["improved-grab"], jaws: { bonus: 60 } })]);
    takeTurn(run, run.byId.get("croc"));
    const mine = doings(run, "croc");
    expect(mine.filter(e => e.type === "attack").map(e => e.attackNumber)).toEqual([1, 2, 3]);
    expect(mine.slice(0, 2).map(e => e.type)).toEqual(["attack", "control"]);
    expect(mine[1]).toMatchObject({ maneuver: "grapple", roll: "check", took: true });
    expect(run.byId.get("hero").grabbedBy).toBe("croc");
  });

  test("Knockdown: an action after the hit, a Trip; Improved Knockdown free, at once", () => {
    let trips = 0;
    for ( let seed = 1; seed <= 12; seed++ ) {
      const run = fight([unit("hero", "friendly", 0, { hp: { value: 300, max: 300 } }), lister("wolf", "hostile", 5, { effects: ["knockdown"], claw: claw() })], null, seed);
      takeTurn(run, run.byId.get("wolf"));
      const mine = doings(run, "wolf");
      mine.forEach((e, i) => {
        if ( e.type !== "control" ) return;
        trips += 1;
        expect(e).toMatchObject({ maneuver: "trip", against: "reflex" });
        expect(mine[i - 1]).toMatchObject({ type: "attack", action: "Jaws" });
        expect(mine[i - 1].degree).toBeGreaterThanOrEqual(2);
      });
      expect(mine.length).toBeLessThanOrEqual(3);
    }
    expect(trips).toBeGreaterThan(2);
    const free = fight([unit("hero", "friendly", 0, { hp: { value: 300, max: 300 } }), lister("wolf", "hostile", 5, { effects: ["improved-knockdown"], jaws: { bonus: 60 } })]);
    takeTurn(free, free.byId.get("wolf"));
    const mine = doings(free, "wolf");
    expect(mine.filter(e => e.type === "attack").length).toBe(3);
    expect(mine[1]).toMatchObject({ type: "control", maneuver: "trip", took: true });
    expect(free.byId.get("hero").prone).toBe(true);
  });

  test("Push 10 feet: an action after the hit, a Shove as far as it lists (over a ledge: worth it); Improved Push free", () => {
    const pushed = (effects, jaws = {}, seeds = 12) => {
      for ( let seed = 1; seed <= seeds; seed++ ) {
        const run = fight([unit("hero", "friendly", 5, { hp: { value: 300, max: 300 } }), lister("brute", "hostile", 0, { effects, names: { push: "Push 10 feet", "improved-push": "Improved Push 10 feet" }, jaws })], ledge(), seed);
        takeTurn(run, run.byId.get("brute"));
        const mine = doings(run, "brute");
        const shove = mine.findIndex(e => e.type === "control" && e.degree >= 2);
        if ( shove >= 0 ) return { run, mine, shove };
      }
      return null;
    };
    const plain = pushed(["push"]);
    expect(plain).not.toBeNull();
    expect(plain.mine[plain.shove - 1]).toMatchObject({ type: "attack", action: "Jaws" });
    expect(plain.mine[plain.shove - 1].degree).toBeGreaterThanOrEqual(2);
    expect(plain.mine[plain.shove]).toMatchObject({ maneuver: "shove", against: "fortitude" });
    // (Ten feet it would have gone; over the edge five feet on, it falls.)
    expect(plain.run.byId.get("brute").prep.offense.find(a => a.maneuver === "shove").onHit[2].move).toEqual({ kind: "push", feet: 10 });
    expect(plain.run.log.find(e => e.type === "forced")).toMatchObject({ how: "push", actorId: "brute", targetId: "hero", fall: 20 });
    expect(plain.mine.length).toBeLessThanOrEqual(3);
    const free = pushed(["improved-push"], { bonus: 60 });
    expect(free.mine[free.shove - 1]).toMatchObject({ type: "attack", attackNumber: 1 });
    expect(free.run.log.find(e => e.type === "forced")).toMatchObject({ how: "push", fall: 20 });
  });

  test("the Statistics Engine: a Strike that would let a Grab follow is worth more than its own damage", () => {
    const run = fight([unit("hero", "friendly", 0), lister("croc", "hostile", 5, { effects: ["grab"], claw: claw() })]);
    const [croc, hero] = ["croc", "hero"].map(id => run.byId.get(id));
    run.acting = croc;
    croc.turn = new Turn(pf2eRules, croc);
    freshTurn(croc);
    const [jaws, other] = ["croc.jaws", "croc.claw"].map(id => croc.prep.offense.find(a => a.id === id));
    expect(followUpWorth(run, croc, jaws, hero, 0, croc.turn)).toBeGreaterThan(0);
    expect(followUpWorth(run, croc, other, hero, 0, croc.turn)).toBe(0);
  });

  test("Grab used again on the foe it holds: the hold kept to the end of its next turn, no roll", () => {
    const run = fight([unit("hero", "friendly", 0, { hp: { value: 300, max: 300 }, escapeWork: { mod: -40 } }), lister("croc", "hostile", 5, { effects: ["grab"], jaws: { bonus: -60 } })]);
    const [croc, hero] = ["croc", "hero"].map(id => run.byId.get(id));
    const grab = croc.prep.offense.find(a => a.maneuver === "grapple" && a.check);
    const keep = croc.prep.offense.find(a => a.outcome?.renew);
    // (Grabbed last turn: its hold ends as this turn of the croc's does.)
    run.acting = croc;
    const e = applyOutcome(hero, grab.onHit[2], croc.id, grab);
    hero.grabbedBy = croc.id;
    hero.grabKey = e.key;
    endOfTurn(run, croc);
    endOfTurn(run, hero);
    takeTurn(run, croc);
    expect(doings(run, "croc").find(x => x.type === "control")).toMatchObject({ action: keep.name, roll: "auto", took: true });
    expect([hero.conds.grabbed, hero.grabbedBy]).toEqual([1, "croc"]);
  });
});
