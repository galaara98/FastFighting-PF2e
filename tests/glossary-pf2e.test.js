/**
 * The standard creature abilities by slug (glossary.js): Draconic Frenzy, Rend and Pounce from a creature's own
 * Strikes, Constrict on a creature it holds, Draconic Momentum's breath, the passives on its spec, and what has no
 * effect in a fight. Played in the core engine with PF2e's rules. The texts here are made up in the shape PF2e writes
 * them.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { setReading } from "../scripts/reading.js";
import { NO_FIGHT_EFFECT, PLAYED_ELSEWHERE, GLOSSARY_SLUGS, countedStrikes, frenzyAction, rendAction, pounceAction, glossaryActions, markGlossary, glossarySpec } from "../scripts/glossary.js";
import { parseFormula } from "../scripts/core.js";
import { pf2eRules } from "../scripts/rules.js";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { replay } from "../../fast-fighting/scripts/engine/simulator.js";

const english = JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8"));
beforeEach(() => setReading(english));

const strike = (slug, name, over = {}) => ({ id: `wyrm.strike.${slug}.0`, slug, name, kind: "strike", cost: 1, bonus: 15, maps: [0, -5, -10], melee: true, reach: 10, traits: [],
  hands: 0, damage: [parseFormula("2d8+8", "piercing")], ...over });
const jaws = strike("jaws", "Jaws", { reach: 15 });
const claw = strike("claw", "Claw", { maps: [0, -4, -8], traits: ["agile"], hands: 1, damage: [parseFormula("2d6+8", "slashing")] });
const tail = strike("tail", "Tail", { reach: 20, damage: [parseFormula("2d6+6", "bludgeoning")] });
const ability = (slug, html, over = {}) => ({ id: `${slug}-item`, slug, name: slug, html, actions: 1, ...over });

describe("Draconic Frenzy", () => {
  test("the Strikes its text counts, the non-agile first; each part the Strike it's made with; two actions", () => {
    expect(countedStrikes("<p>The wyrm makes two claw Strikes and one jaws Strike in any order.</p>")).toEqual([{ n: 2, name: "claw" }, { n: 1, name: "jaws" }]);
    const a = frenzyAction({ actorId: "wyrm", strikes: [jaws, claw, tail], ability: ability("draconic-frenzy", "<p>The wyrm makes two claw Strikes and one jaws Strike in any order.</p>", { actions: 2 }) });
    expect(a.cost).toBe(2);
    expect(a.sequence.map(s => s.name)).toEqual(["Jaws", "Claw", "Claw"]);
    expect(a.sequence.map(s => s.from)).toEqual([jaws.id, claw.id, claw.id]);
    expect(new Set(a.sequence.map(s => s.id)).size).toBe(3);
    expect(a.reach).toBe(10);
    expect(a.hands).toBe(1);
  });

  test("a name it hasn't a Strike for (bite, for its jaws): its best melee Strike not counted yet", () => {
    const a = frenzyAction({ actorId: "wyrm", strikes: [jaws, claw], ability: ability("draconic-frenzy", "<p>The wyrm makes one bite Strike and two claw Strikes.</p>") });
    expect(a.sequence.map(s => s.name).sort()).toEqual(["Claw", "Claw", "Jaws"]);
  });

  test("a text that counts fewer than two Strikes: nothing", () => {
    expect(frenzyAction({ actorId: "wyrm", strikes: [jaws, claw], ability: ability("draconic-frenzy", "<p>The wyrm lashes out.</p>") })).toBeNull();
  });

  test("in a fight: three Strikes for two actions, each at its own multiple attack penalty", () => {
    const frenzy = frenzyAction({ actorId: "wyrm", strikes: [jaws, claw], ability: ability("draconic-frenzy", "<p>The wyrm makes two claw Strikes and one jaws Strike.</p>", { actions: 2 }) });
    const r = replay(battle([wyrm([frenzy]), dummy()]), pf2eRules, 3);
    const mine = r.log.filter(e => e.actor === "wyrm" && e.type === "attack" && e.round === 1);
    expect(mine.map(e => [e.action, e.attackNumber])).toEqual([["Jaws", 1], ["Claw", 2], ["Claw", 3]]);
    expect(mine[0].mod - mine[1].mod).toBe(15 - 11);
    expect(mine[0].mod - mine[2].mod).toBe(15 - 7);
  });
});

/** A dragon-ish creature, and a foe that takes a beating. */
const wyrm = actions => ({ id: "wyrm", name: "wyrm", side: "hostile", kind: "npc", level: 8, hp: { value: 300, max: 300 }, defenses: { ac: 27, fortitude: 18, reflex: 16, will: 15 },
  initiative: { mod: 30 }, speeds: { walk: 40 }, actions, iwr: {}, flags: { fearless: true }, diesAtZero: true,
  traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } } });
const dummy = () => ({ id: "dummy", name: "dummy", side: "friendly", kind: "npc", level: 1, hp: { value: 900, max: 900 }, defenses: { ac: 22, fortitude: 5, reflex: 5, will: 5 },
  initiative: { mod: 0 }, speeds: { walk: 25 }, actions: [strike("fist", "Fist", { id: "dummy.fist", bonus: 0, damage: [parseFormula("1", "bludgeoning")] })], iwr: {}, flags: { fearless: true }, diesAtZero: true,
  traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } } });
const battle = list => ({ combatants: list, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: false, maxRounds: 3 } });

describe("Rend", () => {
  test("the Strike its entry names: that damage, no roll, after two hits in a row with it", () => {
    const a = rendAction({ actorId: "wyrm", strikes: [jaws, claw], ability: ability("rend", "<p>Claw</p><hr /><p>@Localize[PF2E.NPC.Abilities.Glossary.Rend]</p>") });
    expect(a).toMatchObject({ kind: "auto", cost: 1, damage: claw.damage, reach: 10, requires: { hits: { n: 2, with: [claw.id] } } });
    // (A label before the name, or only its own words to go by.)
    expect(rendAction({ actorId: "wyrm", strikes: [jaws, claw], ability: ability("rend", "<p>Strike: Claw</p>") }).requires.hits.with).toEqual([claw.id]);
    expect(rendAction({ actorId: "wyrm", strikes: [jaws, claw], ability: ability("rend", "<p>After two claw Strikes on one foe, it tears.</p>") }).requires.hits.with).toEqual([claw.id]);
    expect(rendAction({ actorId: "wyrm", strikes: [jaws], ability: ability("rend", "<p>Horn</p>") })).toBeNull();
  });

  test("in a fight: only after two claw hits on the one it tears", () => {
    const rend = rendAction({ actorId: "wyrm", strikes: [claw], ability: ability("rend", "<p>Claw</p>") });
    let rends = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(battle([wyrm([{ ...claw, bonus: 18 }, rend]), dummy()]), pf2eRules, seed);
      const mine = r.log.filter(e => e.actor === "wyrm" && ["attack", "auto"].includes(e.type));
      mine.forEach((e, i) => {
        if ( e.type !== "auto" ) return;
        rends += 1;
        expect(mine.slice(i - 2, i).every(x => x.action === "Claw" && x.degree >= 2 && x.round === e.round)).toBe(true);
      });
    }
    expect(rends).toBeGreaterThan(3);
  });
});

describe("Pounce", () => {
  test("a Stride and its best melee Strike, one action, counting as that Strike", () => {
    const a = pounceAction({ strikes: [jaws, claw, { ...tail, melee: false, range: { increment: 30 } }], ability: ability("pounce", "<p>It Strides and Strikes.</p>") });
    expect(a).toMatchObject({ cost: 1, charge: 1, from: jaws.id, id: `${jaws.id}.pounce`, damage: jaws.damage });
  });
});

describe("what a slug says of an action read already", () => {
  test("Constrict, only on a creature it holds; Draconic Momentum, its breath back on a critical hit", () => {
    const actions = [
      { id: "wyrm.c", itemId: "constrict-item", kind: "save", save: { type: "fortitude", dc: 25, basic: true } },
      { id: "wyrm.b", itemId: "breath-item", kind: "save", uses: 1, cooldown: { n: 1, faces: 4 } },
      { id: "wyrm.s", itemId: "spray-item", kind: "save", uses: 1, cooldown: { n: 1, faces: 4 } }
    ];
    markGlossary(actions, [ability("constrict", ""), ability("draconic-momentum", "")], [{ id: "breath-item", slug: "frost-breath" }, { id: "spray-item", slug: "acid-spray" }]);
    expect(actions[0].requires).toEqual({ holding: true });
    expect(actions[1].rechargeOnCrit).toBe(true);
    expect(actions[2].rechargeOnCrit).toBeUndefined();
  });
});

describe("its passives, on the spec", () => {
  test("swarm mind, camouflage, slow as its text says, light blindness only in a bright scene, every language", () => {
    const passives = [ability("swarm-mind", ""), ability("camouflage", ""), ability("slow", "<p>It is always slowed 2.</p>"), ability("light-blindness", "")];
    expect(glossarySpec({ abilities: passives, bright: true, constant: ["tongues"] })).toEqual({ swarmMind: true, camouflage: true, conditions: { slowed: 2, dazzled: 1 }, anyLanguage: true });
    expect(glossarySpec({ abilities: [ability("light-blindness", "")], bright: false })).toEqual({});
  });

  test("the rules: swarm mind shrugs off a mental effect that picks it out, not one over an area; camouflage hides without cover", () => {
    const swarm = { spec: { swarmMind: true, iwr: {} } };
    expect(pf2eRules.isImmune(swarm, { traits: ["mental"], onSave: [{ conditions: { frightened: 1 } }] })).toBe(true);
    expect(pf2eRules.isImmune(swarm, { traits: ["mental"], area: { targets: 3 }, onSave: [{ conditions: { frightened: 1 } }] })).toBe(false);
    expect(pf2eRules.usable({ units: [] }, { spec: { camouflage: true }, conds: {} }, { hide: true }, null)).toBe(true);
  });

  test("surprise attack: a foe that hasn't acted yet is off-guard to it, and not once it has", () => {
    expect(glossarySpec({ abilities: [ability("surprise-attack", "")] })).toEqual({ surpriseAttack: true });
    const ctx = turns => ({ target: { conds: {}, turnsTaken: turns }, attacker: { spec: { surpriseAttack: true }, conds: {} } });
    expect(pf2eRules.modifiers.exposed(ctx(0))).toBe(true);
    expect(pf2eRules.modifiers.exposed(ctx(1))).toBe(false);
  });
});

describe("what needs nothing more", () => {
  test("the lists don't overlap the abilities read by slug", () => {
    for ( const slug of [...NO_FIGHT_EFFECT, ...PLAYED_ELSEWHERE] ) expect(GLOSSARY_SLUGS.has(slug)).toBe(false);
    expect(NO_FIGHT_EFFECT.has("telepathy")).toBe(true);
    expect(PLAYED_ELSEWHERE.has("throw-rock")).toBe(true);
  });
});

describe("the adapter", () => {
  const before = { CONFIG: globalThis.CONFIG };
  afterEach(() => { globalThis.CONFIG = before.CONFIG; });

  const strikeData = (label, slug, mod, traits) => ({ type: "strike", label, slug, totalModifier: mod, visible: true, ready: true,
    item: { type: "melee", system: { traits: { value: traits } } }, damage: async () => "2d8+8 piercing", critical: async () => "4d8+16 piercing" });
  const item = (id, slug, name, html, actions = 1, type = "action") => ({ id, type, name, slug, system: { slug, actionType: { value: actions ? "action" : "passive" }, actions: { value: actions },
    description: { value: html }, traits: { value: [] } } });
  const drake = () => ({
    id: "drake", uuid: "Actor.drake", type: "npc", name: "Drake", img: "", level: 6,
    items: [
      item("f", "draconic-frenzy", "Draconic Frenzy", "<p>The drake makes two claw Strikes and one jaws Strike in any order.</p>", 2),
      item("c", "constrict", "Constrict", "<p>@Damage[(2d6+6)[bludgeoning]] @Check[fortitude|dc:24|basic]</p><hr /><p>@Localize[PF2E.NPC.Abilities.Glossary.Constrict]</p>"),
      item("s", "swarm-mind", "Swarm Mind", "<p>@Localize[PF2E.NPC.Abilities.Glossary.SwarmMind]</p>", null)
    ],
    itemTypes: { condition: [], consumable: [], feat: [], action: [] },
    system: {
      attributes: { hp: { value: 90, max: 90, temp: 0 }, ac: { value: 24 } },
      traits: { value: ["dragon"], size: { value: "lg" }, rarity: "common" },
      details: { languages: { value: ["draconic"] } },
      movement: { speeds: { land: 30 } },
      abilities: {}, resources: {}, skills: {},
      actions: [strikeData("Jaws", "jaws", 16, ["unarmed"]), strikeData("Claw", "claw", 16, ["agile", "unarmed"])]
    },
    skills: {}, saves: { fortitude: { mod: 14 }, reflex: { mod: 12 }, will: { mod: 10, dc: { value: 20 } } },
    perception: { mod: 12, dc: { value: 22 }, senses: [] }, initiative: { mod: 12 }, attributes: {}, spellcasting: { regular: [] }
  });

  test("its frenzy from its Strikes, its constrict on a creature it holds, its swarm mind on the spec", async () => {
    globalThis.CONFIG = { PF2E: {} };
    const spec = await new Pf2eAdapter().toCombatantSpec({ id: "t1", name: "Drake", actor: drake(), texture: { src: "" } });
    const frenzy = spec.actions.find(a => a.id === "drake.f");
    expect(frenzy.sequence.map(s => s.from)).toEqual(["drake.strike.jaws.0", "drake.strike.claw.1", "drake.strike.claw.1"]);
    expect(spec.actions.find(a => a.id === "drake.c")).toMatchObject({ kind: "save", requires: { holding: true } });
    expect(spec.swarmMind).toBe(true);
  });
});
