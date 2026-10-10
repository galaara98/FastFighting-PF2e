/**
 * Pathfinder 2e rules for the simulation engine. Pure functions only: no Foundry globals.
 */
import { DOWNED_MODELS, STATUS } from "./core.js";

/** Damage types grouped for IWR keys such as "physical" or "energy". */
const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing", "bleed"]);
const ENERGY = new Set(["acid", "cold", "electricity", "fire", "sonic", "force", "vitality", "void"]);

function iwrMatches(key, type) {
  if ( key === type || key === "all-damage" ) return true;
  if ( key === "physical" ) return PHYSICAL.has(type);
  if ( key === "energy" ) return ENERGY.has(type);
  return false;
}

export const pf2eRules = {
  id: "pf2e",
  actionsPerTurn: 3,
  /** A hit always deals at least 1 damage before resistances, however large the penalties. */
  minimumDamage: 1,

  degreeOfSuccess(natural, total, dc) {
    let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if ( natural === 20 ) degree = Math.min(3, degree + 1);
    else if ( natural === 1 ) degree = Math.max(0, degree - 1);
    return degree;
  },

  roll(rng, modifier, dc) {
    const natural = rng.d20();
    return { natural, total: natural + modifier, degree: this.degreeOfSuccess(natural, natural + modifier, dc) };
  },

  /** Multiple attack penalty for the nth attack this turn (0-based). */
  attackPenalty(action, attacksMade) {
    if ( action.subjectToMAP === false ) return 0;
    const maps = action.maps ?? [0, -5, -10];
    return maps[Math.min(attacksMade, maps.length - 1)] ?? 0;
  },

  /** Damage multiplier for a target's saving throw degree against a basic save. */
  basicSaveMultiplier(degree) {
    return [2, 1, 0.5, 0][degree];
  },

  /**
   * Apply immunities, weaknesses and resistances to a {type: amount} map.
   * @returns {number} total damage after IWR
   */
  applyIwr(iwr, byType) {
    let total = 0;
    for ( const [type, raw] of Object.entries(byType) ) {
      if ( raw <= 0 ) continue;
      if ( iwr?.immune?.some(k => iwrMatches(k, type)) ) continue;
      let amount = raw;
      let weak = 0;
      for ( const [k, v] of Object.entries(iwr?.weak ?? {}) ) if ( iwrMatches(k, type) ) weak = Math.max(weak, v);
      let resist = 0;
      for ( const [k, v] of Object.entries(iwr?.resist ?? {}) ) if ( iwrMatches(k, type) ) resist = Math.max(resist, v);
      amount = Math.max(0, amount + weak - resist);
      total += amount;
    }
    return total;
  },

  /**
   * Called when a combatant is reduced to 0 HP or damaged while already down.
   * Mutates `c` and returns its new status.
   */
  onDropped(c, { crit = false, model = DOWNED_MODELS.SIMULATE } = {}) {
    if ( model === DOWNED_MODELS.DEAD || c.spec.diesAtZero ) {
      c.status = STATUS.DEAD;
      return c.status;
    }
    if ( model === DOWNED_MODELS.OUT ) {
      c.status = STATUS.DOWN;
      return c.status;
    }
    const increase = crit ? 2 : 1;
    if ( c.status === STATUS.DOWN ) c.dying += increase;
    else c.dying = increase + c.wounded;
    c.status = STATUS.DOWN;
    c.stable = false;
    if ( c.dying >= this.dyingLimit(c) ) c.status = STATUS.DEAD;
    return c.status;
  },

  dyingLimit(c) {
    return 4 - (c.doomed ?? 0);
  },

  /** Healing a downed creature brings it back up (prone) and increases wounded. */
  onHealed(c, amount) {
    const wasDown = c.status === STATUS.DOWN;
    c.hp = Math.min(c.maxHp, c.hp + amount);
    if ( wasDown && c.hp > 0 ) {
      c.status = STATUS.STANDING;
      if ( c.dying > 0 || !c.stable ) c.wounded += 1;
      c.dying = 0;
      c.stable = false;
      c.prone = true;
    }
  },

  /**
   * Start of turn for a downed, dying creature: recovery check (flat DC 10 + dying).
   * @returns {string} log text, or null
   */
  recoveryCheck(c, rng) {
    if ( c.status !== STATUS.DOWN || c.stable || c.dying <= 0 ) return null;
    const dc = 10 + c.dying;
    const natural = rng.d20();
    const degree = this.degreeOfSuccess(natural, natural, dc);
    c.dying += [2, 1, -1, -2][degree];
    if ( c.dying >= this.dyingLimit(c) ) {
      c.status = STATUS.DEAD;
      return `fails a recovery check and dies`;
    }
    if ( c.dying <= 0 ) {
      c.dying = 0;
      c.stable = true;
      c.wounded += 1;
      return `stabilizes (unconscious)`;
    }
    return `recovery check (${["critical failure", "failure", "success", "critical success"][degree]}): dying ${c.dying}`;
  },

  /** Administer First Aid (stabilize): Medicine against DC 15 + the dying value. */
  firstAidDC(c) {
    return 15 + (c.dying ?? 0);
  },

  /** Result of first aid: success stops the dying (unconscious, wounded +1); a critical failure makes it worse. */
  firstAid(c, degree) {
    if ( degree >= 2 ) {
      c.dying = 0;
      c.stable = true;
      c.wounded += 1;
    } else if ( degree === 0 ) {
      c.dying += 1;
      if ( c.dying >= this.dyingLimit(c) ) c.status = STATUS.DEAD;
    }
  },

  /** End of turn persistent damage: take it, then a DC 15 flat check to remove each instance. */
  persistentFlatCheck(rng) {
    return rng.d20() >= 15;
  }
};
