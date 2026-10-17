/**
 * Breaking free in PF2e (holds.js, and the rules the core asks of it): Escape with the best of an unarmed attack,
 * Acrobatics or Athletics; against a grabber's Athletics DC, the Thievery DC of whoever tied the knots, or the GM
 * Core's DC for a level; less what frightens it; a critical failure bars another try that turn. A friend unties a
 * prisoner (one action, no roll) but can't Escape for anyone.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../../fast-fighting/scripts/engine/simulator.js";
import { holdsOf, tryHold, release, escapeCost, untieCost, bondsDC } from "../../fast-fighting/scripts/engine/behavior/holds.js";
import { applyOutcome } from "../../fast-fighting/scripts/engine/behavior/effects.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { escapeOf, escapeWork, levelDC, sheetHold } from "../scripts/holds.js";

const minded = { tactical: { base: 60, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const blade = () => ({ id: "blade", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, hands: 1, damage: [parseFormula("1d8+4", "slashing")] });
const creature = (id, side, x, over = {}) => ({
  id, name: id, side, kind: "npc", level: 1, hp: { value: 300, max: 300 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [blade()], iwr: {}, flags: { fearless: true }, diesAtZero: false, traits: minded,
  position: { x, y: 0, size: 5 }, ...over
});
const battle = list => ({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: true, maxRounds: 6 } });

/** A fight on a map, a round in, with PF2e's rules. */
function fight(list, seed = 3) {
  const run = beginRun(prepareBattle(battle(list), pf2eRules), seed, { log: true });
  beginRound(run, 1);
  return run;
}
/** Just enough of a fight to roll one try, with the d20 showing `natural`. */
const table = (natural, units = []) => ({ prep: { rules: pf2eRules }, rng: { d20: () => natural }, byId: new Map(units.map(u => [u.id, u])) });
const unit = (over = {}) => ({ id: "u", spec: { level: 1, escapeWork: { mod: 5 } }, conds: {}, baseConds: {}, turnsTaken: 0, ...over });

describe("a creature's way out, from its sheet", () => {
  test("the best of its unarmed attacks (shown or not), Acrobatics and Athletics; its Athletics and Thievery DCs", () => {
    const fist = { category: "unarmed", system: { traits: { value: ["agile", "finesse", "nonlethal", "unarmed"] } } };
    const actor = {
      system: { actions: [
        { type: "strike", totalModifier: 14, item: { category: "martial", system: { traits: { value: ["sweep"] } } } },
        { type: "strike", totalModifier: 11, visible: false, item: fist }
      ] },
      skills: { acrobatics: { mod: 7 }, athletics: { mod: 9, dc: { value: 19 } }, thievery: { mod: 4 } }
    };
    // (Its longsword's +14 isn't a way out: Escape takes an unarmed attack.)
    expect(escapeOf(actor)).toEqual({ escapeWork: { mod: 11 }, escapeDC: 19, tiesDC: 14 });
    // A creature's jaws (the system makes an attack with the unarmed trait an unarmed one), against its Athletics.
    const wolf = { system: { actions: [{ type: "strike", totalModifier: 9, item: { type: "melee", category: "unarmed", system: { traits: { value: ["unarmed"] } } } }] },
      skills: { acrobatics: { mod: 7 }, athletics: { mod: 6 } } };
    expect(escapeOf(wolf)).toEqual({ escapeWork: { mod: 9 }, escapeDC: 16, tiesDC: undefined });
    expect(escapeOf({ skills: {} })).toEqual({ escapeWork: undefined, escapeDC: undefined, tiesDC: undefined });
  });

  test("escapeWork ignores what isn't a number", () => {
    expect(escapeWork({ unarmed: [3, null, undefined], acrobatics: null, athletics: 8 })).toEqual({ mod: 8 });
    expect(escapeWork({})).toBeNull();
  });
});

describe("the DCs", () => {
  test("the GM Core's DCs by level, below 0 as 0, and on past 25", () => {
    expect([0, 1, 2, 3, 5, 10, 15, 20, 25].map(levelDC)).toEqual([14, 15, 16, 18, 20, 27, 34, 40, 50]);
    expect([levelDC(-1), levelDC(26), levelDC("4")]).toEqual([14, 52, 19]);
  });

  test("a grab or a restraint its sheet shows: an Escape breaks it (and what it brought), at the DC for its level; no friend can", () => {
    expect(sheetHold({ spec: { level: 5 } }, "grabbed")).toEqual({ dc: 20, others: null, with: ["offGuard", "immobilized"] });
    expect(pf2eRules.escapeFrom(null, { spec: { level: 1 } }, "restrained")).toEqual({ dc: 15, others: null, with: ["offGuard", "immobilized"] });
    // (Immobilized and off-guard come with them; on their own the sheet can't say what holds it.)
    for ( const key of ["immobilized", "offGuard", "prone", "frightened"] ) expect(pf2eRules.escapeFrom(null, { spec: { level: 1 } }, key)).toBeNull();
    // (Restrained on a prisoner is its bonds, marked on the sheet: the core's own hold.)
    expect(sheetHold({ spec: { level: 1 }, bound: true, boundBy: "orc" }, "restrained")).toBeNull();
  });

  test("improvised bonds: the DC for the prisoner's level, unless the fight knows who tied them", () => {
    expect(pf2eRules.bondsDC({ spec: { level: 7 } })).toBe(23);
    const run = fight([creature("hero", "friendly", 0), creature("orc", "hostile", 40, { level: 4 })]);
    const orc = Object.assign(run.byId.get("orc"), { bound: true, boundBy: null, status: "bound" });
    expect(bondsDC(run, orc)).toBe(19);
    expect(holdsOf(run, orc)).toEqual([expect.objectContaining({ key: "bound", dc: 19, others: "untie" })]);
  });
});

describe("an Escape", () => {
  test("its best way out against the hold's DC, less what frightens or sickens it", () => {
    const u = unit({ conds: { frightened: 2, sickened: 1 } });
    expect(tryHold(table(10), u, { key: "grabbed", dc: 15 })).toEqual({ success: false, degree: 1, natural: 10, mod: 3, total: 13, dc: 15 });
    expect(tryHold(table(12), u, { key: "grabbed", dc: 15 })).toMatchObject({ success: true, degree: 2, total: 15 });
  });

  test("a critical failure: no more tries until its next turn (none to spend); then one action again", () => {
    const u = unit({ turnsTaken: 3 });
    const hold = { key: "grabbed", dc: 20 };
    expect(escapeCost(pf2eRules, u, hold)).toEqual({ actions: 1 });
    expect(tryHold(table(4), u, hold)).toMatchObject({ success: false, degree: 0 });
    expect(escapeCost(pf2eRules, u, hold)).toEqual({ actions: Infinity });
    u.turnsTaken = 4;
    expect(escapeCost(pf2eRules, u, hold)).toEqual({ actions: 1 });
  });

  test("bonds against the Thievery DC of whoever tied them; tied by no one the fight knows, the hold's own DC", () => {
    const binder = { id: "orc", spec: { tiesDC: 11 } };
    expect(tryHold(table(10, [binder]), unit(), { key: "bound", byId: "orc", dc: 30 })).toMatchObject({ success: true, dc: 11 });
    expect(tryHold(table(10, [binder]), unit(), { key: "bound", byId: null, dc: 30 })).toMatchObject({ success: false, dc: 30 });
  });

  test("freeing a friend is the core's: untied with one action and no roll; nothing to roll with, the core's chance", () => {
    expect(pf2eRules.breakFree(table(1), unit(), { key: "bound", dc: 20, others: "untie" }, { freeing: true })).toBeNull();
    expect(tryHold(table(1), unit(), { key: "bound", dc: 20, others: "untie" }, { freeing: true })).toEqual({ success: true });
    expect(untieCost(pf2eRules, unit(), unit(), { key: "bound" })).toEqual({ actions: 1 });
    expect(pf2eRules.breakFree(table(10), unit({ spec: {} }), { key: "grabbed", dc: 15 })).toBeNull();
    expect(pf2eRules.breakFree(table(10), unit(), { key: "grabbed", dc: null })).toBeNull();
  });

  test("in a live battle, the system's own roll where it makes checks (systemRolled), as the engine's Escape; else the engine's dice", () => {
    const asked = [];
    const live = answer => ({ playing: true, roll: (run, request) => { asked.push(request); return answer; } });
    expect(pf2eRules.breakFree({ ...table(1), live: live({ degree: 3, natural: 18, total: 23 }) }, unit(), { key: "grabbed", byId: null, dc: 15 }))
      .toEqual({ success: true, degree: 3, natural: 18, mod: 5, total: 23, dc: 15 });
    expect(asked).toEqual([{ kind: "check", unitId: "u", targetId: null, purpose: "escape", skill: null, against: null, dc: 15, action: { id: null, name: "grabbed" } }]);
    // (No roll of the system's: the engine's, a natural 1.)
    expect(pf2eRules.breakFree({ ...table(1), live: live(null) }, unit(), { key: "grabbed", dc: 15 })).toMatchObject({ success: false, degree: 0, natural: 1 });
  });

  test("free of what its sheet showed: the off-guard and immobilized it brought go too, unless another hold still brings them", () => {
    const run = fight([creature("hero", "friendly", 0, { conditions: { grabbed: 1, restrained: 1, offGuard: 1, immobilized: 1, frightened: 1 } }), creature("orc", "hostile", 40)]);
    const hero = run.byId.get("hero");
    const [grab, pin] = holdsOf(run, hero);
    expect([grab, pin]).toEqual([expect.objectContaining({ key: "grabbed", sheet: true }), expect.objectContaining({ key: "restrained", sheet: true })]);
    release(run, hero, grab);
    expect(hero.conds).toEqual({ restrained: 1, offGuard: 1, immobilized: 1, frightened: 1 });
    release(run, hero, holdsOf(run, hero)[0]);
    expect(hero.conds).toEqual({ frightened: 1 });
  });

  test("out of a spell's hold, out of what it laid with it (Impaling Spike's off-guard): the core's, by the hold's own `with`", () => {
    const run = fight([creature("hero", "friendly", 0, { escapeWork: { mod: 30 } }), creature("orc", "hostile", 40)]);
    const hero = run.byId.get("hero");
    applyOutcome(hero, { conditions: { immobilized: 1, offGuard: 1 }, rounds: 10, label: "Impaling Spike", escape: { key: "immobilized", dc: 22, with: ["offGuard"] } }, "orc", { id: "orc.spike" });
    const [hold] = holdsOf(run, hero);
    expect(hold).toMatchObject({ key: "immobilized", dc: 22, with: ["offGuard"] });
    run.rng.d20 = () => 10;
    expect(tryHold(run, hero, hold)).toMatchObject({ success: true });
    release(run, hero, hold);
    expect(hero.conds.immobilized ?? 0).toBe(0);
    expect(hero.conds.offGuard ?? 0).toBe(0);
    expect(holdsOf(run, hero)).toEqual([]);
  });
});

describe("breaking free in a fight", () => {
  test("grabbed on its sheet: it Escapes at the turn's start, free of the grab and all it brought", () => {
    const run = fight([creature("hero", "friendly", 0, { conditions: { grabbed: 1, offGuard: 1, immobilized: 1 }, escapeWork: { mod: 30 } }), creature("orc", "hostile", 40)]);
    const hero = run.byId.get("hero");
    expect(holdsOf(run, hero)).toEqual([expect.objectContaining({ key: "grabbed", dc: 15, others: null, sheet: true })]);
    takeTurn(run, hero);
    expect(run.log.find(e => e.actorId === "hero" && e.type === "escape")).toMatchObject({ hold: "grabbed", success: true, dc: 15 });
    expect([hero.conds.grabbed, hero.conds.offGuard, hero.conds.immobilized]).toEqual([undefined, undefined, undefined]);
  });

  test("grabbed by a foe: against the grabber's Athletics DC", () => {
    const run = fight([creature("hero", "friendly", 0, { escapeWork: { mod: 30 } }), creature("orc", "hostile", 40, { escapeDC: 22 })]);
    const hero = run.byId.get("hero");
    hero.grabbedBy = "orc";
    takeTurn(run, hero);
    expect(run.log.find(e => e.actorId === "hero" && e.type === "escape")).toMatchObject({ hold: "grabbed", success: true, dc: 22 });
    expect(hero.grabbedBy).toBeNull();
  });

  test("a prisoner struggles against the knots of the one who tied it", () => {
    const run = fight([creature("hero", "friendly", 0, { tiesDC: 12 }), creature("orc", "hostile", 5, { escapeWork: { mod: 30 } })]);
    const orc = Object.assign(run.byId.get("orc"), { bound: true, boundBy: "hero", status: "bound" });
    takeTurn(run, orc);
    expect(run.log.at(-1)).toMatchObject({ type: "escape", hold: "bound", success: true, dc: 12 });
    expect(orc.status).toBe("standing");
  });
});
