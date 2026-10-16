import { describe, expect, test } from "vitest";
import { parseAffliction, spellAffliction } from "../scripts/afflictions.js";
import { meanPart, parseFormula } from "../scripts/core.js";
import { injuryWeapon, activationOf, poisonedStrike } from "../scripts/adapter.js";
import { beginRun, beginRound, prepareBattle, strikeOutOfTurn } from "../../fast-fighting/scripts/engine/simulator.js";
import { pf2eRules } from "../scripts/rules.js";

// Abridged from the PF2e 8.6 compendium: the Player Core's Spider Sting and Goblin Pox, the Player Core 2's Black Adder Venom.
const SPIDER_STING = `<p>You deal 1d4 piercing damage to the touched creature and afflict it with spider venom. The target must attempt a Fortitude save.</p>\n<hr />\n<p><strong>Critical Success</strong> The target is unaffected.</p>\n<p><strong>Success</strong> The target takes @Damage[1d4[poison]] damage.</p>\n<p><strong>Failure</strong> The target is afflicted with spider venom at stage 1.</p>\n<p><strong>Critical Failure</strong> The target is afflicted with spider venom at stage 2.</p>\n<hr />\n<p><strong>Spider Venom</strong> (poison)</p>\n<p><strong>Level</strong> 1</p>\n<p><strong>Maximum Duration</strong> 4 rounds</p>\n<p><strong>Stage 1</strong> 1d4 poison damage and @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 1} (1 round)</p>\n<p><strong>Stage 2</strong> 1d4 poison damage and @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 2} (1 round)</p>`;
const GOBLIN_POX = `<p>Your touch afflicts the target with goblin pox. The target must attempt a Fortitude save.</p>\n<hr />\n<p><strong>Goblin Pox</strong> (disease) <strong>Level</strong> 1; Creatures that have the goblin trait and goblin dogs are immune</p>\n<p><strong>Stage 1</strong> @UUID[x]{Sickened 1} (1 round)</p>\n<p><strong>Stage 2</strong> @UUID[x]{Sickened 1} and @UUID[y]{Slowed 1} (1 round)</p>\n<p><strong>Stage 3</strong> @UUID[x]{Sickened 1} and the creature can't reduce its Sickened value below 1 (1 day)</p>\n<hr />\n<p><strong>Critical Success</strong> The target is unaffected.</p>\n<p><strong>Success</strong> The target is @UUID[x]{Sickened 1}.</p>\n<p><strong>Failure</strong> The target is afflicted with goblin pox at stage 1.</p>\n<p><strong>Critical Failure</strong> The target is afflicted with goblin pox at stage 2.</p>`;
const ADDER = `<p>Adder venom is a simple but effective way to enhance a weapon.</p><hr /><p><strong>Activate</strong> <span class="action-glyph">2</span> (manipulate)</p>\n<p><strong>Saving Throw</strong> @Check[fortitude|dc:18|showDC:all]</p>\n<p><strong>Maximum Duration</strong> 3 rounds</p>\n<p><strong>Stage 1</strong> @Damage[1d4[poison]] damage (1 round)</p>\n<p><strong>Stage 2</strong> @Damage[1d6[poison]] damage (1 round)</p>\n<p><strong>Stage 3</strong> @Damage[1d8[poison]] damage (1 round)</p>`;

// Shape of the PF2e Monster Core Hunting Spider Venom description.
const VENOM = `<p><strong>Saving Throw</strong> @Check[fortitude|dc:16]</p><hr><p><strong>Maximum Duration</strong> 6 rounds</p>
<p><strong>Stage 1</strong> @Damage[1d4[poison]] damage and @UUID[Compendium.pf2e.conditionitems.Item.x]{Off-Guard} (1 round)</p>
<p><strong>Stage 2</strong> @Damage[1d6[poison]] damage, @UUID[Compendium.pf2e.conditionitems.Item.y]{Clumsy 1}, and off-guard (1 round)</p>
<p><strong>Stage 3</strong> 1d6 poison damage, @UUID[Compendium.pf2e.conditionitems.Item.y]{Clumsy 2}, and off-guard (1 round)</p>`;

describe("pf2e afflictions", () => {
  test("parses save, duration and stages", () => {
    const a = parseAffliction({ id: "v", name: "Hunting Spider Venom", description: VENOM, traits: ["poison"] });
    expect(a.save).toEqual({ type: "fortitude", dc: 16 });
    expect(a.maxDuration).toBe(6);
    expect(a.stages).toHaveLength(3);
    expect(a.stages[0].damage[0].type).toBe("poison");
    expect(meanPart(a.stages[0].damage[0])).toBeCloseTo(2.5);
    expect(a.stages[0].conditions).toEqual({ offGuard: true });
    expect(a.stages[1].conditions).toEqual({ offGuard: true, clumsy: 1 });
    expect(a.stages[2].conditions.clumsy).toBe(2);
    expect(a.stages[2].damage).toHaveLength(1);
    expect(meanPart(a.stages[2].damage[0])).toBeCloseTo(3.5);
  });

  test("returns null without a save", () => {
    expect(parseAffliction({ id: "x", name: "Knockdown", description: "<p>The wolf knocks its target prone.</p>" })).toBeNull();
  });

  test("diseases with day-long stages", () => {
    const text = `<p><strong>Saving Throw</strong> DC 15 Fortitude; <strong>Onset</strong> 1 day</p>
      <p><strong>Stage 1</strong> carrier with no ill effect (1 day)</p><p><strong>Stage 2</strong> enfeebled 1 (1 day)</p>`;
    const d = parseAffliction({ id: "d", name: "Filth Fever", description: text, traits: ["disease"] });
    expect(d.save).toEqual({ type: "fortitude", dc: 15 });
    expect(d.onset).toBe(14400);
    expect(d.stages[1].conditions).toEqual({ enfeebled: 1 });
    expect(d.stages[1].duration).toBe(14400);
  });
});

describe("a spell's affliction", () => {
  test("Spider Sting: its block (named, with its trait), stages worked off against the spell DC; the spell's save its exposure", () => {
    const a = spellAffliction({ id: "s", html: SPIDER_STING, name: "Spider Sting", traits: ["concentrate", "manipulate", "poison"], save: { type: "fortitude", dc: 17 } });
    expect(a).toMatchObject({ kind: "affliction", name: "Spider Venom", traits: ["poison"], save: { type: "fortitude", dc: 17 }, maxDuration: 4, bySave: true });
    expect(a.stages).toHaveLength(2);
    expect(a.stages[0]).toMatchObject({ conditions: { enfeebled: 1 }, duration: 1 });
    expect(a.stages[1].conditions).toEqual({ enfeebled: 2 });
    expect(meanPart(a.stages[0].damage[0])).toBeCloseTo(2.5);
  });

  test("Goblin Pox: a disease, its stages above its degrees (which aren't stages)", () => {
    const a = spellAffliction({ id: "g", html: GOBLIN_POX, name: "Goblin Pox", traits: ["disease"], save: { type: "fortitude", dc: 16 } });
    expect(a).toMatchObject({ name: "Goblin Pox", traits: ["disease"] });
    expect(a.stages.map(s => s.conditions)).toEqual([{ sickened: 1 }, { sickened: 1, slowed: 1 }, { sickened: 1 }]);
    expect(a.stages[2].duration).toBe(14400);
  });

  test("no stages, or no save: none", () => {
    expect(spellAffliction({ id: "x", html: "<p>A bolt of fire.</p>", save: { type: "reflex", dc: 15 } })).toBeNull();
    expect(spellAffliction({ id: "x", html: SPIDER_STING })).toBeNull();
  });
});

describe("injury poisons", () => {
  const sword = { id: "h.strike.sword.0", name: "Shortsword", kind: "strike", cost: 1, bonus: 8, melee: true, reach: 5, damage: [parseFormula("1d6+3", "piercing")], effects: [] };
  const club = { id: "h.strike.club.1", name: "Club", kind: "strike", cost: 1, bonus: 9, melee: true, reach: 5, damage: [parseFormula("1d6+4", "bludgeoning")] };
  const bomb = { id: "h.strike.bomb.2", name: "Bomb", kind: "strike", cost: 1, bonus: 9, resource: "item:b", damage: [parseFormula("2d8", "piercing")] };

  test("on its best piercing or slashing weapon (not a bomb), the poison applied first: its activation, then the Strike", () => {
    expect(injuryWeapon([club, sword, bomb])).toBe(sword);
    expect(injuryWeapon([club])).toBeNull();
    expect(activationOf(ADDER)).toBe(2);
    expect(activationOf("<p>no activation</p>")).toBe(2);
    expect(activationOf(`<p><strong>Activate</strong> <span class="action-glyph">1</span></p>`)).toBe(1);
    const poison = parseAffliction({ id: "h.poison.p", name: "Black Adder Venom", description: ADDER, traits: ["alchemical", "consumable", "injury", "poison"] });
    expect(poison).toMatchObject({ save: { type: "fortitude", dc: 18 }, maxDuration: 3 });
    const a = poisonedStrike(sword, { item: { id: "p", name: "Black Adder Venom" }, poison, quantity: 2, apply: 2 });
    expect(a).toMatchObject({ id: "h.strike.sword.0.poison.p", kind: "strike", cost: 3, resource: "item:p", pool: 2, itemId: "p", oncePerTurn: true, effects: [poison] });
    expect(a.name).toBeTruthy();
  });

  test("a hit's target saves against it (the poison's own save), and on a failure it takes hold", () => {
    const poison = parseAffliction({ id: "h.poison.p", name: "Black Adder Venom", description: ADDER, traits: ["poison"] });
    const a = poisonedStrike(sword, { item: { id: "p", name: "Black Adder Venom" }, poison, quantity: 1 });
    const unit = (id, side, x, actions = []) => ({ id, name: id, side, kind: "npc", level: 2, hp: { value: 60, max: 60 }, defenses: { ac: 15, fortitude: 5, reflex: 5, will: 5 },
      initiative: { mod: 2 }, speeds: { walk: 25 }, actions, iwr: {}, flags: { fearless: true }, diesAtZero: true, position: { x, y: 0, size: 5 } });
    const run = beginRun(prepareBattle({ combatants: [unit("hero", "friendly", 0, [a]), unit("orc", "hostile", 5)], sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: true, maxRounds: 3, aftermath: "none" } }, pf2eRules), 1, { log: true });
    beginRound(run, 1);
    run.rng.d20 = () => 12;
    strikeOutOfTurn(run, run.byId.get("hero"), a, run.byId.get("orc"));
    expect(run.log.find(e => e.type === "afflictionSave")).toMatchObject({ name: "Black Adder Venom", dc: 18, saveType: "fortitude" });
    expect(run.byId.get("orc").afflictions).toEqual([expect.objectContaining({ stage: 1 })]);
  });
});
