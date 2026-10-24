/**
 * Food in PF2e, for the core (API 27: its foundry/food.js). What PF2e's creatures eat, how likely they come to a fight
 * hungry, what a body leaves when it dies, and what counts as food.
 *   - Eats nothing: mindless, constructs, undead, elementals, the bodiless. PF2e has no diet, so the rest is
 *     by kind: an animal or beast that bites (a strike made with jaws, fangs, a bite or mandibles) eats meat; any other
 *     animal or beast eats anything; any other living creature too, rarely hungry in a fight.
 *   - Corpses (core API 30): a body leaves one, equipment (PF2e has no food type), its Bulk a creature's (tiny 1 to
 *     gargantuan 48): an undead's a Rotten Corpse, one made of metal or a machine's (metal, clockwork, robot) a Scrap
 *     Corpse, neither of them food; none from another body of no flesh (construct, elemental, incorporeal, ooze, plant,
 *     fungus, swarm; nor an incorporeal undead); else a Fresh Corpse, food, its portions by size (tiny 1 to gargantuan
 *     32) in the core's portions flag, eaten a portion at a time.
 *   - Food: a fresh corpse (or the "Uncooked meat" of before), PF2e's rations, and anything tagged as alchemical food.
 * The core weighs the rest: wisdom against hunger, and the chance any creature that eats is famished.
 */
import { MODULE_ID } from "./core.js";
import { t } from "./words.js";

/** Creature traits of those that never eat. */
const EATS_NOTHING = Object.freeze(["mindless", "construct", "undead", "elemental", "incorporeal"]);
/** Creature traits of a body with no flesh to leave (a corpse only as ROTTEN or SCRAP say). */
const NO_FLESH = Object.freeze(["construct", "elemental", "incorporeal", "ooze", "plant", "fungus", "undead", "swarm"]);
/** A body that rots: the undead's (not an incorporeal one's: it leaves none). */
const ROTTEN = Object.freeze(["undead"]);
/** A body of metal, or a machine's. */
const SCRAP = Object.freeze(["metal", "clockwork", "robot"]);
/** A corpse's Bulk, by PF2e size: a creature's. */
const BULK_BY_SIZE = Object.freeze({ tiny: 1, sm: 3, med: 6, lg: 12, huge: 24, grg: 48 });
/** Each kind of corpse: its name's key (and its hint's, with Hint) and icon. */
export const CORPSES = Object.freeze({
  fresh: { key: "FreshCorpse", img: "icons/consumables/meat/steak-raw-red-pink.webp" },
  rotten: { key: "RottenCorpse", img: "icons/commodities/bones/bones-stack-worn-brown.webp" },
  scrap: { key: "ScrapCorpse", img: "icons/commodities/tech/cog-gear-crank-steel.webp" }
});
/** A strike made with the mouth: its slug. */
const BITES = Object.freeze(["jaws", "fangs", "bite", "mandibles"]);
/** Portions of meat a body leaves, by PF2e size. */
const MEAT_BY_SIZE = Object.freeze({ tiny: 1, sm: 2, med: 4, lg: 8, huge: 16, grg: 32 });
/** How likely each kind comes to a fight hungry (the core's chance, before wisdom). */
export const HUNGER = Object.freeze({ biter: 0.4, beast: 0.3, living: 0.1 });
export const MEAT_ICON = CORPSES.fresh.img;

const traitsOf = actor => new Set(actor?.system?.traits?.value ?? []);

/** What it eats, and how likely it comes to a fight hungry. */
export function pf2eAppetite(actor) {
  if ( !actor || actor.type === "loot" || actor.type === "hazard" ) return null;
  const traits = traitsOf(actor);
  if ( EATS_NOTHING.some(k => traits.has(k)) ) return { diet: null, hunger: 0, cannibal: false };
  if ( traits.has("animal") || traits.has("beast") ) {
    const bites = (actor.itemTypes?.melee ?? []).some(s => BITES.includes(s.slug));
    return bites ? { diet: "meat", hunger: HUNGER.biter, cannibal: false } : { diet: "any", hunger: HUNGER.beast, cannibal: false };
  }
  return { diet: "any", hunger: HUNGER.living, cannibal: false };
}

/** The kind of corpse its body leaves (CORPSES), or null for none. */
export function pf2eCorpseKind(actor) {
  if ( !actor || actor.type === "loot" || actor.type === "hazard" ) return null;
  const traits = traitsOf(actor);
  if ( traits.has("incorporeal") ) return null;
  if ( ROTTEN.some(k => traits.has(k)) ) return "rotten";
  if ( SCRAP.some(k => traits.has(k)) ) return "scrap";
  return NO_FLESH.some(k => traits.has(k)) ? null : "fresh";
}

/** The corpse its body leaves when it dies (core API 30): {item, quantity: its portions, 0 for no food}, or null. */
export function pf2eMeatFor(actor) {
  const kind = pf2eCorpseKind(actor);
  if ( !kind ) return null;
  const size = actor.system?.traits?.size?.value;
  const portions = kind === "fresh" ? MEAT_BY_SIZE[size] ?? MEAT_BY_SIZE.med : 0;
  const { key, img } = CORPSES[kind];
  return {
    quantity: portions,
    item: {
      name: t(key),
      type: "equipment",
      img,
      system: {
        quantity: 1,
        bulk: { value: BULK_BY_SIZE[size] ?? BULK_BY_SIZE.med },
        traits: { value: [], rarity: "common" },
        description: { value: `<p>${t(`${key}Hint`)}</p>` }
      },
      flags: { [MODULE_ID]: { corpse: kind, ...(portions ? { food: "meat", portions } : {}) } }
    }
  };
}

/** Whether a thing can be eaten: {portions, meat}, or null. A fresh corpse (its portions left), our meat, rations, alchemical food. */
export function pf2eIsFood(item) {
  if ( !item ) return null;
  const quantity = Math.max(1, Number(item.system?.quantity ?? item.quantity ?? 1) || 1);
  const flags = item.flags?.[MODULE_ID] ?? (typeof item.getFlag === "function" ? { food: item.getFlag(MODULE_ID, "food"), portions: item.getFlag(MODULE_ID, "portions") } : {});
  if ( flags?.food === "meat" ) {
    // (A fresh corpse: its portions left, none once they're eaten. The meat of before: its quantity.)
    const portions = flags.portions ?? null;
    if ( portions === null ) return { portions: quantity, meat: true };
    return Number(portions) > 0 ? { portions: Math.round(Number(portions)), meat: true } : null;
  }
  const slug = item.system?.slug ?? item.slug ?? null;
  const tags = item.system?.traits?.otherTags ?? [];
  if ( slug === "rations" || tags.includes("alchemical-food") ) return { portions: quantity, meat: false };
  return null;
}
