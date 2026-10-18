/**
 * Getting ready the PF2e way (ready.js; the core's gear, API 20): what a weapon or a potion takes to get in hand, read
 * off the sheet; and in a live battle each step a creature FastFighting plays takes (the core's readyGear) carried
 * out on its sheet as PF2e does it, with PF2e's own card, its undo record putting it back.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { gearKey, itemOfGear, drawActions, retrieveActions, gearOnSheet, readyPf2eGear } from "../scripts/ready.js";
import { loadedOf } from "../scripts/ammo.js";

const clone = data => JSON.parse(JSON.stringify(data));

/** An actor holding these items (its items, itemTypes by type), each item knowing its actor. */
function sheet(items, extra = {}) {
  const list = [...items];
  const actor = { id: "harsk", uuid: "Actor.harsk", name: "Harsk", type: "character", items: Object.assign(list, { get: id => list.find(i => i.id === id) }), ...extra };
  Object.defineProperty(actor, "itemTypes", { get: () => Object.groupBy(list, i => i.type) });
  for ( const i of list ) i.actor = actor;
  actor.changeCarryType = async (item, { carryType, handsHeld = 0 }) => {
    actor.carried = [...(actor.carried ?? []), { id: item.id, carryType, handsHeld }];
    item.system.equipped = { carryType, handsHeld: carryType === "held" ? handsHeld : 0 };
    item.system.containerId = null;
  };
  return actor;
}

/** A physical item: its data, updated and deleted as Foundry does. */
function item(id, type, system, extra = {}) {
  const i = { id, type, name: id, img: `${id}.webp`, system, ...extra };
  i.toObject = () => clone({ _id: i.id, type: i.type, name: i.name, system: i.system });
  i.delete = async () => i.actor.items.splice(i.actor.items.indexOf(i), 1);
  i.update = async changes => Object.assign(i.system, changes);
  return i;
}

const cards = [];
const before = {};
beforeEach(() => {
  cards.length = 0;
  for ( const k of ["foundry", "ChatMessage", "CONST", "CONFIG"] ) before[k] = globalThis[k];
  globalThis.foundry = { applications: { handlebars: { renderTemplate: async (path, data) => JSON.stringify({ path, data }) } } };
  globalThis.ChatMessage = { implementation: { create: async data => { cards.push(data); return { id: `m${cards.length}` }; }, getSpeaker: ({ actor }) => ({ alias: actor.name }), getWhisperRecipients: () => [{ id: "gm" }] } };
  globalThis.CONST = { CHAT_MESSAGE_STYLES: { EMOTE: 3 } };
  globalThis.CONFIG = { PF2E: { actionTraits: { manipulate: "PF2E.TraitManipulate" }, traitsDescriptions: {} } };
});
afterEach(() => { for ( const k of Object.keys(before) ) globalThis[k] = before[k]; });

describe("what getting a thing in hand takes", () => {
  test("a gear key names its item on its own actor only", () => {
    const xbow = item("xbow", "weapon", {});
    const actor = sheet([xbow]);
    expect(gearKey(actor, xbow)).toBe("harsk.gear.xbow");
    expect(itemOfGear(actor, "harsk.gear.xbow")).toBe(xbow);
    expect(itemOfGear(actor, "other.gear.xbow")).toBeNull();
    expect(itemOfGear(actor, "harsk.strike.xbow")).toBeNull();
  });

  test("a weapon's Draw by its Strike's own auxiliary action (a Retrieve from a pack, two); a potion's Retrieve by where it's kept", () => {
    expect(drawActions({ auxiliaryActions: [{ annotation: "draw", actions: 1, hands: 1 }] })).toBe(1);
    expect(drawActions({ auxiliaryActions: [{ annotation: "retrieve", actions: 2, hands: 1 }] })).toBe(2);
    expect(drawActions({})).toBe(1);
    const pack = item("pack", "backpack", { usage: { type: "worn", where: "backpack" } });
    const pouch = item("pouch", "backpack", { usage: { type: "worn", where: "belt" } });
    const held = item("held", "consumable", { equipped: { carryType: "held" } });
    const worn = item("worn", "consumable", { equipped: { carryType: "worn" } });
    const packed = item("packed", "consumable", { equipped: { carryType: "stowed" }, containerId: "pack" });
    const pouched = item("pouched", "consumable", { equipped: { carryType: "stowed" }, containerId: "pouch" });
    const actor = sheet([pack, pouch, held, worn, packed, pouched]);
    expect([held, worn, packed, pouched].map(i => retrieveActions(actor, i))).toEqual([0, 1, 2, 1]);
  });

  test("the sheet's gear: each Strike's weapon in hand or not (PF2e's ready), what's loaded, each healing potion in hand or not", () => {
    const xbow = item("xbow", "weapon", { reload: { value: "2" }, ammo: { baseType: "bolts", capacity: 1, builtIn: false }, expend: 1, traits: { value: [] }, subitems: [] });
    const axe = item("axe", "weapon", { traits: { value: [] } });
    const potion = item("potion", "consumable", { damage: { kind: "healing", formula: "1d8" }, equipped: { carryType: "worn" } });
    const actor = sheet([xbow, axe, potion], { system: { actions: [{ type: "strike", item: xbow, ready: false }, { type: "strike", item: axe, ready: true }] } });
    const gear = gearOnSheet(actor, { loaded: i => loadedOf(actor, i) });
    expect(gear).toEqual({ inHand: ["harsk.gear.axe"], out: ["harsk.gear.xbow", "harsk.gear.potion"], loaded: { "harsk.gear.xbow": 0 } });
    expect(gearOnSheet({ type: "npc" })).toEqual({ inHand: [], out: [], loaded: {} });
  });
});

describe("in a live battle: getting ready on the sheet, the PF2e way", () => {
  const tokenOf = actor => ({ uuid: "Scene.s.Token.harsk", actor });

  test("a Draw: the Strike's own Draw with both hands for a heavy crossbow (PF2e's Interact card), undone by putting it back", async () => {
    const xbow = item("xbow", "weapon", { equipped: { carryType: "worn", handsHeld: 0 }, containerId: null });
    const executed = [];
    const auxiliaryActions = [1, 2].map(hands => ({ annotation: "draw", hands, actions: 1, execute: async () => executed.push(hands) }));
    const actor = sheet([xbow], { system: { actions: [{ type: "strike", visible: true, item: xbow, auxiliaryActions }] } });
    const out = await readyPf2eGear(tokenOf(actor), { step: "draw", gear: "harsk.gear.xbow", hands: 2 });
    expect(executed).toEqual([2]);
    expect(out.records[0].itemUpdates).toEqual([{ id: "xbow", update: { "system.equipped": { carryType: "worn", handsHeld: 0 }, "system.containerId": null } }]);
    // (In hand already: nothing to do.)
    xbow.system.equipped = { carryType: "held", handsHeld: 2 };
    expect(await readyPf2eGear(tokenOf(actor), { step: "draw", gear: "harsk.gear.xbow", hands: 2 })).toBeNull();
  });

  test("a potion got out: held in a hand, with PF2e's Interact card for a Retrieve", async () => {
    const potion = item("potion", "consumable", { equipped: { carryType: "worn" }, containerId: null });
    const actor = sheet([potion]);
    const out = await readyPf2eGear(tokenOf(actor), { step: "retrieve", gear: "harsk.gear.potion" });
    expect(actor.carried).toEqual([{ id: "potion", carryType: "held", handsHeld: 1 }]);
    expect(cards).toHaveLength(1);
    expect(cards[0].flavor).toContain("PF2E.Actions.Interact.Retrieve1H.Title");
    expect(out.records[0].itemUpdates[0].update["system.equipped"]).toEqual({ carryType: "worn" });
  });

  test("a Reload: a bolt loaded as the sheet's Reload does (attach), PF2e's Reload card, and the undo record puts it back", async () => {
    const bolts = item("bolts", "ammo", { quantity: 20, baseItem: "bolts", uses: { value: 1, max: 1 } });
    bolts.isAmmoFor = w => w.system.ammo?.baseType === "bolts";
    bolts.isStowed = false;
    const xbow = item("xbow", "weapon", { reload: { value: "2" }, ammo: { baseType: "bolts", capacity: 1, builtIn: false }, expend: 1, traits: { value: [] }, subitems: [] });
    Object.defineProperty(xbow, "subitems", { get: () => xbow.system.subitems.map(d => ({ id: d._id, type: d.type, system: d.system })) });
    Object.defineProperty(xbow, "ammo", { get: () => xbow.subitems[0] ?? null });
    xbow.attach = async (stack, { quantity }) => {
      xbow.system.subitems.push({ _id: "loaded", type: "ammo", system: { ...clone(stack.system), quantity } });
      stack.system.quantity -= quantity;
    };
    const actor = sheet([xbow, bolts]);
    bolts.update = async changes => { for ( const [k, v] of Object.entries(changes) ) if ( k === "system.quantity" ) bolts.system.quantity = v; };
    const out = await readyPf2eGear(tokenOf(actor), { step: "reload", gear: "harsk.gear.xbow" });
    expect(loadedOf(actor, xbow)).toEqual({ loaded: 1, capacity: 1 });
    expect(bolts.system.quantity).toBe(19);
    expect(cards).toHaveLength(1);
    expect(cards[0].flavor).toContain("PF2E.Actions.Interact.Reload.Title");
    expect(JSON.parse(cards[0].flavor).data.action.glyph).toBe("2");
    expect(out.records[0].itemUpdates.find(u => u.id === "bolts").update["system.quantity"]).toBe(20);
    // (Loaded already: no Reload to make.)
    expect(await readyPf2eGear(tokenOf(actor), { step: "reload", gear: "harsk.gear.xbow" })).toBeNull();
  });

  test("a Stand: PF2e's own Stand action (its card takes prone off), the prone condition kept to put back", async () => {
    const prone = item("prone", "condition", {}, { slug: "prone", isLocked: false });
    const actor = sheet([prone]);
    const used = [];
    globalThis.game.pf2e = { actions: { get: slug => (slug === "stand" ? { use: async ({ actors }) => { used.push(actors[0].id); await prone.delete(); } } : null) } };
    const out = await readyPf2eGear(tokenOf(actor), { step: "stand" });
    expect(used).toEqual(["harsk"]);
    expect(actor.items).toHaveLength(0);
    expect(out.records[0].deletedItems).toEqual([{ _id: "prone", type: "condition", name: "prone", system: {} }]);
    expect(await readyPf2eGear(tokenOf(actor), { step: "stand" })).toBeNull();
  });

  test("the adapter hands the core's readyGear to it", async () => {
    expect(await new Pf2eAdapter().readyGear({ actor: null }, { step: "stand" })).toBeNull();
  });
});
