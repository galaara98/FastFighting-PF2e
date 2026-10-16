/**
 * PF2e's conditions in the rolls (rules.js): status penalties don't stack, the worst counts, each on what its roll is
 * based on (clumsy Dexterity's, enfeebled Strength's, stupefied the mind's, drained Constitution's, encumbered as clumsy
 * 1); what a sheet's conditions already put into its numbers isn't counted again; an attack's flat check against one
 * hidden (DC 11) or concealed (DC 5), or by one dazzled; quickened an action more; drained Hit Points; and the core's
 * own of these (stupefied, drained, dazzled, concealed, encumbered) weighed as PF2e's.
 */
import { describe, expect, test } from "vitest";
import { pf2eRules } from "../scripts/rules.js";
import { otherPrecise } from "../scripts/adapter.js";

const m = pf2eRules.modifiers;
const unit = (conds = {}, sheet = undefined, over = {}) => ({ id: "u", conds, prone: false, spec: { level: 3, conditions: sheet, defenses: { ac: 18 } }, effects: [], ...over });
const ac = (t, over = {}) => m.defense({ target: t, grabbed: false, flanked: false, exposedTo: false, cover: "none", attacker: null, ...over });
const hit = (u, action) => m.attack({ attacker: u, action, distance: 0, positioning: false }).bonus;
const save = (u, type, cover = "none") => m.save({ unit: u, type, cover }).bonus;
const MELEE = { melee: true };
const RANGED = { melee: false, range: { increment: 60, noPenalty: true } };
const SPELL = { melee: false, spellId: "s", range: { increment: 30, noPenalty: true } };

describe("status penalties: the worst counts, on what the roll is based on", () => {
  test("AC: frightened and clumsy don't stack; encumbered is clumsy 1", () => {
    expect(ac(unit({ frightened: 1, clumsy: 2 }))).toBe(-2);
    expect(ac(unit({ frightened: 3, clumsy: 2 }))).toBe(-3);
    expect(ac(unit({ encumbered: 1 }))).toBe(-1);
    expect(ac(unit({ stupefied: 3, drained: 2, enfeebled: 2 }))).toBeCloseTo(0);
  });

  test("saves: Will the mind's (stupefied), Fortitude Constitution's (drained), Reflex Dexterity's (clumsy) and cover", () => {
    const u = unit({ frightened: 1, stupefied: 2, drained: 3, clumsy: 1 });
    expect([save(u, "will"), save(u, "fortitude"), save(u, "reflex")]).toEqual([-2, -3, -1]);
    expect(save(unit({ clumsy: 1 }), "reflex", "some")).toBe(1);
    expect(save(unit({ clumsy: 1 }), "reflex", "most")).toBe(3);
  });

  test("attacks: a melee Strike Strength's (enfeebled), a ranged one Dexterity's (clumsy), a spell attack the mind's (stupefied)", () => {
    const u = unit({ enfeebled: 2, clumsy: 1, stupefied: 3 });
    expect([hit(u, MELEE), hit(u, RANGED), hit(u, SPELL)]).toEqual([-2, -1, -3]);
    expect(hit(unit({ sickened: 2, enfeebled: 1 }), MELEE)).toBe(-2);
  });

  test("skill checks: frightened, sickened and fascinated, the worst", () => {
    expect(m.check({ unit: unit({ frightened: 1, fascinated: 1 }) }).bonus).toBe(-2);
    expect(m.check({ unit: unit({ frightened: 3 }) }).bonus).toBe(-3);
    expect(m.check({ unit: unit({ stupefied: 2 }) }).bonus).toBeCloseTo(0);
  });
});

describe("not counted twice: what its sheet's numbers have already", () => {
  test("frightened on its sheet when its numbers were read: nothing more; eased since, that much back", () => {
    expect(ac(unit({ frightened: 2 }, { frightened: 2 }))).toBeCloseTo(0);
    expect(ac(unit({ frightened: 1 }, { frightened: 2 }))).toBe(1);
    expect(save(unit({ frightened: 2, stupefied: 3 }, { frightened: 2 }), "will")).toBe(-1);
  });

  test("off guard (or what brings it: prone, grabbed) on its sheet: its AC has the -2; prone, its Strikes have theirs", () => {
    const grabbed = unit({ offGuard: 1, grabbed: 1, immobilized: 1 }, { offGuard: 1, grabbed: 1, immobilized: 1 });
    expect(ac(grabbed, { grabbed: true })).toBeCloseTo(0);
    expect(ac(unit({}, { grabbed: 1 }))).toBe(2);
    const prone = unit({}, { prone: 1 }, { prone: true });
    expect(hit(prone, MELEE)).toBeCloseTo(0);
    expect(hit(unit({}, {}, { prone: true }), MELEE)).toBe(-2);
  });
});

describe("the flat check an attack needs", () => {
  const roll = { natural: 15, total: 25, degree: 2 };
  const table = (...naturals) => ({ rng: { d20: () => naturals.shift() } });
  const attacker = (conds = {}, spec = {}) => ({ conds, spec });
  const target = conds => ({ conds, spec: { name: "orc" } });

  test("concealed: DC 5; hidden: DC 11; failed, the blow doesn't affect it", () => {
    const missed = pf2eRules.adjustRoll(table(4), attacker(), roll, { kind: "attack", target: target({ concealed: 1 }), action: MELEE });
    expect(missed).toMatchObject({ degree: 1, said: { data: { flat: 4, flatDC: 5 } } });
    expect(missed.said.text).toBeTruthy();
    expect(pf2eRules.adjustRoll(table(5), attacker(), roll, { kind: "attack", target: target({ concealed: 1 }), action: MELEE })).toBe(roll);
    expect(pf2eRules.adjustRoll(table(10), attacker(), roll, { kind: "attack", target: target({ hidden: 1 }), action: MELEE }).degree).toBe(1);
    expect(pf2eRules.adjustRoll(table(11), attacker(), roll, { kind: "attack", target: target({ hidden: 1 }), action: MELEE })).toBe(roll);
  });

  test("dazzled, everything is concealed from it, unless it has a precise sense besides sight", () => {
    expect(pf2eRules.adjustRoll(table(3), attacker({ dazzled: 1 }), roll, { kind: "attack", target: target({}), action: MELEE }).degree).toBe(1);
    expect(pf2eRules.adjustRoll(table(3), attacker({ dazzled: 1 }, { otherPrecise: true }), roll, { kind: "attack", target: target({}), action: MELEE })).toBe(roll);
    expect(otherPrecise([{ type: "vision", acuity: "precise" }, { type: "darkvision", acuity: "precise" }, { type: "tremorsense", acuity: "imprecise" }])).toBe(false);
    expect(otherPrecise([{ type: "echolocation", acuity: "precise", range: 40 }])).toBe(true);
  });

  test("none against an area, none for a miss already, none for a save", () => {
    const rng = { d20: () => { throw new Error("no flat check"); } };
    expect(pf2eRules.adjustRoll({ rng }, attacker(), roll, { kind: "attack", target: target({ hidden: 1 }), action: { ...MELEE, area: { targets: 2 } } })).toBe(roll);
    const miss = { natural: 3, total: 10, degree: 1 };
    expect(pf2eRules.adjustRoll({ rng }, attacker(), miss, { kind: "attack", target: target({ hidden: 1 }), action: MELEE })).toBe(miss);
    expect(pf2eRules.adjustRoll({ rng }, attacker(), roll, { kind: "save" })).toBe(roll);
  });
});

describe("quickened, drained", () => {
  test("quickened: an action more (slowed 1 takes it back)", () => {
    expect(m.actionsLost(unit({ quickened: 1 }))).toBe(-1);
    expect(m.actionsLost(unit({ quickened: 1, slowed: 1 }))).toBe(0);
  });

  test("drained: its level in Hit Points a step, off its maximum too; eased, its maximum back but not what it lost", () => {
    const run = { units: [], byId: new Map() };
    const u = unit({ drained: 1 }, {}, { hp: 30, maxHp: 40, status: "standing" });
    pf2eRules.startTurn(run, u);
    expect([u.hp, u.maxHp]).toEqual([27, 37]);
    pf2eRules.startTurn(run, u);
    expect([u.hp, u.maxHp]).toEqual([27, 37]);
    u.conds.drained = 3;
    pf2eRules.afterHarm(run, u);
    expect([u.hp, u.maxHp]).toEqual([21, 31]);
    delete u.conds.drained;
    pf2eRules.startTurn(run, u);
    expect([u.hp, u.maxHp]).toEqual([21, 40]);
    // (Never below 1 Hit Point by it.)
    const low = unit({ drained: 2 }, {}, { hp: 4, maxHp: 40, status: "standing" });
    pf2eRules.startTurn(run, low);
    expect(low.hp).toBe(1);
  });

  test("drained on its sheet already (its Hit Points have it), or in a live battle (the sheet does it): nothing more", () => {
    const u = unit({ drained: 2 }, { drained: 2 }, { hp: 30, maxHp: 34, status: "standing" });
    pf2eRules.startTurn({ units: [] }, u);
    expect([u.hp, u.maxHp]).toEqual([30, 34]);
    const v = unit({ drained: 1 }, {}, { hp: 30, maxHp: 40, status: "standing" });
    pf2eRules.startTurn({ units: [], live: {} }, v);
    expect([v.hp, v.maxHp]).toEqual([30, 40]);
  });
});

describe("weighed as PF2e's", () => {
  test("stupefied, drained, dazzled, concealed, encumbered, quickened", () => {
    expect(pf2eRules.conditionMods("stupefied", 2)).toEqual({ saves: -1, checks: -2 });
    expect(pf2eRules.conditionMods("drained", 3)).toEqual({ saves: -1 });
    expect(pf2eRules.conditionMods("dazzled")).toEqual({ attack: -2 });
    expect(pf2eRules.conditionMods("concealed")).toEqual({ ac: 2 });
    expect(pf2eRules.conditionMods("encumbered")).toEqual({ ac: -1, speed: -10 });
    expect(pf2eRules.conditionMods("quickened")).toEqual({ actions: 1 });
  });
});
