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

  test("a skill action at a creature is its maneuver; a Diplomacy roll is words for the GM", () => {
    const [trip] = readPf2eTurn([card({ type: "skill-check", options: ["action:trip"], title: "Trip" })], context);
    expect(trip).toMatchObject({ type: "control", maneuver: "trip", took: true, degree: 2, sure: true });
    const [talk] = readPf2eTurn([card({ type: "skill-check", outcome: null, dc: null, domains: ["diplomacy"], title: "Diplomacy" })], context);
    expect(talk).toMatchObject({ type: "talk", kind: "persuade", targetId: "B", degree: null, sure: false });
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
  });
});
