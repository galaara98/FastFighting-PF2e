/**
 * The damage cards FastFighting rolls in a live battle's turns (rollStrike's and rollDamage's), which it applies itself
 * (applyDamageCard) or settles by its own sum: each marked as its own (flags["fast-fighting-pf2e"].rolled), so the
 * card's Apply buttons and its Apply menu entries, which would apply the damage a second time, are gone for everyone
 * (the GMs' and the players'); and a spell attack's critical hit, whose card PF2e doubles only as it's applied (its
 * Double button), applied doubled (`times`).
 */
import { t } from "./words.js";

/** This module's id: its flags' scope. */
export const HELPER_ID = "fast-fighting-pf2e";

/** The chat's cards now, by id: what's new after a roll is what it made. */
export const cardIds = () => new Set((globalThis.game?.messages?.contents ?? []).map(m => m?.id));

/**
 * The damage card a roll just made for this actor: the newest PF2e damage roll's card (context "damage-roll") not
 * among `seen`, its speaker the actor. Null for none.
 */
export function damageCardSince(seen, actor) {
  const fresh = (globalThis.game?.messages?.contents ?? []).filter(m => m && !seen.has(m.id));
  return fresh.reverse().find(m => m.flags?.pf2e?.context?.type === "damage-roll" && (!actor || m.speaker?.actor === actor.id)) ?? null;
}

/** Marks a damage card as FastFighting's, applied `times` over (2: a spell attack's critical hit). */
export async function markRolled(message, times = 1) {
  if ( typeof message?.setFlag !== "function" ) return;
  await message.setFlag(HELPER_ID, "rolled", { times: Number(times) > 0 ? Number(times) : 1 });
}

/** Is this card one FastFighting rolled for its own turn (markRolled)? */
export const rolledHere = message => !!message?.flags?.[HELPER_ID]?.rolled;

/** How many times over FastFighting applies the card's total: 1, or as markRolled said. */
export function timesOf(message) {
  const n = Number(message?.flags?.[HELPER_ID]?.rolled?.times);
  return n > 0 ? n : 1;
}

/** A card of FastFighting's, rendered (renderChatMessageHTML): its Apply buttons gone, a line saying FastFighting does it. */
export function hideApply(message, html) {
  if ( !rolledHere(message) ) return;
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
    entry.visible = li => !rolledHere(globalThis.game?.messages?.get?.(li?.dataset?.messageId)) && visible(li);
  }
}
