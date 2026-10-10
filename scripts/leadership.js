/**
 * PF2e leadership: who leads a side, and what that's worth.
 * A leader is the creature with the best social/warfare skill relative to its level, boosted by the
 * Commander class (tactics), and by abilities that read like rallying cries or commanding auras.
 */

const LEADER_ABILITY = /(commander|captain|warlord|rally|inspir|command|leader|banner|battle cry|tactic)/i;

/**
 * @param {object[]} entries  [{id, level, skills: {diplomacy, intimidation, warfareLore}, isCommander, tactics: number, abilityNames: string[]}]
 * @returns {{id, score, reason, bonus: {brave, tacticalFloor, attack, ac}}[]} best first
 */
export function rankLeaders(entries) {
  const out = [];
  for ( const e of entries ) {
    const best = Math.max(e.skills?.diplomacy ?? -99, e.skills?.intimidation ?? -99, e.skills?.warfareLore ?? -99);
    if ( best <= -99 ) continue;
    const typical = e.level + 4;
    let score = best - typical;
    const reasons = [`best social/warfare skill ${best >= 0 ? "+" : ""}${best}`];
    if ( e.isCommander ) {
      score += 4 + Math.min(4, e.tactics ?? 0);
      reasons.push(`Commander (${e.tactics ?? 0} tactics)`);
    }
    const leaderAbilities = (e.abilityNames ?? []).filter(n => LEADER_ABILITY.test(n));
    if ( leaderAbilities.length ) {
      score += 3;
      reasons.push(leaderAbilities.slice(0, 2).join(", "));
    }
    out.push({ id: e.id, score, reason: reasons.join("; "), bonus: leaderBonus(score, e.isCommander) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Map a leadership score to side-wide effects. */
export function leaderBonus(score, isCommander = false) {
  if ( score >= 6 ) return { brave: 20, tacticalFloor: 60, attack: isCommander ? 1 : 0, ac: isCommander ? 1 : 0 };
  if ( score >= 3 ) return { brave: 15, tacticalFloor: 50, attack: isCommander ? 1 : 0, ac: 0 };
  if ( score >= 0 ) return { brave: 10, tacticalFloor: 40, attack: 0, ac: 0 };
  return { brave: 5, tacticalFloor: 0, attack: 0, ac: 0 };
}
