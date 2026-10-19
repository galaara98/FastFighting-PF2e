/**
 * The engine's own dice as PF2e's own cards (the core's API 20 showTableRoll, table-cards.js): a damage roll the engine
 * made becomes one PF2e damage card, its instances typed, its target and the item as its origin, its dice exactly the
 * engine's (filled into PF2e's own parsed roll, nothing rolled), marked as FastFighting's; applied once, PF2e's way, with
 * the undo record Rewind takes back. An attack, a save and a flat check become PF2e's check cards (a CheckRoll, its
 * context's type, target and DC, the engine's d20 and outcome, no reroll), the DC shown as PF2e's own settings say.
 * What PF2e has no card for is the core's plain roll.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { damageFormula, resultBlock, checkContext, checkTitle, damageFlavor, targetLine } from "../scripts/table-cards.js";
import { recordingRng, diceAt, tableRoll } from "../../FastFighting/scripts/engine/table-rolls.js";
import { createRng } from "../../FastFighting/scripts/engine/rng.js";
import { sampleDamage, parseFormula, parseTypedFormula, doubled } from "../../FastFighting/scripts/engine/dice.js";
import { rollCheck } from "../../FastFighting/scripts/engine/probability.js";

const adapter = new Pf2eAdapter();

/** A damage roll the engine made and recorded, as a live battle records it (its parts' dice, its type). */
function engineDamage(parts, { kind = "damage", seed = 7, ...extra } = {}) {
  const run = { rng: recordingRng(createRng(seed)) };
  const at = diceAt(run);
  sampleDamage(parts, run.rng);
  return tableRoll(run, at, { by: "orc", target: "hero", kind, label: "Greataxe", parts, ...extra });
}

/** A check the engine made and recorded. */
function engineCheck(kind, { mod = 7, dc = 18, advantage = 0, seed = 3, ...extra } = {}) {
  const run = { rng: recordingRng(createRng(seed)) };
  const rules = { degreeOfSuccess: (natural, total, d) => (total >= d + 10 ? 3 : total >= d ? 2 : total <= d - 10 ? 0 : 1) };
  rollCheck(rules, run.rng, mod, dc, { kind, by: "orc", target: "hero", label: "Greataxe", advantage, ...extra });
  return run.rng.tray.rolls[0];
}

describe("an engine damage roll as PF2e writes a damage roll's formula", () => {
  const sum = d => d.results.reduce((a, b) => a + b, 0);

  test("its parts by type, PF2e's way; the dice as they fell, in the formula's order", () => {
    const plain = engineDamage([parseFormula("1d12+4", "slashing")]);
    const built = damageFormula(plain);
    expect(built.formula).toBe("{(1d12 + 4)[slashing]}");
    expect(built.dice).toEqual([{ faces: 12, results: [plain.dice[0].result] }]);
    // (Two types: an instance each, as they came; a bare die needs no parentheses.)
    const two = engineDamage([parseFormula("1d8", "slashing"), parseFormula("2d6", "fire")]);
    const both = damageFormula(two);
    expect(both.formula).toBe("{1d8[slashing],2d6[fire]}");
    expect(both.dice.map(d => [d.faces, d.results.length])).toEqual([[8, 1], [6, 2]]);
    expect(both.dice.flatMap(d => d.results)).toEqual(two.dice.map(d => d.result));
  });

  test("a critical hit doubled as PF2e writes it: 2 * (...), a die not doubled (deadly) after it; precision flavored inside its type", () => {
    const crit = engineDamage(doubled([parseFormula("1d12+4", "slashing")]), { crit: true });
    expect(damageFormula(crit).formula).toBe("{(2 * (1d12 + 4))[slashing]}");
    // (PF2e's own critical formula, as the adapter reads it: its doubled dice and modifier, and a deadly d10.)
    const deadly = engineDamage(parseTypedFormula("(2 * (1d8 + 4) + 1d10)[piercing]"));
    const built = damageFormula(deadly);
    expect(built.formula).toBe("{(2 * (1d8 + 4) + 1d10)[piercing]}");
    expect(built.dice.map(d => d.faces)).toEqual([8, 10]);
    const sneak = engineDamage([parseFormula("1d6+4", "piercing"), { ...parseFormula("2d6", "piercing"), category: "precision" }]);
    expect(damageFormula(sneak).formula).toBe("{(1d6 + 4 + 2d6[precision])[piercing]}");
    // (Doubled, precision and all.)
    const both = engineDamage(doubled([parseFormula("1d6+4", "piercing"), { ...parseFormula("2d6", "piercing"), category: "precision" }]));
    expect(damageFormula(both).formula).toBe("{(2 * (1d6 + 4 + 2d6[precision]))[piercing]}");
  });

  test("healing as PF2e's healing; a type PF2e hasn't, untyped; a Strike's materials on its damage", () => {
    const types = { slashing: "", fire: "", vitality: "", untyped: "" };
    expect(damageFormula(engineDamage([parseFormula("2d8+10", "healing")], { kind: "healing" }), { damageTypes: types }).formula).toBe("{(2d8 + 10)[healing]}");
    expect(damageFormula(engineDamage([parseFormula("1d8", "vitality")], { kind: "healing" }), { damageTypes: types }).formula).toBe("{1d8[healing,vitality]}");
    expect(damageFormula(engineDamage([parseFormula("1d6", "laser")]), { damageTypes: types }).formula).toBe("{1d6[untyped]}");
    expect(damageFormula(engineDamage([parseFormula("1d8+2", "slashing")]), { damageTypes: types, materials: ["silver"] }).formula).toBe("{(1d8 + 2)[slashing,silver]}");
    // (No parts recorded, nothing to write.)
    expect(damageFormula({ kind: "damage", groups: [{ faces: 6, results: [3] }] })).toBeNull();
    expect(sum({ results: [1, 2] })).toBe(3);
  });

  test("a damage card's header: its title, an attack's outcome in PF2e's words", () => {
    expect(damageFlavor("Greataxe <b>")).toBe('<h4 class="action"><strong>Greataxe &lt;b&gt;</strong></h4>');
    expect(damageFlavor("Greataxe", "criticalSuccess")).toContain('<span class="criticalSuccess">');
  });
});

describe("a check's DC and result, as PF2e's own Check shows them", () => {
  test("against a creature the players can see, the DC theirs with PF2e's Show DCs, the result with its Show Results", () => {
    const shown = resultBlock({ degree: 2, total: 21, dc: 18, dcType: "AC", scope: "Attack", opposer: { name: "Goblin", visible: true }, dcVisible: true, resultVisible: true });
    expect(shown).not.toContain("data-visibility");
    expect(shown).toContain('class="target-dc-result"');
    const hidden = resultBlock({ degree: 2, total: 21, dc: 18, dcType: "AC", scope: "Attack", opposer: { name: "Goblin", visible: false }, dcVisible: false, resultVisible: false });
    // (The DC line and the result the GMs': the block itself too.)
    expect(hidden.startsWith('<div class="target-dc-result" data-tooltip-class="pf2e" data-tooltip-direction="UP" data-visibility="gm">')).toBe(true);
    expect(hidden).toContain('<div class="target-dc" data-visibility="gm">');
    // (A name the nameplate shows, the DC hidden: the line stays, the DC in it the GMs'.)
    const named = resultBlock({ degree: 1, total: 10, dc: 18, dcType: "AC", opposer: { name: "Goblin", visible: true }, dcVisible: false, resultVisible: true });
    expect(named).toContain('<div class="target-dc">');
    expect(resultBlock({ degree: 2, total: 10, dc: null, dcType: "DC" })).toBe("");
  });

  test("its context: an attack's target, a save's origin, the DC by PF2e's statistic, the outcome, two d20s kept for fortune", () => {
    const attack = engineCheck("attack");
    const self = { actor: "Actor.orc", token: "Scene.s.Token.orc" };
    const foe = { actor: "Actor.hero", token: "Scene.s.Token.hero" };
    const c = checkContext(attack, { actorId: "orc", tokenId: "orc", self, opposer: foe, title: "Greataxe" });
    expect(c).toMatchObject({ type: "attack-roll", origin: self, target: foe, dc: { value: 18, slug: "armor" }, rollTwice: false, isReroll: false });
    expect(c.outcome).toBe(["criticalFailure", "failure", "success", "criticalSuccess"][attack.degree]);
    const save = engineCheck("save", { stat: "reflex", advantage: 1 });
    expect(checkContext(save, { self: foe, opposer: self })).toMatchObject({ type: "saving-throw", origin: self, target: foe, dc: { slug: "reflex" }, rollTwice: "keep-higher", domains: ["saving-throw", "reflex"] });
    const flat = engineCheck("flat", { dc: 5, label: "" });
    expect(checkContext(flat, {})).toMatchObject({ type: "flat-check", dc: { value: 5, visible: true } });
    expect(checkTitle({ kind: "save", stat: "reflex", label: "" })).not.toBe("");
    expect(checkTitle({ kind: "attack", label: "Greataxe" })).toBe("Greataxe");
  });
});

/* -------------------------------------------- */
/*  Posted, and applied                         */
/* -------------------------------------------- */

const posted = [];

/** PF2e's dice term, as its parsed roll holds one before it's evaluated. */
class Die {
  constructor(number, faces) {
    Object.assign(this, { number, faces, results: [] });
  }
}

/** PF2e's damage roll, as far as these tests need it: its dice parsed from the formula, its total from their results. */
class DamageRoll {
  constructor(formula, data = {}, options = {}) {
    Object.assign(this, { formula, options, kinds: new Set(["damage"]), instances: [{ type: "slashing", kinds: new Set(["damage"]) }] });
    this.dice = [...formula.matchAll(/(\d+)d(\d+)/g)].map(m => new Die(Number(m[1]), Number(m[2])));
  }

  async evaluate(options) {
    this.evaluatedWith = options;
    let i = 0;
    const expr = this.formula.replace(/\[[^\]]*\]/g, "").replace(/[{}]/g, "").replace(/,/g, " + ").replace(/\d+d\d+/g, () => String(this.dice[i++].results.reduce((s, r) => s + r.result, 0)));
    this.total = Math.floor(Function(`return (${expr});`)());
    return this;
  }

  alter(multiplier, addend) {
    const out = Object.assign(Object.create(DamageRoll.prototype), this, { total: Math.floor(this.total * multiplier) + addend, from: { multiplier, addend } });
    return out;
  }

  async toMessage(data, { messageMode } = {}) {
    const message = { id: `m${posted.length + 1}`, ...data, rolls: [this], messageMode, item: null, actor: null };
    posted.push(message);
    return message;
  }
}

/** PF2e's check roll, from its data (Roll.fromData). */
class CheckRoll {
  static fromData(json) {
    return Object.assign(new CheckRoll(), { json, options: json.options });
  }

  async toMessage(data, { messageMode } = {}) {
    const message = { id: `m${posted.length + 1}`, ...data, rolls: [this], messageMode };
    posted.push(message);
    return message;
  }
}

/** A token: its actor, whose sheet PF2e's applyDamage changes on its contextual copy. */
function token(id, { hp = 40, playerOwned = false } = {}) {
  const seen = { applied: [] };
  const actor = {
    id, uuid: `Scene.s.Token.${id}.Actor.${id}`, name: id, hasPlayerOwner: playerOwned, alliance: playerOwned ? "party" : "opposition",
    _source: { system: { attributes: { hp: { value: hp, temp: 0 } } } }, items: [], effects: [], statuses: new Set(),
    getSelfRollOptions: prefix => [`${prefix}:trait:${id}`],
    getContextualClone() {
      return copy;
    }
  };
  const copy = {
    getSelfRollOptions: () => [`self:trait:${id}`],
    async applyDamage(args) {
      seen.applied.push(args);
      const sheet = actor._source.system.attributes.hp;
      sheet.value = Math.max(0, sheet.value - args.damage.total);
      return copy;
    }
  };
  return { id, uuid: `Scene.s.Token.${id}`, name: id, actor, playersCanSeeName: true, seen };
}

/** PF2e's own words these cards use, as its English has them (the tests' i18n reads only FastFighting's files). */
const PF2E_WORDS = {
  "PF2E.Check.DC.Label.WithTarget": "<opposer>Target: {opposer}</opposer> <dc>({dcType} {dc})</dc>",
  "PF2E.Check.DC.Label.WithOrigin": "<opposer>Origin: {opposer}</opposer> <dc>({dcType} {dc})</dc>",
  "PF2E.Check.DC.Label.NoTarget": "<dc>{dcType} {dc}</dc>",
  "PF2E.Check.DC.Specific.armor": "AC",
  "PF2E.Check.DC.Unspecific": "DC",
  "PF2E.Check.Result.Label": "Result: <unadjusted>{unadjusted}</unadjusted> <offset>by {offset}</offset>",
  "PF2E.Check.Result.Degree.Attack.success": "Hit",
  "PF2E.Check.Result.Degree.Attack.criticalSuccess": "Critical Hit",
  "PF2E.Check.Result.Degree.Attack.failure": "Miss",
  "PF2E.Check.Result.Degree.Attack.criticalFailure": "Critical Miss",
  "PF2E.SavingThrowWithName": "{saveName} Saving Throw",
  "PF2E.SavesReflex": "Reflex"
};

const was = { CONFIG: globalThis.CONFIG };
beforeEach(() => {
  posted.length = 0;
  const i18n = globalThis.game.i18n;
  globalThis.game.i18n = { ...i18n, has: key => Object.hasOwn(PF2E_WORDS, key) || i18n.has(key), localize: key => PF2E_WORDS[key] ?? i18n.localize(key) };
  globalThis.CONFIG = {
    Dice: { rolls: [CheckRoll, DamageRoll] },
    ChatMessage: { documentClass: { getSpeaker: ({ token: t }) => ({ token: t?.id ?? null, actor: t?.actor?.id ?? null }) } },
    PF2E: { damageTypes: { slashing: "", piercing: "", fire: "", untyped: "" }, materialDamageEffects: {}, chatDamageButtonShieldToggle: false, saves: { reflex: "PF2E.SavesReflex" }, checkDCs: { Label: {}, Specific: { armor: "PF2E.Check.DC.Specific.armor" }, Unspecific: "PF2E.Check.DC.Unspecific" } }
  };
  globalThis.game.userId = "gm";
  globalThis.game.pf2e = { settings: { metagame: { dcs: false, results: true, breakdowns: false }, tokens: { nameVisibility: false } } };
});
afterEach(() => {
  globalThis.CONFIG = was.CONFIG;
});

const flags = { "fast-fighting": { live: { battle: "b1", turn: "1.k", rolls: true } } };

describe("posted as PF2e's own cards, and applied", () => {
  test("an engine damage roll: one PF2e damage card, typed, at its target, the engine's dice exactly, marked; applied once, PF2e's way, its undo record for Rewind", async () => {
    const orc = token("orc");
    const hero = token("hero", { hp: 40, playerOwned: true });
    const roll = engineDamage([parseFormula("1d12+4", "slashing")], { source: "attack", action: "orc.strike.greataxe.0" });
    const ids = await adapter.showTableRoll(roll, { token: orc, target: hero, audience: "public", flavor: "Greataxe: damage", flags });
    expect(ids).toEqual(["m1"]);
    expect(posted).toHaveLength(1);
    const [card] = posted;
    const damage = card.rolls[0];
    // (PF2e's own roll, parsed from PF2e's formula; its die the engine's, filled in, nothing rolled.)
    expect(damage).toBeInstanceOf(DamageRoll);
    expect(damage.formula).toBe("{(1d12 + 4)[slashing]}");
    expect(damage.dice[0].results).toEqual([{ result: roll.dice[0].result, active: true }]);
    expect(damage.evaluatedWith).toEqual({ allowInteractive: false });
    expect(damage.total).toBe(roll.total);
    // (As PF2e's DamagePF2e posts one: its context, its target, the outcome of an attack; the speaker its token.)
    expect(card.flags.pf2e.context).toMatchObject({ type: "damage-roll", sourceType: "attack", actor: "orc", token: "orc", outcome: "success", target: { actor: hero.actor.uuid, token: hero.uuid } });
    expect(card.flags.pf2e.target).toEqual({ actor: hero.actor.uuid, token: hero.uuid });
    expect(card.speaker).toEqual({ token: "orc", actor: "orc" });
    expect(card.messageMode).toBe("public");
    // (FastFighting's: its flags, so it's never a player's card; marked, so its Apply buttons are gone.)
    expect(card.flags["fast-fighting"]).toEqual(flags["fast-fighting"]);
    expect(card.flags["fast-fighting-pf2e"]).toEqual({ rolled: { times: 1 } });
    // (Applied as PF2e's own card applies it, once: the sheet lost the roll, and the record has it as it was.)
    const [record] = await adapter.applyDamageCard(card, hero, { multiplier: 1 });
    expect(hero.seen.applied).toHaveLength(1);
    expect(hero.seen.applied[0]).toMatchObject({ outcome: "success", skipIWR: false });
    expect(hero.actor._source.system.attributes.hp.value).toBe(40 - roll.total);
    expect(record.actorUpdate).toEqual({ "system.attributes.hp.value": 40 });
    expect(record).toMatchObject({ tokenUuid: hero.uuid, actorUuid: hero.actor.uuid });
  });

  test("a save's share, applied as PF2e's Half button applies it; for the GMs alone where the core says", async () => {
    const roll = engineDamage([parseFormula("4d6", "fire")], { source: "save", multiplier: 0.5 });
    await adapter.showTableRoll(roll, { token: token("orc"), target: token("hero"), audience: "gm", flavor: "", flags });
    const [card] = posted;
    expect(card.messageMode).toBe("gm");
    expect(card.flags.pf2e.context).toMatchObject({ sourceType: "save", outcome: null, secret: true });
    // (The card shows the roll whole; its share is the application's.)
    expect(card.rolls[0].total).toBe(roll.dice.reduce((s, d) => s + d.result, 0));
    const hero = token("hero");
    await adapter.applyDamageCard(card, hero, { multiplier: 0.5 });
    expect(hero.seen.applied[0].damage.from).toEqual({ multiplier: 0.5, addend: 0 });
  });

  test("a formula PF2e reads otherwise than it was written (its dice don't match): no card, the core's plain roll", async () => {
    class Odd extends DamageRoll {
      constructor(...args) {
        super(...args);
        this.dice = [];
      }
    }
    Object.defineProperty(Odd, "name", { value: "DamageRoll" });
    globalThis.CONFIG.Dice.rolls = [CheckRoll, Odd];
    expect(await adapter.showTableRoll(engineDamage([parseFormula("1d6", "fire")]), { token: token("orc"), flags })).toBeNull();
    expect(posted).toHaveLength(0);
  });

  test("an attack the engine rolled: PF2e's attack card, its d20 and modifier the engine's, the target and AC, the outcome; no reroll, no Damage buttons", async () => {
    const roll = engineCheck("attack", { mod: 7, dc: 18 });
    await adapter.showTableRoll(roll, { token: token("orc"), target: token("hero", { playerOwned: true }), audience: "public", flavor: "", flags });
    const [card] = posted;
    const check = card.rolls[0];
    expect(check.json.class).toBe("CheckRoll");
    expect(check.json.terms[0]).toMatchObject({ class: "Die", faces: 20, results: [{ result: roll.natural, active: true }] });
    expect(check.json.total).toBe(roll.total);
    expect(check.options).toMatchObject({ type: "attack-roll", isReroll: true, damaging: false, totalModifier: 7, degreeOfSuccess: roll.degree });
    expect(card.flags.pf2e.context).toMatchObject({ type: "attack-roll", dc: { value: 18, slug: "armor" }, target: { token: "Scene.s.Token.hero" } });
    // (Against a player's character, the AC is the players' to see; the title the attack's name.)
    expect(card.flavor).toContain("<strong>Greataxe</strong>");
    expect(card.flavor).toContain('class="target-dc-result"');
    expect(card.flavor).not.toContain('<div class="target-dc" data-visibility="gm">');
    expect(card.flavor).toContain("Target: hero");
    expect(card.flavor).toContain("(AC 18)");
    expect(card.flavor).toContain(`<span class="${["criticalFailure", "failure", "success", "criticalSuccess"][roll.degree]}">`);
    expect(card.flags["fast-fighting"]).toEqual(flags["fast-fighting"]);
    expect(card.flags["fast-fighting-pf2e"]).toBeUndefined();
  });

  test("a heal: PF2e's healing card, naming whom it heals and how much; a flat heal (no dice) too, its number alone", async () => {
    const seelah = token("seelah", { playerOwned: true });
    const lem = token("lem", { hp: 10, playerOwned: true });
    // (Lay on Hands' 6, no dice: the core records it all the same, API 21.)
    const run = { rng: recordingRng(createRng(1)) };
    const flat = tableRoll(run, diceAt(run), { by: "seelah", target: "lem", kind: "healing", label: "Lay on Hands", parts: [parseFormula("6", "healing")], total: 6 });
    expect(flat).not.toBeNull();
    await adapter.showTableRoll(flat, { token: seelah, target: lem, audience: "public", flavor: "", flags });
    const [card] = posted;
    expect(card.rolls[0].formula).toBe("{6[healing]}");
    expect(card.rolls[0].total).toBe(6);
    expect(card.flags.pf2e.context).toMatchObject({ type: "damage-roll", domains: ["healing"], target: { actor: lem.actor.uuid, token: lem.uuid } });
    // (Whom it heals, under its title, in PF2e's words.)
    expect(card.flavor).toContain("Lay on Hands");
    expect(card.flavor).toContain("Target: lem");
    expect(card.flavor).not.toContain('data-visibility="gm"');
    // (A rolled heal: its dice the engine's, its target named the same way.)
    const rolled = engineDamage([parseFormula("1d8+4", "healing")], { kind: "healing" });
    await adapter.showTableRoll(rolled, { token: seelah, target: lem, audience: "public", flavor: "", flags });
    expect(posted[1].rolls[0].formula).toBe("{(1d8 + 4)[healing]}");
    expect(posted[1].rolls[0].total).toBe(rolled.total);
    expect(posted[1].flavor).toContain("Target: lem");
  });

  test("whom a card is at, as its nameplate shows it to the players; else the GMs'", () => {
    expect(targetLine("Goblin")).toContain('<span data-whose="target">Target: Goblin</span>');
    expect(targetLine("Goblin", { visible: false })).toContain('data-visibility="gm"');
    expect(targetLine("")).toBe("");
  });

  test("what PF2e has no card for, or a roll with no one's token: the core's plain roll", async () => {
    const recharge = { by: "orc", kind: "recharge", label: "Breath", dice: [{ faces: 4, result: 2 }], groups: [{ faces: 4, results: [2] }] };
    expect(await adapter.showTableRoll(recharge, { token: token("orc"), flags })).toBeNull();
    expect(await adapter.showTableRoll(engineCheck("attack"), { token: null, flags })).toBeNull();
    expect(posted).toHaveLength(0);
  });
});
