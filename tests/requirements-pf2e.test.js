/**
 * An ability's Requirements line (requirements.js), read by reading/en.json's "requirements" patterns into the core's
 * action.requires, and the save reader (abilities.js) taking an ability whose requirement it can express. The texts
 * here are made up in the shape PF2e writes them.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { setReading } from "../scripts/reading.js";
import { requirementLine, readRequirement, requirementOf, strikesNamed, withoutRequirement, rollsItself } from "../scripts/requirements.js";
import { abilityAction } from "../scripts/abilities.js";
import { parseFormula } from "../scripts/core.js";

const english = JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8"));
beforeEach(() => setReading(english));

const strikes = [
  { id: "m.strike.jaws.0", name: "Jaws", slug: "jaws", melee: true, reach: 10, damage: [parseFormula("2d8+6", "piercing")] },
  { id: "m.strike.claw.1", name: "Claw", slug: "claw", melee: true, reach: 15, damage: [parseFormula("2d6+6", "slashing")] },
  { id: "m.strike.tail-claw.2", name: "Tail Claw", slug: "tail-claw", melee: true, reach: 20, damage: [parseFormula("1d10+6", "slashing")] }
];
const line = text => readRequirement(text, { strikes });
const html = (needs, effect) => `<p><strong>Requirements</strong> ${needs}</p><hr /><p><strong>Effect</strong> ${effect}</p>`;

describe("finding the line", () => {
  test("its words in plain lower case, links as their labels; nothing else of the text", () => {
    const text = html("The mirelurk has a creature @UUID[Compendium.pf2e.conditionitems.Item.x]{Grabbed}.", "It squeezes.");
    expect(requirementLine(text).line).toBe("the mirelurk has a creature grabbed");
    expect(withoutRequirement(text)).not.toMatch(/Requirements/);
    expect(requirementOf("<p>It squeezes.</p>")).toBeUndefined();
  });

  test("no reading at all: a requirement in bold is one it can't express, never none", () => {
    setReading({});
    expect(requirementOf(html("The mirelurk has a creature grabbed", "It squeezes."))).toBeNull();
  });
});

describe("what a line needs, as the core's requires", () => {
  test("a creature it holds", () => {
    expect(line("the mirelurk has a creature grabbed")).toEqual({ holding: true });
    expect(line("the bog hound has a medium or smaller creature grabbed or restrained in its jaws")).toEqual({ holding: true });
    expect(line("a creature is grabbed by the mirelurk's pincer")).toEqual({ holding: true });
    expect(line("the mirelurk is grabbing a creature")).toEqual({ holding: true });
  });

  test("its last action a hit, with the Strike it names, by its name or its slug", () => {
    expect(line("the bog hound's last action was a successful jaws strike")).toEqual({ lastHit: { with: ["m.strike.jaws.0"] } });
    expect(line("the bog hound damaged a creature with a tail claw strike on its last action")).toEqual({ lastHit: { with: ["m.strike.tail-claw.2"] } });
    expect(line("the bog hound's last action was a strike that hit a creature")).toEqual({ lastHit: true });
    // (A Strike it hasn't: it can't be expressed.)
    expect(line("the bog hound's last action was a successful horn strike")).toBeNull();
  });

  test("a condition on the target: the core's words, and the reading's own (dying is unconscious)", () => {
    expect(line("a grabbed, paralyzed, or willing creature is within the marsh fiend's reach")).toEqual({ target: ["grabbed", "paralyzed"] });
    expect(line("the marsh fiend is adjacent to a dying creature")).toEqual({ target: ["unconscious"] });
    expect(line("a creature is prone within the marsh fiend's reach")).toEqual({ target: ["prone"] });
    // (Nothing it knows as a condition: not one it can express.)
    expect(line("the marsh fiend is adjacent to a barrel")).toBeNull();
  });

  test("of itself: hidden, prone, a shield raised", () => {
    expect(line("the stalker is hidden or undetected")).toEqual({ self: ["hidden"] });
    expect(line("the stalker is prone")).toEqual({ self: ["prone"] });
    expect(line("the guard has their shield raised")).toEqual({ shieldRaised: true });
  });

  test("what none of the patterns says: null", () => {
    expect(line("the dragon is adjacent to their hoard")).toBeNull();
    expect(line("initiative has not yet been rolled")).toBeNull();
    expect(line("the mirelurk has a creature grabbed and hasn't used this ability this round")).toBeNull();
  });

  test("its Strikes by name: exact, spaced or not, then word by word", () => {
    expect(strikesNamed(strikes, "claw")).toEqual(["m.strike.claw.1"]);
    expect(strikesNamed([{ id: "a", name: "Battle Axe", slug: "battle-axe" }], "battleaxe")).toEqual(["a"]);
    expect(strikesNamed([{ id: "b", name: "Iron Claws", slug: "iron-claws" }], "claw")).toEqual(["b"]);
    expect(strikesNamed(strikes, "bite")).toBeNull();
  });
});

describe("the save reader, with a requirement", () => {
  test("a squeeze on whoever it holds: a basic save, its longest melee reach, and requires holding", () => {
    const a = abilityAction({ id: "m.squeeze", name: "Squeeze", strikes,
      html: html("The mirelurk has a creature grabbed.", "It crushes the creature for @Damage[(3d8+6)[bludgeoning]] (@Check[fortitude|dc:24|basic])") });
    expect(a).toMatchObject({ kind: "save", requires: { holding: true }, melee: true, reach: 20, save: { type: "fortitude", dc: 24, basic: true } });
  });

  test("a follow-up to a bite, damage with no save: it simply lands, its healing not counted as harm", () => {
    const a = abilityAction({ id: "m.lap", name: "Lap", strikes,
      html: html("The bog hound's last action was a successful jaws Strike.", "The creature takes @Damage[2d6[piercing]] damage and the bog hound regains @Damage[5[healing]] Hit Points.") });
    expect(a).toMatchObject({ kind: "auto", requires: { lastHit: { with: ["m.strike.jaws.0"] } }, reach: 10 });
    expect(a.damage.map(p => p.type)).toEqual(["piercing"]);
  });

  test("damage it rolls for (a check, a Strike) isn't simply dealt", () => {
    const check = html("The mirelurk has a creature grabbed.", "It attempts an @Check[athletics|defense:fortitude] check; on a success the creature takes @Damage[2d6[bludgeoning]] damage.");
    expect(abilityAction({ id: "x", name: "Toss", strikes, html: check })).toBeNull();
    const strike = html("The mirelurk has a creature grabbed.", "It makes a jaws Strike against the creature; on a hit the creature takes @Damage[1d6[bleed]] more.");
    expect(rollsItself(strike)).toBe(true);
    expect(abilityAction({ id: "y", name: "Gnash", strikes, html: strike })).toBeNull();
  });

  test("a requirement none of the patterns says: the ability isn't used", () => {
    expect(abilityAction({ id: "z", name: "Hoard Fury", strikes,
      html: html("The dragon is adjacent to their hoard.", "Each foe within 30 feet takes @Damage[4d6[fire]] (@Check[reflex|dc:25|basic]).") })).toBeNull();
  });

  test("a condition it lays on a failure, read from what it does, not from what it needs", () => {
    const a = abilityAction({ id: "w", name: "Whisper", strikes,
      html: html("A grabbed, paralyzed, or unconscious creature is within the ghast's reach.", "The creature must succeed at a @Check[will|dc:20] save or become frightened 2.") });
    expect(a).toMatchObject({ kind: "control", requires: { target: ["grabbed", "paralyzed", "unconscious"] } });
    expect(a.onSave[1].conditions).toEqual({ frightened: 2 });
  });
});
