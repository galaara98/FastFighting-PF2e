/**
 * Pathfinder 2e rules for the simulation engine. Pure functions only: no Foundry globals.
 */
import { DOWNED_MODELS, STATUS, doubled, part, bestReactionStrike, localize, degreeDistribution, samplePart, dropCondition, coverOf, holderOf, areEnemies, systemRolled, rollCheck, hiddenFrom } from "./core.js";
import { t, conditionLabel, traitName, actionName } from "./words.js";
import { levelDC, sheetHold } from "./holds.js";
import { holderId, full, cuttingStrike, chanceAtLeast } from "./gullet.js";
import { ASSISTED, APPROPRIATE_DC, SICK_ANNOYANCE, sickDC, bleedDC, lower } from "./remedies.js";
import { applyPf2eIwr, critImmune, healsIt } from "./iwr.js";

/** A friend's persistent bleed, as a hold a friend breaks (Administer First Aid): the core's bleeding, as the story tells it. */
const BLEED = "bleeding";

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

/**
 * The status penalties PF2e's conditions give, by what a roll is based on (they don't stack: the worst counts):
 * frightened and sickened to every check and DC; clumsy (and encumbered, which makes it clumsy 1) to Dexterity's (AC,
 * Reflex, ranged attacks, Acrobatics); enfeebled to Strength's (melee attacks); stupefied to the mind's (Will, spell
 * attacks); drained to Constitution's (Fortitude); fascinated -2 to skill checks.
 */
const STATUS_ON = Object.freeze({
  dex: Object.freeze(["clumsy", "encumbered"]), str: Object.freeze(["enfeebled"]), mind: Object.freeze(["stupefied"]), con: Object.freeze(["drained"]),
  skill: Object.freeze(["fascinated"])
});
/** Those with a penalty of their own, not their value. */
const FIXED = Object.freeze({ encumbered: 1, fascinated: 2 });
const SAVE_ON = Object.freeze({ fortitude: "con", reflex: "dex", will: "mind" });

/** The worst status penalty some conditions give a roll based on all of `on` (none: every roll's alone). */
function worstStatus(conds, on) {
  if ( !conds ) return 0; // (a sheet read with no conditions: most are)
  let n = Math.max(Number(conds.frightened) || 0, Number(conds.sickened) || 0);
  for ( const base of on ) {
    for ( const k of STATUS_ON[base] ?? [] ) n = Math.max(n, Number(conds?.[k]) > 0 || conds?.[k] === true ? FIXED[k] ?? Number(conds[k]) : 0);
  }
  return n;
}

/**
 * The status penalty on its roll (based on `on`: "dex", "str", "mind", "con", "skill") that its own numbers don't
 * already have: the worst of what's on it now, less the worst its sheet showed when its numbers were read
 * (spec.conditions: a fight resumed mid-way, a live battle), which PF2e's totals took in already. Less than none (the
 * sheet's frightened 2 now 1) gives that back.
 */
const statusPenalty = (u, ...on) => worstStatus(u.conds, on) - worstStatus(u.spec?.conditions, on);

/** Off guard on its sheet when its AC was read (PF2e's AC took the -2 in already): off-guard, or what brings it. */
const SHEET_OFF_GUARD = Object.freeze(["offGuard", "prone", "grabbed", "restrained", "paralyzed", "unconscious"]);
const sheetOffGuard = u => {
  const c = u.spec?.conditions;
  return !!c && SHEET_OFF_GUARD.some(k => Number(c[k]) > 0 || c[k] === true);
};

/**
 * What a check is based on, by what it's for (the core's purpose, and a maneuver's name): Thievery and Stealth Dexterity's,
 * the Athletics maneuvers Strength's, words, Medicine, Recall Knowledge and Perception the mind's; its status penalties
 * as PF2e has them (statusPenalty: clumsy, enfeebled, stupefied, on top of frightened, sickened and fascinated).
 */
const CHECK_ON = Object.freeze({ theft: "dex", talk: "mind", goad: "mind", firstAid: "mind", sizeUp: "mind", notice: "mind", seek: "mind", heal: "mind" });
const MANEUVER_ON = Object.freeze({ trip: "str", grapple: "str", disarm: "str", shove: "str", reposition: "str", drag: "str", demoralize: "mind", feint: "mind", distract: "mind", hide: "dex" });
const checkOn = (purpose, action) => CHECK_ON[purpose] ?? MANEUVER_ON[action?.maneuver] ?? null;

/** GM Core's simple DCs and DC adjustments (hearDC). */
const SIMPLE_DC = Object.freeze({ untrained: 10, trained: 15, expert: 20, master: 30, legendary: 40 });
const ADJUST = Object.freeze({ hard: 2, veryHard: 5, incrediblyHard: 10 });

/** A potion or an elixir, drunk (a consumable's heal, PF2e's: the adapter's itemId on a heal of its own): what one sickened can't. */
const ingested = action => action?.kind === "heal" && !!action.itemId && !!action.selfOnly;

/**
 * A blow from inside its gullet (afterHarm, told who struck it and with what): piercing or slashing damage of its
 * Rupture value or more, as rolled, from one blow, and the one who struck it is out. Not harm that lingers. Returns what's
 * said ({text}), or null.
 */
function ruptured(run, holder, ctx) {
  const by = ctx?.by;
  if ( !by || ctx.lingering || holderOf(run, by)?.id !== holder.id ) return null;
  const key = Number(by.conds?.swallowed) > 0 ? "swallowed" : "engulfed";
  const rupture = holder.spec?.gullet?.[key]?.rupture;
  const cut = (Number(ctx.byType?.piercing) || 0) + (Number(ctx.byType?.slashing) || 0);
  if ( !Number.isFinite(rupture) || cut < rupture ) return null;
  dropCondition(by, key);
  return { text: t("Gullet.Ruptured", { name: by.spec?.name ?? "", strike: ctx.action?.name ?? "", damage: cut, rupture }) };
}

/** Has it a piercing or slashing blow (a weapon or an unarmed attack: cutting a corpse open)? */
const cutsOpen = u => (u.spec?.actions ?? []).some(a => a.kind === "strike" && a.melee && (a.damage ?? []).some(p => p.type === "piercing" || p.type === "slashing"));

/** Its Acrobatics for a tumble (spec.acrobatics), less the status penalty on it (a Dexterity skill). */
const tumbleMod = u => (Number(u.spec?.acrobatics?.mod) || 0) - statusPenalty(u, "dex", "skill");
/** Its Reflex DC: 10 + its Reflex, less the status penalty on it. */
const reflexDC = o => 10 + (Number(o.spec?.defenses?.reflex) || 0) - statusPenalty(o, "dex");

/**
 * Drained since it was last looked at (since its sheet's numbers were read, at first): the Hit Points it loses, its
 * level (at least 1) a step, and its maximum as much lower (not damage; at least 1 left, as the core has no fall for
 * it); drained less, its maximum back up but not what it lost. Not in a live battle: there the sheet does it itself.
 */
function drain(run, u) {
  if ( run?.live ) return;
  const now = Number(u.conds?.drained) || 0;
  const seen = u.drainSeen ?? (Number(u.spec?.conditions?.drained) || 0);
  if ( now === seen ) return;
  const step = Math.max(1, Number(u.spec?.level) || 0);
  u.maxHp = Math.max(1, (u.maxHp ?? 1) - step * (now - seen));
  if ( now > seen ) u.hp = Math.max(Math.min(1, u.hp ?? 0), (u.hp ?? 0) - step * (now - seen));
  u.hp = Math.min(u.hp ?? 0, u.maxHp);
  u.drainSeen = now;
}

/** Is it taking cover still (Take Cover: until it moves from its space, uses an attack action, or falls unconscious)? */
function takingCover(u) {
  if ( !(Number(u?.conds?.inCover) > 0) || Number(u.conds.unconscious) > 0 ) return false;
  return !(u.coverAt && u.pos && (u.coverAt.x !== u.pos.x || u.coverAt.y !== u.pos.y));
}

/** The cover it has (the walls': "none", "some", "most"), taking cover: standard made greater; prone, greater against a ranged attack. */
const coverTaken = (u, cover, ranged = false) => (takingCover(u) && (cover === "some" || (ranged && u.prone)) ? "most" : cover);

/** The cover it has from each foe on its feet ("none" ... "total", by the walls: the core's coverOf). */
function foeCovers(run, u) {
  const enemies = run.prep?.sides?.[u.side]?.enemies;
  return run.units.filter(o => o !== u && o.status === STATUS.STANDING && o.active !== false && enemies?.has?.(o.side)).map(o => coverOf(run, u, o));
}

/**
 * The flat check a creature must make to affect another with an attack (PF2e's): DC 11 against one hidden from it (not
 * one it has found with a Seek since it hid: the core's hiddenFrom), DC 5 against one concealed from it, or from it
 * dazzled (unless it has a precise sense besides sight); 0 for none. Not against an area. And why (the story tells it:
 * "hidden", "concealed", "dazzled"): {dc, why}.
 */
function flatCheck(attacker, target, action) {
  if ( action?.area || !target ) return { dc: 0, why: null };
  if ( hiddenFrom(attacker, target) ) return { dc: 11, why: "hidden" };
  if ( Number(target.conds?.concealed) > 0 ) return { dc: 5, why: "concealed" };
  return Number(attacker?.conds?.dazzled) > 0 && !attacker.spec?.otherPrecise ? { dc: 5, why: "dazzled" } : { dc: 0, why: null };
}

/**
 * A flat check (a d20 against the DC, nothing added), u's: in a live battle the system's own where it makes checks (the
 * core's systemRolled, purpose "flat": PF2e's flat check, its card in the chat, titled with `label()`, what it's for);
 * else the engine's d20, as ever (`rng`, the run's unless given), shown in a live battle as the flat check it is (the
 * core's table rolls: rng.mark and rng.record, nothing where nothing records). {natural, success}.
 */
function flatRoll(run, u, dc, label, { target = null, rng = run?.rng } = {}) {
  const rolled = run?.live?.playing && u ? systemRolled(run, u, "check", { dc, target, purpose: "flat", label: label() }) : null;
  if ( !rolled ) {
    const at = rng.mark?.();
    const natural = rng.d20();
    if ( at !== undefined ) rng.record(at, { by: u, target, kind: "flat", label: label(), total: natural, natural, dc });
    return { natural, success: natural >= dc };
  }
  const { natural, total, degree } = rollCheck(pf2eRules, rng, 0, dc, { kind: "check", roller: u, rolled });
  return { natural: natural ?? total, success: degree >= 2 };
}

/** What a persistent damage's flat check is for, by its damage type: "persistent fire". */
const persistentLabel = type => () => t("Persistent", { type: traitName(type) });

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

/** How badly one fleeing wants to keep away from what it flees (the core's desire levels: obsessed). */
const FLEEING_AVOID = 90;

/**
 * Damage types from before the remaster (older content still has them), as the story tells them: the remaster's
 * vitality and void, and spirit for alignment damage (holy light for good, unholy for evil).
 */
const STORY_TYPES = Object.freeze({ positive: "vitality", negative: "void", good: "radiant", evil: "unholy", lawful: "spirit", chaotic: "spirit", precision: "untyped" });

export const pf2eRules = {
  id: "pf2e",
  actionsPerTurn: 3,
  /**
   * A threat without words (the core's deals: behavior/deals.js), where the two share no language: Demoralize's -4 for a
   * target that doesn't understand. A bribe needs words.
   */
  wordlessIntimidation: -4,
  /**
   * A playstyle's taunt: one action, as goading a foe with words is in the rules (Demoralize, Create a Diversion and
   * Feint are a single action each).
   */
  tauntCost: { actions: 1 },
  /** A creature keeping a low profile on the way in Avoids Notice: Stealth for initiative, when it's better. */
  stealthInitiative: true,
  /**
   * Seek (the core's patrol: behavior/patrol.js): an action, a secret Perception check against the Stealth DC of each
   * creature hidden from it or out of its senses in the area it scans, which the remaster has 30 feet or less in any
   * dimension: a 30-foot cone toward where it looks, or round itself, 15 feet. Found, a hidden one is observed by it.
   */
  seek: { cost: 1, area: { shape: "cone", feet: 30 }, around: { shape: "emanation", feet: 15 } },
  /**
   * Surprise as PF2e has it (the planner's Follow System): no surprise round and no one surprised. Those sneaking up as
   * it starts (hidden tokens, Avoiding Notice) roll Stealth for initiative; one whose Stealth beats the Perception DC of
   * every foe starts unnoticed, hidden: its first blow finds its target off-guard, and then it's seen.
   */
  surprise(run) {
    const sneaking = run.units.filter(u => u.spec.hidden);
    if ( !sneaking.length ) return null;
    const hidden = sneaking.filter(u => {
      const foes = run.units.filter(o => o !== u && areEnemies(run, u, o));
      const dc = Math.max(0, ...foes.map(o => 10 + (Number(o.spec.perception ?? o.spec.initiative?.mod) || 0)));
      const mod = Number(u.spec.initiative?.stealth) || 0;
      // (Its Stealth against their Perception DCs: in a live battle a roll the table sees, the GMs' while it's unseen.)
      const at = run.rng.mark?.();
      const natural = run.rng.die(20);
      if ( at !== undefined ) run.rng.record(at, { by: u, kind: "check", what: "stealth", mod, total: natural + mod, natural, dc });
      return natural + mod >= dc;
    }).map(u => u.id);
    return { stealthSides: [...new Set(sneaking.map(u => u.side))], hidden };
  },
  /**
   * A blow that can be made nonlethal, knocking a foe out instead: any Strike (a nonlethal weapon's as it is; a lethal
   * one's at the rules' -2: pullPenalty), or anything else with the nonlethal trait. A spell without it kills.
   */
  pullsBlow(u, action) {
    return action?.kind === "strike" || (action?.traits ?? []).includes("nonlethal");
  },
  /** A pulled blow's cost (core API 31): a Strike without the nonlethal trait at -2; fists, a sap, nothing. */
  pullPenalty(u, action) {
    return action?.kind === "strike" && !(action.traits ?? []).includes("nonlethal") ? -2 : 0;
  },
  /** Three actions; a minion two, when its master commands it (or its summoner Sustains it). */
  turn(u) {
    return { actions: u.spec.creatureTraits?.includes("minion") ? 2 : 3 };
  },
  /**
   * A minion (a familiar, an animal companion) acts only when its master spends an action to command it (core API 32).
   * A summoned one is Sustained instead (its summoning's sustain).
   */
  minionCommand(u) {
    return u.spec.creatureTraits?.includes("minion") && !u.spec.creatureTraits.includes("summoned") ? { actions: 1 } : null;
  },

  /**
   * Reactive Strike: only creatures that have it strike a foe in their reach that leaves it, makes a ranged attack or
   * uses a manipulate action, or stands up there (one reaction a round). A Step (an action, five feet) gets out of
   * reach without triggering it.
   */
  reactions(u) {
    return u?.spec.creatureTraits?.includes("minion") ? 0 : 1; // (a minion has none)
  },
  opportunityOn: Object.freeze(["foeLeavesReach", "foeOpening", "foeMovesInReach"]),
  /**
   * Delay and Ready (core API 33), for one that would let its turn go by for nothing. Delay: as its turn begins it
   * leaves the initiative order and comes back after another creature's turn, its initiative there from then on; no
   * reactions until it's back. Ready: two actions to prepare a single action (a Strike) for a trigger (a foe coming
   * within its reach), used as a reaction with the multiple attack penalty it had when it readied.
   */
  delay: Object.freeze({ reactions: false }),
  ready: Object.freeze({ cost: Object.freeze({ actions: 2 }), most: 1 }),
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
   * nothing more), one foe a Tumble Through, and the reactions a failure draws as if it had left where it started. In a
   * live battle, the system's own roll where it makes checks (systemRolled, purpose "tumble": PF2e's Tumble Through).
   */
  tumbleThrough(run, u, o) {
    const mod = tumbleMod(u);
    const dc = reflexDC(o);
    const rolled = systemRolled(run, u, "check", { dc, target: o, purpose: "tumble", against: "reflex" });
    const { natural, total, degree } = rollCheck(this, run.rng, mod, dc, { kind: "check", roller: u, rolled, label: actionName("TumbleThrough"), target: o });
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
  breakFree(run, who, hold, { freeing = false, held = null } = {}) {
    // (A friend's bleed: Administer First Aid.)
    if ( hold.key === BLEED ) return freeing ? this.stopBleeding(run, who, held, hold) : null;
    if ( freeing ) return null;
    const work = who.spec?.escapeWork;
    const binder = hold.key === "bound" && hold.byId ? run.byId?.get(hold.byId) : null;
    const dc = Number.isFinite(binder?.spec?.tiesDC) ? binder.spec.tiesDC : hold.dc;
    const escapes = Number.isFinite(work?.mod) && Number.isFinite(dc);
    // (Inside a gullet: cutting itself free instead, where that's likelier.)
    if ( hold.key === "swallowed" || hold.key === "engulfed" ) {
      const odds = escapes ? degreeDistribution(this, work.mod - statusPenalty(who), dc, { kind: "check" }) : null;
      const cut = this.cutFree(run, who, hold, odds ? odds[2] + odds[3] : 0);
      if ( cut ) return cut;
    }
    if ( !escapes ) return null;
    const mod = work.mod - statusPenalty(who);
    // (A live battle's, the system's own roll where it makes checks, as the engine's own Escape: systemRolled.)
    const rolled = systemRolled(run, who, "check", { dc, purpose: "escape", label: hold.key });
    const { natural, total, degree } = rollCheck(this, run.rng, mod, dc, { kind: "check", roller: who, rolled, label: actionName("Escape") });
    if ( degree === 0 ) who.escapeBarred = who.turnsTaken ?? 0;
    // (Out of a grab, out of all that grabber's Grapple laid on it; the core lets go of the grab itself, and of a spell's
    // hold with what it laid with it, Impaling Spike's off-guard.)
    if ( degree >= 2 && hold.key === "grabbed" && hold.byId ) who.effects = (who.effects ?? []).filter(e => !grabbing(e, hold.byId));
    return { success: degree >= 2, degree, natural, mod, total, dc };
  },

  /**
   * Cutting itself free from inside a gullet (gullet.js): its best Strike from in there (cuttingStrike) at whoever holds
   * it, off-guard to it, whose piercing or slashing damage comes to the holder's Rupture value or more (doubled on a
   * critical hit). Null when it can't, or an Escape (`escape`: its chance) is likelier. The blow's damage is dealt to
   * the one holding it (harm, the core's), out or not.
   */
  cutFree(run, who, hold, escape = 0) {
    const by = run.byId?.get(hold.byId);
    const rupture = by?.spec?.gullet?.[hold.key]?.rupture;
    const cut = Number.isFinite(rupture) ? cuttingStrike(who) : null;
    if ( !cut ) return null;
    const mod = cut.strike.bonus - statusPenalty(who, "str");
    const ac = (Number(by.spec.defenses?.ac) || 10) - 2;
    const odds = degreeDistribution(this, mod, ac, { kind: "attack" });
    const chance = odds[2] * chanceAtLeast(cut.parts, rupture) + odds[3] * chanceAtLeast(cut.parts, rupture, 2);
    if ( chance <= escape ) return null;
    // (The Strike and its damage, the engine's dice: in a live battle, rolls the table sees: rng.mark and rng.record.)
    let at = run.rng.mark?.();
    const { natural, total, degree } = this.roll(run.rng, mod, ac);
    if ( at !== undefined ) run.rng.record(at, { by: who, target: by, kind: "attack", label: cut.strike.name ?? "", mod, total, natural, dc: ac, degree });
    at = run.rng.mark?.();
    const byType = {};
    if ( degree >= 2 ) for ( const p of cut.parts ) byType[p.type] = (byType[p.type] ?? 0) + Math.max(0, samplePart(p, run.rng)) * (degree === 3 ? 2 : 1);
    if ( at !== undefined && degree >= 2 ) run.rng.record(at, { by: who, target: by, kind: "damage", label: cut.strike.name ?? "", parts: cut.parts, multiplier: degree === 3 ? 2 : 1, crit: degree === 3 });
    const dealt = Object.values(byType).reduce((s, n) => s + n, 0);
    return { success: dealt >= rupture, degree, natural, mod, total, dc: ac, said: { text: t("Gullet.Cut", { strike: cut.strike.name, damage: dealt, rupture }) }, ...(dealt > 0 ? { harm: { byType } } : {}) };
  },

  /**
   * Inside a gullet: the damage its holder's Swallow Whole or Engulf lists, at the end of each of its turns (else the
   * core's); none in a dead one's.
   */
  conditionHarm(key, value, u, by) {
    const inside = by?.spec?.gullet?.[key];
    if ( inside && by.status === STATUS.DEAD ) return [];
    return inside ? inside.damage : undefined;
  },

  /**
   * Its holder fallen: Engulf lets go; Swallow Whole's corpse has to be cut open first, by friends beside it (three
   * actions, with a piercing or slashing blow: untieCost), or it gets itself out as it would have.
   */
  letGo(run, u, key, holder) {
    if ( key !== "swallowed" || holder.status !== STATUS.DEAD ) return undefined;
    const e = (u.effects ?? []).find(x => x.sourceId === holder.id && Number(x.conditions?.swallowed) > 0 && x.escape);
    if ( !e ) return undefined;
    e.escape = { ...e.escape, others: "untie", corpse: true };
    return false;
  },

  /**
   * What it can do now, as PF2e says: Swallow Whole only on a creature it has grabbed (and none more once it holds one
   * of the largest size it lists); from inside a gullet, Strikes only with unarmed attacks or light weapons.
   */
  usable(run, u, action, t) {
    if ( action?.swallow && t ) return t.grabbedBy === u.id && !holderOf(run, t) && !full(run, u);
    // (Vitality healing mends no one with void healing, Harm's void healing no one without: iwr.js healsIt.)
    if ( action?.kind === "heal" && t && !healsIt(action, t) ) return false;
    // (Sickened: it can't willingly drink a potion or an elixir.)
    if ( ingested(action) && Number(u.conds?.sickened) > 0 ) return false;
    if ( action?.kind === "strike" && !action.light && holderOf(run, u) ) return false;
    // Take Cover: with standard cover from a foe to make greater, or prone (greater against ranged attacks).
    if ( action?.takeCover ) return !!u.prone || foeCovers(run, u).includes("some");
    // Hide: concealed, or with cover from every foe that can see it (and one at least).
    if ( action?.hide ) {
      // (Camouflage: it needs no cover to Hide.)
      if ( u.spec?.camouflage ) return true;
      if ( Number(u.conds?.concealed) > 0 ) return true;
      const seen = foeCovers(run, u).filter(c => c !== "total");
      return seen.length > 0 && !seen.includes("none");
    }
    return true;
  },

  /** Taking cover (Take Cover's outcome: rules.js takingCover): where, so moving away ends it. */
  onOutcome(run, by, u, outcome) {
    if ( outcome?.conditions?.inCover && u?.pos ) u.coverAt = { x: u.pos.x, y: u.pos.y };
  },

  /**
   * What a roll ends, any but a save: being hidden (it's observed now; an attack gives it away once it's done, still
   * unseen for its damage: afterAttack); and an attack, taking cover.
   */
  afterRoll(run, u, roll, ctx = {}) {
    if ( ctx.kind === "save" || !u?.conds ) return;
    if ( Number(u.conds.hidden) > 0 && ctx.kind !== "attack" ) dropCondition(u, "hidden");
    if ( Number(u.conds.inCover) > 0 && (ctx.kind === "attack" || (ctx.action?.traits ?? []).includes("attack")) ) dropCondition(u, "inCover");
  },

  /** An attack done, its damage and all: one hidden is seen now. */
  afterAttack(run, u) {
    if ( Number(u?.conds?.hidden) > 0 ) dropCondition(u, "hidden");
  },

  /**
   * Whom it can go for from inside a gullet: only whoever holds it, not another inside with it (PF2e's; the core keeps
   * everything outside from reaching in, and out).
   */
  canTarget(run, a, t) {
    const holder = holderOf(run, a)?.id;
    return !holder || t.id === holder;
  },

  /**
   * Stupefied: a spell is lost unless a DC 5 + its value flat check is made as it's cast. {natural, dc, said}, or null
   * when it goes on.
   */
  disrupted(run, u, action) {
    const v = Number(u?.conds?.stupefied) || 0;
    if ( !(v > 0) || !action?.spellId ) return null;
    const dc = 5 + v;
    const { natural, success } = flatRoll(run, u, dc, () => conditionLabel("stupefied", v));
    return success ? null : { natural, dc, said: { text: t("SpellLost", { natural, dc }) } };
  },

  /**
   * An attack's flat check (flatCheck: against one hidden from it, or concealed, or with it dazzled), rolled once the
   * attack would hit: failed, the blow doesn't affect the target. The same after a roll the system made itself in a
   * live battle (`ctx.rolled`: PF2e rolls no flat check of its own), a flat check of the system's too (flatRoll); and
   * nothing else, so nothing PF2e's own card did is done twice (a hit's damage card it rolled already isn't applied:
   * the blow missed, and the card is FastFighting's, its Apply buttons gone: cards.js).
   */
  adjustRoll(run, u, roll, ctx = {}) {
    // (A targeted spell's save, against one its caster has to make out: the caster's flat check; failed, the spell
    // passes it by, as a critical success.)
    if ( ctx.kind === "save" && ctx.from && ctx.action?.spellId && roll?.degree < 3 ) {
      const { dc, why } = flatCheck(ctx.from, u, ctx.action);
      if ( !dc ) return roll;
      const { natural, success } = flatRoll(run, ctx.from, dc, () => conditionLabel(why), { target: u });
      if ( success ) return roll;
      return { ...roll, degree: 3, said: { text: t("FlatCheckSpell", { caster: ctx.from.spec?.name ?? "", natural, dc }), data: { flat: natural, flatDC: dc, luck: "spell" } } };
    }
    if ( ctx.kind !== "attack" || !(roll?.degree >= 2) ) return roll;
    const { dc, why } = flatCheck(u, ctx.target, ctx.action);
    if ( !dc ) return roll;
    const { natural, success } = flatRoll(run, u, dc, () => conditionLabel(why), { target: ctx.target });
    if ( success ) return roll;
    return { ...roll, degree: 1, said: { text: t("FlatCheck", { target: ctx.target.spec?.name ?? "", natural, dc }), data: { flat: natural, flatDC: dc, luck: why } } };
  },

  /** The start of its turn: drained since (drain), the Hit Points it loses. */
  startTurn(run, u) {
    drain(run, u);
    return null;
  },

  /** Cover is PF2e's (standard, greater: coverBonus), not the core's. */
  handlesCover: true,

  /** A fall: bludgeoning damage of half the distance in feet; landing from it, prone. */
  fallDamage(feet) {
    const half = Math.floor((Number(feet) || 0) / 2);
    return feet > 5 && half > 0 ? [part([], half, "bludgeoning")] : [];
  },
  fallProne: true,

  /**
   * Hearing a fight, or only talk (core API 32): GM Core's simple DCs and DC adjustments. The din of a fight is an
   * untrained DC (10), raised voices a trained one (15); hard (+2) past 30 feet, very hard (+5) past 60, incredibly hard
   * (+10) past 120; a wall very hard (+5), two incredibly hard (+10), more not heard at all. Talk doesn't carry through
   * a wall. The notice check leaves level out (modifiers.check), so these hold at any level.
   */
  hearDC({ feet, walls = 0, talk = false }) {
    if ( walls > (talk ? 0 : 2) ) return null;
    const far = feet <= 30 ? 0 : feet <= 60 ? ADJUST.hard : feet <= 120 ? ADJUST.veryHard : ADJUST.incrediblyHard;
    const muffled = [0, ADJUST.veryHard, ADJUST.incrediblyHard][walls];
    return (talk ? SIMPLE_DC.trained : SIMPLE_DC.untrained) + far + muffled;
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
    // Too big to trip.
    if ( Number.isFinite(action.maxSize) && Number.isFinite(target.spec.size) && target.spec.size > action.maxSize ) return true;
    // Nothing in hand to knock away: claws and jaws can't be disarmed.
    if ( action.disarm && !(target.spec.actions ?? []).some(a => a.kind === "strike" && a.held) ) return true;
    const immune = new Set(target.spec.iwr?.immune ?? []);
    const traits = action.traits ?? [];
    if ( traits.some(t => immune.has(TRAIT_IMMUNITY[t] ?? t)) ) return true;
    if ( traits.includes("mental") && target.spec.creatureTraits?.includes("mindless") ) return true;
    // Swarm Mind: no single mind for a mental effect that picks out so many creatures (one over an area still works).
    if ( traits.includes("mental") && target.spec.swarmMind && !action.area ) return true;
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
   * actions, fascinated -2 to its checks (PF2e's: it can still act; not the core's, which takes its turn). And PF2e's
   * own meaning of those the core has too (the core's step aside for them): stupefied to Will and its checks (and its
   * spells, which it may lose), drained to Fortitude (and Hit Points), dazzled and concealed as the flat check an attack
   * needs (DC 5: about 2 points), encumbered as clumsy 1 and 10 feet slower, quickened an action more. Where PF2e's
   * totals already have one (a sheet's conditions when its numbers were read), the rolls don't count it again
   * (statusPenalty, sheetOffGuard).
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
      case "stupefied": return { saves: -Math.ceil(v / 3), checks: -v };
      case "drained": return { saves: -Math.ceil(v / 3) };
      case "dazzled": return { attack: -2 };
      case "concealed": return { ac: 2 };
      case "encumbered": return { ac: -1, speed: -10 };
      case "quickened": return { actions: 1 };
      // (Hidden: a DC 11 flat check for each attack at it, and its own next one at an off-guard foe; taking cover:
      // greater cover for standard, 2 more.)
      case "hidden": return { ac: 4, attack: 1 };
      case "inCover": return { ac: 2 };
      default: return null;
    }
  },

  /** PF2e's fear has steps of its own (frightened 2): the core goes by them, building none of its own. */
  fearValued: true,
  /**
   * What PF2e's fears make a creature want while they last (the core's conditionWishes): frightened, nothing (a status
   * penalty, and no rule on where it goes); fleeing, every action it has spent getting away from the source as quickly as
   * it can, as strong a wish to keep away from it as there is. Anything else, the core's.
   */
  conditionWishes(run, u, { key, by }) {
    if ( key === "frightened" ) return [];
    if ( key === "fleeing" ) return by ? [{ kind: "avoid", targetId: by.id, level: FLEEING_AVOID }] : [];
    return null;
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
   * off-guard -2 AC; the status penalties (statusPenalty: frightened and sickened to checks and DCs, clumsy to AC,
   * Reflex and ranged attacks, enfeebled to melee attacks, stupefied to Will and spell attacks, drained to Fortitude,
   * fascinated to skill checks; the worst of them) as far as its own numbers don't have them already; prone -2 to
   * attack; -2 to melee underwater without a swim speed; -2 per range increment.
   */
  modifiers: {
    exposed(ctx) {
      // (exposedTo: off-guard to this attacker only, after a Feint. Each fact read only if the ones before don't settle
      // it: the situation works them out as they're read.)
      // (And whoever swallowed or engulfed the attacker: off-guard to it from inside; and anyone it's hidden from, still
      // so through the attack that gives it away: afterAttack.)
      const t = ctx.target;
      const a = ctx.attacker;
      // (A creature's Surprise Attack: off-guard to it until the target's first turn.)
      return !!(t.prone || t.conds.offGuard || t.conds.paralyzed || ctx.grabbed || ctx.flanked || ctx.exposedTo || (a && (holderId(a) === t.id || hiddenFrom(t, a)))
        || (a?.spec?.surpriseAttack && !(t.turnsTaken > 0)));
    },
    defense(ctx) {
      // (Off guard on its sheet already: its AC has the -2.)
      const t = ctx.target;
      // (Taking cover: standard made greater; prone, greater against a ranged attack.)
      return (sheetOffGuard(t) ? 2 : 0) - (this.exposed(ctx) ? 2 : 0) - statusPenalty(t, "dex") + coverBonus(coverTaken(t, ctx.cover, !ctx.action?.melee));
    },
    attack(ctx) {
      const { attacker, action } = ctx;
      let bonus = 0;
      // (Prone on its sheet already: its Strikes have the -2.)
      if ( attacker.prone ) bonus -= 2;
      if ( Number(attacker.spec?.conditions?.prone) > 0 ) bonus += 2;
      // (A spell attack the mind's, a melee Strike Strength's, a ranged one Dexterity's.)
      bonus -= statusPenalty(attacker, action?.spellId ? "mind" : action?.melee ? "str" : "dex");
      if ( action?.melee && attacker.spec.environment?.aquatic && !(attacker.spec.speeds?.swim > 0) ) bonus -= 2;
      if ( action?.range && !action.range.noPenalty && ctx.positioning ) {
        bonus -= 2 * Math.max(0, Math.ceil(ctx.distance / action.range.increment) - 1);
      }
      return { bonus, advantage: 0 };
    },
    save({ unit, type, cover, from, action }) {
      let bonus = 0 - statusPenalty(unit, SAVE_ON[type]);
      if ( type === "reflex" ) bonus += coverBonus(coverTaken(unit, cover));
      // (A stupefied caster's spell DC is that much lower: as much easier to save against.)
      if ( from && action?.spellId ) bonus += Math.max(0, statusPenalty(from, "mind"));
      return { bonus, advantage: 0 };
    },
    /**
     * A skill check: frightened, sickened and fascinated, the worst; and what it's based on, by what it's for (checkOn:
     * clumsy on Thievery, enfeebled on Athletics, stupefied on words, Medicine and Recall Knowledge).
     */
    check({ unit, purpose, action } = {}) {
      const on = checkOn(purpose, action);
      // (Noticing a fight from afar, against hearDC's simple DCs: Perception without its level.)
      const level = purpose === "notice" ? Math.max(0, Number(unit?.spec?.level) || 0) : 0;
      return { bonus: (unit ? 0 - statusPenalty(unit, "skill", ...(on ? [on] : [])) : 0) - level, advantage: 0 };
    },
    /** Steal in combat: -5 to the Thievery check. */
    steal() {
      return { bonus: -5, advantage: 0 };
    },
    actionsLost(u) {
      if ( u.conds.paralyzed || u.conds.fleeing ) return 99; // fleeing spends every action getting away
      // (Inside a gullet: slowed 1. Quickened: an action more.)
      return Math.max(u.conds.slowed ?? 0, holderId(u) ? 1 : 0) + (u.conds.stunned ?? 0) - (Number(u.conds.quickened) > 0 ? 1 : 0);
    }
  },

  /**
   * Apply immunities, weaknesses and resistances to a {type: amount} map, as PF2e's own applyIWR does (iwr.js): each
   * damage type an instance, tested with what deals it (the core's ctx: traits, materials, magical, an area's, a
   * critical hit, its precision and splash); vitality and void only on whom they touch; a weakness to holy and the
   * like once a blow.
   * @param {object} iwr
   * @param {Record<string, number>} byType
   * @param {object} [target]
   * @param {object} [ctx]   what deals it (the core's iwrContext, API 20)
   * @returns {number} total damage after IWR
   */
  applyIwr(iwr, byType, target = null, ctx = {}) {
    return applyPf2eIwr(iwr, byType, target, ctx ?? {});
  },

  /** A critical hit on one immune to critical hits deals a normal hit's damage (its exceptions aside): iwr.js. */
  critImmune(target, action) {
    return critImmune(target, action);
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

  /**
   * Ferocity that kept it up, said once the blow is done (the core's line for staying up at 1 hit point); drained by
   * it (a draining blow, a poison's stage), the Hit Points that costs (drain); and a blow from inside its gullet that
   * ruptures it (ruptured), the one who struck it out.
   */
  afterHarm(run, u, amount, rng, ctx = {}) {
    if ( u.status === STATUS.STANDING ) drain(run, u);
    const cut = ruptured(run, u, ctx);
    if ( !u.ferocityNote ) return cut;
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
    const at = rng.mark?.();
    const natural = rng.d20();
    const degree = this.degreeOfSuccess(natural, natural, dc);
    // (A flat check the table sees, in a live battle: the core's table rolls.)
    if ( at !== undefined ) rng.record(at, { by: c, kind: "flat", what: "recovery", total: natural, natural, dc, degree });
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

  /**
   * Administer First Aid (stabilize): Medicine against 5 + its recovery check's DC (10 + the dying value; 9 + it with
   * Toughness: spec.recoveryDC), as the Player Core has it.
   */
  firstAidDC(c) {
    return 5 + (c.spec?.recoveryDC ?? 10) + (c.dying ?? 0);
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

  /**
   * End of turn persistent damage: take it, then a DC 15 flat check to remove each instance (its `type`), the unit's:
   * in a live battle the system's own (flatRoll).
   */
  persistentFlatCheck(rng, { run = null, unit = null, type = null } = {}) {
    return flatRoll(run, unit, 15, persistentLabel(type), { rng }).success;
  },

  /** Assisted recovery against persistent damage (remedies.js): two actions, where something would reasonably help. */
  persistentRemedyCost(u, type) {
    return ASSISTED[type] ? { actions: 2 } : { actions: Infinity };
  },

  /** One more flat check (remedies.js ASSISTED): against fire, dropping and rolling, at the lower DC 10, and prone after. */
  persistentRemedy(run, u, type) {
    const help = ASSISTED[type];
    if ( !help ) return { success: false };
    if ( help.prone ) u.prone = true;
    const { natural, success } = flatRoll(run, u, help.dc, persistentLabel(type));
    return { success, said: { text: t("Remedy.Flat", { natural, dc: help.dc }) } };
  },

  /** A bleed a friend can stop with Administer First Aid (remedies.js): Medicine against its DC; only a friend tries it. */
  holds(run, u) {
    const bleed = (u.persistent ?? []).find(e => e.part?.type === "bleed");
    return bleed ? [{ key: BLEED, byId: bleed.sourceId ?? null, dc: bleedDC(run, u, bleed), others: "check", via: "medicine", friendOnly: true }] : [];
  },

  /** Freeing a friend: untying it is an Interact action; Administer First Aid on its bleed two, for one trained in Medicine. */
  untieCost(u, t, hold) {
    if ( hold?.key === BLEED ) return u.spec?.firstAid ? { actions: 2 } : { actions: Infinity };
    // (Out of a Swallow Whole's corpse: three actions cutting it open, with a piercing or slashing blow.)
    if ( hold?.key === "swallowed" ) return cutsOpen(u) ? { actions: 3 } : { actions: Infinity };
    return { actions: 1 };
  },

  /**
   * Administer First Aid on a friend's bleed: Medicine (less what frightens or sickens the healer) against the bleed's
   * DC; a success lets the friend try an assisted recovery at once, at the lower DC for particularly appropriate help,
   * and the bleed ends on that.
   */
  stopBleeding(run, who, held, hold) {
    const base = Number(who.spec?.firstAid?.mod);
    if ( !Number.isFinite(base) || !held ) return { success: false };
    const mod = base - statusPenalty(who, "mind", "skill");
    // (A live battle's, the system's own roll: its Administer First Aid, the variant its id ends in; and the bleeder's
    // flat check after it, its own too: flatRoll.)
    const rolled = systemRolled(run, who, "check", { dc: hold.dc, target: held, purpose: "firstAid", action: { id: `${who.id}.stop-bleeding` }, label: hold.key });
    const { natural, total, degree } = rollCheck(this, run.rng, mod, hold.dc, { kind: "check", roller: who, rolled, what: "firstAid", target: held });
    const flat = degree >= 2 ? flatRoll(run, held, APPROPRIATE_DC, persistentLabel("bleed")) : null;
    const success = !!flat?.success;
    if ( success ) held.persistent = (held.persistent ?? []).filter(e => e.part?.type !== "bleed");
    return { success, degree, natural, mod, total, dc: hold.dc, ...(flat ? { said: { text: t("Remedy.Flat", { natural: flat.natural, dc: APPROPRIATE_DC }) } } : {}) };
  },

  /** Retching while sickened (remedies.js): one action, a Fortitude save against what sickened it. */
  remedies(run, u) {
    const sick = Number(u.conds?.sickened) || 0;
    if ( !(sick > 0) ) return [];
    return [{
      key: "retch", condition: "sickened", label: t("Remedy.Retch"), cost: { actions: 1 }, annoyance: SICK_ANNOYANCE.base + SICK_ANNOYANCE.step * sick,
      try: (r, w) => this.retch(r, w)
    }];
  },

  /** A retch: a Fortitude save against the DC of what sickened it; sickened 1 lower on a success, 2 on a critical success. */
  retch(run, u) {
    const dc = sickDC(run, u);
    const mod = (Number(u.spec?.defenses?.fortitude) || 0) + this.modifiers.save({ unit: u, type: "fortitude" }).bonus + (Number(u.mods?.saves) || 0);
    // (A live battle's, the system's own save: systemRolled.)
    const rolled = systemRolled(run, u, "save", { dc, save: "fortitude", label: t("Remedy.Retch") });
    const { natural, total, degree } = rollCheck(this, run.rng, mod, dc, { kind: "save", roller: u, rolled, label: t("Remedy.Retch") });
    if ( degree >= 2 ) lower(u, "sickened", degree === 3 ? 2 : 1);
    return { success: degree >= 2, said: { text: t("Remedy.RetchRoll", { natural, total, dc }) } };
  },

  /** The story's family for a damage type: the remaster's are the story's own; older content's are mapped. */
  storyDamageType(type) {
    return STORY_TYPES[type] ?? type;
  }
};
