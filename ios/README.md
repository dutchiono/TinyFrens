# TinyFrens for iPhone and iPad

Native SwiftUI shell with the bundled offline pet interface in WKWebView. Feed/play/rest, evolution, and local save work inside the app. No Android-style overlay over other apps. Browser, iOS, and Android saves are separate.

## GitHub builds

The iOS build workflow uses a macOS runner and XcodeGen to generate the Xcode project. It builds both a simulator app and an unsigned device archive. Download artifacts from Actions → iOS build. The unsigned archive is a compile artifact, **not an installable IPA**.

## Run on your iPhone

On a Mac with Xcode: install XcodeGen (`brew install xcodegen`), run `cd ios && xcodegen generate`, open TinyFrens.xcodeproj, select your own Apple development team in Signing & Capabilities, change the bundle ID if needed, select your connected iPhone, and Run. Follow Xcode's device trust / Developer Mode prompts.

For TestFlight, join/use the Apple Developer Program, create the matching App Store Connect app, configure your Apple signing identity, and archive/distribute via Xcode. Signing certificates/provisioning profiles and App Store Connect access are not available in this repository. Android keystore secrets do not sign iOS builds. A production distribution also needs app icons and real-device QA.

## No Mac or signing available right now?

Use the hosted pet at https://dutchiono.github.io/TinyFrens/web/ after GitHub Pages is enabled. In Safari open Share → Add to Home Screen. This is the browser/PWA version; it plays inside its own window and supports offline use after the first load.

## Picture in Picture

The shell enables WKWebView inline/PiP video playback and the playback audio session. Bundled pet MP4 loops can be played through the web interface using Float pet or the video player controls. PiP is controlled by iOS and requires an actual iPhone test. This does not add a transparent cross-app pet or bypass native signing. The free Safari/home-screen web app uses the same PiP interface.

## Free-account sideloading and updates

Download TinyFrens-unsigned.ipa from the latest GitHub release (or the tinyfrens-ios-sideload workflow artifact). AltStore Classic on a Windows PC/Mac can sign it with your own free account and install it on your phone. Free provisioning expires after seven days and needs refresh. This file is unsigned; tapping it in Safari does not install it.

The app checks for newer iPhone release builds on launch/return and every 15 minutes while active, and displays an update banner. The Update help button leads here. Install a newer IPA through your existing signing/AltStore setup; the app cannot silently replace its native executable. The CI-stamped web/build-info.json identifies the installed source revision and build date. Native widgets use an additional app ID when signed.
