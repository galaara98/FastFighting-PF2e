/**
 * Goods for the core's deals (API 26: behavior/deals.js, foundry/loot-drop.js): money and things taken off a sheet and
 * put on another (a creature's, a pile's), PF2e's way; what a pile holds; PF2e's own loot pile (a loot actor and its
 * token, as a corpse's pile is: commit.js); and, for a player's dialog, a character's skills and what it could hand
 * over. Goods are {items: [item data], coins: {pp, gp, sp, cp}} (null coins: none), and on the way in, money (in copper:
 * a team's purse's, on no sheet). Every change leaves undo records.
 */
import { undoRecord, MODULE_ID } from "./core.js";
import { t, coin } from "./words.js";

/** PF2e's physical item types (what can lie on the ground and change hands). */
const PHYSICAL = new Set(["weapon", "armor", "equipment", "consumable", "treasure", "backpack", "shield", "ammo", "book"]);

/** An undo record with nothing in it yet (no statuses kept from before: PF2e's conditions are items). */
const emptyRecord = (tokenDoc, actor) => undoRecord(tokenDoc, actor, { statusesBefore: false });

/** Coin items as they are now, to work out what a coin transfer changed. */
const coinSnapshot = actor => new Map(actor.itemTypes.treasure.filter(i => i.isCurrency).map(i => [i.id, i.toObject()]));

/** An undo record for whatever happened to an actor's coins since `before`. */
function coinUndo(tokenDoc, actor, before) {
  const undo = emptyRecord(tokenDoc, actor);
  const after = coinSnapshot(actor);
  for ( const id of after.keys() ) if ( !before.has(id) ) undo.createdItems.push(id);
  for ( const [id, data] of before ) {
    if ( !after.has(id) ) undo.deletedItems.push(data);
    else if ( after.get(id).system.quantity !== data.system.quantity ) undo.itemUpdates.push({ id, update: { "system.quantity": data.system.quantity } });
  }
  return undo;
}

/** Copper split into coins, largest first, without platinum (what people actually hand over). */
export function coinsFor(copper) {
  const gp = Math.floor(copper / 100);
  const sp = Math.floor((copper % 100) / 10);
  return { gp, sp, cp: copper % 10 };
}

/** Carried put away (in a container), as PF2e has it: not held, not worn. Coins go however they're carried. */
const stowed = item => (item.isOfType?.("treasure") && item.isCurrency) || item.system?.equipped?.carryType === "stowed";

/** Any coins at all. */
const anyCoins = coins => !!coins && ["pp", "gp", "sp", "cp"].some(k => (Number(coins[k]) || 0) > 0);

/** A thing as it lies on the ground or changes hands: loose, worn, held in no hand, out of any container. */
function loose(data, count = null) {
  delete data._id;
  if ( count !== null ) data.system.quantity = count;
  data.system.containerId = null;
  if ( data.system.equipped ) data.system.equipped = { carryType: "worn", handsHeld: 0, inSlot: false };
  return data;
}

/**
 * Goods off a creature's sheet: the money (in coins, change made), and each thing, as many as asked (the core's
 * concessions: {kind: "money", amount} in copper, {kind: "item", item: {id}, count}). {goods, records}.
 */
export async function takePf2eGoods(tokenDoc, goods = []) {
  const actor = tokenDoc?.actor;
  if ( !actor?.inventory ) return { goods: null, records: [] };
  const records = [];
  let coins = null;
  const items = [];
  const money = goods.filter(g => g?.kind === "money").reduce((s, g) => s + (Number(g.amount) || 0), 0);
  const amount = Math.min(money, actor.inventory.currency.copperValue);
  if ( amount > 0 ) {
    const want = coinsFor(amount);
    const before = coinSnapshot(actor);
    if ( (await actor.inventory.removeCoins(want, { byValue: true })) !== false ) {
      records.push(coinUndo(tokenDoc, actor, before));
      coins = want;
    }
  }
  for ( const g of goods.filter(x => x?.kind === "item") ) {
    const item = actor.items.get(g.item?.id);
    // (Only what it carries put away: nothing held or worn changes hands, but off a fallen foe robbed.)
    if ( !item || !PHYSICAL.has(item.type) || (g.how !== "loot" && !stowed(item)) ) continue;
    const have = Math.max(1, Number(item.system?.quantity ?? 1) || 1);
    const n = Math.max(1, Math.min(have, Number(g.count) || 1));
    const undo = emptyRecord(tokenDoc, actor);
    items.push(loose(item.toObject(), n));
    if ( n < have ) {
      undo.itemUpdates.push({ id: item.id, update: { "system.quantity": have } });
      await item.update({ "system.quantity": have - n });
    } else {
      undo.deletedItems.push(item.toObject());
      await item.delete();
    }
    records.push(undo);
  }
  return { goods: items.length || coins ? { items, coins } : null, records };
}

/** Goods onto a sheet (a creature's, a pile's): each thing a new item, the coins added to its own. Undo records. */
export async function putPf2eGoods(tokenDoc, goods) {
  const actor = tokenDoc?.actor;
  if ( !actor?.inventory || !goods ) return [];
  const records = [];
  // (Money in the smallest coin, a team's purse's: the coins people hand over, added to any given.)
  if ( Number(goods.money) > 0 ) {
    const more = coinsFor(Math.round(Number(goods.money)));
    const coins = { ...(goods.coins ?? {}) };
    for ( const [k, n] of Object.entries(more) ) coins[k] = (Number(coins[k]) || 0) + n;
    goods = { ...goods, coins };
  }
  if ( goods.items?.length ) {
    const undo = emptyRecord(tokenDoc, actor);
    const made = await actor.createEmbeddedDocuments("Item", goods.items.map(d => loose(foundry.utils.deepClone(d))));
    undo.createdItems.push(...made.map(i => i.id));
    records.push(undo);
  }
  if ( anyCoins(goods.coins) ) {
    const before = coinSnapshot(actor);
    await actor.inventory.addCoins(goods.coins);
    records.push(coinUndo(tokenDoc, actor, before));
  }
  return records;
}

/** Everything a pile holds, as goods: its things (not its coins), and its coins. Null: nothing to hold anything. */
export function pf2eGoodsOf(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor?.inventory ) return null;
  const items = actor.items.filter(i => PHYSICAL.has(i.type) && !(i.isOfType?.("treasure") && i.isCurrency)).map(i => loose(i.toObject()));
  const c = actor.inventory.coins ?? {};
  const coins = { pp: Number(c.pp) || 0, gp: Number(c.gp) || 0, sp: Number(c.sp) || 0, cp: Number(c.cp) || 0 };
  return { items, coins: anyCoins(coins) ? coins : null };
}

/**
 * PF2e's own loot pile on the ground: a loot actor (FastFighting's, so Rewind takes it away) and its token at x, y,
 * holding the goods, named and looking as the core asks (a chest, a bag). {tokenUuid, records}.
 */
export async function dropPf2eValuables(scene, { x, y }, goods, { name = "", img = null } = {}) {
  const pile = await Actor.create({
    name: name || t("DroppedGoods"),
    type: "loot",
    img: img || "icons/containers/bags/sack-leather-brown.webp",
    system: { lootSheetType: "Loot" },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
    flags: { [MODULE_ID]: { pile: true } }
  });
  const [token] = await scene.createEmbeddedDocuments("Token", [{
    ...(await pile.getTokenDocument({ x, y })).toObject(),
    actorLink: true,
    disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL
  }]);
  await putPf2eGoods(token, goods);
  return { tokenUuid: token.uuid, records: [{ createdActors: [pile.uuid], createdTokens: [token.uuid] }] };
}

/**
 * What a pile holds, for the core's engine (API 27: a thief's, a scavenger's, a hungry creature's to go for): its money
 * (in copper) and each thing in it, coins and containers aside, with how many and what each is worth (copper). Whatever
 * way it's carried: a pile's things are all there for the taking. {money, items: [{id, name, value, quantity}]}.
 */
export function pf2ePileContents(tokenDoc) {
  const inventory = tokenDoc?.actor?.inventory;
  if ( !inventory ) return null;
  const items = [];
  for ( const item of inventory.contents ?? [] ) {
    if ( (item.isOfType?.("treasure") && item.isCurrency) || item.type === "backpack" || !(item.quantity > 0) ) continue;
    items.push({ id: item.id, name: item.name, value: Math.round((item.assetValue?.copperValue ?? 0) / Math.max(1, item.quantity)), quantity: item.quantity });
  }
  return { money: inventory.currency?.copperValue ?? 0, items };
}

/** Its skills, for a player's deal: {key, label, mod, talk} (talk: the core's kind of pitch the skill makes, or null). */
export function pf2eSkillsOf(actor) {
  const talk = { diplomacy: "persuade", deception: "deceive", intimidation: "intimidate" };
  return Object.values(actor?.skills ?? {}).filter(s => typeof s?.slug === "string").map(s => ({ key: s.slug, label: s.label ?? s.slug, mod: Number(s.mod) || 0, talk: talk[s.slug] ?? null }));
}

/**
 * What a character could hand over in a deal: its money (in copper; PF2e's coins, by what each is worth), and each thing
 * it carries put away (stowed: never what it holds or wears) that isn't a container (its contents would go too), with
 * how many and what each is worth (copper).
 */
export function pf2eGiveables(actor) {
  const inventory = actor?.inventory;
  const denominations = [["pp", 1000], ["gp", 100], ["sp", 10], ["cp", 1]].map(([key, value]) => ({ key, label: coin(key), value }));
  if ( !inventory ) return { money: 0, denominations, items: [] };
  const items = [];
  for ( const item of inventory.contents ?? [] ) {
    if ( (item.isOfType?.("treasure") && item.isCurrency) || item.type === "backpack" || !(item.quantity > 0) || !stowed(item) ) continue;
    items.push({ id: item.id, name: item.name, img: item.img, quantity: item.quantity, value: Math.round((item.assetValue?.copperValue ?? 0) / Math.max(1, item.quantity)) });
  }
  return { money: inventory.currency?.copperValue ?? 0, denominations, items };
}
