/**
 * Hide and Take Cover (the adapter's coverActions, the rules' usable, defense and afterRoll), now that the core tells the
 * cover a creature has from the walls (coverOf): Take Cover makes standard cover greater (+4), and prone it's greater
 * against ranged attacks, until it moves or attacks; Hide needs cover from every foe that sees it (or concealment), and
 * hidden, each attack at it needs a DC 11 flat check, and its own next attack finds its foe off guard; then it's seen.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle } from "../../fast-fighting/scripts/engine/simulator.js";
import { applyOutcome } from "../../fast-fighting/scripts/engine/behavior/effects.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { coverActions } from "../scripts/adapter.js";

const blade = () => ({ id: "blade", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, hands: 1, damage: [parseFormula("1d8+4", "slashing")] });
const bow = { melee: false, range: { increment: 60 } };
const unit = (id, side, x, over = {}) => ({
  id, name: id, side, kind: "npc", level: 1, hp: { value: 30, max: 30 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [blade()], iwr: {}, flags: { fearless: true }, diesAtZero: true, perception: 5, position: { x, y: 0, size: 5 }, ...over
});
/** The hero at 0 and the orc 30 feet off, with a wall between them hiding two of the hero's points ("some"), or three ("most"). */
function fight(wall = "some", more = []) {
  const walls = { some: [{ a: [5, 1], b: [5, 10], s: 20 }], most: [{ a: [5, -1], b: [5, 10], s: 20 }], none: [] }[wall];
  const spec = { combatants: [unit("hero", "friendly", 0, { size: 2 }), unit("orc", "hostile", 30), ...more], sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } },
    walls, options: { positioning: true, maxRounds: 4, aftermath: "none" } };
  const run = beginRun(prepareBattle(spec, pf2eRules), 1, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
const get = (run, ...ids) => ids.map(id => run.byId.get(id));
const ac = (t, a, cover, action = blade()) => pf2eRules.modifiers.defense({ target: t, attacker: a, action, cover, grabbed: false, flanked: false, exposedTo: false });
const [hide, takeCover] = coverActions({ actorId: "hero", stealth: { mod: 8, label: "Stealth" } });

describe("the actions", () => {
  test("Hide (Stealth against the foes' best Perception DC: hidden) and Take Cover (taking cover), one action each, for any creature but a hazard", () => {
    expect(hide).toMatchObject({ id: "hero.hide", kind: "buff", targets: "self", cost: 1, maneuver: "hide", hide: true, leans: ["lowProfile"], check: { mod: 8, against: "perception" } });
    expect(hide.onDegree.slice(0, 2)).toEqual([null, null]);
    expect(hide.onDegree[2]).toMatchObject({ conditions: { hidden: 1 }, rounds: 1 });
    expect(takeCover).toMatchObject({ id: "hero.take-cover", kind: "buff", targets: "self", cost: 1, maneuver: "takeCover", takeCover: true, outcome: { conditions: { inCover: 1 } } });
    expect([hide.name, takeCover.name, hide.onDegree[2].label]).toEqual([expect.any(String), expect.any(String), expect.any(String)]);
    expect(coverActions({ actorId: "trap", hazard: true, stealth: { mod: 10 } })).toEqual([]);
    expect(coverActions({ actorId: "x" }).map(a => a.maneuver)).toEqual(["takeCover"]);
  });
});

describe("Take Cover", () => {
  test("only with standard cover from a foe to make greater, or prone", () => {
    expect(pf2eRules.usable(fight("some"), fight("some").byId.get("hero"), takeCover)).toBe(true);
    const run = fight("none");
    const [hero] = get(run, "hero");
    expect(pf2eRules.usable(run, hero, takeCover)).toBe(false);
    hero.prone = true;
    expect(pf2eRules.usable(run, hero, takeCover)).toBe(true);
    // (Greater cover already: nothing to gain.)
    expect(pf2eRules.usable(fight("most"), fight("most").byId.get("hero"), takeCover)).toBe(false);
  });

  test("standard cover made greater (+4 to AC and Reflex); prone, greater against a ranged attack; until it moves or attacks", () => {
    const run = fight("some");
    const [hero, orc] = get(run, "hero", "orc");
    expect(ac(hero, orc, "some")).toBe(2);
    applyOutcome(hero, takeCover.outcome, hero.id, takeCover);
    pf2eRules.onOutcome(run, hero, hero, takeCover.outcome);
    expect(ac(hero, orc, "some")).toBe(4);
    expect(pf2eRules.modifiers.save({ unit: hero, type: "reflex", cover: "some" }).bonus).toBe(4);
    // (Moved from its space: no more.)
    hero.pos = { x: -5, y: 0 };
    expect(ac(hero, orc, "some")).toBe(2);
    hero.pos = { x: 0, y: 0 };
    // (Prone, with no cover from the walls: greater against a bow, not a blade.)
    hero.prone = true;
    expect(ac(hero, orc, "none", bow) - ac(hero, orc, "none")).toBe(4);
    // (An attack ends it.)
    pf2eRules.afterRoll(run, hero, { degree: 2 }, { kind: "attack", target: orc, action: blade() });
    expect(hero.conds.inCover).toBeUndefined();
  });
});

describe("Hide", () => {
  test("only with cover from every foe that can see it, or concealed", () => {
    expect(pf2eRules.usable(fight("some"), fight("some").byId.get("hero"), hide)).toBe(true);
    const run = fight("none");
    const [hero] = get(run, "hero");
    expect(pf2eRules.usable(run, hero, hide)).toBe(false);
    hero.conds.concealed = 1;
    expect(pf2eRules.usable(run, hero, hide)).toBe(true);
    // (A second foe it has no cover from sees it plainly.)
    const two = fight("some", [unit("gob", "hostile", 0, { position: { x: 0, y: -30, size: 5 } })]);
    expect(pf2eRules.usable(two, two.byId.get("hero"), hide)).toBe(false);
  });

  test("hidden: a DC 11 flat check for each attack at it; its own attack finds the foe off guard, that once, and gives it away", () => {
    const run = fight("some");
    const [hero, orc] = get(run, "hero", "orc");
    applyOutcome(hero, hide.onDegree[2], hero.id, hide);
    const hit = { natural: 15, total: 24, degree: 2 };
    expect(pf2eRules.adjustRoll({ rng: { d20: () => 10 } }, orc, hit, { kind: "attack", target: hero, action: blade() }).degree).toBe(1);
    // (Its Strike at the orc: off guard to it, through the damage, then seen: the core's afterAttack.)
    const strike = { target: orc, attacker: hero, action: blade(), grabbed: false, flanked: false, exposedTo: false };
    pf2eRules.modifiers.attack({ ...strike, distance: 5, positioning: true });
    expect(pf2eRules.modifiers.exposed(strike)).toBe(true);
    pf2eRules.afterRoll(run, hero, hit, { kind: "attack", target: orc, action: blade() });
    expect(hero.conds.hidden).toBe(1);
    expect(pf2eRules.modifiers.exposed(strike)).toBe(true);
    pf2eRules.afterAttack(run, hero, orc, { action: blade(), degree: 2, dealt: 5 });
    expect(hero.conds.hidden).toBeUndefined();
    // (Its next attack: the orc sees it now.)
    pf2eRules.modifiers.attack({ ...strike, distance: 5, positioning: true });
    expect(pf2eRules.modifiers.exposed(strike)).toBe(false);
    expect(pf2eRules.adjustRoll({ rng: { d20: () => 1 } }, orc, hit, { kind: "attack", target: hero, action: blade() })).toBe(hit);
  });

  test("a save doesn't give it away; anything else it rolls does", () => {
    const run = fight("some");
    const [hero] = get(run, "hero");
    applyOutcome(hero, hide.onDegree[2], hero.id, hide);
    pf2eRules.afterRoll(run, hero, { degree: 2 }, { kind: "save" });
    expect(hero.conds.hidden).toBe(1);
    pf2eRules.afterRoll(run, hero, { degree: 2 }, { kind: "check", control: true });
    expect(hero.conds.hidden).toBeUndefined();
  });

  test("weighed: hidden as harder to hit and a foe off guard, taking cover as 2 more to its defense", () => {
    expect(pf2eRules.conditionMods("hidden")).toEqual({ ac: 4, attack: 1 });
    expect(pf2eRules.conditionMods("inCover")).toEqual({ ac: 2 });
  });
});
