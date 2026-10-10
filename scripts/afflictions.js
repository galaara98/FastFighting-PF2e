/**
 * Parse PF2e affliction text (poisons, diseases, curses) into engine affliction specs. Pure, unit-tested.
 */
import { parseTypedFormula } from "./core.js";

const UNIT_ROUNDS = { round: 1, rounds: 1, minute: 10, minutes: 10, hour: 600, hours: 600, day: 14400, days: 14400, week: 100800, weeks: 100800 };

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
 * @returns {object|null}  {kind:"affliction", id, name, slug, traits, save:{type,dc}, maxDuration, onset, stages:[{damage, conditions, duration}]}
 */
export function parseAffliction({ id, name, slug = null, description, traits = [] }) {
  const text = stripHtml(description);
  let save = null;
  const check = /CHECK⟦(\w+)\|[^⟧]*?dc:(\d+)/i.exec(text);
  if ( check ) save = { type: check[1].toLowerCase(), dc: Number(check[2]) };
  else {
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
