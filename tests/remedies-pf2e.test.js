/**
 * What a PF2e creature can do about what bothers it (remedies.js, and the rules the core asks of it): assisted recovery
 * against persistent damage (two actions, one more flat check: dropping and rolling against fire at DC 10, and prone
 * after; a bleed or acid at DC 15; nothing for the rest), a friend's Administer First Aid on a bleed (Medicine against
 * its DC, then the flat check at DC 10), and retching while sickened (one action, a Fortitude save against what
 * sickened it: 1 lower, 2 on a critical success).
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, takeTurn, turnUpkeep } from "../../fast-fighting/scripts/engine/simulator.js";
import { holdsOf, ownHolds, freeable, tryHold, untieCost, remediesOf } from "../../fast-fighting/scripts/engine/behavior/holds.js";
import { applyOutcome } from "../../fast-fighting/scripts/engine/behavior/effects.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { lower, sickDC, bleedDC, ASSISTED } from "../scripts/remedies.js";
import { levelOf } from "../../fast-fighting/scripts/engine/behavior/desire.js";

const minded = { tactical: { base: 60, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 80, fudge: 0 } };
const blade = () => ({ id: "blade", name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, hands: 1, damage: [parseFormula("1d8+4", "slashing")] });
const creature = (id, side, x, over = {}) => ({
  id, name: id, side, kind: "npc", level: 3, hp: { value: 40, max: 40 }, defenses: { ac: 18, fortitude: 9, reflex: 9, will: 9 },
  initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [blade()], iwr: {}, flags: { fearless: true }, diesAtZero: false, traits: minded,
  position: { x, y: 0, size: 5 }, ...over
});
function fight(list, seed = 3) {
  const run = beginRun(prepareBattle({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: true, maxRounds: 6, aftermath: "none" } }, pf2eRules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
const burn = (formula = "2d6") => ({ part: { ...parseFormula(formula, "fire"), persistent: true }, sourceId: "orc" });
const bleed = (formula = "1d6") => ({ part: { ...parseFormula(formula, "bleed"), persistent: true }, sourceId: "orc" });

describe("assisted recovery against persistent damage", () => {
  test("two actions where something would reasonably help (fire, a bleed, acid); none for the rest", () => {
    expect(["fire", "bleed", "acid", "poison", "mental"].map(type => pf2eRules.persistentRemedyCost({}, type))).toEqual([
      { actions: 2 }, { actions: 2 }, { actions: 2 }, { actions: Infinity }, { actions: Infinity }
    ]);
    expect(Object.keys(ASSISTED)).toEqual(["fire", "bleed", "acid"]);
  });

  test("dropping and rolling against fire: a flat check at DC 10, and prone after; a bleed at DC 15", () => {
    const u = { prone: false };
    const at = n => ({ rng: { d20: () => n } });
    expect(pf2eRules.persistentRemedy(at(10), u, "fire")).toMatchObject({ success: true });
    expect(u.prone).toBe(true);
    expect(pf2eRules.persistentRemedy(at(9), { prone: false }, "fire").success).toBe(false);
    const v = { prone: false };
    expect(pf2eRules.persistentRemedy(at(14), v, "bleed").success).toBe(false);
    expect(pf2eRules.persistentRemedy(at(15), v, "bleed").success).toBe(true);
    expect(v.prone).toBe(false);
    expect(pf2eRules.persistentRemedy(at(20), v, "poison").success).toBe(false);
    expect(pf2eRules.persistentRemedy(at(12), { }, "fire").said.text).toBeTruthy();
  });

  test("the core offers it as a remedy (two actions), and a success ends the burn", () => {
    const run = fight([creature("hero", "friendly", 0), creature("orc", "hostile", 40)]);
    const hero = run.byId.get("hero");
    hero.persistent = [burn()];
    const [r] = remediesOf(run, hero).filter(x => x.key === "persistent:fire");
    expect(r.cost).toEqual({ actions: 2 });
    run.rng.d20 = () => 12;
    expect(r.try(run, hero).success).toBe(true);
    expect(hero.persistent).toEqual([]);
    expect(hero.prone).toBe(true);
  });

  test("burning badly, it drops and rolls on its turn", () => {
    const run = fight([creature("hero", "friendly", 0), creature("orc", "hostile", 60)]);
    const hero = run.byId.get("hero");
    hero.persistent = [burn("4d6")];
    turnUpkeep(run, hero);
    takeTurn(run, hero);
    expect(run.log.find(e => e.actorId === "hero" && e.type === "remedy")).toMatchObject({ what: "persistent:fire", damageType: "fire" });
  });
});

describe("Administer First Aid on a friend's bleed", () => {
  test("a hold only a friend breaks: Medicine against the bleed's DC, two actions for one trained in it", () => {
    const run = fight([creature("hero", "friendly", 0), creature("medic", "friendly", 5, { firstAid: { mod: 12 } }), creature("ally", "friendly", 10), creature("orc", "hostile", 40, { level: 4 })]);
    const [hero, medic, ally] = ["hero", "medic", "ally"].map(id => run.byId.get(id));
    hero.persistent = [bleed()];
    const hold = holdsOf(run, hero).find(h => h.key === "bleeding");
    expect(hold).toMatchObject({ others: "check", via: "medicine", friendOnly: true, dc: 19, byId: "orc" });
    expect(bleedDC(run, hero, hero.persistent[0])).toBe(19);
    expect(ownHolds(run, hero).some(h => h.key === "bleeding")).toBe(false);
    expect(freeable(run, hero)).toEqual(hold);
    expect(untieCost(pf2eRules, medic, hero, hold)).toEqual({ actions: 2 });
    expect(untieCost(pf2eRules, ally, hero, hold)).toEqual({ actions: Infinity });
    // (A success: then the flat check, at DC 10; the bleed ends on that.)
    const rolls = [12, 10];
    run.rng.d20 = () => rolls.shift();
    expect(tryHold(run, medic, hold, { freeing: true, held: hero })).toMatchObject({ success: true, degree: 2, mod: 12, total: 24, dc: 19 });
    expect(hero.persistent).toEqual([]);
  });

  test("on its turn, with no foe near, a medic tends a friend's bleed", () => {
    const run = fight([creature("hero", "friendly", 0, { hp: { value: 12, max: 40 } }), creature("medic", "friendly", 5, { firstAid: { mod: 30 } }), creature("orc", "hostile", 120)]);
    const [hero, medic] = ["hero", "medic"].map(id => run.byId.get(id));
    hero.persistent = [bleed("2d6")];
    turnUpkeep(run, medic);
    takeTurn(run, medic);
    expect(run.log.find(e => e.actorId === "medic" && e.type === "free")).toMatchObject({ targetId: "hero", hold: "bleeding" });
  });

  test("a failed check, or a failed flat check: still bleeding; and the bleeder can't treat itself this way", () => {
    const run = fight([creature("hero", "friendly", 0), creature("medic", "friendly", 5, { firstAid: { mod: 2 } }), creature("orc", "hostile", 40)]);
    const [hero, medic] = ["hero", "medic"].map(id => run.byId.get(id));
    hero.persistent = [bleed()];
    const hold = freeable(run, hero);
    run.rng.d20 = () => 10;
    expect(tryHold(run, medic, hold, { freeing: true, held: hero })).toMatchObject({ success: false, degree: 1, total: 12, dc: 18 });
    const rolls = [20, 9];
    run.rng.d20 = () => rolls.shift();
    expect(tryHold(run, medic, hold, { freeing: true, held: hero }).success).toBe(false);
    expect(hero.persistent.length).toBe(1);
    expect(pf2eRules.breakFree(run, hero, hold)).toBeNull();
  });

  test("in a live battle, the system's own Administer First Aid (stop bleeding: its id says) where it makes checks; the bleeder's flat check after it, its own too", () => {
    const run = fight([creature("hero", "friendly", 0), creature("medic", "friendly", 5, { firstAid: { mod: 2 } }), creature("orc", "hostile", 40)]);
    const [hero, medic] = ["hero", "medic"].map(id => run.byId.get(id));
    hero.persistent = [bleed()];
    const hold = freeable(run, hero);
    const asked = [];
    // (The system's Administer First Aid a success, taken as it is; its flat check, a 9 against DC 10, not: still bleeding.)
    const answers = [{ degree: 2, natural: 15, total: 17 }, { degree: 1, natural: 9, total: 9 }];
    run.live = { playing: true, roll: (r, request) => { asked.push(request); return answers.shift(); } };
    run.rng.d20 = () => 12;
    expect(tryHold(run, medic, hold, { freeing: true, held: hero })).toMatchObject({ success: false, degree: 2, natural: 15, total: 17, dc: 18 });
    expect(hero.persistent).toHaveLength(1);
    expect(asked).toEqual([
      { kind: "check", unitId: "medic", targetId: "hero", purpose: "firstAid", skill: null, against: null, dc: 18, advantage: 0, action: { id: "medic.stop-bleeding", name: "bleeding" } },
      { kind: "check", unitId: "hero", targetId: null, purpose: "flat", skill: null, against: null, dc: 10, advantage: 0, action: { id: null, name: expect.any(String) } }
    ]);
    // (The system's flat check made: the bleed ends.)
    answers.push({ degree: 2, natural: 15, total: 17 }, { degree: 2, natural: 10, total: 10 });
    expect(tryHold(run, medic, hold, { freeing: true, held: hero }).success).toBe(true);
    expect(hero.persistent).toEqual([]);
  });
});

describe("retching while sickened", () => {
  const sicken = (run, u, by, value, action = null) => applyOutcome(u, { conditions: { sickened: value }, rounds: 10, label: "" }, by.id, action);

  test("one action, a Fortitude save against the DC of the spell that sickened it", () => {
    const spell = { id: "orc.spell", kind: "control", save: { type: "fortitude", dc: 21 } };
    const run = fight([creature("hero", "friendly", 0), creature("orc", "hostile", 40, { actions: [blade(), spell] })]);
    const [hero, orc] = ["hero", "orc"].map(id => run.byId.get(id));
    expect(pf2eRules.remedies(run, hero)).toEqual([]);
    sicken(run, hero, orc, 2, spell);
    const [r] = pf2eRules.remedies(run, hero);
    expect(r).toMatchObject({ key: "retch", condition: "sickened", cost: { actions: 1 }, annoyance: 45 });
    expect(r.label).toBeTruthy();
    expect(sickDC(run, hero)).toBe(21);
    // (+9, less sickened 2, against 21: a 14 makes it, sickened 1; a natural 20, a critical success: gone.)
    run.rng.d20 = () => 14;
    expect(r.try(run, hero).success).toBe(true);
    expect(hero.conds.sickened).toBe(1);
    // (Now less sickened 1: a 12 falls short.)
    run.rng.d20 = () => 12;
    expect(pf2eRules.retch(run, hero).success).toBe(false);
    expect(hero.conds.sickened).toBe(1);
    sicken(run, hero, orc, 2, spell);
    run.rng.d20 = () => 20;
    pf2eRules.retch(run, hero);
    expect(hero.conds.sickened).toBeUndefined();
    expect(hero.effects.some(e => e.conditions?.sickened)).toBe(false);
  });

  test("in a live battle, the system's own Fortitude save where it makes saves (systemRolled), against the same DC", () => {
    const spell = { id: "orc.spell", kind: "control", save: { type: "fortitude", dc: 21 } };
    const run = fight([creature("hero", "friendly", 0), creature("orc", "hostile", 40, { actions: [blade(), spell] })]);
    const [hero, orc] = ["hero", "orc"].map(id => run.byId.get(id));
    sicken(run, hero, orc, 2, spell);
    const asked = [];
    run.live = { playing: true, roll: (r, request) => { asked.push(request); return { degree: 3, natural: 19, total: 26 }; } };
    run.rng.d20 = () => 1;
    expect(pf2eRules.retch(run, hero).success).toBe(true);
    expect(hero.conds.sickened).toBeUndefined();
    expect(asked).toEqual([{ kind: "save", unitId: "hero", targetId: null, save: "fortitude", dc: 21, advantage: 0, action: { id: null, name: pf2eRules.remedies(run, { conds: { sickened: 1 } })[0].label } }]);
  });

  test("sickened, it can't drink a potion or an elixir (usable, which the core asks of heals); a healing spell, yes", () => {
    const potion = { id: "hero.item.p", kind: "heal", cost: 1, heal: [parseFormula("1d8", "healing")], selfOnly: true, itemId: "p", resource: "item:p", pool: 1, hands: 1 };
    const spell = { id: "hero.spell.heal", kind: "heal", cost: 1, heal: [parseFormula("1d8", "healing")], selfOnly: true, spellId: "heal" };
    const run = fight([creature("hero", "friendly", 0, { hp: { value: 5, max: 40 }, actions: [blade(), potion] }), creature("orc", "hostile", 40)]);
    const [hero, orc] = ["hero", "orc"].map(id => run.byId.get(id));
    expect(pf2eRules.usable(run, hero, potion, hero)).toBe(true);
    sicken(run, hero, orc, 1);
    expect(pf2eRules.usable(run, hero, potion, hero)).toBe(false);
    expect(pf2eRules.usable(run, hero, spell, hero)).toBe(true);
    takeTurn(run, hero);
    expect(run.log.some(e => e.type === "heal" && e.actorId === "hero")).toBe(false);
  });

  test("the DC: its source's best save, else the GM Core's for its level; an affliction's own", () => {
    const run = fight([creature("hero", "friendly", 0, { level: 1 }), creature("orc", "hostile", 40, { level: 5, actions: [blade(), { id: "x", kind: "save", save: { type: "will", dc: 23 } }] })]);
    const [hero, orc] = ["hero", "orc"].map(id => run.byId.get(id));
    sicken(run, hero, orc, 1);
    expect(sickDC(run, hero)).toBe(23);
    orc.spec.actions = [blade()];
    expect(sickDC(run, hero)).toBe(20);
    hero.afflictions = [{ spec: { save: { type: "fortitude", dc: 17 }, stages: [{ conditions: { sickened: 1 } }] }, stage: 1, onsetLeft: 0 }];
    expect(sickDC(run, hero)).toBe(17);
  });

  test("lowered where it comes from: its effects (the rest of each kept), what it started with; an affliction's stage keeps it", () => {
    const u = { conds: { sickened: 3, slowed: 1 }, baseConds: { sickened: 1 }, effects: [{ key: "a", conditions: { sickened: 3, slowed: 1 } }, { key: "b", conditions: { sickened: 2 } }], afflictions: [] };
    expect(lower(u, "sickened", 1)).toBe(2);
    expect(u.effects).toEqual([{ key: "a", conditions: { sickened: 2, slowed: 1 } }, { key: "b", conditions: { sickened: 2 } }]);
    expect(u.baseConds).toEqual({ sickened: 1 });
    expect(lower(u, "sickened", 2)).toBe(0);
    expect(u.effects).toEqual([{ key: "a", conditions: { slowed: 1 } }]);
    expect(u.baseConds).toEqual({});
    expect(u.conds).toEqual({ slowed: 1 });
    const w = { conds: { sickened: 2 }, effects: [], afflictions: [{ spec: { stages: [{ conditions: { sickened: 1 } }] }, stage: 1 }] };
    expect(lower(w, "sickened", 2)).toBe(1);
  });
});

describe("fear, as PF2e has it (the core's conditionWishes)", () => {
  const scare = (u, by, conditions) => applyOutcome(u, { conditions, rounds: 5, label: "" }, by.id, { id: `${by.id}.scare` });

  test("frightened is a status penalty and no more: no keeping away; fleeing, every action spent getting away from its source", () => {
    const by = { id: "orc" };
    expect(pf2eRules.conditionWishes(null, {}, { key: "frightened", value: 2, by })).toEqual([]);
    expect(pf2eRules.conditionWishes(null, {}, { key: "fleeing", value: 1, by })).toEqual([{ kind: "avoid", targetId: "orc", level: 90 }]);
    expect(pf2eRules.conditionWishes(null, {}, { key: "slowed", value: 1, by })).toBeNull();
    expect(pf2eRules.fearValued).toBe(true);
    for ( const [conditions, avoids] of [[{ frightened: 2 }, false], [{ fleeing: 1 }, true]] ) {
      const run = fight([creature("hero", "friendly", 0), creature("orc", "hostile", 5)]);
      const [hero, orc] = ["hero", "orc"].map(id => run.byId.get(id));
      scare(hero, orc, conditions);
      takeTurn(run, hero);
      expect(levelOf(hero, "avoid", orc.id) > 0).toBe(avoids);
    }
  });
});
