/**
 * The rules' own flat checks and Tumble Through in a live battle: each asks for the system's roll where it makes
 * checks (the core's systemRolled, purpose "flat" or "tumble", so PF2e rolls it and its card is in the chat) and takes
 * its answer as it is; with no answer, the engine's d20 as ever. An attack's flat check stands after a roll the system
 * made itself too (ctx.rolled), and nothing else is done to that roll.
 */
import { describe, expect, test } from "vitest";
import { pf2eRules } from "../scripts/rules.js";

/**
 * A turn FastFighting plays: the system's answers to what's asked, in order (null: the engine rolls it), and the
 * engine's own d20 (none expected unless given).
 */
function table(answers = [], naturals = []) {
  const asked = [];
  const rng = { d20: () => {
    if ( !naturals.length ) throw new Error("the engine's die");
    return naturals.shift();
  } };
  const run = { rng, live: { playing: true, roll: (r, request) => { asked.push(request); return answers.length ? answers.shift() : null; } } };
  return { run, asked };
}

const made = (natural = 14) => ({ degree: 2, natural, total: natural });
const failed = (natural = 3) => ({ degree: 1, natural, total: natural });
const unit = (id, conds = {}, spec = {}) => ({ id, conds, spec: { name: id, ...spec } });
const MELEE = { id: "orc.claw", melee: true };
const SPELL = { id: "witch.spell.s1", spellId: "s1", melee: false, range: { increment: 30, noPenalty: true } };
const hit = { natural: 15, total: 25, degree: 2 };

/** A request as the core's systemRolled makes it for a flat check: its card titled with what it's for. */
const flat = (unitId, dc, targetId = null) => ({ kind: "check", unitId, targetId, purpose: "flat", skill: null, against: null, dc, action: { id: null, name: expect.any(String) } });

describe("an attack's flat check, the system's", () => {
  test("against one hidden: PF2e's flat check, DC 11, the attacker's at its target; failed, a miss; made, the hit as it was", () => {
    const orc = unit("orc");
    const hero = unit("hero", { hidden: 1 });
    const missed = table([failed(7)]);
    const out = pf2eRules.adjustRoll(missed.run, orc, hit, { kind: "attack", target: hero, action: MELEE });
    expect(out).toMatchObject({ degree: 1, said: { data: { flat: 7, flatDC: 11, luck: "hidden" } } });
    expect(missed.asked).toEqual([flat("orc", 11, "hero")]);
    expect(missed.asked[0].action.name).not.toBe("");
    const struck = table([made(12)]);
    expect(pf2eRules.adjustRoll(struck.run, orc, hit, { kind: "attack", target: hero, action: MELEE })).toBe(hit);
  });

  test("after a strike the system rolled itself (ctx.rolled): the flat check still stands, the system's, and nothing else is done", () => {
    const concealed = unit("hero", { concealed: 1 });
    const missed = table([failed(4)]);
    const out = pf2eRules.adjustRoll(missed.run, unit("orc"), hit, { kind: "attack", target: concealed, action: MELEE, rolled: true });
    expect(out).toEqual({ ...hit, degree: 1, said: { text: expect.any(String), data: { flat: 4, flatDC: 5, luck: "concealed" } } });
    expect(missed.asked).toEqual([flat("orc", 5, "hero")]);
    // (Nothing to flat check: the system's roll as it came, nothing asked.)
    const plain = table();
    expect(pf2eRules.adjustRoll(plain.run, unit("orc"), hit, { kind: "attack", target: unit("hero"), action: MELEE, rolled: true })).toBe(hit);
    expect(plain.asked).toEqual([]);
  });

  test("a system that rolls no checks here (no answer): the engine's d20, as ever", () => {
    const { run, asked } = table([null], [10]);
    expect(pf2eRules.adjustRoll(run, unit("orc"), hit, { kind: "attack", target: unit("hero", { hidden: 1 }), action: MELEE }).degree).toBe(1);
    expect(asked).toHaveLength(1);
    // (Not a live battle's turn: nothing asked.)
    const idle = { rng: { d20: () => 11 }, live: { playing: false, roll: () => { throw new Error("asked"); } } };
    expect(pf2eRules.adjustRoll(idle, unit("orc"), hit, { kind: "attack", target: unit("hero", { hidden: 1 }), action: MELEE })).toBe(hit);
  });

  test("a targeted spell's save: the caster's flat check, the system's, at the one saving; failed, the spell passes it by", () => {
    const saved = { natural: 8, total: 12, degree: 1 };
    const witch = unit("witch");
    const { run, asked } = table([failed(9)]);
    expect(pf2eRules.adjustRoll(run, unit("hero", { hidden: 1 }), saved, { kind: "save", from: witch, action: SPELL, rolled: true })).toMatchObject({ degree: 3, said: { data: { flat: 9, flatDC: 11 } } });
    expect(asked).toEqual([flat("witch", 11, "hero")]);
  });
});

describe("the other flat checks, the system's", () => {
  test("stupefied: the caster's flat check, DC 5 + its value; failed, the spell lost", () => {
    const caster = unit("witch", { stupefied: 2 });
    const lost = table([failed(6)]);
    expect(pf2eRules.disrupted(lost.run, caster, SPELL)).toMatchObject({ natural: 6, dc: 7 });
    expect(lost.asked).toEqual([flat("witch", 7)]);
    expect(pf2eRules.disrupted(table([made(7)]).run, caster, SPELL)).toBeNull();
  });

  test("persistent damage: a DC 15 flat check for each, its bearer's, titled by its damage type; the engine's die with no run (or no answer)", () => {
    const orc = unit("orc");
    const { run, asked } = table([made(15), failed(14)]);
    expect(pf2eRules.persistentFlatCheck(run.rng, { run, unit: orc, type: "fire" })).toBe(true);
    expect(pf2eRules.persistentFlatCheck(run.rng, { run, unit: orc, type: "bleed" })).toBe(false);
    expect(asked).toEqual([flat("orc", 15), flat("orc", 15)]);
    expect(asked[0].action.name).not.toBe(asked[1].action.name);
    expect(pf2eRules.persistentFlatCheck({ d20: () => 15 })).toBe(true);
    expect(pf2eRules.persistentFlatCheck({ d20: () => 14 }, { run: table([null]).run, unit: orc, type: "fire" })).toBe(false);
  });

  test("dropping and rolling against fire: prone, then the system's flat check at DC 10", () => {
    const orc = { ...unit("orc"), prone: false };
    const { run, asked } = table([made(10)]);
    expect(pf2eRules.persistentRemedy(run, orc, "fire")).toMatchObject({ success: true });
    expect(orc.prone).toBe(true);
    expect(asked).toEqual([flat("orc", 10)]);
  });
});

describe("Tumble Through, the system's", () => {
  test("PF2e's Tumble Through at the foe's Reflex DC (the engine's), the foe with it; the system's degree as it came", () => {
    const mover = unit("pc", {}, { acrobatics: { mod: 7 } });
    const foe = unit("orc", {}, { defenses: { reflex: 7 } });
    const { run, asked } = table([{ degree: 1, natural: 12, total: 15 }]);
    expect(pf2eRules.tumbleThrough(run, mover, foe)).toEqual({ success: false, degree: 1, natural: 12, mod: 7, total: 15, dc: 17 });
    expect(asked).toEqual([{ kind: "check", unitId: "pc", targetId: "orc", purpose: "tumble", skill: null, against: "reflex", dc: 17, action: { id: null, name: "" } }]);
    // (No answer: the engine's own roll.)
    expect(pf2eRules.tumbleThrough(table([null], [10]).run, mover, foe)).toEqual({ success: true, degree: 2, natural: 10, mod: 7, total: 17, dc: 17 });
  });
});
