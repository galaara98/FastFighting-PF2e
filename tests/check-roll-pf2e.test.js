/**
 * API 19, saves and checks in a live battle, rolled with PF2e's own rollers: a save as the actor's saving throw against
 * the engine's DC (whoever made it save its origin, the item it's against where the action's id names one; not an
 * incapacitation one's, which the engine shifts itself); a check as PF2e's own action (a maneuver, Aid, Hide, Escape,
 * Steal, Administer First Aid) or the skill (a feat's, a heal's, the spec's, talk's), with no dialog, the target with
 * it where it's rolled against that target's defense; talk at a creature drawn here as PF2e's social action for its
 * kind of pitch (Request, or Make an Impression in a standoff; Coerce; Lie), else the skill; the multiple attack penalty
 * on a check with the attack trait, for the attacks the engine counted before it; none where it can't tell (an Aid only
 * a Strike would make).
 */
import { beforeEach, describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";

const adapter = new Pf2eAdapter();

/** PF2e's check roll: its degree of success (0-3), total and d20. */
const checkRoll = (degree, total = 19, natural = 11) => ({ degreeOfSuccess: degree, total, dice: [{ faces: 20, total: natural }] });

/**
 * A statistic as PF2e has it (a save, a skill, Perception): its slug, label and modifier, its roll keeping what it was
 * asked. `degree` null: PF2e rolled nothing (cancelled).
 */
function statistic(slug, mod, { label = slug, degree = 2 } = {}) {
  const s = { slug, label, mod, asked: [] };
  s.roll = async params => {
    s.asked.push(params);
    return degree === null ? null : checkRoll(degree);
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
  const slugs = [
    "trip", "grapple", "shove", "disarm", "reposition", "demoralize", "feint", "create-a-diversion", "hide", "aid", "escape", "steal", "administer-first-aid",
    "request", "make-an-impression", "coerce", "lie", "seek"
  ];
  game.pf2e = {
    actions: new Map(slugs.map(slug => [slug, {
      slug,
      use: async params => {
        (asked[slug] ??= []).push(params);
        return degree === null ? [] : [{ actor: params.actors[0], roll: checkRoll(degree), message: { id: slug }, outcome: "success" }];
      }
    }]))
  };
  return asked;
}

let asked;
beforeEach(() => {
  asked = pf2eActions();
  Object.assign(globalThis.game, {
    user: { isGM: true, settings: { showCheckDialogs: true, showDamageDialogs: false }, targets: new Set() },
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

  test("a creature's Grab, Knockdown or Push after its hit: PF2e's own Grapple, Trip or Shove, no multiple attack penalty", async () => {
    const croc = creature("croc1");
    const hero = creature("pc1");
    await adapter.rollCheck(croc, { purpose: "control", against: "fortitude", attackNumber: null, dc: 21, action: { id: "croc1.g1.grapple", name: "Grab" }, target: hero });
    await adapter.rollCheck(croc, { purpose: "control", against: "reflex", attackNumber: null, dc: 19, action: { id: "croc1.knockdown.trip", name: "Knockdown" }, target: hero });
    await adapter.rollCheck(croc, { purpose: "control", against: "fortitude", attackNumber: null, dc: 21, action: { id: "croc1.p1.shove", name: "Push" }, target: hero });
    await adapter.rollCheck(croc, { purpose: "control", against: "fortitude", attackNumber: null, dc: 21, action: { id: "croc1.p2.reposition", name: "Pull" }, target: hero });
    expect(asked.grapple[0]).toMatchObject({ actors: [croc.actor], difficultyClass: { value: 21, slug: "fortitude" }, target: hero.object });
    expect(asked.trip[0].difficultyClass).toEqual({ value: 19, slug: "reflex" });
    expect([asked.shove, asked.reposition].map(a => a.length)).toEqual([1, 1]);
    for ( const a of [asked.grapple[0], asked.trip[0], asked.shove[0], asked.reposition[0]] ) expect(a).not.toHaveProperty("multipleAttackPenalty");
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

  test("by what it's for: Escape (no multiple attack penalty), Steal, Administer First Aid (stabilize; stop bleeding by its id)", async () => {
    const goblin = creature("gob1");
    await adapter.rollCheck(goblin, { purpose: "escape", dc: 19, action: { id: null, name: "grabbed" } });
    await adapter.rollCheck(goblin, { purpose: "theft", skill: "Thievery", dc: 16, action: { id: null }, target: creature("pc1") });
    await adapter.rollCheck(goblin, { purpose: "firstAid", dc: 16, action: { id: null } });
    await adapter.rollCheck(goblin, { purpose: "firstAid", dc: 18, action: { id: "medic.stop-bleeding", name: "bleeding" }, target: creature("pc1") });
    expect(asked.escape[0]).toMatchObject({ actors: [goblin.actor], difficultyClass: { value: 19 } });
    expect(asked.escape[0]).not.toHaveProperty("multipleAttackPenalty");
    expect(asked.steal[0].difficultyClass).toEqual({ value: 16 });
    expect(asked["administer-first-aid"].map(a => [a.variant, a.difficultyClass])).toEqual([["stabilize", { value: 16 }], ["stop-bleeding", { value: 18 }]]);
  });

  test("a Seek (the core's patrol): PF2e's own Seek action against the engine's DC, no target; without the action, Perception", async () => {
    const goblin = creature("gob1");
    const out = await adapter.rollCheck(goblin, { purpose: "seek", skill: "perception", dc: 18, action: { id: null, name: "" } });
    expect(out).toEqual({ degree: 2, natural: 11, total: 19 });
    expect(asked.seek[0]).toMatchObject({ actors: [goblin.actor], difficultyClass: { value: 18 } });
    expect(asked.seek[0]).not.toHaveProperty("target");
    game.pf2e.actions.delete("seek");
    await adapter.rollCheck(goblin, { purpose: "seek", skill: "perception", dc: 18, action: { id: null, name: "" }, secret: true });
    expect(goblin.actor.perception.asked).toEqual([{ dc: { value: 18 }, skipDialog: true, messageMode: "gm" }]);
  });

  test("Aid: PF2e's Aid with its best skill of those the adapter weighs (one on a par with its best Strike too); a Strike better, the engine's", async () => {
    await adapter.rollCheck(creature("gob1", { strikes: [5] }), { purpose: "aid", dc: 15, action: { id: "gob1.aid", name: "Aid" } });
    await adapter.rollCheck(creature("gob2", { strikes: [6] }), { purpose: "aid", dc: 15, action: { id: "gob2.aid", name: "Aid" } });
    expect(asked.aid.map(a => [a.statistic, a.difficultyClass])).toEqual([["intimidation", { value: 15 }], ["intimidation", { value: 15 }]]);
    expect(await adapter.rollCheck(creature("orc1", { strikes: [9, 4] }), { purpose: "aid", dc: 15, action: { id: "orc1.aid" } })).toBeNull();
    expect(asked.aid).toHaveLength(2);
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
  test("a maneuver: the attacks the engine counted before it, as PF2e's action takes them; none for the first, or none told", async () => {
    const goblin = creature("gob1");
    const hero = creature("pc1");
    for ( const attackNumber of [0, 1, 2, 5, null, -1, 1.5] ) {
      await adapter.rollCheck(goblin, { purpose: "control", against: "reflex", attackNumber, dc: 22, action: { id: "gob1.trip" }, target: hero });
    }
    expect(asked.trip.map(a => a.multipleAttackPenalty)).toEqual([undefined, 1, 2, 5, undefined, undefined, undefined]);
  });

  test("an ability's check (Swallow Whole): PF2e's own penalty for that item, by its attack number", async () => {
    const gulp = item("sw1", "swallow-whole", ["attack"]);
    const toad = creature("toad1", { items: [gulp] });
    const hero = creature("pc1");
    for ( const attackNumber of [0, 2, null] ) {
      await adapter.rollCheck(toad, { purpose: "control", against: "reflex", attackNumber, dc: 21, action: { id: "toad1.sw1" }, target: hero });
    }
    const athletics = toad.actor.skills.athletics.asked;
    expect(athletics.map(a => a.attackNumber)).toEqual([1, 3, undefined]);
    expect(athletics[0]).toEqual({
      dc: { value: 21, slug: "reflex" }, skipDialog: true, target: hero.actor, item: gulp, title: "swallow-whole", traits: ["attack"], extraRollOptions: ["action:swallow-whole"], attackNumber: 1
    });
  });

  test("a penalty with neither PF2e's action nor an item to take it by: the engine's roll, with its own", async () => {
    const orc = creature("orc1");
    expect(await adapter.rollCheck(orc, { purpose: "control", skill: "athletics", against: "reflex", attackNumber: 1, dc: 20, action: { id: "orc1.slam" } })).toBeNull();
    expect(orc.actor.skills.athletics.asked).toEqual([]);
    expect(await adapter.rollCheck(orc, { purpose: "control", skill: "athletics", against: "reflex", attackNumber: 0, dc: 20, action: { id: "orc1.slam" } })).toEqual({ degree: 2, natural: 11, total: 19 });
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
    expect(bard.actor.skills.diplomacy.asked[0]).toEqual({
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

  test("talk at a creature drawn here: PF2e's own action for its kind of pitch, at its Will DC (a lie, Perception), the target with it, no dialog", async () => {
    const envoy = creature("env1");
    const hero = creature("pc1");
    const pitch = (kind, more = {}) => adapter.rollCheck(envoy, { purpose: "talk", skill: "Diplomacy", against: null, dc: 17, action: { id: null, name: kind }, target: hero, ...more });
    expect(await pitch("persuade")).toEqual({ degree: 2, natural: 11, total: 19 });
    await pitch("intimidate");
    await pitch("deceive", { dc: 19 });
    expect(asked.request).toEqual([{
      actors: [envoy.actor], event: { shiftKey: true, ctrlKey: false, metaKey: false }, difficultyClass: { value: 17, slug: "will" }, target: hero.object
    }]);
    expect(asked.coerce[0]).toMatchObject({ difficultyClass: { value: 17, slug: "will" }, target: hero.object });
    expect(asked.lie[0]).toMatchObject({ difficultyClass: { value: 19, slug: "perception" }, target: hero.object });
    // (Never Demoralize: the engine sways, it doesn't frighten. The skill isn't rolled besides.)
    expect(asked.demoralize).toBeUndefined();
    expect(Object.values(envoy.actor.skills).map(s => s.asked.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    for ( const a of [asked.request[0], asked.coerce[0], asked.lie[0]] ) expect(a).not.toHaveProperty("multipleAttackPenalty");
  });

  test("talk while a standoff holds: persuading is Make an Impression; threats and lies as in a fight; secret, Ctrl down", async () => {
    const envoy = creature("env1");
    const hero = creature("pc1");
    const pitch = (kind, more = {}) => adapter.rollCheck(envoy, { purpose: "talk", skill: kind, dc: 18, action: { id: null, name: kind }, target: hero, standoff: true, ...more });
    await pitch("persuade");
    await pitch("intimidate");
    await pitch("deceive");
    await pitch("persuade", { secret: true });
    expect(asked["make-an-impression"].map(a => [a.difficultyClass, a.event.ctrlKey])).toEqual([[{ value: 18, slug: "will" }, false], [{ value: 18, slug: "will" }, true]]);
    expect([asked.request, asked.coerce?.length, asked.lie?.length]).toEqual([undefined, 1, 1]);
    // (A defense the core names goes with it as named.)
    await pitch("persuade", { against: "perception" });
    expect(asked["make-an-impression"][2].difficultyClass).toEqual({ value: 18, slug: "perception" });
  });

  test("talk falls back to the skill: without PF2e's action, the target's token here, or a target; a taunt (its own action id)", async () => {
    const orc = creature("orc1");
    const hero = creature("pc1");
    game.pf2e.actions.delete("request");
    await adapter.rollCheck(orc, { purpose: "talk", skill: "Diplomacy", dc: 16, action: { id: null, name: "persuade" }, target: hero });
    await adapter.rollCheck(orc, { purpose: "talk", skill: "Intimidation", dc: 16, action: { id: null, name: "intimidate" }, target: creature("pc2", { drawn: false }) });
    await adapter.rollCheck(orc, { purpose: "talk", skill: "Deception", dc: 16, action: { id: null, name: "deceive" }, target: null });
    await adapter.rollCheck(orc, { purpose: "talk", skill: "Deception", dc: 16, action: { id: null, name: "deceive" }, target: orc });
    await adapter.rollCheck(orc, { purpose: "talk", skill: "Intimidation", dc: 16, action: { id: "orc1.goad", name: "" }, target: hero });
    const skills = orc.actor.skills;
    expect([skills.diplomacy, skills.intimidation, skills.deception].map(s => s.asked.length)).toEqual([1, 2, 2]);
    expect(skills.diplomacy.asked[0]).toEqual({ dc: { value: 16 }, skipDialog: true });
    expect([asked.request, asked.coerce, asked.lie]).toEqual([undefined, undefined, undefined]);
    // (No game.pf2e at all, an older one's or none: the skill.)
    delete game.pf2e;
    expect(await adapter.rollCheck(orc, { purpose: "talk", skill: "Diplomacy", dc: 16, action: { id: null, name: "persuade" }, target: hero })).toEqual({ degree: 2, natural: 11, total: 19 });
  });

  test("talk PF2e's action rolled nothing for (cancelled, no statistic): the engine's, not the skill as well", async () => {
    asked = pf2eActions({ degree: null });
    const orc = creature("orc1");
    expect(await adapter.rollCheck(orc, { purpose: "talk", skill: "Intimidation", dc: 16, action: { id: null, name: "intimidate" }, target: creature("pc1") })).toBeNull();
    expect(asked.coerce).toHaveLength(1);
    expect(orc.actor.skills.intimidation.asked).toEqual([]);
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

describe("the helper's own rules' checks", () => {
  /** PF2e's Check and CheckModifier (game.pf2e), keeping what the roll was asked. */
  function pf2eCheck({ degree = 2 } = {}) {
    const rolls = [];
    game.pf2e.CheckModifier = class {
      constructor(slug, { modifiers }) {
        Object.assign(this, { slug, modifiers });
      }
    };
    game.pf2e.Check = { roll: async (check, context) => {
      rolls.push({ check, context });
      return degree === null ? null : checkRoll(degree, 14, 14);
    } };
    return rolls;
  }

  test("a flat check: PF2e's flat check (the d20 alone, no dialog) against the engine's DC, titled with what it's for", async () => {
    const rolls = pf2eCheck();
    const goblin = creature("gob1");
    const out = await adapter.rollCheck(goblin, { purpose: "flat", dc: 11, action: { id: null, name: "hidden" }, target: creature("pc1") });
    expect(out).toEqual({ degree: 2, natural: 14, total: 14 });
    expect(rolls).toHaveLength(1);
    const { check, context } = rolls[0];
    expect(check.modifiers).toEqual([]);
    expect(context).toEqual({ actor: goblin.actor, token: goblin, type: "flat-check", title: check.slug, dc: { value: 11 }, options: ["flat-check"], skipDialog: true });
    expect(context.title).toContain("hidden");
    // (Nothing else rolled: no skill, no action.)
    expect(Object.values(asked)).toEqual([]);
    expect(goblin.actor.perception.asked).toEqual([]);
  });

  test("secret: for the GMs only; no label: PF2e's own words; none where PF2e has no flat check or rolled nothing", async () => {
    const rolls = pf2eCheck();
    const goblin = creature("gob1");
    await adapter.rollCheck(goblin, { purpose: "flat", dc: 15, action: { id: null, name: "" }, secret: true });
    expect(rolls[0].context).toMatchObject({ messageMode: "gm", title: game.i18n.localize("PF2E.FlatCheck") });
    pf2eCheck({ degree: null });
    expect(await adapter.rollCheck(goblin, { purpose: "flat", dc: 15, action: { id: null, name: "x" } })).toBeNull();
    delete game.pf2e.Check;
    expect(await adapter.rollCheck(goblin, { purpose: "flat", dc: 15, action: { id: null, name: "x" } })).toBeNull();
  });

  test("Tumble Through: PF2e's action at the foe's Reflex DC, the foe with it where it's drawn here", async () => {
    game.pf2e.actions.set("tumble-through", { use: async params => {
      (asked["tumble-through"] ??= []).push(params);
      return [{ actor: params.actors[0], roll: checkRoll(3, 30, 18) }];
    } });
    const goblin = creature("gob1");
    const hero = creature("pc1");
    const out = await adapter.rollCheck(goblin, { purpose: "tumble", against: "reflex", dc: 17, action: { id: null, name: "" }, target: hero });
    expect(out).toEqual({ degree: 3, natural: 18, total: 30 });
    expect(asked["tumble-through"]).toEqual([{
      actors: [goblin.actor], event: { shiftKey: true, ctrlKey: false, metaKey: false }, difficultyClass: { value: 17, slug: "reflex" }, target: hero.object
    }]);
    await adapter.rollCheck(goblin, { purpose: "tumble", against: "reflex", dc: 17, action: { id: null }, target: creature("pc2", { drawn: false }) });
    expect(asked["tumble-through"][1].difficultyClass).toEqual({ value: 17 });
    expect(asked["tumble-through"][1]).not.toHaveProperty("target");
  });
});
