/**
 * Reloading and ammunition, as PF2e 8.6 keeps them on a weapon. No Foundry globals: the items' own data, and the
 * methods PF2e gives its items (isAmmoFor, attach, update, delete, toObject) where it has them.
 *  - reloadOf: a Strike's reload, in actions: a weapon's `system.reload.value` ("-": none, a weapon that isn't
 *    reloaded; "0" to "3"; "10": a minute), a creature's attack's `reload-N` trait (`reload-1-min`: a minute). Each
 *    shot costs 1 + its reload (adapter.js); one no turn has room to reload has only the shot it's loaded with.
 *  - ammoOf, roundsOf: a character's weapon whose Strike spends ammunition as PF2e rolls it (`system.ammo`, not built in,
 *    `system.expend` a shot), and the rounds it has to shoot: what's loaded in it and the compatible ammunition its
 *    wielder carries (PF2e's own isAmmoFor; not stowed away), a magazine by its uses. The core's `action.ammo`.
 *  - readyAmmo: a live battle's Strike, its ammunition readied as a player readies it before PF2e's own Strike rolls
 *    (PF2e refuses one with none: "No ammunition is assigned"); ammoState and ammoUndo, its undo record (PF2e then
 *    spends the round itself, and Rewind puts it all back).
 *  - spendRounds: rounds the engine's own shots spent that PF2e's Strike didn't, run down on the sheet (commit.js).
 * How PF2e's Strike takes its ammunition (weapon.ammo): a bow (reload 0, not repeating) shoots the stack picked for it
 * (`system.selectedAmmoId`); anything else (a crossbow, a firearm, a repeating weapon's magazine) what's loaded in it
 * (its subitems, put there by the sheet's Reload: PF2e's attach).
 */
import { undoRecord } from "./core.js";

/** PF2e's "1 min" reload. */
const MINUTE = "10";

/** A Strike's reload, in actions: Infinity for one that takes a minute (no reloading it in a fight). */
export function reloadOf(item) {
  if ( item?.type === "weapon" ) {
    const value = String(item.system?.reload?.value ?? "").trim();
    if ( value === MINUTE ) return Infinity;
    return /^\d+$/.test(value) ? Number(value) : 0; // ("-", none)
  }
  const traits = item?.system?.traits?.value ?? [];
  if ( traits.includes("reload-1-min") ) return Infinity;
  const trait = traits.find(t => /^reload-\d+$/.test(t));
  return trait ? Number(trait.split("-")[1]) : 0;
}

/**
 * How a character's weapon takes ammunition as PF2e's Strike spends it, or null for one that takes none (a melee
 * weapon, a thrown one, a bomb, built-in ammunition, a creature's attack): {expend: the rounds a shot takes, picked:
 * whether it shoots the stack picked for it (a bow) rather than what's loaded in it, capacity}.
 */
export function ammoOf(actor, weapon) {
  const ammo = weapon?.system?.ammo;
  const expend = Number(weapon?.system?.expend) || 0;
  if ( actor?.type !== "character" || weapon?.type !== "weapon" || !ammo || ammo.builtIn || expend <= 0 ) return null;
  const repeating = (weapon.system.traits?.value ?? []).includes("repeating");
  return { expend, picked: String(weapon.system.reload?.value ?? "") === "0" && !repeating, capacity: Number(ammo.capacity) || 0 };
}

/** The rounds in an item of ammunition: a magazine's uses (the first of a stack as it stands, the rest full), else its quantity. */
export function roundsIn(item) {
  const quantity = Math.max(0, Number(item?.system?.quantity ?? item?.quantity ?? 0) || 0);
  const max = Number(item?.system?.uses?.max) || 1;
  if ( item?.type !== "ammo" || max <= 1 || quantity <= 0 ) return quantity;
  const value = Math.max(0, Math.min(max, Number(item.system.uses.value ?? max) || 0));
  return (quantity - 1) * max + value;
}

/** Does this item fit the weapon, as PF2e's own isAmmoFor says (else by its ammunition type)? */
function fits(item, weapon) {
  if ( !item || !weapon || item === weapon || (item.id && item.id === weapon.id) ) return false;
  if ( typeof item.isAmmoFor === "function" ) {
    try {
      return !!item.isAmmoFor(weapon);
    } catch ( err ) {
      return false;
    }
  }
  return item.type === "ammo" && !!item.system?.baseItem && item.system.baseItem === weapon.system?.ammo?.baseType;
}

/**
 * The compatible ammunition a character carries for a weapon, as PF2e's Reload lists it: ammunition not stowed away,
 * and weapons usable as ammunition.
 */
export function ammoStacks(actor, weapon) {
  const types = actor?.itemTypes ?? {};
  const carried = [...(types.ammo ?? []).filter(i => !i.isStowed), ...(types.weapon ?? []).filter(i => i.system?.usage?.canBeAmmo)];
  return carried.filter(i => fits(i, weapon));
}

/** What's loaded in a weapon that's loaded (PF2e's getLoadedAmmo: its subitems that fit it, by their order). */
export function loadedIn(weapon) {
  if ( !Number(weapon?.system?.ammo?.capacity) ) return [];
  return [...(weapon.subitems ?? [])].filter(i => i?.type === "ammo" || (i?.type === "weapon" && fits(i, weapon)))
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));
}

/** The rounds a weapon has to shoot, loaded and carried; null for one that takes none. */
export function roundsOf(actor, weapon) {
  if ( !ammoOf(actor, weapon) ) return null;
  return [...loadedIn(weapon), ...ammoStacks(actor, weapon)].reduce((n, i) => n + roundsIn(i), 0);
}

/**
 * The ammunition a weapon shoots next, for its name (the planner's, a fight's summary): what's ready in it, else the
 * stack it would be readied from (readyAmmo's). Null for none.
 */
export function nextAmmo(actor, weapon) {
  const how = ammoOf(actor, weapon);
  if ( !how ) return null;
  if ( readyRounds(weapon) >= how.expend ) return weapon.ammo;
  // (A bow's stack holds the whole shot itself; what's loaded takes a round at a time.)
  const stacks = ammoStacks(actor, weapon).filter(i => roundsIn(i) >= (how.picked ? how.expend : 1));
  return stacks.find(i => i.id === weapon.system?.selectedAmmoId) ?? [...stacks].sort((a, b) => roundsIn(b) - roundsIn(a))[0] ?? null;
}

/** The rounds ready to shoot, as PF2e's Strike counts them before it rolls (weapon.ammo: loaded, or picked). */
function readyRounds(weapon) {
  const ammo = weapon?.ammo;
  if ( !ammo ) return 0;
  return ammo.type === "ammo" && Number(ammo.system?.uses?.max) > 1 ? Number(ammo.system.uses.value) || 0 : Number(ammo.system?.quantity ?? ammo.quantity) || 0;
}

/** The weapon itself, as the actor holds it (a Strike's item may be a copy of it). */
const ownWeapon = (actor, weapon) => actor?.items?.get?.(weapon?.id) ?? weapon;

/**
 * Before PF2e's own Strike rolls in a live battle: a weapon with too little ammunition ready, readied as its player
 * would ready it, from the compatible stack PF2e's own pick names (`system.selectedAmmoId`), else the one with the most
 * rounds. A bow's stack picked (its sheet's ammunition list sets selectedAmmoId); anything else loaded with what the shot
 * needs, one magazine at most, as its sheet's Reload loads it (PF2e's attach, the stack's own count taken down). Nothing
 * where it's ready, has nothing compatible, or PF2e has no way to (then PF2e refuses, and the engine rolls it).
 * @returns {Promise<boolean>} whether anything was readied
 */
export async function readyAmmo(actor, weapon) {
  const how = ammoOf(actor, weapon);
  if ( !how ) return false;
  const need = how.expend - readyRounds(weapon);
  if ( need <= 0 ) return false;
  const chosen = nextAmmo(actor, weapon);
  if ( !chosen ) return false;
  const own = ownWeapon(actor, weapon);
  if ( how.picked ) {
    if ( typeof own?.update !== "function" ) return false;
    await own.update({ "system.selectedAmmoId": chosen.id });
    return true;
  }
  if ( typeof own?.attach !== "function" ) return false;
  // (Room for it: its capacity, less what's loaded and not spent.)
  const loaded = loadedIn(own).filter(i => roundsIn(i) > 0).reduce((n, i) => n + (Number(i.system?.quantity) || 0), 0);
  const room = Math.max(0, (how.capacity || 1) - loaded);
  const magazine = chosen.type === "ammo" && Number(chosen.system?.uses?.max) > 1;
  const quantity = magazine ? Math.min(1, room) : Math.min(need, room, Number(chosen.system?.quantity) || 0);
  if ( quantity <= 0 ) return false;
  await own.attach(chosen, { quantity, stack: true });
  return true;
}

/** What of an item readying and shooting change: a stack's count, a magazine's uses, a bow's pick, what's loaded. */
const AMMO_PATHS = ["system.quantity", "system.uses.value", "system.selectedAmmoId", "system.subitems"];
const valueAt = (data, path) => path.split(".").reduce((x, k) => (x === null || x === undefined ? undefined : x[k]), data);
const dataOf = item => (typeof item?.toObject === "function" ? item.toObject() : null);

/** The weapon and its compatible ammunition as they are, before PF2e's Strike rolls (for ammoUndo). */
export function ammoState(actor, weapon) {
  const items = new Map();
  for ( const item of [ownWeapon(actor, weapon), ...ammoStacks(actor, weapon)] ) {
    const data = dataOf(item);
    if ( data && item.id ) items.set(item.id, data);
  }
  return { ids: new Set([...(actor?.items ?? [])].map(i => i.id)), items };
}

/**
 * An undo record for what readying and shooting changed since ammoState (`state`): each item as it was, one used up
 * made again, ammunition set aside into the inventory (an empty magazine swapped out) taken away. Null where nothing
 * changed.
 */
export function ammoUndo(tokenDoc, actor, state) {
  if ( !state || !actor ) return null;
  const record = undoRecord(tokenDoc, actor, { statusesBefore: false });
  for ( const [id, was] of state.items ) {
    const item = actor.items?.get?.(id);
    if ( !item ) {
      record.deletedItems.push(was);
      continue;
    }
    const now = dataOf(item) ?? {};
    const update = {};
    for ( const path of AMMO_PATHS ) {
      const before = valueAt(was, path);
      if ( before !== undefined && JSON.stringify(before) !== JSON.stringify(valueAt(now, path)) ) update[path] = before;
    }
    if ( Object.keys(update).length ) record.itemUpdates.push({ id, update });
  }
  for ( const item of actor.items ?? [] ) {
    if ( !state.ids.has(item.id) && ["ammo", "weapon"].includes(item.type) ) record.createdItems.push(item.id);
  }
  return record.itemUpdates.length || record.deletedItems.length || record.createdItems.length ? record : null;
}

/**
 * The rounds a turn's shots spent that the sheet didn't (the engine's own dice, where PF2e's Strike didn't roll: PF2e
 * spends its own as it rolls), taken from the weapon's compatible ammunition, the stack with the most first, as PF2e's
 * own spending leaves it (one of no use left, gone); what was there kept in `undo`. `start`: the rounds the sheet had
 * as the turn began; `spent`: the rounds the engine counts spent since.
 */
export async function spendRounds(actor, weaponId, { start, spent }, undo) {
  const weapon = actor?.items?.get?.(weaponId);
  const now = roundsOf(actor, weapon);
  if ( now === null ) return;
  let owed = spent - Math.max(0, start - now);
  for ( const stack of ammoStacks(actor, weapon).sort((a, b) => roundsIn(b) - roundsIn(a)) ) {
    if ( owed <= 0 ) break;
    const has = roundsIn(stack);
    const take = Math.min(owed, has);
    if ( take <= 0 ) continue;
    owed -= take;
    const left = has - take;
    const uses = stack.system?.uses;
    if ( left <= 0 && stack.type === "ammo" && uses?.autoDestroy && !(stack.system?.rules?.length) ) {
      undo.deletedItems.push(dataOf(stack));
      await stack.delete();
      continue;
    }
    const max = Number(uses?.max) || 1;
    const magazine = stack.type === "ammo" && max > 1;
    const quantity = magazine ? Math.ceil(left / max) : left;
    const update = { "system.quantity": quantity, ...(magazine ? { "system.uses.value": quantity > 0 ? left - (quantity - 1) * max : 0 } : {}) };
    undo.itemUpdates.push({ id: stack.id, update: Object.fromEntries(Object.keys(update).map(k => [k, valueAt(dataOf(stack) ?? stack, k)])) });
    await stack.update(update);
  }
}
