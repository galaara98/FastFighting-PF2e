/**
 * Goods for the core's deals (goods.js, API 26), with a fake shaped like PF2e's sheet: money taken in coins and things
 * as many as asked (a stack split), each with its undo record; goods put on another sheet as new items and coins;
 * everything a pile holds; the hand-over of what was given up (commit.js) with a count; what a character could hand over
 * (no coins, no containers) and its skills, the talking ones marked.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { takePf2eGoods, putPf2eGoods, pf2eGoodsOf, pf2eGiveables, pf2eSkillsOf, pf2ePileContents, coinsFor } from "../scripts/goods.js";
import { commitPf2eConcession } from "../scripts/commit.js";

const clone = data => JSON.parse(JSON.stringify(data));

/** A sheet: its items (a stack of arrows, a rope, a backpack), its coins in copper, and what its inventory was asked. */
function sheet(id, { copper = 0, items = [] } = {}) {
  const list = [];
  let next = 1;
  const asked = { removeCoins: [], addCoins: [] };
  const actor = { id, uuid: `Actor.${id}`, asked };
  const make = data => {
    const it = {
      id: data._id ?? `${id}-i${next++}`, type: data.type, name: data.name, img: data.img ?? "", system: clone(data.system),
      get quantity() { return this.system.quantity; },
      isCurrency: false,
      isOfType: (...types) => types.includes(data.type),
      assetValue: { copperValue: (data.value ?? 0) * (data.system.quantity ?? 1) },
      toObject() { return { _id: this.id, type: this.type, name: this.name, img: this.img, system: clone(this.system) }; },
      async update(u) { for ( const [k, v] of Object.entries(u) ) if ( k === "system.quantity" ) this.system.quantity = v; },
      async delete() { list.splice(list.indexOf(this), 1); }
    };
    list.push(it);
    return it;
  };
  for ( const d of items ) make(d);
  actor.items = Object.assign(list, { get: x => list.find(i => i.id === x) });
  Object.defineProperty(actor, "itemTypes", { get: () => ({ treasure: [] }) });
  actor.inventory = {
    currency: { get copperValue() { return copper; } },
    get coins() { return coinsFor(copper); },
    get contents() { return list; },
    async removeCoins(coins) { asked.removeCoins.push(coins); copper -= coins.gp * 100 + coins.sp * 10 + coins.cp; return true; },
    async addCoins(coins) { asked.addCoins.push(coins); copper += (coins.pp ?? 0) * 1000 + (coins.gp ?? 0) * 100 + (coins.sp ?? 0) * 10 + (coins.cp ?? 0); }
  };
  actor.createEmbeddedDocuments = async (type, datas) => datas.map(d => make(d));
  return { uuid: `Scene.s.Token.${id}`, actor };
}

const arrows = { type: "ammo", name: "Arrows", value: 1, system: { quantity: 20, containerId: "pack", equipped: { carryType: "stowed", handsHeld: 0, inSlot: false } } };
const rope = { type: "equipment", name: "Rope", value: 5, system: { quantity: 1, containerId: null, equipped: { carryType: "worn" } } };
const pack = { _id: "pack", type: "backpack", name: "Backpack", value: 1, system: { quantity: 1 } };

beforeEach(() => {
  globalThis.foundry = { utils: { deepClone: clone } };
});

describe("taking goods off a sheet", () => {
  test("money in coins, change made; some of a stack, the rest left; a thing that's the last of its kind, gone", async () => {
    const giver = sheet("gob", { copper: 1234, items: [arrows, rope] });
    const [a, r] = giver.actor.items;
    // (The rope's worn: it goes only off a fallen foe robbed.)
    const { goods, records } = await takePf2eGoods(giver, [{ kind: "money", amount: 357 }, { kind: "item", item: { id: a.id }, count: 15 }, { kind: "item", item: { id: r.id }, count: 1, how: "loot" }]);
    expect(giver.actor.asked.removeCoins).toEqual([{ gp: 3, sp: 5, cp: 7 }]);
    expect(goods.coins).toEqual({ gp: 3, sp: 5, cp: 7 });
    expect(goods.items.map(i => [i.name, i.system.quantity, i.system.containerId])).toEqual([["Arrows", 15, null], ["Rope", 1, null]]);
    expect(goods.items[0]).not.toHaveProperty("_id");
    expect(goods.items[0].system.equipped).toEqual({ carryType: "worn", handsHeld: 0, inSlot: false });
    expect(giver.actor.items.map(i => [i.name, i.quantity])).toEqual([["Arrows", 5]]);
    // (Undo: the arrows back to twenty, the rope back.)
    expect(records.find(x => x.itemUpdates.length).itemUpdates).toEqual([{ id: a.id, update: { "system.quantity": 20 } }]);
    expect(records.find(x => x.deletedItems.length).deletedItems[0]).toMatchObject({ _id: r.id, name: "Rope" });
  });

  test("more than it has: what it has; nothing at all: no goods", async () => {
    const poor = sheet("poor", { copper: 40, items: [rope] });
    const { goods } = await takePf2eGoods(poor, [{ kind: "money", amount: 999 }, { kind: "item", item: { id: poor.actor.items[0].id }, count: 4, how: "loot" }]);
    expect(goods.coins).toEqual({ gp: 0, sp: 4, cp: 0 });
    expect(goods.items[0].system.quantity).toBe(1);
    expect((await takePf2eGoods(sheet("none"), [{ kind: "money", amount: 5 }])).goods).toBeNull();
  });

  test("in a deal or a theft, nothing held or worn: only what it carries put away", async () => {
    const giver = sheet("gob", { items: [arrows, rope] });
    const [a, r] = giver.actor.items;
    const { goods } = await takePf2eGoods(giver, [{ kind: "item", item: { id: r.id }, how: "bribe" }, { kind: "item", item: { id: a.id }, count: 2, how: "bribe" }]);
    expect(goods.items.map(i => [i.name, i.system.quantity])).toEqual([["Arrows", 2]]);
    expect(giver.actor.items.map(i => [i.name, i.quantity])).toEqual([["Arrows", 18], ["Rope", 1]]);
    expect((await takePf2eGoods(giver, [{ kind: "item", item: { id: r.id }, how: "theft" }])).goods).toBeNull();
  });
});

describe("putting goods on a sheet, and what a pile holds", () => {
  test("each thing a new item, the coins added to its own; a pile's things and coins, as goods", async () => {
    const taker = sheet("hero", { copper: 100 });
    const records = await putPf2eGoods(taker, { items: [{ type: "ammo", name: "Arrows", system: { quantity: 15, containerId: "x" } }], coins: { gp: 3, sp: 5, cp: 7 } });
    expect(taker.actor.items.map(i => [i.name, i.quantity, i.system.containerId])).toEqual([["Arrows", 15, null]]);
    expect(taker.actor.asked.addCoins).toEqual([{ gp: 3, sp: 5, cp: 7 }]);
    expect(records[0].createdItems).toEqual([taker.actor.items[0].id]);
    const pile = sheet("pile", { copper: 357, items: [arrows] });
    const held = pf2eGoodsOf(pile);
    expect(held.items.map(i => [i.name, i.system.quantity])).toEqual([["Arrows", 20]]);
    expect(held.coins).toEqual({ pp: 0, gp: 3, sp: 5, cp: 7 });
    expect(pf2eGoodsOf(sheet("empty")).coins).toBeNull();
  });

  test("what was given up changes hands with its count", async () => {
    const giver = sheet("gob", { items: [arrows] });
    const taker = sheet("hero");
    await commitPf2eConcession(giver, taker, { kind: "item", item: { id: giver.actor.items[0].id }, count: 6 });
    expect(giver.actor.items[0].quantity).toBe(14);
    expect(taker.actor.items.map(i => [i.name, i.quantity])).toEqual([["Arrows", 6]]);
    // (Nobody to have it: gone.)
    await commitPf2eConcession(giver, null, { kind: "item", item: { id: giver.actor.items[0].id } });
    expect(giver.actor.items[0].quantity).toBe(13);
  });
});

describe("what a pile holds, for the engine", () => {
  test("its money and every thing in it, however carried, with how many and each one's worth; not coins nor containers", () => {
    const chest = sheet("chest", { copper: 357, items: [arrows, rope, pack] });
    const held = pf2ePileContents(chest);
    expect(held.money).toBe(357);
    expect(held.items.map(i => [i.name, i.quantity, i.value])).toEqual([["Arrows", 20, 1], ["Rope", 1, 5]]);
    expect(held.items.every(i => typeof i.id === "string")).toBe(true);
    expect(pf2ePileContents(null)).toBeNull();
  });
});

describe("for a player's deal", () => {
  test("what it could hand over: its things put away with how many and each one's worth, not coins, containers, nor what it holds or wears; its money", () => {
    const hero = sheet("hero", { copper: 2500, items: [arrows, rope, pack] });
    const got = pf2eGiveables(hero.actor);
    expect(got.money).toBe(2500);
    expect(got.items.map(i => [i.name, i.quantity, i.value])).toEqual([["Arrows", 20, 1]]);
    expect(got.denominations.map(d => [d.key, d.value])).toEqual([["pp", 1000], ["gp", 100], ["sp", 10], ["cp", 1]]);
  });

  test("its skills, the talking ones marked", () => {
    const actor = { skills: { diplomacy: { slug: "diplomacy", label: "Diplomacy", mod: 7 }, athletics: { slug: "athletics", label: "Athletics", mod: 3 }, intimidation: { slug: "intimidation", label: "Intimidation", mod: 2 } } };
    expect(pf2eSkillsOf(actor)).toEqual([
      { key: "diplomacy", label: "Diplomacy", mod: 7, talk: "persuade" },
      { key: "athletics", label: "Athletics", mod: 3, talk: null },
      { key: "intimidation", label: "Intimidation", mod: 2, talk: "intimidate" }
    ]);
  });
});
