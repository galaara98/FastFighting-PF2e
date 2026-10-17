/**
 * API 19, saves and checks in a live battle, rolled with PF2e's own rollers: a save as the actor's saving throw against
 * the engine's DC (whoever made it save its origin, the item it's against where the action's id names one; not an
 * incapacitation one's, which the engine shifts itself); a check as PF2e's own action (a maneuver, Aid, Hide, Escape,
 * Steal, Administer First Aid) or the skill (a feat's, a heal's, the spec's, talk's), with no dialog, the target with
 * it where it's rolled against that target's defense; the multiple attack penalty on a check with the attack trait,
 * for the attacks made before it this turn; a GM's call for an Aid only a Strike would make; none where it can't tell.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";

const adapter = new Pf2eAdapter();

/** PF2e's check roll: its degree of success (0-3), total and d20. */
const checkRoll = (degree, total = 19, natural = 11) => ({ degreeOfSuccess: degree, total, dice: [{ faces: 20, total: natural }] });

/** A card in the chat, by id (a rewound turn's are deleted). */
let cards;

/**
 * A statistic as PF2e has it (a save, a skill, Perception): its slug, label and modifier, its roll keeping what it was
 * asked and calling back with its card, as PF2e's Check.roll does. `degree` null: PF2e rolled nothing (cancelled).
 */
function statistic(slug, mod, { label = slug, degree = 2 } = {}) {
  const s = { slug, label, mod, asked: [] };
  s.roll = async params => {
    s.asked.push(params);
    if ( degree === null ) return null;
    const card = { id: `${slug}-${s.asked.length}` };
    cards.add(card.id);
    params.callback?.(checkRoll(degree), "success", card);
    return checkRoll(degree);
  };
  return s;
}

/** An actor's items, as Foundry's Collection holds them: by id, iterated and found by value. */
class Items extends Map {
  constructor(list = []) {
    super(list.map(i => [i.id, i]));
  }
  *[Symbol.iterator]() {
    yield* this.values();
  }
  find(fn) {
    return [...this.values()].find(fn);
  }
}

const item = (id, slug, traits = [], name = slug) => ({ id, slug, name, system: { slug, traits: { value: traits } } });

/** A creature's token: its saves, skills (a Lore among them) and Perception; its items and Strikes. */
function creature(id, { tokenId = `t-${id}`, items = [], strikes = [], drawn = true } = {}) {
  const skills = Object.fromEntries([
    ["athletics", 7, "Athletics"], ["diplomacy", 4, "Diplomacy"], ["medicine", 3, "Medicine"], ["intimidation", 6, "Intimidation"],
    ["deception", 5, "Deception"], ["stealth", 8, "Stealth"], ["thievery", 2, "Thievery"], ["warfare-lore", 1, "Warfare Lore"]
  ].map(([slug, mod, label]) => [slug, statistic(slug, mod, { label })]));
  const actor = {
    id, uuid: `Actor.${id}`, items: new Items(items), system: { actions: strikes.map(bonus => ({ type: "strike", totalModifier: bonus })) },
    saves: { fortitude: statistic("fortitude", 5), reflex: statistic("reflex", 9), will: statistic("will", 3) },
    skills, perception: statistic("perception", 6, { label: "Perception" })
  };
  const doc = { id: tokenId, uuid: `Scene.s.Token.${tokenId}`, actor };
  doc.object = drawn ? { document: doc, actor } : null;
  return doc;
}

/**
 * PF2e's actions (game.pf2e.actions), each keeping what its use was asked and answering as PF2e's do: one result for
 * the actor, its roll and its card. `degree` null: PF2e rolled nothing (no statistic for it).
 */
function pf2eActions({ degree = 2 } = {}) {
  const asked = {};
  const traits = { trip: ["attack"], grapple: ["attack"], shove: ["attack"], disarm: ["attack"], reposition: ["attack"], escape: ["attack"] };
  const slugs = ["trip", "grapple", "shove", "disarm", "reposition", "demoralize", "feint", "create-a-diversion", "hide", "aid", "escape", "steal", "administer-first-aid"];
  game.pf2e = {
    actions: new Map(slugs.map(slug => [slug, {
      slug, traits: traits[slug] ?? [],
      use: async params => {
        (asked[slug] ??= []).push(params);
        if ( degree === null ) return [];
        const card = { id: `${slug}-${asked[slug].length}` };
        cards.add(card.id);
        return [{ actor: params.actors[0], roll: checkRoll(degree), message: card, outcome: "success" }];
      }
    }]))
  };
  return asked;
}

let asked;
beforeEach(() => {
  cards = new Set();
  asked = pf2eActions();
  Object.assign(globalThis.game, {
    user: { isGM: true, settings: { showCheckDialogs: true, showDamageDialogs: false }, targets: new Set() },
    combat: { id: "c1", round: 2, turn: 0, started: true },
    messages: { contents: [], get: id => (cards.has(id) ? { id } : undefined) },
    actors: new Map()
  });
});

describe("a save, rolled with PF2e's own roller", () => {
  test("the actor's save against the engine's DC, with no dialog, in the chat's own mode: the degree, natural die and total", async () => {
    const goblin = creature("gob1");
    const out = await adapter.rollSave(goblin, { save: "reflex", dc: 21, action: { id: null, name: "Burning" } });
    expect(out).toEqual({ degree: 2, natural: 11, total: 19 });
    expect(goblin.actor.saves.reflex.asked).toEqual([{ dc: { value: 21 }, skipDialog: true }]);
    expect(goblin.actor.saves.fortitude.asked).toEqual([]);
  });

  test("whoever made it save is its origin; the item it's against, by the action's id (its id, or its slug)", async () => {
    const venom = item("i2", "giant-centipede-venom", ["poison"]);
    const wizard = creature("wiz1", { items: [item("sp1", "fireball", ["fire"]), venom] });
    const goblin = creature("gob1");
    await adapter.rollSave(goblin, { save: "reflex", dc: 20, action: { id: "wiz1.spell.sp1", name: "Fireball" }, from: wizard });
    expect(goblin.actor.saves.reflex.asked[0]).toMatchObject({ origin: wizard.actor, item: wizard.actor.items.get("sp1") });
    await adapter.rollSave(goblin, { save: "fortitude", dc: 18, action: { id: "wiz1.giant-centipede-venom" }, from: wizard });
    expect(goblin.actor.saves.fortitude.asked[0].item).toBe(venom);
    // (Another's action, or none: no item.)
    await adapter.rollSave(goblin, { save: "will", dc: 18, action: { id: "orc1.spell.sp1" }, from: wizard });
    expect(goblin.actor.saves.will.asked[0]).not.toHaveProperty("item");
  });

  test("an incapacitation item isn't passed: the engine shifts that degree itself (rules.controlShift)", async () => {
    const wizard = creature("wiz1", { items: [item("sp9", "sleep", ["incapacitation", "mental"])] });
    const goblin = creature("gob1");
    await adapter.rollSave(goblin, { save: "will", dc: 19, action: { id: "wiz1.spell.sp9" }, from: wizard });
    expect(goblin.actor.saves.will.asked[0]).toEqual({ dc: { value: 19 }, skipDialog: true, origin: wizard.actor });
  });

  test("no one known to have made it save (a player's screen, an affliction's stage): the item from the actor its id begins with", async () => {
    const wizard = creature("wiz1", { items: [item("sp1", "fireball", ["fire"])] });
    game.actors.set("wiz1", wizard.actor);
    const hero = creature("pc1");
    await adapter.rollSave(hero, { save: "reflex", dc: 20, action: { id: "wiz1.spell.sp1" }, from: null });
    expect(hero.actor.saves.reflex.asked[0]).toEqual({ dc: { value: 20 }, skipDialog: true, item: wizard.actor.items.get("sp1") });
  });

  test("secret: for the GMs only, as PF2e rolls a GM's roll (a player's, blind)", async () => {
    const goblin = creature("gob1");
    await adapter.rollSave(goblin, { save: "will", dc: 18, action: null, secret: true });
    expect(goblin.actor.saves.will.asked[0].messageMode).toBe("gm");
    game.user.isGM = false;
    await adapter.rollSave(goblin, { save: "will", dc: 18, action: null, secret: true });
    expect(goblin.actor.saves.will.asked[1].messageMode).toBe("blind");
  });

  test("the engine's keys for PF2e's saves; of several named, the best", async () => {
    const goblin = creature("gob1");
    await adapter.rollSave(goblin, { save: "fort", dc: 15 });
    await adapter.rollSave(goblin, { save: "ref", dc: 15 });
    expect(goblin.actor.saves.fortitude.asked).toHaveLength(1);
    expect(goblin.actor.saves.reflex.asked).toHaveLength(1);
    await adapter.rollSave(goblin, { save: ["fortitude", "will"], dc: 15 });
    expect(goblin.actor.saves.fortitude.asked).toHaveLength(2);
    expect(goblin.actor.saves.will.asked).toHaveLength(0);
  });

  test("none where it can't: a save PF2e hasn't, or the actor lacks; no DC, no actor; a roll PF2e didn't make or can't grade", async () => {
    const goblin = creature("gob1");
    expect(await adapter.rollSave(goblin, { save: "con", dc: 15 })).toBeNull();
    expect(await adapter.rollSave(goblin, { save: "constructor", dc: 15 })).toBeNull();
    delete goblin.actor.saves.will;
    expect(await adapter.rollSave(goblin, { save: "will", dc: 15 })).toBeNull();
    expect(await adapter.rollSave(goblin, { save: "reflex", dc: null })).toBeNull();
    expect(await adapter.rollSave({ actor: null }, { save: "reflex", dc: 15 })).toBeNull();
    goblin.actor.saves.reflex = statistic("reflex", 9, { degree: null });
    expect(await adapter.rollSave(goblin, { save: "reflex", dc: 15 })).toBeNull();
    goblin.actor.saves.reflex = statistic("reflex", 9, { degree: 4 });
    expect(await adapter.rollSave(goblin, { save: "reflex", dc: 15 })).toBeNull();
  });
});

describe("a check, rolled as PF2e's own action", () => {
  test("a maneuver: its action, at the target's defense, the target with it; no dialog; the degree, natural die and total", async () => {
    const goblin = creature("gob1");
    const hero = creature("pc1");
    const out = await adapter.rollCheck(goblin, { purpose: "control", against: "reflex", dc: 22, action: { id: "gob1.trip", name: "Trip" }, target: hero });
    expect(out).toEqual({ degree: 2, natural: 11, total: 19 });
    expect(asked.trip).toEqual([{
      actors: [goblin.actor], event: { shiftKey: true, ctrlKey: false, metaKey: false }, difficultyClass: { value: 22, slug: "reflex" }, target: hero.object
    }]);
    await adapter.rollCheck(goblin, { purpose: "control", against: "will", dc: 18, action: { id: "gob1.demoralize" }, target: hero });
    await adapter.rollCheck(goblin, { purpose: "control", against: "perception", dc: 17, action: { id: "gob1.feint" }, target: hero });
    expect(asked.demoralize[0].difficultyClass).toEqual({ value: 18, slug: "will" });
    expect(asked.feint[0].difficultyClass).toEqual({ value: 17, slug: "perception" });
  });

  test("a target not drawn here, none, or itself: no target, the DC alone; secret: Ctrl down", async () => {
    const goblin = creature("gob1");
    await adapter.rollCheck(goblin, { purpose: "control", against: "fortitude", dc: 20, action: { id: "gob1.grapple" }, target: creature("pc1", { drawn: false }) });
    await adapter.rollCheck(goblin, { purpose: "control", against: "fortitude", dc: 20, action: { id: "gob1.shove" }, target: null, secret: true });
    expect(asked.grapple[0]).not.toHaveProperty("target");
    expect(asked.grapple[0].difficultyClass).toEqual({ value: 20 });
    expect(asked.shove[0].event.ctrlKey).toBe(true);
    await adapter.rollCheck(goblin, { purpose: "aid", against: "perception", dc: 21, action: { id: "gob1.hide" }, target: goblin });
    expect(asked.hide[0]).not.toHaveProperty("target");
    expect(asked.hide[0].difficultyClass).toEqual({ value: 21 });
  });

  test("by what it's for: Escape, Steal, Administer First Aid (stabilize)", async () => {
    const goblin = creature("gob1");
    await adapter.rollCheck(goblin, { purpose: "escape", dc: 19, action: { id: null, name: "grabbed" } });
    await adapter.rollCheck(goblin, { purpose: "theft", skill: "Thievery", dc: 16, action: { id: null }, target: creature("pc1") });
    await adapter.rollCheck(goblin, { purpose: "firstAid", dc: 16, action: { id: null } });
    expect(asked.escape[0]).toMatchObject({ actors: [goblin.actor], difficultyClass: { value: 19 } });
    expect(asked.steal[0].difficultyClass).toEqual({ value: 16 });
    expect(asked["administer-first-aid"][0]).toMatchObject({ variant: "stabilize", difficultyClass: { value: 16 } });
  });

  test("Aid: PF2e's Aid with its best skill of those the adapter weighs; a Strike better than any, a GM's call", async () => {
    const goblin = creature("gob1", { strikes: [5] });
    await adapter.rollCheck(goblin, { purpose: "aid", dc: 15, action: { id: "gob1.aid", name: "Aid" } });
    expect(asked.aid[0]).toMatchObject({ statistic: "intimidation", difficultyClass: { value: 15 } });
    expect(await adapter.rollCheck(creature("orc1", { strikes: [9, 4] }), { purpose: "aid", dc: 15, action: { id: "orc1.aid" } })).toEqual({ gm: true });
    expect(asked.aid).toHaveLength(1);
  });

  test("none where PF2e rolled nothing, or hasn't the action", async () => {
    asked = pf2eActions({ degree: null });
    expect(await adapter.rollCheck(creature("gob1"), { purpose: "control", against: "reflex", dc: 20, action: { id: "gob1.trip" } })).toBeNull();
    game.pf2e = { actions: new Map() };
    expect(await adapter.rollCheck(creature("gob1"), { purpose: "control", against: "reflex", dc: 20, action: { id: "gob1.trip" } })).toBeNull();
    delete game.pf2e;
    expect(await adapter.rollCheck(creature("gob1"), { purpose: "escape", dc: 20 })).toBeNull();
  });
});

describe("the multiple attack penalty on a check with the attack trait", () => {
  /** A Strike the engine has the system roll (strike-roll.js), its attack card in the chat. */
  async function strikes(token, target, attackNumber) {
    const card = { id: `strike-${attackNumber}`, flags: { pf2e: { context: { type: "attack-roll", origin: { actor: token.actor.uuid }, target: { token: target.uuid } } } } };
    cards.add(card.id);
    game.messages.contents = [card];
    token.actor.system.actions = [{ type: "strike", slug: "claw", variants: [0, 1, 2].map(() => ({ roll: async () => checkRoll(1) })) }];
    await adapter.rollStrike(token, { action: { id: `${token.actor.id}.strike.claw.0` }, target, attackNumber });
  }

  test("for the attacks made before it this turn (its Strikes, as the core counts them, and its own), as PF2e's action takes it", async () => {
    const goblin = creature("gob1");
    const hero = creature("pc1");
    const trip = () => adapter.rollCheck(goblin, { purpose: "control", against: "reflex", dc: 22, action: { id: "gob1.trip" }, target: hero });
    await strikes(goblin, hero, 0);
    await strikes(goblin, hero, 1);
    await trip();
    await trip();
    expect(asked.trip.map(a => a.multipleAttackPenalty)).toEqual([2, 3]);
    // (Not an attack: no penalty, and not counted.)
    await adapter.rollCheck(goblin, { purpose: "control", against: "will", dc: 18, action: { id: "gob1.demoralize" }, target: hero });
    expect(asked.demoralize[0]).not.toHaveProperty("multipleAttackPenalty");
    await adapter.rollCheck(goblin, { purpose: "escape", dc: 18, action: { id: null } });
    expect(asked.escape[0].multipleAttackPenalty).toBe(4);
  });

  test("the first attack, a new turn, another's, or a turn rewound (its cards gone): none", async () => {
    const goblin = creature("gob1");
    const hero = creature("pc1");
    const trip = () => adapter.rollCheck(goblin, { purpose: "control", against: "reflex", dc: 22, action: { id: "gob1.trip" }, target: hero });
    await trip();
    expect(asked.trip[0]).not.toHaveProperty("multipleAttackPenalty");
    await trip();
    expect(asked.trip[1].multipleAttackPenalty).toBe(1);
    await adapter.rollCheck(hero, { purpose: "control", against: "reflex", dc: 22, action: { id: "pc1.trip" }, target: goblin });
    expect(asked.trip[2]).not.toHaveProperty("multipleAttackPenalty");
    game.combat.turn = 1;
    await trip();
    expect(asked.trip[3]).not.toHaveProperty("multipleAttackPenalty");
    cards.clear();
    await trip();
    expect(asked.trip[4]).not.toHaveProperty("multipleAttackPenalty");
    // (Outside a combat under way, nothing is counted.)
    game.combat = null;
    await trip();
    await trip();
    expect(asked.trip.slice(5).map(a => a.multipleAttackPenalty)).toEqual([undefined, undefined]);
  });

  test("an ability's check with the attack trait (Swallow Whole): PF2e's own penalty for that item, by its attack number", async () => {
    const gulp = item("sw1", "swallow-whole", ["attack"]);
    const toad = creature("toad1", { items: [gulp] });
    const hero = creature("pc1");
    const swallow = () => adapter.rollCheck(toad, { purpose: "control", against: "reflex", dc: 21, action: { id: "toad1.sw1" }, target: hero });
    await swallow();
    await swallow();
    const athletics = toad.actor.skills.athletics.asked;
    expect(athletics.map(a => a.attackNumber)).toEqual([1, 2]);
    expect(athletics[0]).toMatchObject({ dc: { value: 21, slug: "reflex" }, target: hero.actor, item: gulp, title: "swallow-whole", traits: ["attack"], extraRollOptions: ["action:swallow-whole"] });
    await adapter.rollCheck(toad, { purpose: "control", against: "reflex", dc: 22, action: { id: "toad1.trip" }, target: hero });
    expect(asked.trip[0].multipleAttackPenalty).toBe(2);
  });
});

describe("a check, rolled as the skill", () => {
  test("a feat's: Bon Mot (Diplomacy) and Battle Medicine (Medicine), with the feat; no dialog, in the chat's own mode", async () => {
    const bonMot = item("f1", "bon-mot", ["auditory", "concentrate", "emotion", "linguistic", "mental"], "Bon Mot");
    const medic = item("f2", "battle-medicine", ["healing", "manipulate"], "Battle Medicine");
    const bard = creature("bard1", { items: [bonMot, medic] });
    const orc = creature("orc1");
    const out = await adapter.rollCheck(bard, { purpose: "control", against: "will", dc: 19, action: { id: "bard1.bon-mot" }, target: orc });
    expect(out).toEqual({ degree: 2, natural: 11, total: 19 });
    const { callback, ...rest } = bard.actor.skills.diplomacy.asked[0];
    expect(typeof callback).toBe("function");
    expect(rest).toEqual({
      dc: { value: 19, slug: "will" }, skipDialog: true, target: orc.actor, item: bonMot, title: "Bon Mot", traits: bonMot.system.traits.value, extraRollOptions: ["action:bon-mot"]
    });
    await adapter.rollCheck(bard, { purpose: "heal", dc: 15, action: { id: "bard1.feat.battle-medicine" }, target: orc });
    expect(bard.actor.skills.medicine.asked[0]).toMatchObject({ dc: { value: 15 }, item: medic, extraRollOptions: ["action:battle-medicine"] });
    expect(bard.actor.skills.medicine.asked[0]).not.toHaveProperty("target");
  });

  test("talk: the skill by the label its sheet shows, its slug, or the kind of pitch; a heal with no feat, Medicine", async () => {
    const orc = creature("orc1");
    await adapter.rollCheck(orc, { purpose: "talk", skill: "Intimidation", dc: 18, action: { id: "orc1.goad", name: "" } });
    await adapter.rollCheck(orc, { purpose: "talk", skill: "deception", dc: 18, action: { id: null, name: "deceive" } });
    await adapter.rollCheck(orc, { purpose: "talk", skill: "persuade", dc: 18, action: { id: null, name: "persuade" } });
    await adapter.rollCheck(orc, { purpose: "talk", skill: null, dc: 18, action: { id: null, name: "intimidate" } });
    await adapter.rollCheck(orc, { purpose: "heal", dc: 15, action: { id: "orc1.item.potion" } });
    await adapter.rollCheck(orc, { purpose: "disengage", skill: "warfare-lore", dc: 15, action: { id: null }, secret: true });
    const skills = orc.actor.skills;
    expect([skills.intimidation, skills.deception, skills.diplomacy, skills.medicine].map(s => s.asked.length)).toEqual([2, 1, 1, 1]);
    expect(skills.intimidation.asked[0]).toMatchObject({ dc: { value: 18 }, skipDialog: true });
    expect(skills.intimidation.asked[0]).not.toHaveProperty("item");
    expect(skills["warfare-lore"].asked[0].messageMode).toBe("gm");
  });

  test("none where it can't tell what to roll: a spell check (PF2e has none), no skill named or one it hasn't; a cancelled roll", async () => {
    const orc = creature("orc1");
    expect(await adapter.rollCheck(orc, { purpose: "cast", skill: "arcana", dc: 15, action: { id: "orc1.spell.x" } })).toBeNull();
    expect(await adapter.rollCheck(orc, { purpose: "disengage", dc: 15, action: { id: null } })).toBeNull();
    expect(await adapter.rollCheck(orc, { purpose: "talk", skill: "Sorcery", dc: 15, action: { id: null, name: "" } })).toBeNull();
    expect(await adapter.rollCheck(orc, { purpose: "control", against: "will", dc: 15, action: { id: "orc1.bon-mot" } })).toBeNull();
    expect(await adapter.rollCheck(orc, { purpose: "talk", skill: "diplomacy", dc: "15" })).toBeNull();
    expect(await adapter.rollCheck({ actor: null }, { purpose: "talk", skill: "diplomacy", dc: 15 })).toBeNull();
    orc.actor.skills.diplomacy = statistic("diplomacy", 4, { degree: null });
    expect(await adapter.rollCheck(orc, { purpose: "talk", skill: "diplomacy", dc: 15 })).toBeNull();
  });
});
