/**
 * PF2e "Make it So": write one simulated outcome onto a token's actor, returning an undo record.
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
export function sideChange(final) {
  if ( final.swayed === "switched" ) return final.side === "friendly" ? "friendly" : "hostile";
  if ( final.side !== "neutralParty" || final.status === STATUS.DEAD ) return null;
  if ( final.against?.includes("friendly") ) return "hostile";
  return final.swayed === "neutral" ? "neutral" : null;
}
const DISPOSITIONS = { friendly: "FRIENDLY", hostile: "HOSTILE", neutral: "NEUTRAL" };

/** Human-readable list of what will change, for the confirmation dialog. */
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
    if ( used > 0 ) lines.push(outcomeLine("Uses", { n: used, what: resourceLabel(spec, key) }));
  }
  return lines;
}

function resourceLabel(spec, key) {
  const action = spec.actions.find(a => a.resource === key);
  if ( key === "focus" ) return t("FocusPoint");
  if ( key === "fate" ) return t("HeroPoint");
  if ( key.startsWith("slots:") ) return t("SlotRank", { rank: key.split(":")[2] });
  return action?.name ?? key;
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
 * @param {TokenDocument} tokenDoc
 * @param {object} spec
 * @param {object} final
 * @param {object} options  {lootMode: "corpse"|"pile"|"none", corpseMode: "keep"|"remove", fledMode: "hide"|"leave", sourceNames}
 */
export async function commitPf2eOutcome(tokenDoc, spec, final, options = {}) {
  const actor = tokenDoc.actor;
  const undo = {
    tokenUuid: tokenDoc.uuid, actorUuid: actor.uuid, actorUpdate: {}, itemUpdates: [], createdItems: [],
    deletedItems: [], tokenUpdate: null, createdActors: [], createdTokens: [], deletedTokens: [], statuses: []
  };
  const sys = actor.system;
  // PF2e adds linked conditions on its own (dying → unconscious → prone), so undo tracks every new item.
  const itemsBefore = new Set(actor.items.map(i => i.id));
  const update = {};
  const hp = sys.attributes.hp;
  if ( hp.value !== final.hp ) {
    update["system.attributes.hp.value"] = final.hp;
    undo.actorUpdate["system.attributes.hp.value"] = hp.value;
  }
  if ( (hp.temp ?? 0) !== final.temp ) {
    update["system.attributes.hp.temp"] = final.temp;
    undo.actorUpdate["system.attributes.hp.temp"] = hp.temp ?? 0;
  }
  // Focus points and spontaneous slots
  for ( const [key, start] of Object.entries(spec.resources ?? {}) ) {
    const left = final.resources?.[key] ?? start;
    if ( left === start ) continue;
    if ( key === "focus" ) {
      update["system.resources.focus.value"] = left;
      undo.actorUpdate["system.resources.focus.value"] = sys.resources?.focus?.value ?? start;
    } else if ( key === "fate" ) {
      update["system.resources.heroPoints.value"] = left;
      undo.actorUpdate["system.resources.heroPoints.value"] = sys.resources?.heroPoints?.value ?? start;
    }
  }
  if ( Object.keys(update).length ) await actor.update(update);

  await commitSpellsAndItems(actor, spec, final, undo);

  // Conditions
  if ( final.status === STATUS.DOWN ) {
    if ( final.dying > 0 ) await setCondition(actor, "dying", final.dying, undo);
    else await setCondition(actor, "unconscious", null, undo);
  }
  if ( final.wounded > (sys.attributes?.wounded?.value ?? 0) ) await setCondition(actor, "wounded", final.wounded, undo);
  if ( final.prone && final.status === STATUS.STANDING ) await setCondition(actor, "prone", null, undo);
  for ( const [k, v] of Object.entries(final.conditions ?? {}) ) {
    const slug = LINGERING[k];
    if ( slug && final.status !== STATUS.DEAD ) await setCondition(actor, slug, typeof v === "number" ? v : 1, undo);
  }

  // Persistent damage and afflictions (only matter for the living)
  if ( final.status !== STATUS.DEAD ) {
    const toCreate = [];
    for ( const p of final.persistent ?? [] ) {
      const cond = game.pf2e.ConditionManager.getCondition("persistent-damage").toObject();
      cond.system.persistent = { formula: partFormula(p.part), damageType: p.type, dc: 15, criticalHit: false };
      toCreate.push(cond);
    }
    for ( const a of final.afflictions ?? [] ) {
      toCreate.push({
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
      });
    }
    if ( toCreate.length ) {
      const created = await actor.createEmbeddedDocuments("Item", toCreate);
      undo.createdItems.push(...created.map(i => i.id));
    }
  }

  // Death, loot, fleeing
  if ( final.status === STATUS.DEAD ) {
    await actor.toggleStatusEffect("dead", { active: true, overlay: true });
    undo.statuses.push({ id: "dead", active: false, overlay: true });
    const combatant = game.combat?.getCombatantsByToken?.(tokenDoc)?.[0];
    if ( combatant && !combatant.defeated ) {
      await combatant.update({ defeated: true });
      undo.combatant = { uuid: combatant.uuid, defeated: false };
    }
    if ( spec.kind !== "pc" ) await handleLoot(tokenDoc, actor, options, undo);
  } else if ( final.status === STATUS.FLED && options.fledMode !== "leave" && spec.kind !== "pc" ) {
    undo.tokenUpdate = { hidden: tokenDoc.hidden };
    await tokenDoc.update({ hidden: true });
  } else if ( final.status === STATUS.SURRENDERED ) {
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
  const changed = sideChange(final);
  if ( changed ) {
    undo.actorUpdate["system.details.alliance"] = actor.system.details?.alliance ?? null;
    undo.tokenUpdate = { ...(undo.tokenUpdate ?? {}), disposition: tokenDoc.disposition };
    await actor.update({ "system.details.alliance": { friendly: "party", hostile: "opposition", neutral: null }[changed] });
    await tokenDoc.update({ disposition: CONST.TOKEN_DISPOSITIONS[DISPOSITIONS[changed]] });
  }
  await lingeringEffects(actor, final, options);
  const live = tokenDoc.actor ?? actor;
  for ( const item of live.items ) {
    if ( !itemsBefore.has(item.id) && !undo.createdItems.includes(item.id) ) undo.createdItems.push(item.id);
  }
  return undo;
}

/** Buffs and debuffs still running when the fight ends stay on: their Spell Effect, for the rounds left. */
async function lingeringEffects(actor, final, options) {
  for ( const e of final.effects ?? [] ) {
    const source = options?.effectSource?.(e.key);
    for ( const uuid of source?.action?.effectRef?.uuids ?? [] ) {
      let effect = null;
      try {
        effect = await fromUuid(uuid);
      } catch ( err ) { /* gone */ }
      if ( !effect ) continue;
      const data = effect.toObject();
      delete data._id;
      data.system = { ...data.system, duration: { value: Math.max(1, e.rounds), unit: "rounds", expiry: "turn-start", sustained: false } };
      if ( source.action.rank ) data.system.level = { ...(data.system.level ?? {}), value: source.action.rank };
      data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { lingering: true } };
      await actor.createEmbeddedDocuments("Item", [data]); // (Undo finds it among the items that weren't there before)
    }
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

