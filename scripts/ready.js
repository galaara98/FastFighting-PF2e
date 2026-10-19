/**
 * Getting ready, the PF2e way (the core's gear, API 20): what a weapon or a potion takes to get in hand, and in a live
 * battle each step a creature FastFighting plays takes to get ready (the core's readyGear), carried out on its sheet
 * as PF2e does it, with PF2e's own card:
 *  - draw: a weapon's own Draw, Retrieve or Pick Up (its Strike's auxiliary action: PF2e's Interact card, "Harsk draws
 *    their Heavy Crossbow"), with the hands it's held in (a heavy crossbow, two);
 *  - retrieve: an item got out (a potion), held in a hand (the actor's changeCarryType), with the Interact card PF2e
 *    writes for a Retrieve (its own templates and words);
 *  - reload: a round of the weapon's own ammunition loaded in it (its attach, as the sheet's Reload does), with the
 *    Interact card PF2e's Reload posts (8.6.1 posts it only from its reloader window, so it's written the same way:
 *    its templates and words);
 *  - stand: PF2e's own Stand action (its card; prone off).
 * Each returns the undo record of what it changed (Rewind puts it back), its cards the turn's.
 */
import { undoRecord, escapeHtml, inertHtml } from "./core.js";
import { strikesOf } from "./strike-roll.js";
import { ammoOf, ammoState, ammoUndo, nextAmmo, loadedOf } from "./ammo.js";

/** The core's gear key for one of an actor's items: the actor's id, then the item's. */
export const gearKey = (actor, item) => `${actor.id}.gear.${item.id}`;

/** The item a gear key names on this actor, or null. */
export function itemOfGear(actor, key) {
  const [actorId, kind, itemId] = String(key ?? "").split(".");
  if ( kind !== "gear" || actorId !== actor?.id ) return null;
  return actor.items?.get?.(itemId) ?? null;
}

/** What getting a Strike's weapon in hand takes: its auxiliary action's actions (a Draw, a Retrieve from a pack: 2). */
export function drawActions(strike) {
  const aux = (strike?.auxiliaryActions ?? []).find(a => ["draw", "retrieve", "pick-up"].includes(a?.annotation));
  return Math.max(1, Number(aux?.actions) || 1);
}

/**
 * What getting an item out takes, as PF2e reckons a Retrieve (its weapons' auxiliary action does it so): nothing held;
 * one action worn or dropped; stowed, one, or two from a backpack or a container held in a hand.
 */
export function retrieveActions(actor, item) {
  const carry = item?.system?.equipped?.carryType;
  if ( carry === "held" ) return 0;
  if ( carry !== "stowed" ) return 1;
  const container = actor?.items?.get?.(item.system?.containerId ?? "");
  const usage = container?.system?.usage;
  return usage?.type === "held" || usage?.where === "backpack" ? 2 : 1;
}

/**
 * Its gear as the sheet has it now (readLiveState's `gear`): each Strike's weapon in hand or not (PF2e's `ready`), and
 * what's loaded in what reloads; each healing potion in hand or not. Keys as the adapter gave them (gearKey).
 */
export function gearOnSheet(actor, { loaded = () => null } = {}) {
  const inHand = [];
  const out = [];
  const shots = {};
  if ( actor?.type === "character" ) {
    for ( const s of strikesOf(actor) ) {
      if ( !s.item?.id ) continue;
      const key = gearKey(actor, s.item);
      (s.ready === false ? out : inHand).push(key);
      const l = loaded(s.item);
      if ( l ) shots[key] = l.loaded;
    }
    for ( const item of actor.itemTypes?.consumable ?? [] ) {
      if ( item.system?.damage?.kind !== "healing" ) continue;
      (retrieveActions(actor, item) > 0 ? out : inHand).push(gearKey(actor, item));
    }
  }
  return { inHand: [...new Set(inHand)], out: [...new Set(out)].filter(k => !inHand.includes(k)), loaded: shots };
}

/** An item's equipped state and where it's kept, for its undo record. */
const carried = item => ({ "system.equipped": structuredClone(item.system?.equipped ?? {}), "system.containerId": item.system?.containerId ?? null });

/**
 * PF2e's Interact card as its Strike's auxiliary actions and its reloader write it (systems/pf2e/templates/chat/action:
 * the flavor's title, subtitle, glyph and manipulate trait; the content's image and message), in PF2e's own words
 * (`PF2E.Actions.Interact.<annotation>`).
 */
async function interactCard(actor, token, item, annotation, { glyph = 1, data = {}, secret = false } = {}) {
  const render = foundry.applications.handlebars.renderTemplate;
  const traits = [{ name: "manipulate", label: game.i18n.localize(CONFIG.PF2E?.actionTraits?.manipulate ?? "manipulate"), description: CONFIG.PF2E?.traitsDescriptions?.manipulate ?? null }];
  const flavor = await render("systems/pf2e/templates/chat/action/flavor.hbs", {
    action: { title: "PF2E.Actions.Interact.Title", subtitle: `PF2E.Actions.Interact.${annotation}.Title`, glyph: String(glyph) }, traits
  });
  // (The template puts its message in as HTML: the names in it escaped and inert, as the core's cards have them.)
  const name = s => inertHtml(escapeHtml(s));
  const named = Object.fromEntries(Object.entries({ actor: actor.name, weapon: item.name, ...data }).map(([k, v]) => [k, name(v)]));
  const content = await render("systems/pf2e/templates/chat/action/content.hbs", {
    imgPath: item.img, message: game.i18n.format(`PF2E.Actions.Interact.${annotation}.Description`, named)
  });
  const Message = ChatMessage.implementation;
  return Message.create({
    content, flavor, style: CONST.CHAT_MESSAGE_STYLES.EMOTE, speaker: Message.getSpeaker({ actor, token }),
    ...(secret ? { whisper: Message.getWhisperRecipients("GM").map(u => u.id) } : {})
  });
}

/** A weapon drawn: its Strike's own Draw (or Retrieve, or Pick Up) with the hands it needs, PF2e's card and all. */
async function draw(tokenDoc, actor, item, { hands = 1, secret = false } = {}) {
  const record = undoRecord(tokenDoc, actor, { statusesBefore: false });
  record.itemUpdates.push({ id: item.id, update: carried(item) });
  const strike = strikesOf(actor).find(s => s.item?.id === item.id);
  const auxes = (strike?.auxiliaryActions ?? []).filter(a => ["draw", "retrieve", "pick-up"].includes(a?.annotation));
  const want = hands >= 2 ? 2 : 1;
  const aux = auxes.find(a => Number(a.hands) === want) ?? auxes[0];
  if ( aux && typeof aux.execute === "function" && !secret ) await aux.execute();
  else {
    await actor.changeCarryType(item, { carryType: "held", handsHeld: want });
    await interactCard(actor, tokenDoc, item, `Draw${want}H`, { secret });
  }
  return record;
}

/** An item got out (a potion): held in a hand, with PF2e's Interact card for a Retrieve. */
async function retrieve(tokenDoc, actor, item, { secret = false } = {}) {
  const record = undoRecord(tokenDoc, actor, { statusesBefore: false });
  const glyph = retrieveActions(actor, item) || 1;
  record.itemUpdates.push({ id: item.id, update: carried(item) });
  await actor.changeCarryType(item, { carryType: "held", handsHeld: 1 });
  await interactCard(actor, tokenDoc, item, "Retrieve1H", { glyph, secret });
  return record;
}

/**
 * A Reload: one shot's rounds of the weapon's own ammunition loaded in it (its pick, else the stack with the most), as
 * the sheet's Reload does (its attach), with PF2e's Reload card. Nothing for a weapon whose ammunition PF2e doesn't
 * keep (a creature's attack), nor one with nothing to load.
 */
async function reload(tokenDoc, actor, weapon, { secret = false } = {}) {
  const how = ammoOf(actor, weapon);
  if ( !how || how.picked || typeof weapon.attach !== "function" ) return null;
  // (Full already: nothing to load.)
  const now = loadedOf(actor, weapon);
  if ( now && now.loaded >= now.capacity ) return null;
  const stack = nextAmmo(actor, weapon);
  if ( !stack || stack.id === weapon.ammo?.id ) return null;
  const before = ammoState(actor, weapon);
  const magazine = stack.type === "ammo" && Number(stack.system?.uses?.max) > 1;
  await weapon.attach(stack, { quantity: magazine ? 1 : Math.min(how.expend, Number(stack.system?.quantity) || 0), stack: true });
  const glyph = (weapon.system?.traits?.value ?? []).includes("repeating") ? 3 : Number(weapon.system?.reload?.value) || 1;
  await interactCard(actor, tokenDoc, weapon, "Reload", { glyph, data: { ammo: stack.name }, secret });
  return ammoUndo(tokenDoc, actor, before);
}

/** Up off the ground: PF2e's own Stand (its card; it takes prone off), else prone taken off. */
async function stand(tokenDoc, actor, { secret = false } = {}) {
  const record = undoRecord(tokenDoc, actor, { statusesBefore: false });
  const prone = (actor.itemTypes?.condition ?? []).filter(c => c.slug === "prone" && !c.isLocked);
  if ( !prone.length ) return null;
  record.deletedItems.push(...prone.map(c => c.toObject()));
  const action = game.pf2e?.actions?.get?.("stand");
  if ( action && !secret ) await action.use({ actors: [actor] });
  else for ( const c of prone ) await c.delete();
  return record;
}

/**
 * The core's readyGear (API 20): one step a creature FastFighting plays took to get ready, on its sheet. {records} or
 * null (nothing to do: what it names isn't there, or PF2e keeps nothing of it).
 * @param {TokenDocument} tokenDoc
 * @param {object} step   {step: "draw" | "retrieve" | "reload" | "stand", gear, hands, secret}
 */
export async function readyPf2eGear(tokenDoc, { step, gear = null, hands = 1, secret = false } = {}) {
  const actor = tokenDoc?.actor;
  if ( !actor ) return null;
  let record = null;
  if ( step === "stand" ) record = await stand(tokenDoc, actor, { secret });
  else {
    const item = itemOfGear(actor, gear);
    if ( !item ) return null;
    if ( step === "draw" ) record = item.system?.equipped?.carryType === "held" ? null : await draw(tokenDoc, actor, item, { hands, secret });
    else if ( step === "retrieve" ) record = item.system?.equipped?.carryType === "held" ? null : await retrieve(tokenDoc, actor, item, { secret });
    else if ( step === "reload" ) record = await reload(tokenDoc, actor, item, { secret });
  }
  return record ? { records: [record] } : null;
}
