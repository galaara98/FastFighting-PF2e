/**
 * The damage cards FastFighting rolls and applies itself (rollStrike's, rollDamage's), marked as its own: their Apply
 * buttons gone as they're rendered, a line in their place, and PF2e's Apply entries off their chat menu, so no one
 * applies them a second time; other cards as PF2e has them.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hideApply, hideApplyMenu, timesOf } from "../scripts/cards.js";

/** An element as the DOM has one: its children, replaced. */
const element = () => {
  const el = { children: [{ button: "apply" }, { button: "half" }] };
  el.replaceChildren = (...nodes) => { el.children = nodes; };
  return el;
};

/** A rendered card: its damage application sections (a splash roll has its own). */
const rendered = sections => ({ querySelectorAll: selector => (selector === ".damage-application" ? sections : []) });

const mine = (times = 1) => ({ id: "m1", flags: { "fast-fighting-pf2e": { rolled: { times } } } });
const theirs = { id: "m2", flags: { pf2e: {} } };

const was = { document: globalThis.document };
beforeEach(() => {
  globalThis.document = { createElement: tag => ({ tag }) };
  globalThis.game.messages = new Map([["m1", mine()], ["m2", theirs]]);
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
