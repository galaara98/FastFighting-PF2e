/**
 * Parse PF2e affliction text (poisons, diseases, curses) into engine affliction specs. Pure, unit-tested.
 */
import { parseTypedFormula } from "./core.js";

/** Rounds in a unit of time, as PF2e's English names it (control.js reads a spell's durations with it too). */
export const UNIT_ROUNDS = Object.freeze({ round: 1, rounds: 1, minute: 10, minutes: 10, hour: 600, hours: 600, day: 14400, days: 14400, week: 100800, weeks: 100800 });

const CONDITION_KEYS = {
  "off-guard": "offGuard",
  clumsy: "clumsy",
  enfeebled: "enfeebled",
  sickened: "sickened",
  frightened: "frightened",
  slowed: "slowed",
  stunned: "stunned",
  drained: "drained",
  stupefied: "stupefied",
  paralyzed: "paralyzed",
  fatigued: "fatigued",
  confused: "confused",
  unconscious: "unconscious",
  doomed: "doomed",
  blinded: "blinded",
  dazzled: "dazzled"
};

function stripHtml(html) {
  return String(html ?? "")
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\]/g, " DMG⟦$1⟧ ")
    .replace(/@Check\[([^\]]*)\]/g, " CHECK⟦$1⟧ ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toRounds(n, unit) {
  return Number(n) * (UNIT_ROUNDS[unit?.toLowerCase()] ?? 1);
}

/**
 * @param {object} data
 * @param {string} data.id
 * @param {string} data.name
 * @param {string} [data.slug]
 * @param {string} data.description   HTML description of the affliction
 * @param {string[]} [data.traits]
 * @param {object} [data.save]        {type, dc}: the save against it, where its text doesn't say (a spell's, its DC)
 * @returns {object|null}  {kind:"affliction", id, name, slug, traits, save:{type,dc}, maxDuration, onset, stages:[{damage, conditions, duration}]}
 */
export function parseAffliction({ id, name, slug = null, description, traits = [], save: given = null }) {
  const text = stripHtml(description);
  let save = given;
  const check = save ? null : /CHECK⟦(\w+)\|[^⟧]*?dc:(\d+)/i.exec(text);
  if ( check ) save = { type: check[1].toLowerCase(), dc: Number(check[2]) };
  else if ( !save ) {
    const plain = /DC (\d+) (Fortitude|Reflex|Will)/i.exec(text);
    if ( plain ) save = { type: plain[2].toLowerCase(), dc: Number(plain[1]) };
  }
  if ( !save ) return null;

  const max = /Maximum Duration\s*(\d+)\s*(round|rounds|minute|minutes|hour|hours|day|days|week|weeks)/i.exec(text);
  const onset = /Onset\s*(\d+)\s*(round|rounds|minute|minutes|hour|hours|day|days|week|weeks)/i.exec(text);

  const stages = [];
  const stageRe = /Stage (\d+)\s*(.*?)(?=Stage \d+|$)/gi;
  for ( const m of text.matchAll(stageRe) ) {
    const body = m[2];
    const damage = [];
    for ( const d of body.matchAll(/DMG⟦([^⟧]*)⟧/g) ) damage.push(...parseTypedFormula(d[1]));
    // Plain-text damage ("1d6 poison damage") outside of @Damage enrichers.
    const plainBody = body.replace(/DMG⟦[^⟧]*⟧/g, " ");
    for ( const d of plainBody.matchAll(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(\w+)\s+damage/gi) ) {
      damage.push(...parseTypedFormula(`${d[1]} ${d[2]}`));
    }
    const conditions = {};
    for ( const c of body.toLowerCase().matchAll(/\b(off-guard|clumsy|enfeebled|sickened|frightened|slowed|stunned|drained|stupefied|paralyzed|fatigued|confused|unconscious|doomed|blinded|dazzled)\s*(\d+)?/g) ) {
      const key = CONDITION_KEYS[c[1]];
      const value = c[2] ? Number(c[2]) : true;
      if ( conditions[key] === undefined || (typeof value === "number" && value > (Number(conditions[key]) || 0)) ) conditions[key] = value;
    }
    const dur = /\((\d+)\s*(round|rounds|minute|minutes|hour|hours|day|days|week|weeks)\)/i.exec(body);
    stages.push({ damage, conditions, duration: dur ? toRounds(dur[1], dur[2]) : 1 });
  }
  if ( !stages.length ) return null;

  return {
    kind: "affliction",
    id,
    name,
    slug,
    traits,
    save,
    maxDuration: max ? toRounds(max[1], max[2]) : null,
    onset: onset ? toRounds(onset[1], onset[2]) : 0,
    stages
  };
}

/** The traits that make something an affliction (a poison, a disease, a curse). */
export const AFFLICTION_TRAITS = Object.freeze(["poison", "disease", "curse"]);

/** A paragraph of an affliction's block: its level, how long it lasts, its onset, its save. */
const DETAIL = /^\s*<strong>\s*(?:Level|Maximum Duration|Onset|Saving Throw)\b/i;
const STAGE = /^\s*<strong>\s*Stage \d+\s*<\/strong>/i;

/**
 * The affliction a spell lays (Spider Sting's spider venom, Goblin Pox, Curse of Death), from its block of the spell's
 * text: the heading that names it and its traits ("Spider Venom (poison)"), its level and how long it lasts, and its
 * stages; worked off with saves against the spell DC (`save`). The spell's own save is its exposure: a failure, stage
 * 1; a critical failure, stage 2 (the core's afflictionStep), so it's marked `bySave` (the action's save decides how it
 * takes hold). Null when the text has none.
 * @param {object} data
 * @param {string} data.id
 * @param {string} data.html     the spell's description
 * @param {object} data.save     {type, dc}: the spell's save, and its DC
 * @param {string} [data.name]   the spell's name, where the block names none
 * @param {string[]} [data.traits]  the spell's traits, where the block lists none
 */
export function spellAffliction({ id, html, save, name = "", traits = [] }) {
  const paras = [...String(html ?? "").matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m => m[1]);
  const first = paras.findIndex(p => STAGE.test(p));
  if ( first < 0 || !save ) return null;
  let start = first;
  while ( start > 0 && DETAIL.test(paras[start - 1]) ) start -= 1;
  const heading = start > 0 ? /^\s*<strong>([^<]+)<\/strong>\s*(?:\(([^)]*)\))?/.exec(paras[start - 1]) : null;
  let end = first;
  while ( end < paras.length && STAGE.test(paras[end]) ) end += 1;
  const listed = heading?.[2]?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) ?? [];
  const own = listed.length ? listed : traits.filter(t => AFFLICTION_TRAITS.includes(t));
  const a = parseAffliction({
    id, name: heading?.[1]?.trim() || name, description: [heading ? paras[start - 1] : "", ...paras.slice(start, end)].map(p => `<p>${p}</p>`).join(""),
    traits: own, save
  });
  return a ? { ...a, bySave: true } : null;
}
