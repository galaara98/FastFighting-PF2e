/**
 * Pathfinder 2e adapter: reads PF2e actors into CombatantSpecs and commits outcomes back.
 * Data paths verified against pf2e 8.6.0 on Foundry v14.
 */
import { SystemAdapter, parseTypedFormula, parseFormula } from "./core.js";
import { pf2eRules } from "./rules.js";
import { parseAffliction } from "./afflictions.js";
import { derivePf2eTraits } from "./traits.js";
import { rankLeaders } from "./leadership.js";
import { commitPf2eOutcome, describePf2eOutcome } from "./commit.js";

const PRONE_EFFECTS = new Set(["knockdown", "improved-knockdown", "trip", "improved-trip"]);
const GRAB_EFFECTS = new Set(["grab", "improved-grab"]);
const AFFLICTION_TRAITS = new Set(["poison", "disease", "curse"]);
const HEAL_SPELLS_TWO_ACTION_BONUS = new Set(["heal", "heal-animal", "heal-companion"]);
const SPEED_KEYS = { land: "walk", fly: "fly", swim: "swim", climb: "climb", burrow: "burrow" };

function slugOf(item) {
  const slug = item?.slug ?? item?.system?.slug;
  if ( slug ) return slug;
  return item?.name ? item.name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : null;
}

function parseActionCost(time) {
  const t = String(time ?? "").trim().toLowerCase();
  if ( /^\d$/.test(t) ) return Number(t);
  if ( t === "1 to 3" || t === "1 or 2" || t === "2 or 3" ) return 2;
  return null; // reactions, free actions, minutes...
}

function parseFeet(text) {
  const m = /(\d+)\s*(?:feet|foot|ft)/i.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** Rough number of enemies caught by an area. */
function areaTargets(area, targetText) {
  if ( /1 or 2 creatures/i.test(targetText ?? "") ) return 2;
  const n = /up to (\d+) creatures/i.exec(targetText ?? "");
  if ( n ) return Number(n[1]);
  if ( !area ) return 1;
  const size = Number(area.value) || 5;
  if ( area.type === "line" ) return size >= 60 ? 3 : 2;
  if ( area.type === "cone" ) return size >= 30 ? 3 : 2;
  if ( area.type === "emanation" ) return size >= 20 ? 3 : 2;
  return size >= 20 ? 4 : size >= 10 ? 3 : 2; // burst
}

export class Pf2eAdapter extends SystemAdapter {
  static systemId = "pf2e";

  get label() {
    return "Pathfinder 2e";
  }

  get rules() {
    return pf2eRules;
  }

  canHandle(actor) {
    return !!actor && ["character", "npc", "familiar"].includes(actor.type);
  }

  /* -------------------------------------------- */

  async toCombatantSpec(tokenDoc) {
    const actor = tokenDoc.actor;
    if ( !this.canHandle(actor) ) return null;
    const sys = actor.system;
    const hp = sys.attributes.hp ?? {};
    const level = actor.level ?? sys.details?.level?.value ?? 0;
    const traits = [...(sys.traits?.value ?? [])];
    const kind = actor.type === "character" ? "pc"
      : actor.type === "familiar" ? "companion"
        : traits.includes("minion") ? "minion" : "npc";

    const actions = [
      ...await this.#strikes(actor),
      ...await this.#spells(actor),
      ...this.#consumables(actor),
      ...this.#feats(actor)
    ];

    const speeds = {};
    for ( const [key, value] of Object.entries(sys.movement?.speeds ?? {}) ) {
      const mode = SPEED_KEYS[key];
      const v = typeof value === "number" ? value : value?.value;
      if ( mode && v > 0 ) speeds[mode] = v;
    }
    if ( !speeds.walk && !Object.keys(speeds).length ) speeds.walk = 25;

    const iwr = { immune: [], weak: {}, resist: {} };
    for ( const i of actor.attributes?.immunities ?? [] ) iwr.immune.push(i.type);
    for ( const w of actor.attributes?.weaknesses ?? [] ) iwr.weak[w.type] = w.value;
    for ( const r of actor.attributes?.resistances ?? [] ) iwr.resist[r.type] = r.value;

    const resources = {};
    for ( const a of actions ) if ( a.resource && a.pool !== undefined ) resources[a.resource] = a.pool;
    for ( const a of actions ) delete a.pool;

    const derived = this.deriveTraits(actor);
    const shield = sys.attributes?.shield;
    return {
      id: tokenDoc.id,
      tokenId: tokenDoc.id,
      actorId: actor.id,
      actorUuid: actor.uuid,
      name: tokenDoc.name ?? actor.name,
      img: tokenDoc.texture?.src ?? actor.img,
      kind,
      level,
      hp: { value: hp.value ?? 0, max: hp.max ?? 1, temp: hp.temp ?? 0 },
      defenses: {
        ac: sys.attributes?.ac?.value ?? 10,
        fortitude: actor.saves?.fortitude?.mod ?? level + 5,
        reflex: actor.saves?.reflex?.mod ?? level + 5,
        will: actor.saves?.will?.mod ?? level + 5
      },
      shield: shield?.ac > 0 && !shield.broken && !shield.destroyed ? { ac: shield.ac, hardness: shield.hardness } : null,
      initiative: { mod: actor.initiative?.mod ?? actor.perception?.mod ?? 0, stealth: actor.skills?.stealth?.mod ?? 0 },
      speeds,
      actions,
      iwr,
      resources,
      traits: Object.fromEntries(Object.entries(derived.traits).map(([k, v]) => [k, { base: v, fudge: 0 }])),
      traitReasons: derived.reasons,
      flags: { ...derived.flags, masterActorId: actor.type === "familiar" ? sys.master?.id ?? null : null },
      diesAtZero: actor.type !== "character",
      wounded: sys.attributes?.wounded?.value ?? 0,
      doomed: sys.attributes?.doomed?.value ?? 0,
      dying: sys.attributes?.dying?.value ?? 0,
      creatureTraits: traits,
      social: {
        diplomacy: actor.skills?.diplomacy?.mod,
        intimidation: actor.skills?.intimidation?.mod,
        deception: actor.skills?.deception?.mod,
        willDC: actor.saves?.will?.dc?.value ?? (level + 15),
        perceptionDC: actor.perception?.dc?.value ?? (level + 15),
        languages: [...(sys.details?.languages?.value ?? [])],
        mindless: traits.includes("mindless")
      },
      leadership: this.#leadershipEntry(actor, tokenDoc.id)
    };
  }

  /* -------------------------------------------- */

  async #strikes(actor) {
    const out = [];
    const pack = this.#bonusDice(actor, "pack-attack");
    const sneak = this.#sneakAttackDice(actor);
    const strikes = (actor.system.actions ?? []).filter(s => s.type === "strike" && s.visible !== false);
    for ( const [index, s] of strikes.entries() ) {
      const item = s.item;
      let normal = null;
      let crit = null;
      try {
        normal = await s.damage?.({ getFormula: true });
        crit = await s.critical?.({ getFormula: true });
      } catch ( err ) {
        console.warn(`fast-fighting | could not read damage for ${actor.name} ${s.label}`, err);
      }
      const damage = normal ? parseTypedFormula(normal) : [];
      const effects = this.#attackEffects(actor, item);
      if ( !damage.length && !effects.length ) continue;
      const traits = item?.system?.traits?.value ?? [];
      const ranged = !!item?.isRanged;
      const range = item?.range ?? item?.system?.range ?? null;
      const reachTrait = traits.find(t => /^reach(-\d+)?$/.test(t));
      const reach = reachTrait ? (Number(reachTrait.split("-")[1]) || 10) : (Number(item?.reach) || 5);
      const reload = Number(traits.find(t => t.startsWith("reload-"))?.split("-")[1]) || 0;
      const primaryType = damage[0]?.type ?? "untyped";

      const bonusDamage = [];
      if ( pack && !ranged ) bonusDamage.push({ when: "pack", allies: 2, parts: [parseFormula(pack, primaryType)] });
      const sneakEligible = actor.type !== "character" || ranged || traits.includes("agile") || traits.includes("finesse");
      if ( sneak && sneakEligible ) bonusDamage.push({ when: "offGuard", parts: [{ ...parseFormula(sneak, primaryType), category: "precision" }] });

      out.push({
        id: `${actor.id}.strike.${s.slug ?? index}.${index}`,
        name: s.label,
        kind: "strike",
        cost: 1 + reload,
        bonus: s.totalModifier ?? 0,
        maps: traits.includes("agile") ? [0, -4, -8] : [0, -5, -10],
        melee: !ranged,
        reach,
        range: ranged && range ? { increment: range.increment ?? range.max ?? 30, max: range.max ?? (range.increment ?? 30) * 6 } : null,
        damage,
        critDamage: crit ? parseTypedFormula(crit) : null,
        effects,
        bonusDamage,
        drawCost: s.ready === false && actor.type === "character" ? 1 : 0,
        traits
      });
    }
    return out;
  }

  #attackEffects(actor, item) {
    const effects = [];
    for ( const slug of item?.system?.attackEffects?.value ?? [] ) {
      const source = actor.items.find(i => slugOf(i) === slug);
      const traits = source?.system?.traits?.value ?? [];
      if ( source && traits.some(t => AFFLICTION_TRAITS.has(t)) ) {
        const parsed = parseAffliction({
          id: `${actor.id}.${slug}`,
          name: source.name,
          slug,
          description: source.system.description?.value,
          traits
        });
        if ( parsed ) effects.push(parsed);
      } else if ( PRONE_EFFECTS.has(slug) ) effects.push({ kind: "prone" });
      else if ( GRAB_EFFECTS.has(slug) ) effects.push({ kind: "grabbed" });
    }
    return effects;
  }

  /** Dice from an ability's description, e.g. Pack Attack "an extra 1d4 damage". */
  #bonusDice(actor, slug) {
    const item = actor.items.find(i => slugOf(i) === slug);
    if ( !item ) return null;
    const m = /(\d+d\d+)/.exec(item.system.description?.value ?? "");
    return m?.[1] ?? null;
  }

  #sneakAttackDice(actor) {
    const item = actor.items.find(i => slugOf(i) === "sneak-attack");
    if ( !item ) return null;
    if ( actor.type === "character" ) {
      const level = actor.level ?? 1;
      return `${level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1}d6`;
    }
    return /(\d+d\d+)/.exec(item.system.description?.value ?? "")?.[1] ?? null;
  }

  /* -------------------------------------------- */

  async #spells(actor) {
    const out = [];
    const focusPool = actor.system.resources?.focus?.value ?? 0;
    const entries = actor.spellcasting?.regular ?? actor.spellcasting?.contents ?? [];
    for ( const entry of entries ) {
      const stat = entry.statistic;
      if ( !stat ) continue;
      const mode = entry.system?.prepared?.value;
      for ( const spell of entry.spells?.contents ?? [] ) {
        const cost = parseActionCost(spell.system.time?.value);
        if ( !cost ) continue;
        let roll = null;
        try {
          roll = (await spell.getDamage())?.template?.damage?.roll ?? null;
        } catch ( err ) {
          continue;
        }
        if ( !roll ) continue;
        const kinds = roll.kinds ?? new Set();
        const traits = spell.system.traits?.value ?? [];
        const parts = parseTypedFormula(roll.formula);
        if ( !parts.length ) continue;

        // Resource
        let resource = null;
        let pool;
        let uses;
        if ( spell.isCantrip ) resource = null;
        else if ( spell.isFocusSpell ) { resource = "focus"; pool = focusPool; }
        else if ( mode === "prepared" ) {
          let count = 0;
          for ( const [key, slot] of Object.entries(entry.system.slots ?? {}) ) {
            if ( key === "slot0" ) continue;
            count += (slot.prepared ?? []).filter(p => p.id === spell.id && !p.expended).length;
          }
          if ( !count ) continue;
          resource = `prep:${entry.id}:${spell.id}`;
          pool = count;
        } else if ( mode === "spontaneous" ) {
          const rank = spell.rank;
          resource = `slots:${entry.id}:${rank}`;
          pool = entry.system.slots?.[`slot${rank}`]?.value ?? 0;
        } else if ( mode === "innate" ) {
          uses = spell.system.location?.uses?.value ?? 1;
        }
        const id = `${actor.id}.spell.${spell.id}`;
        const rangeFeet = parseFeet(spell.system.range?.value);
        const area = spell.system.area;
        const isHeal = kinds.has?.("healing") && traits.includes("healing");

        if ( isHeal ) {
          let heal = parts.map(p => ({ ...p, type: "healing" }));
          if ( HEAL_SPELLS_TWO_ACTION_BONUS.has(spell.slug) && cost === 2 ) {
            heal = heal.map((p, i) => i === 0 ? { ...p, flat: p.flat + 8 * (spell.rank ?? 1) } : p);
          }
          const animalOnly = /animal/i.test(spell.system.target?.value ?? "");
          out.push({
            id, name: spell.name, kind: "heal", cost, heal, resource, pool, uses, spellId: spell.id, entryId: entry.id, rank: spell.rank,
            targetTrait: animalOnly ? "animal" : null
          });
          continue;
        }
        if ( !kinds.has?.("damage") ) continue;

        const defense = spell.system.defense;
        const action = {
          id, name: spell.name, cost, damage: parts, resource, pool, uses,
          spellId: spell.id, entryId: entry.id, rank: spell.rank, traits,
          melee: false,
          range: { increment: rangeFeet ?? area?.value ?? 30, max: rangeFeet ?? area?.value ?? 30, noPenalty: true }
        };
        if ( /touch/i.test(spell.system.range?.value ?? "") ) {
          action.melee = true;
          action.reach = 5;
          action.range = null;
        }
        const targets = areaTargets(area, spell.system.target?.value);
        if ( targets > 1 ) action.area = { targets };
        if ( spell.isAttack ) {
          action.kind = "spell-attack";
          action.bonus = stat.check?.mod ?? 0;
          action.maps = [0, -5, -10];
        } else if ( defense?.save ) {
          action.kind = "save";
          action.save = { type: defense.save.statistic, dc: stat.dc?.value ?? 10 + level(actor), basic: !!defense.save.basic };
        } else {
          action.kind = "auto";
          if ( spell.slug === "force-barrage" ) action.damage = parts.map(p => ({ ...p, dice: p.dice.map(d => ({ ...d, n: d.n * 2 })), flat: p.flat * 2 }));
        }
        out.push(action);
      }
    }
    return out;
  }

  #consumables(actor) {
    const out = [];
    for ( const item of actor.itemTypes?.consumable ?? [] ) {
      const dmg = item.system.damage;
      if ( dmg?.kind !== "healing" || !dmg.formula ) continue;
      const quantity = (item.system.quantity ?? 1) * Math.max(1, item.system.uses?.max ?? 1);
      if ( quantity <= 0 ) continue;
      out.push({
        id: `${actor.id}.item.${item.id}`,
        name: item.name,
        kind: "heal",
        cost: 1,
        heal: [parseFormula(dmg.formula, "healing")],
        resource: `item:${item.id}`,
        pool: quantity,
        selfOnly: true,
        itemId: item.id
      });
    }
    return out;
  }

  #feats(actor) {
    const out = [];
    const medicine = actor.skills?.medicine;
    if ( actor.items.some(i => slugOf(i) === "battle-medicine") && medicine ) {
      const rank = medicine.rank ?? 1;
      const [dc, bonus] = rank >= 4 ? [40, 50] : rank >= 3 ? [30, 30] : rank >= 2 ? [20, 10] : [15, 0];
      out.push({
        id: `${actor.id}.feat.battle-medicine`,
        name: "Battle Medicine",
        kind: "heal",
        cost: 1,
        heal: [{ dice: [{ n: 2, faces: 8, mult: 1 }], flat: bonus, type: "healing", persistent: false, category: null }],
        healCheck: { mod: medicine.mod, dc },
        oncePerTarget: true
      });
    }
    return out;
  }

  /* -------------------------------------------- */

  deriveTraits(actor) {
    const abilities = actor.items.filter(i => ["action", "feat"].includes(i.type)).map(slugOf).filter(Boolean);
    return derivePf2eTraits({
      type: actor.type,
      level: actor.level ?? 0,
      traits: actor.system.traits?.value ?? [],
      int: actor.system.abilities?.int?.mod ?? 0,
      wis: actor.system.abilities?.wis?.mod ?? 0,
      will: actor.saves?.will?.mod,
      abilities,
      hasMaster: actor.type === "familiar"
    });
  }

  #leadershipEntry(actor, id) {
    const skills = actor.skills ?? {};
    return {
      id,
      level: actor.level ?? 0,
      skills: {
        diplomacy: skills.diplomacy?.mod,
        intimidation: skills.intimidation?.mod,
        warfareLore: skills["warfare-lore"]?.mod
      },
      isCommander: actor.class?.slug === "commander",
      tactics: actor.itemTypes?.action?.filter(i => i.system.traits?.value?.includes("tactic")).length ?? 0,
      abilityNames: actor.itemTypes?.action?.map(i => i.name) ?? []
    };
  }

  detectLeaders(specs) {
    return rankLeaders(specs.map(s => s.leadership).filter(Boolean));
  }

  difficultyCrossCheck(friendly, hostile) {
    const calc = game.pf2e?.gm?.calculateXP;
    const pcs = friendly.filter(s => s.kind === "pc");
    if ( !calc || !pcs.length || !hostile.length ) return null;
    const partyLevel = Math.round(pcs.reduce((s, p) => s + p.level, 0) / pcs.length);
    try {
      const result = calc(partyLevel, pcs.length, hostile.filter(h => h.kind !== "hazard").map(h => h.level), [], {
        proficiencyWithoutLevel: game.pf2e.settings?.variants?.pwol?.enabled ?? false
      });
      return { label: result.rating, xp: result.totalXP, partyLevel, budgets: result.encounterBudgets };
    } catch ( err ) {
      console.warn("fast-fighting | calculateXP failed", err);
      return null;
    }
  }

  /* -------------------------------------------- */

  async commitOutcome(tokenDoc, spec, final, options) {
    return commitPf2eOutcome(tokenDoc, spec, final, options);
  }

  describeOutcome(spec, final) {
    return describePf2eOutcome(spec, final);
  }
}

function level(actor) {
  return actor.level ?? 0;
}
