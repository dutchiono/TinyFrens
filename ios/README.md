# TinyFrens for iPhone and iPad

Native SwiftUI shell with the bundled offline pet interface in WKWebView. Feed/play/rest, evolution, and local save work inside the app. No Android-style overlay over other apps. Browser, iOS, and Android saves are separate.

The Hood Turtle source flow opens **Import Hood Turtle** inside the app, creates a device pairing code for Bankr, accepts the verified wallet, and displays the NFT's original artwork. Its native HTTPS bridge only permits the configured TinyFrens relay and specific connection routes. Verification renews daily; expired artwork stays hidden until an online check succeeds. The relay and skill must be published and an updated app signed/distributed before live use. This work was authored on Windows and requires macOS/Xcode compilation and device QA.

## GitHub builds

## Widget preview on Windows

Apple's iPhone Simulator is part of Xcode on macOS; it cannot run natively on Windows. From the repository root, run `python -m http.server 8876 --bind 127.0.0.1` and open `http://127.0.0.1:8876/ios/widget-preview.html` to compare small/medium Home Screen and rectangular Lock Screen layouts. This is a browser design preview, not native iOS rendering.

The native widget supports small/medium Home Screen and circular/rectangular Lock Screen placements. It currently shows a static mascot; taps open the app, and the medium care link and rectangular widget open Care and extras. Live saved-pet syncing and in-widget care are not implemented. Build and validate the Swift code and actual widget layout with Xcode before distributing.

## GitHub builds

The iOS build workflow uses a macOS runner and XcodeGen to generate the Xcode project. It builds both a simulator app and an unsigned device archive. Download artifacts from Actions → iOS build. The unsigned archive is a compile artifact, **not an installable IPA**.

## Run on your iPhone

On a Mac with Xcode: install XcodeGen (`brew install xcodegen`), run `cd ios && xcodegen generate`, open TinyFrens.xcodeproj, select your own Apple development team in Signing & Capabilities, change the bundle ID if needed, select your connected iPhone, and Run. Follow Xcode's device trust / Developer Mode prompts.

For TestFlight, join/use the Apple Developer Program, create the matching App Store Connect app, configure your Apple signing identity, and archive/distribute via Xcode. Signing certificates/provisioning profiles and App Store Connect access are not available in this repository. Android keystore secrets do not sign iOS builds. A production distribution also needs app icons and real-device QA.

## No Mac or signing available right now?

Use the hosted pet at https://tinyfrens.lol/web/. In Safari open Share → Add to Home Screen. This is the browser/PWA version; it plays inside its own window and supports offline use after the first load.

## Legacy Picture in Picture

PiP video is excluded from the native app and Hood Turtle onboarding. The older browser video panel is only available with `?legacyPip=1`. The planned App Store experience displays original turtle artwork inside TinyFrens; it does not claim a transparent overlay over arbitrary iOS apps.

## Free-account sideloading and updates

Download TinyFrens-unsigned.ipa from the latest GitHub release (or the tinyfrens-ios-sideload workflow artifact). AltStore Classic on a Windows PC/Mac can sign it with your own free account and install it on your phone. Free provisioning expires after seven days and needs refresh. This file is unsigned; tapping it in Safari does not install it.

The app checks for newer iPhone release builds on launch/return and every 15 minutes while active, and displays an update banner. The Update help button leads here. Install a newer IPA through your existing signing/AltStore setup; the app cannot silently replace its native executable. The CI-stamped web/build-info.json identifies the installed source revision and build date. Native widgets use an additional app ID when signed.
