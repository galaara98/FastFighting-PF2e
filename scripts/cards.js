/**
 * The damage cards FastFighting rolls in a live battle's turns (rollStrike's and rollDamage's), which it applies itself
 * (applyDamageCard) or settles by its own sum: each marked as its own (flags["fast-fighting-pf2e"].rolled), so the
 * card's Apply buttons and its Apply menu entries, which would apply the damage a second time, are gone for everyone
 * (the GMs' and the players'); and a spell attack's critical hit, whose card PF2e doubles only as it's applied (its
 * Double button), applied doubled (`times`). The mark counts only on a card a GM made: anyone may put any flag on their
 * own card, and a player's would multiply the damage it's applied with, or hide its Apply buttons. A card whose damage
 * the live battle applied itself, whoever made it (a player's reaction rolled on their screen when FastFighting asks, a
 * player's damage card applied for them), loses its Apply too in the browser of the GM who plays the battle: by the ids
 * the core noted as it applied them (its damageApplied), never by the card's flags. A card the table settles itself after
 * all (the core's leaveToTable, API 21: a player's character's at another, Apply players' damage off) loses its mark
 * (unmarkRolled), its Apply back.
 */
import { damageApplied } from "./core.js";
import { t } from "./words.js";

/** This module's id: its flags' scope. */
export const HELPER_ID = "fast-fighting-pf2e";

/** The chat's cards now, by id: what's new after a roll is what it made. */
export const cardIds = () => new Set((globalThis.game?.messages?.contents ?? []).map(m => m?.id));

/**
 * Was this card made in this browser (by its user, who just rolled)? Anyone can post a card with any speaker meanwhile:
 * another player's card for the same creature is never taken for the one a roll here made.
 */
export const madeHere = message => !!globalThis.game?.user?.id && message?.author?.id === globalThis.game.user.id;

/**
 * The damage card a roll just made for this actor: the newest PF2e damage roll's card (context "damage-roll") not
 * among `seen`, made here (madeHere), its speaker the actor. Null for none.
 */
export function damageCardSince(seen, actor) {
  const fresh = (globalThis.game?.messages?.contents ?? []).filter(m => m && !seen.has(m.id) && madeHere(m));
  return fresh.reverse().find(m => m.flags?.pf2e?.context?.type === "damage-roll" && (!actor || m.speaker?.actor === actor.id)) ?? null;
}

/** Marks a damage card as FastFighting's, applied `times` over (2: a spell attack's critical hit). */
export async function markRolled(message, times = 1) {
  if ( typeof message?.setFlag !== "function" ) return;
  await message.setFlag(HELPER_ID, "rolled", { times: Number(times) > 0 ? Number(times) : 1 });
}

/**
 * A card of FastFighting's it won't apply after all, the table settling it (the core's leaveToTable, API 21): its mark
 * off, so its Apply buttons and menu entries are back for everyone. Only its own mark, on a card a GM made.
 */
export async function unmarkRolled(message) {
  if ( !rolledHere(message) || typeof message?.unsetFlag !== "function" ) return;
  await message.unsetFlag(HELPER_ID, "rolled");
}

/**
 * Is this card one FastFighting rolled for its own turn (markRolled)? Its mark, on a card a GM made (FastFighting rolls
 * in the GM's browser); a player's card is theirs, whatever it says.
 */
export const rolledHere = message => !!message?.flags?.[HELPER_ID]?.rolled && !!message?.author?.isGM;

/** How many times over FastFighting applies the card's total: as markRolled said on its own card, else 1. */
export function timesOf(message) {
  const n = rolledHere(message) ? Number(message.flags[HELPER_ID].rolled.times) : 1;
  return n > 0 ? n : 1;
}

/** Is FastFighting's the say on this card's damage: its own mark on a GM's card, or a card the live battle applied? */
export const handled = message => rolledHere(message) || damageApplied(message);

/** A card of FastFighting's, rendered (renderChatMessageHTML): its Apply buttons gone, a line saying FastFighting does it. */
export function hideApply(message, html) {
  if ( !handled(message) ) return;
  const sections = [...(html?.querySelectorAll?.(".damage-application") ?? [])];
  sections.forEach((section, i) => {
    const note = i === 0 && globalThis.document ? Object.assign(globalThis.document.createElement("span"), { textContent: t("DamageHandled") }) : null;
    section.replaceChildren(...(note ? [note] : []));
  });
}

/** The chat's menu (getChatMessageContextOptions): PF2e's Apply Damage entries (Half, Double ...) not on a card of FastFighting's. */
export function hideApplyMenu(app, options) {
  for ( const entry of Array.isArray(options) ? options : [] ) {
    if ( typeof entry?.label !== "string" || !entry.label.startsWith("PF2E.DamageButton.") || typeof entry.visible !== "function" ) continue;
    const visible = entry.visible;
    entry.visible = li => !handled(globalThis.game?.messages?.get?.(li?.dataset?.messageId)) && visible(li);
  }
}
