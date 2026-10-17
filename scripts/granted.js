/**
 * The PF2e effects an item links in its text (a spell's Spell Effect, an action's effect on itself, a reaction's effect it
 * grants), each fetched once a session. And what a reaction's linked effect does to a blow: Champion's Resistance,
 * linked by a champion's reactions for an ally, resists all damage by the champion's level + 2 (its origin's level).
 */
import { ruleValue } from "./effects.js";

/** Effect items, fetched once a session (the same Bless serves every cleric). */
const EFFECT_CACHE = new Map();

/**
 * The PF2e effect an item links to (its self-effect, a spell's effect), or null. Only an Item of type "effect": the link
 * is the item's own data, which a player can write, and what it finds may be copied onto a sheet by the GM's client.
 */
export async function linkedEffect(uuid) {
  if ( !EFFECT_CACHE.has(uuid) ) {
    EFFECT_CACHE.set(uuid, (async () => {
      const doc = typeof uuid === "string" ? await fromUuid(uuid) : null;
      return doc?.documentName === "Item" && doc.type === "effect" ? doc : null;
    })().catch(() => null));
  }
  return EFFECT_CACHE.get(uuid);
}

/**
 * Could an actor's players open this document themselves? One in a compendium: only if each of them may see the pack
 * (a link a player wrote could name a hidden one's). A world document, any (every client has the world's).
 */
export function theirsToOpen(actor, doc) {
  if ( !doc?.pack ) return true;
  const pack = game.packs?.get(doc.pack);
  const players = game.users?.filter(u => !u.isGM && actor?.testUserPermission?.(u, "OWNER")) ?? [];
  return !!pack && players.every(u => pack.testUserPermission(u, "OBSERVER"));
}

/** The uuids an item's text links (@UUID[...]), in order. */
export const linksIn = html => Array.from(String(html ?? "").matchAll(/@UUID\[([^\]]+)\]/g), m => m[1]);

/** An effect PF2e can lay for one blow only, as it lays its own ephemeral effects: no choice to make, nothing granted. */
const forOneBlow = effect => !(effect.system?.rules ?? []).some(r => r?.key === "ChoiceSet" || (r?.key === "GrantItem" && r.inMemoryOnly !== true));

/** Its rules' Resistance to all damage, whenever it's on (no predicate). */
const allDamage = effect => (effect?.system?.rules ?? []).filter(r => r?.key === "Resistance" && [].concat(r.type ?? []).includes("all-damage")
  && !(Array.isArray(r.predicate) ? r.predicate.length : r.predicate));

/**
 * The effect a reaction grants the one it shields, as its card links it (Champion's Resistance on a Retributive Strike):
 * {uuid, effect}, the first effect its text links that resists damage, PF2e can lay for one blow, and its players could
 * open; or null.
 */
export async function grantedResistance(item) {
  for ( const uuid of linksIn(item?.system?.description?.value) ) {
    const effect = await linkedEffect(uuid);
    if ( !effect || !allDamage(effect).length || !forOneBlow(effect) || !theirsToOpen(item.actor, effect) ) continue;
    return { uuid, effect };
  }
  return null;
}

/**
 * How much of a blow that effect resists, granted by a creature of this level (its origin: "@item.origin.level+2"),
 * or null where its number can't be read.
 */
export function resistanceOf(effect, level) {
  const values = allDamage(effect).map(r => ruleValue(typeof r.value === "string" ? r.value.replace(/@item\.origin\.level/g, "@actor.level") : r.value, { actor: { level } }));
  const known = values.filter(v => Number.isFinite(v) && v > 0);
  return known.length ? Math.max(...known) : null;
}
