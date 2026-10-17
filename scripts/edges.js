/**
 * Ways to gain an edge in PF2e, as the core's buffs (see the core's behavior/support.js). Pure, unit-tested.
 *
 * Aid: Prepare to Aid (an action), then the Aid reaction when the friend acts. A check against DC 15 with whatever
 * the friend's roll calls for (a Strike, its words, Medicine): +1 to that friend's next roll at whoever it's set on,
 * +2 on a critical success (+3 at master, +4 at legendary), -1 on a critical failure. It has to be in position to
 * help: beside the foe, for a Strike.
 * (Guidance and Sure Strike are spells, read from their effects; Recall Knowledge is the adapter's sizeUp.)
 */
import { t } from "./words.js";

/** DC to Aid (the remaster's). */
export const AID_DC = 15;

/** The skills Aid is weighed with, besides its Strikes: words and Medicine (by slug). */
export const AID_SKILLS = Object.freeze(["diplomacy", "medicine", "intimidation", "deception"]);

/**
 * An Aid action, or null when there's nothing to aid with. The free hands it takes (`hands`) are its best way's: a
 * Strike's grip, a healer's hand, none for words.
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.name             its localized name
 * @param {{bonus: number, hands?: number}[]} [o.strikes]   its Strikes (their attack bonuses, and the free hands they take)
 * @param {{mod: number, rank: number, hands?: number}[]} [o.skills]   the skills a talker or a healer would use (Diplomacy, Medicine ...)
 */
export function aidAction({ id, name, strikes = [], skills = [] }) {
  const ways = [...strikes.map(s => ({ mod: Number(s?.bonus), rank: 0, hands: Number(s?.hands) || 0 })),
    ...skills.map(s => ({ mod: Number(s?.mod), rank: Number(s?.rank) || 0, hands: Number(s?.hands) || 0 }))]
    .filter(x => Number.isFinite(x.mod));
  if ( !ways.length ) return null;
  const best = ways.reduce((a, b) => (b.mod > a.mod ? b : a));
  const rank = Math.max(0, ...ways.map(x => x.rank));
  const aided = n => ({ mods: { attack: n, checks: n }, uses: 1, vsFocus: true, rounds: 1, label: n > 0 ? t("Aided") : t("Hindered") });
  return {
    id, name, kind: "buff", cost: 1, hands: best.hands, includeSelf: false, besideFoe: 5,
    melee: false, range: { increment: 30, max: 30, noPenalty: true },
    check: { mod: best.mod, dc: AID_DC, label: name },
    onDegree: [aided(-1), null, aided(1), aided(rank >= 4 ? 4 : rank >= 3 ? 3 : 2)]
  };
}
