# ✦ TinyFrens

**A little company. A little chaos. Your tiny fren.**

Feed, play, rest, and watch your pocket companion grow. Android lets your pet float over other apps. iPhone and browser versions keep your pet inside their own window.

[Welcome & install guide](https://tinyfrens.lol/) · [Play in your browser](https://tinyfrens.lol/web/) · [Android releases](https://github.com/dutchiono/TinyFrens/releases) · [Build status](https://github.com/dutchiono/TinyFrens/actions)

> The welcome site is available after GitHub Pages is enabled. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**, then run **Actions → Welcome site → Run workflow**.

## Find TinyFrens

[Website](https://tinyfrens.lol) · [Telegram](https://t.me/tinyfrens) · [X / Twitter](https://x.com/TinyFrens_) · [Email](mailto:Tinyfrens@agentmail.to)

## Vercel hosting

See [VERCEL.md](VERCEL.md) for import settings, domain setup, and the friends server requirements.

## Bring a fren home

| Platform | Start here | What it can do |
|---|---|---|
| Android 8+ | Download `pocket-familiar.apk` from Releases | Floating pet, dragging, roaming/bubble mode, feed/play/rest/chat, local save |
| iPhone / iPad | Open the web pet in Safari → Share → Add to Home Screen | Home-screen pet, care, growth, local browser save |
| Windows PC x64 | [Desktop download](https://github.com/dutchiono/TinyFrens/releases/tag/desktop-latest) | Transparent floating pet, wandering, drag, care bubbles, shared desktop save |
| Mac (Apple Silicon / Intel) | [Desktop download](https://github.com/dutchiono/TinyFrens/releases/tag/desktop-latest) | Transparent floating pet, wandering, drag, care bubbles, shared desktop save |
| Browser | Open the web pet | Pet care, growth, local save, offline use after first load |
| Native iOS | [iOS source and instructions](ios/README.md) | In-app pet; installation requires Apple signing |

## Bankr wallet glance

The Wallet tab uses the TinyFrens server as a safe bridge to Bankr. Add `BANKR_API_KEY` to the server environment to enable read-only wallet monitoring from the app. The key stays on the server; the app sends only a public wallet address and a short question. This first integration does not provision per-fren wallets, trade, sign, transfer, or expose private keys. Partner wallet provisioning can come later if TinyFrens grows into that.

### Windows and Mac floating pet

Download the matching native app from the [desktop release](https://github.com/dutchiono/TinyFrens/releases/tag/desktop-latest): Windows x64 portable executable, Mac Apple Silicon zip, or Mac Intel zip. See [desktop installation and controls](desktop/README.md). First downloads appear after the Desktop floating pet workflow succeeds.

The transparent pet floats above normal apps, wanders, pauses for interactions, and can be dragged between monitors. Hover, click or hold for Feed / Play / Nap / ☰; × hides it. Empty margins let clicks through. The full app and floating pet share native care/name/look state; looks change instantly. Show/Hide is one toggle. Tray/menu-bar controls reopen, recover, hide or quit.

Desktop builds are unsigned on Windows and ad-hoc signed but not notarized on Mac. OS security prompts may appear. Updates alert and link to a manual replacement download; no automatic installer. Physical Windows/Mac testing is still needed for full-screen/Spaces, mixed DPI and drag/click-through behavior. Browser/phone saves are separate.

The web pet also remains available on either computer. Edge can install it as a web app; Safari on macOS 14+ can add it to the Dock. The native desktop download supplies the transparent interactive overlay.

### Android installation

1. Open the signed APK and approve installation. Allow installation from your browser/file manager when Android asks.
2. Launch **Pocket Familiar**, tap **Show pet**, and grant **Display over other apps**.
3. Return to the app and tap **Show pet** again.
4. Switch apps. Drag your pet to move it; tap or hold it for quick actions; use the rightmost ☰ button to open care. **Hide pet** dismisses it.

Use signed release APKs for your ongoing pet. Debug artifacts are test builds and can have different signing keys.

### Updates

Push to `main` → GitHub builds → a signed Android release appears → open the pet app → **Download update** → approve installation. Release signing must first be configured with the four repository secrets in the [setup guide](GITHUB_SETUP.md). Updating with the same signing key keeps the native pet save; uninstalling erases it. Reopen the app after updating to show the overlay again.

The browser pet caches files offline; reopen it after a site update. Saves are local and independent on each platform, with no cloud sync or accounts.

## Build and project setup

- [GitHub Actions and Android release signing](GITHUB_SETUP.md)
- [Android local build / architecture](DEVELOPER.md)
- [Native iOS build and signing](ios/README.md)

The iOS workflow builds a simulator app and unsigned device archive. These are not signed installable IPAs or TestFlight releases. The Android-style cross-app overlay is not available on iOS.

MIT licensed. Early prototype; real-phone QA is still needed.

## Update 0.5 — active companions

- Wander across both screen axes, pause, blink, dance, eat, wave, sleep, and chase a floating toy.
- Tap the Android pet for its action menu; drag to move it; tap or hold for circular actions; use the rightmost ☰ button to open the app.
- Choose from 8 companions (cat, blob, robot, bunny, dog, bear, frog, or turtle), any body colour, size, and wandering speed. Saves and appearance persist through signed upgrades.
- Set Free roam for wandering; Bubble stays in place. Sleeping or very low energy pauses movement.
- Android permission shortcuts: Allow floating, App settings (battery/notifications), Allow updates.
- In-app Install update downloads a verified APK and opens Android's install prompt. On first use allow this app to install updates, return, and tap Install update again. Browser download remains available.
- Web/iOS share the appearance controls and care animations; web movement stays inside the page. Cross-app text/buttons are not inspected or controlled.
- Android movement tests run before release publication. Physical-device behaviour still needs validation.

For this first upgrade from 0.3, use the existing Browser download button or download the latest release. After installing 0.5, future updates can use Install update.

## Floating bubble controls

Tap or hold the pet to reveal three circular action buttons and a rightmost ☰ button under it. The menu flips above the pet near the bottom edge. Dragging dismisses the bubbles and moves the pet.

- 🍓 Feed; hold for a wave.
- 🎾 Play/dance; hold to place a toy.
- ☾ Sleep.
- ☰ Open the full care, customization, settings, and update app.

Touch, mouse hover, or stylus hover shows a short label above the pet. Action responses fade away; the bubbles dismiss after eight seconds without interaction. Opening quick controls pauses wandering.

## Free iPhone web app + PiP video

Share https://tinyfrens.lol/ or directly https://tinyfrens.lol/web/. The old /play/ URL now redirects. The repository root includes the real welcome page, so branch-based and workflow publishing both serve the same layout.

In Safari: open the pet, tap Float pet, play the video if prompted, then tap Float pet again. iOS can provide a system-managed floating video window where supported; this is not a transparent interactive overlay. Care buttons remain in the webpage. Share → Add to Home Screen installs the free web app. If the installed web app does not offer PiP, open the same pet page in Safari.

PiP loops match cat/blob/robot and the nearest of six colour presets. Videos are bundled offline-compatible H.264/AAC MP4 clips; generated with scripts/build-pet-videos.py. Native iOS shell also enables inline video and PiP playback, but native installation still needs Apple signing. Safari/iPhone device testing is required for PiP behaviour.

## Family setup and widgets

The welcome page now has short phone-first instructions, direct Android download, grown-up permission steps, video PiP help, and widget availability. The same care/help instructions are bundled in the Android and iOS apps.

The native iOS build includes a small WidgetKit hello widget. It opens TinyFrens when tapped; it does not show live care data or continuous animation. It needs installation of the signed native app; the Safari home-screen icon is not a widget. Open the installed native app once, then hold the home screen → Edit → Add Widget (or +) → TinyFrens → Add Widget. Android does not yet include a native home-screen widget.

## Mobile UI, updates, and visits

Pet / Chat / Looks / Settings replace the long care dashboard. [Game rules](GAMEPLAY.md) define the matching app and bubble actions. Native Android checks on launch/return and every 15 minutes while active; the floating pet also checks while running. Available updates show a banner and Android notification. Optional Wi-Fi downloads prepare a verified APK; Android still asks before installation. The web app downloads service-worker updates and offers Refresh, or applies a waiting update next launch. Native iOS checks the latest release for a newer unsigned iPhone build and shows signing/AltStore update help.

Releases also include TinyFrens-unsigned.ipa, packaged for local signing with your own account (for example AltStore Classic). It is not signed or directly installable from Safari. Native iOS update checks use build-info.json stamped by CI. Locally built apps need equivalent revision/build timestamp metadata.

Visit invites create a temporary, accepted guest on the receiver's web pet page. Bluetooth/Wi-Fi discovery and live ownership transfers are not included yet.


## Live friends (deploy later)

The optional [friends relay](server/README.md) includes Docker/Caddy HTTPS setup, persistent friend codes, friend acceptance, online status, live visit requests, synchronized looks and cosmetic guest actions. Set the server address in app Settings after deploying; the app works without it. Nearby radio discovery is not included. Appearance choices now apply and save immediately.

The PFP robot has been removed. Existing pets using it switch to Simple robot without losing their name, look settings or care stats.

Floating controls use one Show/Hide toggle. Tap, hold, or hover the Android pet for its bubbles; the chat bubble opens a tiny overlay composer and replies above the pet. The top-right × hides the whole floating pet. [Screen effects and objects](ROADMAP.md) are planned, not yet enabled.


## Little touches

Looks now includes pet opacity (40–100%), sparkle bursts, gentle care screen effects, soft care sounds, fade, haptic taps and Reduce motion controls. Preferences save immediately. Native Android overlay and Windows/Mac overlay show care effects near the pet; web/iOS show them in the app. Android and native iPhone support haptics; Safari does not. System-controlled iPhone PiP is an opaque video and cannot use transparent pet opacity or these screen overlays. Effects have no care rewards. OS reduced-motion preferences also apply.
