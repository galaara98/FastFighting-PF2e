/**
 * PF2e reactions read by their structure (reactions-read.js): the moment from the Trigger line by reading/en.json's
 * grammar, what it does from the Effect's @Damage, @Check, condition and effect links, and its Strike, AC or recharge
 * by the "effects" patterns; and what isn't built. The texts here are written for the tests
 * in the shape PF2e's take, not copied from a book.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { readReaction, readTrigger, readEffects, effectPart, triggerText, READ_TRIGGERS } from "../scripts/reactions-read.js";
import { normalizeLine, classifyLine, selfWords } from "../scripts/trigger-lines.js";
import { setReading } from "../scripts/reading.js";
import { PATTERNS, classifyTrigger, normalizeTrigger } from "../tools/coverage-triggers.mjs";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { pf2eRules } from "../scripts/rules.js";
import { parseFormula } from "../scripts/core.js";
import { replay } from "../../fast-fighting/scripts/engine/simulator.js";

const english = JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8"));
const reading = english;
const FRIGHTENED = "Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL";
const SLOWED = "Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3";
const CONCEALED = "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W";
const HARDEN = "Compendium.pf2e.bestiary-effects.Item.harden";
const SLUGS = { [FRIGHTENED]: "frightened", [SLOWED]: "slowed", [CONCEALED]: "concealed" };
const EFFECTS = { [HARDEN]: { name: "Effect: Harden", system: { rules: [{ key: "Resistance", type: "piercing", value: 5 }, { key: "FlatModifier", selector: "ac", value: 1, type: "circumstance" }], duration: { value: 1, unit: "rounds" } } } };
const links = { conditionOf: uuid => SLUGS[uuid] ?? null, effectOf: uuid => EFFECTS[uuid] ?? null };
const strikes = [{ id: "a.jaws", name: "Jaws" }, { id: "a.claw", name: "Claw" }, { id: "a.tail", name: "Tail" }];
const card = (trigger, effect, extra = "") => `<p><strong>Trigger</strong> ${trigger}</p>${extra}<hr /><p><strong>Effect</strong> ${effect}</p>`;
const read = (trigger, effect, over = {}) => readReaction({ id: "a.r", label: "Answer", html: card(trigger, effect), actionType: "reaction", ...over },
  { reading, name: "Bog Strider", kinds: ["beast"], level: 5, strikes, ...links, ...(over.o ?? {}) });

describe("reading/en.json: one grammar for the helper and the coverage scan", () => {
  test("the coverage tool's patterns are the reading file's triggers, in its order", () => {
    expect(PATTERNS.map(p => p[1])).toEqual(english.triggers.map(e => e.trigger));
    expect(PATTERNS.length).toBeGreaterThan(70);
    const line = normalizeTrigger("The bog strider is critically hit by a melee attack", { name: "Bog Strider", kinds: ["beast"] });
    expect(line).toBe("you is critically hit by a melee attack");
    expect(classifyTrigger(line)).toMatchObject({ trigger: "hit" });
  });

  test("every whole entry names a moment the core checks, and its own words", () => {
    const whole = english.triggers.filter(e => e.whole);
    expect(whole.length).toBeGreaterThan(10);
    for ( const e of whole ) {
      expect(READ_TRIGGERS).toContain(e.trigger);
      expect(e.pattern.startsWith("^") && e.pattern.endsWith("$")).toBe(true);
    }
    expect(english.effects.map(e => e.effect)).toEqual(expect.arrayContaining(["strike", "ac", "around", "recharge", "unless", "unclear", "foe"]));
  });

  test("the creature as you: its whole name, the kind it is after 'the', a possessive as your", () => {
    const words = selfWords(english);
    expect(normalizeLine("A creature hits the Bog Strider's tail", { name: "Bog Strider", kinds: ["beast"], words })).toBe("a creature hits your tail");
    expect(normalizeLine("The beast takes fire damage", { name: "Bog Strider", kinds: ["beast"], words })).toBe("you takes fire damage");
    // (A friend of its kind is not it.)
    expect(normalizeLine("A beast ally ends a move adjacent", { name: "Bog Strider", kinds: ["beast"], words })).toBe("a beast ally ends a move adjacent");
    expect(classifyLine("nothing to file here", english.triggers)).toBe(null);
  });
});

describe("the moment, whole, with its filters", () => {
  const when = line => readTrigger(line, { name: "Bog Strider", kinds: ["beast"], reading });

  test("attacked, hit, missed", () => {
    expect(when("The bog strider is targeted with a melee attack by an attacker it can see")).toEqual({ trigger: "attacked", melee: true });
    expect(when("A creature within 10 feet targets the bog strider with a ranged strike")).toEqual({ trigger: "attacked", ranged: true, range: 10 });
    expect(when("The bog strider is critically hit by a melee attack")).toEqual({ trigger: "hit", crit: true, melee: true });
    expect(when("The bog strider is hit or critically hit by an attack")).toEqual({ trigger: "hit" });
    expect(when("A creature within the bog strider's reach critically hits it")).toEqual(null);
    expect(when("An adjacent creature hits the bog strider with a melee strike")).toEqual({ trigger: "hit", melee: true, range: 5 });
    expect(when("A creature critically misses the bog strider with a melee strike")).toEqual({ trigger: "missed", crit: true, melee: true });
  });

  test("damaged, with how near and what kind of harm; slain", () => {
    expect(when("An enemy within 15 feet damages the bog strider")).toEqual({ trigger: "damaged", range: 15 });
    expect(when("The bog strider takes piercing or slashing damage")).toEqual({ trigger: "damaged", types: "piercing or slashing" });
    expect(when("An adjacent creature deals cold damage to the bog strider")).toEqual({ trigger: "damaged", range: 5, types: "cold" });
    expect(when("The bog strider is reduced to 0 Hit Points")).toEqual({ trigger: "slain" });
  });

  test("its own blow lands: a critical hit, which of its strikes", () => {
    expect(when("The bog strider hits a creature with a jaws Strike")).toEqual({ trigger: "ownHit", strike: "jaws" });
    expect(when("The bog strider critically hits a creature with its tail")).toEqual({ trigger: "ownHit", crit: true, strike: "tail" });
    expect(when("The bog strider rolls a critical hit against a creature")).toEqual({ trigger: "ownHit", crit: true });
    expect(when("The bog strider hits a creature with a melee Strike")).toEqual({ trigger: "ownHit", melee: true });
  });

  test("a foe moving in its reach, or out of it: a strike of its own, nothing else", () => {
    expect(when("A creature within reach of the bog strider's tail uses a move action or leaves a square during a move action it's using"))
      .toEqual({ trigger: "foeMovesInReach", alsoOn: ["foeLeavesReach"] });
    expect(when("A foe within reach of the bog strider attempts to move away")).toEqual({ trigger: "foeLeavesReach" });
    const lash = read("A creature within the bog strider's reach uses a move action", "The bog strider makes a tail Strike at the creature with a -2 penalty. If it hits, it disrupts the creature's action.");
    expect(lash).toEqual({ id: "a.r", label: "Answer", on: ["foeMovesInReach", "foeLeavesReach"], strike: "a.tail" });
    expect(read("A creature within the bog strider's reach uses a move action", "The bog strider spits @Damage[2d6[acid]] damage at the creature.")).toBe(null);
  });

  test("a foe casts, a foe comes close; and a line it can't read whole: nothing", () => {
    expect(when("A creature within 30 feet casts a spell")).toEqual({ trigger: "foeCasts", range: 30 });
    expect(when("A creature ends its movement adjacent to the bog strider")).toEqual({ trigger: "foeApproaches", range: 5 });
    expect(when("A creature approaches within 20 feet of the bog strider")).toEqual({ trigger: "foeApproaches", range: 20 });
    expect(when("The bog strider hits a slowed creature")).toBe(null);
    expect(when("The bog strider is targeted by a thrown boulder or a boulder would fall on it")).toBe(null);
    expect(when("")).toBe(null);
  });
});

describe("what it does, from its structure", () => {
  test("@Damage with a basic save: harm at whoever set it off", () => {
    const r = read("A creature hits the bog strider with a melee strike", "Its spines jab the attacker, dealing @Damage[2d6[piercing]] damage (@Check[reflex|dc:22|basic] save).");
    expect(r).toMatchObject({ id: "a.r", label: "Answer", on: "hit", melee: true, harm: { save: { type: "reflex", dc: 22, basic: true } } });
    expect(r.harm.damage).toEqual([expect.objectContaining({ type: "piercing", dice: [expect.objectContaining({ n: 2, faces: 6 })] })]);
  });

  test("around itself: those beside it, or an emanation's size, as a burst", () => {
    const beside = read("The bog strider takes slashing damage", "Acid sprays all adjacent creatures for @Damage[3d6[acid]] damage (@Check[reflex|dc:20|basic] save).");
    expect(beside).toMatchObject({ on: "damaged", damageTypes: ["slashing"], areaBurst: { range: 5, save: { type: "reflex", dc: 20 } } });
    expect(beside.harm).toBeUndefined();
    const wide = read("The bog strider is reduced to 0 Hit Points", "It bursts, dealing @Damage[4d6[fire]] damage to each creature in a @Template[emanation|distance:15] (@Check[reflex|dc:21|basic] save).");
    expect(wide).toMatchObject({ on: "slain", areaBurst: { range: 15 } });
    // (A cone or a line somewhere else isn't one it can play.)
    expect(read("The bog strider takes damage", "Its blood sprays a @Template[cone|distance:15], dealing @Damage[2d6[acid]] damage.")).toBe(null);
  });

  test("conditions by degree, from its degree list", () => {
    const html = card("An enemy within 30 feet damages the bog strider", "The creature must attempt a @Check[will|dc:24] save.",
      "") + `<hr /><p><strong>Success</strong> The creature is unaffected.</p><p><strong>Failure</strong> The creature is @UUID[${FRIGHTENED}]{Frightened 1}.</p><p><strong>Critical Failure</strong> The creature is @UUID[${FRIGHTENED}]{Frightened 2} and @UUID[${SLOWED}]{Slowed 1} for 1 round.</p>`;
    const r = readReaction({ id: "a.r", label: "Wail", html, actionType: "reaction", traits: ["auditory", "emotion", "fear", "mental"] }, { reading, name: "Bog Strider", strikes, ...links });
    expect(r).toMatchObject({ on: "damaged", range: 30, traits: ["auditory", "emotion", "fear", "mental"] });
    expect(r.afflict.save).toEqual({ type: "will", dc: 24 });
    expect(r.afflict.traits).toEqual(["auditory", "emotion", "fear", "mental"]);
    expect(r.afflict.onSave[1]).toMatchObject({ conditions: { frightened: 1 }, rounds: 1 });
    expect(r.afflict.onSave[0]).toMatchObject({ conditions: { frightened: 2, slowed: 1 }, rounds: 1 });
    expect(r.afflict.onSave[2]).toBe(null);
  });

  test("'succeed or become', the higher value a critical failure's; with its harm's save, one roll for both", () => {
    const r = read("The bog strider hits a creature with a jaws Strike", `The creature struck must succeed at a @Check[will|dc:23] save or become @UUID[${FRIGHTENED}]{Frightened 1} (@UUID[${FRIGHTENED}]{Frightened 2} on a critical failure).`);
    expect(r).toMatchObject({ on: "ownHit", actions: ["a.jaws"], afflict: { save: { type: "will", dc: 23 }, onSave: [{ conditions: { frightened: 2 } }, { conditions: { frightened: 1 } }, null, null] } });
    const both = read("The bog strider is critically hit with a melee attack",
      `The attacker takes @Damage[4d6[mental]] damage with a @Check[will|dc:25|basic] save. Any creature that fails the save is also @UUID[${FRIGHTENED}]{Frightened 1}.`);
    expect(both.harm.save).toMatchObject({ type: "will", dc: 25, basic: true });
    expect(both.afflict.save).toBeUndefined();
    expect(both.afflict.onSave[1]).toMatchObject({ conditions: { frightened: 1 } });
  });

  test("no save: it simply lands; on itself, a help to itself (concealed) or nothing", () => {
    const r = read("An adjacent creature deals piercing or slashing damage to the bog strider", `Freezing ichor splashes the creature for @Damage[2d6[cold]] damage. A creature hurt this way is @UUID[${SLOWED}]{Slowed 1} for 1 round.`);
    expect(r).toMatchObject({ harm: { damage: [expect.objectContaining({ type: "cold" })] }, afflict: { outcome: { conditions: { slowed: 1 }, rounds: 1 } }, damageTypes: ["piercing", "slashing"] });
    expect(r.harm.save).toBeUndefined();
    const hide = read("The bog strider takes physical damage", `A cloud of spores billows out and the bog strider becomes @UUID[${CONCEALED}]{Concealed} until the start of its next turn.`);
    expect(hide).toMatchObject({ on: "damaged", physical: true, boost: { conditions: { concealed: 1 } } });
    expect(hide.afflict).toBeUndefined();
    // (A condition it only looks for isn't one it lays.)
    expect(read("The bog strider takes damage", `On any turn it deals damage and is not @UUID[${SLOWED}]{Slowed}, it rages on.`)).toBe(null);
  });

  test("an effect it links: a buff on itself, with the link for a live battle's sheet; healing; a Strike; AC; a recharge", () => {
    const harden = read("The bog strider is hit by a strike", `Its hide stiffens against the blow. @UUID[${HARDEN}]{Effect: Harden}`);
    expect(harden).toMatchObject({ on: "hit", boost: { iwr: { resist: { piercing: 5 } }, mods: { ac: 1 }, rounds: 1, label: "Effect: Harden" }, effectRef: { uuids: [HARDEN] } });
    expect(read("The bog strider takes damage", "It gulps air and regains @Damage[12[healing]] Hit Points.").heal).toEqual([expect.objectContaining({ flat: 12, type: "healing" })]);
    expect(read("A creature within 10 feet targets the bog strider with an attack", "The bog strider makes a claw or tail Strike against the triggering creature.")).toMatchObject({ on: "attacked", range: 10, strike: ["a.claw", "a.tail"] });
    expect(read("The bog strider is reduced to 0 Hit Points", "The bog strider makes a Strike before it falls.")).toMatchObject({ on: "slain", strike: true });
    expect(read("The bog strider is targeted with an attack", "The bog strider ducks, gaining a +2 circumstance bonus to AC against the triggering attack.")).toMatchObject({ on: "attacked", ac: 2 });
    const breath = read("The bog strider is critically hit", "The bog strider's Mire Breath recharges.", { o: { actions: [{ id: "a.mire", name: "Mire Breath", cooldown: { n: 1, faces: 4 } }] } });
    expect(breath).toMatchObject({ on: "hit", crit: true, recharge: ["a.mire"] });
  });

  test("uses: its frequency, or once where it can't be used again for a while; a free action costs no reaction", () => {
    expect(read("The bog strider takes damage", "It regains @Damage[5[healing]] Hit Points.", { frequency: { max: 1, per: "day" } }).uses).toBe(1);
    expect(read("The bog strider takes damage", "It regains @Damage[5[healing]] Hit Points. It can't use this again for [[/gmr 1d4 #Recharge]]{1d4 rounds}.").uses).toBe(1);
    expect(read("The bog strider takes damage", "It regains @Damage[5[healing]] Hit Points.", { actionType: "free" }).free).toBe(true);
  });
});

describe("what isn't built: never half a reaction", () => {
  test("a sentence that happens only sometimes is left out of it; a choice, a teleport, allies' share, an affliction's stages: nothing", () => {
    const sometimes = read("The bog strider is targeted with an attack", "The bog strider gains a +2 circumstance bonus to AC against the triggering attack. If the attack misses, it makes a jaws Strike against the attacker.");
    expect(sometimes).toEqual({ id: "a.r", label: "Answer", on: "attacked", ac: 2 });
    expect(read("The bog strider takes damage", "The attacker chooses: it falls prone, or takes @Damage[3d6[mental]] damage.")).toBe(null);
    expect(read("The bog strider is hit by a strike", "The bog strider teleports up to 30 feet away.")).toBe(null);
    expect(read("The bog strider is critically hit", "All allies within 30 feet gain a +1 circumstance bonus to attack rolls.")).toBe(null);
    expect(read("The bog strider hits a creature with a jaws Strike", "The creature is exposed to bog rot. Saving Throw @Check[fortitude|dc:20] Stage 1 @Damage[1d6[poison]] damage.")).toBe(null);
  });

  test("a Strike it hasn't, damage to itself, a Requirement, a moment the core doesn't check, an action not a reaction", () => {
    expect(read("The bog strider is targeted with an attack", "The bog strider makes a horn Strike against the triggering creature.")).toBe(null);
    expect(read("The bog strider hits a creature with a horn Strike", "It regains @Damage[5[healing]] Hit Points.")).toBe(null);
    expect(read("The bog strider takes damage", "The bog strider takes an extra @Damage[1d6[untyped]] damage and roars.")).toBe(null);
    const required = readReaction({ id: "a.r", label: "x", html: `<p><strong>Requirements</strong> It is flying</p>${card("The bog strider takes damage", "It regains @Damage[5[healing]] Hit Points.")}`, actionType: "reaction" }, { reading, ...links });
    expect(required).toBe(null);
    expect(read("The bog strider rolls initiative", "It regains @Damage[5[healing]] Hit Points.")).toBe(null);
    expect(read("The bog strider takes damage", "It regains @Damage[5[healing]] Hit Points.", { actionType: "action" })).toBe(null);
  });

  test("its Effect and its Trigger, found in its text", () => {
    const html = card("A creature casts a spell", "Something happens.");
    expect(triggerText(html)).toBe("A creature casts a spell");
    expect(effectPart(html)).toContain("Something happens.");
    expect(readEffects("<p>Nothing it can play.</p>", { trigger: "hit", reading })).toBe(null);
  });
});

describe("in the adapter, and in the core's fights", () => {
  const before = { CONFIG: globalThis.CONFIG, fromUuid: globalThis.fromUuid };
  beforeAll(() => {
    setReading(english);
    globalThis.CONFIG = { PF2E: {} };
    globalThis.fromUuid = async uuid => (SLUGS[uuid] ? { documentName: "Item", type: "condition", system: { slug: SLUGS[uuid] } } : null);
  });
  afterAll(() => { globalThis.CONFIG = before.CONFIG; globalThis.fromUuid = before.fromUuid; });

  const strikeData = (label, slug, mod) => ({ type: "strike", label, slug, totalModifier: mod, visible: true, ready: true, item: { type: "melee", system: { traits: { value: [] } } },
    damage: async () => "1d8+6 piercing", critical: async () => "2d8+12 piercing" });
  const item = (id, slug, name, actionType, html) => ({ id, name, type: "action", slug, system: { slug, actionType: { value: actionType }, description: { value: html }, traits: { value: [] }, rules: [] } });
  const beast = items => ({
    id: "beast", uuid: "Actor.beast", type: "npc", name: "Bog Strider", img: "", level: 4, items, itemTypes: { condition: [], consumable: [], feat: [], action: items },
    system: { attributes: { hp: { value: 60, max: 60, temp: 0 }, ac: { value: 20 } }, traits: { value: ["beast"], size: { value: "lg" }, rarity: "common" }, details: { languages: { value: [] } },
      movement: { speeds: { land: 30 } }, abilities: {}, resources: {}, skills: {}, actions: [strikeData("Jaws", "jaws", 14)] },
    skills: {}, saves: { fortitude: { mod: 12 }, reflex: { mod: 9 }, will: { mod: 7 } }, perception: { mod: 9, senses: [] }, initiative: { mod: 9 }, attributes: {}
  });

  test("its reactions as the spec carries them: read by structure, its own slugs left alone", async () => {
    const items = [
      item("i1", "dread-snap", "Dread Snap", "free", card("The bog strider hits a creature with a jaws Strike", `The creature struck must succeed at a @Check[will|dc:22] save or become @UUID[${FRIGHTENED}]{Frightened 1}.`)),
      item("i2", "nimble-dodge", "Nimble Dodge", "reaction", card("The bog strider is targeted with an attack", "It gains a +2 circumstance bonus to AC against the triggering attack.")),
      item("i3", "mystery", "Mystery", "reaction", card("The bog strider rolls initiative", "Nothing it can play."))
    ];
    const spec = await new Pf2eAdapter().toCombatantSpec({ id: "t1", name: "Bog Strider", actor: beast(items), texture: { src: "" } });
    const jaws = spec.actions.find(a => a.kind === "strike");
    expect(spec.reactions).toEqual([
      { id: "beast.nimble-dodge", label: "Nimble Dodge", on: "attacked", ac: 2 },
      expect.objectContaining({ id: "beast.i1", label: "Dread Snap", on: "ownHit", free: true, actions: [jaws.id], afflict: expect.objectContaining({ save: { type: "will", dc: 22 } }) })
    ]);
  });

  test("a fight played with what was read: its jaws answer with fear, a dragon's critical hits bring its breath back", () => {
    const snap = readReaction({ id: "b.snap", label: "Dread Snap", html: card("The bog strider hits a creature with a jaws Strike",
      `The creature struck must succeed at a @Check[will|dc:40] save or become @UUID[${FRIGHTENED}]{Frightened 1} (@UUID[${FRIGHTENED}]{Frightened 2} on a critical failure).`), actionType: "free" },
    { reading, name: "Bog Strider", kinds: ["beast"], strikes: [{ id: "b.jaws", name: "Jaws" }], ...links });
    const strike = (id, name, bonus) => ({ id, name, kind: "strike", cost: 1, bonus, maps: [0, -5, -10], melee: true, reach: 5, damage: [parseFormula("1d6+4", "piercing")] });
    const traits = { tactical: { base: 60, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
    const unit = over => ({ kind: "npc", level: 4, hp: { value: 300, max: 300 }, defenses: { ac: 18, fortitude: 10, reflex: 10, will: 6 }, initiative: { mod: 5 }, speeds: { walk: 25 }, iwr: {}, flags: { fearless: true }, diesAtZero: true, traits, ...over });
    const spec = { combatants: [unit({ id: "b", name: "Bog Strider", side: "hostile", actions: [strike("b.jaws", "Jaws", 16)], reactions: [snap] }), unit({ id: "h", name: "Hero", side: "friendly", actions: [strike("h.sword", "Sword", 10)] })],
      sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: false, maxRounds: 3 } };
    let feared = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const log = replay(spec, pf2eRules, seed).log;
      log.forEach((e, i) => {
        if ( e.type !== "reaction" || e.reaction !== "Dread Snap" ) return;
        expect(e).toMatchObject({ trigger: "ownHit", actorId: "b", targetId: "h" });
        if ( log[i + 2]?.type === "condition" ) feared += 1;
      });
    }
    expect(feared).toBeGreaterThan(2);
  });
});
