# TinyFrens game rules

The Pet screen and the floating pet use the same three care actions, plus Clean and Vitamin when your fren needs them. Opening the bubble menu is not a reward. There are no hidden long-press variants on action buttons. Tap or hold the pet to open its menu; drag to move it.

| Action | Result | When unavailable |
|---|---|---|
| Feed | Food +25, capped at 100; weight +4; eating animation | Already full |
| Play | Joy +20, capped at 100; food −8, energy −12, weight −3; dancing animation | Food below 8 or energy below 12 |
| Nap | Energy +25, capped at 100; sleeping animation | Energy already 100 |
| Clean | Clears mess; small Joy gain | Nothing to clean |
| Vitamin | Cures sickness immediately | Already healthy |
| Scold | Discipline +12 and settles the fren while misbehaving; Discipline −8 if they did nothing wrong | A downed fren |
| Revive | Brings a downed fren back at Food/Joy/Energy 50 | Not downed |
| More (bubble menu) | Open the full app | Never changes care stats |

Wave, Dance and Toy in the app are flavour interactions, not extra care rewards. A toy caught by the floating pet does not grant a second Play reward. Feedback reports actual capped gains. Saves, names and looks persist through signed updates.

## Needs

Needs arise from stats and time. Clean or Vitamin appears as an extra button only while the need applies, so care stays uncluttered.

| Need | Arises when | Fix |
|---|---|---|
| Hungry | Food is 25 or less | Feed |
| Sleepy | Energy is 25 or less | Nap: rest refills Energy over time |
| Bored | About twice a day, while awake and Energy is 25 or more | Play, which also lifts Joy to Happy |
| Dirty | About once a day, while Food is 25 or more | Clean the mess |
| Sad | Joy is 25 or less | Play; a play session always cheers a sad fren |
| Sick | Anytime; time spent hungry, sleepy, bored, sad or dirty raises the odds | Vitamin (instant), or a few calm hours with no other needs |
| Lost | Anytime; time spent sad or adventuring raises the odds | Wait — your fren walks home on their own, tired |
| Misbehaving | On its own every few hours while awake | Scold |
| Downed | A care need left unmet for 45 minutes at a time counts a care mistake; too many mistakes (12) run a fren down | Revive |

Joy tiers: happy at 75 or more, okay in between, sad at 25 or less.

Weight, discipline and care mistakes are Tamagotchi-style extras. Weight rises with food and falls with play and adventuring; being very heavy or very light (and low discipline) makes illness a little likelier. Care mistakes count toward being downed. There is no permanent death: a downed fren revives — a Robots v1 revive is paid in FRENS (see *Robots v1 and FRENS*).

## Visits

The first implementation is a temporary guest invitation, shared as a link. It carries only the pet's display name, shape, colour and a 30-minute expiry. Recipients must accept. Guest visitors never replace the receiver's own pet or change its saved care stats. Say goodbye removes the guest. A visitor is a snapshot, not a transfer of ownership or a synchronized live pet.

Nearby discovery is not implemented in this release. Native Android/iOS interoperability can use Google's Nearby Connections API (Bluetooth/BLE/Wi-Fi). It needs explicit permissions, both apps active, device-pairing verification and testing on two real phones. RFID/NFC would be a deliberate tap interaction, not continuous discovery. The iPhone web app cannot provide native Bluetooth discovery.

Source: https://developers.google.com/nearby/connections/overview


## Live friends and visits

The optional relay in `server/` provides permanent eight-character codes, accepted friendship, presence and live visitor profiles. Add friend requires the other person to accept. Ask to visit requires a separate acceptance; both apps must be connected. Wave/Dance synchronize without care rewards. Changes to the visiting pet name/look synchronize. Either person can end; disconnect ends it too. Guest never replaces owner saves. Visitors currently appear inside the app, not Android overlay/iOS PiP/widgets. Nearby radio discovery is not implemented; it must enter this same consent flow. See `server/README.md` for deployment.

## Spars & Battles (Floating Phone Hover Clash)

Friends can challenge each other to a friendly "fightski fight" / spar right from the Friends panel or Public Plaza.

- **Consent & Connection:** Spars require reciprocal friend consent over the relay WebSocket; both apps must be online.
- **Home vs. Away Perspective:**
  - **Away (Challenger):** Your fren travels to challenge your friend, positioned on the left facing right.
  - **Home (Defender):** Your fren defends their home turf, positioned on the right facing left.
- **On Android Floating Overlay:**
  - The spar plays out directly on the floating phone overlay hovering above whatever app is on screen!
  - Both frens square up (`battle_hop`), charge forward with a head-boop collision (`💥 BOOP!`), execute playful trait antics (lasers, flaps, pounces, hops), followed by dizzy swirl eyes (`@_@`) and a celebratory victory dance with sparkles.
- **Friendly & Safe:** Spars are slapstick, cozy fun with zero negative penalties or pet injury. Both participants gain a Joy boost (+15 Joy) for playing together!

## Mini-games

More → Games opens the mini-game picker inside the app. Choose a player from your linked wallets. Only supported NFTs with verified ownership and a collection animation rig can play; there is no drawn-character fallback. Games do not change which NFTs are floating.

- **Snack Catch:** drag, tap or use ←/→ (A/D) to slide your fren. Catch 🍓 (+1), 🍪 (+2) and ⭐ (+5). Catching a 🧦 costs one of three hearts; missed snacks cost nothing. Snacks fall faster over time.

Best scores save on this device. A completed round lasting at least 15 active seconds with a positive score invokes the existing Play care action once, through the same engine/native bridge as the Care screen. Existing hunger, energy, sickness and activity rules apply. This affects the app’s existing care state; it does not create NFT attributes or token rewards. Each finished round fires `tinyfrens-game-finished` (game, score, best, player collection identity, duration). Leaving the screen cancels without a reward. Hiding the app pauses the clock and sprite; returning resumes. The player inventory is cached for five minutes between rounds; Refresh NFTs or wallet changes clear it. Ownership is checked before each round and expired proof stops the round.

## Robots v1 and FRENS

Robots v1 (Base mainnet, collection `tinyfrens-robots-v1`) are the gamified pets. When a verified Robots v1 is one of your companions, the Care screen tracks that robot: a free daily allowance of care actions, then a FRENS top-up for more. Everything is shown in FRENS, never "credits".

- **Free daily loop.** Each robot gets a daily allowance of care actions (24 by default). Nap and time still regenerate Energy, so a patient player can keep a robot alive without paying.
- **Paid top-up.** Once the free allowance is spent, a care action costs its FRENS price (set on the admin page). The balance comes from FRENS deposits and from game earn-back.
- **Games.** A finished round grants the usual Play care **and** a small FRENS earn-back, when the admin enables it (Snack Catch for v1).
- **Revive.** A downed robot revives as usual; the revive cost is a FRENS price.

The care **simulation** runs on your device exactly as before, so offline, floating-overlay, desktop and native play are unchanged. Only the money-affecting parts — the free allowance, the FRENS charge and the game earn-back — are decided by the server, against a fresh on-chain ownership check. If the relay is offline, care keeps working locally and nothing is charged or earned. This release **reports** care actions and shows the FRENS balance and today's free allowance; hard-blocking a care action on payment and the top-up/deposit screen ship in the next slice.

## Appearance

Shape, colour, size and speed changes apply and save immediately. There is no Save step. Reset restores defaults immediately.

Show/Hide is one state-aware toggle. The Android bubble menu also exposes a top-right × to hide the pet without opening the app; neither action changes care stats.
