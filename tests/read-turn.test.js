import { describe, expect, test } from "vitest";
import { readPf2eTurn, pf2eOpening } from "../scripts/read-turn.js";

/** A PF2e card: its context (type, outcome, target, options, domains), speaker and rolls. */
const card = ({ type = "attack-roll", outcome = "success", target = "Scene.s.Token.tokB", options = [], domains = [], dc = 18, total = 20, natural = 12, origin = null, title = "Strike: Longsword" } = {}) => ({
  speaker: { token: "tokA" },
  flags: { pf2e: { context: { type, outcome, target: target ? { token: target } : null, options, domains, dc: dc === null ? null : { value: dc }, title, token: "Scene.s.Token.tokA" }, ...(origin ? { origin } : {}) } },
  rolls: [{ total, dice: [{ faces: 20, total: natural }] }]
});
const context = { tokenId: "tokA", ids: { tokA: "A", tokB: "B" } };

describe("a player's turn read from PF2e's cards", () => {
  test("a Strike, how it went, and its damage roll's damage", () => {
    const events = readPf2eTurn([
      card({ outcome: "criticalSuccess", options: ["item:melee"] }),
      { ...card({ type: "damage-roll", outcome: "criticalSuccess" }), rolls: [{ total: 14, instances: [{ type: "slashing" }] }] }
    ], context);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "attack", targetId: "B", degree: 3, melee: true, damage: 14, damageType: "slashing", sure: true });
  });

  test("a card with odd data (made by hand) is passed over, not the turn's other cards", () => {
    const odd = card({ type: "skill-check", options: ["action:trip"] });
    odd.flags.pf2e.context.domains = "diplomacy";
    const thrown = card();
    thrown.flags.pf2e.context.traits = { thrown: true };
    const proto = card({ outcome: "toString", target: "Scene.s.Token.constructor" });
    const events = readPf2eTurn([odd, thrown, proto, card({ outcome: "failure", options: ["item:melee"] })], context);
    expect(events.map(e => e.type)).toEqual(["control", "attack", "attack"]);
    expect(events[2]).toMatchObject({ targetId: "B", degree: 1 });
  });

  test("Recall Knowledge at a creature is a size-up, as it went (a critical success's hints the GM may share)", () => {
    const [study] = readPf2eTurn([card({ type: "skill-check", outcome: "criticalSuccess", options: ["action:recall-knowledge"], title: "Recall Knowledge", total: 35, natural: 18, dc: 20 })], context);
    expect(study).toMatchObject({ type: "study", targetId: "B", degree: 3, total: 35, natural: 18, dc: 20, sure: true });
    expect(readPf2eTurn([card({ type: "skill-check", options: ["action:recall-knowledge"], target: null })], context)).toEqual([]);
  });

  test("a skill action at a creature is its maneuver; a Diplomacy roll is words for the GM", () => {
    const [trip] = readPf2eTurn([card({ type: "skill-check", options: ["action:trip"], title: "Trip" })], context);
    expect(trip).toMatchObject({ type: "control", maneuver: "trip", took: true, degree: 2, sure: true });
    const [talk] = readPf2eTurn([card({ type: "skill-check", outcome: null, dc: null, domains: ["diplomacy"], title: "Diplomacy" })], context);
    expect(talk).toMatchObject({ type: "talk", kind: "persuade", targetId: "B", degree: null, sure: false });
  });
});

describe("PF2e's social actions, words at whom the card says", () => {
  /** PF2e's action card (its header as the card's title), a skill check by its action's roll option, at tokB, against Will. */
  const action = (slug, skill, { outcome = "failure", target = "Scene.s.Token.tokB", dc = 17, name = slug } = {}) => card({
    type: "skill-check", outcome, target, dc, natural: 9, total: 15,
    options: [`action:${slug}`, "item:trait:auditory", "item:trait:mental", "self:type:character"],
    domains: ["all", "skill-check", skill, "cha-based", "cha-skill-check"],
    title: `<h4 class="action"><strong>${name}</strong><span class="action-glyph">1</span><span class="subtitle">(${skill})</span></h4>`
  });

  test("Demoralize: its maneuver (the frightened is the sheet's) and a threat at its target, both as the card went", () => {
    const events = readPf2eTurn([action("demoralize", "intimidation")], context);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "control", maneuver: "demoralize", targetId: "B", took: false, degree: 1, natural: 9, total: 15, sure: true });
    expect(events[1]).toMatchObject({ type: "talk", kind: "intimidate", targetId: "B", degree: 1, natural: 9, total: 15, dc: 17, sure: true });
  });

  test("Request and Make an Impression persuade, Coerce threatens, Lie deceives: each one talk, sure", () => {
    const events = readPf2eTurn([
      action("request", "diplomacy", { outcome: "success" }), action("make-an-impression", "diplomacy", { outcome: "criticalSuccess" }),
      action("coerce", "intimidation", { outcome: "criticalFailure" }), action("lie", "deception", { dc: 19 })
    ], context);
    expect(events.map(e => [e.type, e.kind, e.degree, e.targetId, e.sure])).toEqual([
      ["talk", "persuade", 2, "B", true], ["talk", "persuade", 3, "B", true], ["talk", "intimidate", 0, "B", true], ["talk", "deceive", 1, "B", true]
    ]);
    expect(events[3].dc).toBe(19);
  });

  test("with no target or no DC it isn't sure (the GM looks, as for any words); Demoralize has no maneuver then", () => {
    const [aimless] = readPf2eTurn([action("coerce", "intimidation", { target: null })], context);
    expect(aimless).toMatchObject({ type: "talk", kind: "intimidate", targetId: null, degree: 1, sure: false });
    const [open] = readPf2eTurn([action("request", "diplomacy", { outcome: null, dc: null })], context);
    expect(open).toMatchObject({ type: "talk", kind: "persuade", targetId: "B", degree: null, dc: null, sure: false });
    const scare = readPf2eTurn([action("demoralize", "intimidation", { target: null })], context);
    expect(scare.map(e => [e.type, e.kind, e.sure])).toEqual([["talk", "intimidate", false]]);
  });

  test("a plain Intimidation or Deception roll at it, with its DC: words still, for the GM to look at", () => {
    const plain = card({ type: "skill-check", outcome: "success", domains: ["all", "skill-check", "deception"], title: "Deception Check" });
    expect(readPf2eTurn([plain], context)).toEqual([expect.objectContaining({ type: "talk", kind: "deceive", targetId: "B", degree: 2, skill: "Deception Check", sure: false })]);
  });

  test("named as PF2e names the action (its card's header is markup), else by the card's title", () => {
    game.pf2e = { actions: new Map([["coerce", { name: "PF2E.Actions.Coerce.Title" }]]) };
    const words = game.i18n;
    game.i18n = { ...words, has: k => k === "PF2E.Actions.Coerce.Title" || words.has(k), localize: k => (k === "PF2E.Actions.Coerce.Title" ? "Coerce" : words.localize(k)) };
    const [named] = readPf2eTurn([action("coerce", "intimidation")], context);
    expect(named.skill).toBe("Coerce");
    const [scare, words2] = readPf2eTurn([action("demoralize", "intimidation")], context);
    expect(scare.action).toContain("demoralize");
    expect(words2.skill).toBe(scare.action);
  });
});

describe("a card that lowers the guard in a foe's reach (Reactive Strike)", () => {
  test("a ranged attack does; a melee one doesn't", () => {
    expect(pf2eOpening(card({ options: ["item:ranged"] }), "tokA")).toBe(true);
    expect(pf2eOpening(card({ options: ["item:melee"] }), "tokA")).toBe(false);
  });

  test("a card whose options aren't lists (made by hand) reads as nothing, without throwing", () => {
    expect(pf2eOpening({ speaker: { token: "tokA" }, flags: { pf2e: { origin: { rollOptions: "trait:manipulate" }, context: { options: 7 } } } }, "tokA")).toBe(false);
    expect(pf2eOpening({ speaker: { token: "tokA" }, flags: { pf2e: { context: { type: "attack-roll", options: "item:melee", domains: null } } } }, "tokA")).toBe(true);
  });

  test("anything with the manipulate trait does, by its roll options; someone else's card doesn't", () => {
    const spell = { speaker: { token: "tokA" }, flags: { pf2e: { origin: { type: "spell", rollOptions: ["origin:item:spell", "origin:item:trait:concentrate", "origin:item:trait:manipulate"] } } } };
    expect(pf2eOpening(spell, "tokA")).toBe(true);
    expect(pf2eOpening({ ...spell, flags: { pf2e: { origin: { type: "spell", rollOptions: ["origin:item:trait:concentrate"] } } } }, "tokA")).toBe(false);
    expect(pf2eOpening(spell, "tokB")).toBe(false);
    // (A save against a foe's manipulate spell is no action of the saver's: it lowers no guard.)
    const save = { speaker: { token: "tokA" }, flags: { pf2e: { context: { type: "saving-throw", options: ["item:trait:manipulate"] }, origin: { rollOptions: ["origin:item:trait:manipulate"] } } } };
    expect(pf2eOpening(save, "tokA")).toBe(false);
  });
});
