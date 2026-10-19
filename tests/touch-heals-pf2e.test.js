/**
 * A champion's touch that heals one kind of creature and harms the other (touch-heals.js, by slug: Lay on Hands, Touch of
 * the Void): its healing and its harm are only in its variants, and its linked effect is no buff for the caster. Built
 * as what it does: a heal by touch of so many hit points at the rank it's cast at, Lay on Hands' +2 AC on another it
 * heals alone (the core's notSelf); a basic Fortitude save of its harming variant, -2 AC on a failure. Never a buff the
 * champion lays on itself. The Statistics Engine heals a hurt friend with it, and doesn't spend it on itself unhurt. In a
 * live battle: its variant's card, and the harm's damage rolled from its variant.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { pf2eRules } from "../scripts/rules.js";
import { TOUCH_HEALS, variantOf, touchOverlay, touchHealActions } from "../scripts/touch-heals.js";
import { asUsed, usePf2eAction, rollPf2eDamage } from "../scripts/action-roll.js";
import { beginLive, liveRound, liveTurn, NeedsDecision } from "../../FastFighting/scripts/engine/live.js";
import { meanPart } from "../../FastFighting/scripts/engine/dice.js";

/** The effect Lay on Hands links: +2 status AC, and the undead's -2 in its place (PF2e's rule elements, as it has them). */
const LOH_EFFECT = "Compendium.pf2e.spell-effects.Item.lyLMiauxIVUM3oF1";
const lohEffect = {
  documentName: "Item", type: "effect", name: "Spell Effect: Lay on Hands", uuid: LOH_EFFECT,
  system: { rules: [{ key: "FlatModifier", selector: "ac", type: "status", value: 2 }, { key: "AdjustModifier", mode: "downgrade", predicate: ["self:mode:undead"], selector: "ac", value: -2 }] }
};

/** A touch spell's data as PF2e 8.6.1 holds it: no damage of its own, a healing variant and a harming one. */
function touchSystem(slug, { heals = "vitality", harms = "vitality", effect = LOH_EFFECT } = {}) {
  return {
    slug, level: { value: 1 }, time: { value: "1" }, range: { value: "touch" }, target: { value: "" }, damage: {}, defense: null, area: null,
    traits: { value: ["champion", "focus", "manipulate", heals === "vitality" ? "healing" : "void", heals].filter((x, i, a) => a.indexOf(x) === i) },
    duration: { value: "" }, location: {},
    description: { value: effect ? `<p>@UUID[${effect}]{Spell Effect}</p>` : "" },
    overlays: {
      harm: { name: "Vs.", overlayType: "override", sort: 2, system: {
        damage: { d1: { formula: "1d6", kinds: ["damage"], type: harms } }, defense: { save: { basic: true, statistic: "fortitude" } },
        heightening: { damage: { d1: "1d6" }, interval: 1, type: "interval" } } },
      heal: { name: "Healing", overlayType: "override", sort: 1, system: {
        damage: { h1: { formula: "6", kinds: ["healing"], type: heals } }, defense: null,
        heightening: { damage: { h1: "6" }, interval: 1, type: "interval" } } }
    }
  };
}

describe("its variants, at the rank it's cast at", () => {
  test("the heal: 6 at rank 1, 12 at rank 2, 30 at rank 5; the harm: 1d6 a rank, a basic Fortitude save", () => {
    const sys = touchSystem("lay-on-hands");
    expect(variantOf(sys, "healing", 1).parts).toEqual([expect.objectContaining({ dice: [], flat: 6, type: "healing" })]);
    expect(variantOf(sys, "healing", 2).parts[0].flat).toBe(12);
    expect(variantOf(sys, "healing", 5).parts[0].flat).toBe(30);
    const harm = variantOf(sys, "damage", 3);
    expect(harm).toMatchObject({ id: "harm", save: { statistic: "fortitude", basic: true } });
    expect(harm.parts[0]).toMatchObject({ dice: [{ n: 3, faces: 6 }], flat: 0, type: "vitality" });
    expect(variantOf({ overlays: {} }, "healing", 1)).toBeNull();
  });

  test("the overlay each use shows: the heal's, the harm's; none for another spell, or one with damage of its own", () => {
    const spell = { slug: "lay-on-hands", rank: 1, system: touchSystem("lay-on-hands") };
    expect(touchOverlay(spell, "a.spell.loh")).toBe("heal");
    expect(touchOverlay(spell, "a.spell.loh.harm")).toBe("harm");
    expect(touchOverlay({ ...spell, slug: "heal" }, "a.spell.loh")).toBeNull();
    expect(touchOverlay({ ...spell, system: { ...spell.system, damage: { x: { formula: "1d8" } } } }, "a.spell.loh")).toBeNull();
  });
});

describe("built as what it does (touchHealActions)", () => {
  const base = { id: "seelah.spell.loh", name: "Lay on Hands", cost: 1, resource: "focus", pool: 1, spellId: "loh", rank: 1, traits: ["champion", "healing", "vitality"], hands: 1 };
  const build = (slug, rank, extra = {}) => touchHealActions({ slug, system: touchSystem(slug), rank, base: { ...base, rank }, dc: 17, ward: { mods: { ac: 2 } }, effectRef: { uuids: [LOH_EFFECT] }, label: "+2 AC", failedLabel: "-2 AC", ...extra });

  test("Lay on Hands: a heal by touch, 6 a rank, +2 AC for 1 round on another alone; a touch that harms with a basic Fortitude save", () => {
    const [heal, harm] = build("lay-on-hands", 1);
    expect(heal).toMatchObject({ id: "seelah.spell.loh", kind: "heal", reach: 5, resource: "focus", heal: [expect.objectContaining({ flat: 6, type: "healing" })] });
    expect(heal.outcome).toEqual({ mods: { ac: 2 }, rounds: 1, label: "+2 AC", notSelf: true });
    expect(heal.effectRef).toEqual({ uuids: [LOH_EFFECT] });
    expect(build("lay-on-hands", 2)[0].heal[0].flat).toBe(12);
    expect(harm).toMatchObject({ id: "seelah.spell.loh.harm", kind: "save", melee: true, reach: 5, save: { type: "fortitude", dc: 17, basic: true } });
    expect(harm.damage[0]).toMatchObject({ dice: [{ n: 1, faces: 6 }], type: "vitality" });
    expect(harm.effects).toEqual([{ kind: "condition", mods: { ac: -2 }, rounds: 1, label: "-2 AC", critOnly: false }]);
  });

  test("never a buff: no action it builds is one, and none lays anything on its caster", () => {
    for ( const slug of Object.keys(TOUCH_HEALS) ) {
      for ( const a of build(slug, 1) ) {
        expect(a.kind).not.toBe("buff");
        if ( a.outcome ) expect(a.outcome.notSelf).toBe(true);
      }
    }
  });

  test("Touch of the Void: its heal lends no bonus to another (its effect's is the caster's own, left out)", () => {
    const [heal] = build("touch-of-the-void", 1);
    expect(heal.kind).toBe("heal");
    expect(heal.outcome).toBeUndefined();
  });
});

describe("read from an actor's sheet (Pf2eAdapter)", () => {
  const was = { fromUuid: globalThis.fromUuid, CONFIG: globalThis.CONFIG };
  beforeEach(() => {
    globalThis.fromUuid = async uuid => (uuid === LOH_EFFECT ? lohEffect : null);
    globalThis.CONFIG = { PF2E: {} };
  });
  afterEach(() => Object.assign(globalThis, was));

  const spell = (rank, slug = "lay-on-hands") => ({
    id: slug, name: slug, slug, rank, isCantrip: false, isFocusSpell: true, isAttack: false, system: touchSystem(slug, slug === "touch-of-the-void" ? { heals: "void", harms: "void", effect: null } : {}),
    getDamage: async () => null
  });
  const champion = rank => ({
    id: "seelah", uuid: "Actor.seelah", type: "npc", name: "Seelah", img: "", level: 2 * rank - 1, items: [],
    itemTypes: { condition: [], consumable: [], feat: [], action: [] },
    system: {
      attributes: { hp: { value: 20, max: 20, temp: 0 }, ac: { value: 18 } }, traits: { value: ["human", "humanoid"], size: { value: "med" }, rarity: "common" },
      details: { languages: { value: ["common"] } }, movement: { speeds: { land: 25 } }, abilities: {}, resources: { focus: { value: 1, max: 1 } }, skills: {}, actions: []
    },
    skills: { athletics: { mod: 7 } }, saves: { fortitude: { mod: 7 }, reflex: { mod: 4 }, will: { mod: 6, dc: { value: 16 } } }, perception: { mod: 6, dc: { value: 16 }, senses: [] },
    initiative: { mod: 6 }, attributes: {},
    spellcasting: { regular: [{ id: "focus", tradition: "divine", statistic: { dc: { value: 17 }, check: { mod: 7 } }, system: { prepared: { value: "focus" } },
      spells: { contents: [spell(rank), spell(rank, "touch-of-the-void")] } }] }
  });
  const read = async rank => new Pf2eAdapter().toCombatantSpec({ id: "t1", name: "Seelah", actor: champion(rank), texture: { src: "" } });

  test("Lay on Hands as a heal of 6 at rank 1 (12 at rank 2), +2 AC for another alone, its effect for the sheet; its harm", async () => {
    const spec = await read(1);
    const byId = Object.fromEntries(spec.actions.map(a => [a.id, a]));
    const heal = byId["seelah.spell.lay-on-hands"];
    expect(heal).toMatchObject({ kind: "heal", cost: 1, reach: 5, resource: "focus", rank: 1 });
    expect(heal.heal.reduce((s, p) => s + meanPart(p), 0)).toBe(6);
    expect(heal.outcome).toMatchObject({ mods: { ac: 2 }, rounds: 1, notSelf: true });
    expect(heal.effectRef).toEqual({ uuids: [LOH_EFFECT] });
    expect(byId["seelah.spell.lay-on-hands.harm"]).toMatchObject({ kind: "save", save: { type: "fortitude", basic: true, dc: 17 } });
    // (Never a buff, on itself or anyone: the effect alone isn't the spell.)
    expect(spec.actions.some(a => a.kind === "buff" && a.id.includes("lay-on-hands"))).toBe(false);
    const twelve = (await read(2)).actions.find(a => a.id === "seelah.spell.lay-on-hands");
    expect(twelve.heal.reduce((s, p) => s + meanPart(p), 0)).toBe(12);
  });

  test("whom it mends, as PF2e's vitality and void have it: Lay on Hands the living, Touch of the Void the undead", async () => {
    const spec = await read(1);
    const lay = spec.actions.find(a => a.id === "seelah.spell.lay-on-hands");
    const touch = spec.actions.find(a => a.id === "seelah.spell.touch-of-the-void");
    const living = { spec: {} };
    const undead = { spec: { voidHealing: true } };
    expect([pf2eRules.usable(null, {}, lay, living), pf2eRules.usable(null, {}, lay, undead)]).toEqual([true, false]);
    expect([pf2eRules.usable(null, {}, touch, living), pf2eRules.usable(null, {}, touch, undead)]).toEqual([false, true]);
  });
});

describe("the Statistics Engine with it (the helper's rules)", () => {
  const touchHeal = touchHealActions({
    slug: "lay-on-hands", system: touchSystem("lay-on-hands"), rank: 1, dc: 17, ward: { mods: { ac: 2 } }, effectRef: { uuids: [LOH_EFFECT] }, label: "+2 AC", failedLabel: "-2 AC",
    base: { id: "seelah.spell.loh", name: "Lay on Hands", cost: 1, resource: "focus", spellId: "loh", rank: 1, traits: ["champion", "healing", "manipulate", "vitality"], hands: 1 }
  });
  const at = x => ({ x, y: 0, size: 5 });
  const creature = (id, extra) => ({
    id, name: id, side: "friendly", kind: "pc", level: 1, hp: { value: 20, max: 20, temp: 0 }, defenses: { ac: 18, fortitude: 7, reflex: 4, will: 6 },
    initiative: { mod: 5 }, speeds: { walk: 25 }, actions: [], iwr: {}, flags: {}, diesAtZero: false,
    traits: { tactical: { base: 60, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } }, ...extra
  });
  /** Seelah, played by FastFighting, with one focus point; Lem beside her; a goblin far off. */
  function setUp({ seelah = 20, lem = 20 } = {}) {
    return () => {
      const run = beginLive({
        combatants: [
          creature("seelah", { position: at(0), hp: { value: seelah, max: 20, temp: 0 }, actions: touchHeal, resources: { focus: 1 } }),
          creature("lem", { position: at(5), hp: { value: lem, max: 20, temp: 0 } }),
          creature("goblin", { side: "hostile", kind: "npc", position: at(600) })
        ],
        sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Enemies", enemies: ["friendly"] } },
        options: { positioning: true, maxRounds: 3 }
      }, pf2eRules, { seed: 4, players: ["lem"], systemRolls: [] });
      liveRound(run, 1);
      return run;
    };
  }
  function play(build) {
    const answers = [];
    for ( let tries = 0; tries < 40; tries++ ) {
      const run = build();
      try {
        const result = liveTurn(run, "seelah", { answers, nonce: 2 });
        return { run, result };
      } catch ( err ) {
        if ( !(err instanceof NeedsDecision) ) throw err;
        answers.push([err.request.key, null]);
      }
    }
    throw new Error("a turn that never stops asking");
  }

  test("a friend hurt: it heals the friend, 6, and the friend gets +2 AC", () => {
    const { run, result } = play(setUp({ lem: 6 }));
    const heal = result.events.find(e => e.type === "heal");
    expect(heal).toMatchObject({ actorId: "seelah", targetId: "lem", amount: 6 });
    const lem = run.byId.get("lem");
    expect(lem.hp).toBe(12);
    expect(lem.effects.find(e => e.key === "seelah.spell.loh")).toMatchObject({ mods: { ac: 2 }, sourceId: "seelah" });
    expect(run.byId.get("seelah").resources.focus).toBe(0);
  });

  test("itself hurt: it heals itself, and lays no AC on itself", () => {
    const { run, result } = play(setUp({ seelah: 6 }));
    expect(result.events.find(e => e.type === "heal")).toMatchObject({ targetId: "seelah", amount: 6 });
    expect(run.byId.get("seelah").effects.some(e => e.key === "seelah.spell.loh")).toBe(false);
  });

  test("everyone at full health: its focus point kept, no AC on itself", () => {
    const { run, result } = play(setUp());
    expect(result.events.some(e => e.type === "heal" || e.type === "buff")).toBe(false);
    expect(run.byId.get("seelah").resources.focus).toBe(1);
    expect(run.byId.get("seelah").effects.some(e => e.key === "seelah.spell.loh")).toBe(false);
  });
});

describe("in a live battle: its variant's card, and the harm's damage from its variant", () => {
  const was = { game: globalThis.game };
  afterEach(() => { globalThis.game = was.game; });

  /** A spell on a sheet: PF2e's loadVariant gives the variant, as a spell of its own (its own card, its own damage). */
  function sheetSpell() {
    const calls = [];
    const variant = id => ({
      id: "loh", type: "spell", rank: 2, slug: "lay-on-hands", system: { ...touchSystem("lay-on-hands"), damage: touchSystem("lay-on-hands").overlays[id].system.damage },
      toMessage: async (event, options) => { calls.push({ shown: id, options }); return { id: `card-${id}` }; },
      rollDamage: async () => { calls.push({ rolled: id }); return null; }
    });
    const spell = {
      id: "loh", type: "spell", rank: 2, slug: "lay-on-hands", system: touchSystem("lay-on-hands"),
      loadVariant: ({ overlayIds, castRank }) => { calls.push({ loaded: overlayIds, castRank }); return variant(overlayIds[0]); },
      toMessage: async () => { calls.push({ shown: "base" }); return { id: "card-base" }; }
    };
    return { spell, calls, actor: { id: "seelah", items: new Map([["loh", spell]]) } };
  }

  test("the heal shows its healing variant's card, at the rank it's cast at; the harm, its harming variant's", async () => {
    globalThis.game = { ...was.game, user: { isGM: true }, messages: { contents: [] } };
    const { spell, calls, actor } = sheetSpell();
    expect(asUsed(spell, "seelah.spell.loh").system.damage.h1).toBeDefined();
    calls.length = 0;
    expect(await usePf2eAction({ actor }, { action: { id: "seelah.spell.loh" } })).toEqual({ card: "card-heal" });
    expect(calls).toEqual([{ loaded: ["heal"], castRank: 2 }, { shown: "heal", options: { actualCast: true, data: { castRank: 2 } } }]);
    calls.length = 0;
    expect(await usePf2eAction({ actor }, { action: { id: "seelah.spell.loh.harm" } })).toEqual({ card: "card-harm" });
    expect(calls[0]).toEqual({ loaded: ["harm"], castRank: 2 });
    // (The harm's damage, rolled from its variant: PF2e's own card for it.)
    calls.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await rollPf2eDamage({ actor }, { action: { id: "seelah.spell.loh.harm" } });
    expect(calls).toContainEqual({ rolled: "harm" });
  });

  test("another spell as it is", () => {
    const heal = { id: "heal", type: "spell", slug: "heal", rank: 1, system: { damage: { a: {} } }, loadVariant: () => { throw new Error("not this one"); } };
    expect(asUsed(heal, "a.spell.heal")).toBe(heal);
  });
});
