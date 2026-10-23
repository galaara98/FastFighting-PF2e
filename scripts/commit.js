/**
 * PF2e: write a live battle's turn onto a token's actor (commitPf2eChanges), returning an undo record; and a player's
 * damage card applied through PF2e's own damage application (applyPf2eDamageCard).
 *
 * Undo record shape (consumed by foundry/make-it-so.js):
 *   { tokenUuid, actorUuid, actorUpdate, itemUpdates: [{id, update}], createdItems: [id], deletedItems: [data],
 *     tokenUpdate, createdActors: [uuid], createdTokens: [uuid], deletedTokens: [data], statuses: [{id, active}] }
 *   A damage card's also: createdEffects: [id], statusesBefore: [id], combatant: {uuid, defeated}.
 */
import { MODULE_ID, STATUS, commonOutcome, outcomeLine, stillLine, sideAfter, statusesOf, undoRecord, escapeHtml, inertHtml } from "./core.js";
import { takePf2eGoods, putPf2eGoods } from "./goods.js";
import { t, traitName, conditionLabel } from "./words.js";
import { damageRollOf, heals, itemOf, listOf } from "./read-turn.js";
import { timesOf } from "./cards.js";
import { grantedResistance } from "./granted.js";
import { spendRounds } from "./ammo.js";

const PHYSICAL = new Set(["weapon", "armor", "equipment", "consumable", "treasure", "backpack", "shield", "ammo", "book"]);
const LINGERING = { clumsy: "clumsy", enfeebled: "enfeebled", drained: "drained", sickened: "sickened", stupefied: "stupefied", fatigued: "fatigued", doomed: "doomed", controlled: "controlled" };

function partFormula(p) {
  const dice = p.dice.map(d => `${d.mult && d.mult !== 1 ? `${d.mult}*` : ""}${d.n}d${d.faces}`);
  const flat = p.flat ? [String(p.flat)] : [];
  return [...dice, ...flat].join("+").replace(/\+-/g, "-") || "1";
}

/** An undo record with nothing in it yet (the core's; no statuses kept from before: PF2e's conditions are items). */
const emptyRecord = (tokenDoc, actor) => undoRecord(tokenDoc, actor, { statusesBefore: false });

/** What a fight changes on a creature, for the summary of the fight (the planner's). */
export function describePf2eOutcome(spec, final) {
  // (Hit points, its fate and a change of side: the core's words.)
  const lines = commonOutcome(spec, final);
  if ( final.status === STATUS.DOWN ) lines.push(final.dying > 0 ? outcomeLine("Dying", { n: final.dying }) : outcomeLine("Unconscious"));
  if ( final.wounded > (spec.wounded ?? 0) ) lines.push(outcomeLine("Wounded", { n: final.wounded }));
  for ( const p of final.persistent ?? [] ) lines.push(outcomeLine("Persistent", { formula: partFormula(p.part), type: traitName(p.type) }));
  for ( const a of final.afflictions ?? [] ) lines.push(a.onset > 0 ? outcomeLine("AfflictionOnset", { name: a.name, n: a.onset, stage: a.stage }) : outcomeLine("Affliction", { name: a.name, stage: a.stage }));
  for ( const [k, v] of Object.entries(final.conditions ?? {}) ) if ( LINGERING[k] ) lines.push(conditionLabel(k, v));
  for ( const e of final.effects ?? [] ) lines.push(stillLine(e));
  for ( const [key, start] of Object.entries(spec.resources ?? {}) ) {
    const used = start - (final.resources?.[key] ?? start);
    if ( used > 0 ) lines.push(outcomeLine("Uses", { n: used, what: resourceName(key, { one: true }) ?? ammoName(key, spec) ?? spec.actions.find(a => a.resource === key)?.name ?? key }));
  }
  return lines;
}

/** A weapon's rounds (a key the core's action.ammo names): its ammunition's name, else its own; null for another key. */
export function ammoName(key, spec) {
  if ( !String(key).startsWith("ammo:") ) return null;
  const shot = (spec?.actions ?? []).find(a => a.ammo === key);
  return shot ? shot.ammoName ?? shot.name ?? null : null;
}

/**
 * A resource pool's name in PF2e's words, or null where the action that spends it names it. `one`: one of it, as
 * counted ("2× Hero Point"); without, the pool ("Hero Points").
 */
export function resourceName(key, { one = false } = {}) {
  if ( key === "fate" ) return t(one ? "HeroPoint" : "HeroPoints");
  if ( key === "focus" ) return t("FocusPoint");
  if ( key.startsWith("slots:") ) return t("SlotRank", { rank: key.split(":")[2] });
  return null;
}

async function setCondition(actor, slug, value, undo) {
  const existing = actor.itemTypes.condition.find(c => c.slug === slug && !c.isLocked);
  if ( existing ) {
    const before = existing.value;
    if ( before === value ) return;
    undo.itemUpdates.push({ id: existing.id, update: { "system.value.value": before } });
    await game.pf2e.ConditionManager.updateConditionValue(existing.id, actor, value);
    return;
  }
  const created = await actor.increaseCondition(slug, typeof value === "number" ? { value, max: value } : {});
  if ( created ) undo.createdItems.push(created.id);
}

/**
 * The engine's condition keys that aren't PF2e's own slugs. (Its "incapacitated" has none: losing the turn to Command
 * isn't Unconscious, which has a key of its own.)
 */
const PF2E_SLUGS = { offGuard: "off-guard" };

/** The engine's key for a PF2e condition slug ("off-guard": offGuard, "persistent-damage": persistentDamage). */
export const engineKey = slug => (slug === "off-guard" ? "offGuard" : String(slug).replace(/-([a-z])/g, (m, c) => c.toUpperCase()));

/** The PF2e condition slug for an engine key, or null for one the system doesn't have (the engine's alone). */
export function conditionSlug(key) {
  const slug = PF2E_SLUGS[key] ?? key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
  try {
    return game.pf2e?.ConditionManager?.getCondition(slug) ? slug : null;
  } catch ( err ) {
    return null;
  }
}

/** Take a condition off (its own item, not one another condition or effect holds in place). */
async function removeCondition(actor, slug, undo) {
  for ( const c of actor.itemTypes.condition.filter(i => i.slug === slug && !i.isLocked) ) {
    undo.deletedItems.push(c.toObject());
    await c.delete();
  }
}

/**
 * Is an affliction's DC for the table to see? As PF2e shows a check's DC: when its setting shows every DC, or when the
 * one it's from is a player's (an affliction's id starts with its giver's actor id).
 */
function dcShown(a) {
  if ( game.pf2e?.settings?.metagame?.dcs ) return true;
  return !!game.actors?.get(String(a.id ?? "").split(".")[0])?.hasPlayerOwner;
}

/** A save's name as PF2e has it (CONFIG.PF2E.saves: fortitude, reflex, will), escaped for HTML; "" for anything else. */
export function saveName(key) {
  const label = typeof key === "string" && Object.hasOwn(globalThis.CONFIG?.PF2E?.saves ?? {}, key) ? CONFIG.PF2E.saves[key] : null;
  return label ? inertHtml(escapeHtml(game.i18n.localize(label))) : "";
}

/** An affliction's effect item, as a fight lays it (its description HTML: nothing in it from the affliction but numbers and PF2e's save name). */
export function afflictionItem(a) {
  const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const when = n(a.onset) > 0 ? t("Affliction.Onset", { n: n(a.onset), stage: n(a.stage) }) : t("Affliction.Stage", { stage: n(a.stage) });
  const save = saveName(a.save);
  return {
    type: "effect",
    name: t("Affliction.Name", { name: a.name, stage: n(a.stage) }),
    img: "icons/svg/poison.svg",
    system: {
      description: { value: dcShown(a) ? t("Affliction.Description", { when, save, dc: n(a.dc) }) : t("Affliction.DescriptionNoDc", { when, save }) },
      badge: { type: "counter", value: a.stage },
      duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
      tokenIcon: { show: true }
    },
    flags: { [MODULE_ID]: { affliction: { id: a.id } } }
  };
}

/**
 * A live battle: one turn's changes (the core's engine/changes.js) written onto a token, and only those, so writing
 * them twice changes nothing more. Hit points, Hero Points and Focus as they now stand; the slots and items used this
 * turn (`spec` is read afresh each turn, so what it says is what was there at the turn's start), and the rounds its
 * shots spent that PF2e's own Strike didn't (ammo.js spendRounds); conditions set and
 * taken off; new persistent damage and afflictions; a death (and its loot), running, surrendering, a change of side.
 * @returns {Promise<object>} an undo record (make-it-so.js revertRecord takes it back)
 */
export async function commitPf2eChanges(tokenDoc, spec, changes, final, options = {}) {
  const actor = tokenDoc.actor;
  const undo = emptyRecord(tokenDoc, actor);
  const itemsBefore = new Set(actor.items.map(i => i.id));
  const sys = actor.system;
  const hp = sys.attributes.hp;
  const update = {};
  const put = (path, value, before) => {
    update[path] = value;
    undo.actorUpdate[path] = before;
  };
  if ( changes.hp ) put("system.attributes.hp.value", changes.hp.to, hp.value);
  if ( changes.temp ) put("system.attributes.hp.temp", changes.temp.to ?? 0, hp.temp ?? 0);
  if ( changes.stamina && hp.sp ) put("system.attributes.hp.sp.value", changes.stamina.to ?? 0, hp.sp.value);
  if ( changes.resources?.focus ) put("system.resources.focus.value", changes.resources.focus.to, sys.resources?.focus?.value ?? 0);
  if ( changes.resources?.fate ) put("system.resources.heroPoints.value", changes.resources.fate.to, sys.resources?.heroPoints?.value ?? 0);
  if ( Object.keys(update).length ) await actor.update(update);
  if ( changes.resources ) await commitSpellsAndItems(actor, spec, final, undo);

  const dead = final.status === STATUS.DEAD;
  // Down: dying (or out cold); back up: neither.
  if ( !dead && final.status === STATUS.DOWN && (changes.fell || changes.dying) ) {
    if ( final.dying > 0 ) await setCondition(actor, "dying", final.dying, undo);
    else await setCondition(actor, "unconscious", null, undo);
  }
  if ( changes.revived ) {
    await removeCondition(actor, "dying", undo);
    await removeCondition(actor, "unconscious", undo);
  }
  if ( changes.wounded && final.wounded > (sys.attributes?.wounded?.value ?? 0) ) await setCondition(actor, "wounded", final.wounded, undo);
  if ( changes.prone && !dead ) {
    if ( changes.prone.to ) await setCondition(actor, "prone", null, undo);
    else await removeCondition(actor, "prone", undo);
  }
  if ( changes.conditions && !dead ) {
    for ( const [key, value] of Object.entries(changes.conditions.set) ) {
      const slug = conditionSlug(key);
      if ( !slug ) continue;
      const valued = !!game.pf2e.ConditionManager.getCondition(slug)?.system?.value?.isValued;
      await setCondition(actor, slug, valued ? Math.max(1, Number(value) || 1) : null, undo);
    }
    for ( const key of changes.conditions.cleared ) {
      const slug = conditionSlug(key);
      if ( slug ) await removeCondition(actor, slug, undo);
    }
  }

  if ( !dead ) {
    const toCreate = [];
    for ( const p of changes.persistent ?? [] ) {
      const cond = game.pf2e.ConditionManager.getCondition("persistent-damage").toObject();
      cond.system.persistent = { formula: partFormula(p.part), damageType: p.type, dc: 15, criticalHit: false };
      toCreate.push(cond);
    }
    for ( const a of changes.afflictions?.added ?? [] ) toCreate.push(afflictionItem(a));
    if ( toCreate.length ) {
      const created = await actor.createEmbeddedDocuments("Item", toCreate);
      undo.createdItems.push(...created.map(i => i.id));
    }
    // (An affliction moved on a stage: its item says so; one that ended goes.)
    for ( const a of changes.afflictions?.changed ?? [] ) {
      const item = actor.itemTypes.effect.find(i => i.getFlag(MODULE_ID, "affliction")?.id === a.id);
      if ( !item ) continue;
      undo.itemUpdates.push({ id: item.id, update: { name: item.name, "system.badge.value": item.system.badge?.value ?? 1, [`flags.${MODULE_ID}.affliction`]: item.getFlag(MODULE_ID, "affliction") } });
      await item.update({ name: t("Affliction.Name", { name: a.name, stage: a.stage }), "system.badge.value": a.stage, [`flags.${MODULE_ID}.affliction`]: { id: a.id } });
    }
  }
  for ( const id of changes.afflictions?.ended ?? [] ) {
    for ( const item of actor.itemTypes.effect.filter(i => i.getFlag(MODULE_ID, "affliction")?.id === id) ) {
      undo.deletedItems.push(item.toObject());
      await item.delete();
    }
  }
  if ( !dead ) {
    for ( const e of changes.effects?.added ?? [] ) await laySpellEffect(actor, e, options, undo);
    // (Who got what, where no card of PF2e's names it.)
    await tellGiven(tokenDoc, spec, changes, options);
  }
  for ( const e of changes.effects?.ended ?? [] ) await liftSpellEffect(actor, e, undo);

  if ( changes.died ) {
    await actor.toggleStatusEffect("dead", { active: true, overlay: true });
    undo.statuses.push({ id: "dead", active: false, overlay: true });
    const combatant = game.combat?.getCombatantsByToken?.(tokenDoc)?.[0];
    if ( combatant && !combatant.defeated ) {
      await combatant.update({ defeated: true });
      undo.combatant = { uuid: combatant.uuid, defeated: false };
    }
    if ( spec.kind !== "pc" ) await handleLoot(tokenDoc, actor, options, undo);
  } else if ( changes.status?.to === STATUS.FLED && options.fledMode !== "leave" && spec.kind !== "pc" ) {
    undo.tokenUpdate = { hidden: tokenDoc.hidden };
    await tokenDoc.update({ hidden: true });
  } else if ( changes.status?.to === STATUS.SURRENDERED ) {
    const [effect] = await actor.createEmbeddedDocuments("Item", [{
      type: "effect",
      name: game.i18n.localize("FFPF2E.Surrendered"),
      img: "icons/svg/cancel.svg",
      system: {
        description: { value: `<p>${game.i18n.localize("FFPF2E.SurrenderedHint")}</p>` },
        duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
        tokenIcon: { show: true }
      }
    }]);
    if ( effect ) undo.createdItems.push(effect.id);
  }
  // (A change of side: PF2e's alliance, which its token's disposition is drawn from. The core sets the disposition
  // itself, should the token not show it yet.)
  const side = changes.side ? sideAfter(final) : null;
  if ( side ) {
    undo.actorUpdate["system.details.alliance"] = actor.system.details?.alliance ?? null;
    await actor.update({ "system.details.alliance": { friendly: "party", hostile: "opposition", neutral: null }[side] });
  }
  // (PF2e adds linked conditions on its own: dying → unconscious → prone. Undo takes them off too.)
  const live = tokenDoc.actor ?? actor;
  for ( const item of live.items ) {
    if ( !itemsBefore.has(item.id) && !undo.createdItems.includes(item.id) ) undo.createdItems.push(item.id);
  }
  return undo;
}

/**
 * A buff or debuff laid this turn (Bless, Bane, Rage): its PF2e effect, from the action that laid it (options.effectSource),
 * for the rounds it has; marked with which it is, so it comes off when the engine's ends (liftSpellEffect). Only an
 * effect Item is copied (the link is item data a player can write).
 */
async function laySpellEffect(actor, e, options, undo) {
  const source = options?.effectSource?.(e.key);
  for ( const uuid of source?.action?.effectRef?.uuids ?? [] ) {
    let effect = null;
    try {
      effect = await fromUuid(uuid);
    } catch ( err ) { /* gone */ }
    if ( effect?.documentName !== "Item" || effect.type !== "effect" ) continue;
    const data = effect.toObject();
    delete data._id;
    data.system = { ...data.system, duration: { value: Math.max(1, Number.isFinite(e.rounds) ? e.rounds : 10), unit: "rounds", expiry: "turn-start", sustained: false } };
    if ( source.action.rank ) data.system.level = { ...(data.system.level ?? {}), value: source.action.rank };
    data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { laid: { key: e.key, sourceId: e.sourceId ?? null } } };
    const [created] = await actor.createEmbeddedDocuments("Item", [data]);
    if ( created ) undo.createdItems.push(created.id);
  }
}

/** Does a roll of PF2e's own name whom an action's effect went to: a save's card, a check's or an attack's target? */
const rollNames = a => !!(a?.save || a?.check || a?.afflict?.save || a?.harm?.save || Number.isFinite(a?.bonus) || a?.kind === "strike" || a?.kind === "spell-attack");

/** An action that can go only to its user (Rage, a potion): its own card names whom it went to. */
const ownOnly = a => a?.targets === "self" || !!a?.selfOnly;

/**
 * A card naming who got which effect, from whoever gave it, after the action's own card: "Lay on Hands → Lem (+2 AC)".
 * For each effect laid this turn (the core's change set: `effects.added`, and `laid`, conditions an effect lays alone)
 * where no roll of PF2e's names whom it went to (a buff, a heal's bonus, a debuff with no save: the action's card is
 * its user's and names only who it may go to), and for each the table settles itself (`left`, API 21: a player's
 * character's at another, Apply players' damage off), waiting for its players to drag it from the action's card, which
 * links it. Not one an action only its user can take laid on itself. Its effect linked (draggable, as PF2e links an
 * applied effect), where the action has one. To whom the core says (options.audience: the GMs alone where the one who
 * gave it or the one who got it is hidden from the players); the name of one the players can't see, the GMs' alone.
 * Nothing without the core's options (an older core): no card.
 */
async function tellGiven(tokenDoc, spec, changes, options) {
  if ( typeof options?.tokenOf !== "function" || typeof options?.effectSource !== "function" ) return;
  const given = [
    ...[...(changes.effects?.added ?? []), ...(changes.laid ?? [])].map(e => ({ e, waits: false })),
    ...[...(changes.left?.effects ?? []), ...(changes.left?.laid ?? [])].map(e => ({ e, waits: true }))
  ];
  const Message = globalThis.CONFIG?.ChatMessage?.documentClass ?? globalThis.ChatMessage;
  for ( const { e, waits } of given ) {
    const source = options.effectSource(e.key);
    const action = source?.action;
    if ( !action || rollNames(action) || (ownOnly(action) && e.sourceId === spec.id) ) continue;
    const by = options.tokenOf(e.sourceId) ?? tokenDoc;
    const gm = [e.sourceId, spec.id].some(id => options.audience?.(id) === "gm");
    // (Whom it went to, as the players may name it: a name its nameplate doesn't show them, the GMs' alone.)
    const shown = gm || tokenDoc.actor?.hasPlayerOwner || tokenDoc.playersCanSeeName !== false || !globalThis.game?.pf2e?.settings?.tokens?.nameVisibility;
    const target = shown ? escapeHtml(tokenDoc.name ?? "") : `<span data-visibility="gm">${escapeHtml(tokenDoc.name ?? "")}</span>`;
    const words = t(waits ? "GivenWaits" : "Given", { action: escapeHtml(action.name ?? ""), target, effect: escapeHtml(e.label || action.name || "") });
    const link = await effectLink(action);
    try {
      await Message.create({
        speaker: Message.getSpeaker({ token: by, actor: by.actor }),
        content: inertHtml(`<p>${words}</p>${link ? `<p>${link}</p>` : ""}`),
        ...(gm ? { whisper: (globalThis.game?.users ?? []).filter(u => u.isGM).map(u => u.id) } : {})
      });
    } catch ( err ) {
      console.error(`${MODULE_ID} | naming who got ${action.name}`, err);
    }
  }
}

/** The effect an action lays, as a link to drag (PF2e's own anchor), or "" (none, or none found). */
async function effectLink(action) {
  for ( const uuid of action?.effectRef?.uuids ?? [] ) {
    let effect = null;
    try {
      effect = await fromUuid(uuid);
    } catch ( err ) { /* gone */ }
    if ( effect?.documentName === "Item" && effect.type === "effect" && typeof effect.toAnchor === "function" ) return effect.toAnchor({ attrs: { draggable: "true" } }).outerHTML;
  }
  return "";
}

/** A buff or debuff the engine ended (its time up, its caster's concentration broken): the effect it laid comes off. */
async function liftSpellEffect(actor, e, undo) {
  const ours = i => { const laid = i.getFlag(MODULE_ID, "laid"); return laid?.key === e.key && (laid.sourceId ?? null) === (e.sourceId ?? null); };
  for ( const item of actor.itemTypes.effect.filter(ours) ) {
    undo.deletedItems.push(item.toObject());
    await item.delete();
  }
}

async function commitSpellsAndItems(actor, spec, final, undo) {
  const entryUpdates = new Map();
  for ( const [key, start] of Object.entries(spec.resources ?? {}) ) {
    const left = final.resources?.[key] ?? start;
    const used = start - left;
    if ( used <= 0 ) continue;
    const [kind, a, b] = key.split(":");
    if ( kind === "prep" ) {
      const entry = actor.items.get(a);
      if ( !entry ) continue;
      const slots = foundry.utils.deepClone(entryUpdates.get(a) ?? entry._source.system.slots);
      let remaining = used;
      for ( const [slotKey, slot] of Object.entries(slots) ) {
        if ( slotKey === "slot0" ) continue;
        for ( const p of slot.prepared ?? [] ) {
          if ( remaining > 0 && p.id === b && !p.expended ) { p.expended = true; remaining -= 1; }
        }
      }
      entryUpdates.set(a, slots);
    } else if ( kind === "slots" ) {
      const entry = actor.items.get(a);
      if ( !entry ) continue;
      const slots = foundry.utils.deepClone(entryUpdates.get(a) ?? entry._source.system.slots);
      if ( slots[`slot${b}`] ) slots[`slot${b}`].value = left;
      entryUpdates.set(a, slots);
    } else if ( kind === "item" ) {
      const item = actor.items.get(a);
      if ( !item ) continue;
      const perItem = Math.max(1, item.system.uses?.max ?? 1);
      const quantity = Math.max(0, Math.ceil(left / perItem));
      if ( quantity <= 0 ) {
        undo.deletedItems.push(item.toObject());
        await item.delete();
      } else {
        undo.itemUpdates.push({ id: item.id, update: { "system.quantity": item.system.quantity } });
        await item.update({ "system.quantity": quantity });
      }
    } else if ( kind === "ammo" ) {
      // (A weapon's rounds: PF2e's Strike spends its own as it rolls; only what the engine's own dice shot, beyond that.)
      await spendRounds(actor, a, { start, spent: used }, undo);
    }
  }
  for ( const [entryId, slots] of entryUpdates ) {
    const entry = actor.items.get(entryId);
    undo.itemUpdates.push({ id: entryId, update: { "system.slots": foundry.utils.deepClone(entry._source.system.slots) } });
    await entry.update({ "system.slots": slots });
  }
}

/* -------------------------------------------- */
/*  Giving something up                         */
/* -------------------------------------------- */

/**
 * A live battle: a creature tied up (a prisoner, the core's engine/behavior/fallen.js), or no longer: PF2e's own
 * Restrained, as a condition item. An undo record, or null when nothing changed.
 */
export async function commitPf2eBound(tokenDoc, bound) {
  const actor = tokenDoc?.actor;
  if ( !actor ) return null;
  const undo = emptyRecord(tokenDoc, actor);
  const held = actor.itemTypes.condition.filter(c => c.slug === "restrained" && !c.isLocked);
  if ( bound && !held.length ) {
    const made = await actor.increaseCondition("restrained");
    if ( made ) undo.createdItems.push(made.id);
  } else if ( !bound && held.length ) {
    undo.deletedItems.push(...held.map(c => c.toObject()));
    await actor.deleteEmbeddedDocuments("Item", held.map(c => c.id));
  }
  return undo.createdItems.length || undo.deletedItems.length ? undo : null;
}

/**
 * A live battle: a player's damage card applied to one token as PF2e's own card applies it (Apply Damage, Half,
 * Double; Healing for a heal), `multiplier` times. PF2e doesn't export that (applyDamageFromMessage, which applies to
 * the selected tokens), so this is it for one token; PF2e's actor.applyDamage does the rest: immunities, weaknesses
 * and resistances, temporary HP, a raised shield (the card's Shield Block toggle, or `shieldBlock`: a live battle's
 * Shield Block reaction to a Strike FastFighting rolled), a friend's reaction's effect (`effect:<item id>`: friendsGrant),
 * persistent damage, its damage-taken card, and death at 0 HP by its Mark NPCs Dead at 0 HP setting. Returns an undo
 * record: everything as it was.
 * The same for a damage card FastFighting rolled in its own turn (rollStrike's, rollDamage's: a save's share, half or
 * double, by `multiplier`), times what the card's mark says (cards.js: a spell attack's critical hit, doubled).
 * @param {ChatMessage} message
 * @param {TokenDocument} tokenDoc
 * @param {object} given    {multiplier, shieldBlock, ["effect:<item id>"]: {by: the friend's TokenDocument}}
 */
export async function applyPf2eDamageCard(message, tokenDoc, given = {}) {
  const { shieldBlock = false } = given ?? {};
  const actor = tokenDoc?.actor;
  const roll = damageRollOf(message);
  const multiplier = Number(given?.multiplier ?? 1) * timesOf(message);
  if ( !actor || !roll || !(multiplier > 0) ) return [];
  const context = message.flags?.pf2e?.context ?? {};
  const healing = heals(roll, actor);
  const item = itemOf(message);
  const origin = message.actor ?? null;
  const options = listOf(context.options).filter(o => typeof o === "string");
  // (As PF2e has them: the card's own options, the origin's as seen from the target, the item's for an effect's damage.)
  const originOptions = options.filter(o => o.startsWith("self:")).map(o => o.replace(/^self\b/, "origin"));
  const itemOptions = item?.isOfType?.("affliction", "condition", "effect") ? item.getRollOptions("item") : [];
  if ( actor.alliance && origin ) options.push(`origin:${actor.alliance === origin.alliance ? "ally" : "enemy"}`);
  if ( !options.some(o => o.startsWith("target")) ) options.push(...actor.getSelfRollOptions("target"));
  const ephemeral = healing ? [] : [...await ephemeralEffects(origin, actor, item, options), ...await friendsGrant(actor, tokenDoc, given)];
  const clone = actor.getContextualClone(originOptions, ephemeral);
  const rollOptions = new Set([...options.filter(o => !/^(?:self|target)(?::|$)/.test(o)), ...itemOptions, ...originOptions, ...clone.getSelfRollOptions()]);
  const undo = undoRecord(tokenDoc, actor);
  const before = sheetNow(tokenDoc);
  await clone.applyDamage({
    damage: healing ? -multiplier * roll.total : roll.alter(multiplier, 0), token: tokenDoc, item, skipIWR: healing, rollOptions,
    shieldBlockRequest: !!shieldBlock || !!globalThis.CONFIG?.PF2E?.chatDamageButtonShieldToggle, outcome: context.outcome
  });
  shieldBlockOff(message.id);
  sinceThen(before, tokenDoc, undo);
  return [undo];
}

/**
 * What the one dealing the damage lays on its target as it lands (its EphemeralEffect rule elements on
 * damage-received), for the target's copy only: PF2e's extractEphemeralEffects, which it doesn't export.
 */
async function ephemeralEffects(origin, target, item, options) {
  if ( !origin || !target ) return [];
  const domains = ["damage-received"];
  const test = [...options, ...origin.getRollOptions(domains), ...target.getSelfRollOptions("target")];
  const resolvables = item ? (item.isOfType?.("spell") ? { spell: item } : { weapon: item }) : {};
  const makers = domains.flatMap(d => origin.synthetics?.ephemeralEffects?.[d]?.target ?? []);
  const effects = (await Promise.all(makers.map(make => make({ test, resolvables })))).filter(Boolean);
  for ( const e of effects ) {
    if ( e.type !== "effect" ) continue;
    e.system.context = { origin: { actor: origin.uuid, token: null, item: null, spellcasting: null, rollOptions: [] }, target: { actor: target.uuid, token: null }, roll: null };
    e.system.duration = { value: -1, unit: "unlimited", expiry: null, sustained: false };
  }
  return effects;
}

/**
 * What a friend's reaction grants the one it shields against this blow (the core's `applies` on a friend's reaction,
 * `effect:<its item's id>` with whose it is, {by: its token}): the effect its card links (granted.js: Champion's
 * Resistance from a Retributive Strike), as PF2e makes it when that link is dragged from the card onto the target: from
 * the friend (its origin, so "2 + level" is the champion's level, and Oath of the Defender's resistance grows with it),
 * the reaction's traits where it has none. Laid on the target's copy only, as PF2e lays its ephemeral effects: its
 * applyDamage resists the blow with it and its damage-taken card says so, and the sheet never holds it (nothing to take
 * off after, nothing for Rewind to undo). None found (the reaction gone from the friend's sheet, its effect from the
 * compendium): the blow lands as rolled, and the core counts what the sheet lost.
 */
async function friendsGrant(target, tokenDoc, given) {
  const out = [];
  const laid = new Set();
  for ( const [key, value] of Object.entries(given ?? {}) ) {
    const id = /^effect:(.+)$/.exec(key)?.[1];
    const friend = value?.by?.actor ?? null;
    const reaction = id ? friend?.items?.get?.(id) ?? null : null;
    const granted = reaction ? await grantedResistance(reaction) : null;
    if ( !granted || laid.has(granted.uuid) ) continue;
    laid.add(granted.uuid);
    const data = granted.effect.toObject();
    const traits = data.system?.traits?.value ?? [];
    const valid = globalThis.CONFIG?.PF2E?.effectTraits ?? {};
    data.system = {
      ...data.system,
      traits: { ...(data.system?.traits ?? {}), value: traits.length ? traits : (reaction.system?.traits?.value ?? []).filter(t => t in valid) },
      context: {
        origin: { actor: friend.uuid, token: value.by.uuid ?? null, item: reaction.uuid ?? null, spellcasting: null, rollOptions: reaction.getOriginData?.()?.rollOptions ?? [] },
        target: { actor: target.uuid, token: tokenDoc.uuid ?? null },
        roll: null
      },
      // (For this blow alone, as PF2e's ephemeral effects are.)
      duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }
    };
    out.push(data);
  }
  return out;
}

/** PF2e's Shield Block toggle, used by the damage it was on for: off again, as PF2e's own buttons leave it. */
function shieldBlockOff(messageId) {
  const config = globalThis.CONFIG?.PF2E;
  if ( config ) config.chatDamageButtonShieldToggle = false;
  const buttons = globalThis.document?.querySelectorAll?.(`li.chat-message[data-message-id="${messageId}"] button[data-action=shieldBlock]`) ?? [];
  for ( const b of buttons ) b.classList.remove("shield-activated");
}

/** Every value in an object by its path ("system.attributes.hp.value"); a list is one value. */
function leaves(obj, at, out = {}) {
  for ( const [k, v] of Object.entries(obj ?? {}) ) {
    const path = `${at}.${k}`;
    if ( v && typeof v === "object" && !Array.isArray(v) ) leaves(v, path, out);
    else out[path] = v;
  }
  return out;
}

/** What of `was` is no longer so in `now` (paths to values): each such path, as it was. */
function asWas(was, now) {
  return Object.fromEntries(Object.entries(was).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(now[k])));
}

/** A copy of a document's system data, as it is now. */
const systemNow = doc => JSON.parse(JSON.stringify(doc?._source?.system ?? {}));

/** What a damage card can change on a token's sheet, as it is now: its data, items, effects, death and the tracker's mark. */
function sheetNow(tokenDoc) {
  const actor = tokenDoc.actor;
  const combatant = tokenDoc.combatant ?? null;
  return {
    system: leaves(systemNow(actor), "system"),
    items: new Map(Array.from(actor.items ?? []).map(i => [i.id, i.toObject()])),
    effects: new Set(Array.from(actor.effects ?? []).map(e => e.id)),
    dead: statusesOf(actor).has("dead"),
    combatant: combatant ? { uuid: combatant.uuid, defeated: !!combatant.defeated } : null
  };
}

/**
 * Whatever a damage card changed on a token's sheet since `was`, into its undo record as it was: its HP, temporary HP
 * and Stamina (any of its data), its items' (a shield's HP, a condition's value), the items it made (persistent damage)
 * or took off, the effects it made (dead), and the tracker's Defeated. Dead again, if it was: PF2e lifts death from
 * one healed after the fact (unawaited), and statusesBefore puts back only what it lays.
 */
function sinceThen(was, tokenDoc, undo) {
  const actor = tokenDoc.actor;
  Object.assign(undo.actorUpdate, asWas(was.system, leaves(systemNow(actor), "system")));
  const items = new Map(Array.from(actor.items ?? []).map(i => [i.id, i]));
  for ( const [id, data] of was.items ) {
    const item = items.get(id);
    if ( !item ) {
      undo.deletedItems.push(data);
      continue;
    }
    const update = asWas(leaves(data.system, "system"), leaves(systemNow(item), "system"));
    if ( Object.keys(update).length ) undo.itemUpdates.push({ id, update });
  }
  for ( const id of items.keys() ) if ( !was.items.has(id) ) undo.createdItems.push(id);
  for ( const e of Array.from(actor.effects ?? []) ) if ( !was.effects.has(e.id) ) undo.createdEffects.push(e.id);
  if ( was.dead ) undo.statuses.push({ id: "dead", active: true, overlay: true });
  if ( was.combatant ) undo.combatant = was.combatant;
}

/**
 * Hand over what a creature gave up (talked out of it, robbed of it, a deal: the core's concession): coins (with change
 * made), or a thing, as many as it says (its count, one if it doesn't), from the giver to the receiver (none: gone).
 * Returns undo records for both sides.
 */
export async function commitPf2eConcession(giverDoc, receiverDoc, concession) {
  const taken = await takePf2eGoods(giverDoc, [concession]);
  return [...taken.records, ...(receiverDoc?.actor?.inventory ? await putPf2eGoods(receiverDoc, taken.goods) : [])];
}

async function handleLoot(tokenDoc, actor, options, undo) {
  const mode = options.lootMode ?? "corpse";
  if ( mode === "none" ) return;
  if ( mode === "corpse" ) {
    undo.actorUpdate["flags.pf2e.lootable"] = actor.flags.pf2e?.lootable ?? false;
    await actor.update({ "flags.pf2e.lootable": true });
    return;
  }
  // Loot pile: a PF2e loot actor at the corpse's position holding its physical gear, moved off the corpse so
  // nothing exists twice.
  const gear = actor.items.filter(i => PHYSICAL.has(i.type));
  const items = gear.map(i => {
    const data = i.toObject();
    delete data._id;
    if ( data.system?.equipped ) data.system.equipped = { carryType: "worn", handsHeld: 0, inSlot: false };
    return data;
  });
  if ( !items.length ) return;
  // (Named for it when its name shows to everyone, or it's a player's: else the players would learn it here.)
  const named = actor.hasPlayerOwner || [CONST.TOKEN_DISPLAY_MODES.ALWAYS, CONST.TOKEN_DISPLAY_MODES.HOVER].includes(tokenDoc.displayName);
  const pileActor = await Actor.create({
    name: named ? game.i18n.format("FFPF2E.Remains", { name: tokenDoc.name }) : game.i18n.localize("FFPF2E.RemainsUnnamed"),
    type: "loot",
    img: "icons/containers/bags/sack-leather-brown.webp",
    system: { lootSheetType: "Loot" },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
    // (FastFighting's: a Rewind takes it away with its token, and no battle takes it for a creature.)
    flags: { [MODULE_ID]: { pile: true } },
    items
  });
  undo.createdActors.push(pileActor.uuid);
  const [pileToken] = await tokenDoc.parent.createEmbeddedDocuments("Token", [{
    ...(await pileActor.getTokenDocument({ x: tokenDoc.x, y: tokenDoc.y, elevation: tokenDoc.elevation, level: tokenDoc.level }))
      .toObject(),
    actorLink: true,
    disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL
  }]);
  undo.createdTokens.push(pileToken.uuid);
  undo.deletedItems.push(...gear.map(i => i.toObject()));
  await actor.deleteEmbeddedDocuments("Item", gear.map(i => i.id));
  if ( options.corpseMode === "remove" ) {
    undo.deletedTokens.push({ parentUuid: tokenDoc.parent.uuid, data: tokenDoc.toObject() });
    await tokenDoc.delete();
  }
}

