# Pocket Familiar — Android overlay pet + offline PWA

A complete **starter source project**, not a precompiled APK. Includes a native Kotlin Android overlay service and a shared HTML/CSS/JS pet management UI that also runs as a standalone installable PWA. No backend, account, or app-store submission required.

## Requirements

- Android Studio (recent stable, supporting Android Gradle Plugin 8.9.2), JDK 17, Android SDK Platform 35.
- Android phone or emulator running Android 8.0+ (API 26+).
- Internet connection **for the first Gradle dependency sync**.
- For the PWA: any static HTTPS host (or localhost for development).

## Build Android APK

1. Extract ZIP. In Android Studio choose **Open** and select the extracted `floating-pet-starter` root folder (the one containing `settings.gradle.kts`).
2. Allow Gradle sync and install the prompted SDK components. This starter intentionally does **not** bundle the Gradle wrapper JAR or a prebuilt binary. Android Studio can use its configured Gradle installation; if prompted to create a wrapper, choose Gradle **8.11.1** or newer compatible with AGP 8.9.2.
3. Choose **Build → Build Bundle(s) / APK(s) → Build APK(s)**. Output: `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Install on your phone using Android Studio **Run**, or `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` with USB debugging enabled.
5. Launch **Pocket Familiar**, press **Show pet**, and grant **Display over other apps** permission in Android Settings. Return to the app and press **Show pet** again.
6. Switch apps. Drag the pet anywhere; tap it to open the management screen. Press **Hide pet** to remove the overlay.

If Android Studio asks for a Gradle distribution and no local Gradle is available, install Gradle 8.11.1+ compatible with the plugin and run `gradle wrapper --gradle-version 8.13` at the project root, then use `./gradlew :android:app:assembleDebug` (Windows: `gradlew.bat :android:app:assembleDebug`).

**Signing for website distribution:** Debug APKs are only for development. For release, use **Build → Generate Signed Bundle / APK → APK**, create and securely back up your keystore, then distribute the signed APK via HTTPS. Keep the same signing key for updates. Android will show security prompts for sideloaded APKs; some Android versions/regions have additional developer verification rules.

## Run/install the PWA

- In `web/`, run `python -m http.server 8000` and visit `http://localhost:8000` for local testing.
- For install on a phone, publish the **contents** of `web/` to an HTTPS static host, open the URL in Chrome and choose **Install app** or **Add to Home screen**.
- Service worker caches the UI for offline use. Pet data is stored in browser `localStorage`.
- **Browser/PWA cannot float over other apps.** Only the native APK does that.

## How it works

- `android/app/src/main/java/com/example/floatingpet/PetOverlayService.kt`: foreground service, persistent notification, transparent `TYPE_APPLICATION_OVERLAY` window, animation loop.
- `PetView.kt`: drawn pixel pet, drag gesture, tap to open app.
- `PetStore.kt`: local Android `SharedPreferences` state and time-based stat decay.
- `MainActivity.kt`: embedded WebView, narrowly scoped JS bridge for pet actions, permission and overlay controls.
- `web/`: **same interface** loaded from APK assets or installed as a standalone PWA.

The Android WebView shares state with the overlay via `PetStore`; the standalone browser PWA has its **own** independent `localStorage` state. Cloud sync is not implemented. The PWA's free-roam/bubble selector changes saved preference, but only the APK can move outside its window. Bubble mode currently **stops roaming**; it does not replace the pet sprite with a circular icon yet.

## MVP features

- Transparent pet overlay with dragging and gentle horizontal roaming.
- Free-roam or stationary bubble **behavior** selector.
- Feed, play, rest; hunger/happiness/energy decay hourly, persisted across restarts.
- Offline-capable installable PWA and native app interface.
- Foreground notification and explicit hide control.

## Known limitations / next steps

- **Not compiled or device-tested in this environment**. Perform Gradle sync and test on a real Android device before distributing.
- Android may restrict background services, overlays, and activity launches on some devices. Foreground service does not guarantee indefinite survival; OEM battery policies vary. Users must explicitly grant overlay permission.
- Notification permission on Android 13+ is requested at launch; service notifications are subject to OS policy.
- Android 15+ edge-to-edge/insets and overlay behavior should be validated on target devices.
- The pet sprite is procedurally drawn, not a full sprite sheet; add distinct walk/sleep/eat frames and a circular bubble rendering for production.
- Native and browser saves are independent. Add opt-in account/cloud sync if needed.
- Future improvements: screen-edge collision, screen orientation changes, drag-position persistence, explicit notification stop action, boot behavior opt-in, accessibility, tests, and energy-efficient animation.

## Security and privacy

No analytics, ads, or personal server. The APK now uses INTERNET permission to check public GitHub release metadata when opened or on request. WebView only loads bundled local UI assets and does not enable file-to-file or file-to-network cross-origin access. Android JS bridge is exposed only to this trusted bundled content; do not navigate this WebView to untrusted websites.

## License

MIT. See `LICENSE`.

## Update 0.2 — overlay polish and growth

- **Actual bubble appearance:** switching to Bubble draws a circular dark badge with a light ring around the familiar, not merely pausing movement.
- **Screen boundaries:** dragging is constrained to the display dimensions; automatic roaming reverses direction at horizontal edges.
- **Position persistence:** drag placement is saved in Android preferences and restored on next launch.
- **Notification hide action:** tap **Hide pet** directly from the ongoing foreground-service notification.
- **Visible evolution:** Hatchling (day 0), Sprout (day 1), Elder (day 2+) with purple → cyan → amber variants, on Android and PWA. These are intentionally accelerated prototype thresholds.
- **Mood frames:** the native sprite closes its eyes when low on energy.

### Test checklist on a physical phone

1. Grant overlay permission; show pet; switch to a different app.
2. Drag to each screen edge and verify it stays visible; hide/show and verify position restoration.
3. Select **Bubble** in the main app; verify the round badge appears and roaming stops; switch back to **Free roam**.
4. Tap the persistent notification's **Hide pet** action and verify overlay disappears.
5. Feed/play/rest, force-close and reopen management UI, and verify stat persistence.
6. Rotate the device and test overlay bounds. The current implementation clamps movement using display metrics when created; it does not yet recompute bounds on rotation without restarting the overlay.

**Important:** Native APK compilation and device testing have not been performed in this environment. The update keeps Android and browser saves separate, and does not add network permissions.

## Update 0.3 — GitHub distribution

See [GITHUB_SETUP.md](GITHUB_SETUP.md) for automatic APK builds, stable release signing, and in-app update checks. Release downloads open in the external browser; Android requests installation approval. Remote asset hot updates are not implemented.
