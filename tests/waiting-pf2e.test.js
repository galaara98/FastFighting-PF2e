/**
 * Delay and Ready, PF2e's (rules.js delay, ready; core API 33): a creature that would waste its turn Delays until a
 * foe comes to it, or spends two actions to Ready a Strike, a reaction at the first foe that comes within its reach,
 * with the multiple attack penalty it had when it readied. No reactions while it's delayed; a minion has none to ready
 * with.
 */
import { describe, expect, test } from "vitest";
import { replay, prepareBattle, beginRun, playTurn, answerMove } from "../../fast-fighting/scripts/engine/simulator.js";
import { turnFor } from "../../fast-fighting/scripts/engine/battle-state.js";
import { readyStep, takeReady } from "../../fast-fighting/scripts/engine/behavior/waiting.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const strike = (over = {}) => ({ id: over.id ?? "s", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, damage: [parseFormula("1d8+4", "slashing")], ...over });
const creature = over => ({
  side: "friendly", kind: "npc", level: 1, hp: { value: 300, max: 300 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [strike()], iwr: {}, flags: {}, diesAtZero: true,
  traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  ...over
});
const battle = (list, options = {}) => ({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: true, maxRounds: 2, ...options } });

/** A fighter 60 feet from a foe that acts after it. */
const apart = (hero = {}) => battle([
  creature({ id: "hero", name: "Hero", position: at(0), initiative: { mod: 100 }, ...hero }),
  creature({ id: "brute", name: "Brute", side: "hostile", position: at(60), initiative: { mod: -100 } })
]);

describe("PF2e: Delay and Ready", () => {
  test("the rules: Delay with no reactions while delayed; Ready two actions, a Strike of one", () => {
    expect(pf2eRules.delay).toEqual({ reactions: false });
    expect(pf2eRules.ready).toEqual({ cost: { actions: 2 }, most: 1 });
  });

  test("one out of reach Delays until the foe coming at it has moved, then has its three actions for blows", () => {
    const r = replay(apart(), pf2eRules, 2);
    const delay = r.log.find(e => e.type === "delay");
    expect(delay).toMatchObject({ actorId: "hero", why: "reach", afterId: "brute" });
    const came = r.log.findIndex(e => e.actorId === "brute" && e.type === "move");
    expect(came).toBeGreaterThan(r.log.indexOf(delay));
    const blows = r.log.filter((e, i) => i > came && e.actorId === "hero" && e.type === "attack" && e.turn === r.log.find((x, j) => j > came && x.actorId === "hero").turn);
    expect(blows.length).toBeGreaterThanOrEqual(2);
  });

  test("delayed, it has no reaction until it's back", () => {
    const run = beginRun(prepareBattle(apart(), pf2eRules), 2, { log: true });
    run.round = 1;
    const hero = run.byId.get("hero");
    playTurn(run, hero);
    expect(hero.delayed).toBeTruthy();
    expect(hero.reactionsLeft).toBe(0);
  });

  test("Ready: two actions; the readied Strike as a reaction, at the penalty it had when it readied", () => {
    const run = beginRun(prepareBattle(apart({ position: at(0), conditions: { immobilized: 1 } }), pf2eRules), 2, { log: true });
    run.round = 1;
    const hero = run.byId.get("hero");
    const brute = run.byId.get("brute");
    brute.pos.x = 30;
    const turn = turnFor(run, hero);
    turn.spend({ actions: 1 }); // (a Strike made already: MAP −5)
    const step = readyStep(run, hero, turn, { attacks: 1 });
    expect(step).toMatchObject({ step: "ready", cost: { actions: 2 }, attacks: 1 });
    takeReady(run, hero, turn, step, (u, e) => run.log.push({ ...e, actorId: u.id }));
    expect(turn.left).toBe(0);
    const from = { ...brute.pos };
    brute.pos.x = 5;
    answerMove(run, brute, { feet: 25, from, to: { ...brute.pos } });
    expect(run.log.find(e => e.type === "readied")).toMatchObject({ actorId: "hero", targetId: "brute" });
    expect(run.log.find(e => e.type === "attack" && e.actorId === "hero")).toMatchObject({ mod: 4 });
  });

  test("a minion has no reaction to ready with", () => {
    const pet = creature({ id: "pet", name: "Pet", position: at(0), creatureTraits: ["minion"], conditions: { immobilized: 1 } });
    const run = beginRun(prepareBattle(battle([pet, creature({ id: "brute", side: "hostile", position: at(30) })]), pf2eRules), 2, { log: true });
    const u = run.byId.get("pet");
    expect(readyStep(run, u, turnFor(run, u))).toBe(null);
  });
});
