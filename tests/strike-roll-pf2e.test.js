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
const attackCard = (actor, target, author = "gm") => ({ author: { id: author }, flags: { pf2e: { context: { type: "attack-roll", origin: { actor, token: "Scene.s.Token.t1" }, target: { actor: "Actor.pc", token: target } } } } });

let mine;
beforeEach(() => {
  mine = new Set(["someone"]);
  globalThis.game.user = { id: "gm", settings: { showCheckDialogs: true, showDamageDialogs: false }, targets: mine };
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

/** A damage card in the chat, as PF2e's DamagePF2e.roll makes it: the actor its speaker; its flags set as setFlag sets them. */
function damageCardOf(id, actorId = "orc1", author = "gm") {
  const m = { id, speaker: { actor: actorId }, author: { id: author }, flags: { pf2e: { context: { type: "damage-roll" } } } };
  m.setFlag = async (scope, key, value) => {
    (m.flags[scope] ??= {})[key] = value;
    return m;
  };
  return m;
}

describe("a Strike's damage card", () => {
  test("the one its damage roll made, the actor's: marked as FastFighting's (its Apply buttons gone) and named, for the core to apply", async () => {
    const claw = strike("claw");
    const made = damageCardOf("dmg1");
    claw.damage = async params => {
      claw.asked.damage = params;
      game.messages.contents.push(damageCardOf("other", "gob1"), made);
      return damageRoll([["slashing", 7]]);
    };
    const out = await adapter.rollStrike(orc(claw), { action: { id: "orc1.strike.claw.0" }, target: hero() });
    expect(out).toEqual({ attack: { degree: 2, natural: 13, total: 21 }, damage: { byType: { slashing: 7 } }, card: "dmg1" });
    expect(made.flags["fast-fighting-pf2e"]).toEqual({ rolled: { times: 1 } });
    expect(game.messages.contents[0].flags["fast-fighting-pf2e"]).toBeUndefined();
  });

  test("never another's card for the same creature, posted meanwhile: only the one made here", async () => {
    const claw = strike("claw");
    const made = damageCardOf("dmg1");
    const forged = damageCardOf("lin's", "orc1", "lin");
    claw.damage = async params => {
      claw.asked.damage = params;
      game.messages.contents.push(made, forged);
      return damageRoll([["slashing", 7]]);
    };
    const out = await adapter.rollStrike(orc(claw), { action: { id: "orc1.strike.claw.0" }, target: hero() });
    expect(out.card).toBe("dmg1");
    expect(forged.flags["fast-fighting-pf2e"]).toBeUndefined();
  });
});

describe("a spell attack, rolled as its card's buttons roll it", () => {
  /** An attack spell on the orc's sheet, from a spellcasting entry: its Attack and Damage buttons' rolls, keeping what they were asked. */
  function ray({ degree = 2, damage = { 0: { formula: "2d6", type: "fire" } }, hit = [["fire", 9], ["fire", 2, true]] } = {}) {
    const asked = {};
    return {
      id: "sp1", type: "spell", isAttack: true, system: { damage }, spellcasting: { statistic: { slug: "arcane" } }, asked,
      rollAttack: async (event, attackNumber, context) => {
        asked.attack = { event, attackNumber, context };
        return degree === null ? null : checkRoll(degree, 19, 12);
      },
      rollDamage: async (event, map) => {
        asked.damage = { event, map };
        game.messages.contents.push(damageCardOf("dmg1"));
        return damageRoll(hit);
      }
    };
  }

  /** The orc, the spell on its sheet. */
  const caster = spell => ({ uuid: "Scene.s.Token.t1", actor: { id: "orc1", uuid: "Scene.s.Token.t1.Actor.orc1", system: { actions: [] }, items: new Map([[spell.id, spell]]) } });

  /** The hero it's cast at: drawn here, or not. */
  const at = ({ drawn = true } = {}) => {
    const doc = { uuid: "Scene.s.Token.pc1", actor: { id: "pc" } };
    doc.object = drawn ? { document: doc } : null;
    return doc;
  };

  test("its attack at the target's actor, no dialog; a hit's damage by its Damage button, its card marked and named; the user's targets untouched", async () => {
    const spell = ray();
    const target = at();
    const out = await adapter.rollStrike(caster(spell), { action: { id: "orc1.spell.sp1", name: "Ray" }, target });
    expect(out).toEqual({ attack: { degree: 2, natural: 12, total: 19 }, damage: { byType: { fire: 9 } }, card: "dmg1" });
    expect(spell.asked.attack).toEqual({ event: { shiftKey: true, ctrlKey: false, metaKey: false }, attackNumber: 1, context: { target: target.actor } });
    expect(spell.asked.damage).toEqual({ event: { shiftKey: false, ctrlKey: false, metaKey: false }, map: undefined });
    expect(game.messages.contents[0].flags["fast-fighting-pf2e"]).toEqual({ rolled: { times: 1 } });
    expect([...game.user.targets]).toEqual(["someone"]);
  });

  test("the attacks before it: PF2e's attack number (no further than the third); secret: Ctrl down for both", async () => {
    for ( const [attackNumber, number] of [[1, 2], [2, 3], [5, 3], [-1, 1]] ) {
      const spell = ray();
      await adapter.rollStrike(caster(spell), { action: { id: "orc1.spell.sp1" }, target: at(), attackNumber });
      expect(spell.asked.attack.attackNumber).toBe(number);
    }
    const spell = ray();
    await adapter.rollStrike(caster(spell), { action: { id: "orc1.spell.sp1" }, target: at(), secret: true });
    expect([spell.asked.attack.event.ctrlKey, spell.asked.damage.event.ctrlKey]).toEqual([true, true]);
  });

  test("a critical hit: the hit's card, which PF2e doubles as it's applied: byType doubled, the card marked to be applied doubled", async () => {
    const spell = ray({ degree: 3 });
    const out = await adapter.rollStrike(caster(spell), { action: { id: "orc1.spell.sp1" }, target: at() });
    expect(out).toEqual({ attack: { degree: 3, natural: 12, total: 19 }, damage: { byType: { fire: 18 } }, card: "dmg1" });
    expect(game.messages.contents[0].flags["fast-fighting-pf2e"]).toEqual({ rolled: { times: 2 } });
  });

  test("a miss: no damage rolled; none where it can't (a target not drawn here, none, a roll PF2e didn't make); a spell attack with no damage isn't one", async () => {
    const missed = ray({ degree: 1 });
    expect(await adapter.rollStrike(caster(missed), { action: { id: "orc1.spell.sp1" }, target: at() })).toEqual({ attack: { degree: 1, natural: 12, total: 19 }, damage: null });
    expect(missed.asked.damage).toBeUndefined();
    const spell = ray();
    expect(await adapter.rollStrike(caster(spell), { action: { id: "orc1.spell.sp1" }, target: at({ drawn: false }) })).toBeNull();
    expect(await adapter.rollStrike(caster(spell), { action: { id: "orc1.spell.sp1" }, target: null })).toBeNull();
    expect(await adapter.rollStrike(caster(spell), { action: { id: "orc1.spell.sp1.affliction" }, target: at() })).toBeNull();
    expect(spell.asked).toEqual({});
    expect(await adapter.rollStrike(caster(ray({ degree: null })), { action: { id: "orc1.spell.sp1" }, target: at() })).toBeNull();
    const control = ray({ damage: {} });
    expect(await adapter.rollStrike(caster(control), { action: { id: "orc1.spell.sp1" }, target: at() })).toBeNull();
    expect(control.asked).toEqual({});
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
