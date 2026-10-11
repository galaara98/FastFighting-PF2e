# FastFighting PF2e

> **AI use:** This module used AI in its creation.
> - **Programming:** I am a skilled programmer by profession, but AI was used heavily as a co-pilot.
> - **Strings:** ALL initial strings were created by AI. An AI-made Spanish translation was used to test localization and has since been removed.

Pathfinder Second Edition support for [FastFighting Core](https://github.com/galaara98/FastFighting), the Foundry VTT battle estimator, storyteller and resolver.

FastFighting Core runs the simulations, the Battle Planner, player surveys, stories and Make it So for any system. This module teaches it how PF2e works:

- **Reading actors:**
  - hazards: a simple hazard fires once, a complex one each round (on its Stealth initiative); its Strikes and the abilities it uses when set off (its reaction, read as its action), against whoever is in reach. It doesn't move or think, nobody attacks it, and it doesn't keep its side in the fight. With no alliance (PF2e's default for a hazard) it's set against the party; the planner can change that
  - hit points and temporary hit points, and a character's Stamina Points when the world plays the Stamina variant (damage takes temporary hit points, then Stamina, then hit points; healing restores hit points only)
  - strikes (multiple attack penalty, agile, reach, reload, drawing unready weapons)
  - spells (spell attacks, basic and non-basic saves, auto-hit spells such as Force Barrage)
  - crowd-control spells, read degree by degree from their text (Fear, Slow, Sleep, Paralyze, Command, Tangle Vine ...), and damage spells' critical-failure riders (Daze's stunned 1)
  - Dominate: the target fights for you (controlled), with a Will save at the end of each of its turns
  - buff and debuff spells, from the rule elements of the Spell Effect they link: Bless, Heroism (heightened), Courageous Anthem, Protection, Benediction, Haste (quickened), Mystic Armor, Sure Strike for friends; Bane and Malediction for foes who fail their save; Dirge of Doom's frightened aura. A spell good for one roll (Guidance: "one attack roll, Perception check, saving throw, or skill check"; Sure Strike: "the next time you make an attack roll") is spent by that roll
  - skill actions: Demoralize (Intimidation against Will DC: frightened, once per foe), Trip (Athletics against Reflex DC, an attack; a critical failure lands you prone; only a creature up to one size larger), Feint (Deception against Perception DC: off-guard to you, which sets up sneak attack), Bon Mot for those with the feat, and Aid
  - gaining an edge: **Aid** (Prepare to Aid, then the reaction) for any creature with a mind: a check against DC 15 with its best Strike or Diplomacy, Medicine, Intimidation or Deception, for +1 to a friend's next roll at whoever that friend is set on (its foe, the one it would talk round, the friend it would tend), +2 on a critical success (+3 master, +4 legendary), -1 on a critical failure; for a Strike, only beside the foe. **Recall Knowledge** is how a Lore-Collector sizes a foe up: its best knowledge skill (Arcana, Crafting, Medicine, Nature, Occultism, Religion, Society or a Lore) against the DC for the foe's level; it has to work to pay off. How much it pays off is the **Lore-Collector advantage** setting (1.25× to 3× as likely to succeed, for the rest of that turn; default 2×, since it costs one action of three; it matters across the range, since attacks after the first carry a penalty)
  - actions that put an effect on their user (Rage and the like), read from the effect's rule elements and the action's own rules for while it's on (Rage: +2 to melee Strike damage, temporary hit points of level + Constitution); left on after the fight for the time it has left
  - reactions: Shield Block (the raised shield's Hardness off a physical blow), Reactive Shield (raising it as a melee blow comes, perhaps a miss after all), Nimble Dodge (+2 AC against one attack)
  - a creature's own abilities that call for a save (Breath Weapon, Trample, a frightening roar, a draining touch), read from the inline checks in their text: the save and its DC, the damage (alternatives such as a chimera's breath by head count once), the area (a cone, a line or an emanation from the creature; a burst where it's aimed), what a failure lays on the target, and how long until it can be used again ("can't use it again for 1d4 rounds") or how often (once per day). Trample deals the damage of the Strike it names. Abilities that need something first (Requirements) are left out. About nine in ten of the Monster Core's such abilities are read.
  - regeneration (deactivated by the damage it names) and fast healing, from their rule elements
  - Evasion, Juggernaut and Resolve: a success on that save counts as a critical success
  - martial class actions by slug: Vicious Swing (or Power Attack), Double Slice, Sudden Charge, Flurry of Blows, and a ranger's Hunter's Edge (Flurry's smaller multiple attack penalty, Precision's extra damage on the first hit each turn; Hunt Prey's own action isn't counted)
  - what classes and archetypes add to a Strike, read off the system's own damage formula (rule elements and all) rather than by name: against an off-guard foe (Sneak Attack from any class or archetype, a cat companion's precision), what's always on in a fight (a thaumaturge's Implement's Empowerment), and Strikes set up by a class action (an investigator's Devise a Stratagem, a swashbuckler's finisher with panache)
  - a kineticist's Elemental Blast (as the system works it out) and impulses; any feat that's an action with a save (impulses, Dragon's Rage Breath) is read like a monster's ability, its inline damage and DC worked out for the creature
  - a thaumaturge's Exploit Vulnerability (extra damage on its own hits against the foe), a guardian's Intercept Attack (it takes an ally's blow instead)
  - bombs and other consumable weapons: as many throws as there are
  - animal and construct companions made on character sheets are companions, not player characters
  - champion's reactions: Retributive Strike, Glimpse of Redemption and Liberating Step (a friend within 15 feet takes 2 + level less from a blow; a Retributive Strike also strikes the attacker in reach)
  - Grapple for anyone trained in Athletics (grabbed, restrained on a critical success)
  - summon spells: a creature of the trait the spell calls, at the highest level its rank allows, from the installed bestiaries (the Monster Core first), as a minion with two actions that its summoner must Sustain each turn or lose
  - Spell Effects already on a creature count through PF2e's own totals; ones still running when the fight ends are left on by Make it So, for the rounds left
  - senses: darkvision and its kin (in the dark), scent, tremorsense, echolocation and the other senses that need no sight, with their ranges; blinded and deafened
  - Hero Points: spent to keep someone from dying (a reroll), or all of them for one's own Heroic Recovery; Make it So takes them away
  - prepared and spontaneous slots, focus points
  - healing spells, potions and elixirs, Battle Medicine (one-action Heal and Battle Medicine are a touch, so the healer walks over first; two-action Heal reaches 30 feet)
  - sneak attack and pack attack, knockdown and grab
  - poisons and diseases parsed stage by stage from their text
  - immunities, weaknesses and resistances
  - speeds by movement type
  - languages, Diplomacy, Intimidation, Deception, Will and Perception DCs (for talking)
  - Thievery (for theft, against Perception DC), Medicine (for first aid after the fight), coins and gear (for what a creature could be talked into giving up or have stolen, or offer to end a standoff), each item's type, precious material and rarity (for what a character can ask for: PF2e's item types, precious materials and rarities, in its own words)
  - conditions, persistent damage and dying already on a creature (a fight resumed mid-way)
- **Rules:**
  - four degrees of success, natural 20/1, basic saves, and a minimum of 1 damage per hit;
  - the multiple attack penalty and three actions a turn;
  - off-guard, frightened, sickened, clumsy, enfeebled, prone, slowed, stunned, paralyzed and fleeing, each weighed as the penalties it is (frightened 1 is −1 to everything) when a creature decides whether it's worth inflicting;
  - range increments, and Steal at −5 in combat;
  - persistent damage with flat checks;
  - dying, wounded and doomed with recovery checks, and Administer First Aid (DC 15 + dying);
  - immunity by trait (mental, fear, emotion, sleep and others; the mindless shrug off mental effects), and incapacitation;
  - doors: a wooden door (Hardness 5, 20 HP) with a simple lock: Force Open (Athletics, one action) or Pick a Lock (trained Thievery and a thieves' toolkit, two actions), DC 20; opening one is an Interact action;
  - Reactive Strike: only creatures that have it (Attack of Opportunity, before the remaster) strike a foe leaving their reach, once a round. A careful creature Steps out of reach first.
- **Personality defaults:** Tactical, Brave, Selfish and Loyal come from the creature's data: mindless, animal, undead, construct, minion, Intelligence, Wisdom, Will save. Leadership comes from Diplomacy, Intimidation and Warfare Lore, the Commander class and its tactics, and rallying abilities.
- **Recognised by slug:** abilities, feats and spells it has to know (Sneak Attack, Pack Attack, Reactive Strike, Battle Medicine, Bon Mot, knockdown and grab) are found by their slug, the same in every language, so a translated game works too.
- **Make it So for PF2e:** writes:
  - HP and temp HP, and Stamina Points in a world playing the Stamina variant;
  - dying, wounded, unconscious, prone and lingering conditions;
  - persistent damage conditions, and affliction effects (noting any onset still to come);
  - death, and lootable corpses or loot piles (gear moves off the corpse);
  - expended slots and focus, and used consumables;
  - surrender and side changes (alliance and disposition: won over, their new side; talked out of the fight, Neutral; a neutral that turned on the party, Hostile);
  - coins (with change made) and items handed over by someone talked into it or robbed.

  A retreating PC stays on the map.

## Installation

Install **FastFighting Core** first, then this module, using this manifest URL:

```
https://github.com/galaara98/FastFighting-PF2e/releases/latest/download/module.json
```

Enable both in a PF2e world.

## Note

PF2e ties token disposition to the actor's *alliance*. To make a creature Neutral for FastFighting, set its alliance to Neutral on the actor sheet.

## Development

Check out this repository next to the core repository (`../FastFighting`). Then run `npm install` and `npm test`; the tests use the core engine through `vitest.config.js`, which you can point elsewhere with `FASTFIGHTING_CORE`. Junction or symlink the folder into Foundry as `Data/modules/fast-fighting-pf2e`.

This module is also the reference for writing a FastFighting helper for another system: see `scripts/main.js` and `scripts/adapter.js`, and the API section of the core README.

Every word this module shows is in `languages/en.json`: the code holds keys, never the English. Translating it takes only a copy of that file (see **Translating** in the core README). `npm run test:reworded` runs the tests again with every word in the language files reworded, so they never depend on the wording.

`hardcoded-toEN.json` lists words that stay in English for now, whatever the reader's language: keys of `languages/en.json` (or a group, `"FFPF2E.Action"`) whose translation would contradict a game system that isn't translated yet. It has the date it was last updated (`lastUpdated`) and the list (`keys`). It's plain JSON, edited like the language files.
