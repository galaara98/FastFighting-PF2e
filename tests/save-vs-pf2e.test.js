/**
 * Situational saves from PF2e's rule elements (save-vs.js): a FlatModifier on saves whose predicate is only about what's
 * saved against becomes an entry of the core's spec.saveVs; anything the sheet's own saves hold, or that it can't read,
 * is left out. Rule shapes as PF2e's packs have them.
 */
import { describe, expect, test } from "vitest";
import { tagOf, predicateTags, saveVsOf, saveVsFrom } from "../scripts/save-vs.js";
import { saveVsBonus } from "../../fast-fighting/scripts/engine/behavior/save-vs.js";

const traits = new Set(["fear", "poison", "disease", "mental", "emotion", "arcane", "primal", "magical", "auditory", "sonic"]);
const flat = (predicate, over = {}) => ({ key: "FlatModifier", predicate, selector: "saving-throw", type: "status", value: 1, ...over });

describe("a predicate's statements", () => {
  test("about the effect saved against: its traits, magical, a spell, what it inflicts, an area, damage; who set it off", () => {
    expect(tagOf("item:trait:poison")).toEqual({ tag: "poison" });
    expect(tagOf("origin:action:trait:arcane")).toEqual({ tag: "arcane" });
    expect(tagOf("item:magical")).toEqual({ tag: "magical" });
    expect(tagOf("item:type:spell")).toEqual({ tag: "spell" });
    expect(tagOf("inflicts:off-guard")).toEqual({ tag: "inflicts:offGuard" });
    expect(tagOf("area-effect")).toEqual({ tag: "area" });
    expect(tagOf("damaging-effect")).toEqual({ tag: "damaging" });
    expect(tagOf("origin:trait:construct")).toEqual({ from: "construct" });
    expect(tagOf("fear", traits)).toEqual({ tag: "fear" });
    // (A toggle of its own, a stance, its hit points: not about the effect.)
    for ( const s of ["formation", "self:effect:rage", "fear", "inflicts:persistent-damage:bleed"] ) expect([s, tagOf(s)]).toEqual([s, null]);
  });

  test("as one entry: all of the plain ones, one of an or-group, none of a not; nothing it can't read that must hold", () => {
    expect(predicateTags(["item:magical", { not: "item:trait:emotion" }], traits)).toEqual({ vs: [], all: ["magical"], not: ["emotion"], from: [] });
    expect(predicateTags([{ or: ["item:trait:disease", "item:trait:poison", "inflicts:persistent-damage:bleed"] }], traits).vs).toEqual(["disease", "poison"]);
    expect(predicateTags([{ or: ["auditory", "sonic"] }, { nor: ["item:trait:magical"] }], traits)).toMatchObject({ vs: ["auditory", "sonic"], not: ["magical"] });
    expect(predicateTags(["origin:trait:trap"], traits)).toMatchObject({ from: ["trap"] });
    expect(predicateTags(["formation"], traits)).toBeNull();
    expect(predicateTags(["item:magical", "rain-of-embers"], traits)).toBeNull();
    expect(predicateTags([{ or: ["fear"] }, { or: ["poison"] }], traits)).toBeNull();
    expect(predicateTags([{ not: "item:trait:emotion" }], traits)).toBeNull(); // (only what it isn't: the sheet's own)
    expect(predicateTags([{ lt: ["hp-percent", 50] }], traits)).toBeNull();
    expect(predicateTags([], traits)).toBeNull();
  });
});

describe("a rule element as a situational save", () => {
  test("the commonest: +1 status to all saves against magic", () => {
    expect(saveVsOf(flat(["item:magical"]), { traits })).toEqual({ bonus: 1, type: "status", all: ["magical"] });
  });

  test("one save, its kind, a penalty, a formula's value", () => {
    expect(saveVsOf(flat(["item:trait:fear"], { selector: "will", type: "circumstance", value: 2 }), { traits })).toEqual({ bonus: 2, type: "circumstance", saves: ["will"], all: ["fear"] });
    expect(saveVsOf(flat(["item:trait:death"], { value: -1 }), { traits })).toMatchObject({ bonus: -1, all: ["death"] });
    expect(saveVsOf(flat(["item:trait:poison"], { type: undefined, value: "@actor.level" }), { traits, actor: { level: 3 } })).toEqual({ bonus: 3, type: "untyped", all: ["poison"] });
    expect(saveVsOf(flat(["catch-rock"], { selector: ["ac", "saving-throw"], type: "circumstance", value: 4 }), { traits })).toBeNull();
  });

  test("left out: no predicate (the sheet's saves hold it), not on a save, not a FlatModifier, worth nothing", () => {
    expect(saveVsOf(flat(undefined), { traits })).toBeNull();
    expect(saveVsOf(flat(["item:magical"], { selector: "ac" }), { traits })).toBeNull();
    expect(saveVsOf({ key: "AdjustDegreeOfSuccess", predicate: ["item:trait:fear"], selector: "will" }, { traits })).toBeNull();
    expect(saveVsOf(flat(["item:magical"], { value: 0 }), { traits })).toBeNull();
  });

  test("a creature's: its abilities', feats' and effects' rules, each once; not its gear's", () => {
    const magic = flat(["item:magical"]);
    const items = [
      { type: "action", system: { rules: [magic] } },
      { type: "action", system: { rules: [magic] } },
      { type: "feat", system: { rules: [flat([{ or: ["item:trait:disease", "item:trait:poison"] }], { value: 2 })] } },
      { type: "equipment", system: { rules: [flat(["item:trait:mental"], { type: "item", value: 2 })] } }
    ];
    expect(saveVsFrom(items, { traits })).toEqual([{ bonus: 1, type: "status", all: ["magical"] }, { bonus: 2, type: "status", vs: ["disease", "poison"] }]);
    expect(saveVsFrom([{ type: "action", system: { rules: [] } }], { traits })).toBeUndefined();
  });

  test("as the core reads it: against a spell, not a sword; the best status bonus of the two", () => {
    const spec = { saveVs: saveVsFrom([{ type: "action", system: { rules: [flat(["item:magical"]), flat(["item:trait:arcane"], { value: 2 })] } }], { traits }) };
    expect(saveVsBonus({ spec }, "will", { action: { rank: 1, traits: ["arcane", "mental"] } }).bonus).toBe(2);
    expect(saveVsBonus({ spec }, "will", { action: { rank: 1, traits: ["primal"] } }).bonus).toBe(1);
    expect(saveVsBonus({ spec }, "will", { action: { kind: "strike", traits: ["agile"] } }).bonus).toBe(0);
  });
});
