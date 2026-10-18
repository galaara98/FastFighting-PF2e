/**
 * An action's own card and its damage in a live battle (API 19 useAction and rollDamage), as its user shows and rolls
 * them from the sheet, in a turn FastFighting plays:
 *  - Its card: a spell's as its spellcasting entry casts it (spell.toMessage, an actual cast at the rank the adapter
 *    took it), nothing spent (no slot, no focus point, no use) and no template placed (PF2e places one only from its
 *    button); an ability's, a self-buff's (Rage) or a consumable's as its sheet posts it (item.toMessage), nothing used.
 *    None for an action with no item of its own (Take Cover, Aid, a Strike), and none for a spell attack rollStrike
 *    rolls (its attack card shows it).
 *  - Its damage, once for all it catches: a spell's as its card's Damage button rolls it (spell.rollDamage); an
 *    ability's (a breath weapon's) as the first @Damage link on its card rolls it, clicked as the GM would (PF2e's
 *    inline damage: an elite's or a weak creature's adjustment, its rule elements); one with none that deals a
 *    Strike's damage (Rend: the core's action.strikeOf, glossary.js), as that Strike's own Damage rolls it, at the
 *    target. Nothing applied: FastFighting applies each target's share with applyDamageCard. Its card is marked as
 *    FastFighting's (cards.js).
 * The action is found by the id the adapter gave it: the actor's id, then "spell" and the spell's id, "self" or "item"
 * and the item's id, or the item's id alone (an ability: abilities.js).
 */
import { click, damageByType, spellAttackFor, strikeFor } from "./strike-roll.js";
import { cardIds, damageCardSince, markRolled } from "./cards.js";
import { damageRollOf } from "./read-turn.js";

/** The kinds of item an action of each kind of id is, by the id's middle part (none: an ability). */
const KINDS = Object.freeze({ __proto__: null, spell: ["spell"], self: ["action", "feat"], item: ["consumable"], "": ["action", "feat"] });

/**
 * Spells whose card holds a part of what the adapter makes of them: Force Barrage, one missile's damage (the engine's,
 * all of them).
 */
const PART_CARDS = new Set(["force-barrage"]);

/** An item's slug, PF2e's own. */
const slugOf = item => item?.slug ?? item?.system?.slug ?? null;

/** For the GMs only (`secret`), as PF2e posts a GM's card; else in the chat's own mode. */
const modeOf = secret => (secret ? { mode: game.user?.isGM ? "gm" : "blind" } : {});

/** The item an action's id names among the actor's (the adapter's ids), of a kind it can be; else null. */
export function actionItem(actor, id) {
  const parts = typeof id === "string" ? id.split(".") : [];
  if ( !actor?.items || parts[0] !== actor.id || parts.length < 2 || parts.length > 3 ) return null;
  const kind = parts.length === 3 ? parts[1] : "";
  const item = KINDS[kind] ? actor.items.get?.(parts.at(-1)) : null;
  return item && KINDS[kind].includes(item.type) ? item : null;
}

/**
 * The action's own card, as its user shows it (above).
 * @param {TokenDocument} token   the one using it
 * @param {object} options        {action: {id, name}; targets: TokenDocuments; secret: for the GMs only}
 * @returns {Promise<object|null>} {card: its message id}, or null (none to show)
 */
export async function usePf2eAction(token, { action, targets = [], secret = false } = {}) {
  const actor = token?.actor;
  const item = actionItem(actor, action?.id);
  if ( typeof item?.toMessage !== "function" ) return null;
  // (A spell attack rollStrike rolls, at a target drawn here: its attack card shows it.)
  if ( spellAttackFor(actor, action.id) && targets?.[0]?.object ) return null;
  const message = item.type === "spell"
    ? await item.toMessage(null, { actualCast: true, data: { castRank: item.rank }, ...modeOf(secret) })
    : await item.toMessage(null, modeOf(secret));
  return typeof message?.id === "string" ? { card: message.id } : null;
}

/** The first damage link on a card (PF2e's inline @Damage), not a persistent one alone; null for none. */
async function damageLink(card) {
  const message = typeof card === "string" ? game.messages?.get?.(card) : null;
  const html = typeof message?.renderHTML === "function" ? await message.renderHTML() : null;
  const links = [...(html?.querySelectorAll?.("a.inline-roll[data-damage-roll]") ?? [])];
  return links.find(a => !("persistent" in (a.dataset ?? {}))) ?? null;
}

/**
 * An ability's damage, its card's first @Damage link clicked as the GM would (PF2e's TextEditor._onClickInlineRoll, as
 * the chat's click hands it on: the card's speaker and item, its traits and options). `secret`: PF2e's inline damage
 * takes no Ctrl, so the link carries the secret roll option PF2e rolls for the GMs only.
 */
async function abilityDamage(card, secret) {
  const editor = globalThis.CONFIG?.ux?.TextEditor;
  const link = typeof editor?._onClickInlineRoll === "function" ? await damageLink(card) : null;
  if ( !link ) return false;
  if ( secret ) link.dataset.rollOptions = [link.dataset.rollOptions, "secret"].filter(Boolean).join(",");
  await editor._onClickInlineRoll({ target: link, currentTarget: link, ...click("showDamageDialogs", secret), preventDefault() {}, stopPropagation() {} });
  return true;
}

/**
 * The action's damage, rolled once for all it catches (above).
 * @param {TokenDocument} token   the one using it
 * @param {object} options        {action: {id, name, strikeOf}; card: useAction's card, or null; secret: for the GMs
 *                                 only; target: the TokenDocument it's aimed at first, or null}
 * @returns {Promise<object|null>} {damage: {byType}, card: its message id, or null}, or null (the engine rolls it)
 */
export async function rollPf2eDamage(token, { action, card = null, secret = false, target = null } = {}) {
  const actor = token?.actor;
  const item = actionItem(actor, action?.id);
  if ( !item || item.type === "consumable" ) return null;
  const seen = cardIds();
  let roll = null;
  if ( item.type === "spell" ) {
    const damaging = Object.keys(item.system?.damage ?? {}).length > 0;
    // (A spell attack's damage comes with its attack, rollStrike's.)
    if ( !damaging || item.isAttack || PART_CARDS.has(slugOf(item)) || typeof item.rollDamage !== "function" ) return null;
    roll = await item.rollDamage(click("showDamageDialogs", secret));
  } else if ( !(await abilityDamage(card, secret)) ) {
    // (No damage of its own on its card: a Strike's, dealt with no roll of its own (Rend), by that Strike's own Damage.)
    const strike = strikeFor(actor, action?.strikeOf);
    if ( typeof strike?.damage !== "function" ) return null;
    roll = await strike.damage({ event: click("showDamageDialogs", secret), ...(target ? { target: target.object ?? { document: target } } : {}) });
  }
  const message = damageCardSince(seen, actor);
  if ( message ) await markRolled(message);
  const byType = damageByType(damageRollOf(message) ?? roll);
  if ( !Object.keys(byType).length ) return null;
  return { damage: { byType }, card: message?.id ?? null };
}
