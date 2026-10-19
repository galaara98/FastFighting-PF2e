/**
 * The engine's own dice as PF2e's own cards (the core's API 20 showTableRoll): a table roll FastFighting made itself in
 * a live battle, posted as PF2e posts that kind of roll.
 *  - An attack, a save, a check or a flat check: PF2e's check card, a CheckRoll with flags.pf2e.context ("attack-roll",
 *    "saving-throw", "skill-check" or "flat-check"): the engine's d20 (two, kept higher or lower, for fortune or
 *    misfortune) and modifier, its total; the title (the action's name, a save's name, what a flat check is for); the
 *    target, or whoever made it save, and the DC as PF2e's own Check shows it (its "target-dc-result" block: shown to the
 *    players as its Show DCs and Show Results settings and its NPC name visibility say); the outcome the engine's.
 *  - Damage and healing: PF2e's damage card, a DamageRoll whose instances are the roll's parts by type (a precision or
 *    splash part flavored inside its type, a critical hit's doubling written as PF2e writes it, `2 * (...)`), every
 *    die as it fell (damageFormula: PF2e parses the formula, the dice are filled in before it's evaluated, so nothing is
 *    rolled); flags.pf2e.context "damage-roll" with its target, its source (attack or save), the outcome of an attack,
 *    and the item it came from as its origin (a Strike's, a spell's, an ability's, by the adapter's ids). Persistent
 *    damage isn't on it (the engine lays that itself). Marked as FastFighting's (cards.js), so its Apply buttons are
 *    gone: FastFighting applies it (applyDamageCard: in a turn it plays, the core's "card" then "apply") or has written
 *    the engine's sum already.
 * Styling only: the engine's result stands, its dice exactly, and nothing PF2e does with the card changes it (a check
 * card has no Damage buttons and no Hero Point reroll). One card a roll, to whom the core says (`audience`: everyone, or
 * the GMs alone: "gm"). Anything else (a recharge, a crit table's die, a roll with no token): null, the core's plain roll.
 * The pure parts (damageFormula, checkFlavor, damageFlavor, resultBlock, checkContext) need no Foundry.
 */
import { localize, hasWords, rolledParts, rollJson, inertHtml } from "./core.js";
import { t } from "./words.js";
import { strikeFor } from "./strike-roll.js";
import { actionItem } from "./action-roll.js";
import { HELPER_ID } from "./cards.js";

/** PF2e's check card types, by the core's kind of roll. */
export const CHECK_TYPES = Object.freeze({ __proto__: null, attack: "attack-roll", save: "saving-throw", check: "skill-check", flat: "flat-check" });

/** PF2e's degrees of success, by the engine's (0 critical failure ... 3 critical success). */
export const DEGREES = Object.freeze(["criticalFailure", "failure", "success", "criticalSuccess"]);

/** PF2e's saves, by the keys the engine may name them with. */
const SAVES = Object.freeze({ __proto__: null, fortitude: "fortitude", fort: "fortitude", reflex: "reflex", ref: "reflex", will: "will" });

/** The parts of a damage type PF2e flavors inside it, after its plain dice and modifiers. */
const CATEGORIES = Object.freeze([null, "precision", "splash"]);

const escape = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** A word of PF2e's own, else `otherwise`. */
const sys = (key, data = null, otherwise = "") => (typeof key === "string" && hasWords(key) ? localize(key, data) : otherwise);

/** A number with its sign, as PF2e writes an offset ("+3", "-2", "+0"). */
const signed = n => `${n < 0 ? "-" : "+"}${Math.abs(n)}`;

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/** Terms joined as PF2e writes a sum: "1d8 + 4", "1d6 - 1". */
function joined(terms) {
  return terms.map((x, i) => (i === 0 ? `${x.sign < 0 ? "-" : ""}${x.text}` : `${x.sign < 0 ? " - " : " + "}${x.text}`)).join("");
}

/** PF2e's own test: does an expression need parentheses to be one term? */
const hasOperators = text => /[-+*/]/.test(text ?? "");

/**
 * One side of an instance (inside a critical's doubling, or outside it): its plain terms, then its precision and its
 * splash, each flavored as PF2e flavors them; its dice in the order the formula has them, onto `order`.
 */
function sectionOf(items, order) {
  const pieces = [];
  for ( const cat of CATEGORIES ) {
    const own = items.filter(x => x.cat === cat);
    if ( !own.length ) continue;
    for ( const x of own ) if ( x.die ) order.push(x.die);
    const text = joined(own);
    pieces.push(cat ? `${hasOperators(text) ? `(${text})` : text}[${cat}]` : text);
  }
  return pieces.join(" + ").replace(/ \+ -/g, " - ");
}

/**
 * A damage table roll as PF2e writes a damage roll's formula: `{instance,instance}`, an instance for each damage type
 * (its flavor the type, healing's "healing" with it, and the materials it's made of), its head the parts of that type:
 * its dice and modifiers, a precision or splash part flavored inside it, and a critical's doubled dice and modifiers as
 * `2 * (...)` (the rules' doubling; a die not doubled, a deadly die, after it). `dice`: each die term in the order the
 * formula has them, {faces, results}, to fill PF2e's parsed roll with. Null for a roll with no parts recorded.
 * @param {object} roll           the core's table roll (kind damage or healing)
 * @param {object} [options]      {damageTypes: PF2e's (CONFIG.PF2E.damageTypes), materials: [keys]}
 * @returns {{formula: string, dice: {faces: number, results: number[]}[]}|null}
 */
export function damageFormula(roll, { damageTypes = globalThis.CONFIG?.PF2E?.damageTypes ?? null, materials = [] } = {}) {
  const parts = rolledParts(roll);
  if ( !parts.length ) return null;
  const healing = roll.kind === "healing";
  const known = type => typeof type === "string" && (!damageTypes || Object.hasOwn(damageTypes, type));
  const byType = new Map();
  for ( const p of parts ) {
    const type = known(p.type) ? p.type : "untyped";
    const cat = CATEGORIES.includes(p.category) ? p.category : null;
    const list = byType.get(type) ?? byType.set(type, []).get(type);
    for ( const d of p.dice ) {
      if ( !d.results.length ) continue;
      list.push({ cat, mult: Number(d.mult) || 1, sign: d.sign < 0 ? -1 : 1, text: `${d.results.length}d${d.faces}`, die: { faces: d.faces, results: [...d.results] } });
    }
    const flat = Number(p.flat) || 0;
    if ( flat ) list.push({ cat, mult: null, sign: Math.sign(flat), value: Math.abs(flat) });
  }
  const instances = [];
  const dice = [];
  for ( const [type, items] of byType ) {
    // (A critical's doubling: the multiplier most of its doubled dice share; a modifier inside it where it divides.)
    const counts = new Map();
    for ( const x of items ) if ( x.die && x.mult !== 1 ) counts.set(x.mult, (counts.get(x.mult) ?? 0) + 1);
    const m = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const inside = [];
    const outside = [];
    for ( const x of items ) {
      if ( x.die ) {
        if ( m !== null && x.mult === m ) inside.push(x);
        else outside.push(x.mult === 1 ? x : { ...x, text: `${x.mult} * ${x.text}` });
      } else if ( m !== null && Number.isInteger(x.value / m) ) inside.push({ ...x, text: String(x.value / m) });
      else outside.push({ ...x, text: String(x.value) });
    }
    const order = [];
    const within = inside.length ? sectionOf(inside, order) : "";
    const without = outside.length ? sectionOf(outside, order) : "";
    let head = within ? `${m} * ${hasOperators(within) ? `(${within})` : within}` : "";
    if ( without ) head = head ? `${head} + ${without}`.replace(/ \+ -/g, " - ") : without;
    if ( !head ) continue;
    dice.push(...order);
    // (As PF2e writes an instance's head: a single die or number bare, anything else in parentheses.)
    const bare = /^\(.*\)$/.test(head) || /^\d+(d\d+)?$/.test(head);
    const flavor = [healing ? "healing" : null, healing && !["vitality", "void"].includes(type) ? null : type, ...materials].filter(Boolean);
    instances.push(`${bare ? head : `(${head})`}[${[...new Set(flavor)].join(",")}]`);
  }
  return instances.length ? { formula: `{${instances.join(",")}}`, dice } : null;
}

/**
 * A damage card's header, as PF2e's own (chat/action/header.hbs): the title, and an attack's outcome after it
 * ("(Critical Hit)"), its words PF2e's. Inert, as checkFlavor is.
 */
export function damageFlavor(title, outcome = null) {
  const words = outcome ? sys(`PF2E.Check.Result.Degree.Attack.${outcome}`) : "";
  const subtitle = words ? `<span class="subtitle degree-of-success">(<span class="${outcome}">${escape(words)}</span>)</span>` : "";
  return inertHtml(`<h4 class="action"><strong>${escape(title)}</strong>${subtitle}</h4>`);
}

/* -------------------------------------------- */
/*  Checks                                      */
/* -------------------------------------------- */

/** A tag of PF2e's DC and result lines (<opposer>, <dc> ...) made a span, as PF2e's own convertXMLNode makes it. */
function tagged(markup, tag, { visible = true, whose = null, classes = [] } = {}) {
  return markup.replace(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`), (all, inner) =>
    `<span${classes.length ? ` class="${classes.join(" ")}"` : ""}${visible ? "" : ' data-visibility="gm"'}${whose ? ` data-whose="${whose}"` : ""}>${inner}</span>`);
}

/**
 * A check's DC and result, as PF2e's own Check shows them (its target-dc-result block): "Target: Goblin (AC 18)" (or
 * "Origin: ..." for a save, or the DC alone), "Result: Hit by +3". Who sees what is PF2e's say: the opposer's name as
 * its nameplate shows it (`opposer.visible`), the DC to the players only against a character of theirs or with PF2e's
 * Show DCs setting (`dcVisible`), the result with its Show Results setting (`resultVisible`); the rest for the GMs.
 * @param {object} c   {degree, total, dc, dcType (its words: "AC"), scope ("Attack" or "Check"), opposer: {name,
 *                      visible} | null, targeting (an attack's or a check's target, not a save's origin), dcVisible,
 *                      resultVisible}
 * @returns {string} HTML, or "" with no DC or degree
 */
export function resultBlock({ degree, total, dc, dcType, scope = "Check", opposer = null, targeting = true, dcVisible = false, resultVisible = false }) {
  if ( !Number.isFinite(dc) || !DEGREES[degree] ) return "";
  const labels = globalThis.CONFIG?.PF2E?.checkDCs?.Label ?? {};
  const key = opposer ? (targeting ? labels.WithTarget ?? "PF2E.Check.DC.Label.WithTarget" : labels.WithOrigin ?? "PF2E.Check.DC.Label.WithOrigin") : labels.NoTarget ?? "PF2E.Check.DC.Label.NoTarget";
  let dcMarkup = sys(key, { dcType: escape(dcType), dc, opposer: escape(opposer?.name ?? "") });
  if ( opposer ) dcMarkup = tagged(dcMarkup, "opposer", { visible: !!opposer.visible, whose: "opposer" });
  dcMarkup = tagged(dcMarkup, "dc", { visible: !!dcVisible, whose: "opposer" });
  const words = sys(`PF2E.Check.Result.Degree.${scope}.${DEGREES[degree]}`);
  let result = sys("PF2E.Check.Result.Label", { unadjusted: escape(words), offset: signed(total - dc) });
  result = tagged(result, "unadjusted", { visible: !!resultVisible, classes: [DEGREES[degree]] });
  result = tagged(result, "offset", { visible: !!dcVisible, whose: "opposer" });
  // (Nothing of the DC the players may see: its line the GMs'; and nothing of the result either, all of it theirs.)
  const dcHidden = !opposer?.visible && !dcVisible;
  return `<div class="target-dc-result" data-tooltip-class="pf2e" data-tooltip-direction="UP"${dcHidden && !resultVisible ? ' data-visibility="gm"' : ""}>`
    + `<div class="target-dc"${dcHidden ? ' data-visibility="gm"' : ""}>${dcMarkup}</div>`
    + `<div class="result degree-of-success"${resultVisible ? "" : ' data-visibility="gm"'}>${result}</div></div>`;
}

/**
 * A check card's flavor, as PF2e's own Check writes it: its title, its DC and result, then the rule under them. PF2e
 * enriches a card's flavor: a name in it with [[...]] or @UUID[...] stays words (inertHtml), as on the core's cards.
 */
export const checkFlavor = (title, block = "") => inertHtml(`<h4 class="action"><strong>${escape(title)}</strong></h4>${block}<hr>`);

/** What a roll was for, in words the fight has: the action's name, else the core's word for it, else the core's flavor. */
function nameOf(roll, flavor = "") {
  if ( roll.label ) return roll.label;
  const what = roll.what ? `FASTFIGHTING.Rolls.What.${roll.what}` : null;
  return what && hasWords(what) ? localize(what) : flavor;
}

/** A check card's title: an attack's or a check's name, a save's (its name, else PF2e's "Reflex Saving Throw"), a flat check's. */
export function checkTitle(roll, flavor = "") {
  let title = nameOf(roll, flavor);
  const save = SAVES[roll.stat];
  if ( roll.kind === "save" && !roll.label && save ) {
    const saveName = sys(globalThis.CONFIG?.PF2E?.saves?.[save], null, save);
    title = sys("PF2E.SavingThrowWithName", { saveName }, title);
  }
  if ( roll.kind === "flat" ) title = title ? t("FlatCheckFor", { what: title }) : sys("PF2E.FlatCheck", null, flavor);
  return roll.rerolled ? localize("FASTFIGHTING.Rolls.Rerolled", { flavor: title }) : title;
}

/** The DC's statistic, as PF2e slugs it: AC for an attack, a save's own. */
const dcSlugOf = roll => (roll.kind === "attack" ? "armor" : roll.kind === "save" ? SAVES[roll.stat] ?? null : null);

/**
 * A check card's flags.pf2e.context, as PF2e's own Check writes one: whose roll, at whom (an attack's or a check's
 * target; a save's origin, the one who made it save, its target the one saving), the DC and the outcome.
 * @param {object} roll     the core's table roll
 * @param {object} c        {actorId, tokenId: the roller's; self, opposer: {actor, token} by uuid (the roller's, and
 *                           whom it was at or who made it save), or null; title; messageMode}
 */
export function checkContext(roll, { actorId = null, tokenId = null, self = null, opposer = null, title = "", messageMode = "public" } = {}) {
  const type = CHECK_TYPES[roll.kind] ?? "check";
  const saving = roll.kind === "save";
  const slug = dcSlugOf(roll);
  const outcome = DEGREES[roll.degree] ?? null;
  const keep = (roll.groups ?? []).find(g => g.faces === 20)?.keep ?? null;
  return {
    type, identifier: null, action: null, domains: domainsOf(roll), actor: actorId, token: tokenId,
    origin: saving ? opposer : self, target: saving ? self : opposer,
    options: [], contextualOptions: { postRoll: [] }, notes: [], messageMode,
    rollTwice: keep === "kh" ? "keep-higher" : keep === "kl" ? "keep-lower" : false,
    title, traits: [], substitutions: [],
    dc: Number.isFinite(roll.dc) ? { value: roll.dc, ...(slug ? { slug } : {}), ...(roll.kind === "flat" ? { visible: true } : {}) } : null,
    skipDialog: true, isReroll: false, outcome, unadjustedOutcome: outcome
  };
}

/** A check's domains, as PF2e's statistics name them. */
function domainsOf(roll) {
  if ( roll.kind === "attack" ) return ["attack", "attack-roll"];
  if ( roll.kind === "save" ) return ["saving-throw", ...(SAVES[roll.stat] ? [SAVES[roll.stat]] : [])];
  if ( roll.kind === "flat" ) return ["flat-check"];
  return ["skill-check"];
}

/* -------------------------------------------- */
/*  Posting (Foundry)                           */
/* -------------------------------------------- */

/** The item a roll's action came from (the adapter's ids: a Strike's, a spell's, an ability's), or null. */
function itemOf(actor, id) {
  if ( !actor || typeof id !== "string" || !id ) return null;
  const own = id.replace(/^reaction:/, "");
  try {
    return strikeFor(actor, own)?.item ?? actionItem(actor, own) ?? null;
  } catch ( err ) {
    return null;
  }
}

/** PF2e's settings, as its Check reads them (none read: the safe side, the GMs'). */
function pf2eSettings() {
  const s = globalThis.game?.pf2e?.settings ?? {};
  return { dcs: !!s.metagame?.dcs, results: !!s.metagame?.results, breakdowns: !!s.metagame?.breakdowns, nameVisibility: !!s.tokens?.nameVisibility };
}

/** A token as a check card's context names it. */
const refOf = doc => (doc?.actor ? { actor: doc.actor.uuid, token: doc.uuid } : null);

/** A message's speaker, as PF2e's own cards have it: the token, and its actor. */
function speakerOf(token) {
  const Message = globalThis.CONFIG?.ChatMessage?.documentClass ?? globalThis.ChatMessage;
  return Message.getSpeaker({ actor: token.actor, token });
}

/**
 * A check card (above): PF2e's CheckRoll from the engine's dice (the core's rollJson: its Die terms holding the d20s as
 * they fell, its modifier, its total), no Hero Point reroll (`isReroll`) and no Damage buttons, posted. Its id, or null.
 */
async function postCheck(roll, { token, target, audience, flavor, flags }) {
  const CheckRoll = globalThis.CONFIG?.Dice?.rolls?.find?.(r => r?.name === "CheckRoll");
  if ( !CheckRoll || !(roll.groups ?? []).some(g => g.faces === 20) || (roll.rolls?.length ?? 1) > 1 ) return null;
  const json = rollJson(roll);
  if ( !json ) return null;
  const settings = pf2eSettings();
  const actor = token.actor;
  const messageMode = audience === "gm" ? "gm" : "public";
  const check = CheckRoll.fromData({
    ...json, class: "CheckRoll",
    options: {
      type: CHECK_TYPES[roll.kind], identifier: null, action: null, domains: domainsOf(roll), isReroll: true, totalModifier: roll.mod ?? 0,
      damaging: false, rollerId: game.userId, degreeOfSuccess: DEGREES[roll.degree] ? roll.degree : null,
      showBreakdown: roll.kind === "flat" || settings.breakdowns || !!actor?.hasPlayerOwner
    }
  });
  const title = checkTitle(roll, flavor);
  // (Against whom: an attack's or a check's target; a save's origin.)
  const opposer = target?.actor ? target : null;
  const block = resultBlock({
    degree: roll.degree, total: roll.total, dc: roll.dc, scope: roll.kind === "attack" ? "Attack" : "Check",
    dcType: dcWords(dcSlugOf(roll)),
    opposer: opposer ? { name: opposer.name ?? opposer.actor.name ?? "", visible: !!opposer.playersCanSeeName || !settings.nameVisibility } : null,
    targeting: roll.kind !== "save", dcVisible: roll.kind === "flat" || !!opposer?.actor?.hasPlayerOwner || settings.dcs, resultVisible: settings.results
  });
  const item = itemOf(actor, roll.action) ?? itemOf(opposer?.actor, roll.action);
  const context = checkContext(roll, { actorId: actor?.id ?? null, tokenId: token.id ?? null, self: refOf(token), opposer: refOf(opposer), title, messageMode });
  const message = await check.toMessage({
    speaker: speakerOf(token), flavor: checkFlavor(title, block),
    flags: { ...flags, pf2e: { context, modifierName: title, modifiers: [], origin: item?.getOriginData?.() ?? null } }
  }, { messageMode });
  return message?.id ?? null;
}

/** A DC's statistic in PF2e's words: "AC", "Reflex DC"; else plain "DC". */
function dcWords(slug) {
  const dcs = globalThis.CONFIG?.PF2E?.checkDCs ?? {};
  return sys(dcs.Specific?.[slug], null, sys(dcs.Unspecific ?? "PF2E.Check.DC.Unspecific", null, "DC"));
}

/**
 * A damage card (above): PF2e's DamageRoll parsed from damageFormula, its dice filled in with the engine's before it's
 * evaluated (so it rolls none), marked as FastFighting's, posted. Its id, or null (a formula PF2e reads otherwise than
 * it was written: the core's plain roll).
 */
async function postDamage(roll, { token, target, audience, flavor, flags, materialsOf }) {
  const DamageRoll = globalThis.CONFIG?.Dice?.rolls?.find?.(r => r?.name === "DamageRoll");
  if ( !DamageRoll ) return null;
  const actor = token.actor;
  const item = itemOf(actor, roll.action);
  const materials = item?.isOfType?.("weapon", "melee") && typeof materialsOf === "function" ? materialsOf(item) ?? [] : [];
  const built = damageFormula(roll, { materials });
  if ( !built ) return null;
  const attack = roll.source === "attack";
  const outcome = attack ? (roll.crit ? "criticalSuccess" : "success") : null;
  const settings = pf2eSettings();
  const damage = new DamageRoll(built.formula, {}, {
    rollerId: game.userId, showBreakdown: settings.breakdowns || !!actor?.hasPlayerOwner, ...(outcome ? { degreeOfSuccess: DEGREES.indexOf(outcome) } : {})
  });
  // (PF2e's own dice terms, in the formula's order: each filled with the engine's results, so evaluating rolls nothing.)
  const terms = damage.dice ?? [];
  if ( terms.length !== built.dice.length || terms.some((d, i) => d.faces !== built.dice[i].faces || d.number !== built.dice[i].results.length) ) return null;
  terms.forEach((d, i) => { d.results = built.dice[i].results.map(result => ({ result, active: true })); });
  await damage.evaluate({ allowInteractive: false });
  const messageMode = audience === "gm" ? "gm" : "public";
  let title = nameOf(roll, flavor);
  if ( Number.isFinite(roll.multiplier) && roll.multiplier !== 1 ) title = localize("FASTFIGHTING.Rolls.Times", { flavor: title, n: roll.multiplier });
  if ( roll.rerolled ) title = localize("FASTFIGHTING.Rolls.Rerolled", { flavor: title });
  const at = refOf(target);
  const options = [...new Set([...(actor?.getSelfRollOptions?.("self") ?? []), ...(item?.getRollOptions?.("item") ?? [])])].sort();
  const context = {
    type: "damage-roll", sourceType: roll.source ?? null, actor: actor?.id ?? null, token: token.id ?? null, target: at,
    domains: [roll.kind === "healing" ? "healing" : "damage"], options, contextualOptions: {}, notes: [], secret: messageMode === "gm", messageMode,
    traits: [], skipDialog: true, outcome, unadjustedOutcome: outcome
  };
  const message = await damage.toMessage({
    speaker: speakerOf(token), flavor: damageFlavor(title, outcome),
    flags: { ...flags, pf2e: { context, target: at, modifiers: [], dice: [], origin: item?.getOriginData?.() ?? null }, [HELPER_ID]: { rolled: { times: 1 } } }
  }, { messageMode });
  return message?.id ?? null;
}

/**
 * The core's showTableRoll (above): the roll as PF2e's own card, posted. Its message's id, in a list; or null for the
 * core's plain roll (a kind PF2e has no card for, a roll with no token, or one it couldn't make).
 * @param {object} roll      the core's table roll
 * @param {object} options   {token, target: TokenDocuments; audience: "public" | "gm"; flavor: the core's words;
 *                            flags: FastFighting's own, put on the card; materialsOf(item): a Strike's materials}
 * @returns {Promise<string[]|null>}
 */
export async function showPf2eTableRoll(roll, { token = null, target = null, audience = "public", flavor = "", flags = {}, materialsOf = null } = {}) {
  if ( !roll || !token?.actor ) return null;
  const given = { token, target, audience, flavor, flags, materialsOf };
  const id = CHECK_TYPES[roll.kind] ? await postCheck(roll, given) : roll.kind === "damage" || roll.kind === "healing" ? await postDamage(roll, given) : null;
  return id ? [id] : null;
}
