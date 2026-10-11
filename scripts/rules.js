/**
 * Pathfinder 2e rules for the simulation engine. Pure functions only: no Foundry globals.
 */
import { DOWNED_MODELS, STATUS, doubled, bestReactionStrike } from "./core.js";

/** Damage types grouped for IWR keys such as "physical" or "energy". */
const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing", "bleed"]);
const ENERGY = new Set(["acid", "cold", "electricity", "fire", "sonic", "force", "vitality", "void"]);

function iwrMatches(key, type) {
  if ( key === type || key === "all-damage" ) return true;
  if ( key === "physical" ) return PHYSICAL.has(type);
  if ( key === "energy" ) return ENERGY.has(type);
  return false;
}

/** Spell traits that PF2e immunities name differently. */
const TRAIT_IMMUNITY = { fear: "fear-effects", death: "death-effects" };
/** Engine conditions -> PF2e condition immunities. */
const CONDITION_IMMUNITY = {
  offGuard: "off-guard", incapacitated: "unconscious", immobilized: "immobilized", paralyzed: "paralyzed", slowed: "slowed",
  stunned: "stunned", frightened: "frightened", sickened: "sickened", clumsy: "clumsy", enfeebled: "enfeebled", fleeing: "fleeing", prone: "prone"
};

/** Status penalty to checks and DCs (frightened and sickened don't stack: the worse applies). */
const statusPenalty = u => Math.max(u.conds.frightened ?? 0, u.conds.sickened ?? 0);

export const pf2eRules = {
  id: "pf2e",
  actionsPerTurn: 3,

  /**
   * Reactive Strike: only creatures that have it strike a foe leaving their reach (one reaction a round). A Step
   * (an action, five feet) gets out of reach without triggering it.
   */
  reactions() {
    return 1;
  },
  opportunity(reactor) {
    if ( !reactor.spec.flags?.reactiveStrike ) return null;
    const c = reactor.conds ?? {};
    if ( c.incapacitated || c.paralyzed || c.stunned ) return null;
    return bestReactionStrike(reactor);
  },
  disengage() {
    return { cost: { actions: 1 }, label: "Steps carefully out of reach" };
  },
  /** A wooden door (Hardness 5, 20 HP), a simple lock (DC 20 to Force Open or Pick a Lock). */
  door: { ac: 10, hp: 20, hardness: 5, forceDC: 20, pickDC: 20 },
  /** Opening a door is an Interact action; Force Open one action; Pick a Lock two. */
  doorCosts: { open: { actions: 1 }, force: { actions: 1 }, pick: { actions: 2 } },
  /** Hardness comes off every blow. */
  doorDamage(door, damage) {
    return damage - (door.hardness ?? 0);
  },
  /**
   * Heroic Recovery: a character who would die spends all their Hero Points to stay alive instead, stable at 0 HP
   * and no longer dying (wounded doesn't go up).
   */
  avertDeath(u) {
    u.status = STATUS.DOWN;
    u.hp = 0;
    u.dying = 0;
    u.stable = true;
  },
  /** A hit always deals at least 1 damage before resistances, however large the penalties. */
  minimumDamage: 1,

  degreeOfSuccess(natural, total, dc) {
    let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if ( natural === 20 ) degree = Math.min(3, degree + 1);
    else if ( natural === 1 ) degree = Math.max(0, degree - 1);
    return degree;
  },

  /** A d20 check; fortune (advantage) keeps the higher of two rolls, misfortune the lower. */
  roll(rng, modifier, dc, { advantage = 0 } = {}) {
    let natural = rng.d20();
    if ( advantage ) {
      const second = rng.d20();
      natural = advantage > 0 ? Math.max(natural, second) : Math.min(natural, second);
    }
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

  /** Damage a save lets through: basic saves halve on a success; others only hurt on a failure. */
  saveMultiplier(degree, save) {
    return save?.basic === false ? [2, 1, 0, 0][degree] : this.basicSaveMultiplier(degree);
  },

  /** Afflictions: the first save sets the stage (fail +1, critical fail +2); later saves move it either way. */
  afflictionStep(degree, phase) {
    return phase === "exposure" ? [2, 1, 0, 0][degree] : [2, 1, -1, -2][degree];
  },

  /** A critical hit doubles all the damage. */
  critical(parts) {
    return doubled(parts);
  },

  /** Administer First Aid takes two actions. */
  firstAidCost: 2,

  /**
   * Immune to an effect by its traits (mental, fear, emotion, sleep, visual, auditory ...; the mindless shrug off
   * mental effects) or because every condition it would impose is one the creature is immune to.
   */
  isImmune(target, action) {
    const immune = new Set(target.spec.iwr?.immune ?? []);
    const traits = action.traits ?? [];
    if ( traits.some(t => immune.has(TRAIT_IMMUNITY[t] ?? t)) ) return true;
    if ( traits.includes("mental") && target.spec.creatureTraits?.includes("mindless") ) return true;
    // Every outcome it can have on the target (one that simply happens too; a backfire on the user doesn't count).
    const outcomes = [...(action.onSave ?? []), ...(action.onHit ?? []), action.outcome].filter(o => o && !o.self);
    const keys = [...new Set(outcomes.flatMap(o => Object.keys(o.conditions ?? {})))];
    return keys.length > 0 && keys.every(k => immune.has(CONDITION_IMMUNITY[k] ?? k));
  },

  /** Incapacitation: a target more than twice the spell's rank in level treats its result as one degree better. */
  controlShift({ target, action }) {
    if ( !(action.traits ?? []).includes("incapacitation") || !action.rank ) return 0;
    return (target.spec.level ?? 0) > 2 * action.rank ? 1 : 0;
  },

  /**
   * Conditions as numbers, so a frightened or tripped foe is weighed like any other penalty: frightened and sickened
   * to everything, clumsy to AC and Reflex, enfeebled to melee, off-guard -2 AC, prone (off-guard, -2 to attack, an
   * action to stand), slowed and stunned in actions.
   */
  conditionMods(key, value = 1) {
    const v = Number(value) || 1;
    switch ( key ) {
      case "frightened":
      case "sickened": return { attack: -v, ac: -v, saves: -v, checks: -v };
      case "clumsy": return { ac: -v, saves: -Math.ceil(v / 3) };
      case "enfeebled": return { attack: -v, damage: -v };
      case "offGuard": return { ac: -2 };
      case "prone": return { ac: -2, attack: -2, actions: -1 };
      case "slowed": return { actions: -v };
      case "stunned": return { actions: -Math.min(3, v) };
      default: return null;
    }
  },

  /** Share of a creature's fighting a condition takes away each round. */
  conditionWeight(key, value) {
    switch ( key ) {
      case "slowed": return value / 3;
      case "stunned": return Math.min(1, value / 3);
      case "paralyzed": return 1;
      case "fleeing": return 0.8;
      case "frightened":
      case "sickened": return 0.08 * value;
      case "clumsy": return 0.04 * value;
      case "enfeebled": return 0.05 * value;
      case "offGuard": return 0.08;
      default: return undefined;
    }
  },

  /** Typical numbers for a creature of a level (moderate PF2e guidelines). */
  typical: {
    ac: level => 15 + level,
    save: level => level + 5,
    skill: level => level + 4,
    dc: level => level + 15
  },

  /**
   * What the situation is worth. The engine reports the facts; these are PF2e's numbers:
   * off-guard -2 AC; frightened and sickened (the worse) to checks and DCs; clumsy to AC and Reflex; enfeebled to
   * melee attacks; prone -2 to attack; -2 to melee underwater without a swim speed; -2 per range increment.
   */
  modifiers: {
    exposed({ target, grabbed, flanked, exposedTo }) {
      // (exposedTo: off-guard to this attacker only, after a Feint.)
      return !!(target.prone || target.conds.offGuard || target.conds.paralyzed || grabbed || flanked || exposedTo);
    },
    defense(ctx) {
      const t = ctx.target;
      return -(this.exposed(ctx) ? 2 : 0) - (t.conds.clumsy ?? 0) - statusPenalty(t);
    },
    attack({ attacker, action, distance, positioning }) {
      let bonus = 0;
      if ( attacker.prone ) bonus -= 2;
      bonus -= statusPenalty(attacker);
      if ( action?.melee ) bonus -= attacker.conds.enfeebled ?? 0;
      if ( action?.melee && attacker.spec.environment?.aquatic && !(attacker.spec.speeds?.swim > 0) ) bonus -= 2;
      if ( action?.range && !action.range.noPenalty && positioning ) {
        bonus -= 2 * Math.max(0, Math.ceil(distance / action.range.increment) - 1);
      }
      return { bonus, advantage: 0 };
    },
    save({ unit, type }) {
      let bonus = -statusPenalty(unit);
      if ( type === "reflex" ) bonus -= unit.conds.clumsy ?? 0;
      return { bonus, advantage: 0 };
    },
    check() {
      return { bonus: 0, advantage: 0 };
    },
    /** Steal in combat: -5 to the Thievery check. */
    steal() {
      return { bonus: -5, advantage: 0 };
    },
    actionsLost(u) {
      if ( u.conds.paralyzed || u.conds.fleeing ) return 99; // fleeing spends every action getting away
      return (u.conds.slowed ?? 0) + (u.conds.stunned ?? 0);
    }
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
