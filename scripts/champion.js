/**
 * A champion's reaction for an ally, as the core's allyHit reaction (its responses.js), by slug: the remaster's causes'
 * (Retributive Strike, Glimpse of Redemption, Liberating Step, Flash of Grandeur), set off by a foe damaging an ally,
 * both in the champion's aura. The ally resists the blow by the effect the reaction's card links (Champion's
 * Resistance: 2 + the champion's level), which a live battle lays PF2e's way (`applies`, commit.js); a Retributive
 * Strike strikes the foe in reach (Nimble Reprisal: a shot instead, or a Step first).
 */
import { part } from "./core.js";
import { grantedResistance, resistanceOf } from "./granted.js";

/** The champion's reactions set off by a foe damaging an ally, both in its champion's aura. */
export const AURA_REACTIONS = new Set(["retributive-strike", "glimpse-of-redemption", "liberating-step", "flash-of-grandeur"]);

/**
 * Its champion's aura, in feet: PF2e's own (the Aura rule element of Champion's Aura, slug champions-aura, sized by the
 * actor's flags.system.champion.aura: 15 feet, Expand Aura's 30); the flag where the aura is off (suppressed, or its
 * champion unconscious); else 15 (a champion from before the remaster: 15 feet).
 */
export function championAura(actor) {
  const aura = Number(actor?.auras?.get?.("champions-aura")?.radius);
  if ( aura > 0 ) return aura;
  const flag = Number(actor?.flags?.system?.champion?.aura);
  return flag > 0 ? flag : 15;
}

/**
 * The core's reaction for one of a champion's AURA_REACTIONS (else null): both the ally and the foe in its aura
 * (`range`, `byRange`); the blow lessened by the resistance its linked effect gives (`reduce`, the engine's sum), PF2e's
 * own application laying that effect in a live battle (`applies: "effect:<the reaction's item id>"`; none where the card
 * links no such effect, and the engine's sum stands); and Retributive Strike's Strike (`strike`; with Nimble Reprisal,
 * `strikeRanged` and a 5-foot `strikeStep`).
 * @param {Actor} actor
 * @param {Item} item       the reaction
 * @param {object} by       {slug: the reaction's, slugs: a Set of the actor's items'}
 */
export async function championReaction(actor, item, { slug, slugs = new Set() } = {}) {
  if ( !AURA_REACTIONS.has(slug) ) return null;
  const level = actor.level ?? 1;
  const aura = championAura(actor);
  const granted = await grantedResistance(item);
  // (The engine's own sum, as the effect has it: Champion's Resistance's "@item.origin.level+2", 2 + its level.)
  const resists = (granted ? resistanceOf(granted.effect, level) : null) ?? 2 + level;
  const strike = slug === "retributive-strike";
  const nimble = strike && slugs.has("nimble-reprisal");
  return {
    id: `${actor.id}.${slug}`, label: item.name, on: "allyHit", range: aura, byRange: aura, reduce: part([], resists),
    ...(granted ? { applies: `effect:${item.id}` } : {}),
    ...(strike ? { strike: true } : {}),
    ...(nimble ? { strikeRanged: true, strikeStep: 5 } : {})
  };
}
