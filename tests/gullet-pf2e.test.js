/**
 * Swallow Whole and Engulf (gullet.js), as the core's swallowed and engulfed: read from the ability's line (the size, the
 * damage, the Rupture value; Engulf's Reflex DC and Escape DC), played as the Monster Core's glossary has them. Only on
 * a creature it has grabbed, of the listed size or smaller; swallowed, it takes the listed damage at once and at the end
 * of each of its turns, is slowed 1, attacks only its swallower (off-guard to it) with a light weapon, and gets out by
 * Escaping or by cutting itself free (piercing or slashing damage of the Rupture value or more).
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, strikeOutOfTurn, endOfTurn, turnUpkeep, takeTurn } from "../../fast-fighting/scripts/engine/simulator.js";
import { holdsOf, tryHold, release, freeable, untieCost } from "../../fast-fighting/scripts/engine/behavior/holds.js";
import { parseFormula, cutOff } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { gulletAction, lightStrike, chanceAtLeast, holderId, cuttingStrike, full } from "../scripts/gullet.js";
import { gulletsOf } from "../scripts/adapter.js";

const SWALLOW = "<p>Huge, @Damage[(2d8+5)[bludgeoning]], Rupture 20</p>\n<hr />\n<p>@Localize[PF2E.NPC.Abilities.Glossary.SwallowWhole]</p>";
const ENGULF = "<p>@Check[reflex|dc:22|options:damaging-effect,inflicts:grabbed,inflicts:slowed], @Damage[(4d6)[acid]] damage, [[/act escape dc=21]], Rupture 15</p>\n<hr />\n<p>@Localize[PF2E.NPC.Abilities.Glossary.Engulf]</p>";

const minded = { tactical: { base: 60, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const dagger = () => ({ id: "dagger", name: "Dagger", kind: "strike", cost: 1, bonus: 12, maps: [0, -4, -8], melee: true, reach: 5, hands: 1, light: true, damage: [parseFormula("1d4+4", "piercing")] });
const maul = () => ({ id: "maul", name: "Maul", kind: "strike", cost: 1, bonus: 12, maps: [0, -5, -10], melee: true, reach: 5, hands: 2, damage: [parseFormula("1d12+4", "bludgeoning")] });
const creature = (id, side, x, over = {}) => ({
  id, name: id, side, kind: "npc", level: 3, size: 2, hp: { value: 300, max: 300 }, defenses: { ac: 18, fortitude: 9, reflex: 9, will: 9 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [dagger(), maul()], iwr: {}, flags: { fearless: true }, diesAtZero: false, traits: minded,
  position: { x, y: 0, size: 5 }, ...over
});
const worm = (over = {}) => {
  const { action, gullet } = gulletAction({ id: "worm.swallow", name: "Swallow Whole", slug: "swallow-whole", html: SWALLOW, traits: ["attack"], actions: 1, athletics: 14, athleticsDC: 24, size: 4, reach: 10 });
  const actions = [{ ...action, gullet }];
  return creature("worm", "hostile", 5, { size: 4, actions, gullet: gulletsOf(actions), escapeDC: 24, ...over });
};
function fight(list, seed = 3) {
  const run = beginRun(prepareBattle({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: true, maxRounds: 6, aftermath: "none" } }, pf2eRules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
/** The worm with the hero grabbed and then swallowed (its check made). */
function swallowed(over = {}) {
  const run = fight([creature("hero", "friendly", 0, over), worm()]);
  const hero = run.byId.get("hero");
  const w = run.byId.get("worm");
  hero.grabbedBy = "worm";
  run.rng.d20 = () => 15;
  strikeOutOfTurn(run, w, w.spec.actions[0], hero);
  return { run, hero, w };
}

describe("reading the ability's line", () => {
  test("Swallow Whole: its Athletics against the Reflex DC (an attack), a creature of the listed size or smaller, the damage, Rupture", () => {
    const { action, gullet } = gulletAction({ id: "w.s", name: "Swallow Whole", slug: "swallow-whole", html: SWALLOW, traits: ["attack"], actions: 1, athletics: 14, athleticsDC: 24, size: 4, reach: 10 });
    expect(action).toMatchObject({ kind: "control", cost: 1, maneuver: "swallow", swallow: true, melee: true, reach: 10, maxSize: 4, check: { mod: 14, against: "reflex", attack: true } });
    expect(action.onHit.slice(0, 2)).toEqual([null, null]);
    expect(action.onHit[2]).toMatchObject({ conditions: { swallowed: 1 }, escape: { key: "swallowed", dc: 24, others: null }, damage: [{ dice: [{ n: 2, faces: 8 }], flat: 5, type: "bludgeoning" }] });
    expect(action.onHit[2].label).toBeTruthy();
    expect(gullet).toMatchObject({ key: "swallowed", damage: [{ dice: [{ n: 2, faces: 8 }], flat: 5, type: "bludgeoning" }], rupture: 20, most: 4 });
  });

  test("Engulf: a Reflex save against the listed DC from double its Speed off, a creature its size or smaller, Escape against the listed DC", () => {
    const { action, gullet } = gulletAction({ id: "o.e", name: "Engulf", slug: "engulf", html: ENGULF, actions: 2, athletics: 10, athleticsDC: 20, size: 3, speed: 20 });
    expect(action).toMatchObject({ kind: "control", cost: 2, maneuver: "engulf", engulf: true, maxSize: 3, range: { max: 40 }, save: { type: "reflex", dc: 22, basic: false } });
    expect(action.onSave[0]).toBe(action.onSave[1]);
    expect(action.onSave[1]).toMatchObject({ conditions: { engulfed: 1 }, escape: { key: "engulfed", dc: 21 }, damage: [{ dice: [{ n: 4, faces: 6 }], type: "acid" }] });
    expect(action.onSave.slice(2)).toEqual([null, null]);
    expect(gullet).toMatchObject({ key: "engulfed", rupture: 15 });
    // (No Escape DC listed: its Athletics DC.)
    expect(gulletAction({ id: "o.e", name: "Engulf", slug: "engulf", html: ENGULF.replace(/\[\[[^\]]*\]\], /, ""), athleticsDC: 20 }).action.onSave[0].escape.dc).toBe(20);
  });

  test("any other ability, or a Swallow Whole with no Athletics to roll: nothing", () => {
    expect(gulletAction({ id: "x", name: "Trample", slug: "trample", html: SWALLOW, athletics: 5 })).toBeNull();
    expect(gulletAction({ id: "x", name: "Swallow Whole", slug: "swallow-whole", html: SWALLOW })).toBeNull();
  });

  test("light enough to fight from inside: unarmed, a creature's own attack, a weapon of light Bulk", () => {
    expect(lightStrike({ type: "melee" })).toBe(true);
    expect(lightStrike({ category: "unarmed" })).toBe(true);
    expect(lightStrike({ type: "weapon", category: "simple", system: { bulk: { value: 0.1 } } })).toBe(true);
    expect(lightStrike({ type: "weapon", category: "martial", system: { bulk: { value: 1 } } })).toBe(false);
    expect(lightStrike(null)).toBe(false);
  });

  test("the chance dice come to a number, exactly", () => {
    expect(chanceAtLeast([parseFormula("1d6", "slashing")], 4)).toBeCloseTo(0.5);
    expect(chanceAtLeast([parseFormula("2d6", "slashing")], 7)).toBeCloseTo(21 / 36);
    expect(chanceAtLeast([parseFormula("1d4+4", "piercing")], 8)).toBeCloseTo(0.25);
    expect(chanceAtLeast([parseFormula("1d4+4", "piercing")], 16, 2)).toBeCloseTo(0.25);
    expect(chanceAtLeast([parseFormula("1d4", "piercing")], 9)).toBe(0);
  });
});

describe("swallowed", () => {
  test("only one it has grabbed, and not one it holds inside already", () => {
    const run = fight([creature("hero", "friendly", 0), worm()]);
    const [hero, w] = ["hero", "worm"].map(id => run.byId.get(id));
    const swallow = w.spec.actions[0];
    expect(pf2eRules.usable(run, w, swallow, hero)).toBe(false);
    hero.grabbedBy = "worm";
    expect(pf2eRules.usable(run, w, swallow, hero)).toBe(true);
    // (Too big for it: the rules' size check.)
    expect(pf2eRules.isImmune({ spec: { size: 5, iwr: {} } }, swallow)).toBe(true);
  });

  test("swallowed: the listed damage at once, held inside, slowed 1, its swallower's only foe, and off-guard to it", () => {
    const { run, hero, w } = swallowed();
    expect(hero.conds.swallowed).toBe(1);
    expect(holderId(hero)).toBe("worm");
    expect(hero.hp).toBeLessThan(300);
    expect(pf2eRules.modifiers.actionsLost(hero)).toBe(1);
    const other = { id: "orc", conds: {}, effects: [] };
    // (From inside, PF2e's: only its swallower. Nothing outside reaches in: the core's.)
    expect([pf2eRules.canTarget(run, hero, w), pf2eRules.canTarget(run, hero, other)]).toEqual([true, false]);
    expect([cutOff(run, w, hero), cutOff(run, other, hero), cutOff(run, hero, w)]).toEqual([true, true, false]);
    expect(pf2eRules.modifiers.exposed({ target: w, attacker: hero, conds: {} })).toBe(true);
    // (From inside, only light weapons: the dagger, not the maul.)
    expect(pf2eRules.usable(run, hero, hero.spec.actions[0], w)).toBe(true);
    expect(pf2eRules.usable(run, hero, hero.spec.actions[1], w)).toBe(false);
  });

  test("the jaws let go of it as it's swallowed (the core's); the damage again at the end of each of its turns", () => {
    const { run, hero } = swallowed();
    expect(hero.grabbedBy).toBeNull();
    expect(hero.conds.grabbed ?? 0).toBe(0);
    expect(holdsOf(run, hero)).toEqual([expect.objectContaining({ key: "swallowed", byId: "worm", dc: 24, others: null })]);
    expect(pf2eRules.conditionHarm("swallowed", 1, hero, run.byId.get("worm"))).toMatchObject([{ dice: [{ n: 2, faces: 8 }], flat: 5, type: "bludgeoning" }]);
    expect(pf2eRules.conditionHarm("swallowed", 1, hero, { spec: {} })).toBeUndefined();
    const before = hero.hp;
    endOfTurn(run, hero);
    expect(run.log.filter(e => e.type === "persistent" && e.condition === "swallowed").length).toBe(1);
    expect(hero.hp).toBeLessThan(before);
  });

  test("out by Escaping, against its swallower's Athletics DC", () => {
    const { run, hero } = swallowed({ escapeWork: { mod: 30 } });
    turnUpkeep(run, hero);
    const [hold] = holdsOf(run, hero);
    run.rng.d20 = () => 10;
    const got = tryHold(run, hero, hold);
    expect(got).toMatchObject({ success: true, dc: 24 });
    release(run, hero, hold);
    expect(hero.conds.swallowed).toBeUndefined();
    expect(holderId(hero)).toBeNull();
  });

  test("or by cutting itself free, where that's likelier: piercing or slashing of the Rupture value or more from one blow", () => {
    // (Its dagger's 1d4+4 can't make Rupture 20, not even doubled on a critical hit: an Escape, however poor.)
    const { run, hero } = swallowed({ escapeWork: { mod: 0 } });
    turnUpkeep(run, hero);
    const [hold] = holdsOf(run, hero);
    expect(cuttingStrike(hero)).toMatchObject({ strike: { id: "dagger" } });
    run.rng.d20 = () => 19;
    run.rng.die = n => n;
    expect(tryHold(run, hero, hold)).toMatchObject({ success: false, degree: 1, dc: 24 });
    // (A light blade with 2d12+4 slashing makes 20 well enough: at the worm's AC, off-guard, 16.)
    hero.spec.actions[0] = { ...dagger(), damage: [parseFormula("2d12+4", "slashing")] };
    run.rng.d20 = () => 10;
    const got = tryHold(run, hero, hold);
    expect(got).toMatchObject({ success: true, degree: 2, dc: 16, total: 22 });
    expect(got.said.text).toBeTruthy();
    run.rng.die = () => 1;
    expect(tryHold(run, hero, hold)).toMatchObject({ success: false, degree: 2 });
    // (Nothing to cut with: an Escape.)
    expect(pf2eRules.cutFree(run, { spec: { actions: [maul()] }, conds: {} }, hold)).toBeNull();
  });

  test("cutting at it hurts the swallower, out or not (harm, dealt by the core)", () => {
    const { run, hero, w } = swallowed({ escapeWork: { mod: 0 } });
    hero.spec.actions[0] = { ...dagger(), damage: [parseFormula("2d12+4", "slashing")] };
    const [hold] = holdsOf(run, hero);
    run.rng.d20 = () => 10;
    run.rng.die = n => n;
    const got = pf2eRules.cutFree(run, hero, hold);
    expect(got).toMatchObject({ success: true, harm: { byType: { slashing: 28 } } });
    // (In the engine, its turn: out, and the worm the worse for it.)
    const again = swallowed({ escapeWork: { mod: 0 } });
    again.hero.spec.actions[0] = { ...dagger(), damage: [parseFormula("2d12+4", "slashing")] };
    again.run.rng.d20 = () => 10;
    again.run.rng.die = n => n;
    const hp = again.w.hp;
    takeTurn(again.run, again.hero);
    expect(again.hero.conds.swallowed ?? 0).toBe(0);
    expect(again.w.hp).toBeLessThan(hp);
  });

  test("any blow from inside of the Rupture value or more cuts it out (afterHarm, told who struck and with what)", () => {
    const { run, hero, w } = swallowed();
    expect(pf2eRules.afterHarm(run, w, 12, run.rng, { by: hero, byType: { piercing: 12 }, action: dagger() })).toBeNull();
    expect(hero.conds.swallowed).toBe(1);
    expect(pf2eRules.afterHarm(run, w, 20, run.rng, { by: hero, byType: { slashing: 20 }, action: dagger(), lingering: true })).toBeNull();
    const said = pf2eRules.afterHarm(run, w, 25, run.rng, { by: hero, byType: { slashing: 25 }, action: dagger() });
    expect(said?.text).toBeTruthy();
    expect(hero.conds.swallowed ?? 0).toBe(0);
  });

  test("its swallower killed, the corpse has to be cut open: three actions of a friend beside it with a blade; no more damage from it", () => {
    const run = fight([creature("hero", "friendly", 0), worm({ diesAtZero: true }), creature("friend", "friendly", 10)]);
    const [hero, w, friend] = ["hero", "worm", "friend"].map(id => run.byId.get(id));
    hero.grabbedBy = "worm";
    run.rng.d20 = () => 15;
    strikeOutOfTurn(run, w, w.spec.actions[0], hero);
    expect(hero.conds.swallowed).toBe(1);
    w.hp = 1;
    strikeOutOfTurn(run, friend, friend.spec.actions[1], w);
    expect(w.status).toBe("dead");
    expect(hero.conds.swallowed).toBe(1);
    const hold = freeable(run, hero);
    expect(hold).toMatchObject({ key: "swallowed", others: "untie" });
    expect(untieCost(pf2eRules, friend, hero, hold)).toEqual({ actions: 3 });
    expect(untieCost(pf2eRules, { spec: { actions: [maul()] } }, hero, hold)).toEqual({ actions: Infinity });
    expect(pf2eRules.conditionHarm("swallowed", 1, hero, w)).toEqual([]);
    // (An ooze just lets go.)
    expect(pf2eRules.letGo(run, hero, "engulfed", w)).toBeUndefined();
  });

  test("once it holds one of the largest size it lists, no more", () => {
    const { run, hero, w } = swallowed();
    expect(full(run, w)).toBe(false);
    hero.spec.size = 4;
    expect(full(run, w)).toBe(true);
    const next = { id: "elf", grabbedBy: "worm", conds: {}, effects: [], spec: { size: 2 } };
    expect(pf2eRules.usable(run, w, w.spec.actions[0], next)).toBe(false);
  });
});

describe("engulfed", () => {
  test("a failed save engulfs it: the damage at once, and Escape against the listed DC", () => {
    const { action, gullet } = gulletAction({ id: "ooze.engulf", name: "Engulf", slug: "engulf", html: ENGULF, actions: 2, athletics: 10, athleticsDC: 20, size: 3, speed: 20 });
    const actions = [{ ...action, gullet }];
    const run = fight([creature("hero", "friendly", 0, { escapeWork: { mod: 5 } }), creature("ooze", "hostile", 30, { size: 3, actions, gullet: gulletsOf(actions) })]);
    const [hero, ooze] = ["hero", "ooze"].map(id => run.byId.get(id));
    run.rng.d20 = () => 2;
    strikeOutOfTurn(run, ooze, action, hero);
    expect(hero.conds.engulfed).toBe(1);
    expect(hero.hp).toBeLessThan(300);
    expect(holdsOf(run, hero)).toEqual([expect.objectContaining({ key: "engulfed", dc: 21 })]);
    expect(pf2eRules.conditionHarm("engulfed", 1, hero, ooze)).toMatchObject([{ dice: [{ n: 4, faces: 6 }], type: "acid" }]);
  });
});

describe("in a fight", () => {
  test("a worm with a creature in its jaws swallows it on its turn", () => {
    const run = fight([creature("hero", "friendly", 0), worm()]);
    const [hero, w] = ["hero", "worm"].map(id => run.byId.get(id));
    hero.grabbedBy = "worm";
    run.rng.d20 = () => 15;
    turnUpkeep(run, w);
    takeTurn(run, w);
    expect(run.log.find(e => e.actorId === "worm" && e.type === "control")).toMatchObject({ maneuver: "swallow", targetId: "hero", degree: 3 });
    expect(hero.conds.swallowed).toBe(1);
  });
});
