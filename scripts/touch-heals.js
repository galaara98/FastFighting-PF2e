/**
 * A champion's touch that heals one kind of creature and harms the other, by slug (the review ledger has each): its
 * healing and its harm are only in the spell's variants (its overlays: PF2e's "(Healing)" and "(Vs. Undead)" buttons),
 * never in its own damage, and the effect its text links is no buff for the caster. Read the generic way, the spell
 * would be only that effect: a buff the champion lays on itself. So it's built as what it does:
 *  - a heal by touch (the core's kind "heal", `reach` 5), so many hit points at the rank it's cast at (its healing
 *    variant's formula, heightened as the variant says), for whom it mends (its trait: vitality the living, void the
 *    undead: iwr.js healsIt). Lay on Hands also lays its linked effect's bonus (+2 AC, 1 round) on anyone it heals but
 *    the champion (`ward`: the core's outcome `notSelf`, API 21), that effect on the sheet (`effectRef`).
 *  - a touch that harms the other kind (`<id>.harm`, a basic save: its harming variant's damage and save), and on a
 *    failure what `failed` says (a status penalty to AC, 1 round). The engine keeps that penalty itself: the core lays a
 *    save rider's outcome by its label, not as the spell's effect.
 * Left out: Touch of the Void's +2 to the champion's own damage rolls when it heals itself (no outcome for oneself alone).
 * Pure: no Foundry globals.
 */
import { parseFormula, part } from "./core.js";

/**
 * The touches, by slug: `ward`, whether the linked effect's bonus goes to another it heals (never the caster); `failed`,
 * what a failed save against its harm lays (its numbers, as the spell says them).
 */
export const TOUCH_HEALS = Object.freeze({
  __proto__: null,
  "lay-on-hands": Object.freeze({ ward: true, failed: Object.freeze({ ac: -2 }) }),
  "touch-of-the-void": Object.freeze({ ward: false, failed: Object.freeze({ ac: -2 }) })
});

/** A part's dice and number added `times` over (a heightened formula's steps). */
function addTo(p, more, times) {
  const out = { ...p, dice: p.dice.map(d => ({ ...d })) };
  for ( const d of more.dice ) {
    const own = out.dice.find(x => x.faces === d.faces && (x.mult ?? 1) === (d.mult ?? 1));
    if ( own ) own.n += d.n * times;
    else out.dice.push({ ...d, n: d.n * times });
  }
  out.flat += more.flat * times;
  return out;
}

/**
 * A spell's variant of a kind ("healing", or "damage"), as its overlays have it, at the rank it's cast at: {id (the
 * overlay's), parts (one part, `type` the variant's damage type, or "healing" for a heal), save ({statistic, basic}, or
 * null)}; null where it has none. Heightened as the variant says ("interval": its formula once more for each so many
 * ranks above the spell's own).
 * @param {object} system   the spell's system data
 * @param {string} kind     "healing" or "damage"
 * @param {number} rank     the rank it's cast at
 */
export function variantOf(system, kind, rank) {
  const base = Number(system?.level?.value) || 1;
  for ( const [id, overlay] of Object.entries(system?.overlays ?? {}) ) {
    const entry = Object.entries(overlay?.system?.damage ?? {}).find(([, d]) => (Array.isArray(d?.kinds) ? d.kinds : ["damage"]).includes(kind));
    if ( !entry ) continue;
    const [key, damage] = entry;
    let p = parseFormula(String(damage.formula ?? ""), kind === "healing" ? "healing" : String(damage.type ?? "untyped"));
    const h = overlay.system.heightening;
    const every = Number(h?.interval) || 0;
    const steps = h?.type === "interval" && every > 0 ? Math.max(0, Math.floor(((Number(rank) || base) - base) / every)) : 0;
    if ( steps && h.damage?.[key] ) p = addTo(p, parseFormula(String(h.damage[key])), steps);
    if ( !p.dice.length && !(p.flat > 0) ) continue;
    const save = overlay.system.defense?.save ?? null;
    return { id, parts: [part(p.dice, p.flat, p.type)], save: save?.statistic ? { statistic: save.statistic, basic: !!save.basic } : null };
  }
  return null;
}

/**
 * The overlay a touch heal's action shows and rolls: the harm's for its `.harm` use, the heal's for the rest (an id of
 * the adapter's: `<actor>.spell.<spell id>` or `<actor>.spell.<spell id>.harm`); null for any other spell, or one with
 * damage of its own.
 * @param {object} spell   {slug, system}
 * @param {string} actionId
 */
export function touchOverlay(spell, actionId) {
  const slug = spell?.slug ?? spell?.system?.slug;
  if ( !TOUCH_HEALS[slug] || Object.keys(spell?.system?.damage ?? {}).length ) return null;
  const harm = String(actionId ?? "").endsWith(".harm");
  return variantOf(spell.system, harm ? "damage" : "healing", spell.rank ?? spell.system?.level?.value ?? 1)?.id ?? null;
}

/**
 * A touch heal's actions (above), or [] where its variants say nothing it can use.
 * @param {object} t
 * @param {string} t.slug
 * @param {object} t.system       the spell's system data
 * @param {number} t.rank         the rank it's cast at
 * @param {object} t.base         what every action of the spell carries: {id, name, cost, resource, pool, spellId,
 *                                rank, traits, hands}
 * @param {number} t.dc           the spell DC
 * @param {object} [t.ward]       the linked effect's bonuses ({mods}), for another it heals (Lay on Hands), or null
 * @param {object} [t.effectRef]  the linked effect, for the sheet ({uuids})
 * @param {string} [t.label]      the bonuses in words (describeMods'), and the penalty's
 * @param {string} [t.failedLabel]
 * @param {string} [t.storyType]  how its harm looks (the adapter's storyLook)
 */
export function touchHealActions({ slug, system, rank, base, dc, ward = null, effectRef = undefined, label = "", failedLabel = "", storyType = undefined }) {
  const touch = TOUCH_HEALS[slug];
  if ( !touch ) return [];
  const out = [];
  const heal = variantOf(system, "healing", rank);
  if ( heal ) {
    const mods = touch.ward && ward?.mods && Object.keys(ward.mods).length ? ward.mods : null;
    out.push({
      ...base, kind: "heal", heal: heal.parts, reach: 5,
      ...(mods ? { outcome: { mods: { ...mods }, rounds: 1, label, notSelf: true }, effectRef } : {})
    });
  }
  const harm = variantOf(system, "damage", rank);
  if ( harm?.save ) {
    out.push({
      ...base, id: `${base.id}.harm`, kind: "save", damage: harm.parts, melee: true, reach: 5, range: null, storyType,
      save: { type: harm.save.statistic, dc, basic: harm.save.basic },
      effects: [{ kind: "condition", mods: { ...touch.failed }, rounds: 1, label: failedLabel, critOnly: false }]
    });
  }
  return out;
}
