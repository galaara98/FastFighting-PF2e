/**
 * What PF2e says about a character, for the one time FastFighting sets it up by itself (the core's
 * foundry/auto-config.js): the playstyles that fit it and its own answers to the tactics questions, from its class and
 * ancestry (by slug), a creature's traits (by slug: undead, mindless, fiend, holy ...), and its gear; and its biography
 * as plain text for the keywords. Pure.
 */

/** What each class leans toward. */
const CLASSES = Object.freeze({
  alchemist: { puzzleManiac: 0.5 }, animist: { unmundane: 0.4, enabler: 0.2 }, barbarian: { brawler: 0.5, impatient: 0.3 },
  bard: { peoplePleaser: 0.3, diplomat: 0.3, enabler: 0.2 }, champion: { tank: 0.5, martyr: 0.3 }, cleric: { enabler: 0.5, moralist: 0.2 },
  commander: { leader: 0.7 }, druid: { unmundane: 0.3, loreCollector: 0.2 }, exemplar: { brawler: 0.3, instigator: 0.2 },
  fighter: { brawler: 0.3, tank: 0.2 }, guardian: { tank: 0.7 }, gunslinger: { wallflower: 0.4 }, inventor: { puzzleManiac: 0.6 },
  investigator: { loreCollector: 0.5, puzzleManiac: 0.3 }, kineticist: { unmundane: 0.5 }, magus: { unmundane: 0.4 },
  monk: { speedRunner: 0.4 }, oracle: { unmundane: 0.4 }, psychic: { unmundane: 0.5 }, ranger: { wallflower: 0.4, relentless: 0.2 },
  rogue: { thief: 0.5, wallflower: 0.2 }, sorcerer: { unmundane: 0.6 }, summoner: { unmundane: 0.4 }, swashbuckler: { instigator: 0.5 },
  thaumaturge: { puzzleManiac: 0.4, loreCollector: 0.3 }, witch: { unmundane: 0.5 }, wizard: { unmundane: 0.4, loreCollector: 0.4 }
});

/** Ancestries (and a creature's traits naming one), only where an ancestry's own abilities lean somewhere. */
const ANCESTRIES = Object.freeze({
  goblin: { impatient: 0.15 }, kobold: { puzzleManiac: 0.15 }, orc: { relentless: 0.2 }, dwarf: { tank: 0.15 }
});

/** What a creature's traits lean toward. */
const TRAITS = Object.freeze({
  undead: { relentless: 0.3 }, mindless: { relentless: 0.5 }, animal: { brawler: 0.3 }, beast: { brawler: 0.2 },
  fiend: { cruel: 0.4 }, unholy: { cruel: 0.3 }, holy: { moralist: 0.3 }, celestial: { moralist: 0.3, martyr: 0.2 },
  construct: { relentless: 0.5 }, fey: { wildcard: 0.4 }, aberration: { instigator: 0.2, wildcard: 0.2 }, ooze: { relentless: 0.4 },
  plant: { relentless: 0.3 }, dragon: { leader: 0.2 }, giant: { brawler: 0.3 }, elemental: { relentless: 0.2 }, troll: { relentless: 0.2 }
});

/** The playstyles that fit: {id: -1 to 1}. */
export function pf2eHints({ cls = null, ancestry = null, traits = [], shield = false, heavy = false } = {}) {
  const out = {};
  const add = map => { for ( const [k, v] of Object.entries(map ?? {}) ) out[k] = (out[k] ?? 0) + v; };
  add(CLASSES[cls]);
  add(ANCESTRIES[ancestry]);
  for ( const t of new Set(traits) ) add(TRAITS[t] ?? (t !== ancestry ? ANCESTRIES[t] : null));
  if ( shield ) add({ tank: 0.2 });
  if ( heavy ) add({ tank: 0.2 });
  for ( const k of Object.keys(out) ) out[k] = Math.max(-1, Math.min(1, out[k]));
  return out;
}

/** A class's fighting style. */
const CLASS_STYLE = Object.freeze({
  champion: "protector", guardian: "protector", barbarian: "frontline", fighter: "frontline", exemplar: "frontline", magus: "frontline",
  monk: "skirmisher", rogue: "skirmisher", swashbuckler: "skirmisher", ranger: "ranged", gunslinger: "ranged",
  wizard: "caster", sorcerer: "caster", witch: "caster", psychic: "caster", oracle: "caster", druid: "caster", cleric: "caster",
  bard: "caster", summoner: "caster", animist: "caster", kineticist: "caster"
});

/** PF2e's own answers to the tactics questions, where it knows better than the numbers: {key: answer}. */
export function pf2eTactics({ cls = null, traits = [] } = {}) {
  const out = {};
  if ( CLASS_STYLE[cls] ) out.style = CLASS_STYLE[cls];
  if ( ["champion", "guardian"].includes(cls) ) Object.assign(out, { target: "protect", allyDying: "rescue" });
  if ( cls === "cleric" ) out.healAggro = "aggressive";
  if ( cls === "commander" ) out.target = "dangerous";
  const has = t => traits.includes(t);
  // (The mindless and constructs never run; animals stay where the fight is.)
  if ( has("mindless") || has("construct") ) out.retreat = "never";
  if ( has("animal") ) out.beyond = "stay";
  return out;
}

/** Text from the sheet's HTML. */
export function plainText(html) {
  return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
}

/** Every string in it (a biography's fields, edicts and anathema), as one text. */
export function textOf(value) {
  const parts = [];
  const walk = v => {
    if ( typeof v === "string" ) parts.push(plainText(v));
    else if ( Array.isArray(v) ) v.forEach(walk);
    else if ( v && typeof v === "object" ) Object.values(v).forEach(walk);
  };
  walk(value);
  return parts.filter(Boolean).join(". ");
}
