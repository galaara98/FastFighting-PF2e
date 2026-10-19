/**
 * What FastFighting PF2e writes as HTML from what others wrote stays words: an affliction's save on its effect, a name
 * in a card's flavor (PF2e enriches it, so [[...]] or @UUID[...] in it would come alive on the GM's card); and a rule
 * element's formula calls only the functions it knows, none of an object's own.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { afflictionItem, saveName } from "../scripts/commit.js";
import { checkFlavor, damageFlavor, resultBlock } from "../scripts/table-cards.js";
import { ruleValue } from "../scripts/effects.js";

const before = {};
beforeEach(() => {
  before.CONFIG = globalThis.CONFIG;
  globalThis.CONFIG = { PF2E: { saves: { fortitude: "PF2E.SavesFortitude", reflex: "PF2E.SavesReflex", will: "PF2E.SavesWill" } } };
  const own = game.i18n.localize.bind(game.i18n);
  game.i18n.localize = key => (key === "PF2E.SavesFortitude" ? "Fortitude" : own(key));
});
afterEach(() => { globalThis.CONFIG = before.CONFIG; });

describe("an affliction's effect", () => {
  test("names its save as PF2e does, one of PF2e's saves only", () => {
    expect(saveName("fortitude")).toBe("Fortitude");
    expect(saveName("<img src=x onerror=alert(1)>")).toBe("");
    expect(saveName("constructor")).toBe("");
    expect(saveName(null)).toBe("");
  });

  test("its description holds nothing of the affliction but numbers and PF2e's save name", () => {
    game.pf2e = { settings: { metagame: { dcs: true } } };
    const shown = afflictionItem({ id: "a.1", name: "Wyvern Poison", stage: 2, onset: 0, save: "fortitude", dc: 22 }).system.description.value;
    expect(shown).toContain("Fortitude");
    expect(shown).toContain("22");
    const planted = afflictionItem({ id: "a.1", name: "x", stage: "<b>", onset: "[[/r 1]]", save: "<img src=x onerror=alert(1)>", dc: "@UUID[Actor.x]" }).system.description.value;
    expect(planted).not.toMatch(/<img|<b>|\[\[|@UUID/);
  });
});

describe("a card's flavor", () => {
  test("a name with [[...]] or @UUID[...] in it stays words", () => {
    const name = "[[/r 1d6]] @UUID[Actor.x]{Boss} <b>";
    for ( const html of [damageFlavor(name), checkFlavor(name), checkFlavor("Strike", resultBlock({ degree: 2, total: 20, dc: 15, dcType: "AC", opposer: { name, visible: true }, dcVisible: true, resultVisible: true }))] ) {
      expect(html).not.toMatch(/\[\[|@UUID\[|<b>/);
    }
    expect(damageFlavor("Greataxe")).toBe('<h4 class="action"><strong>Greataxe</strong></h4>');
  });
});

describe("a rule element's formula", () => {
  test("calls only the functions it knows, none of an object's own", () => {
    expect(ruleValue("max(2,3)")).toBe(3);
    for ( const f of ["constructor(1)", "toString(1)", "valueOf(1)", "hasOwnProperty(1)", "__proto__(1)"] ) expect(ruleValue(f)).toBeNull();
  });
});
