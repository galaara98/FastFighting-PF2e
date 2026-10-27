import { describe, expect, test } from "vitest";
import { abilityAction, checkParams, damageIn, templateIn, cooldownIn, areaFoes, saveIn, selectiveIn } from "../scripts/abilities.js";
import { readFileSync } from "node:fs";

const dice = parts => parts.map(p => `${p.dice.map(d => `${d.n}d${d.faces}`).join("+")}${p.flat ? `+${p.flat}` : ""} ${p.persistent ? "persistent " : ""}${p.type}`);

describe("reading a creature's abilities", () => {
  test("the inline checks: a save, damage, an area", () => {
    expect(checkParams("reflex|dc:31|basic")).toEqual({ type: "reflex", dc: "31", basic: "true" });
    expect(checkParams("type:fortitude|dc:20|basic:true")).toEqual({ type: "fortitude", dc: "20", basic: "true" });
    expect(saveIn("<p>@Check[will|dc:25]</p>")).toEqual({ type: "will", dc: 25, basic: false });
    expect(saveIn("<p>Each creature attempts a DC 18 basic Reflex save.</p>")).toEqual({ type: "reflex", dc: 18, basic: true });
    expect(dice(damageIn("deals @Damage[(4d6+8)[bludgeoning]] and @Damage[2d6[persistent,fire]]"))).toEqual(["4d6+8 bludgeoning", "2d6 persistent fire"]);
    expect(dice(damageIn("deals [[/r {6d6}[cold]]] damage"))).toEqual(["6d6 cold"]);
    expect(templateIn("@Template[cone|distance:40]")).toEqual({ shape: "cone", feet: 40 });
    expect(templateIn("<p>in a 60-foot line</p>")).toEqual({ shape: "line", feet: 60 });
    // (A column 10 feet across: a burst of 5, from a corner.)
    expect(templateIn("@Template[cylinder|distance:5]{10 feet in diameter}")).toEqual({ shape: "burst", feet: 5 });
    // An area catches everyone in it, unless its text says it spares whom its maker chooses.
    const words = JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8"));
    expect(selectiveIn("<p>Each creature in the area takes fire damage.</p>", words)).toBe(false);
    expect(selectiveIn("<p>Each enemy in the burst takes fire damage.</p>", words)).toBe(true);
    expect(selectiveIn("<p>Any number of creatures of your choice in the area are healed.</p>", words)).toBe(true);
    expect(selectiveIn("<p>Each enemy in the burst takes fire damage.</p>", {})).toBe(false);
    expect(areaFoes({ shape: "cone", feet: 40 })).toBe(3);
    expect(areaFoes({ shape: "burst", feet: 20 })).toBe(4);
    expect(cooldownIn("<p>It can't use Breath Weapon again for 1d4 rounds.</p>")).toEqual({ n: 1, faces: 4 });
    expect(cooldownIn("<p>It can’t use Spray again for 2 rounds.</p>")).toEqual({ n: 2, faces: 1 });
  });

  test("a breath weapon: a save for half, an area from the creature, waiting 1d4 rounds before the next", () => {
    const a = abilityAction({
      id: "d.breath", name: "Breath Weapon", actions: 2,
      html: "<p>The beast exhales a gout of flame that deals @Damage[12d6[fire]] damage in a @Template[cone|distance:40] (@Check[reflex|dc:32|basic] save).</p><p>It can't use Breath Weapon again for 1d4 rounds.</p>"
    });
    expect(a).toMatchObject({ kind: "save", cost: 2, save: { type: "reflex", dc: 32, basic: true }, uses: 1, cooldown: { n: 1, faces: 4 }, area: { targets: 3 }, range: { max: 40 } });
    expect(dice(a.damage)).toEqual(["12d6 fire"]);
  });

  test("a trample that knocks foes prone on a failure", () => {
    const a = abilityAction({
      id: "t", name: "Trample", actions: 3,
      html: "<p>It moves through foes, dealing @Damage[3d10+9[bludgeoning]] damage (@Check[reflex|dc:28|basic]).</p><hr /><p><strong>Failure</strong> The creature takes full damage and is knocked prone.</p>"
    });
    expect(a.kind).toBe("save");
    expect(a.effects?.[0]).toMatchObject({ kind: "condition", conditions: { prone: 1 }, critOnly: false });
  });

  test("a frightening roar with no damage is crowd control by degree", () => {
    const a = abilityAction({
      id: "r", name: "Terrifying Roar", actions: 1,
      html: "<p>Each foe within 30 feet attempts a @Check[will|dc:27] save.</p><p><strong>Success</strong> Unaffected.</p><p><strong>Failure</strong> The creature is frightened 1.</p><p><strong>Critical Failure</strong> The creature is frightened 2.</p>"
    });
    expect(a).toMatchObject({ kind: "control", range: { max: 30 } });
    expect(a.onSave[1].conditions).toEqual({ frightened: 1 });
    expect(a.onSave[0].conditions).toEqual({ frightened: 2 });
  });

  test("reactions, passives and skill checks aren't actions to take on a turn", () => {
    expect(abilityAction({ id: "x", name: "Wing Deflection", actionType: "reaction", html: "@Check[reflex|dc:20|basic] @Damage[2d6[fire]]" })).toBeNull();
    expect(abilityAction({ id: "y", name: "Aura", actionType: "passive", html: "@Check[will|dc:20] frightened 1" })).toBeNull();
    expect(abilityAction({ id: "z", name: "Climb", html: "@Check[athletics|dc:20]" })).toBeNull();
  });
});

describe("what the system's texts really look like", () => {
  test("an inline roll for how long is a wait, not damage", () => {
    const html = "<p>A wail (@Check[fortitude|dc:30], @Damage[6d10[void]]). It can't Wail again for [[/gmr 1d4 #Recharge Wail]] rounds.</p>";
    expect(dice(damageIn(html))).toEqual(["6d10 void"]);
    expect(cooldownIn(html)).toEqual({ n: 1, faces: 4 });
    expect(cooldownIn("<p>It can't use Breath again for [[/gmr 1d4 #Recharge Breath]]{1d4 rounds}.</p>")).toEqual({ n: 1, faces: 4 });
  });

  test("the same dice under several types are alternatives: only the first counts", () => {
    const html = "<ul><li>@Damage[7d6[fire]] (@Check[reflex|dc:24|basic])</li><li>@Damage[7d6[cold]]</li><li>@Damage[7d6[acid]]</li></ul>";
    expect(dice(damageIn(html))).toEqual(["7d6 fire"]);
  });

  test("Trample uses the named Strike's damage, with a basic Reflex save", () => {
    const foot = [{ dice: [{ n: 2, faces: 8 }], flat: 6, type: "bludgeoning", persistent: false, category: null }];
    const a = abilityAction({ id: "e", name: "Trample", actions: 3, html: "<p>Large or smaller, foot, @Check[reflex|dc:24|basic]</p>", strikes: [{ name: "Tusk", damage: [] }, { name: "Foot", damage: foot }] });
    expect(a).toMatchObject({ kind: "save", cost: 3, save: { type: "reflex", dc: 24, basic: true }, damage: foot });
  });
});

describe("abilities without a list by degree", () => {
  test("must succeed at a save or become frightened: a failure lays it on", () => {
    const a = abilityAction({ id: "c", name: "Croak", actions: 1, html: "<p>Any foe within @Template[emanation|distance:30]{30 feet} becomes @UUID[Compendium.pf2e.conditionitems.Item.x]{Frightened 1} unless it succeeds at a @Check[will|dc:17] save.</p>" });
    expect(a).toMatchObject({ kind: "control", range: { max: 30 } });
    expect(a.onSave[1].conditions).toEqual({ frightened: 1 });
    expect(a.onSave[2]).toBeNull();
  });

  test("what an ability requires isn't what it does", () => {
    expect(abilityAction({ id: "r", name: "Reclaim", actions: 1, html: "<p><strong>Requirements</strong> It has a creature @UUID[x]{Grabbed}</p><p><strong>Effect</strong> It drains the creature, which attempts a @Check[fortitude|dc:20] save.</p>" })).toBeNull();
  });
});
