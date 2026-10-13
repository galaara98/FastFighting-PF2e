/**
 * What the adapter does with a PF2e item that needs no Foundry: how an item's text is enriched to work out its formulas
 * (PF2e's own enrichers only, nothing that rolls, links or embeds).
 */
import { afterEach, describe, expect, test } from "vitest";
import { resolvedText } from "../scripts/adapter.js";

describe("working out an item's formulas", () => {
  const before = { foundry: globalThis.foundry, DOMParser: globalThis.DOMParser };
  afterEach(() => Object.assign(globalThis, before));

  test("PF2e's own enrichers only: no inline roll, document link, hyperlink, embed or secret; links already labels", async () => {
    const seen = [];
    globalThis.foundry = { applications: { ux: { TextEditor: { implementation: { enrichHTML: async (html, options) => { seen.push({ html, options }); return html; } } } } } };
    globalThis.DOMParser = class { parseFromString() { return { body: { querySelectorAll: () => [] } }; } };
    const desc = "<p>@Damage[(@actor.level)d6[fire]] [[/r 1d20]] @UUID[Compendium.pf2e.conditionitems.Item.x]{Frightened} @Embed[Compendium.pf2e.journals.JournalEntry.y]</p>";
    const item = { system: { description: { value: desc } }, getRollData: () => ({}) };
    await resolvedText(item);
    expect(seen).toHaveLength(1);
    expect(seen[0].options).toMatchObject({ rolls: false, embeds: false, documents: false, links: false, secrets: false, relativeTo: item });
    expect(seen[0].html).not.toMatch(/@UUID|@Embed/);
    expect(seen[0].html).toContain("Frightened");
  });
});
