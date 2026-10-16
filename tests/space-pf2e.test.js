/**
 * Getting past another creature in PF2e (the rules the core asks of it: behavior/space.js): through a friend's space
 * and one that's down, freely; a foe on its feet, Tumble Through for one trained in Acrobatics with even odds or better
 * against its Reflex DC, round it otherwise; a bystander, the core's way. Tumbling: Acrobatics against the foe's
 * Reflex DC, less what frightens, sickens or makes clumsy either; failed, the move stops short of it.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, takeTurn } from "../../fast-fighting/scripts/engine/simulator.js";
import { moveToward, edgeDistance } from "../../fast-fighting/scripts/engine/battle-state.js";
import { parseFormula, STATUS } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { acrobaticsOf } from "../scripts/adapter.js";

const minded = { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const blade = () => ({ id: "blade", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, hands: 1, damage: [parseFormula("1d8+4", "slashing")] });
const unit = (id, side, x, over = {}) => ({
  id, name: id, side, kind: "npc", level: 1, hp: { value: 60, max: 60 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [blade()], iwr: {}, flags: {}, diesAtZero: true, traits: minded, position: { x, y: 0, size: 5 }, ...over
});
/** A fight on a map, a round in, with PF2e's rules. */
function fight(list, seed = 2) {
  const spec = { combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: true, maxRounds: 4, aftermath: "none" } };
  const run = beginRun(prepareBattle(spec, pf2eRules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
const get = (run, ...ids) => ids.map(id => run.byId.get(id));
/** The hero (trained in Acrobatics, +12 unless said), the orc in its way at 15, and the one it's after at 30. */
const line = (acrobatics = { mod: 12 }) => fight([unit("hero", "friendly", 0, { acrobatics }), unit("orc", "hostile", 15), unit("target", "hostile", 30)]);
/** Just enough of a fight to roll one tumble, with the d20 showing `natural`. */
const table = natural => ({ prep: { rules: pf2eRules }, rng: { d20: () => natural } });
const mover = (mod, conds = {}) => ({ spec: { acrobatics: { mod } }, conds });
const foe = (reflex, conds = {}) => ({ spec: { defenses: { reflex } }, conds });

describe("how it gets past", () => {
  test("a friend's space, freely; a foe on its feet, tumbling for the trained, round it for the rest", () => {
    const run = fight([unit("hero", "friendly", 0, { acrobatics: { mod: 12 } }), unit("ally", "friendly", 10), unit("orc", "hostile", 15), unit("kobold", "hostile", 25)]);
    const [hero, ally, orc, kobold] = get(run, "hero", "ally", "orc", "kobold");
    expect(pf2eRules.passThrough(run, hero, ally)).toBe("free");
    expect(pf2eRules.passThrough(run, hero, orc)).toBe("tumble");
    // (Untrained: round it. The other side's the same: past a friend freely, round the hero.)
    expect(pf2eRules.passThrough(run, ally, orc)).toBe("around");
    expect(pf2eRules.passThrough(run, orc, kobold)).toBe("free");
    expect(pf2eRules.passThrough(run, orc, hero)).toBe("around");
  });

  test("tumbling only with even odds or better: a 10 on the die must do against its Reflex DC", () => {
    const run = fight([unit("hero", "friendly", 0, { acrobatics: { mod: 7 } }), unit("orc", "hostile", 15), unit("ogre", "hostile", 25, { defenses: { ac: 18, fortitude: 12, reflex: 8, will: 6 } })]);
    const [hero, orc, ogre] = get(run, "hero", "orc", "ogre");
    // (+7 against DC 17: a 10 makes it. Against DC 18, not.)
    expect(pf2eRules.passThrough(run, hero, orc)).toBe("tumble");
    expect(pf2eRules.passThrough(run, hero, ogre)).toBe("around");
    // (Frightened 1, it's -1 to its check: no longer even against the orc.)
    hero.conds.frightened = 1;
    expect(pf2eRules.passThrough(run, hero, orc)).toBe("around");
  });

  test("one that's down: freely; a bystander: the core's way", () => {
    const run = fight([unit("hero", "friendly", 0, { acrobatics: { mod: 12 } }), unit("orc", "hostile", 15), unit("miller", "hostile", 25)]);
    const [hero, orc, miller] = get(run, "hero", "orc", "miller");
    orc.status = STATUS.DOWN;
    expect(pf2eRules.passThrough(run, hero, orc)).toBe("free");
    miller.side = "neutralParty";
    expect(pf2eRules.passThrough(run, hero, miller)).toBeNull();
  });
});

describe("Tumble Through", () => {
  test("Acrobatics against the foe's Reflex DC (10 + its Reflex): through on a success, not on a failure", () => {
    expect(pf2eRules.tumbleThrough(table(10), mover(7), foe(7))).toEqual({ success: true, degree: 2, natural: 10, mod: 7, total: 17, dc: 17 });
    expect(pf2eRules.tumbleThrough(table(9), mover(7), foe(7))).toMatchObject({ success: false, degree: 1, total: 16 });
    // (A natural 1: one degree worse, the 17 it makes a failure.)
    expect(pf2eRules.tumbleThrough(table(1), mover(16), foe(7))).toMatchObject({ success: false, degree: 1, total: 17 });
  });

  test("less what frightens or sickens it, and its clumsiness; the foe's the same off its DC", () => {
    expect(pf2eRules.tumbleThrough(table(10), mover(7, { frightened: 2, sickened: 1, clumsy: 1 }), foe(7))).toMatchObject({ mod: 4, total: 14, dc: 17 });
    expect(pf2eRules.tumbleThrough(table(10), mover(7), foe(7, { sickened: 1, clumsy: 2 }))).toMatchObject({ dc: 14, success: true });
  });
});

describe("its Acrobatics, from its sheet", () => {
  test("for the trained only: a character's rank, a creature's listed skill", () => {
    const pc = rank => ({ type: "character", skills: { acrobatics: { mod: 9, rank } } });
    expect(acrobaticsOf(pc(1))).toEqual({ mod: 9 });
    expect(acrobaticsOf(pc(0))).toBeUndefined();
    const npc = listed => ({ type: "npc", skills: { acrobatics: { mod: 11 } }, system: { skills: listed ? { acrobatics: { base: 11 } } : {} } });
    expect(acrobaticsOf(npc(true))).toEqual({ mod: 11 });
    expect(acrobaticsOf(npc(false))).toBeUndefined();
    expect(acrobaticsOf({ type: "npc" })).toBeUndefined();
  });
});

describe("in a fight", () => {
  test("trained, it tumbles past the orc in its way to reach the one it's after", () => {
    const run = line();
    const [hero, orc, target] = get(run, "hero", "orc", "target");
    // (+12 against DC 17: a 5 makes it.)
    run.rng.d20 = () => 10;
    const move = moveToward(run, hero, target, 5, 30);
    expect(run.log.find(e => e.type === "tumble")).toMatchObject({ actorId: "hero", targetId: "orc", success: true, natural: 10, mod: 12, total: 22, dc: 17 });
    expect(move.reached).toBe(true);
    expect(hero.pos.x).toBeGreaterThan(orc.pos.x);
    expect(edgeDistance(hero, target)).toBeLessThanOrEqual(5.5);
  });

  test("failed, its move ends short of the orc", () => {
    const run = line();
    const [hero, orc, target] = get(run, "hero", "orc", "target");
    run.rng.d20 = () => 2;
    const move = moveToward(run, hero, target, 5, 30);
    expect(run.log.find(e => e.type === "tumble")).toMatchObject({ targetId: "orc", success: false, total: 14, dc: 17 });
    expect(move.reached).toBe(false);
    expect(hero.pos.x).toBeLessThan(orc.pos.x - 4.5);
    expect(orc.pos.x).toBe(15);
  });

  test("on its turn: past the orc in its way, at the wounded one beyond it", () => {
    const run = fight([unit("hero", "friendly", 0, { acrobatics: { mod: 30 } }), unit("orc", "hostile", 15, { hp: { value: 300, max: 300 }, defenses: { ac: 40, fortitude: 7, reflex: 7, will: 7 } }),
      unit("target", "hostile", 30, { hp: { value: 3, max: 60 } })]);
    takeTurn(run, run.byId.get("hero"));
    const own = run.log.filter(e => e.actorId === "hero");
    const tumble = own.findIndex(e => e.type === "tumble");
    expect(own[tumble]).toMatchObject({ targetId: "orc", success: true });
    expect(own.findIndex(e => e.type === "attack" && e.targetId === "target")).toBeGreaterThan(tumble);
  });

  test("untrained, it goes round: no roll, and the way round takes 5 feet more", () => {
    const run = line(null);
    const [hero, , target] = get(run, "hero", "orc", "target");
    const move = moveToward(run, hero, target, 5, 30);
    expect(run.log.some(e => e.type === "tumble")).toBe(false);
    expect(move.cost).toBe(30);
    expect(move.reached).toBe(true);
  });
});
