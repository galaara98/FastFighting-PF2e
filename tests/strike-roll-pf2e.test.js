/**
 * API 19, Strikes in a live battle: a Strike rolled with PF2e's own roller (the engine's strike found by the id the
 * adapter gave it, the variant for the attacks before it rolled at the target with no dialog, the degree, natural die
 * and total read, and on a hit its damage or critical damage by type as rolled; for the GMs only when it's secret); and
 * whether a critical Reactive Strike disrupts what a card did (a manipulate action).
 */
import { beforeEach, describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";

const adapter = new Pf2eAdapter();

/** PF2e's check roll, as a Strike's variant returns it: its degree of success (0-3), total and d20. */
const checkRoll = (degree, total = 21, natural = 13) => ({ degreeOfSuccess: degree, total, dice: [{ faces: 20, total: natural }] });

/** PF2e's damage roll: its instances, [type, total, persistent] (a persistent one's total is 0 until it's rolled). */
const damageRoll = parts => ({ instances: parts.map(([type, total, persistent = false]) => ({ type, total: persistent ? 0 : total, persistent, kinds: new Set(["damage"]) })) });

/**
 * A Strike as PF2e lists it in an actor's system.actions: three variants (no MAP, then the penalties) and its damage
 * and critical rolls, each keeping what it was asked. `degree` null: PF2e rolled nothing (out of range, no ammunition).
 */
function strike(slug, { degree = 2, visible = true, hit = [["slashing", 7], ["slashing", 2], ["fire", 3]], crit = [["slashing", 18], ["fire", 6], ["fire", 4, true]] } = {}) {
  const asked = {};
  return {
    type: "strike", slug, label: slug, visible, asked,
    variants: [0, 1, 2].map(n => ({ roll: async params => { asked.attack = { variant: n, ...params }; return degree === null ? null : checkRoll(degree); } })),
    damage: async params => { asked.damage = params; return damageRoll(hit); },
    critical: async params => { asked.critical = params; return damageRoll(crit); }
  };
}

/** An orc's token, its Strikes in its system.actions (with something else listed there too). */
function orc(...strikes) {
  const actor = { id: "orc1", uuid: "Scene.s.Token.t1.Actor.orc1", system: { actions: [{ type: "spell" }, ...strikes] } };
  return { uuid: "Scene.s.Token.t1", actor };
}

/** The hero's token it strikes: drawn on the canvas, or not. */
function hero({ drawn = true } = {}) {
  const doc = { uuid: "Scene.s.Token.pc1" };
  doc.object = drawn ? { document: doc } : null;
  return doc;
}

/** The attack's card, as PF2e's Check.roll writes its context. */
const attackCard = (actor, target) => ({ flags: { pf2e: { context: { type: "attack-roll", origin: { actor, token: "Scene.s.Token.t1" }, target: { actor: "Actor.pc", token: target } } } } });

let mine;
beforeEach(() => {
  mine = new Set(["someone"]);
  globalThis.game.user = { settings: { showCheckDialogs: true, showDamageDialogs: false }, targets: mine };
  globalThis.game.messages = { contents: [] };
});

describe("a Strike, rolled with PF2e's own roller", () => {
  test("found by the engine's id, its first variant rolled at the target with no dialog; the degree, natural die and total; a hit's damage by type", async () => {
    const jaws = strike("jaws", { visible: false });
    const claw = strike("claw");
    const tail = strike("tail");
    const token = orc(jaws, claw, tail);
    const target = hero();
    const card = attackCard(token.actor.uuid, target.uuid);
    game.messages.contents = [card, attackCard("Scene.s.Token.t9.Actor.gob", target.uuid)];
    // (The adapter's id: the actor's, the Strike's slug, and where it is among the Strikes the sheet shows.)
    const out = await adapter.rollStrike(token, { action: { id: "orc1.strike.tail.1", name: "Tail" }, target });
    expect(out).toEqual({ attack: { degree: 2, natural: 13, total: 21 }, damage: { byType: { slashing: 9, fire: 3 } } });
    expect(claw.asked).toEqual({});
    // (No multiple attack penalty; the target PF2e's own; Shift down, as the user's dialogs are on, so none opens.)
    expect(tail.asked.attack).toMatchObject({ variant: 0, target: target.object, event: { shiftKey: true, ctrlKey: false, metaKey: false } });
    // (Its damage at the same target, no MAP increase, the attack's card's context, as PF2e's Damage button passes them.)
    expect(tail.asked.damage).toMatchObject({ target: target.object, mapIncreases: 0, event: { shiftKey: false } });
    expect(tail.asked.damage.checkContext).toBe(card.flags.pf2e.context);
    expect(tail.asked.critical).toBeUndefined();
    // (The user's own targets, as they were.)
    expect(game.user.targets).toBe(mine);
    expect([...mine]).toEqual(["someone"]);
  });

  test("the attacks before it this turn: the variant with that multiple attack penalty, and its damage's map:increases (none past the third)", async () => {
    for ( const [attackNumber, variant] of [[1, 1], [2, 2], [5, 2], [-1, 0], ["x", 0]] ) {
      const claw = strike("claw");
      await adapter.rollStrike(orc(claw), { action: { id: "orc1.strike.claw.0" }, target: hero(), attackNumber });
      expect(claw.asked.attack.variant).toBe(variant);
      expect(claw.asked.damage.mapIncreases).toBe(variant);
    }
  });

  test("secret: Ctrl down for the attack and its damage, as PF2e rolls a GM's roll for the GMs only", async () => {
    const claw = strike("claw");
    await adapter.rollStrike(orc(claw), { action: { id: "orc1.strike.claw.0" }, target: hero(), secret: true });
    expect(claw.asked.attack.event.ctrlKey).toBe(true);
    expect(claw.asked.damage.event.ctrlKey).toBe(true);
  });

  test("a critical hit: its critical damage, as PF2e doubles it, persistent damage left out", async () => {
    const claw = strike("claw", { degree: 3 });
    const out = await adapter.rollStrike(orc(claw), { action: { id: "orc1.strike.claw.0" }, target: hero() });
    expect(out).toEqual({ attack: { degree: 3, natural: 13, total: 21 }, damage: { byType: { slashing: 18, fire: 6 } } });
    expect(claw.asked.damage).toBeUndefined();
    expect(claw.asked.critical).toMatchObject({ mapIncreases: 0 });
  });

  test("a miss or a critical miss: no damage rolled", async () => {
    for ( const degree of [1, 0] ) {
      const claw = strike("claw", { degree });
      const out = await adapter.rollStrike(orc(claw), { action: { id: "orc1.strike.claw.0" }, target: hero() });
      expect(out).toEqual({ attack: { degree, natural: 13, total: 21 }, damage: null });
      expect(claw.asked.damage).toBeUndefined();
      expect(claw.asked.critical).toBeUndefined();
    }
  });

  test("a Strike built on another (a stratagem) is that Strike; with the sheet's Strikes changed since, the one of the id's slug", async () => {
    const claw = strike("claw");
    await adapter.rollStrike(orc(claw), { action: { id: "orc1.strike.claw.0.stratagem" }, target: hero() });
    expect(claw.asked.attack.variant).toBe(0);
    const moved = strike("claw");
    await adapter.rollStrike(orc(strike("bite"), moved), { action: { id: "orc1.strike.claw.0" }, target: hero() });
    expect(moved.asked.attack).toBeDefined();
  });

  test("a target not drawn on this canvas goes by its document; with the user's dialogs off, Shift stays up", async () => {
    game.user.settings = { showCheckDialogs: false, showDamageDialogs: true };
    const claw = strike("claw");
    const target = hero({ drawn: false });
    await adapter.rollStrike(orc(claw), { action: { id: "orc1.strike.claw.0" }, target });
    expect(claw.asked.attack).toMatchObject({ target: { document: target }, event: { shiftKey: false } });
    expect(claw.asked.damage).toMatchObject({ target: { document: target }, event: { shiftKey: true } });
  });

  test("none where it can't: no such Strike (an Elemental Blast, another's), no target, or a roll PF2e didn't make", async () => {
    const claw = strike("claw");
    const token = orc(claw);
    expect(await adapter.rollStrike(token, { action: { id: "orc1.blast.fire.melee" }, target: hero() })).toBeNull();
    expect(await adapter.rollStrike(token, { action: { id: "orc2.strike.claw.0" }, target: hero() })).toBeNull();
    expect(await adapter.rollStrike(token, { action: { id: "orc1.strike.claw.0" }, target: null })).toBeNull();
    expect(await adapter.rollStrike({ actor: null }, { action: { id: "orc1.strike.claw.0" }, target: hero() })).toBeNull();
    expect(claw.asked).toEqual({});
    expect(await adapter.rollStrike(orc(strike("claw", { degree: null })), { action: { id: "orc1.strike.claw.0" }, target: hero() })).toBeNull();
  });
});

describe("what a critical Reactive Strike disrupts", () => {
  test("a manipulate action: a spell cast with its hands, an action whose traits or roll options say so", () => {
    const spell = { flags: { pf2e: { origin: { type: "spell", rollOptions: ["origin:item:spell", "origin:item:trait:concentrate", "origin:item:trait:manipulate"] } } } };
    expect(adapter.disruptsAction(spell)).toBe(true);
    expect(adapter.disruptsAction({ flags: { pf2e: { context: { type: "skill-check", traits: ["manipulate"], options: [] } } } })).toBe(true);
    expect(adapter.disruptsAction({ flags: { pf2e: { context: { type: "attack-roll", options: ["item:ranged", "self:action:trait:manipulate"] } } } })).toBe(true);
  });

  test("not a ranged attack without manipulate, a concentrate spell, a save against a manipulate spell, the target's traits, or odd data", () => {
    expect(adapter.disruptsAction({ flags: { pf2e: { context: { type: "attack-roll", traits: ["attack"], options: ["item:ranged", "item:trait:volley-30"] } } } })).toBe(false);
    expect(adapter.disruptsAction({ flags: { pf2e: { origin: { type: "spell", rollOptions: ["origin:item:trait:concentrate"] } } } })).toBe(false);
    expect(adapter.disruptsAction({ flags: { pf2e: { context: { type: "saving-throw", traits: ["manipulate"], options: ["item:trait:manipulate"] } } } })).toBe(false);
    expect(adapter.disruptsAction({ flags: { pf2e: { context: { type: "skill-check", options: ["target:trait:manipulate"] } } } })).toBe(false);
    expect(adapter.disruptsAction({ flags: { pf2e: { origin: { rollOptions: "trait:manipulate" }, context: { traits: "manipulate", options: 7 } } } })).toBe(false);
    expect(adapter.disruptsAction({})).toBe(false);
    expect(adapter.disruptsAction(null)).toBe(false);
  });
});
