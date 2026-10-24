/**
 * PF2e's own parties (adapter.js partyMembers, core API 29): every party actor's members, for the Friendly Team; and
 * Trap Finder, PF2e's rule about saves against what a trap sets off (origin:trait:trap), counting against any hazard,
 * one the GM marked in FastFighting's tab too (the core's save-vs: a hazard is a trap).
 */
import { afterEach, describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { saveVsBonus } from "../../FastFighting/scripts/engine/behavior/save-vs.js";

const was = globalThis.game;
afterEach(() => { globalThis.game = was; });

describe("PF2e's party", () => {
  test("every party actor's members; none without one", () => {
    const party = { type: "party", members: [{ id: "amiri" }, { id: "lem" }] };
    globalThis.game = { ...was, actors: [party, { type: "character", id: "loner" }] };
    expect(new Pf2eAdapter().partyMembers()).toEqual(["amiri", "lem"]);
    globalThis.game = { ...was, actors: [] };
    expect(new Pf2eAdapter().partyMembers()).toEqual([]);
  });
});

describe("Trap Finder against a hazard", () => {
  test("its bonus against a hazard's effect, a trap-trait one or one the GM marked; not against a creature's", () => {
    const finder = { spec: { saveVs: [{ bonus: 1, type: "circumstance", from: ["trap"] }] } };
    expect(saveVsBonus(finder, "reflex", { action: { traits: [] }, from: { spec: { creatureTraits: ["trap", "mechanical"] } } }).bonus).toBe(1);
    expect(saveVsBonus(finder, "reflex", { action: { traits: [] }, from: { spec: { hazard: { once: true }, creatureTraits: [] } } }).bonus).toBe(1);
    expect(saveVsBonus(finder, "reflex", { action: { traits: [] }, from: { spec: { creatureTraits: ["goblin"] } } }).bonus).toBe(0);
  });
});
