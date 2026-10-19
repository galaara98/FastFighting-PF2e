/**
 * A Strike in a live battle, rolled with PF2e's own roller (API 19 rollStrike): its attack card at the one it strikes
 * and, on a hit, its damage card, as the sheet's Strike rolls them, with no roll dialog. Every Strike in a turn
 * FastFighting plays (the variant for the attacks made before it: the multiple attack penalty), and a reaction's (the
 * first variant: Reactive Strike takes no multiple attack penalty). The target goes to PF2e's Strike as its `target`
 * (as PF2e's own Damage button passes it), so the user's own targets are never touched.
 * A spell attack (a spell with the attack trait and damage) the same way, as its card's buttons roll it (rollSpell).
 * The damage card is marked as FastFighting's (cards.js), its Apply buttons gone: FastFighting applies it.
 * A weapon that takes ammunition has it readied first, as its player would (ammo.js readyAmmo: a bow's stack picked, a
 * crossbow loaded); PF2e's Strike then spends it, and the undo record of both goes back with the roll (`records`).
 */
import { listOf, naturalOf } from "./read-turn.js";
import { cardIds, damageCardSince, madeHere, markRolled } from "./cards.js";
import { ammoOf, ammoState, ammoUndo, readyAmmo } from "./ammo.js";

/** A character's or creature's weapon Strikes, as the system lists them (the ones it shows). */
export const strikesOf = actor => (actor.system?.actions ?? []).filter(s => s.type === "strike" && s.visible !== false);

/** The id of a Strike's action: the `index`th of strikesOf(actor). */
export const strikeId = (actor, s, index) => `${actor.id}.strike.${s.slug ?? index}.${index}`;

/**
 * The actor's PF2e Strike an engine strike stands for, by the id the adapter gave it: a Strike's, or one built on it (a
 * stratagem, a finisher, a poisoned blow), whose id begins with the Strike's. Where the sheet's Strikes have changed
 * since, the one Strike of the id's slug. Null for anything else (an Elemental Blast).
 */
export function strikeFor(actor, id) {
  if ( !actor || typeof id !== "string" ) return null;
  const strikes = strikesOf(actor);
  const own = strikes.find((s, index) => {
    const sid = strikeId(actor, s, index);
    return id === sid || id.startsWith(`${sid}.`);
  });
  if ( own ) return own;
  const bySlug = strikes.filter(s => s.slug && id.startsWith(`${actor.id}.strike.${s.slug}.`));
  return bySlug.length === 1 ? bySlug[0] : null;
}

/**
 * The spell attack an engine action stands for, by the adapter's id (the actor's id, "spell", the spell's id): an
 * attack spell with damage, from a spellcasting entry, as rollStrike rolls one. Null for anything else (a spell attack
 * with no damage: crowd control, the engine's roll).
 */
export function spellAttackFor(actor, id) {
  const parts = typeof id === "string" ? id.split(".") : [];
  if ( !actor?.items || parts.length !== 3 || parts[0] !== actor.id || parts[1] !== "spell" ) return null;
  const spell = actor.items.get?.(parts[2]);
  const damaging = Object.keys(spell?.system?.damage ?? {}).length > 0;
  return spell?.type === "spell" && spell.isAttack && damaging && typeof spell.rollAttack === "function" && spell.spellcasting?.statistic ? spell : null;
}

/**
 * A click PF2e reads (eventToRollParams): Shift flips the user's own Show check (or damage) dialogs setting, so Shift
 * is down just when that setting shows them, and there's no dialog. Ctrl rolls it for the GMs only (`secret`); without
 * it, the card goes in the chat's own mode.
 */
export const click = (setting, secret = false) => ({ shiftKey: !!game.user?.settings?.[setting], ctrlKey: !!secret, metaKey: false });

/** An item's slug, PF2e's own (none made from its name, which is in the world's language): the rollers find items by it. */
export const slugOf = item => item?.slug ?? item?.system?.slug ?? null;

/**
 * The target as PF2e's Strike takes it: its token on the canvas (PF2e reads its document, and from the two tokens the
 * distance and flanking); one not drawn here, by its document alone, all PF2e reads of it.
 */
const asTarget = doc => doc.object ?? { document: doc };

/**
 * The attack's card just made (the newest made here, madeHere, by this actor at this token): its context, as PF2e's own
 * Damage button passes it.
 */
function attackContext(actor, target) {
  const recent = game.messages?.contents?.slice(-10).reverse() ?? [];
  return recent.find(m => {
    const c = m?.flags?.pf2e?.context;
    return madeHere(m) && c?.type === "attack-roll" && c.origin?.actor === actor.uuid && c.target?.token === target.uuid;
  })?.flags.pf2e.context;
}

/**
 * A PF2e damage roll's damage by type, as rolled (before the target's IWR), `times` over; persistent damage, which comes
 * later, left out (PF2e's own application lays it on the target as its condition).
 */
export function damageByType(roll, times = 1) {
  const out = {};
  for ( const i of listOf(roll?.instances) ) {
    const n = Number(i?.total);
    if ( i?.persistent || !(n > 0) || (i.kinds instanceof Set && !i.kinds.has("damage")) ) continue;
    const type = typeof i.type === "string" && i.type ? i.type : "untyped";
    out[type] = (out[type] ?? 0) + n * times;
  }
  return out;
}

/** What PF2e's attack roll came to: {degree (0-3), natural, total}, or null (cancelled, or no degree). */
function attackOf(roll) {
  const degree = roll?.degreeOfSuccess;
  if ( !Number.isInteger(degree) || degree < 0 || degree > 3 ) return null;
  return { degree, natural: naturalOf(roll), total: Number(roll.total) };
}

/**
 * A hit's damage, rolled by `roll` (PF2e's own roller): {damage: {byType} | null, card}, its card marked as
 * FastFighting's, `times` over (cards.js). No card found: no `card`, and the core looks for it itself.
 */
async function damageOf(actor, roll, times = 1) {
  const seen = cardIds();
  const rolled = await roll();
  const card = damageCardSince(seen, actor);
  if ( card ) await markRolled(card, times);
  const byType = damageByType(rolled, times);
  return { damage: Object.keys(byType).length ? { byType } : null, ...(card ? { card: card.id } : {}) };
}

/**
 * A Strike rolled with PF2e's own roller: the attack at `target` (its AC and the degree PF2e's), the variant for the
 * attacks made before it (no more than the third: MAP -10, or -8 agile), and on a hit the damage, critical damage on a
 * critical hit, as that variant's (PF2e's map:increases). A spell attack: rollSpell. A weapon that takes ammunition:
 * readied first where it has too little ready (ammo.js), the sheet's Strikes read again after.
 * @param {TokenDocument} token   the one striking
 * @param {object} options        {action: the engine's strike, {id, name}; target: the TokenDocument it strikes;
 *                                 attackNumber: the attacks before it this turn; secret: for the GMs only}
 * @returns {Promise<object|null>} {attack: {degree, natural, total}, damage: {byType} | null, card: the damage card's
 *                                 id, where it's found, records: the undo record of its ammunition, readied and spent,
 *                                 where it took any}; or null (the engine rolls it), {records} where it readied some
 */
export async function rollPf2eStrike(token, { action, target, attackNumber = 0, secret = false } = {}) {
  const actor = token?.actor;
  const map = Math.max(0, Math.min(2, Math.floor(Number(attackNumber) || 0)));
  const spell = spellAttackFor(actor, action?.id);
  if ( spell ) return rollSpell(spell, actor, target, map, secret);
  let strike = strikeFor(actor, action?.id);
  const variantOf = s => s?.variants?.[map] ?? s?.variants?.[0];
  if ( !strike || !target || typeof variantOf(strike)?.roll !== "function" ) return null;
  // (Its ammunition, as the sheet had it: readied as a player would, and spent by PF2e's Strike as it rolls.)
  const before = ammoOf(actor, strike.item) ? ammoState(actor, strike.item) : null;
  if ( before && await readyAmmo(actor, strike.item) ) strike = strikeFor(actor, action?.id) ?? strike;
  const rolled = await variantOf(strike)?.roll?.({ event: click("showCheckDialogs", secret), target: asTarget(target) });
  const undo = before ? ammoUndo(token, actor, before) : null;
  const records = undo ? { records: [undo] } : {};
  const attack = attackOf(rolled);
  if ( !attack ) return undo ? records : null;
  const kind = attack.degree === 3 ? "critical" : "damage";
  if ( attack.degree < 2 || typeof strike[kind] !== "function" ) return { attack, damage: null, ...records };
  const checkContext = attackContext(actor, target);
  return { attack, ...(await damageOf(actor, () => strike[kind]({ event: click("showDamageDialogs", secret), target: asTarget(target), mapIncreases: map, checkContext }))), ...records };
}

/**
 * A spell attack, as its card's buttons roll it: Attack (spell.rollAttack: the spellcasting's attack at the target's
 * AC, the multiple attack penalty for the attacks before it) and, a hit, Damage (spell.rollDamage, at the rank the
 * adapter took it). PF2e's spell damage takes no target but the user's own targets, which stay untouched (the GM's,
 * none as a rule). Its card is a hit's, which PF2e doubles only as it's applied on a critical hit (its Double button):
 * then byType is doubled and the card applied doubled (cards.js). Only at a target drawn here (PF2e finds it by its
 * actor's tokens on this canvas); else null, the engine's roll.
 */
async function rollSpell(spell, actor, target, map, secret) {
  if ( !target?.object || !target.actor ) return null;
  const attack = attackOf(await spell.rollAttack(click("showCheckDialogs", secret), map + 1, { target: target.actor }));
  if ( !attack ) return null;
  if ( attack.degree < 2 || typeof spell.rollDamage !== "function" ) return { attack, damage: null };
  return { attack, ...(await damageOf(actor, () => spell.rollDamage(click("showDamageDialogs", secret)), attack.degree === 3 ? 2 : 1)) };
}
