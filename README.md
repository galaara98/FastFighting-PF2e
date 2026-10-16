# FastFighting PF2e

> **AI use:** This module used AI in its creation.
> - **Programming:** I am a skilled programmer by profession, but AI was used heavily as a co-pilot.
> - **Strings:** ALL initial strings were created by AI. An AI-made Spanish translation was used to test localization and has since been removed.

Pathfinder Second Edition support for [FastFighting Core](https://github.com/galaara98/FastFighting), the Foundry VTT battle estimator, storyteller and resolver.

FastFighting Core runs the simulations, the Battle Planner, player surveys, stories and Do it For Real Now for any system. This module teaches it how PF2e works:

- **Reading actors:**
  - hazards: a simple hazard fires once, a complex one each round (on its Stealth initiative); its Strikes and the abilities it uses when set off (its reaction, read as its action), against whoever is in reach. It doesn't move or think, nobody attacks it, and it doesn't keep its side in the fight. With no alliance (PF2e's default for a hazard) it's set against the party; the planner can change that
  - hit points and temporary hit points, and a character's Stamina Points when the world plays the Stamina variant (damage takes temporary hit points, then Stamina, then hit points; healing restores hit points only)
  - strikes (multiple attack penalty, agile, reach, reload, drawing unready weapons)
  - spells (spell attacks, basic and non-basic saves, auto-hit spells such as Force Barrage)
  - crowd-control spells, read degree by degree from their text (Fear, Slow, Sleep, Paralyze, Command, Tangle Vine ...), and damage spells' critical-failure riders (Daze's stunned 1) or what a failed save lays by degree (Impaling Spike's immobilized). A hold the text says an Escape breaks (Web, Tangle Vine, Impaling Spike; a creature's web) is broken by Escape against the spell DC (or the ability's, or the Escape DC it lists), and what it laid with it (off-guard) goes too
  - Dominate: the target fights for you (controlled), with a Will save at the end of each of its turns
  - buff and debuff spells, from the rule elements of the Spell Effect they link: Bless, Heroism (heightened), Courageous Anthem, Protection, Benediction, Haste (quickened), Mystic Armor, Sure Strike for friends; Bane and Malediction for foes who fail their save; Dirge of Doom's frightened aura. A spell good for one roll (Guidance: "one attack roll, Perception check, saving throw, or skill check"; Sure Strike: "the next time you make an attack roll") is spent by that roll
  - skill actions: Demoralize (Intimidation against Will DC: frightened, once per foe), Trip (Athletics against Reflex DC, an attack; 1d6 bludgeoning on a critical success; a critical failure lands you prone; only a creature up to one size larger), Disarm (Athletics against Reflex DC, an attack: -2 to its attacks with that weapon, knocked away on a critical success; only a weapon in hand), Feint (Deception against Perception DC: off-guard to you, which sets up sneak attack), Bon Mot for those with the feat, and Aid
  - gaining an edge: **Aid** (Prepare to Aid, then the reaction) for any creature with a mind: a check against DC 15 with its best Strike or Diplomacy, Medicine, Intimidation or Deception, for +1 to a friend's next roll at whoever that friend is set on (its foe, the one it would talk round, the friend it would tend), +2 on a critical success (+3 master, +4 legendary), -1 on a critical failure; for a Strike, only beside the foe. **Recall Knowledge** is how a Lore-Collector sizes a foe up: its best knowledge skill (Arcana, Crafting, Medicine, Nature, Occultism, Religion, Society or a Lore) against the DC for the foe's level; it has to work to pay off. How much it pays off is the **Lore-Collector advantage** setting (1.25× to 3× as likely to succeed, for the rest of that turn; default 2×, since it costs one action of three; it matters across the range, since attacks after the first carry a penalty)
  - actions that put an effect on their user (Rage and the like), read from the effect's rule elements and the action's own rules for while it's on (Rage: +2 to melee Strike damage, temporary hit points of level + Constitution); left on after the fight for the time it has left
  - reactions: Shield Block (the raised shield's Hardness off a physical blow), Reactive Shield (raising it as a melee blow comes, perhaps a miss after all), Nimble Dodge (+2 AC against one attack)
  - a creature's own abilities that call for a save (Breath Weapon, Trample, a frightening roar, a draining touch), read from the inline checks in their text: the save and its DC, the damage (alternatives such as a chimera's breath by head count once), the area (a cone, a line or an emanation from the creature; a burst where it's aimed), what a failure lays on the target, and how long until it can be used again ("can't use it again for 1d4 rounds") or how often (once per day). Trample deals the damage of the Strike it names. Abilities that need something first (Requirements) are left out. About nine in ten of the Monster Core's such abilities are read.
  - Swallow Whole and Engulf, by slug, as the core's swallowed and engulfed: Swallow Whole is the creature's Athletics against the Reflex DC of one it has grabbed, of the listed size or smaller (none more once it holds one of the largest); Engulf a Reflex save against the listed DC, for creatures its size or smaller within double its Speed. Inside, a creature takes the listed damage at once and at the end of each of its turns, is slowed 1, attacks only the one holding it (off-guard to it) and only with unarmed attacks or light weapons, and gets out by Escaping (the swallower's Athletics DC, or Engulf's listed Escape DC) or by cutting itself free (piercing or slashing damage of the Rupture value or more from one blow, which it tries where that's likelier). Not played: holding its breath, the blow's damage when it cuts itself free, and the engulfer's own move
  - regeneration (deactivated by the damage it names) and fast healing, from their rule elements, and those a spell's Spell Effect (or an action's own effect) lends for as long as it lasts: Regenerate's regeneration, Life Boost's fast healing
  - Evasion, Juggernaut and Resolve: a success on that save counts as a critical success
  - martial class actions by slug: Vicious Swing (or Power Attack), Double Slice, Sudden Charge, Flurry of Blows, and a ranger's Hunter's Edge (Flurry's smaller multiple attack penalty, Precision's extra damage on the first hit each turn; Hunt Prey's own action isn't counted)
  - what classes and archetypes add to a Strike, read off the system's own damage formula (rule elements and all) rather than by name: against an off-guard foe (Sneak Attack from any class or archetype, a cat companion's precision), what's always on in a fight (a thaumaturge's Implement's Empowerment), and Strikes set up by a class action (an investigator's Devise a Stratagem, a swashbuckler's finisher with panache)
  - a kineticist's Elemental Blast (as the system works it out) and impulses; any feat that's an action with a save (impulses, Dragon's Rage Breath) is read like a monster's ability, its inline damage and DC worked out for the creature
  - a thaumaturge's Exploit Vulnerability (extra damage on its own hits against the foe), a guardian's Intercept Attack (it takes an ally's blow instead)
  - bombs and other consumable weapons: as many throws as there are
  - animal and construct companions made on character sheets are companions, not player characters
  - champion's reactions: Retributive Strike, Glimpse of Redemption and Liberating Step (a friend within 15 feet takes 2 + level less from a blow; a Retributive Strike also strikes the attacker in reach)
  - Grapple for anyone trained in Athletics (grabbed, restrained on a critical success; on a critical failure the foe grabs you), and Reposition (on a critical failure the foe moves you)
  - summon spells: a creature of the trait the spell calls, at the highest level its rank allows, from the installed bestiaries (the Monster Core first), as a minion with two actions that its summoner must Sustain each turn or lose
  - Spell Effects already on a creature count through PF2e's own totals; one laid in a live battle goes on as its Spell Effect, for the rounds it has
  - senses, sorted into the core's with their ranges: darkvision, greater darkvision, infrared vision and truesight see in the dark; scent is smell; tremorsense, lifesense, echolocation and every other sense of a creature's own are felt; no vision, no sight (low-light vision and see invisibility don't count); blinded and deafened
  - Hero Points: spent to keep someone from dying (a reroll), or all of them for one's own Heroic Recovery; Do it For Real Now takes them away
  - prepared and spontaneous slots, focus points
  - healing spells, potions and elixirs, Battle Medicine (one-action Heal and Battle Medicine are a touch, so the healer walks over first; two-action Heal reaches 30 feet; a healing spell with no range, area or target, cast on yourself, heals only its caster)
  - sneak attack and pack attack, knockdown and grab, and a creature's Push, Improved Push and Pull (as far as the ability lists, 5 feet otherwise; played on the hit, without the Shove's own roll)
  - poisons and diseases parsed stage by stage from their text: a creature's (on its Strikes), a spell's (Spider Sting's spider venom, Goblin Pox, Curse of Death: laid on a failed save, then worked off with saves against the spell DC; marked for its failed save to be the exposure, a critical failure stage 2, though for now the core rolls the affliction's own save on top), and the injury poisons a character carries (its best piercing or slashing Strike with the poison applied first, the poison's activation and then the Strike; the hit's target saves against the poison; a dose a use)
  - immunities, weaknesses and resistances
  - speeds by movement type
  - getting past others on the map: through a friend's space or a fallen creature's freely; past a foe on its feet with Tumble Through (Acrobatics against its Reflex DC; a failure ends the move short of it) for those trained in Acrobatics with at least even odds, around it otherwise. A Tiny creature (which can share a larger creature's space) and a swarm (which can share anyone's) go through others' spaces freely and may end a move in one
  - languages, Diplomacy, Intimidation, Deception, Will and Perception DCs (for talking)
  - Thievery (for theft, against Perception DC), Medicine (for first aid after the fight), coins and gear (for what a creature could be talked into giving up or have stolen, or offer to end a standoff), each item's type, precious material and rarity (for what a character can ask for: PF2e's item types, precious materials and rarities, in its own words)
  - conditions, persistent damage and dying already on a creature (a fight resumed mid-way)
- **Rules:**
  - four degrees of success, natural 20/1, basic saves, and a minimum of 1 damage per hit;
  - the multiple attack penalty and three actions a turn;
  - off-guard, frightened, sickened, clumsy, enfeebled, stupefied, drained, encumbered, prone, slowed, quickened, stunned, paralyzed and fleeing, each weighed as the penalties it is (frightened 1 is −1 to everything) when a creature decides whether it's worth inflicting;
  - status penalties as PF2e has them: the worst counts, on what the roll is based on (frightened and sickened every roll, clumsy and encumbered Dexterity's: AC, Reflex, ranged attacks, Acrobatics; enfeebled Strength's: melee attacks; stupefied the mind's: Will, spell attacks; drained Constitution's: Fortitude; fascinated skill checks), and what a sheet's conditions already put into its numbers isn't counted again (a fight resumed mid-way, a live battle; off-guard and prone too). Drained costs its level in Hit Points a step (off its maximum too); quickened gives an action more;
  - flat checks: an attack against a creature hidden from it needs a DC 11 flat check, concealed a DC 5 one, and so does every attack by one dazzled (unless it has a precise sense besides sight); failed, the blow doesn't land. Not against an area;
  - range increments, and Steal at −5 in combat;
  - persistent damage with flat checks, and assisted recovery: two actions for one more flat check where something would reasonably help (dropping and rolling against fire, at DC 10 and prone after; pressing a bleed or scraping off acid, DC 15), and a friend's Administer First Aid on a bleed (two actions, trained in Medicine, against the GM Core's DC for the level of what caused it; a success, then the flat check at DC 10);
  - retching while sickened: one action, a Fortitude save against the DC of what sickened it (1 lower, 2 on a critical success);
  - dying, wounded and doomed with recovery checks, and Administer First Aid (DC 15 + dying); the dying value a creature dies at and its recovery DC as PF2e works them out from its feats (Diehard's dying 5, Toughness's DC 9 + dying);
  - Ferocity (a creature's) and Orc Ferocity (a character's), by slug: its reaction as it would fall keeps it up at 1 HP, wounded 1 higher; a creature's until it's wounded 3, a character's as often as its frequency has left today (Undying Ferocity adds temporary HP);
  - immunity by trait (mental, fear, emotion, sleep and others; the mindless shrug off mental effects), and incapacitation;
  - doors: a wooden door (Hardness 5, 20 HP) with a simple lock: Force Open (Athletics, one action) or Pick a Lock (trained Thievery and a thieves' toolkit, two actions), DC 20; opening one is an Interact action;
  - Reactive Strike: only creatures that have it (Attack of Opportunity, before the remaster) strike a foe leaving their reach, once a round. A careful creature Steps out of reach first.
- **Personality defaults:** Tactical, Brave, Selfish and Loyal come from the creature's data: mindless, animal, undead, construct, minion, Intelligence, Wisdom, Will save; its kind's loyalty (a devil's hierarchy, a demon's chaos, a hobgoblin's discipline); holy or unholy; and what its abilities' rules do.
- **A player character's personality** starts as the usual hero's (bold, loyal, unselfish, a good head) and everything on its sheet moves it a little: Intelligence and Wisdom (and its Perception, and experience) for Tactical; its Will against the usual hero's at its level, and its Constitution, for Brave; its class, ancestry and background (a champion selfless, a criminal or a charlatan less so, a scholar a planner, a gladiator bold); holy or unholy; its feats and features by what their rules do (a better save against fear, like a fighter's Bravery, makes a bolder one; one against being controlled, like Haughty Obstinacy, one harder to order around; a bonus to Aid, like Cooperative Nature, a more loyal one; a few without rules, like Aura of Courage, by slug); skills that say something (Warfare Lore, Thievery, Medicine ...); and whether it's in a party. Each trait's tooltip in the planner lists where it started and every part that moved it. Leadership comes from Diplomacy, Intimidation and Warfare Lore, the Commander class and its tactics, and rallying abilities. A rarer creature (its rarity trait: uncommon, rare, unique) has a slight edge for leader, boss or lieutenant of its group.
- **Recognised by slug:** abilities, feats and spells it has to know (Sneak Attack, Pack Attack, Reactive Strike, Battle Medicine, Bon Mot, knockdown, grab and push, Swallow Whole and Engulf) are found by their slug, the same in every language, so a translated game works too.
- **Do it For Real Now for PF2e:** each turn of a live battle writes:
  - HP and temp HP, and Stamina Points in a world playing the Stamina variant;
  - dying, wounded, unconscious, prone and lingering conditions;
  - persistent damage conditions, and affliction effects (noting any onset still to come);
  - death, and lootable corpses or loot piles (gear moves off the corpse);
  - expended slots and focus, and used consumables;
  - buffs and debuffs (Bless, Bane, Rage): their own Spell Effect, for the rounds they have, off when they end;
  - surrender and side changes (alliance and disposition: won over, their new side; talked out of the fight, Neutral; a neutral that turned on the party, Hostile);
  - coins (with change made) and items handed over by someone talked into it or robbed.

  A retreating PC stays on the map.

## Playstyles in PF2e

Every perk a playstyle (or a tactics answer) can switch on does something here. Most play as they do in any system (who a character goes for, when it loses heart, whom it listens to, how it talks). These lean on PF2e's own:

| Perk (playstyles) | In PF2e |
| --- | --- |
| Hard to spot (Chicken, Fragile, Wallflower) | Foes' attention slides off it, and it **Avoids Notice** on the way in: Stealth for initiative, when that's better. Behind the scene's walls it leans on **Hide** (with cover from every foe that sees it, or concealed: Stealth against their best Perception DC; hidden, each attack at it needs a DC 11 flat check, and its own next Strike finds the foe off guard, then it's seen) and **Take Cover** (standard cover made greater, +4; prone, greater against ranged attacks; until it moves or attacks). |
| Spoiling (Instigator most; Cruel, Wants to Lead, Wallflower, Puzzle-Maniac) | **Trip**, **Grapple**, **Disarm** (Athletics against Reflex: -2 to the foe's attacks with its weapon until its next turn; a critical success knocks it away, an action lost picking it up; only a weapon in hand), **Demoralize**, **Feint**, and spells that lay a condition, over a plain Strike. |
| Helping (Enabler, People-Pleaser, Moralist, Martyr, Redeem-Seeker, Tank) | **Aid**; healing and buff spells. |
| In a hurry (Impatient, Speed-Runner) | It doesn't Raise a Shield or Step clear of a foe (it takes the Reactive Strike). |
| Acting first (Instigator) | Its initiative. |
| Lore-Collector | **Recall Knowledge**. |
| Weak spots (Puzzle-Maniac) | Weaknesses. |
| Thief | **Steal** (Thievery, -5 in combat). |
| Trap avoiders | Hazards (simple and complex), and any token the GM marks as one. |
| Finishing the fallen (Cruel) | Dying: a blow on one who's dying raises it. |
| Sparing the fallen (Moralist, Peacekeeper, a Diplomat now and then) | Knocks a foe out with a **nonlethal** attack (fists, a sap) that would kill it, and leaves the fallen be. (The rules' -2 for making a lethal weapon nonlethal isn't played.) |
| Mending, healing, rescue | Healing spells, potions and elixirs, Battle Medicine; a friend dying gets **Administer First Aid** (two actions, Medicine against 15 + dying), in the fight as after it. |
| Locked doors | Force Open and Pick a Lock. |

Tactics answers:

- **Shields:** Raise a Shield, as the answer says.
- **Magic and specialties** (an Un-Mundane character leans on them): spells, its class's actions (Vicious Swing, Double Slice, Sudden Charge, Flurry of Blows, a stratagem, a finisher), a kineticist's blasts, a thaumaturge's Exploit Vulnerability, its feats' actions (Battle Medicine, Bon Mot), what it puts on itself (Rage), and a creature's abilities. Its weapon Strikes, the skill actions anyone trained can take (Trip, Grapple, Disarm, Demoralize, Feint, Aid), and bombs and potions are what anyone could do.

## Set up by itself

When FastFighting sets a character up by itself (the first time it sees it: see the core's README), PF2e has its say:
- **Class, by slug:**
  - a Champion a Tank and a Martyr; a Guardian a Tank; a Commander leads; a Cleric an Enabler; a Bard a People-Pleaser and a Diplomat;
  - a Rogue a Thief; a Ranger or Gunslinger a Wallflower; a Swashbuckler an Instigator; a Barbarian a Brawler, impatient; a Monk a Speed-Runner;
  - an Alchemist, Inventor, Investigator or Thaumaturge a Puzzle-Maniac (an Investigator, Thaumaturge or Wizard a Lore-Collector too);
  - the spellcasters, a Kineticist and a Magus Un-Mundane.
- **Ancestry, by slug,** only where its own abilities lean somewhere (an orc's ferocity, a kobold's traps, a goblin's haste, a dwarf's toughness).
- **A creature's traits:** undead, mindless, constructs, oozes and plants Relentless (the mindless and constructs never run); a fiend or the unholy Cruel; the holy and celestials Moralists; fey Wildcards; animals and giants Brawlers.
- **Gear:** a shield or heavy armor makes a Tank likelier.
- **Keywords:** a character's biography (backstory, beliefs, edicts, anathema and the rest), a creature's notes and blurb.

### "Let this character decide"

PF2e's data answers the tactics questions (and what a character offers and expects in a standoff) wherever it says something, each answer with its reason shown to the GM in the system's own words: a class's, feature's or spell list's name, a trait's label. Features are recognised by slug, and reactions by what their trigger says they do. Where the data says nothing, the core's reading of the hidden scores stands.

- **Fighting style:** a class and the choice made in it (a cloistered cleric or warpriest, a ruffian, an untamed druid, a magus's study, a gunslinger's way, a bomber or mutagenist, an inventor's innovation); a martial character with only ranged weapons shoots, a ranger with none closes in. A creature: a troop or swarm closes in; one with a reaction or action that guards an ally protects; one with spell slots leads with spells; Pack Attack or Sneak Attack skirmishes; Formation or Reactive Strike holds the line.
- **Whom it attacks:** a champion (whose cause's reaction guards allies), a guardian, or anyone with such a reaction protects its friends; a commander picks the most dangerous foe; the mindless, swarms and troops take the nearest.
- **Favorite weapon:** a champion's or warpriest's deity's favored weapon.
- **Magic and specialties:** spellcasting classes strongly (a warpriest a little), a kineticist always, an investigator's stratagems, a thaumaturge's Exploit Vulnerability; a creature with spell slots strongly, innate spells a little. **Spell slots:** a summoned creature spends everything; a spellcasting class keeps its spell slots for the day; one with a focus pool spends its Focus Points (Refocus brings them back).
- **Consumables:** an alchemist, the alchemist, talisman dabbler and scroll trickster dedications, an Alchemical Sciences investigator and a creature with bombs, freely; a merchant background or Bargain Hunter, sparingly.
- **Talking:** the mindless and creatures without a language never; a devil first; a character by its best rank in Diplomacy, Deception or Intimidation; a creature by its best of them against a high modifier for its level.
- **Healing and the dying:** from what it heals others with (its healing spells, Battle Medicine; not potions, nor first aid): it heals as the fight allows and rescues the dying; a cleric with a healing font, a chirurgeon, a life oracle or a medic heals eagerly; one with a reaction to an ally falling rescues too; the mindless and constructs keep fighting.
- **Potions, after being revived, retreat, shield, others nearby:** void healing (the undead) or an immunity to healing: never drink one; regeneration or fast healing waits until it's dire and gets back up; the mindless, constructs, the summoned and those immune to fear never run; Reactive Shield raises the shield as the blow comes, Shield Block keeps it up; a pack hunts down enemies nearby, the mindless, the summoned and animals stay.
- **Offer and expect:** the mindless, the summoned and those without a language nothing; a devil lets them pass for a price; a redemption champion or the holy offer not to harm; a merchant buys its way out (a tenth of its coin); a bandit wants paying.

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
