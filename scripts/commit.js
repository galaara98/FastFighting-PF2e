/**
 * PF2e: write a live battle's turn onto a token's actor (commitPf2eChanges), returning an undo record.
 *
 * Undo record shape (consumed by foundry/make-it-so.js):
 *   { tokenUuid, actorUuid, actorUpdate, itemUpdates: [{id, update}], createdItems: [id], deletedItems: [data],
 *     tokenUpdate, createdActors: [uuid], createdTokens: [uuid], deletedTokens: [data], statuses: [{id, active}] }
 */
import { MODULE_ID, STATUS, commonOutcome, outcomeLine, stillLine } from "./core.js";
import { t, traitName, conditionLabel } from "./words.js";

const PHYSICAL = new Set(["weapon", "armor", "equipment", "consumable", "treasure", "backpack", "shield", "ammo", "book"]);
const LINGERING = { clumsy: "clumsy", enfeebled: "enfeebled", drained: "drained", sickened: "sickened", stupefied: "stupefied", fatigued: "fatigued", doomed: "doomed", controlled: "controlled" };

function partFormula(p) {
  const dice = p.dice.map(d => `${d.mult && d.mult !== 1 ? `${d.mult}*` : ""}${d.n}d${d.faces}`);
  const flat = p.flat ? [String(p.flat)] : [];
  return [...dice, ...flat].join("+").replace(/\+-/g, "-") || "1";
}

/**
 * Whose side the token is on after the fight, when words (or a quarrel) changed it: won over (switched sides), talked
 * out of the fight (it takes no side now), or a neutral that turned on the party. Null when nothing changed.
 * @returns {"friendly"|"hostile"|"neutral"|null}
 */
function sideChange(final) {
  if ( final.swayed === "switched" ) return final.side === "friendly" ? "friendly" : "hostile";
  if ( final.side !== "neutralParty" || final.status === STATUS.DEAD ) return null;
  if ( final.against?.includes("friendly") ) return "hostile";
  return final.swayed === "neutral" ? "neutral" : null;
}
const DISPOSITIONS = { friendly: "FRIENDLY", hostile: "HOSTILE", neutral: "NEUTRAL" };

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
    if ( used > 0 ) lines.push(outcomeLine("Uses", { n: used, what: resourceName(key, { one: true }) ?? spec.actions.find(a => a.resource === key)?.name ?? key }));
  }
  return lines;
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

/** An affliction's effect item, as a fight lays it. */
function afflictionItem(a) {
  return {
    type: "effect",
    name: t("Affliction.Name", { name: a.name, stage: a.stage }),
    img: "icons/svg/poison.svg",
    system: {
      description: { value: t("Affliction.Description", { when: a.onset > 0 ? t("Affliction.Onset", { n: a.onset, stage: a.stage }) : t("Affliction.Stage", { stage: a.stage }), save: a.save, dc: a.dc }) },
      badge: { type: "counter", value: a.stage },
      duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
      tokenIcon: { show: true }
    },
    flags: { [MODULE_ID]: { affliction: a } }
  };
}

/**
 * A live battle: one turn's changes (the core's engine/changes.js) written onto a token, and only those, so writing
 * them twice changes nothing more. Hit points, Hero Points and Focus as they now stand; the slots and items used this
 * turn (`spec` is read afresh each turn, so what it says is what was there at the turn's start); conditions set and
 * taken off; new persistent damage and afflictions; a death (and its loot), running, surrendering, a change of side.
 * @returns {Promise<object>} an undo record (make-it-so.js revertRecord takes it back)
 */
export async function commitPf2eChanges(tokenDoc, spec, changes, final, options = {}) {
  const actor = tokenDoc.actor;
  const undo = {
    tokenUuid: tokenDoc.uuid, actorUuid: actor.uuid, actorUpdate: {}, itemUpdates: [], createdItems: [],
    deletedItems: [], tokenUpdate: null, createdActors: [], createdTokens: [], deletedTokens: [], statuses: []
  };
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
      await item.update({ name: t("Affliction.Name", { name: a.name, stage: a.stage }), "system.badge.value": a.stage, [`flags.${MODULE_ID}.affliction`]: a });
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
  const side = changes.side ? sideChange(final) : null;
  if ( side ) {
    undo.actorUpdate["system.details.alliance"] = actor.system.details?.alliance ?? null;
    undo.tokenUpdate = { ...(undo.tokenUpdate ?? {}), disposition: tokenDoc.disposition };
    await actor.update({ "system.details.alliance": { friendly: "party", hostile: "opposition", neutral: null }[side] });
    await tokenDoc.update({ disposition: CONST.TOKEN_DISPOSITIONS[DISPOSITIONS[side]] });
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

const emptyRecord = (tokenDoc, actor) => ({
  tokenUuid: tokenDoc?.uuid ?? null, actorUuid: actor.uuid, actorUpdate: {}, itemUpdates: [], createdItems: [], deletedItems: [],
  tokenUpdate: null, createdActors: [], createdTokens: [], deletedTokens: [], statuses: []
});

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

/** Coin items as they are now, to work out what a coin transfer changed. */
const coinSnapshot = actor => new Map(actor.itemTypes.treasure.filter(i => i.isCurrency).map(i => [i.id, i.toObject()]));

/** An undo record for whatever happened to an actor's coins since `before`. */
function coinUndo(tokenDoc, actor, before) {
  const undo = emptyRecord(tokenDoc, actor);
  const after = coinSnapshot(actor);
  for ( const id of after.keys() ) if ( !before.has(id) ) undo.createdItems.push(id);
  for ( const [id, data] of before ) {
    if ( !after.has(id) ) undo.deletedItems.push(data);
    else if ( after.get(id).system.quantity !== data.system.quantity ) undo.itemUpdates.push({ id, update: { "system.quantity": data.system.quantity } });
  }
  return undo;
}

/** Copper split into coins, largest first, without platinum (what people actually hand over). */
function coinsFor(copper) {
  const gp = Math.floor(copper / 100);
  const sp = Math.floor((copper % 100) / 10);
  return { gp, sp, cp: copper % 10 };
}

/**
 * Hand over what a creature was talked into giving up: coins (with change made) or one item, from the giver to
 * the talker. Returns undo records for both sides.
 */
export async function commitPf2eConcession(giverDoc, receiverDoc, concession) {
  const giver = giverDoc?.actor;
  if ( !giver?.inventory ) return [];
  const receiver = receiverDoc?.actor?.inventory ? receiverDoc.actor : null;
  const records = [];
  if ( concession.kind === "money" ) {
    const amount = Math.min(concession.amount, giver.inventory.currency.copperValue);
    if ( amount <= 0 ) return [];
    const coins = coinsFor(amount);
    const before = coinSnapshot(giver);
    const removed = await giver.inventory.removeCoins(coins, { byValue: true });
    if ( removed === false ) return [];
    records.push(coinUndo(giverDoc, giver, before));
    if ( receiver ) {
      const got = coinSnapshot(receiver);
      await receiver.inventory.addCoins(coins);
      records.push(coinUndo(receiverDoc, receiver, got));
    }
    return records;
  }
  const item = giver.items.get(concession.item?.id);
  if ( !item ) return [];
  const giverUndo = emptyRecord(giverDoc, giver);
  const data = item.toObject();
  delete data._id;
  data.system.quantity = 1;
  data.system.containerId = null;
  data.system.equipped = { carryType: "worn", handsHeld: 0, inSlot: false };
  if ( item.quantity > 1 ) {
    giverUndo.itemUpdates.push({ id: item.id, update: { "system.quantity": item.quantity } });
    await item.update({ "system.quantity": item.quantity - 1 });
  } else {
    giverUndo.deletedItems.push(item.toObject());
    await item.delete();
  }
  records.push(giverUndo);
  if ( receiver ) {
    const receiverUndo = emptyRecord(receiverDoc, receiver);
    const [created] = await receiver.createEmbeddedDocuments("Item", [data]);
    if ( created ) receiverUndo.createdItems.push(created.id);
    records.push(receiverUndo);
  }
  return records;
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
  const pileActor = await Actor.create({
    name: game.i18n.format("FFPF2E.Remains", { name: tokenDoc.name }),
    type: "loot",
    img: "icons/containers/bags/sack-leather-brown.webp",
    system: { lootSheetType: "Loot" },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
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

