/**
 * A PF2e creature's auras that make its foes save (the core's spec.auras: behavior/auras.js): a passive ability with the
 * aura trait or an Aura rule element, whose text asks for a save (Frightful Presence, Stench, a dragon's heat).
 *
 * Read from its structure first:
 *  - its range: the Aura rule element's radius (a formula worked out where it can be), else an emanation's
 *    @Template, else the feet its text opens with (reading/en.json: auras.radius);
 *  - its save: the @Check (abilities.js saveIn), DC and basic included; its damage: its @Damage (damageIn);
 *  - its traits: the item's and the rule element's (emotion, fear, mental: immunities and situational saves; visual,
 *    auditory, olfactory: the sense it needs; magical or a tradition: a save against magic);
 *  - its key (what immunity to "all such auras" is to): the rule element's slug, else the item's;
 *  - what each degree lays: the conditions its text links (@UUID[Compendium.pf2e.conditionitems.Item.<id>]{Label N}:
 *    the condition by its item's id, CONDITION_ITEMS, else by its label; the value the label's number), and those its
 *    words name (control.js conditionsIn). By degree, from its own degree lines (reading: auras.degree0 to degree3, the
 *    headings' words); else from the glossary entry its text calls up (@Localize[PF2E.NPC.Abilities.Glossary.<key>],
 *    GLOSSARY_KEYS), as the remaster's Monster Core has it (GLOSSARY_AURAS); else from the sentence that asks for the
 *    save and those about failing (auras.failure), a clause about a critical failure (auras.critical) on that alone;
 *    else, by its slug, the glossary's. A critical failure its lines lay nothing readable for lays at least what a
 *    failure does.
 * When it goes off and how long a creature is immune once it has saved: the glossary entry its text calls up; else its
 * words (auras.enter, auras.turnStart; the sentence that says immune, auras.immune: after any save, auras.immuneAny, or a
 * success, auras.immuneSuccess; to all such auras, auras.immuneAll; for the duration it names, control.js
 * durationRounds); else its slug's glossary entry. Nothing said: both on coming in and at the start of a turn inside, as
 * the glossary's general rule for auras has it, and never immune.
 * Only its bearer's foes, as the glossary lets a GM rule. Frightened lasts its value in rounds (it wears off a point a
 * turn); sickened, and what comes with it, the fight's minute unless the words say (it lasts until retched away).
 * Pure, unit-tested (the words to read by are reading.js's, or given).
 */
import { saveIn, damageIn, templateIn } from "./abilities.js";
import { conditionsIn, conditionsLabel, plain, durationRounds } from "./control.js";
import { ruleValue } from "./effects.js";
import { engineKey } from "./commit.js";
import { currentReading } from "./reading.js";

/** The rounds in PF2e's minute: how long a creature stays immune, and how long a sickening lasts at most. */
export const MINUTE = 10;

/**
 * Standard auras PF2e's glossary describes, by slug, as the remaster's Monster Core has them: when each goes off, who's
 * immune once it has saved, and what each degree of the save lays ([critical failure, failure, success, critical
 * success]: conditions).
 */
export const GLOSSARY_AURAS = Object.freeze({
  // (Will, on first coming in; immune to this one's for a minute whatever came of it.)
  "frightful-presence": Object.freeze({ when: "enter", immuneAfter: "save", immuneAll: false, immuneRounds: MINUTE,
    byDegree: Object.freeze([{ frightened: 4 }, { frightened: 2 }, { frightened: 1 }, null]) }),
  // (Fortitude, coming in or starting a turn there; a success makes it immune to every stench for a minute.)
  stench: Object.freeze({ when: "both", immuneAfter: "success", immuneAll: true, immuneRounds: MINUTE,
    byDegree: Object.freeze([{ sickened: 1, slowed: 1 }, { sickened: 1 }, null, null]) })
});

/** PF2e's glossary entries a creature's text calls up (@Localize[PF2E.NPC.Abilities.Glossary.<key>]), as slugs. */
export const GLOSSARY_KEYS = Object.freeze({ FrightfulPresence: "frightful-presence", Stench: "stench" });

/**
 * PF2e's conditions an aura can lay, by their compendium items' ids (Compendium.pf2e.conditionitems.Item.<id>), as
 * slugs: what a link names, whatever its label says.
 */
export const CONDITION_ITEMS = Object.freeze({
  TBSHQspnbcqxsmjL: "frightened", fesd1n5eVhpCSS18: "sickened", xYTAsEpcJE1Ccni3: "slowed", dfCMdR4wnpbYNTix: "stunned",
  e1XGnhKNSQIm5IXg: "stupefied", i3OJZU2nk64Df3xm: "clumsy", MIRkyAjyBeXivMa7: "enfeebled", "4D2KBtexWXa6oUMR": "drained",
  TkIyaNPgTZFBCCuh: "dazzled", XgEqL1kFApUbl5Z2: "blinded", "9PR9y0bi4JPKnHPR": "deafened", AdPVz7rbaVSRxHFg: "fascinated",
  HL2l2VRSaQHu9lUw: "fatigued", yblD8fOR1J8rDwEQ: "confused", "9qGBRpbX9NEwtAAr": "controlled", sDPxOjQ9kx2RZE8D: "fleeing",
  kWc1fhmv9LBiTuei: "grabbed", VcDeM8A5oI6VqhbM: "restrained", eIcWbB5o3pP6OIMe: "immobilized", "6uEgoh53GbXuHpTF": "paralyzed",
  dTwPJuKgBQCMxixg: "petrified", j91X7x0XSomq8d60: "prone", AJh5ex99aV6VTggg: "off-guard", fBnFDH2MTzgFijKf: "unconscious"
});

/** The conditions it lays, by slug (those CONDITION_ITEMS names: not an attitude, being seen, dying ...). */
const LAYS = new Set(Object.values(CONDITION_ITEMS));

/** A PF2e condition that means more to the engine than its own key (as control.js reads it from a spell). */
const MEANS = Object.freeze({ grabbed: ["immobilized", "offGuard"], restrained: ["immobilized", "offGuard"], unconscious: ["unconscious", "incapacitated", "offGuard"] });

/** The senses an aura's traits say it needs (the core's aura.needs). */
const NEEDS = Object.freeze({ visual: "sight", auditory: "hearing", olfactory: "smell" });

/** Traits that make it magical, as PF2e's item:magical has it. */
const MAGICAL = new Set(["magical", "arcane", "divine", "occult", "primal"]);

/** A pattern from the reading words (auras.<key>.pattern), or null without one. */
function patternOf(words, key) {
  const p = words?.[key]?.pattern;
  if ( typeof p !== "string" ) return null;
  try {
    return new RegExp(p, "i");
  } catch ( err ) {
    return null;
  }
}

/** The glossary entry its text calls up, as a slug, or null. */
export function glossaryOf(html) {
  const m = /@Localize\[PF2E\.NPC\.Abilities\.Glossary\.(\w+)\]/.exec(String(html ?? ""));
  return m ? GLOSSARY_KEYS[m[1]] ?? null : null;
}

/** The conditions a text's condition links name, as the engine's keys and values: {frightened: 2}. */
export function linkedConditions(html) {
  const out = {};
  for ( const m of String(html ?? "").matchAll(/@UUID\[Compendium\.pf2e\.conditionitems\.(?:Item\.)?(\w+)\](?:\{([^}]*)\})?/g) ) {
    const label = String(m[2] ?? "").trim();
    const slug = CONDITION_ITEMS[m[1]] ?? label.replace(/\s*\d+$/, "").toLowerCase().replace(/\s+/g, "-");
    if ( !LAYS.has(slug) ) continue;
    const value = Number(/(\d+)$/.exec(label)?.[1]) || 1;
    for ( const k of MEANS[slug] ?? [engineKey(slug)] ) out[k] = Math.max(out[k] ?? 0, MEANS[slug] ? 1 : value);
  }
  return out;
}

/** The conditions some text lays: those it links, and those it names. */
const conditionsOf = html => ({ ...conditionsIn(plain(html)), ...linkedConditions(html) });

/** How long what a degree lays lasts: what its words say, else frightened its value, sickened the minute, else a round. */
function roundsFor(conditions, text = "") {
  return durationRounds(plain(text)) ?? (conditions.frightened ? conditions.frightened : null) ?? (conditions.sickened ? MINUTE : null) ?? 1;
}

/** An outcome laying these conditions (or null for none). */
function outcome(conditions, text = "") {
  if ( !conditions || !Object.keys(conditions).length ) return null;
  return { conditions: { ...conditions }, rounds: roundsFor(conditions, text), label: conditionsLabel(conditions) };
}

/** A critical failure that lays nothing it can read, where a failure lays something: at least that. */
const atLeastFailure = list => (list && !list[0] && list[1] ? [list[1], ...list.slice(1)] : list);

/**
 * What each degree of the save lays, from its own degree lines (<strong> headings the reading words name):
 * [critical failure, failure, success, critical success], or null where it has none, or they lay nothing it reads.
 */
export function degreesIn(html, words = currentReading().auras ?? {}) {
  const patterns = [0, 1, 2, 3].map(d => patternOf(words, `degree${d}`));
  if ( !patterns.some(Boolean) ) return null;
  const text = String(html ?? "");
  const heads = [...text.matchAll(/<strong>([^<]*)<\/strong>/gi)]
    .map(m => ({ at: m.index, end: m.index + m[0].length, degree: patterns.findIndex(p => p?.test(m[1].trim())) }));
  const out = [null, null, null, null];
  let any = false;
  heads.forEach((h, i) => {
    if ( h.degree < 0 ) return;
    const next = heads.slice(i + 1).find(x => x.degree >= 0)?.at ?? text.length;
    const hr = text.indexOf("<hr", h.end);
    const part = text.slice(h.end, hr >= 0 && hr < next ? hr : next);
    any = true;
    out[h.degree] = outcome(conditionsOf(part), part);
  });
  return any && out.some(Boolean) ? atLeastFailure(out) : null;
}

/** A sentence split where its words turn to a critical failure: a parenthesis about one, or all after the words. */
function splitCritical(sentence, critical) {
  const m = critical?.exec(plain(sentence));
  if ( !m ) return { rest: sentence, crit: "" };
  // (Where the words are in the sentence itself, links and all: the plain text's words found again in it.)
  const at = sentence.toLowerCase().indexOf(m[0].toLowerCase());
  if ( at < 0 ) return { rest: sentence, crit: "" };
  const open = sentence.lastIndexOf("(", at);
  const close = sentence.indexOf(")", at);
  if ( open >= 0 && close > at && !sentence.slice(open, at).includes(")") ) {
    return { rest: sentence.slice(0, open) + sentence.slice(close + 1), crit: sentence.slice(open, close + 1) };
  }
  return { rest: sentence.slice(0, at), crit: sentence.slice(at) };
}

/**
 * What a failure and a critical failure lay, from the sentence that asks for the save and those about failing:
 * [critical failure, failure, null, null], or null where they name no condition.
 */
export function failuresIn(html, words = currentReading().auras ?? {}) {
  const failure = patternOf(words, "failure");
  const critical = patternOf(words, "critical");
  // (Sentence by sentence, its links kept: the check marked, tags gone.)
  const sentences = String(html ?? "").replace(/@Check\[[^\]]*\]/gi, " \u0001 ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z@])/);
  const fail = {};
  const crit = {};
  // (Each part's own words for how long: a failure's, and a critical failure's.)
  let failText = "";
  let critText = "";
  for ( const s of sentences ) {
    if ( !s.includes("\u0001") && !failure?.test(plain(s)) ) continue;
    const { rest, crit: worse } = splitCritical(s, critical);
    Object.assign(fail, conditionsOf(rest));
    Object.assign(crit, conditionsOf(worse));
    failText += ` ${rest}`;
    critText += ` ${worse}`;
  }
  if ( !Object.keys(fail).length && !Object.keys(crit).length ) return null;
  return [outcome({ ...fail, ...crit }, Object.keys(crit).length ? critText : failText), outcome(fail, failText), null, null];
}

/** Its range in feet: the rule element's radius, an emanation's template, or the feet its text opens with. */
function rangeOf(rule, html, actor, words) {
  const radius = typeof rule?.radius === "number" ? rule.radius : ruleValue(rule?.radius, { actor });
  if ( Number(radius) > 0 ) return Number(radius);
  const area = templateIn(html);
  if ( area?.feet > 0 && area.shape === "emanation" ) return area.feet;
  const m = patternOf(words, "radius")?.exec(plain(html));
  return m ? Number(m[1]) || null : null;
}

/**
 * When it goes off and who's immune once saved, from its words: {when, immuneAfter, immuneAll, immuneRounds, found}
 * (found: its words said any of it).
 */
export function timingIn(html, words = currentReading().auras ?? {}) {
  const text = plain(html);
  const enter = !!patternOf(words, "enter")?.test(text);
  const start = !!patternOf(words, "turnStart")?.test(text);
  const out = { when: enter && !start ? "enter" : start && !enter ? "turnStart" : "both", immuneAfter: null, immuneAll: false, immuneRounds: null };
  const immune = patternOf(words, "immune");
  const said = immune ? text.split(/(?<=[.!?;])\s+/).find(s => immune.test(s)) : null;
  if ( said ) {
    out.immuneAfter = patternOf(words, "immuneAny")?.test(said) ? "save" : patternOf(words, "immuneSuccess")?.test(said) ? "success" : "save";
    out.immuneAll = !!patternOf(words, "immuneAll")?.test(said);
    out.immuneRounds = durationRounds(said);
  }
  return { ...out, found: enter || start || !!said };
}

/**
 * One ability as an aura of the core's (spec.auras), or null: not a passive aura, no save, no range, or nothing its
 * save could come to.
 * @param {object} d
 * @param {string} d.id            the adapter's action id for it (its actor's id, then its item's)
 * @param {string} [d.slug]
 * @param {string} [d.name]
 * @param {string} d.html          its description, its formulas worked out (adapter.js resolvedText)
 * @param {string} [d.source]      its description as it's kept, its links in it (englishDescription); else html
 * @param {string[]} [d.traits]
 * @param {object[]} [d.rules]     its rule elements
 * @param {string} [d.actionType]  "passive" (an aura), or anything else (not one)
 * @param {object} [d.actor]       {level, abilities}, for a radius's formula
 * @param {object} [d.words]       the reading words' auras section (reading.js, by default)
 */
export function auraOf({ id, slug = "", name = "", html = "", source = null, traits = [], rules = [], actionType = "passive", actor = null, words = currentReading().auras ?? {} }) {
  if ( actionType && actionType !== "passive" ) return null;
  const rule = (rules ?? []).find(r => r?.key === "Aura") ?? null;
  if ( !rule && !traits.includes("aura") ) return null;
  const save = saveIn(html);
  if ( !save ) return null;
  const range = rangeOf(rule, html, actor, words);
  if ( !(range > 0) ) return null;
  const raw = source ?? html;
  const standard = GLOSSARY_AURAS[glossaryOf(raw)] ?? null;
  const bySlug = GLOSSARY_AURAS[slug] ?? null;
  const damage = damageIn(html);
  const byDegree = degreesIn(raw, words)
    ?? standard?.byDegree.map(c => outcome(c))
    ?? failuresIn(raw, words)
    ?? bySlug?.byDegree.map(c => outcome(c))
    ?? [null, null, null, null];
  if ( !damage.length && !byDegree.some(Boolean) ) return null;
  // (When, and immunity: the glossary its text calls up; else its words; else its slug's glossary entry.)
  const read = timingIn(raw, words);
  const timing = standard ?? (read.found ? read : bySlug ?? read);
  const all = [...new Set([...traits, ...(Array.isArray(rule?.traits) ? rule.traits : [])].filter(t => typeof t === "string"))];
  const needs = all.map(t => NEEDS[t]).find(Boolean);
  return {
    id, key: String(rule?.slug ?? (slug || id)), label: name, range, save, byDegree,
    ...(damage.length ? { damage } : {}),
    when: timing.when, immuneAfter: timing.immuneAfter ?? null, immuneAll: !!timing.immuneAll, ...(timing.immuneRounds ? { immuneRounds: timing.immuneRounds } : {}),
    traits: all, ...(needs ? { needs } : {}), foesOnly: true, ...(all.some(t => MAGICAL.has(t)) ? { magical: true } : {})
  };
}
