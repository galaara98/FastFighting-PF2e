/**
 * A champion's reactions for an ally (champion.js), by slug: both the ally and the foe in its champion's aura, read from
 * the sheet (PF2e's Aura, the flag that sizes it, else 15 feet); the blow lessened by the resistance the effect its card
 * links gives, worked out as PF2e does (2 + the champion's level), and laid by PF2e's own application in a live battle
 * (`applies`); Retributive Strike's Strike, and with Nimble Reprisal a shot or a Step first.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AURA_REACTIONS, championAura, championReaction } from "../scripts/champion.js";
import { grantedResistance, resistanceOf } from "../scripts/granted.js";
import { part } from "../scripts/core.js";
import { beginRun, prepareBattle } from "../../fast-fighting/scripts/engine/simulator.js";
import { respond } from "../../fast-fighting/scripts/engine/behavior/responses.js";
import { pf2eRules } from "../scripts/rules.js";

// (Linked documents, as fromUuid finds them: PF2e's Champion's Resistance, a spell, effects that don't resist, or can't
// be laid for one blow.)
const RESISTANCE = "Compendium.pf2e.feat-effects.Item.DawVHfoPKbPJsz4k";
const LINKED = {
  [RESISTANCE]: { documentName: "Item", type: "effect", system: { rules: [{ key: "Resistance", type: "all-damage", value: "@item.origin.level+2" }] } },
  "Compendium.pf2e.spells-srd.Item.light": { documentName: "Item", type: "spell", system: {} },
  "Item.faster": { documentName: "Item", type: "effect", system: { rules: [{ key: "FlatModifier", selector: "land-speed", value: 5 }] } },
  "Item.only-fire": { documentName: "Item", type: "effect", system: { rules: [{ key: "Resistance", type: "fire", value: 5 }] } },
  "Item.sometimes": { documentName: "Item", type: "effect", system: { rules: [{ key: "Resistance", type: "all-damage", value: 5, predicate: ["self:trait:orc"] }] } },
  "Item.choosing": { documentName: "Item", type: "effect", system: { rules: [{ key: "ChoiceSet", choices: [] }, { key: "Resistance", type: "all-damage", value: 5 }] } }
};
const was = { fromUuid: globalThis.fromUuid };
beforeAll(() => { globalThis.fromUuid = async uuid => LINKED[uuid] ?? null; });
afterAll(() => { globalThis.fromUuid = was.fromUuid; });

/** A reaction on a champion's sheet, its card linking these. */
const reaction = (slug, id, links = []) => ({ id, slug, name: slug, type: "action",
  system: { slug, description: { value: links.map(u => `<p>@UUID[${u}]{Effect}</p>`).join("") }, traits: { value: ["champion", "divine"] } } });

/** A champion: its aura as PF2e prepares it (actor.auras, by slug) and the flag that sizes it. */
const champion = ({ level = 1, aura = null, flag = null } = {}) => ({
  id: "seelah", level, auras: new Map(aura ? [["champions-aura", { slug: "champions-aura", radius: aura }]] : []),
  flags: { system: flag ? { champion: { aura: flag } } : {} }
});

const build = (actor, item, slugs = []) => championReaction(actor, item, { slug: item.slug, slugs: new Set([item.slug, ...slugs]) });

describe("its champion's aura", () => {
  test("PF2e's own (Champion's Aura's Aura rule element, Expand Aura's 30 feet); the flag that sizes it while it's off; else 15 feet", () => {
    expect(championAura(champion({ aura: 15, flag: 15 }))).toBe(15);
    expect(championAura(champion({ aura: 30, flag: 30 }))).toBe(30);
    expect(championAura(champion({ flag: 30 }))).toBe(30);
    expect(championAura(champion())).toBe(15);
    expect(championAura({})).toBe(15);
  });
});

describe("a champion's reaction for an ally, by slug", () => {
  test("Retributive Strike: the ally and the foe in its aura; the effect its card links resists the blow, laid by PF2e; a Strike back", async () => {
    const r = await build(champion({ aura: 15 }), reaction("retributive-strike", "rs", [RESISTANCE]));
    expect(r).toEqual({ id: "seelah.retributive-strike", label: "retributive-strike", on: "allyHit", range: 15, byRange: 15, reduce: part([], 3), applies: "effect:rs", strike: true });
    // (Expand Aura: both may be farther.)
    expect(await build(champion({ aura: 30 }), reaction("retributive-strike", "rs", [RESISTANCE]))).toMatchObject({ range: 30, byRange: 30 });
  });

  test("its resistance, as Champion's Resistance has it (its origin's level + 2): the engine's sum matches what PF2e will lay", async () => {
    for ( const level of [1, 7, 20] ) {
      const r = await build(champion({ level }), reaction("retributive-strike", "rs", [RESISTANCE]));
      expect(r.reduce).toEqual(part([], 2 + level));
      expect(resistanceOf(LINKED[RESISTANCE], level)).toBe(2 + level);
    }
  });

  test("Nimble Reprisal: a shot at a foe out of reach instead, or a Step first; only for Retributive Strike", async () => {
    expect(await build(champion(), reaction("retributive-strike", "rs", [RESISTANCE]), ["nimble-reprisal"])).toMatchObject({ strike: true, strikeRanged: true, strikeStep: 5 });
    const glimpse = await build(champion(), reaction("glimpse-of-redemption", "gr", [RESISTANCE]), ["nimble-reprisal"]);
    expect(glimpse).not.toHaveProperty("strike");
    expect(glimpse).not.toHaveProperty("strikeRanged");
  });

  test("the other causes' (Glimpse of Redemption, Liberating Step, Flash of Grandeur): the resistance alone; a spell its card links is passed over", async () => {
    for ( const slug of ["glimpse-of-redemption", "liberating-step", "flash-of-grandeur"] ) {
      const r = await build(champion({ aura: 15 }), reaction(slug, "x", ["Compendium.pf2e.spells-srd.Item.light", RESISTANCE]));
      expect(r).toEqual({ id: `seelah.${slug}`, label: slug, on: "allyHit", range: 15, byRange: 15, reduce: part([], 3), applies: "effect:x" });
    }
    expect([...AURA_REACTIONS].sort()).toEqual(["flash-of-grandeur", "glimpse-of-redemption", "liberating-step", "retributive-strike"]);
  });

  test("no effect to lay (none linked, or one that doesn't resist all damage whenever it's on, or can't be laid for one blow): 2 + its level, the engine's sum", async () => {
    for ( const links of [[], ["Item.faster"], ["Item.only-fire"], ["Item.sometimes"], ["Item.choosing"], ["Item.gone"]] ) {
      const r = await build(champion({ level: 4 }), reaction("liberating-step", "ls", links));
      expect(r.reduce).toEqual(part([], 6));
      expect(r).not.toHaveProperty("applies");
    }
  });

  test("any other reaction, or none: not a champion's for an ally", async () => {
    expect(await build(champion(), reaction("selfish-shield", "ss", [RESISTANCE]))).toBeNull();
    expect(await championReaction(champion(), reaction("retributive-strike", "rs"), {})).toBeNull();
    expect(await grantedResistance(null)).toBeNull();
  });
});

describe("in a fight: both the ally and the foe in the aura", () => {
  const unit = (id, side, x, y, more = {}) => ({ id, name: id, side, kind: "npc", level: 1, hp: { value: 60, max: 60 }, defenses: { ac: 15, fortitude: 5, reflex: 5, will: 5 },
    initiative: { mod: 2 }, speeds: { walk: 25 }, actions: [], iwr: {}, flags: { fearless: true }, diesAtZero: true, position: { x, y, size: 5 }, ...more });

  /** Seelah with her reaction, Lem 14 feet from her, a kobold `foeAt` feet off: does she answer the kobold's hit on Lem? */
  async function answers(foeAt, aura = 15) {
    const r = await build(champion({ aura }), reaction("retributive-strike", "rs", [RESISTANCE]));
    const run = beginRun(prepareBattle({ combatants: [unit("seelah", "friendly", 0, 0, { reactions: [r] }), unit("lem", "friendly", 0, 14), unit("kobold", "hostile", foeAt, 0)],
      sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: true, maxRounds: 3, aftermath: "none" } }, pf2eRules), 1, { log: true });
    const by = id => run.byId.get(id);
    return !!respond(run, by("seelah"), "allyHit", { by: by("kobold"), ally: by("lem"), damage: 6, types: ["piercing"] });
  }

  test("a kobold 72 feet away shooting Lem: no Retributive Strike; one 10 feet away: yes; 25 feet, only with her aura expanded", async () => {
    expect(await answers(72)).toBe(false);
    expect(await answers(10)).toBe(true);
    expect(await answers(25)).toBe(false);
    expect(await answers(25, 30)).toBe(true);
  });
});
