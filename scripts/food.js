/**
 * Food in PF2e, for the core (API 27: its foundry/food.js). What PF2e's creatures eat, how likely they come to a fight
 * hungry, what a body leaves when it dies, and what counts as food.
 *   - Eats nothing: mindless, constructs, undead, elementals, the bodiless. PF2e has no diet, so the rest is
 *     by kind: an animal or beast that bites (a strike made with jaws, fangs, a bite or mandibles) eats meat; any other
 *     animal or beast eats anything; any other living creature too, rarely hungry in a fight.
 *   - Meat: none from a body of no flesh (construct, elemental, incorporeal, ooze, plant, fungus, undead, swarm); else
 *     by size, tiny 1 to gargantuan 32, as our own "Uncooked meat" (PF2e has no such item).
 *   - Food: our meat, PF2e's rations, and anything tagged as alchemical food.
 * The core weighs the rest: wisdom against hunger, and the chance any creature that eats is famished.
 */
import { MODULE_ID } from "./core.js";
import { t } from "./words.js";

/** Creature traits of those that never eat. */
const EATS_NOTHING = Object.freeze(["mindless", "construct", "undead", "elemental", "incorporeal"]);
/** Creature traits of a body with no flesh to leave. */
const NO_FLESH = Object.freeze(["construct", "elemental", "incorporeal", "ooze", "plant", "fungus", "undead", "swarm"]);
/** A strike made with the mouth: its slug. */
const BITES = Object.freeze(["jaws", "fangs", "bite", "mandibles"]);
/** Portions of meat a body leaves, by PF2e size. */
const MEAT_BY_SIZE = Object.freeze({ tiny: 1, sm: 2, med: 4, lg: 8, huge: 16, grg: 32 });
/** How likely each kind comes to a fight hungry (the core's chance, before wisdom). */
export const HUNGER = Object.freeze({ biter: 0.4, beast: 0.3, living: 0.1 });
export const MEAT_ICON = "icons/consumables/meat/steak-raw-red-pink.webp";

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

/** What its body leaves when it dies: our "Uncooked meat", by size; null for a body of no flesh. */
export function pf2eMeatFor(actor) {
  if ( !actor || actor.type === "loot" || actor.type === "hazard" ) return null;
  const traits = traitsOf(actor);
  if ( NO_FLESH.some(k => traits.has(k)) ) return null;
  const quantity = MEAT_BY_SIZE[actor.system?.traits?.size?.value] ?? MEAT_BY_SIZE.med;
  return {
    quantity,
    item: {
      name: t("Meat"),
      type: "consumable",
      img: MEAT_ICON,
      system: {
        category: "other",
        quantity,
        bulk: { value: 0.1 },
        traits: { value: [], rarity: "common" },
        description: { value: `<p>${t("MeatHint")}</p>` }
      },
      flags: { [MODULE_ID]: { food: "meat" } }
    }
  };
}

/** Whether a thing can be eaten: {portions, meat}, or null. Our meat, rations, alchemical food. */
export function pf2eIsFood(item) {
  if ( !item ) return null;
  const quantity = Math.max(1, Number(item.system?.quantity ?? item.quantity ?? 1) || 1);
  const flags = item.flags?.[MODULE_ID] ?? (typeof item.getFlag === "function" ? { food: item.getFlag(MODULE_ID, "food") } : {});
  if ( flags?.food === "meat" ) return { portions: quantity, meat: true };
  const slug = item.system?.slug ?? item.slug ?? null;
  const tags = item.system?.traits?.otherTags ?? [];
  if ( slug === "rations" || tags.includes("alchemical-food") ) return { portions: quantity, meat: false };
  return null;
}
