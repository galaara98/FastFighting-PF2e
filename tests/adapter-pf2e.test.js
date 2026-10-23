/**
 * What the adapter reads of a PF2e character that needs no Foundry: its dying numbers, its Ferocity, a spell on itself,
 * and how an item's text is enriched to work out its formulas (PF2e's own enrichers only, nothing that rolls, links or
 * embeds).
 */
import { afterEach, describe, expect, test } from "vitest";
import { Pf2eAdapter, dyingOf, ferocityOf, resolvedText, selfOnlySpell } from "../scripts/adapter.js";

describe("its dying numbers, as PF2e works them out", () => {
  test("Diehard's dying 5 and Toughness's recovery DC 9; the doomed value PF2e took off goes back on", () => {
    expect(dyingOf({ dying: { value: 0, max: 4, recoveryDC: 10 }, doomed: { value: 0 } })).toEqual({ dyingMax: 4, recoveryDC: 10 });
    expect(dyingOf({ dying: { value: 0, max: 5, recoveryDC: 9 }, doomed: { value: 0 } })).toEqual({ dyingMax: 5, recoveryDC: 9 });
    expect(dyingOf({ dying: { value: 0, max: 3, recoveryDC: 10 }, doomed: { value: 2 } }).dyingMax).toBe(5);
    // (A hazard has none: the rules' own numbers stand.)
    expect(dyingOf({})).toEqual({});
    expect(dyingOf(undefined)).toEqual({});
  });
});

describe("its Ferocity, by slug", () => {
  const item = (slug, name, extra = {}) => ({ slug, name, system: { slug, ...extra } });

  test("a character's Orc Ferocity: as often as its frequency has left today; Undying Ferocity adds its level", () => {
    expect(ferocityOf([item("orc-ferocity", "Orc Ferocity", { frequency: { max: 1, per: "day" } })], 5))
      .toEqual({ label: "Orc Ferocity", uses: 1, untilWounded: null, temp: 0 });
    expect(ferocityOf([item("orc-ferocity", "Orc Ferocity", { frequency: { max: 1, per: "day", value: 0 } })], 5).uses).toBe(0);
    expect(ferocityOf([item("orc-ferocity", "Orc Ferocity", { frequency: { max: 1, per: "day" } }), item("undying-ferocity", "Undying Ferocity")], 5).temp).toBe(5);
  });

  test("a creature's Ferocity: no frequency, until it's wounded 3; none without it", () => {
    expect(ferocityOf([item("ferocity", "Ferocity")], 2)).toEqual({ label: "Ferocity", uses: null, untilWounded: 3, temp: 0 });
    expect(ferocityOf([item("diehard", "Diehard")], 2)).toBeNull();
    expect(ferocityOf(undefined, 2)).toBeNull();
  });
});

describe("a spell that reaches only its caster", () => {
  test("no range, no area, no target: on itself (a heal from it heals only itself); otherwise it reaches others", () => {
    const spell = (range, target, area = null) => ({ range: { value: range }, target: { value: target }, area });
    // (As PF2e's own spells have them: Harmonize Self; Heal, Soothe, Lay on Hands; Garden of Healing.)
    expect(selfOnlySpell(spell("", ""))).toBe(true);
    expect(selfOnlySpell({})).toBe(true);
    expect(selfOnlySpell(spell("varies", "1 willing living creature or 1 undead"))).toBe(false);
    expect(selfOnlySpell(spell("30 feet", "1 willing creature"))).toBe(false);
    expect(selfOnlySpell(spell("touch", "1 willing living creature or 1 undead creature"))).toBe(false);
    expect(selfOnlySpell(spell("", "", { type: "emanation", value: 10 }))).toBe(false);
  });
});

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

describe("the core's settings as PF2e has them (API 28)", () => {
  test("a stalemate after 6 to 16 rounds, 12 at first; the Lore-Collector's advantage 2×, in this module's words", () => {
    expect(Pf2eAdapter.prototype.settingDefaults()).toEqual({
      maxRounds: { min: 6, max: 16, default: 12 },
      loreBoost: { default: 2, name: "FFPF2E.Settings.loreBoost.Name", hint: "FFPF2E.Settings.loreBoost.Hint" }
    });
  });
});
