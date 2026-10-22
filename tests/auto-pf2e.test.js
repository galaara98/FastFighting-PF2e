/**
 * Setting a character up by itself, as PF2e reads it: the playstyles that fit (class and ancestry by slug, a
 * creature's traits, gear), and its own answers to the tactics questions, each with its reason ("Let this character decide").
 */
import { describe, expect, test } from "vitest";
import { pf2eHints, pf2eTactics, textOf, triggerOf, guardsAllies, rescuesAllies, guardsSelf, healsOthers, highSkill } from "../scripts/auto.js";
import { traitName } from "../scripts/words.js";
import { listJoin } from "../scripts/core.js";
import { TACTIC_CHOICES } from "../../fast-fighting/scripts/engine/tactics.js";
import { withHints } from "../../fast-fighting/scripts/foundry/auto-config.js";
import { text } from "./foundry-i18n.js";

describe("the playstyles PF2e says fit", () => {
  test("a class; a shield and heavy armor make a Tank likelier", () => {
    const h = pf2eHints({ cls: "champion", shield: true, heavy: true });
    expect(h.tank).toBeCloseTo(0.9);
    expect(pf2eHints({ cls: "rogue" }).thief).toBe(0.5);
    expect(pf2eHints({ cls: "commander" }).leader).toBe(0.7);
  });

  test("a healer is a Medic, a striker a DPS, a bard's buffs an Enabler's; Speed Runner is no longer hinted (a monk: DPS)", () => {
    expect(pf2eHints({ cls: "cleric" }).medic).toBeCloseTo(0.6);
    expect(pf2eHints({ cls: "cleric" }).enabler).toBeUndefined();
    expect(pf2eHints({ cls: "fighter", feats: ["sneak-attack"] }).dps).toBeCloseTo(0.6);
    expect(pf2eHints({ cls: "champion", spells: ["lay-on-hands"], feats: ["battle-medicine"] }).medic).toBeCloseTo(0.7);
    expect(pf2eHints({ cls: "bard", spells: ["courageous-anthem"] }).enabler).toBeCloseTo(0.8);
    expect(pf2eHints({ cls: "alchemist", feats: ["bomber"] }).dps).toBeCloseTo(0.4);
    expect(pf2eHints({ cls: "monk" })).toEqual({ dps: 0.3 });
  });

  test("feats that make a Kiter likelier: Mobility, Skirmish Strike, Running Reload (each once)", () => {
    expect(pf2eHints({ cls: "ranger", feats: ["skirmish-strike", "running-reload"] }).kiter).toBeCloseTo(0.7);
    expect(pf2eHints({ feats: ["mobility", "mobility"] }).kiter).toBeCloseTo(0.4);
    expect(pf2eHints({ feats: ["power-attack"] }).kiter).toBeUndefined();
  });

  test("a creature's traits (an ancestry among them counts once)", () => {
    expect(pf2eHints({ traits: ["undead", "mindless"] }).relentless).toBeCloseTo(0.8);
    expect(pf2eHints({ traits: ["fiend", "unholy"] }).cruel).toBeCloseTo(0.7);
    expect(pf2eHints({ ancestry: "goblin", traits: ["goblin", "humanoid"] })).toEqual({ impatient: 0.15 });
  });

  test("a biography's every field as text", () => {
    expect(textOf({ backstory: "<p>A greedy <b>sellsword</b>.</p>", edicts: ["Never back down"], anathema: [] })).toBe("A greedy sellsword .. Never back down");
  });
});

/* Characters and creatures, as the adapter reads them (made-up wording for their abilities' text). */

const RANKS = ["Untrained", "Trained", "Expert", "Master", "Legendary"];
const pcSocial = (diplomacy = 0, deception = 0, intimidation = 0) => Object.fromEntries(Object.entries({ diplomacy, deception, intimidation })
  .map(([slug, rank]) => [slug, { rank, mod: rank * 3, listed: rank >= 1, name: slug.charAt(0).toUpperCase() + slug.slice(1), rankName: RANKS[rank] }]));
const npcSocial = list => Object.fromEntries(Object.entries(list).map(([slug, mod]) => [slug, { rank: 0, mod, listed: true, name: slug.charAt(0).toUpperCase() + slug.slice(1) }]));
const reaction = (slug, name, trigger) => ({ slug, name, type: "reaction", text: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> It acts.</p>` });

const kyra = (extra = {}) => ({
  kind: "pc", level: 1, cls: { slug: "cleric", name: "Cleric" }, background: { slug: "acolyte", name: "Acolyte" },
  features: { "cloistered-cleric": "Cloistered Cleric", "divine-font": "Divine Font (Healing)", "domain-initiate": "Domain Initiate" },
  traits: ["human", "humanoid", "holy"], font: { value: "heal", name: "Divine Font (Healing)" }, deity: { name: "Sarenrae", weapons: ["scimitar"] },
  strikes: [{ id: "kyra.strike.scimitar.0", base: "scimitar" }, { id: "kyra.strike.sling.1", base: "sling" }], weapons: { melee: 1, ranged: 1 },
  casting: { slots: "Divine Prepared Spells", innate: null }, heals: ["Heal"], social: pcSocial(1, 0, 0), languages: 2, ...extra
});
const valeros = (extra = {}) => ({
  kind: "pc", level: 1, cls: { slug: "fighter", name: "Fighter" }, background: { slug: "farmhand", name: "Farmhand" },
  features: { "shield-block": "Shield Block", "reactive-shield": "Reactive Shield", "reactive-strike": "Reactive Strike", "double-slice": "Double Slice" },
  abilities: [reaction("shield-block", "Shield Block", "While your shield is raised, you would take damage from a physical attack."),
    reaction("reactive-strike", "Reactive Strike", "A creature within your reach uses a move action.")],
  traits: ["human", "humanoid"], shield: true, weapons: { melee: 1, ranged: 1 }, social: pcSocial(1, 0, 1), languages: 3, ...extra
});
const ezren = (extra = {}) => ({
  kind: "pc", level: 1, cls: { slug: "wizard", name: "Wizard" }, background: { slug: "merchant", name: "Merchant" },
  features: { "bargain-hunter": "Bargain Hunter", "arcane-school": "Arcane School" }, traits: ["human", "humanoid"], weapons: { melee: 1, ranged: 0 },
  casting: { slots: "Arcane Prepared Spells" }, social: pcSocial(1, 0, 0), languages: 5, ...extra
});
const merisiel = (extra = {}) => ({
  kind: "pc", level: 1, cls: { slug: "rogue", name: "Rogue" }, background: { slug: "criminal", name: "Criminal" },
  features: { thief: "Thief", "sneak-attack": "Sneak Attack", "rogues-racket": "Rogue's Racket" }, traits: ["elf", "humanoid"],
  weapons: { melee: 2, ranged: 1 }, social: pcSocial(0, 1, 1), languages: 2, ...extra
});
const champion = (cause, react, extra = {}) => ({
  kind: "pc", level: 3, cls: { slug: "champion", name: "Champion" }, features: { [cause.slug]: cause.name, [react.slug]: react.name, "shield-block": "Shield Block" },
  abilities: [react], deity: { name: "Iomedae", weapons: ["longsword"] }, strikes: [{ id: "c.strike.longsword.0", base: "longsword" }],
  weapons: { melee: 1, ranged: 0 }, shield: true, social: pcSocial(1, 0, 0), languages: 1, ...extra
});

const zombie = { kind: "npc", level: 2, traits: ["undead", "mindless", "zombie"], features: { "void-healing": "Void Healing" }, languages: 0, weapons: { melee: 1 }, social: {} };
const wolf = { kind: "npc", level: 1, traits: ["animal"], features: { "pack-attack": "Pack Attack" }, languages: 0, weapons: { melee: 1 }, social: {} };
const bodyguard = { kind: "npc", level: 1, traits: ["human", "humanoid"], languages: 1, weapons: { melee: 2, ranged: 1 }, social: npcSocial({ intimidation: 7 }),
  abilities: [{ slug: "bodyguards-defense", name: "Bodyguard's Defense", type: "action", text: "<p>Grants an adjacent ally a +2 circumstance bonus to AC until its next turn.</p>" }] };
const herbalist = { kind: "npc", level: 1, traits: ["human", "humanoid"], languages: 1, weapons: { melee: 1 }, social: npcSocial({ diplomacy: 6 }),
  abilities: [reaction("saving-touch", "Saving Touch", "An ally within reach is reduced to 0 Hit Points.")] };
const chanter = { kind: "npc", level: 1, traits: ["goblin", "humanoid"], languages: 2, weapons: { melee: 1, ranged: 1 }, casting: { slots: "Occult Spontaneous Spells", innate: null }, social: npcSocial({ deception: 7 }) };
const serpentfolk = { kind: "npc", level: 2, traits: ["serpentfolk", "humanoid"], languages: 3, weapons: { melee: 2, ranged: 1 }, casting: { slots: null, innate: "Occult Innate Spells" }, social: npcSocial({ deception: 11 }) };
const hobgoblin = { kind: "npc", level: 1, traits: ["hobgoblin", "humanoid"], languages: 2, formation: "Formation", shield: true, weapons: { melee: 1, ranged: 1 },
  features: { "shield-block": "Shield Block", "reactive-strike": "Reactive Strike" }, social: {} };
const devil = { kind: "npc", level: 5, traits: ["devil", "fiend", "unholy"], languages: 3, weapons: { melee: 1 }, social: npcSocial({ deception: 14 }) };
const troll = { kind: "npc", level: 5, traits: ["giant", "troll"], languages: 1, weapons: { melee: 2 }, mending: "Regeneration 20", social: {} };
const golem = { kind: "npc", level: 4, traits: ["construct", "mindless"], languages: 0, weapons: { melee: 1 }, immune: [{ type: "healing", name: "Healing" }], social: {} };
const goblin = { kind: "npc", level: -1, traits: ["goblin", "humanoid"], languages: 2, weapons: { melee: 1, ranged: 1 }, social: {} };

const values = hints => Object.fromEntries(Object.entries(hints).map(([k, v]) => [k, v.value]));

describe("reading what an ability does from its trigger", () => {
  test("a reaction's trigger, as words (links read as their text)", () => {
    expect(triggerOf("<p><strong>Trigger</strong> An enemy @UUID[Compendium.pf2e.conditionitems.Item.x]{grabs} your ally</p><hr /><p>...</p>")).toBe("An enemy grabs your ally");
    expect(triggerOf("<p>No trigger here.</p>")).toBe("");
  });

  test("guarding an ally: a foe striking one, an ally about to be hurt, an action that shields one", () => {
    expect(guardsAllies(reaction("x", "X", "An enemy damages your ally, and both are in your aura"))).toBe(true);
    expect(guardsAllies(reaction("x", "X", "An ally within 10 feet of you takes physical damage."))).toBe(true);
    expect(guardsAllies(reaction("x", "X", "An adjacent ally is the target of a ranged Strike."))).toBe(true);
    expect(guardsAllies({ type: "action", text: "<p>It grants an adjacent ally a +1 circumstance bonus to AC.</p>" })).toBe(true);
    // (Not: moving when an ally does, helping an ally's roll, being hurt itself.)
    expect(guardsAllies(reaction("x", "X", "A goblin ally ends a move action adjacent to the goblin."))).toBe(false);
    expect(guardsAllies(reaction("x", "X", "An ally is about to attempt an attack roll."))).toBe(false);
    expect(guardsAllies(reaction("x", "X", "An enemy in your aura damages you"))).toBe(false);
    expect(guardsAllies({ type: "passive", text: "<p>It grants an adjacent ally a +1 bonus to AC.</p>" })).toBe(false);
  });

  test("a long text a player wrote is read in one pass (no search that backtracks for minutes)", () => {
    const start = Date.now();
    const trigger = "an enemy attacks ".repeat(6000);
    expect(guardsAllies(reaction("x", "X", trigger))).toBe(false);
    expect(guardsAllies(reaction("x", "X", `${trigger} your ally`))).toBe(true);
    expect(guardsAllies({ type: "action", text: `<p>${"it grants an ally ".repeat(6000)}</p>` })).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("a reaction to a fallen ally; a reaction that guards only itself", () => {
    expect(rescuesAllies(reaction("x", "X", "An ally is reduced to 0 Hit Points."))).toBe(true);
    expect(rescuesAllies(reaction("x", "X", "An enemy damages your ally"))).toBe(false);
    expect(guardsSelf(reaction("x", "X", "An enemy in your champion's aura damages you"))).toBe(true);
    expect(guardsSelf(reaction("x", "X", "An enemy damages your ally"))).toBe(false);
  });
});

describe("PF2e's answers for player characters", () => {
  test("a cloistered cleric with a healing font: leads with spells, keeps her slots for the day, keeps everyone up", () => {
    const got = pf2eTactics(kyra());
    expect(got.style).toEqual({ value: "caster", why: "Cloistered Cleric" });
    expect(got.specialty).toEqual({ value: "strong", why: "Cleric" });
    expect(got.resourceUse).toEqual({ value: "conserve", why: "Divine Prepared Spells" });
    expect(got.healAggro).toEqual({ value: "aggressive", why: "Divine Font (Healing)" });
    expect(got.allyDying).toEqual({ value: "rescue", why: "Divine Font (Healing)" });
    expect(got.talk).toEqual({ value: "opportune", why: text("FFPF2E.Reason.Proficient", { name: "Diplomacy", rank: "Trained" }) });
    // (A cloistered cleric doesn't fight with its deity's weapon; nothing else on its sheet speaks to these.)
    for ( const k of ["preferredAction", "target", "shield", "retreat", "beyond", "consumables"] ) expect(got[k], k).toBeUndefined();
  });

  test("a warpriest fights with its deity's favored weapon; a harmful font isn't a healer's", () => {
    const got = pf2eTactics(kyra({ features: { warpriest: "Warpriest" } }));
    expect(got.preferredAction).toEqual({ value: "kyra.strike.scimitar.0", why: "Sarenrae" });
    expect(got.style).toEqual({ value: "frontline", why: "Warpriest" });
    expect(got.specialty).toEqual({ value: "some", why: "Warpriest" });
    const harm = pf2eTactics(kyra({ font: { value: "harm", name: "Divine Font (Harmful)" }, heals: [] }));
    expect(harm.healAggro).toBeUndefined();
    expect(harm.allyDying).toBeUndefined();
    // (One who still prepares a heal heals as the fight allows, and goes to a friend who falls.)
    const mending = pf2eTactics(kyra({ font: { value: "harm", name: "Divine Font (Harmful)" }, heals: ["Heal", "Soothe"] }));
    expect(mending.healAggro).toEqual({ value: "balanced", why: listJoin(["Heal", "Soothe"]) });
    expect(mending.allyDying).toEqual({ value: "rescue", why: listJoin(["Heal", "Soothe"]) });
  });

  test("healing others: what it heals others with, by name; a healer's choices make it eager, but only with something to heal with", () => {
    expect(pf2eTactics(valeros({ heals: ["Battle Medicine"] })).healAggro).toEqual({ value: "balanced", why: "Battle Medicine" });
    expect(pf2eTactics(valeros({ heals: ["Battle Medicine"], features: { "medic-dedication": "Medic Dedication" } })).healAggro)
      .toEqual({ value: "aggressive", why: "Medic Dedication" });
    const chirurgeon = { kind: "pc", cls: { slug: "alchemist", name: "Alchemist" }, features: { chirurgeon: "Chirurgeon" } };
    expect(pf2eTactics(chirurgeon).healAggro).toBeUndefined();
    expect(pf2eTactics({ ...chirurgeon, heals: ["Battle Medicine"] }).healAggro).toEqual({ value: "aggressive", why: "Chirurgeon" });
    expect(pf2eTactics({ ...herbalist, heals: ["Heal"] }).healAggro).toEqual({ value: "balanced", why: "Heal" });
  });

  test("what it heals others with, from its actions: not a spell on itself, a potion or first aid", () => {
    const heal = (name, extra) => ({ id: name, name, kind: "heal", heal: [], ...extra });
    expect(healsOthers([
      heal("Heal", { reach: 5 }), heal("Heal", { range: { increment: 30, max: 30 } }), heal("Battle Medicine", { reach: 5 }),
      heal("Garden of Healing"), heal("Harmonize Self", { selfOnly: true }),
      heal("Healing Potion (Minor)", { resource: "item:abc", selfOnly: true }), heal("Elixir of Life", { resource: "item:def" }),
      heal("First Aid", { firstAid: true, reach: 5 }),
      { id: "strike", name: "Longsword", kind: "strike", reach: 5 }
    ])).toEqual(["Heal", "Battle Medicine", "Garden of Healing"]);
    expect(healsOthers()).toEqual([]);
  });

  test("its limited means: a caster's spell slots last the day; Focus Points are for this fight", () => {
    expect(pf2eTactics(ezren()).resourceUse).toEqual({ value: "conserve", why: "Arcane Prepared Spells" });
    const monk = { kind: "pc", cls: { slug: "monk", name: "Monk" }, casting: { slots: null, innate: null, focus: "Qi Spells" } };
    expect(pf2eTactics(monk).resourceUse).toEqual({ value: "nova", why: "Qi Spells" });
    // (A fighter's dedication spells don't make it a caster; a creature's slots leave it to the core.)
    expect(pf2eTactics(valeros({ casting: { slots: "Arcane Prepared Spells" } })).resourceUse).toBeUndefined();
    expect(pf2eTactics(chanter).resourceUse).toBeUndefined();
  });

  test("a fighter holds the line; Reactive Shield raises the shield only as the blow comes; an archer shoots", () => {
    const got = pf2eTactics(valeros());
    expect(got.style).toEqual({ value: "frontline", why: "Fighter" });
    expect(got.shield).toEqual({ value: "spare", why: "Reactive Shield" });
    expect(got.talk.value).toBe("opportune");
    expect(pf2eTactics(valeros({ features: { "shield-block": "Shield Block" } })).shield).toEqual({ value: "always", why: "Shield Block" });
    expect(pf2eTactics(valeros({ weapons: { melee: 0, ranged: 2 } })).style.value).toBe("ranged");
    // (No shield: nothing to say about raising one.)
    expect(pf2eTactics(valeros({ shield: false })).shield).toBeUndefined();
  });

  test("a wizard with a merchant's background: spells first, consumables sparingly", () => {
    const got = pf2eTactics(ezren());
    expect(values(got)).toMatchObject({ style: "caster", specialty: "strong", consumables: "sparing", talk: "opportune" });
    expect(got.consumables.why).toBe("Merchant");
    // (Bargain Hunter alone, too.)
    expect(pf2eTactics(ezren({ background: null })).consumables).toEqual({ value: "sparing", why: "Bargain Hunter" });
  });

  test("a rogue's racket: a thief skirmishes, a ruffian holds the front", () => {
    expect(pf2eTactics(merisiel()).style).toEqual({ value: "skirmisher", why: "Rogue" });
    expect(pf2eTactics(merisiel({ features: { ruffian: "Ruffian" } })).style).toEqual({ value: "frontline", why: "Ruffian" });
  });

  test("a champion: its cause's reaction says whether it guards its friends", () => {
    const justice = pf2eTactics(champion({ slug: "justice", name: "Justice" }, reaction("retributive-strike", "Retributive Strike", "An enemy damages your ally, and both are in your champion's aura")));
    expect(values(justice)).toMatchObject({ style: "protector", target: "protect", allyDying: "rescue", shield: "always", preferredAction: "c.strike.longsword.0" });
    expect(justice.target.why).toBe("Retributive Strike");
    expect(justice.preferredAction.why).toBe("Iomedae");
    // An unholy cause's reaction guards only itself: no protector.
    const desecration = pf2eTactics(champion({ slug: "desecration", name: "Desecration" }, reaction("selfish-shield", "Selfish Shield", "An enemy in your champion's aura damages you")));
    expect(desecration.style).toEqual({ value: "frontline", why: "Selfish Shield" });
    expect(desecration.target).toBeUndefined();
    expect(desecration.allyDying).toBeUndefined();
    // (A champion whose reaction isn't on its sheet yet guards, as its class does.)
    expect(pf2eTactics({ kind: "pc", cls: { slug: "champion", name: "Champion" } }).target).toEqual({ value: "protect", why: "Champion" });
  });

  test("an alchemist's consumables, freely; a bomber throws from afar; a kineticist is all impulses", () => {
    const bomber = pf2eTactics({ kind: "pc", cls: { slug: "alchemist", name: "Alchemist" }, features: { bomber: "Bomber" } });
    expect(bomber.style).toEqual({ value: "ranged", why: "Bomber" });
    expect(bomber.consumables).toEqual({ value: "freely", why: "Alchemist" });
    expect(pf2eTactics({ kind: "pc", cls: { slug: "fighter", name: "Fighter" }, features: { "talisman-dabbler-dedication": "Talisman Dabbler Dedication" } }).consumables)
      .toEqual({ value: "freely", why: "Talisman Dabbler Dedication" });
    expect(pf2eTactics({ kind: "pc", cls: { slug: "kineticist", name: "Kineticist" } }).specialty).toEqual({ value: "always", why: "Kineticist" });
  });

  test("a ranger with no ranged weapon closes in; a commander picks the most dangerous foe", () => {
    expect(pf2eTactics({ kind: "pc", cls: { slug: "ranger", name: "Ranger" }, weapons: { melee: 2, ranged: 0 } }).style.value).toBe("skirmisher");
    expect(pf2eTactics({ kind: "pc", cls: { slug: "ranger", name: "Ranger" }, weapons: { melee: 1, ranged: 1 } }).style.value).toBe("ranged");
    expect(pf2eTactics({ kind: "pc", cls: { slug: "commander", name: "Commander" } }).target).toEqual({ value: "dangerous", why: "Commander" });
  });

  test("talking: an expert talks first; one untrained in every social skill never bothers", () => {
    expect(pf2eTactics(valeros({ social: pcSocial(0, 2, 1) })).talk).toEqual({ value: "first", why: text("FFPF2E.Reason.Proficient", { name: "Deception", rank: "Expert" }) });
    expect(pf2eTactics(valeros({ social: pcSocial(0, 0, 0) })).talk)
      .toEqual({ value: "never", why: text("FFPF2E.Why.Untrained", { rank: "Untrained", skills: listJoin(["Diplomacy", "Deception", "Intimidation"]) }) });
  });
});

describe("PF2e's answers for creatures", () => {
  test("a mindless undead: never talks or runs, goes for the nearest, can't drink vitality", () => {
    const got = pf2eTactics(zombie);
    const mindless = traitName("mindless");
    expect(values(got)).toMatchObject({ talk: "never", target: "nearest", retreat: "never", allyDying: "fight", selfRevived: "rejoin", beyond: "stay",
      potionThreshold: "never" });
    expect(got.talk.why).toBe(mindless);
    expect(got.potionThreshold.why).toBe("Void Healing");
  });

  test("a wolf: a pack hunter flanks and hunts down whoever's near; no language, no talk", () => {
    const got = pf2eTactics(wolf);
    expect(got.style).toEqual({ value: "skirmisher", why: "Pack Attack" });
    expect(got.beyond).toEqual({ value: "hunt", why: "Pack Attack" });
    expect(got.talk).toEqual({ value: "never", why: text("FFPF2E.Why.NoLanguage") });
  });

  test("a bodyguard shields its charge; a herbalist runs to a fallen friend", () => {
    const guard = pf2eTactics(bodyguard);
    expect(guard.style).toEqual({ value: "protector", why: "Bodyguard's Defense" });
    expect(guard.target).toEqual({ value: "protect", why: "Bodyguard's Defense" });
    expect(guard.talk).toEqual({ value: "opportune", why: text("FFPF2E.Why.Skill", { skill: "Intimidation", mod: "+7" }) });
    expect(pf2eTactics(herbalist).allyDying).toEqual({ value: "rescue", why: "Saving Touch" });
  });

  test("a creature with spell slots leads with spells; innate spells lean a little; a smooth talker talks first", () => {
    expect(values(pf2eTactics(chanter))).toMatchObject({ style: "caster", specialty: "strong", talk: "opportune" });
    expect(pf2eTactics(chanter).style.why).toBe("Occult Spontaneous Spells");
    const zyss = pf2eTactics(serpentfolk);
    expect(zyss.specialty).toEqual({ value: "some", why: "Occult Innate Spells" });
    expect(zyss.style).toBeUndefined();
    expect(zyss.talk.value).toBe(serpentfolk.social.deception.mod >= highSkill(2) ? "first" : "opportune");
    expect(zyss.talk.value).toBe("first");
  });

  test("a hobgoblin soldier holds its formation and keeps its shield up", () => {
    const got = pf2eTactics(hobgoblin);
    expect(got.style).toEqual({ value: "frontline", why: "Formation" });
    expect(got.shield).toEqual({ value: "always", why: "Shield Block" });
    expect(got.talk).toBeUndefined();
  });

  test("a devil talks first", () => {
    const got = pf2eTactics(devil);
    const why = traitName("devil");
    expect(got.talk).toEqual({ value: "first", why });
  });

  test("regeneration gets back up; a construct can't be healed by a potion; one immune to fear never runs", () => {
    expect(values(pf2eTactics(troll))).toMatchObject({ selfRevived: "rejoin", potionThreshold: "25" });
    expect(pf2eTactics(troll).selfRevived.why).toBe("Regeneration 20");
    const got = pf2eTactics(golem);
    expect(got.potionThreshold).toEqual({ value: "never", why: text("FFPF2E.Why.Immune", { what: "Healing" }) });
    expect(got.retreat.value).toBe("never");
    const brave = pf2eTactics({ kind: "npc", languages: 1, immune: [{ type: "fear-effects", name: "Fear Effects" }] });
    expect(brave.retreat).toEqual({ value: "never", why: text("FFPF2E.Why.Immune", { what: "Fear Effects" }) });
  });

  test("a summoned creature: spends everything, never runs, stays", () => {
    const got = pf2eTactics({ kind: "minion", traits: ["summoned", "minion", "celestial"], languages: 2, social: {} });
    const why = traitName("summoned");
    expect(values(got)).toMatchObject({ resourceUse: "nova", retreat: "never", beyond: "stay" });
    expect(got.resourceUse.why).toBe(why);
  });

  test("where its data says nothing, it says nothing (the core's reading stands)", () => {
    expect(pf2eTactics()).toEqual({});
    expect(pf2eTactics(goblin)).toEqual({});
  });
});

describe("every answer is one the core takes", () => {
  const everyone = [kyra(), kyra({ features: { warpriest: "Warpriest" } }), valeros(), valeros({ social: pcSocial() }), ezren(), merisiel(),
    champion({ slug: "justice", name: "Justice" }, reaction("retributive-strike", "Retributive Strike", "An enemy damages your ally")),
    champion({ slug: "desecration", name: "Desecration" }, reaction("selfish-shield", "Selfish Shield", "An enemy damages you")),
    zombie, wolf, bodyguard, herbalist, chanter, serpentfolk, hobgoblin, devil, troll, golem, goblin,
    kyra({ font: { value: "harm", name: "Divine Font (Harmful)" }, heals: ["Heal", "Soothe"] }), valeros({ heals: ["Battle Medicine"] }),
    { ...herbalist, heals: ["Heal"] },
    { kind: "pc", cls: { slug: "alchemist", name: "Alchemist" }, features: { chirurgeon: "Chirurgeon" }, heals: ["Battle Medicine"] },
    { kind: "pc", cls: { slug: "oracle", name: "Oracle" }, features: { life: "Life" }, heals: ["Heal"], casting: { slots: "Divine Spontaneous Spells", focus: "Revelation Spells" } },
    { kind: "pc", cls: { slug: "monk", name: "Monk" }, casting: { focus: "Qi Spells" } },
    { kind: "minion", traits: ["summoned", "minion"], languages: 0 }];

  test("each one of its question's choices, with a reason, and the core's withHints keeps every one", () => {
    for ( const f of everyone ) {
      const hints = pf2eTactics(f);
      const actions = (f.strikes ?? []).map(s => ({ id: s.id }));
      for ( const [k, { value, why }] of Object.entries(hints) ) {
        expect(typeof why === "string" && why.length > 0, `${k}: a reason`).toBe(true);
        if ( k === "preferredAction" ) expect(actions.map(a => a.id)).toContain(value);
        else expect(TACTIC_CHOICES[k], `${k}: ${value}`).toContain(value);
      }
      const kept = withHints({}, hints, { actions });
      expect(Object.keys(kept.why).sort()).toEqual(Object.keys(hints).sort());
      for ( const k of Object.keys(hints) ) expect(kept.lets[k]).toEqual(hints[k].value);
    }
  });

  test("an answer with no reason to give isn't given", () => {
    const nameless = champion({ slug: "justice", name: "Justice" }, reaction("retributive-strike", "Retributive Strike", "An enemy damages your ally"),
      { deity: { name: "", weapons: ["longsword"] }, cls: { slug: "champion", name: "" } });
    const hints = pf2eTactics(nameless);
    expect(hints.preferredAction).toBeUndefined();
    for ( const [k, { why }] of Object.entries(hints) ) expect(why, k).toBeTruthy();
  });
});
