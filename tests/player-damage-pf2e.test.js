/**
 * API 19, players' damage in a live battle: a PF2e damage roll's card read (its total, damage or healing, the token
 * it's at, whether a save comes first), applied to a token as PF2e's own card applies it (its actor.applyDamage, on
 * the target's contextual copy, times the multiplier), with an undo record of everything as it was; and no PF2e
 * setting that applies players' damage itself.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";

/** PF2e's damage roll, as a card carries it (CONFIG.Dice.rolls has it by its name). */
class DamageRoll {
  constructor(total, { kinds = ["damage"], instances = null } = {}) {
    this.total = total;
    this.kinds = new Set(kinds);
    this.instances = instances ?? [{ type: "slashing", kinds: new Set(kinds) }];
  }

  alter(multiplier, addend) {
    const roll = new DamageRoll(Math.floor(this.total * multiplier) + addend, { kinds: [...this.kinds], instances: this.instances });
    roll.from = { multiplier, addend };
    return roll;
  }
}

const was = { CONFIG: globalThis.CONFIG };
beforeEach(() => {
  globalThis.CONFIG = { Dice: { rolls: [DamageRoll] }, PF2E: { damageTypes: { slashing: "", fire: "", vitality: "" }, chatDamageButtonShieldToggle: false } };
});
afterEach(() => {
  globalThis.CONFIG = was.CONFIG;
});

const adapter = new Pf2eAdapter();

/** A damage roll's card, its context as PF2e's DamagePF2e.roll writes it. */
function card({ type = "damage-roll", total = 12, kinds, instances, sourceType = "attack", outcome = "success", options = [], domains = ["damage"], target = "Scene.s.Token.orc", item = null, targetActor = null, origin = null } = {}) {
  const at = target ? { actor: "Scene.s.Token.orc.Actor.o", token: target } : null;
  return {
    id: "m1",
    flags: { pf2e: { context: { type, sourceType, outcome, options, domains, target: at }, target: at } },
    rolls: [new DamageRoll(total, { kinds, instances })],
    item, actor: origin, target: targetActor ? { actor: targetActor } : null
  };
}

describe("a damage roll's card, read", () => {
  test("a Strike's damage at a creature: its total, the token it's at, no save", () => {
    expect(adapter.damageCard(card({ total: 14 }))).toEqual({ amount: 14, kind: "damage", targets: ["orc"], save: false });
    // (At no one: no targets, for a GM to pick.)
    expect(adapter.damageCard(card({ target: null })).targets).toEqual([]);
  });

  test("a save first: a spell's (basic or not), Area Fire's, an effect whose text asks for one; not an attack's, nor one already saved against", () => {
    const save = over => adapter.damageCard(card({ sourceType: "save", outcome: null, target: null, ...over })).save;
    expect(save({ options: ["item:type:spell", "item:defense:reflex", "item:defense:basic"] })).toBe(true);
    expect(save({ options: ["item:type:spell", "item:defense:will"] })).toBe(true);
    expect(save({ domains: ["damage", "area-fire-damage"] })).toBe(true);
    expect(save({ item: { type: "feat", system: { description: { value: "<p>@Damage[2d6[fire]] damage (@Check[reflex|against:class|basic]).</p>" } } } })).toBe(true);
    // (A spell with no save at all, Force Barrage; an effect with none; a spell attack; an affliction's stage, after its save.)
    expect(save({ options: ["item:type:spell"], item: { type: "spell", system: { description: { value: "@Check[reflex]" } } } })).toBe(false);
    expect(save({ item: { type: "feat", system: { description: { value: "<p>@Damage[2d6[fire]]</p>" } } } })).toBe(false);
    expect(save({ sourceType: "attack", outcome: "success", options: ["item:defense:basic"] })).toBe(false);
    expect(save({ outcome: "failure", options: ["item:defense:fortitude"] })).toBe(false);
  });

  test("healing: healing alone; Heal at the undead harms them, at the living heals, at no one known heals", () => {
    expect(adapter.damageCard(card({ kinds: ["healing"] })).kind).toBe("healing");
    const heal = targetActor => adapter.damageCard(card({ kinds: ["healing", "damage"], instances: [{ type: "vitality", kinds: new Set(["healing", "damage"]) }], targetActor })).kind;
    const creature = undead => ({ isAffectedBy: type => type === "vitality" && undead });
    expect(heal(creature(true))).toBe("damage");
    expect(heal(creature(false))).toBe("healing");
    expect(heal(null)).toBe("healing");
  });

  test("anything else is none: an attack roll, a card with no PF2e context, a roll that isn't PF2e's damage roll, odd data", () => {
    expect(adapter.damageCard(card({ type: "attack-roll" }))).toBeNull();
    expect(adapter.damageCard({ flags: {}, rolls: [] })).toBeNull();
    expect(adapter.damageCard({ ...card(), rolls: [{ total: 9 }] })).toBeNull();
    const odd = card();
    Object.assign(odd.flags.pf2e.context, { sourceType: "save", outcome: null, options: "item:defense:basic", domains: 7, target: { token: 5 } });
    odd.flags.pf2e.target = null;
    expect(adapter.damageCard(odd)).toEqual({ amount: 12, kind: "damage", targets: [], save: false });
  });
});

/** An item as a sheet holds it (its data now, and a copy of it). */
function item(id, system) {
  return { id, _source: { system }, toObject() { return { _id: this.id, system: JSON.parse(JSON.stringify(this._source.system)) }; } };
}

/**
 * An orc's token on the tracker, with a held shield, and its contextual copy whose applyDamage does to the sheet what
 * PF2e's would: a raised shield takes its share, temporary HP go first, persistent damage is laid, dead at 0 HP.
 */
function orc({ hp = 30, temp = 5, dead = false } = {}) {
  const combatant = { uuid: "Combat.c.Combatant.k", defeated: dead };
  const seen = {};
  const actor = {
    uuid: "Scene.s.Token.orc.Actor.o", alliance: "opposition",
    _source: { system: { attributes: { hp: { value: hp, temp } }, traits: { value: ["orc"] } } },
    items: [item("shield", { hp: { value: 20 } })],
    effects: dead ? [{ id: "ae0", statuses: new Set(["dead"]) }] : [], statuses: new Set(),
    getSelfRollOptions: prefix => [`${prefix}:trait:orc`],
    getContextualClone(originOptions, ephemeral) {
      seen.clone = { originOptions, ephemeral };
      return copy;
    }
  };
  const copy = {
    getSelfRollOptions: () => ["self:trait:orc"],
    async applyDamage(args) {
      seen.applied = args;
      const sheet = actor._source.system.attributes.hp;
      const amount = typeof args.damage === "number" ? args.damage : args.damage.total;
      if ( amount < 0 ) {
        sheet.value -= amount;
        return copy;
      }
      let left = amount;
      if ( args.shieldBlockRequest ) {
        actor.items[0]._source.system.hp.value -= 5;
        left -= 5;
      }
      const fromTemp = Math.min(sheet.temp, left);
      sheet.temp -= fromTemp;
      sheet.value = Math.max(0, sheet.value - (left - fromTemp));
      actor.items.push(item("pd1", { persistent: { formula: "1d6", damageType: "fire" } }));
      if ( sheet.value === 0 ) {
        combatant.defeated = true;
        actor.effects.push({ id: "ae1", statuses: new Set(["dead"]) });
      }
      return copy;
    }
  };
  return { token: { uuid: "Scene.s.Token.orc", actor, combatant }, actor, seen };
}

/** The player's character the card is from, with an effect its blows lay on whoever takes their damage. */
function hero(laid) {
  return {
    uuid: "Actor.pc", alliance: "party", getRollOptions: () => ["self:trait:human"],
    synthetics: { ephemeralEffects: { "damage-received": { target: [async ({ test }) => { laid.push(test); return { type: "effect", system: {} }; }] } } }
  };
}

describe("a damage card applied, as PF2e's own card applies it", () => {
  test("half: PF2e's applyDamage on the target's copy with the roll halved; the record has the HP, temporary HP and shield as they were, and what it laid", async () => {
    const { token, actor, seen } = orc();
    const laid = [];
    const weapon = { type: "weapon", isOfType: (...types) => types.includes("weapon") };
    globalThis.CONFIG.PF2E.chatDamageButtonShieldToggle = true;
    const message = card({ total: 80, options: ["self:trait:human", "item:trait:sweep"], item: weapon, origin: hero(laid) });
    const [record] = await adapter.applyDamageCard(message, token, { multiplier: 0.5 });
    // (PF2e's own path: the roll altered by the multiplier, IWR on, the card's options as PF2e passes them.)
    expect(seen.applied.damage.from).toEqual({ multiplier: 0.5, addend: 0 });
    expect(seen.applied).toMatchObject({ token, item: weapon, skipIWR: false, shieldBlockRequest: true, outcome: "success" });
    expect([...seen.applied.rollOptions]).toEqual(expect.arrayContaining(["item:trait:sweep", "origin:enemy", "origin:trait:human", "self:trait:orc"]));
    expect([...seen.applied.rollOptions].some(o => o.startsWith("target:"))).toBe(false);
    // (What the hero's blows lay on the one hit, on the copy only: PF2e's ephemeral effects.)
    expect(seen.clone.originOptions).toEqual(["origin:trait:human"]);
    expect(seen.clone.ephemeral).toHaveLength(1);
    expect(seen.clone.ephemeral[0]).toMatchObject({ type: "effect", system: { context: { origin: { actor: "Actor.pc" }, target: { actor: actor.uuid } }, duration: { unit: "unlimited" } } });
    expect(laid[0]).toEqual(expect.arrayContaining(["origin:enemy", "target:trait:orc", "self:trait:human"]));
    // (The shield toggle, used: off again.)
    expect(globalThis.CONFIG.PF2E.chatDamageButtonShieldToggle).toBe(false);
    expect(actor._source.system.attributes.hp).toEqual({ value: 0, temp: 0 });
    expect(record.actorUpdate).toEqual({ "system.attributes.hp.value": 30, "system.attributes.hp.temp": 5 });
    expect(record).toMatchObject({
      tokenUuid: "Scene.s.Token.orc", actorUuid: actor.uuid,
      itemUpdates: [{ id: "shield", update: { "system.hp.value": 20 } }],
      createdItems: ["pd1"], deletedItems: [], createdEffects: ["ae1"], statusesBefore: [], statuses: [],
      combatant: { uuid: "Combat.c.Combatant.k", defeated: false }
    });
  });

  test("healing: PF2e's healing path (the total negated, no IWR, nothing laid); one dead before is dead again on Rewind", async () => {
    const { token, seen } = orc({ hp: 0, temp: 0, dead: true });
    const laid = [];
    const [record] = await adapter.applyDamageCard(card({ total: 8, kinds: ["healing"], origin: hero(laid) }), token, { multiplier: 1 });
    expect(seen.applied).toMatchObject({ damage: -8, skipIWR: true, shieldBlockRequest: false });
    expect(seen.clone.ephemeral).toEqual([]);
    expect(laid).toEqual([]);
    expect(record.actorUpdate).toEqual({ "system.attributes.hp.value": 0 });
    expect(record).toMatchObject({
      itemUpdates: [], createdItems: [], createdEffects: [], statusesBefore: ["dead"],
      statuses: [{ id: "dead", active: true, overlay: true }], combatant: { defeated: true }
    });
  });

  test("a live battle's Shield Block, used against the blow: blocked as PF2e's own Shield Block toggle blocks it", async () => {
    const { token, seen } = orc();
    await adapter.applyDamageCard(card({ total: 12, origin: hero([]) }), token, { multiplier: 1, shieldBlock: true });
    expect(seen.applied).toMatchObject({ shieldBlockRequest: true });
    // (The card's own toggle left as it was: off.)
    expect(globalThis.CONFIG.PF2E.chatDamageButtonShieldToggle).toBe(false);
  });

  test("nothing applied without PF2e's damage roll, a token's actor or a multiplier above 0", async () => {
    const { token, seen } = orc();
    expect(await adapter.applyDamageCard({ ...card(), rolls: [{ total: 9 }] }, token)).toEqual([]);
    expect(await adapter.applyDamageCard(card(), { uuid: "Scene.s.Token.x", actor: null })).toEqual([]);
    expect(await adapter.applyDamageCard(card(), token, { multiplier: 0 })).toEqual([]);
    expect(seen.applied).toBeUndefined();
  });
});

describe("a PF2e setting that applies players' damage itself", () => {
  test("there is none: FastFighting's own toggles stand", () => {
    expect(adapter.appliesPlayerDamage()).toBeNull();
  });
});

describe("whether nameplates decide an NPC's name", () => {
  test("as pf2e's Tokens Determine NPC Name Visibility says; unreadable, no", () => {
    const was = globalThis.game.settings;
    try {
      for ( const on of [true, false] ) {
        globalThis.game.settings = { ...was, get: (ns, key) => (ns === "pf2e" && key === "metagame_tokenSetsNameVisibility" ? on : was?.get?.(ns, key)) };
        expect(adapter.namesFollowNameplates()).toBe(on);
      }
      globalThis.game.settings = { get: () => { throw new Error("not registered"); } };
      expect(adapter.namesFollowNameplates()).toBe(false);
    } finally {
      globalThis.game.settings = was;
    }
  });
});
