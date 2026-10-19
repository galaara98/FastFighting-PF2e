/**
 * The damage cards FastFighting rolls and applies itself (rollStrike's, rollDamage's), marked as its own: their Apply
 * buttons gone as they're rendered, a line in their place, and PF2e's Apply entries off their chat menu, so no one
 * applies them a second time; other cards as PF2e has them. Only a GM's card is FastFighting's: a player may mark their
 * own card, and it stays theirs. A player's card whose damage the live battle applied itself (by the ids the core noted)
 * loses its Apply too.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hideApply, hideApplyMenu, timesOf, unmarkRolled } from "../scripts/cards.js";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { notedBy } from "../../FastFighting/scripts/foundry/applied-cards.js";

/** An element as the DOM has one: its children, replaced. */
const element = () => {
  const el = { children: [{ button: "apply" }, { button: "half" }] };
  el.replaceChildren = (...nodes) => { el.children = nodes; };
  return el;
};

/** A rendered card: its damage application sections (a splash roll has its own). */
const rendered = sections => ({ querySelectorAll: selector => (selector === ".damage-application" ? sections : []) });

const mine = (times = 1) => ({ id: "m1", author: { isGM: true }, flags: { "fast-fighting-pf2e": { rolled: { times } } } });
const theirs = { id: "m2", author: { isGM: false }, flags: { pf2e: {} } };
/** A player's own card, marked as if FastFighting had rolled it. */
const forged = (times = 10) => ({ id: "m3", author: { isGM: false }, flags: { "fast-fighting-pf2e": { rolled: { times } } } });

const was = { document: globalThis.document };
beforeEach(() => {
  globalThis.document = { createElement: tag => ({ tag }) };
  globalThis.game.messages = new Map([["m1", mine()], ["m2", theirs], ["m3", forged()]]);
});
afterEach(() => {
  globalThis.document = was.document;
});

describe("a damage card FastFighting rolled", () => {
  test("rendered: its Apply buttons gone, one line in their place saying FastFighting does it", () => {
    const sections = [element(), element()];
    hideApply(mine(), rendered(sections));
    expect(sections[0].children).toEqual([{ tag: "span", textContent: expect.any(String) }]);
    expect(sections[0].children[0].textContent).not.toBe("");
    expect(sections[1].children).toEqual([]);
  });

  test("another's card, as PF2e renders it", () => {
    const sections = [element()];
    hideApply(theirs, rendered(sections));
    hideApply(null, rendered(sections));
    expect(sections[0].children).toHaveLength(2);
  });

  test("the chat's menu: PF2e's Apply entries (full, half, double ...) not on FastFighting's cards; the rest as they were", () => {
    const apply = { label: "PF2E.DamageButton.FullContext", visible: () => true };
    const half = { label: "PF2E.DamageButton.HalfContext", visible: () => true };
    const reroll = { label: "PF2E.RerollMenu.HeroPoint", visible: () => true };
    const visible = reroll.visible;
    hideApplyMenu({}, [apply, half, reroll, null]);
    const li = id => ({ dataset: { messageId: id } });
    expect([apply.visible(li("m1")), half.visible(li("m1")), apply.visible(li("m2")), apply.visible(li("gone"))]).toEqual([false, false, true, true]);
    expect(reroll.visible).toBe(visible);
  });

  test("how many times over it's applied: as marked (a spell attack's critical hit, 2), else once", () => {
    expect([timesOf(mine(2)), timesOf(mine()), timesOf(theirs), timesOf(null), timesOf(mine(-1))]).toEqual([2, 1, 1, 1, 1]);
  });
});

describe("a player's own card, marked as FastFighting's", () => {
  test("is applied once, as rolled, and keeps its Apply buttons and menu entries", () => {
    expect(timesOf(forged(10))).toBe(1);
    expect(timesOf({ ...mine(2), author: null })).toBe(1);
    const sections = [element()];
    hideApply(forged(), rendered(sections));
    expect(sections[0].children).toHaveLength(2);
    const apply = { label: "PF2E.DamageButton.FullContext", visible: () => true };
    hideApplyMenu({}, [apply]);
    expect(apply.visible({ dataset: { messageId: "m3" } })).toBe(true);
    expect(apply.visible({ dataset: { messageId: "m1" } })).toBe(false);
  });
});

describe("a player's card whose damage the live battle applied itself", () => {
  // (A player's reaction strike, rolled on their screen when FastFighting asked, its damage applied by FastFighting.)
  const reaction = { id: "m4", author: { isGM: false }, flags: { pf2e: {} } };
  beforeEach(() => {
    globalThis.game.messages.set("m4", reaction);
    notedBy(id => id === "m4");
  });
  afterEach(() => notedBy(null));

  test("loses its Apply buttons and menu entries in the GM's browser, applied once as rolled", () => {
    const sections = [element()];
    hideApply(reaction, rendered(sections));
    expect(sections[0].children).toEqual([{ tag: "span", textContent: expect.any(String) }]);
    const apply = { label: "PF2E.DamageButton.FullContext", visible: () => true };
    hideApplyMenu({}, [apply]);
    expect(apply.visible({ dataset: { messageId: "m4" } })).toBe(false);
    expect(timesOf(reaction)).toBe(1);
  });

  test("only by the ids the core noted: a player's other cards, and one they flag as applied, keep theirs", () => {
    const flagged = { id: "m5", author: { isGM: false }, flags: { "fast-fighting": { applied: true } } };
    for ( const card of [theirs, forged(), flagged] ) {
      const sections = [element()];
      hideApply(card, rendered(sections));
      expect(sections[0].children).toHaveLength(2);
    }
    const apply = { label: "PF2E.DamageButton.FullContext", visible: () => true };
    hideApplyMenu({}, [apply]);
    expect([apply.visible({ dataset: { messageId: "m2" } }), apply.visible({ dataset: { messageId: "m3" } })]).toEqual([true, true]);
  });
});

describe("a card the table settles itself after all (the core's leaveToTable, API 21)", () => {
  /** A card of FastFighting's, its flags unset as Foundry unsets them. */
  const unsettable = card => Object.assign(card, { unsetFlag: async (scope, key) => { delete card.flags[scope][key]; } });

  test("its mark off: its Apply buttons back, as PF2e renders them", async () => {
    const card = unsettable(mine());
    await new Pf2eAdapter().leaveToTable(card);
    expect(card.flags["fast-fighting-pf2e"].rolled).toBeUndefined();
    const sections = [element()];
    hideApply(card, rendered(sections));
    expect(sections[0].children).toHaveLength(2);
  });

  test("only its own mark, on a GM's card: a player's card is left alone", async () => {
    const card = unsettable(forged());
    await unmarkRolled(card);
    expect(card.flags["fast-fighting-pf2e"].rolled).toEqual({ times: 10 });
    await unmarkRolled(null);
  });
});
