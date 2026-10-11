# TinyFrens game rules

The Pet screen and Android bubbles use the same three care actions. Opening the bubble menu is not a reward. There are no hidden long-press variants on action buttons. Tap or hold the pet to open its menu; drag to move it.

| Action | Result | When unavailable |
|---|---|---|
| Feed | Snacks +25, capped at 100; eating animation | Already full |
| Play | Joy +20, capped at 100; snacks −8, energy −12; dancing animation | Snacks below 8 or energy below 12 |
| Nap | Energy +25, capped at 100; sleeping animation | Energy already 100 |
| More (bubble menu) | Open the full app | Never changes care stats |

Wave, Dance and Toy in the app are flavour interactions, not extra care rewards. A toy caught by the floating pet does not grant a second Play reward. Feedback reports actual capped gains. Saves, names and looks persist through signed updates.

## Visits

The first implementation is a temporary guest invitation, shared as a link. It carries only the pet's display name, shape, colour and a 30-minute expiry. Recipients must accept. Guest visitors never replace the receiver's own pet or change its saved care stats. Say goodbye removes the guest. A visitor is a snapshot, not a transfer of ownership or a synchronized live pet.

Nearby discovery is not implemented in this release. Native Android/iOS interoperability can use Google's Nearby Connections API (Bluetooth/BLE/Wi-Fi). It needs explicit permissions, both apps active, device-pairing verification and testing on two real phones. RFID/NFC would be a deliberate tap interaction, not continuous discovery. The iPhone web app cannot provide native Bluetooth discovery.

Source: https://developers.google.com/nearby/connections/overview


## Live friends and visits

The optional relay in `server/` provides permanent eight-character codes, accepted friendship, presence and live visitor profiles. Add friend requires the other person to accept. Ask to visit requires a separate acceptance; both apps must be connected. Wave/Dance synchronize without care rewards. Changes to the visiting pet name/look synchronize. Either person can end; disconnect ends it too. Guest never replaces owner saves. Visitors currently appear inside the app, not Android overlay/iOS PiP/widgets. Nearby radio discovery is not implemented; it must enter this same consent flow. See `server/README.md` for deployment.

## Appearance

Shape, colour, size and speed changes apply and save immediately. There is no Save step. Reset restores defaults immediately.
