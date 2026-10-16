/**
 * What a creature can do in PF2e about what bothers it (the core's behavior/holds.js remediesOf, and a friend's help):
 *  - Persistent damage (the Player Core's assisted recovery): two actions that would reasonably help against its source
 *    let it try one more flat check before the end of its turn. Dropping and rolling against fire is particularly
 *    appropriate help (the flat check's DC lowered to 10, and it lands prone); pressing a bleed or scraping off acid,
 *    the usual DC 15. Nothing else helps (persistent poison, mental or void damage ...).
 *  - A bleed, stopped by a friend's Administer First Aid (two actions, trained in Medicine): Medicine against the DC of
 *    what caused the bleed; a success lets it try an assisted recovery at once, at the lower DC for particularly
 *    appropriate help. Not played: a critical failure's damage (its bleed again, at once).
 *  - Sickened: retching (one action), a Fortitude save against the DC of the effect that sickened it; a success lowers
 *    it by 1, a critical success by 2.
 * The rules (rules.js) play them: persistentRemedy, persistentRemedyCost, holds, untieCost, breakFree and remedies.
 * Pure, unit-tested.
 */
import { levelDC } from "./holds.js";

/** Assisted recovery, by damage type: the flat check's DC, and what doing it leaves it (prone, after dropping and rolling). */
export const ASSISTED = Object.freeze({
  fire: Object.freeze({ dc: 10, prone: true }),
  bleed: Object.freeze({ dc: 15 }),
  acid: Object.freeze({ dc: 15 })
});

/** The flat check's DC for help that's particularly appropriate (Administer First Aid's, against a bleed). */
export const APPROPRIATE_DC = 10;

/** How badly being sickened bothers a creature (the core's remedy annoyance, 0 to 100): so much, and so much more a step. */
export const SICK_ANNOYANCE = Object.freeze({ base: 25, step: 10 });

/** The best save DC among a creature's actions (its spells', its abilities'), or null. */
const bestDC = spec => {
  const dcs = (spec?.actions ?? []).map(a => Number(a.save?.dc)).filter(Number.isFinite);
  return dcs.length ? Math.max(...dcs) : null;
};

/**
 * The DC of the effect that sickened it: the save of the action that laid it, else its source's best save DC; an
 * affliction's own; else the GM Core's DC for the level of whoever laid it (or its own, with no one known).
 */
export function sickDC(run, u) {
  const staged = (u.afflictions ?? []).find(a => !(a.onsetLeft > 0) && Number(a.spec?.stages?.[a.stage - 1]?.conditions?.sickened) > 0);
  if ( Number.isFinite(staged?.spec?.save?.dc) ) return staged.spec.save.dc;
  const e = [...(u.effects ?? [])].reverse().find(x => !x.onlyVs && Number(x.conditions?.sickened) > 0);
  const by = e?.sourceId ? run.byId?.get(e.sourceId) : null;
  const own = by?.spec?.actions?.find(a => a.id === e.key);
  return Number(own?.save?.dc) || bestDC(by?.spec) || levelDC(by?.spec?.level ?? u.spec?.level ?? 0);
}

/** The DC to stop a bleed (Administer First Aid): what caused it, as the GM Core's DC for its source's level (or its own). */
export function bleedDC(run, u, entry) {
  const by = entry?.sourceId ? run.byId?.get(entry.sourceId) : null;
  return levelDC(by?.spec?.level ?? u.spec?.level ?? 0);
}

/**
 * A condition's value lowered by `by` where it comes from (its effects, what it started with), as PF2e has one value of
 * each; an affliction's stage that has it keeps it. Its conditions as they now stand (u.conds) worked out with it.
 */
export function lower(u, key, by) {
  const value = Math.max(0, (Number(u.conds?.[key]) || 0) - by);
  const cap = c => {
    if ( !(key in c) ) return;
    if ( value > 0 ) c[key] = Math.min(Number(c[key]) || 1, value);
    else delete c[key];
  };
  u.effects = (u.effects ?? []).flatMap(e => {
    if ( e.onlyVs || !(key in (e.conditions ?? {})) ) return [e];
    const conditions = { ...e.conditions };
    cap(conditions);
    const rest = Object.keys(conditions).length || e.mods || e.mark?.length || e.iwr || e.boost || e.taunt || e.uses || e.fastHealing || e.regen;
    return rest ? [{ ...e, conditions }] : [];
  });
  if ( u.baseConds ) cap(u.baseConds);
  const staged = Math.max(0, ...(u.afflictions ?? []).filter(a => !(a.onsetLeft > 0)).map(a => Number(a.spec?.stages?.[a.stage - 1]?.conditions?.[key]) || 0));
  const left = Math.max(value, staged);
  u.conds ??= {};
  if ( left > 0 ) u.conds[key] = left;
  else delete u.conds[key];
  return left;
}
