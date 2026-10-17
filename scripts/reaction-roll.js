/**
 * A reaction's Strike in a live battle, rolled with PF2e's own roller (API 19 rollReaction): its attack card at the one
 * it strikes and, on a hit, its damage card, as the sheet's Strike rolls them, with no roll dialog. A reaction's Strike
 * takes no multiple attack penalty (Reactive Strike's rule): the Strike's first variant, its damage with no MAP increase.
 * The target goes to PF2e's Strike as its `target` (as PF2e's own Damage button passes it), so the user's own targets
 * are never touched.
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
 * A click PF2e reads as "no dialog" (eventToRollParams): Shift flips the user's own Show check (or damage) dialogs
 * setting, so Shift is down just when that setting shows them. No Ctrl: the card goes in the chat's own mode.
 */
const noDialog = setting => ({ shiftKey: !!game.user?.settings?.[setting], ctrlKey: false, metaKey: false });

/**
 * The target as PF2e's Strike takes it: its token on the canvas (PF2e reads its document, and from the two tokens the
 * distance and flanking); one not drawn here, by its document alone, all PF2e reads of it.
 */
const asTarget = doc => doc.object ?? { document: doc };

/** The attack's card just made (the newest by this actor at this token): its context, as PF2e's own Damage button passes it. */
function attackContext(actor, target) {
  const recent = game.messages?.contents?.slice(-10).reverse() ?? [];
  return recent.find(m => {
    const c = m?.flags?.pf2e?.context;
    return c?.type === "attack-roll" && c.origin?.actor === actor.uuid && c.target?.token === target.uuid;
  })?.flags.pf2e.context;
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
 * A reaction's Strike rolled with PF2e's own roller: the attack at `target` (its AC and the degree PF2e's), and on a hit
 * the damage, critical damage on a critical hit.
 * @param {TokenDocument} token   the one reacting
 * @param {object} options        {action: the engine's strike, {id, name}; target: the TokenDocument it strikes}
 * @returns {Promise<object|null>} {attack: {degree, natural, total}, damage: {byType} | null}, or null (the engine rolls it)
 */
export async function rollPf2eReaction(token, { action, target } = {}) {
  const actor = token?.actor;
  const strike = strikeFor(actor, action?.id);
  if ( !strike || !target || typeof strike.variants?.[0]?.roll !== "function" ) return null;
  const roll = await strike.variants[0].roll({ event: noDialog("showCheckDialogs"), target: asTarget(target) });
  const degree = roll?.degreeOfSuccess;
  if ( !Number.isInteger(degree) || degree < 0 || degree > 3 ) return null;
  const out = { attack: { degree, natural: naturalOf(roll), total: Number(roll.total) }, damage: null };
  const kind = degree === 3 ? "critical" : "damage";
  if ( degree < 2 || typeof strike[kind] !== "function" ) return out;
  const rolled = await strike[kind]({ event: noDialog("showDamageDialogs"), target: asTarget(target), mapIncreases: 0, checkContext: attackContext(actor, target) });
  const byType = damageByType(rolled);
  if ( Object.keys(byType).length ) out.damage = { byType };
  return out;
}
