/**
 * The Foundry side of reactions-read.js: an actor's reactions and triggered free actions, their text with its formulas
 * worked out and its links kept, each link resolved (a condition's slug, an effect item), read into the core's
 * reactions. And Draconic Momentum, by slug. adapter.js #reactions hands over what it doesn't know by slug.
 */
import { readReaction, momentumReaction } from "./reactions-read.js";
import { reading } from "./reading.js";
import { linkedEffect, theirsToOpen, linksIn } from "./granted.js";

/** PF2e's conditions by the uuid a text links them with: their slugs, fetched once a session. */
const CONDITION_SLUGS = new Map();

/** The PF2e condition a link names (its slug), or null: only a condition item. */
async function conditionSlug(uuid) {
  if ( !CONDITION_SLUGS.has(uuid) ) {
    CONDITION_SLUGS.set(uuid, (async () => {
      const doc = typeof uuid === "string" ? await fromUuid(uuid) : null;
      return doc?.documentName === "Item" && doc.type === "condition" ? (doc.system?.slug ?? doc.slug ?? null) : null;
    })().catch(() => null));
  }
  return CONDITION_SLUGS.get(uuid);
}

/** Its links, resolved: (uuid) -> a condition's slug, and (uuid) -> an effect item its players could open. */
async function linksOf(actor, html) {
  const conditions = new Map();
  const effects = new Map();
  for ( const uuid of new Set(linksIn(html)) ) {
    const slug = await conditionSlug(uuid);
    if ( slug ) {
      conditions.set(uuid, slug);
      continue;
    }
    const effect = await linkedEffect(uuid);
    if ( effect && theirsToOpen(actor, effect) ) effects.set(uuid, effect);
  }
  return { conditionOf: uuid => conditions.get(uuid) ?? null, effectOf: uuid => effects.get(uuid) ?? null };
}

/**
 * The core's reactions for these items of the actor's (reactions and free actions with a Trigger line), those the
 * reader can read whole.
 * @param {Actor} actor
 * @param {Item[]} items
 * @param {object} o
 * @param {object[]} o.actions     its actions as the spec has them (its Strikes, the abilities that recharge)
 * @param {Function} o.resolve     (item, {keepLinks}) -> its text with its formulas worked out (adapter.js resolvedText)
 * @param {Function} o.slugOf      an item's slug
 */
export async function itemReactions(actor, items, { actions = [], resolve, slugOf }) {
  if ( !items.length ) return [];
  const words = await reading();
  const kinds = [...(actor.system?.traits?.value ?? [])];
  const level = Number(actor.level) || 1;
  const strikes = actions.filter(a => a.kind === "strike" && !a.sequence).map(a => ({ id: a.id, name: a.name }));
  const own = actions.filter(a => a.itemId && Number.isFinite(a.uses)).map(a => ({ id: a.id, name: a.name, cooldown: a.cooldown ?? null, recharge: a.recharge ?? null,
    slug: slugOf(actor.items.get?.(a.itemId)) }));
  const out = [];
  for ( const item of items ) {
    const html = await resolve(item, { keepLinks: true });
    const slug = slugOf(item);
    let r = null;
    if ( slug === "draconic-momentum" ) {
      r = momentumReaction({ id: `${actor.id}.${item.id}`, label: item.name, html, actions: own, strikes, reading: words, name: actor.name, kinds });
    } else {
      const { conditionOf, effectOf } = await linksOf(actor, html);
      r = readReaction({ id: `${actor.id}.${item.id}`, label: item.name, html, actionType: item.system?.actionType?.value, frequency: item.system?.frequency ?? null,
        traits: [...(item.system?.traits?.value ?? [])] }, { reading: words, name: actor.name, kinds, level, strikes, actions: own, conditionOf, effectOf });
    }
    if ( r ) out.push(r);
  }
  return out;
}
