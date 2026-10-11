/**
 * PF2e personality defaults. Every number here is a starting point the GM can fudge.
 * Inputs are plain values so this stays testable without Foundry.
 */
import { clamp } from "./core.js";
import { t, traitName } from "./words.js";

const SELFISH_BY_TRAIT = {
  demon: 85, fiend: 70, daemon: 80, devil: 55, undead: 60, aberration: 60, dragon: 70, giant: 50,
  goblin: 55, kobold: 50, orc: 45, animal: 50, beast: 50, celestial: 15, angel: 10, archon: 15,
  minion: 10, construct: 5, mindless: 0
};

/** The creature types PF2e files creatures under (a creature can have more than one). */
const CREATURE_TYPES = new Set(["aberration", "animal", "astral", "beast", "celestial", "construct", "dragon", "dream", "elemental",
  "ethereal", "fey", "fiend", "fungus", "giant", "humanoid", "monitor", "ooze", "petitioner", "plant", "spirit", "time", "undead"]);

/**
 * What kind of creature, for grouping neutrals: its ancestry if it has one (goblin, human, kobold), else its creature
 * types (animal; dragon and elemental).
 * @param {string[]} traits
 * @param {Iterable<string>} [ancestries]  the system's ancestry traits (CONFIG.PF2E.ancestryTraits)
 * @returns {string|null}
 */
export function creatureKindOf(traits = [], ancestries = []) {
  const known = new Set(ancestries);
  const ancestry = traits.find(t => known.has(t) && !CREATURE_TYPES.has(t));
  if ( ancestry ) return ancestry;
  const types = traits.filter(t => CREATURE_TYPES.has(t)).sort();
  return types.length ? types.join(":") : null;
}

/** Expected Will modifier for a creature of `level` (moderate PF2e NPC guideline). */
function expectedWill(level) {
  return Math.round(level * 1.15 + 5);
}

/**
 * @param {object} d
 * @param {string} d.type        "character" | "npc" | "familiar" | ...
 * @param {number} d.level
 * @param {string[]} d.traits
 * @param {number} d.int         Intelligence modifier
 * @param {number} d.wis         Wisdom modifier
 * @param {number} d.will        Will save modifier
 * @param {string[]} d.abilities Slugs of the actor's actions/feats (pack-attack, sneak-attack, ...)
 * @param {boolean} d.hasMaster
 */
export function derivePf2eTraits(d) {
  const traits = new Set(d.traits ?? []);
  const abilities = new Set(d.abilities ?? []);
  const reasons = {};
  const flags = {};
  const pc = d.type === "character";

  // Tactical ---------------------------------------------------------
  let tactical;
  if ( traits.has("mindless") ) { tactical = 5; reasons.tactical = t("Reason.Mindless", "Mindless"); }
  else if ( pc ) { tactical = clamp(62 + d.int * 2, 40, 90); reasons.tactical = t("Reason.Pc", "Player character"); }
  else if ( traits.has("animal") || traits.has("beast") ) {
    tactical = clamp(18 + d.wis * 3 + Math.max(0, d.int + 4) * 2, 5, 45);
    reasons.tactical = t("Reason.Animal", "Animal instinct");
  } else {
    tactical = clamp(38 + d.int * 8 + d.wis * 2, 10, 95);
    reasons.tactical = t("Reason.Int", "Intelligence {n}", { n: `${d.int >= 0 ? "+" : ""}${d.int}` });
  }
  if ( abilities.has("pack-attack") || abilities.has("pack-tactics") ) {
    flags.packTactics = true;
    reasons.tactical += t("Reason.Pack", ", hunts in packs");
  }
  if ( abilities.has("sneak-attack") ) flags.sneakAttack = true;
  // Not everyone can punish a foe for moving: only those with Reactive Strike (Attack of Opportunity, before the remaster).
  if ( abilities.has("reactive-strike") || abilities.has("attack-of-opportunity") ) flags.reactiveStrike = true;

  // Brave ------------------------------------------------------------
  let brave;
  if ( traits.has("mindless") ) { brave = 100; flags.fearless = true; reasons.brave = t("Reason.NeverFlees", "Mindless: never flees"); }
  else if ( traits.has("construct") ) { brave = 100; flags.fearless = true; reasons.brave = t("Reason.Construct", "Construct"); }
  else if ( traits.has("undead") ) { brave = 90; reasons.brave = t("Reason.Undead", "Undead"); }
  else if ( pc ) { brave = 75; reasons.brave = t("Reason.Pc", "Player character"); }
  else {
    const delta = (d.will ?? expectedWill(d.level)) - expectedWill(d.level);
    brave = clamp(55 + delta * 5 - (traits.has("animal") ? 15 : 0), 10, 90);
    reasons.brave = t("Reason.Will", "Will {n} vs level", { n: `${delta >= 0 ? "+" : ""}${delta}` }) + (traits.has("animal") ? t("Reason.SelfPreservation", ", animal self-preservation") : "");
  }
  if ( traits.has("minion") ) brave = Math.max(brave, 70);

  // Selfish ----------------------------------------------------------
  let selfish = pc ? 25 : 40;
  let selfishWhy = pc ? t("Reason.Pc", "Player character") : null;
  for ( const trait of traits ) {
    if ( SELFISH_BY_TRAIT[trait] !== undefined && (!pc || trait === "minion") ) {
      if ( !selfishWhy || SELFISH_BY_TRAIT[trait] > selfish ) { selfish = SELFISH_BY_TRAIT[trait]; selfishWhy = t("Reason.Trait", "Trait: {trait}", { trait: traitName(trait) }); }
    }
  }
  selfishWhy ??= t("Reason.Default", "Default");
  reasons.selfish = selfishWhy;

  // Loyal ------------------------------------------------------------
  let loyal = pc ? 80 : 50;
  reasons.loyal = pc ? t("Reason.Party", "Party member") : t("Reason.Default", "Default");
  if ( d.hasMaster || traits.has("minion") || d.type === "familiar" ) { loyal = 85; reasons.loyal = t("Reason.Master", "Serves a master"); }
  else if ( traits.has("summoned") ) { loyal = 90; reasons.loyal = t("Reason.Summoned", "Summoned"); }
  else if ( traits.has("mindless") ) { loyal = 80; reasons.loyal = t("Reason.Orders", "Mindless: follows orders"); }

  return { traits: { tactical, brave, selfish, loyal }, flags, reasons };
}
