/**
 * A Strike in a live battle, rolled with PF2e's own roller (API 19 rollStrike): its attack card at the one it strikes
 * and, on a hit, its damage card, as the sheet's Strike rolls them, with no roll dialog. Every Strike in a turn
 * FastFighting plays (the variant for the attacks made before it: the multiple attack penalty), and a reaction's (the
 * first variant: Reactive Strike takes no multiple attack penalty). The target goes to PF2e's Strike as its `target`
 * (as PF2e's own Damage button passes it), so the user's own targets are never touched. Each is counted for this turn's
 * multiple attack penalty on a check with the attack trait (check-roll.js).
 */
import { listOf, naturalOf } from "./read-turn.js";

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
 * A click PF2e reads (eventToRollParams): Shift flips the user's own Show check (or damage) dialogs setting, so Shift
 * is down just when that setting shows them, and there's no dialog. Ctrl rolls it for the GMs only (`secret`); without
 * it, the card goes in the chat's own mode.
 */
export const click = (setting, secret = false) => ({ shiftKey: !!game.user?.settings?.[setting], ctrlKey: !!secret, metaKey: false });

/**
 * The attacks each token has made this turn, as this client rolled them, by token id: {turn, count, card} (the last
 * one's card). PF2e counts them for the multiple attack penalty; the core tells a Strike's count (attackNumber), not a
 * check's, so a check with the attack trait (a Trip, an Escape) goes by this.
 */
const ATTACKS = new Map();

/** This combat's turn, as a key; null outside a combat under way. */
function turnKey() {
  const c = game.combat;
  return c?.started ? `${c.id}.${c.round}.${c.turn}` : null;
}

/** The attacks this token has made this turn: none known of, or its last one's card gone (the turn rewound), 0. */
export function attacksSoFar(token) {
  const r = ATTACKS.get(token?.id);
  const key = turnKey();
  if ( !r || !key || r.turn !== key || (r.card && !game.messages?.get?.(r.card)) ) return 0;
  return r.count;
}

/** One more attack this turn, its card's id `card`: counted on from those known of, or `before` (the core's count). */
export function noteAttack(token, card = null, before = 0) {
  const key = turnKey();
  if ( !key || !token?.id ) return;
  ATTACKS.set(token.id, { turn: key, count: Math.max(attacksSoFar(token), Number(before) || 0) + 1, card });
}

/**
 * The target as PF2e's Strike takes it: its token on the canvas (PF2e reads its document, and from the two tokens the
 * distance and flanking); one not drawn here, by its document alone, all PF2e reads of it.
 */
const asTarget = doc => doc.object ?? { document: doc };

/** The attack's card just made: the newest by this actor at this token. */
function attackCard(actor, target) {
  const recent = game.messages?.contents?.slice(-10).reverse() ?? [];
  return recent.find(m => {
    const c = m?.flags?.pf2e?.context;
    return c?.type === "attack-roll" && c.origin?.actor === actor.uuid && c.target?.token === target.uuid;
  }) ?? null;
}

/** A PF2e damage roll's damage by type, as rolled (before the target's IWR); persistent damage, which comes later, left out. */
export function damageByType(roll) {
  const out = {};
  for ( const i of listOf(roll?.instances) ) {
    const n = Number(i?.total);
    if ( i?.persistent || !(n > 0) || (i.kinds instanceof Set && !i.kinds.has("damage")) ) continue;
    const type = typeof i.type === "string" && i.type ? i.type : "untyped";
    out[type] = (out[type] ?? 0) + n;
  }
  return out;
}

/**
 * A Strike rolled with PF2e's own roller: the attack at `target` (its AC and the degree PF2e's), the variant for the
 * attacks made before it (no more than the third: MAP -10, or -8 agile), and on a hit the damage, critical damage on a
 * critical hit, as that variant's (PF2e's map:increases).
 * @param {TokenDocument} token   the one striking
 * @param {object} options        {action: the engine's strike, {id, name}; target: the TokenDocument it strikes;
 *                                 attackNumber: the attacks before it this turn; secret: for the GMs only}
 * @returns {Promise<object|null>} {attack: {degree, natural, total}, damage: {byType} | null}, or null (the engine rolls it)
 */
export async function rollPf2eStrike(token, { action, target, attackNumber = 0, secret = false } = {}) {
  const actor = token?.actor;
  const strike = strikeFor(actor, action?.id);
  const map = Math.max(0, Math.min(2, Math.floor(Number(attackNumber) || 0)));
  const variant = strike?.variants?.[map] ?? strike?.variants?.[0];
  if ( !strike || !target || typeof variant?.roll !== "function" ) return null;
  const roll = await variant.roll({ event: click("showCheckDialogs", secret), target: asTarget(target) });
  const degree = roll?.degreeOfSuccess;
  if ( !Number.isInteger(degree) || degree < 0 || degree > 3 ) return null;
  // (Counted for a check with the attack trait after it: its MAP.)
  const card = attackCard(actor, target);
  noteAttack(token, card?.id ?? null, Math.floor(Number(attackNumber) || 0));
  const out = { attack: { degree, natural: naturalOf(roll), total: Number(roll.total) }, damage: null };
  const kind = degree === 3 ? "critical" : "damage";
  if ( degree < 2 || typeof strike[kind] !== "function" ) return out;
  const rolled = await strike[kind]({ event: click("showDamageDialogs", secret), target: asTarget(target), mapIncreases: map, checkContext: card?.flags.pf2e.context });
  const byType = damageByType(rolled);
  if ( Object.keys(byType).length ) out.damage = { byType };
  return out;
}
