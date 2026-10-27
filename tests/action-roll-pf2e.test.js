/**
 * API 19, an action's own card and its damage in a live battle: the card as its user shows it from the sheet (a
 * spell's as an actual cast at the rank the adapter took it, nothing spent; an ability's, a self-buff's, a
 * consumable's), none for an action with no item or a spell attack rollStrike rolls; its damage rolled once, a spell's
 * by its card's Damage button, an ability's by the first @Damage link on its card, clicked as the GM would; its card
 * marked as FastFighting's, nothing applied.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";

const adapter = new Pf2eAdapter();

/** An actor's items, as Foundry's Collection holds them: by id. */
class Items extends Map {
  constructor(list = []) {
    super(list.map(i => [i.id, i]));
  }
}

/** The chat: its cards, and a card made (as PF2e's create does), its flags set as Foundry's setFlag sets them. */
function chat() {
  const contents = [];
  const post = data => {
    const m = { id: `m${contents.length + 1}`, flags: {}, ...data };
    m.setFlag = async (scope, key, value) => {
      (m.flags[scope] ??= {})[key] = value;
      return m;
    };
    contents.push(m);
    return m;
  };
  return { contents, get: id => contents.find(m => m.id === id), post };
}

/** PF2e's damage roll: its instances, [type, total, persistent]. */
const damageRoll = parts => ({
  instances: parts.map(([type, total, persistent = false]) => ({ type, total: persistent ? 0 : total, persistent, kinds: new Set(["damage"]) })),
  alter() {}
});

/** A damage roll's card, as PF2e's DamagePF2e.roll makes it, the actor its speaker. */
const damageCard = (actor, roll) => ({ speaker: { actor: actor.id }, author: { id: "gm" }, flags: { pf2e: { context: { type: "damage-roll" } } }, rolls: [roll] });

/**
 * An item on the orc's sheet, its toMessage posting its card (and keeping what it was asked). A spell's rollDamage rolls
 * `hit` and posts its card.
 */
function item(id, type, { slug = id, rank = 3, attack = false, damage = { 0: { formula: "6d6", type: "fire" } }, hit = [["fire", 21], ["fire", 3, true]] } = {}) {
  const it = { id, type, slug, rank, isAttack: attack, system: { slug, damage }, asked: [] };
  it.toMessage = async (event, options) => {
    it.asked.push(["toMessage", event, options]);
    return game.messages.post({ content: id });
  };
  it.rollAttack = async () => null;
  it.spellcasting = { statistic: {} };
  it.rollDamage = async (event, map) => {
    it.asked.push(["rollDamage", event, map]);
    const roll = damageRoll(hit);
    game.messages.post(damageCard(orcActor, roll));
    return roll;
  };
  return it;
}

let orcActor;
/** The orc's token, its items on its sheet. */
function orc(...items) {
  orcActor = { id: "orc1", items: new Items(items) };
  return { id: "t1", actor: orcActor };
}

/** The hero it's aimed at: drawn here, or not. */
function hero({ drawn = true } = {}) {
  const doc = { id: "pc1", actor: { id: "pc" } };
  doc.object = drawn ? { document: doc } : null;
  return doc;
}

const was = { CONFIG: globalThis.CONFIG };
beforeEach(() => {
  globalThis.game.user = { id: "gm", isGM: true, settings: { showCheckDialogs: false, showDamageDialogs: true } };
  globalThis.game.messages = chat();
  globalThis.CONFIG = {};
});
afterEach(() => {
  globalThis.CONFIG = was.CONFIG;
});

describe("an action's own card", () => {
  test("a spell's, as its spellcasting entry casts it: an actual cast at the rank the adapter took, nothing spent, in the chat's own mode", async () => {
    const fireball = item("sp1", "spell");
    const out = await adapter.useAction(orc(fireball), { action: { id: "orc1.spell.sp1", name: "Fireball" }, targets: [hero()] });
    expect(out).toEqual({ card: "m1" });
    expect(fireball.asked).toEqual([["toMessage", null, { actualCast: true, data: { castRank: 3 } }]]);
  });

  test("a spell cast at a higher rank than its own (Fireball in a 5th-rank slot, `@5`): its card and damage at that rank", async () => {
    const fireball = item("sp1", "spell");
    const cast = [];
    fireball.loadVariant = ({ castRank }) => {
      if ( castRank === fireball.rank ) return null;
      const variant = Object.assign(item("sp1", "spell", { rank: castRank, hit: [["fire", 35]] }), { asked: fireball.asked });
      cast.push(castRank);
      return variant;
    };
    const token = orc(fireball);
    expect(await adapter.useAction(token, { action: { id: "orc1.spell.sp1@5", name: "Fireball", rank: 5 }, targets: [hero()] })).toEqual({ card: "m1" });
    expect(fireball.asked).toEqual([["toMessage", null, { actualCast: true, data: { castRank: 5 } }]]);
    const rolled = await adapter.rollDamage(token, { action: { id: "orc1.spell.sp1@5", name: "Fireball", rank: 5 }, card: "m1" });
    expect(rolled.damage.byType).toEqual({ fire: 35 });
    expect(cast).toEqual([5, 5]);
  });

  test("an ability's (a breath weapon), a self-buff's (Rage), a consumable's (a potion), a heal spell's: the card its sheet posts", async () => {
    const breath = item("a1", "action");
    const rage = item("f1", "feat");
    const potion = item("c1", "consumable");
    const heal = item("sp2", "spell", { damage: {} });
    const token = orc(breath, rage, potion, heal);
    for ( const id of ["orc1.a1", "orc1.self.f1", "orc1.item.c1", "orc1.spell.sp2"] ) {
      expect(await adapter.useAction(token, { action: { id }, targets: [] })).toEqual({ card: expect.any(String) });
    }
    expect([breath, rage, potion].map(i => i.asked)).toEqual([[["toMessage", null, {}]], [["toMessage", null, {}]], [["toMessage", null, {}]]]);
    expect(game.messages.contents).toHaveLength(4);
  });

  test("an ability put to a use of its own (Grab's Grapple after a hit, or Grab kept up): the ability's card", async () => {
    const grab = item("g1", "action", { slug: "grab", damage: {} });
    const token = orc(grab);
    for ( const id of ["orc1.g1.grapple", "orc1.g1.keep"] ) expect(await adapter.useAction(token, { action: { id }, targets: [hero()] })).toEqual({ card: expect.any(String) });
    expect(grab.asked).toEqual([["toMessage", null, {}], ["toMessage", null, {}]]);
    // (No ability on the sheet, only the effect's slug in the id: no card.)
    expect(await adapter.useAction(token, { action: { id: "orc1.grab.grapple" }, targets: [hero()] })).toBeNull();
  });

  test("secret: for the GMs only, as PF2e posts a GM's card (a player's, blind)", async () => {
    const breath = item("a1", "action");
    const fireball = item("sp1", "spell");
    const token = orc(breath, fireball);
    await adapter.useAction(token, { action: { id: "orc1.a1" }, secret: true });
    await adapter.useAction(token, { action: { id: "orc1.spell.sp1" }, secret: true });
    game.user.isGM = false;
    await adapter.useAction(token, { action: { id: "orc1.a1" }, secret: true });
    expect(breath.asked.map(a => a[2].mode)).toEqual(["gm", "blind"]);
    expect(fireball.asked[0][2]).toMatchObject({ actualCast: true, mode: "gm" });
  });

  test("a spell attack rollStrike rolls (with damage, at a target drawn here): its attack card shows it; elsewhere, or with no damage, its card", async () => {
    const ray = item("sp3", "spell", { attack: true });
    const grasp = item("sp4", "spell", { attack: true, damage: {} });
    const token = orc(ray, grasp);
    expect(await adapter.useAction(token, { action: { id: "orc1.spell.sp3" }, targets: [hero()] })).toBeNull();
    expect(ray.asked).toEqual([]);
    expect(await adapter.useAction(token, { action: { id: "orc1.spell.sp3" }, targets: [hero({ drawn: false })] })).toEqual({ card: "m1" });
    expect(await adapter.useAction(token, { action: { id: "orc1.spell.sp4" }, targets: [hero()] })).toEqual({ card: "m2" });
  });

  test("none for an action with no item of its own (Take Cover, Aid, Battle Medicine's, a Strike), another's, or an item that isn't one (a melee Strike's)", async () => {
    const claw = item("w1", "melee");
    const token = orc(claw, item("a1", "action"));
    for ( const id of ["orc1.take-cover", "orc1.aid", "orc1.feat.battle-medicine", "orc1.strike.claw.0", "orc2.a1", "orc1.w1", "orc1.spell.a1", "orc1.self.w1", null] ) {
      expect([id, await adapter.useAction(token, { action: { id } })]).toEqual([id, null]);
    }
    expect(await adapter.useAction({ actor: null }, { action: { id: "orc1.a1" } })).toBeNull();
    expect(claw.asked).toEqual([]);
    expect(game.messages.contents).toEqual([]);
  });
});

describe("an action's damage, rolled once for all it catches", () => {
  test("a spell's, by its card's Damage button: no dialog, in the chat's own mode; by type as rolled, persistent left out; its card marked as FastFighting's", async () => {
    const fireball = item("sp1", "spell");
    const out = await adapter.rollDamage(orc(fireball), { action: { id: "orc1.spell.sp1" }, card: null });
    expect(out).toEqual({ damage: { byType: { fire: 21 } }, card: "m1" });
    expect(fireball.asked).toEqual([["rollDamage", { shiftKey: true, ctrlKey: false, metaKey: false }, undefined]]);
    expect(game.messages.get("m1").flags["fast-fighting-pf2e"]).toEqual({ rolled: { times: 1 } });
  });

  test("secret: Ctrl down, as PF2e rolls a GM's roll", async () => {
    const fireball = item("sp1", "spell");
    await adapter.rollDamage(orc(fireball), { action: { id: "orc1.spell.sp1" }, secret: true });
    expect(fireball.asked[0][1].ctrlKey).toBe(true);
  });

  test("none for a spell attack's (rollStrike rolls it), Force Barrage's (its card one missile's), a spell with no damage, a consumable, or no item", async () => {
    const token = orc(item("sp3", "spell", { attack: true }), item("sp5", "spell", { slug: "force-barrage" }), item("sp2", "spell", { damage: {} }), item("c1", "consumable"));
    for ( const id of ["orc1.spell.sp3", "orc1.spell.sp5", "orc1.spell.sp2", "orc1.item.c1", "orc1.take-cover"] ) {
      expect([id, await adapter.rollDamage(token, { action: { id } })]).toEqual([id, null]);
    }
    expect(game.messages.contents).toEqual([]);
  });

  test("an ability's (a breath weapon), by the first @Damage link on its card, clicked as the GM would: PF2e's inline damage", async () => {
    const breath = item("a1", "action");
    const token = orc(breath);
    const link = (dataset = {}) => ({ dataset: { damageRoll: "10d6[fire]", ...dataset } });
    const links = [link({ persistent: "" }), link({ rollOptions: "area-damage" }), link()];
    const shown = game.messages.post({ content: "breath" });
    const rendered = [];
    shown.renderHTML = async () => {
      rendered.push(true);
      return { querySelectorAll: selector => (selector === "a.inline-roll[data-damage-roll]" ? links : []) };
    };
    const clicked = [];
    CONFIG.ux = { TextEditor: { _onClickInlineRoll: async event => {
      clicked.push(event);
      game.messages.post(damageCard(orcActor, damageRoll([["fire", 35], ["fire", 4, true]])));
    } } };
    const out = await adapter.rollDamage(token, { action: { id: "orc1.a1" }, card: shown.id });
    expect(out).toEqual({ damage: { byType: { fire: 35 } }, card: "m2" });
    expect(clicked).toHaveLength(1);
    // (The first not persistent damage alone, with the card's own dataset: its speaker and item PF2e reads from the card.)
    expect(clicked[0]).toMatchObject({ target: links[1], currentTarget: links[1], shiftKey: true, ctrlKey: false, metaKey: false });
    expect(links[1].dataset.rollOptions).toBe("area-damage");
    expect(game.messages.get("m2").flags["fast-fighting-pf2e"]).toEqual({ rolled: { times: 1 } });
    // (Secret: PF2e's inline damage takes no Ctrl, so the link carries PF2e's secret roll option.)
    await adapter.rollDamage(token, { action: { id: "orc1.a1" }, card: shown.id, secret: true });
    expect(links[1].dataset.rollOptions).toBe("area-damage,secret");
    expect(clicked[1].ctrlKey).toBe(true);
  });

  test("none for an ability with no @Damage link on its card (Trample: a Strike's damage), no card, or no way to click one", async () => {
    const token = orc(item("a1", "action"));
    const shown = game.messages.post({ content: "trample" });
    shown.renderHTML = async () => ({ querySelectorAll: () => [] });
    CONFIG.ux = { TextEditor: { _onClickInlineRoll: async () => { throw new Error("clicked"); } } };
    expect(await adapter.rollDamage(token, { action: { id: "orc1.a1" }, card: shown.id })).toBeNull();
    expect(await adapter.rollDamage(token, { action: { id: "orc1.a1" }, card: null })).toBeNull();
    expect(await adapter.rollDamage(token, { action: { id: "orc1.a1" }, card: "gone" })).toBeNull();
    CONFIG.ux = {};
    shown.renderHTML = async () => ({ querySelectorAll: () => [{ dataset: { damageRoll: "2d6" } }] });
    expect(await adapter.rollDamage(token, { action: { id: "orc1.a1" }, card: shown.id })).toBeNull();
  });

  test("Rend (no damage of its own: the Strike it names, action.strikeOf): that Strike's own Damage, at the target, no dialog", async () => {
    const rend = item("a2", "action", { slug: "rend" });
    const token = orc(rend);
    const asked = [];
    const claw = { type: "strike", slug: "claw", visible: true, variants: [], damage: async params => {
      asked.push(params);
      const roll = damageRoll([["slashing", 13]]);
      game.messages.post(damageCard(orcActor, roll));
      return roll;
    } };
    orcActor.system = { actions: [claw] };
    const target = hero();
    const out = await adapter.rollDamage(token, { action: { id: "orc1.a2", strikeOf: "orc1.strike.claw.0" }, card: null, target });
    expect(out).toEqual({ damage: { byType: { slashing: 13 } }, card: "m1" });
    expect(asked).toEqual([{ event: { shiftKey: true, ctrlKey: false, metaKey: false }, target: target.object }]);
    expect(game.messages.get("m1").flags["fast-fighting-pf2e"]).toEqual({ rolled: { times: 1 } });
    // (A Strike the sheet no longer has, or none named: the engine's dice.)
    expect(await adapter.rollDamage(token, { action: { id: "orc1.a2", strikeOf: "orc1.strike.bite.0" }, card: null })).toBeNull();
    expect(await adapter.rollDamage(token, { action: { id: "orc1.a2" }, card: null })).toBeNull();
  });
});
