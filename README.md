# ✦ TinyFrens

**A little company. A little chaos. Your tiny fren.**

Feed, play, rest, and watch your pocket companion grow. Android lets your pet float over other apps. iPhone and browser versions keep your pet inside their own window.

[Welcome & install guide](https://dutchiono.github.io/TinyFrens/) · [Play in your browser](https://dutchiono.github.io/TinyFrens/play/) · [Android releases](https://github.com/dutchiono/TinyFrens/releases) · [Build status](https://github.com/dutchiono/TinyFrens/actions)

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
4. Switch apps. Drag your pet to move it; tap it to open care. **Hide pet** dismisses it.

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
- Tap the Android pet for its action menu; drag to move it; hold for 0.6 seconds or use Care / style to open the app.
- Choose cat, blob, or robot, any body colour, size, and wandering speed. Saves and appearance persist through signed upgrades.
- Set Free roam for wandering; Bubble stays in place. Sleeping or very low energy pauses movement.
- Android permission shortcuts: Allow floating, App settings (battery/notifications), Allow updates.
- In-app Install update downloads a verified APK and opens Android's install prompt. On first use allow this app to install updates, return, and tap Install update again. Browser download remains available.
- Web/iOS share the appearance controls and care animations; web movement stays inside the page. Cross-app text/buttons are not inspected or controlled.
- Android movement tests run before release publication. Physical-device behaviour still needs validation.

For this first upgrade from 0.3, use the existing Browser download button or download the latest release. After installing 0.5, future updates can use Install update.
