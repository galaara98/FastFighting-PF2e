import { describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";

const adapter = new Pf2eAdapter();

describe("PF2e's own cards as turns go (systemTurnCard, API 40)", () => {
  test("its Current Conditions card as a creature's turn begins is one", () => {
    expect(adapter.systemTurnCard({ content: "<div class=\"participant-conditions\">\n    <h4>Current Conditions</h4></div>" })).toBe(true);
  });

  test("anything else isn't: a GM's words, a roll's card, nothing", () => {
    expect(adapter.systemTurnCard({ content: "<p>Current Conditions are grim.</p>" })).toBe(false);
    expect(adapter.systemTurnCard({ content: "<div class=\"dice-roll\"></div>" })).toBe(false);
    expect(adapter.systemTurnCard(null)).toBe(false);
  });
});
