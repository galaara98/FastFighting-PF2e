# FastFighting PF2e

> **AI use:** This module used AI in its creation.
> - **Programming:** I am a skilled programmer by profession, but AI was used heavily as a co-pilot.
> - **Strings:** ALL initial strings were proposed by a LLM to get the concepts out, ALL strings were  tracked to make sure they were re-written (for simple or ttrpg/game specific phrases, approved by) a native speaker.

Pathfinder Second Edition support for [FastFighting Core](https://github.com/galaara98/FastFighting), the Foundry VTT battle estimator, storyteller and resolver.

The core plays every system with one fixed set of options: conditions, maneuvers, holds, buffs, reactions, resources and outcomes. This module maps PF2e onto them, plays PF2e's rules where they differ, and writes live battles back onto PF2e sheets. It finds features by slug, so a translated game plays the same.

## What plays

**Turns and checks.** Three actions, the multiple attack penalty, four degrees of success, range increments, reload, drawing a weapon, and the ammunition a character carries. Flourish actions are once a turn. Quickened's extra action is only for a Strike or a Stride.

**Conditions.** PF2e's conditions and status penalties, applied to the rolls they affect. A penalty already in a sheet's numbers isn't counted twice. Frightened is only a penalty; fleeing spends every action getting away.

**Maneuvers and holds.** Trip, Grapple, Shove, Reposition, Disarm, Feint and Demoralize, by degree, for the trained.
- A grab ends when the grabber moves. A failed Grapple lets go of a foe already held.
- Escape counts toward the multiple attack penalty. A critical success Strides 5 feet clear, if that draws no Reactive Strike.
- Disarm's −2 lasts until the foe spends an Interact to change its grip.
- Demoralize takes −4 against a foe that shares no language.
- Grab, Knockdown, Push and Pull follow the Monster Core. Web, Tangle Vine and the like are holds, broken by Escape.

**Spells and resources.** Spell attacks and saves, prepared and spontaneous slots (signature spells heightened), innate uses, Focus Points, and every bomb and consumable carried. Buffs and debuffs come from the Spell Effect a spell links, so the numbers are PF2e's. Crowd-control spells are read degree by degree.

**Summons and companions.** A summon spell calls the highest-level creature of its trait the rank allows, from the installed bestiaries. It has the minion and summoned traits, acts in its summoner's turn, and lasts while sustained. Familiars and animal companions act when commanded.

**Class features.** Vicious Swing, Double Slice, Sudden Charge, Flurry of Blows, Exploit Vulnerability, Intercept Attack, Elemental Blast and impulses. Hunt Prey takes its action before a Strike at a new prey; Flurry and Precision count only against the prey. Extra Strike damage comes from PF2e's own formula, so Sneak Attack, a stratagem or a finisher counts from any source.

**Creature abilities.** Breath weapons, roars and other save abilities are read from their inline checks, recharge included: about nine in ten of the Monster Core's. An ability with a Requirements line plays when FastFighting can tell it's met. Rend, Pounce, Constrict, Ferocity, regeneration, fast healing, Swallow Whole and Engulf play as written.

**Reactions.** Reactive Strike for those who have it, with a weapon in hand. Shield Block, Reactive Shield, Nimble Dodge and the champion's reactions. Other reactions are read from their Trigger and effect text. A creature that would waste its turn Delays or Readies a Strike or a shot instead.

**Healing and dying.** Temporary HP, Stamina, heal reach (one-action Heal is a touch), Lay on Hands and Touch of the Void. Dying, wounded and doomed, with recovery DCs and the dying limit from feats. Hero Points save a life or buy Heroic Recovery. Persistent damage ends on flat checks, with assisted recovery and Administer First Aid. A critically failed First Aid deals the bleed again.

**Defenses and senses.** Immunities, weaknesses, resistances and incapacitation. Auras such as Frightful Presence and Stench. Situational save bonuses (Trap Finder, +1 vs. magic). Hidden and concealed flat checks; darkvision, scent and tremorsense.

**The map.** Speeds, Tumble Through past one foe, Tiny creatures and swarms sharing spaces, doors (Force Open, Pick a Lock), and areas that spare whom their text spares. A simple hazard fires once, a complex one each round.

**Talking, theft and loot.** Languages, the social DCs, Steal at −5 in combat, and coins and gear for deals and loot.

## Personality and leadership

Tactical, Brave, Selfish and Loyal come from a creature's data: mindless, animal or undead, its mental attributes and Will, holy or unholy. A player character starts as a hero, and its sheet nudges it; each trait's tooltip lists why. Leadership comes from Diplomacy, Intimidation, Warfare Lore and the Commander class. The world's party starts on the Friendly Team.

## Playstyles in PF2e

| Perk | In PF2e |
| --- | --- |
| Hard to spot | **Avoid Notice**, **Hide**, **Take Cover**. |
| Spoiling | **Trip**, **Grapple**, **Disarm**, **Demoralize**, **Feint**, condition spells. |
| Helping | **Aid**, healing and buffs. |
| Lore-Collector | **Recall Knowledge**. |
| Thief | **Steal**. |
| Sparing the fallen | Nonlethal Strikes (−2 with a lethal weapon). |
| Mending | Potions, Battle Medicine, **Administer First Aid**. |
| Locked doors | Force Open, Pick a Lock. |

Un-Mundane characters lean on spells, class actions and feat actions; Strikes, skill actions and consumables are what anyone can do.

## Set up by itself

FastFighting suggests playstyles from class, ancestry, creature traits and gear (a Champion a Tank, a Rogue a Thief), and keywords from a biography. **Let this character decide** answers the tactics questions from the sheet and shows each reason.

## Live battles

Each turn writes to the sheets: HP, conditions, persistent damage, afflictions, spent slots and uses, Hero Points, buffs, side changes, and items handed over or stolen. PF2e rolls the Strikes, saves and checks, with its own cards. A player's damage at a creature FastFighting runs goes through PF2e's Apply Damage. The dead leave a lootable corpse: Fresh, Rotten for the undead, Scrap for metal, clockwork or robot creatures.

## Settings

PF2e sets two core settings: **Max rounds** (6 to 16, 12 at first) and **Lore-Collector advantage** (2×).

## What isn't played

- Disabling or attacking a hazard; a hazard keeping its side in the fight.
- Abilities whose Requirements line FastFighting can't read.
- Swallow Whole and Engulf: holding one's breath, the engulfer's move, a save's push aside.
- A grabbing body part still striking.
- A critically failed Feint, a weapon trait standing in for a free hand, the Stride after a Shove, a retort to a Bon Mot.
- Rend or Draconic Frenzy as a reaction, Pounce staying hidden, Light Blindness on first exposure, Camouflage only in natural surroundings, Slow's no reactions.
- A character's Surprise Attack, and Deception or Stealth initiative.
- Tumble Through's difficult terrain, and a failure's reactions from the starting square.
- A missed poisoned Strike keeping its poison, cover's bonus to Hide, magazine changes, a capacity weapon's next chamber.
- Saves that some effects change by degree or roll twice (Bravery).

## Installation

Install **FastFighting Core** first, then this module:

```
https://github.com/galaara98/FastFighting-PF2e/releases/latest/download/module.json
```

PF2e ties token disposition to the actor's *alliance*: set it to Neutral on the actor sheet to make a creature Neutral.

---

Developers: [CODING_README.md](CODING_README.md), [FastFighting Core](https://github.com/galaara98/FastFighting) and its [developer docs](https://github.com/galaara98/FastFighting/blob/main/CODING_README.md). The numbers behind it all: [STATS_AND_FORMULAS_README](https://github.com/galaara98/FastFighting/blob/main/STATS_AND_FORMULAS_README.md).
