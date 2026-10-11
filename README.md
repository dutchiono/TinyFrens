# ✦ TinyFrens

**A little company. A little chaos. Your tiny fren.**

Feed, play, rest, and watch your pocket companion grow. Android lets your pet float over other apps. iPhone and browser versions keep your pet inside their own window.

[Welcome & install guide](https://dutchiono.github.io/TinyFrens/) · [Play in your browser](https://dutchiono.github.io/TinyFrens/web/) · [Android releases](https://github.com/dutchiono/TinyFrens/releases) · [Build status](https://github.com/dutchiono/TinyFrens/actions)

> The welcome site is available after GitHub Pages is enabled. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**, then run **Actions → Welcome site → Run workflow**.

## Bring a fren home

| Platform | Start here | What it can do |
|---|---|---|
| Android 8+ | Download `pocket-familiar.apk` from Releases | Floating pet, dragging, roaming/bubble mode, feed/play/rest, local save |
| iPhone / iPad | Open the web pet in Safari → Share → Add to Home Screen | Home-screen pet, care, growth, local browser save |
| Browser | Open the web pet | Pet care, growth, local save, offline use after first load |
| Native iOS | [iOS source and instructions](ios/README.md) | In-app pet; installation requires Apple signing |

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
- Choose cat, blob, or robot, any body colour, size, and wandering speed. Saves and appearance persist through signed upgrades.
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

Share https://dutchiono.github.io/TinyFrens/ or directly https://dutchiono.github.io/TinyFrens/web/. The old /play/ URL now redirects. The repository root includes the real welcome page, so branch-based and workflow publishing both serve the same layout.

In Safari: open the pet, tap Float pet, play the video if prompted, then tap Float pet again. iOS can provide a system-managed floating video window where supported; this is not a transparent interactive overlay. Care buttons remain in the webpage. Share → Add to Home Screen installs the free web app. If the installed web app does not offer PiP, open the same pet page in Safari.

PiP loops match cat/blob/robot and the nearest of six colour presets. Videos are bundled offline-compatible H.264/AAC MP4 clips; generated with scripts/build-pet-videos.py. Native iOS shell also enables inline video and PiP playback, but native installation still needs Apple signing. Safari/iPhone device testing is required for PiP behaviour.

## Family setup and widgets

The welcome page now has short phone-first instructions, direct Android download, grown-up permission steps, video PiP help, and widget availability. The same care/help instructions are bundled in the Android and iOS apps.

The native iOS build includes a small WidgetKit hello widget. It opens TinyFrens when tapped; it does not show live care data or continuous animation. It needs installation of the signed native app; the Safari home-screen icon is not a widget. Open the installed native app once, then hold the home screen → Edit → Add Widget (or +) → TinyFrens → Add Widget. Android does not yet include a native home-screen widget.

## Mobile UI, updates, and visits

Pet / Looks / Settings replace the long care dashboard. [Game rules](GAMEPLAY.md) define the matching app and bubble actions. Native Android checks on launch/return and every 15 minutes while active; available updates show a banner. Optional Wi-Fi downloads prepare a verified APK; Android still asks before installation. The web app downloads service-worker updates and offers Refresh, or applies a waiting update next launch. Native iOS checks the latest release for a newer unsigned iPhone build and shows signing/AltStore update help.

Releases also include TinyFrens-unsigned.ipa, packaged for local signing with your own account (for example AltStore Classic). It is not signed or directly installable from Safari. Native iOS update checks use build-info.json stamped by CI. Locally built apps need equivalent revision/build timestamp metadata.

Visit invites create a temporary, accepted guest on the receiver's web pet page. Bluetooth/Wi-Fi discovery and live ownership transfers are not included yet.


## Live friends (deploy later)

The optional [friends relay](server/README.md) includes Docker/Caddy HTTPS setup, persistent friend codes, friend acceptance, online status, live visit requests, synchronized looks and cosmetic guest actions. Set the server address in app Settings after deploying; the app works without it. Nearby radio discovery is not included. Appearance choices now apply and save immediately.

The PFP robot has been removed. Existing pets using it switch to Simple robot without losing their name, look settings or care stats.
