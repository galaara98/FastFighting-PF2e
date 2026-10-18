/**
 * PF2e's immunities, weaknesses and resistances in the core engine's fights and estimates (rules.applyIwr with the
 * core's ctx, rules.critImmune, rules.usable for heals), and Feint and Bon Mot as the remaster has them: a sneak attack
 * on one immune to precision, a critical hit on one immune to them, a fireball on one immune to area damage, a silver
 * weapon on one weak to silver, vitality and void on the living and the undead, Feint's one Strike, Bon Mot on Will and
 * Perception only.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, strikeOutOfTurn, tickEffects } from "../../fast-fighting/scripts/engine/simulator.js";
import { saveRoll, defenseDc, checkRoll, currentAc } from "../../fast-fighting/scripts/engine/battle-state.js";
import { applyOutcome } from "../../fast-fighting/scripts/engine/behavior/effects.js";
import { expectedDamage } from "../../fast-fighting/scripts/engine/behavior/evaluate.js";
import { healScores } from "../../fast-fighting/scripts/engine/behavior/healing.js";
import { parseFormula, part } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { skillManeuvers, bonMot } from "../scripts/maneuvers.js";

const strike = (over = {}) => ({ id: over.id ?? "s", name: "Shortsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, damage: [parseFormula("4", "piercing")], ...over });
const creature = over => ({
  side: "friendly", kind: "npc", level: 1, hp: { value: 200, max: 200 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 }, perception: 7,
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [strike()], iwr: {}, flags: { fearless: true }, diesAtZero: true,
  traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  ...over
});
const battle = list => ({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: false } });

function fight(...list) {
  const run = beginRun(prepareBattle(battle(list), pf2eRules), 3, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}

/** u's blows at t, made `times` times out of its turn: the log's attack and save lines. */
function blows(run, u, action, t, times = 12) {
  for ( let i = 0; i < times; i++ ) strikeOutOfTurn(run, u, action, t);
  return run.log.filter(e => ["attack", "save", "auto"].includes(e.type) && e.actorId === u.id && e.targetId === t.id);
}

const zombie = over => creature({ id: "zombie", side: "hostile", voidHealing: true, creatureTraits: ["undead", "zombie", "mindless"], iwr: { immune: ["precision"], weak: { vitality: 5 } }, ...over });

describe("a sneak attack on one immune to precision", () => {
  const knife = strike({ id: "knife", bonusDamage: [{ when: "always", parts: [part([], 6, "piercing", { category: "precision" })] }] });

  test("no sneak attack damage: the blow's own, critical or not", () => {
    const run = fight(creature({ id: "rogue", actions: [knife] }), zombie());
    const hits = blows(run, run.byId.get("rogue"), knife, run.byId.get("zombie")).filter(e => e.degree >= 2);
    expect(hits.length).toBeGreaterThan(0);
    for ( const e of hits ) expect(e.damage).toBe(e.degree === 3 ? 8 : 4);
    // (One not immune: the sneak attack's too.)
    const other = fight(creature({ id: "rogue", actions: [knife] }), creature({ id: "guard", side: "hostile" }));
    for ( const e of blows(other, other.byId.get("rogue"), knife, other.byId.get("guard")).filter(x => x.degree >= 2) ) expect(e.damage).toBe(e.degree === 3 ? 20 : 10);
  });

  test("the Statistics Engine's estimate counts none of it either", () => {
    const run = fight(creature({ id: "rogue", actions: [knife] }), zombie());
    const [rogue, z] = ["rogue", "zombie"].map(id => run.byId.get(id));
    expect(expectedDamage(run, rogue, knife, z)).toBeCloseTo(expectedDamage(run, rogue, strike({ id: "plain" }), z), 6);
  });
});

describe("a critical hit on one immune to critical hits", () => {
  test("a normal hit's damage", () => {
    const maul = strike({ id: "maul", bonus: 60, damage: [parseFormula("5", "bludgeoning")] });
    const run = fight(creature({ id: "brute", actions: [maul] }), creature({ id: "golem", side: "hostile", iwr: { immune: ["critical-hits", "precision"] } }));
    const hits = blows(run, run.byId.get("brute"), maul, run.byId.get("golem"));
    expect(hits.length).toBeGreaterThan(0);
    for ( const e of hits ) {
      expect(e.degree).toBe(3);
      expect(e.damage).toBe(5);
    }
    const other = fight(creature({ id: "brute", actions: [maul] }), creature({ id: "ogre", side: "hostile" }));
    for ( const e of blows(other, other.byId.get("brute"), maul, other.byId.get("ogre")) ) expect(e.damage).toBe(10);
  });
});

describe("a fireball on one immune to area damage", () => {
  const fireball = { id: "fireball", name: "Fireball", kind: "save", cost: 2, rank: 3, spellId: "fb", traits: ["fire", "manipulate", "concentrate"], damage: [parseFormula("20", "fire")],
    save: { type: "reflex", dc: 60, basic: true }, area: { targets: 4, shape: "burst", feet: 20 }, range: { increment: 500, max: 500, noPenalty: true } };

  test("none of it; a swarm weak to area damage, more; a single target's fire, as it is", () => {
    const run = fight(creature({ id: "mage", actions: [fireball] }), creature({ id: "elemental", side: "hostile", iwr: { immune: ["area-damage"] } }));
    const hits = blows(run, run.byId.get("mage"), fireball, run.byId.get("elemental"), 3);
    expect(hits.length).toBe(3);
    for ( const e of hits ) expect(e.damage).toBe(0);
    expect(run.byId.get("elemental").hp).toBe(200);
    const swarm = fight(creature({ id: "mage", actions: [fireball] }), creature({ id: "rats", side: "hostile", iwr: { weak: { "area-damage": 5 } } }));
    // (DC 60: a critical failure, double.)
    for ( const e of blows(swarm, swarm.byId.get("mage"), fireball, swarm.byId.get("rats"), 2) ) expect(e.damage).toBe(45);
    const ray = { ...fireball, id: "ray", area: null };
    const single = fight(creature({ id: "mage", actions: [ray] }), creature({ id: "elemental", side: "hostile", iwr: { immune: ["area-damage"] } }));
    for ( const e of blows(single, single.byId.get("mage"), ray, single.byId.get("elemental"), 2) ) expect(e.damage).toBe(40);
  });
});

describe("a silver weapon on one weak to silver", () => {
  test("its weakness; a plain weapon, none", () => {
    const silver = strike({ id: "silver", materials: ["silver"] });
    const werewolf = () => creature({ id: "werewolf", side: "hostile", iwr: { weak: { silver: 5 } } });
    const run = fight(creature({ id: "hunter", actions: [silver] }), werewolf());
    const hits = blows(run, run.byId.get("hunter"), silver, run.byId.get("werewolf")).filter(e => e.degree >= 2);
    expect(hits.length).toBeGreaterThan(0);
    for ( const e of hits ) expect(e.damage).toBe(e.degree === 3 ? 13 : 9);
    const plain = strike({ id: "plain" });
    const other = fight(creature({ id: "hunter", actions: [plain] }), werewolf());
    for ( const e of blows(other, other.byId.get("hunter"), plain, other.byId.get("werewolf")).filter(x => x.degree >= 2) ) expect(e.damage).toBe(e.degree === 3 ? 8 : 4);
    const [h, w] = ["hunter", "werewolf"].map(id => run.byId.get(id));
    expect(expectedDamage(run, h, silver, w)).toBeGreaterThan(expectedDamage(run, h, plain, w) + 3);
  });
});

describe("vitality and void", () => {
  const touch = type => ({ id: `touch-${type}`, name: "Touch", kind: "auto", cost: 1, melee: true, reach: 5, rank: 1, spellId: type, traits: [type], damage: [parseFormula("10", type)] });

  test("vitality leaves a living foe untouched, and hurts a zombie, its weakness too", () => {
    const run = fight(creature({ id: "cleric", actions: [touch("vitality")] }), creature({ id: "bandit", side: "hostile" }), zombie());
    const [cleric, bandit, z] = ["cleric", "bandit", "zombie"].map(id => run.byId.get(id));
    strikeOutOfTurn(run, cleric, touch("vitality"), bandit);
    strikeOutOfTurn(run, cleric, touch("vitality"), z);
    expect(bandit.hp).toBe(200);
    expect(z.hp).toBe(185);
    // (The Statistics Engine sees it so: nothing to gain against the living.)
    expect(expectedDamage(run, cleric, touch("vitality"), bandit)).toBe(0);
    expect(expectedDamage(run, cleric, touch("vitality"), z)).toBe(15);
  });

  test("void leaves a zombie untouched, and hurts the living", () => {
    const run = fight(creature({ id: "necromancer", actions: [touch("void")] }), creature({ id: "bandit", side: "hostile" }), zombie());
    const [nec, bandit, z] = ["necromancer", "bandit", "zombie"].map(id => run.byId.get(id));
    strikeOutOfTurn(run, nec, touch("void"), z);
    strikeOutOfTurn(run, nec, touch("void"), bandit);
    expect(z.hp).toBe(200);
    expect(bandit.hp).toBe(190);
    expect(expectedDamage(run, nec, touch("void"), z)).toBe(0);
  });

  test("Heal mends the living, not an undead friend; Harm's healing, the undead friend only", () => {
    const healSpell = { id: "heal", name: "Heal", kind: "heal", cost: 2, rank: 1, spellId: "heal", heal: [parseFormula("1d8+8", "healing")], traits: ["healing", "manipulate", "vitality"], range: { increment: 30, max: 30, noPenalty: true } };
    const harmSpell = { ...healSpell, id: "harm.heal", name: "Harm", spellId: "harm", traits: ["manipulate", "void"] };
    const hurt = { value: 20, max: 200 };
    const run = fight(creature({ id: "cleric", actions: [healSpell, harmSpell] }), creature({ id: "fighter", hp: hurt }), zombie({ side: "friendly", hp: hurt }), creature({ id: "foe", side: "hostile" }));
    const cleric = run.byId.get("cleric");
    expect(healScores(run, cleric, [healSpell]).map(x => x.ally.id)).toEqual(["fighter"]);
    expect(healScores(run, cleric, [harmSpell]).map(x => x.ally.id)).toEqual(["zombie"]);
  });
});

describe("Feint: off-guard to the feinter's next melee Strike only, this turn", () => {
  const feintOf = () => Object.fromEntries(skillManeuvers({ actorId: "rogue", maxSize: 3, athletics: null, deception: 9, intimidation: null }).map(a => [a.maneuver, a])).feint;
  const sword = strike({ id: "sword", bonus: -40 }); // (a miss, every time: nothing but the attack itself)
  const bow = strike({ id: "bow", melee: false, reach: undefined, range: { increment: 60, max: 360 } });

  function feinted(degree) {
    const run = fight(creature({ id: "rogue", actions: [sword, bow] }), creature({ id: "foe", side: "hostile" }), creature({ id: "ally" }));
    const [rogue, foe, ally] = ["rogue", "foe", "ally"].map(id => run.byId.get(id));
    run.acting = rogue;
    applyOutcome(foe, feintOf().onHit[degree], rogue.id, feintOf());
    return { run, rogue, foe, ally, ac: foe.spec.defenses.ac };
  }

  test("a success: its next melee Strike finds the foe off-guard; the one after, its ranged ones and a friend's, don't", () => {
    const { run, rogue, foe, ally, ac } = feinted(2);
    expect(currentAc(run, foe, rogue, sword)).toBe(ac - 2);
    expect(currentAc(run, foe, rogue, bow)).toBe(ac);
    expect(currentAc(run, foe, ally, sword)).toBe(ac);
    strikeOutOfTurn(run, rogue, bow, foe);
    expect(currentAc(run, foe, rogue, sword)).toBe(ac - 2);
    strikeOutOfTurn(run, rogue, sword, foe);
    expect(currentAc(run, foe, rogue, sword)).toBe(ac);
  });

  test("a success, no Strike made: gone as the feinter's turn ends", () => {
    const { run, rogue, foe, ac } = feinted(2);
    tickEffects(run, rogue);
    expect(currentAc(run, foe, rogue, sword)).toBe(ac);
  });

  test("a critical success: every melee Strike, through the end of the feinter's next turn", () => {
    const { run, rogue, foe, ac } = feinted(3);
    strikeOutOfTurn(run, rogue, sword, foe);
    strikeOutOfTurn(run, rogue, sword, foe);
    expect(currentAc(run, foe, rogue, sword)).toBe(ac - 2);
    tickEffects(run, rogue);
    expect(currentAc(run, foe, rogue, sword)).toBe(ac - 2);
    tickEffects(run, rogue);
    expect(currentAc(run, foe, rogue, sword)).toBe(ac);
  });
});

describe("Bon Mot: Will saves and Perception only", () => {
  const quip = bonMot({ id: "bard.bon-mot", name: "Bon Mot", diplomacy: 10 });

  function landed(degree) {
    const run = fight(creature({ id: "bard" }), creature({ id: "foe", side: "hostile" }));
    const [bard, foe] = ["bard", "foe"].map(id => run.byId.get(id));
    const rolls = u => ({
      will: saveRoll(run, u, "will").mod, fortitude: saveRoll(run, u, "fortitude").mod, reflex: saveRoll(run, u, "reflex").mod,
      willDc: defenseDc(run, u, "will"), perceptionDc: defenseDc(run, u, "perception"), perception: checkRoll(run, u, 7, null, { skill: "perception" }).mod,
      athletics: checkRoll(run, u, 7, null, { skill: "athletics" }).mod, talk: checkRoll(run, u, 7, null, { purpose: "talk" }).mod
    });
    const before = { bard: rolls(bard), foe: rolls(foe) };
    const outcome = quip.onHit[degree];
    applyOutcome(outcome.self ? bard : foe, outcome, bard.id, quip);
    return { before, after: { bard: rolls(bard), foe: rolls(foe) } };
  }

  test("a success: -2 to the foe's Will saves and DC, its Perception and its Perception DC; nothing else", () => {
    const { before, after } = landed(2);
    expect(after.foe).toEqual({ ...before.foe, will: before.foe.will - 2, willDc: before.foe.willDc - 2, perception: before.foe.perception - 2, perceptionDc: before.foe.perceptionDc - 2 });
    expect(after.bard).toEqual(before.bard);
  });

  test("a critical success, -3; a critical failure, the -2 on the bard", () => {
    const crit = landed(3);
    expect(crit.after.foe.will).toBe(crit.before.foe.will - 3);
    expect(crit.after.foe.fortitude).toBe(crit.before.foe.fortitude);
    const botch = landed(0);
    expect(botch.after.bard.will).toBe(botch.before.bard.will - 2);
    expect(botch.after.bard.reflex).toBe(botch.before.bard.reflex);
    expect(botch.after.foe).toEqual(botch.before.foe);
    expect(quip.check).toEqual({ mod: 10, against: "will" });
  });
});
