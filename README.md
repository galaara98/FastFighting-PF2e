# FastFighting PF2e

> **AI use:** This module used AI in its creation.
> - **Programming:** I am a skilled programmer by profession, but AI was used heavily as a co-pilot.
> - **Strings:** ALL initial strings were proposed by a LLM to get the concepts out, ALL strings were  tracked to make sure they were re-written (for simple or ttrpg/game specific phrases, approved by) a native speaker.

Pathfinder Second Edition support for [FastFighting Core](https://github.com/galaara98/FastFighting), the Foundry VTT battle estimator, storyteller and resolver.

FastFighting Core plays every game system with one large but fixed set of options: conditions, maneuvers, holds, buffs and debuffs, reactions, resources, outcomes and more. Each system helper maps its system into those options. This one reads PF2e actors into them, plays PF2e's rules where they differ from the core's defaults, and writes live battles back onto PF2e sheets.

It finds features, feats and spells by slug, which stays the same in every language, so a translated game plays the same.

## How PF2e maps into the core

**Checks and turns.** PF2e's four degrees of success, natural 20s and 1s, basic saves, three actions a turn and the multiple attack penalty replace the core's defaults; a hit deals at least 1 damage. Strikes keep agile, reach, reload and drawing an unready weapon, and ranged attacks take range increments.

**Conditions** become the core's penalties, so a creature weighs one by what it costs before it inflicts it: frightened 1 is −1 to everything. Off-guard, frightened, sickened, clumsy, enfeebled, stupefied, drained, encumbered, prone, slowed, quickened, stunned, paralyzed and fleeing all play. Status penalties stack as in PF2e, the worst counting on rolls based on the attribute it affects (clumsy and encumbered on AC, Reflex, ranged attacks and Dexterity skills; stupefied on Will, spell attacks, words, Medicine, Recall Knowledge and Perception). A penalty already in a sheet's numbers isn't counted twice, so a fight resumed mid-way or a live battle doesn't double it. Drained costs Hit Points, off the maximum too; quickened adds an action; a stupefied caster's spell DCs drop, and a failed DC 5 + stupefied flat check loses the spell. Fear stays PF2e's: frightened is a status penalty and nothing more (unlike the core's default, it doesn't keep a creature away from the source), and fleeing spends every action getting away.

**Holds.** Grabbed and restrained are the core's holds: Escape rolls the creature's best of its unarmed attack, Acrobatics or Athletics against the grabber's Athletics DC. A spell or ability whose text says an Escape breaks it (Web, Tangle Vine, a creature's web) is a hold too, broken against its DC; what came with it, such as off-guard, ends with it.

**Maneuvers.** PF2e's skill actions are the core's maneuvers, with PF2e's results by degree: Trip, Grapple, Disarm, Shove and Reposition (Athletics), Feint (Deception) and Demoralize (Intimidation, once per foe), each against the DC the rules name. Trip, for example, rolls against Reflex DC: prone, plus 1d6 bludgeoning on a critical success, and a critical failure lands you prone. The Athletics ones are attacks, so they need a free hand and a target no more than one size larger. Only the trained try the Athletics maneuvers and Feint. Bon Mot is there for those with the feat. A creature's Knockdown, Grab, Push and Pull ride on its hit; Push and Pull move the target as far as the ability says (5 feet otherwise), without the Shove's roll.

**Edges.** Aid and Recall Knowledge are the core's ways to gain an edge. Aid is Prepare to Aid, then the reaction: a DC 15 check with the helper's best Strike or Diplomacy, Medicine, Intimidation or Deception, for +1 to a friend's next roll (+2 to +4 on a critical success, by rank; −1 on a critical failure). Aiding a Strike takes standing beside the foe. Recall Knowledge is how a Lore-Collector sizes up a foe: its best knowledge skill or Lore against the DC for the foe's level. On a success, its rolls against that foe are likelier to succeed for the rest of the turn (see Settings). A spell good for one roll (Guidance, Sure Strike) is spent by that roll.

**Buffs and debuffs** come from the Spell Effect a spell links, read through its rule elements, so they give the numbers PF2e would, heightening included: Bless or Heroism on friends, Bane on foes who fail the save, Dirge of Doom's frightened aura. An action that puts an effect on its user reads the same way: Rage gives +2 to melee Strike damage and temporary HP of level + Constitution, and stays on after the fight for the time it has left. Spell Effects already on a creature count through PF2e's own totals.

**Control.** Crowd-control spells (Fear, Slow, Sleep, Paralyze, Command ...) are read degree by degree from their text, and so are damage spells' riders (Daze's stunned 1 on a critical failure). Dominate is the core's controlled: the target fights for its new master, with a Will save at the end of each of its turns.

**Spells and resources.** Spell attacks, basic and non-basic saves, auto-hit spells (Force Barrage), prepared and spontaneous slots, Focus Points, and bombs and other consumables, as many as there are. A summon spell calls a creature of the trait it names, at the highest level its rank allows, from the installed bestiaries (the Monster Core first): a minion with two actions that its summoner must Sustain each turn.

**Class features.** Martial class actions are found by slug: Vicious Swing (or Power Attack), Double Slice, Sudden Charge, Flurry of Blows, a ranger's Hunter's Edge. What a class or archetype adds to a Strike comes from PF2e's own damage formula rather than a list of names, so any source counts: Sneak Attack against an off-guard foe, a thaumaturge's Implement's Empowerment, an investigator's stratagem, a swashbuckler's finisher. A kineticist's Elemental Blast and impulses, a thaumaturge's Exploit Vulnerability and a guardian's Intercept Attack (it takes a physical blow meant for an ally within 10 feet) play too. A feat that is an action with a save (Dragon's Rage Breath) reads like a monster's ability.

**Reactions** are the core's answering reactions: Shield Block (the shield's Hardness off a physical blow), Reactive Shield, Nimble Dodge (+2 AC), and a champion's reactions (a friend within 15 feet takes 2 + level less; Retributive Strike also strikes the attacker in reach). Reactive Strike is the core's opportunity attack, but only for creatures that have it (Attack of Opportunity, before the remaster), once a round. A careful creature Steps out of reach first.

**Creature abilities.** An ability that calls for a save (Breath Weapon, Trample, a frightening roar) is read from the inline checks PF2e writes into its text: the save, DC, damage, area, what a failure lays, and how soon it comes back ("can't use it again for 1d4 rounds") or how often (once per day). That covers about nine in ten of the Monster Core's. An ability with a Requirements line plays once it's met, where FastFighting can tell (a creature it has grabbed, its last action a hit with the Strike it names, a condition on its target, being hidden); one it can't tell isn't used. Draconic Frenzy, Rend, Pounce, Constrict (only on a creature it holds), Draconic Momentum, Swarm Mind, Camouflage, Slow, Surprise Attack and Light Blindness (in a brightly lit scene) are known by slug. Regeneration (stopped by the damage it names) and fast healing come from their rule elements, including those a spell lends (Regenerate). Evasion, Juggernaut and Resolve turn a success on that save into a critical success.

**Swallow Whole and Engulf** are the core's swallowed and engulfed holds, played as the Monster Core describes them. Inside, a creature takes the listed damage at once and at the end of each of its turns, is slowed 1, and attacks only its holder. It gets out by Escaping, or by cutting free with one piercing or slashing blow of the Rupture value or more. A dead swallower's corpse still has to be cut open (three actions by a friend beside it); a dead engulfer lets go.

**Afflictions.** Poisons and diseases are read stage by stage from their text: a creature's on its Strikes, a spell's (Goblin Pox: the failed save is the exposure, with no second roll), and the injury poisons a character carries (applied to its best piercing or slashing Strike, a dose a use).

**Persistent damage** ends on flat checks, with assisted recovery: two actions buy another flat check where something would help (dropping and rolling against fire at DC 10, pressing a bleed at DC 15). A friend trained in Medicine can Administer First Aid on a bleed (two actions; a success allows the DC 10 flat check). A sickened creature can retch (a Fortitude save: 1 lower, 2 on a critical success), and drinks no potion or elixir while sickened.

**Hit points, healing and dying.** Damage takes temporary HP first, then HP; in a world playing the Stamina variant, Stamina Points come between, and healing restores HP only. Healing has reach: one-action Heal and Battle Medicine are a touch, so the healer walks over first; two-action Heal reaches 30 feet. Dying, wounded and doomed come with recovery checks and Administer First Aid (DC 15 + dying). The dying value a creature dies at and its recovery DC come from its feats, as PF2e works them out (Diehard's dying 5, Toughness's DC 9 + dying). Hero Points buy a reroll to keep someone from dying, or, all of them, Heroic Recovery. Ferocity and Orc Ferocity keep a creature at 1 HP as it would fall, wounded 1 higher: a creature's until wounded 3, a character's as often as its frequency allows (Undying Ferocity adds temporary HP).

**Immunities.** Immunities, weaknesses and resistances; immunity by trait (mental, fear, sleep ...; the mindless shrug off mental effects); incapacitation.

**Auras and situational saves.** An aura that calls for a save goes off as PF2e says: Frightful Presence frightens a foe that first comes into it (Will: frightened 1, 2 or 4 by degree; immune for a minute after any save), Stench sickens one that comes in or starts its turn there (Fortitude; immune to every stench after a success), and others are read from their rule element, check and condition links. Foes weigh what walking into one would cost them. Bonuses to saves against some effects only (+1 status to all saves vs. magic; against fear, poison or a tradition) count against those effects, as their rule elements say. In a live battle PF2e rolls these saves; a player's character starting its turn in an aura saves at the table, as usual.

**Senses and flat checks.** PF2e's senses sort into the core's: darkvision, infrared vision and truesight see in the dark; scent is smell; tremorsense, lifesense and any other sense of a creature's own are feel. Low-light vision and see invisibility don't count. An attack at a hidden creature needs a DC 11 flat check, at a concealed one DC 5, and so does every attack by a dazzled creature without a precise sense besides sight. A spell aimed at such a creature takes the caster's flat check too; an area spell doesn't.

**The map.** Speeds by movement type. A creature moves through a friend's or a fallen creature's space. Past a foe on its feet, it uses Tumble Through if trained in Acrobatics with at least even odds, and goes around otherwise. A Tiny creature or a swarm moves through others' spaces and may end its move in one. Doors are wooden (Hardness 5, 20 HP) with a simple lock: Force Open or Pick a Lock at DC 20.

**Hazards.** A simple hazard fires once, a complex one each round on its Stealth initiative: its Strikes and what it does when set off, at whoever is in reach. With no alliance (PF2e's default for a hazard) it's against the party; the planner can change that.

**Talking, theft and loot.** Languages (a constant tongues or truespeech understands everyone) and the Diplomacy, Intimidation, Deception, Will and Perception DCs for talking; Thievery against Perception DC for theft (Steal at −5 in combat). Coins and gear set what a creature can be talked out of, have stolen, or offer; PF2e's item types, precious materials and rarities set what a character can ask for.

**Companions** made on character sheets (animal and construct) are companions, not player characters.

## Personality and leadership

A creature's Tactical, Brave, Selfish and Loyal come from its data: mindless, animal, undead, construct or minion; Intelligence, Wisdom and Will; its kind's loyalty (a devil's hierarchy, a demon's chaos); holy or unholy; and what its abilities' rules do.

A player character starts as the usual hero, and its sheet moves it a little: Intelligence, Wisdom and Perception for Tactical; Will for its level and Constitution for Brave; class, ancestry and background (a champion selfless, a criminal less so, a gladiator bold); holy or unholy; feats by what their rules do (a fighter's Bravery bolder, Cooperative Nature more loyal); telling skills (Warfare Lore, Thievery, Medicine); and whether it's in a party. Each trait's tooltip in the planner lists what moved it.

Leadership comes from Diplomacy, Intimidation and Warfare Lore, the Commander class and its tactics, and rallying abilities. A rarer creature has a slight edge for leader, boss or lieutenant.

## Playstyles in PF2e

Every perk a playstyle or tactics answer can switch on works here. Most play as in any system; these use PF2e's own actions:

| Perk (playstyles) | In PF2e |
| --- | --- |
| Hard to spot (Chicken, Fragile, Wallflower) | Foes overlook it, and it **Avoids Notice** on the way in (Stealth for initiative, when better). Behind walls, it **Hides** (Stealth against foes' best Perception DC; hidden, attacks at it need a DC 11 flat check, and its next Strike finds the foe off-guard) and **Takes Cover** (standard cover becomes greater, +4, until it moves or attacks). |
| Spoiling (Instigator most; Cruel, Wants to Lead, Wallflower, Puzzle-Maniac) | **Trip**, **Grapple**, **Disarm**, **Demoralize**, **Feint**, and spells that lay a condition, over a plain Strike. |
| Helping (Enabler, People-Pleaser, Moralist, Martyr, Redeem-Seeker, Tank) | **Aid**; healing and buff spells. |
| In a hurry (Impatient, Speed-Runner) | Doesn't Raise a Shield or Step clear of a foe. |
| Acting first (Instigator) | Its initiative. |
| Lore-Collector | **Recall Knowledge**. |
| Weak spots (Puzzle-Maniac) | Weaknesses. |
| Thief | **Steal** (Thievery, −5 in combat). |
| Trap avoiders | Hazards, and any token the GM marks as one. |
| Finishing the fallen (Cruel) | A blow on a dying creature raises its dying value. |
| Sparing the fallen (Moralist, Peacekeeper, a Diplomat now and then) | A **nonlethal** attack that would kill knocks out instead. |
| Mending, healing, rescue | Healing spells, potions, elixirs, Battle Medicine; **Administer First Aid** for the dying, in the fight and after. |
| Locked doors | Force Open and Pick a Lock. |

Magic and specialties (an Un-Mundane character leans on them) are spells, class actions, a kineticist's blasts, feat actions such as Battle Medicine, self-effects such as Rage, and a creature's abilities. Strikes, the skill actions, bombs and potions are what anyone could do.

## Set up by itself

When FastFighting sets a character up by itself, PF2e suggests playstyles by class (a Champion a Tank and a Martyr, a Rogue a Thief, a Wizard a Lore-Collector, the spellcasters Un-Mundane), by ancestry where its abilities lean somewhere (an orc's ferocity), by creature trait (the undead and constructs Relentless, fiends Cruel, fey Wildcards), and by gear (a shield or heavy armor makes a Tank likelier). Keywords come from a character's biography and a creature's notes.

For **Let this character decide**, PF2e's data answers the tactics questions where it says something, and shows the GM each reason in the system's own words. A warpriest fights in front, a gunslinger's way sets how it fights, a champion or guardian protects its friends, a commander picks the most dangerous foe, a summoned creature spends everything, a devil talks first and lets you pass for a price, and a merchant buys its way out with a tenth of its coin. Where the data says nothing, the core's reading stands.

## Do it For Real Now

Each turn of a live battle writes to the PF2e sheets: HP, temporary HP and Stamina; dying, wounded, unconscious, prone and lingering conditions; persistent damage and afflictions (as effects, noting any onset to come); death, with lootable corpses or loot piles; spent slots, Focus Points, Hero Points and consumables; buffs and debuffs as their own Spell Effects, for the rounds they have; surrender and side changes (alliance and disposition: won over, the new side; talked out of the fight, Neutral; a neutral that turned on the party, Hostile); and coins and items handed over or stolen. A retreating PC stays on the map. A player's damage card at a creature FastFighting runs is applied, or put before the GM, through PF2e's own Apply Damage (resistances, shields, persistent damage, death at 0 HP). Reactions FastFighting rolls are PF2e's own Strikes, with their attack and damage cards in the chat; a critical Reactive Strike disrupts a manipulate action, and the player and GM are told.

## Settings

**Lore-Collector advantage** (world, 1.25× to 3×, default 2×): how much likelier a Lore-Collector's rolls against a foe are to succeed for the rest of the turn after a successful Recall Knowledge on it. The default reflects what Recall Knowledge costs: one action of three.

## What isn't played

- A hazard doesn't move or think, nobody attacks it, and it doesn't keep its side in the fight.
- Abilities that need something first (Requirements), and Hunt Prey's own action.
- The −2 for making a lethal weapon nonlethal.
- Swallow Whole and Engulf: holding one's breath, the engulfer's own move, a successful save's push aside, and several friends' actions added up at a corpse.
- Skill actions: a failed Grapple releasing a foe already held, a critically failed Feint, Feint's off-guard applying only to melee, Disarm's −2 ending when the foe's turn starts, a weapon's shove, trip or disarm trait standing in for a free hand, the Stride after a Shove, and Demoralize's −4 against a foe without a shared language.
- The 5-foot Stride after a critical success on an Escape, and the bleed a critically failed Administer First Aid causes.

## Installation

Install **FastFighting Core** first, then this module, with this manifest URL:

```
https://github.com/galaara98/FastFighting-PF2e/releases/latest/download/module.json
```

Enable both in a PF2e world.

## Note

PF2e ties token disposition to the actor's *alliance*. To make a creature Neutral for FastFighting, set its alliance to Neutral on the actor sheet.

---

Developers: [CODING_README.md](CODING_README.md). FastFighting itself: [FastFighting Core](https://github.com/galaara98/FastFighting) and its [developer docs](https://github.com/galaara98/FastFighting/blob/main/CODING_README.md). The numbers behind it all: [STATS_AND_FORMULAS_README](https://github.com/galaara98/FastFighting/blob/main/STATS_AND_FORMULAS_README.md).
