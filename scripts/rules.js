/**
 * Pathfinder 2e rules for the simulation engine. Pure functions only: no Foundry globals.
 */
import { DOWNED_MODELS, STATUS, doubled, bestReactionStrike, localize } from "./core.js";
import { t } from "./words.js";
import { levelDC, sheetHold } from "./holds.js";

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

/**
 * Cover from the walls (the core's: some of the target hidden, most of it): standard cover, +2 to AC and Reflex; greater
 * cover, +4.
 */
const coverBonus = cover => (cover === "some" ? 2 : cover === "most" || cover === "total" ? 4 : 0);

/** Status penalty to checks and DCs (frightened and sickened don't stack: the worse applies). */
const statusPenalty = u => Math.max(u.conds.frightened ?? 0, u.conds.sickened ?? 0);

/** Its Acrobatics for a tumble (spec.acrobatics), less what frightens or sickens it and its clumsiness (Dexterity's). */
const tumbleMod = u => (Number(u.spec?.acrobatics?.mod) || 0) - statusPenalty(u) - (u.conds.clumsy ?? 0);
/** Its Reflex DC: 10 + its Reflex, less the same. */
const reflexDC = o => 10 + (Number(o.spec?.defenses?.reflex) || 0) - statusPenalty(o) - (o.conds.clumsy ?? 0);

/**
 * Can it share another's space? A Tiny creature can (the Player Core: Tiny creatures can occupy the same space as larger
 * creatures, and four of them a square), and a swarm can (its trait: it can occupy the same space as other creatures).
 */
const sharesRoom = u => Number(u.spec?.size) === 0 || (u.spec?.creatureTraits ?? []).includes("swarm");

/** What a creature's grab laid on its bearer (its Grapple, the GM's grab): grabbed or restrained, from it (or anyone). */
const grabbing = (e, id = null) => !!e.sourceId && (id === null || e.sourceId === id) && !!(e.conditions?.grabbed || e.conditions?.restrained);

/**
 * Ferocity (spec.ferocity {label, uses, untilWounded, temp}), as it would fall: with its reaction to spend (and able to
 * react), it stays up at 1 Hit Point and its wounded value goes up by 1. A character's Orc Ferocity as often as it has
 * left today; a creature's until it's wounded 3. Undying Ferocity: temporary Hit Points too.
 * @returns {boolean} whether it stayed up
 */
function holdsOn(c) {
  const f = c.spec?.ferocity;
  const k = c.conds ?? {};
  if ( !f || (c.reactionsLeft ?? 0) <= 0 || k.incapacitated || k.paralyzed || k.stunned ) return false;
  if ( Number.isFinite(f.uses) && (c.ferocityUsed ?? 0) >= f.uses ) return false;
  if ( Number.isFinite(f.untilWounded) && (c.wounded ?? 0) >= f.untilWounded ) return false;
  c.reactionsLeft -= 1;
  c.ferocityUsed = (c.ferocityUsed ?? 0) + 1;
  c.hp = 1;
  c.wounded = (c.wounded ?? 0) + 1;
  if ( f.temp > 0 ) c.temp = Math.max(c.temp ?? 0, f.temp);
  c.ferocityNote = f.label || "";
  return true;
}

/** Damage types from before the remaster (older content still has them), as the story tells them. */
const STORY_TYPES = Object.freeze({ positive: "vitality", negative: "void", good: "radiant", evil: "unholy", lawful: "force", chaotic: "spirit", precision: "untyped" });

export const pf2eRules = {
  id: "pf2e",
  actionsPerTurn: 3,
  /**
   * A playstyle's taunt: one action, as goading a foe with words is in the rules (Demoralize, Create a Diversion and
   * Feint are a single action each).
   */
  tauntCost: { actions: 1 },
  /** A creature keeping a low profile on the way in Avoids Notice: Stealth for initiative, when it's better. */
  stealthInitiative: true,
  /** A nonlethal attack (fists, a sap; the rules' -2 for a lethal weapon isn't played) knocks a foe out instead. */
  pullsBlow(u, action) {
    return (action?.traits ?? []).includes("nonlethal");
  },
  /** Three actions; a minion (a summoned creature) two, when its summoner Sustains it. */
  turn(u) {
    return { actions: u.spec.creatureTraits?.includes("minion") ? 2 : 3 };
  },

  /**
   * Reactive Strike: only creatures that have it strike a foe in their reach that leaves it, makes a ranged attack or
   * uses a manipulate action, or stands up there (one reaction a round). A Step (an action, five feet) gets out of
   * reach without triggering it.
   */
  reactions() {
    return 1;
  },
  opportunityOn: Object.freeze(["foeLeavesReach", "foeOpening", "foeMovesInReach"]),
  opportunity(reactor) {
    if ( !reactor.spec.flags?.reactiveStrike ) return null;
    const c = reactor.conds ?? {};
    if ( c.incapacitated || c.paralyzed || c.stunned ) return null;
    return bestReactionStrike(reactor);
  },
  disengage() {
    return { cost: { actions: 1 }, label: t("StepsAway") };
  },

  /**
   * Room on the map (the core's behavior/space.js): a Tiny creature or a swarm may end its move in another's space
   * (sharesRoom); nobody else may.
   */
  endIn(run, u) {
    return sharesRoom(u);
  },

  /**
   * Getting past another creature on the way (the core's behavior/space.js): through a willing one's space (a friend's,
   * on its side) and one that's down, freely; a foe on its feet, Tumble Through for one trained in Acrobatics with even
   * odds or better (a 10 on the die will do), round it otherwise. Anyone else (a bystander), the core's way. A Tiny
   * creature or a swarm, which can share the space, goes through it freely.
   */
  passThrough(run, u, o) {
    if ( o.status !== STATUS.STANDING || o.side === u.side || sharesRoom(u) ) return "free";
    if ( !run.prep?.sides?.[u.side]?.enemies?.has?.(o.side) ) return null;
    return u.spec?.acrobatics && tumbleMod(u) + 10 >= reflexDC(o) ? "tumble" : "around";
  },
  /**
   * Tumble Through: Acrobatics against the foe's Reflex DC. Through its space on a success; on a failure the move ends
   * short of it (the core's). Not played: its space as difficult terrain on the way through (the core charges a tumble
   * nothing more), one foe a Tumble Through, and the reactions a failure draws as if it had left where it started.
   */
  tumbleThrough(run, u, o) {
    const mod = tumbleMod(u);
    const dc = reflexDC(o);
    const { natural, total, degree } = this.roll(run.rng, mod, dc);
    return { success: degree >= 2, degree, natural, mod, total, dc };
  },

  /** Every action says how many free hands it needs (`hands`, hands.js): what a creature with its hands tied can still do. */
  handsKnown: true,

  /**
   * Tied up is restrained: no action with the attack trait (a Strike, a spell attack), hands or not. (Escape is the
   * core's own, never an action of the creature's.)
   */
  tiedBars(action) {
    return (action?.traits ?? []).includes("attack") || (Number.isFinite(action?.bonus) && !action?.save);
  },

  /** A grab keeps its creature off guard and in place; broken free of it, neither (core holds.js release). */
  holdBrings(key) {
    return key === "grabbed" || key === "restrained" ? ["offGuard", "immobilized"] : [];
  },

  /**
   * Breaking free (holds.js): Escape, against what holds it. A grab its sheet shows, or a restraint, at the GM Core's
   * DC for its level (the sheet doesn't say who's holding it), and with it go the off-guard and immobilized it brought;
   * a grab the fight knows of, against the grabber's Athletics DC (spec.escapeDC). A friend can't Escape for it.
   */
  escapeFrom(run, u, key) {
    // (Grabbed or restrained by a creature's Grapple: the core's grab, which one Escape against the grabber breaks; let
    // go of, nothing holds it.)
    if ( (key === "grabbed" || key === "restrained") && (u.effects ?? []).some(e => grabbing(e) && e.conditions[key]) ) return null;
    return sheetHold(u, key);
  },
  /**
   * FastFighting's improvised bonds (rope, a strap): the Thievery DC of whoever tied them, the rules' DC for bonds
   * (breakFree finds it); tied by no one the fight knows, the GM Core's DC for the prisoner's level.
   */
  bondsDC(u) {
    return levelDC(u.spec?.level ?? 0);
  },
  /** Escape takes one action; after a critical failure there's none to spend on it until its next turn. */
  escapeCost(u) {
    return u.escapeBarred === (u.turnsTaken ?? 0) ? { actions: Infinity } : { actions: 1 };
  },
  /**
   * An Escape: its best way out (spec.escapeWork) against the hold's DC (bonds against the Thievery DC of whoever tied
   * them, spec.tiesDC, where the fight knows who), less what frightens or sickens it. A critical failure bars another
   * try this turn. Null for the core's way: freeing a friend (untying it: an Interact action, no roll), or nothing to
   * roll with.
   */
  breakFree(run, who, hold, { freeing = false } = {}) {
    if ( freeing ) return null;
    const work = who.spec?.escapeWork;
    const binder = hold.key === "bound" && hold.byId ? run.byId?.get(hold.byId) : null;
    const dc = Number.isFinite(binder?.spec?.tiesDC) ? binder.spec.tiesDC : hold.dc;
    if ( !Number.isFinite(work?.mod) || !Number.isFinite(dc) ) return null;
    const mod = work.mod - statusPenalty(who);
    const { natural, total, degree } = this.roll(run.rng, mod, dc);
    if ( degree === 0 ) who.escapeBarred = who.turnsTaken ?? 0;
    // (Out of a grab, out of all that grabber's Grapple laid on it; the core lets go of the grab itself.)
    if ( degree >= 2 && hold.key === "grabbed" && hold.byId ) who.effects = (who.effects ?? []).filter(e => !grabbing(e, hold.byId));
    return { success: degree >= 2, degree, natural, mod, total, dc };
  },

  /** Cover is PF2e's (standard, greater: coverBonus), not the core's. */
  handlesCover: true,

  /** A fall: bludgeoning damage of half the distance in feet; landing from it, prone. */
  fallDamage(feet) {
    const half = Math.floor((Number(feet) || 0) / 2);
    return feet > 5 && half > 0 ? [{ dice: [], flat: half, type: "bludgeoning", persistent: false, category: null }] : [];
  },
  fallProne: true,

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
    // Too big to trip.
    if ( Number.isFinite(action.maxSize) && Number.isFinite(target.spec.size) && target.spec.size > action.maxSize ) return true;
    // Nothing in hand to knock away: claws and jaws can't be disarmed.
    if ( action.disarm && !(target.spec.actions ?? []).some(a => a.kind === "strike" && a.held) ) return true;
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
   * to everything, clumsy to AC and Reflex, enfeebled to melee, off-guard -2 AC (and grabbed, which is off-guard; held
   * in place too, as the engine weighs it), prone (off-guard, -2 to attack, an action to stand), slowed and stunned in
   * actions, fascinated -2 to its checks (PF2e's: it can still act; not the core's, which takes its turn).
   */
  conditionMods(key, value = 1) {
    const v = Number(value) || 1;
    switch ( key ) {
      case "frightened":
      case "sickened": return { attack: -v, ac: -v, saves: -v, checks: -v };
      case "clumsy": return { ac: -v, saves: -Math.ceil(v / 3) };
      case "enfeebled": return { attack: -v, damage: -v };
      case "offGuard":
      case "grabbed": return { ac: -2 };
      case "prone": return { ac: -2, attack: -2, actions: -1 };
      case "fascinated": return { checks: -2 };
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
   * melee attacks; prone -2 to attack; -2 to melee underwater without a swim speed; -2 per range increment; fascinated
   * -2 to its skill checks.
   */
  modifiers: {
    exposed(ctx) {
      // (exposedTo: off-guard to this attacker only, after a Feint. Each fact read only if the ones before don't settle
      // it: the situation works them out as they're read.)
      const t = ctx.target;
      return !!(t.prone || t.conds.offGuard || t.conds.paralyzed || ctx.grabbed || ctx.flanked || ctx.exposedTo);
    },
    defense(ctx) {
      const t = ctx.target;
      return -(this.exposed(ctx) ? 2 : 0) - (t.conds.clumsy ?? 0) - statusPenalty(t) + coverBonus(ctx.cover);
    },
    attack(ctx) {
      const { attacker, action } = ctx;
      let bonus = 0;
      if ( attacker.prone ) bonus -= 2;
      bonus -= statusPenalty(attacker);
      if ( action?.melee ) bonus -= attacker.conds.enfeebled ?? 0;
      if ( action?.melee && attacker.spec.environment?.aquatic && !(attacker.spec.speeds?.swim > 0) ) bonus -= 2;
      if ( action?.range && !action.range.noPenalty && ctx.positioning ) {
        bonus -= 2 * Math.max(0, Math.ceil(ctx.distance / action.range.increment) - 1);
      }
      return { bonus, advantage: 0 };
    },
    save({ unit, type, cover }) {
      let bonus = -statusPenalty(unit);
      if ( type === "reflex" ) bonus -= (unit.conds.clumsy ?? 0) - coverBonus(cover);
      return { bonus, advantage: 0 };
    },
    check({ unit } = {}) {
      return { bonus: unit?.conds?.fascinated ? -2 : 0, advantage: 0 };
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
   * Mutates `c` and returns its new status. One with Ferocity may stay up instead.
   */
  onDropped(c, { crit = false, model = DOWNED_MODELS.SIMULATE } = {}) {
    if ( c.status === STATUS.STANDING && holdsOn(c) ) return c.status;
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

  /** The dying value it dies at: 4 (5 with Diehard: spec.dyingMax), less its doomed value. */
  dyingLimit(c) {
    return (c.spec?.dyingMax ?? 4) - (c.doomed ?? 0);
  },

  /** Ferocity that kept it up, said once the blow is done (the core's line for staying up at 1 hit point). */
  afterHarm(run, u) {
    if ( !u.ferocityNote ) return null;
    const label = u.ferocityNote;
    u.ferocityNote = null;
    return { text: label, data: { type: "holdOn", label } };
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
   * Start of turn for a downed, dying creature: recovery check (flat DC 10 + dying; 9 + dying with Toughness:
   * spec.recoveryDC).
   * @returns {string} log text, or null
   */
  recoveryCheck(c, rng) {
    if ( c.status !== STATUS.DOWN || c.stable || c.dying <= 0 ) return null;
    const dc = (c.spec?.recoveryDC ?? 10) + c.dying;
    const natural = rng.d20();
    const degree = this.degreeOfSuccess(natural, natural, dc);
    c.dying += [2, 1, -1, -2][degree];
    if ( c.dying >= this.dyingLimit(c) ) {
      c.status = STATUS.DEAD;
      return t("Recovery.Dies");
    }
    if ( c.dying <= 0 ) {
      c.dying = 0;
      c.stable = true;
      c.wounded += 1;
      return t("Recovery.Stable");
    }
    return t("Recovery.Check", { degree: localize(`FASTFIGHTING.Log.Degree${degree}`), n: c.dying });
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
  },

  /** The story's family for a damage type: the remaster's are the story's own; older content's are mapped. */
  storyDamageType(type) {
    return STORY_TYPES[type] ?? type;
  }
};
