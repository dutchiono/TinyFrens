# Floating desktop pet

TinyFrens for **Windows x64** and **Mac (Apple Silicon or Intel)** includes a transparent, frameless, always-on-top pet window. This is the interactive pet, not the browser's PiP video.

## Install

Download from the [desktop release](https://github.com/dutchiono/TinyFrens/releases/tag/desktop-latest). The first downloads appear after the Desktop floating pet workflow succeeds.

- Windows: download **TinyFrens-Windows.exe** and run it. It is a one-click installer (no admin needed) that sets up TinyFrens and then keeps itself updated automatically in the background. Windows may show a SmartScreen warning while the build is unsigned; see docs/WINDOWS-SIGNING.md. Check the repository and download source before allowing it.
- Mac: choose **TinyFrens-Mac-arm64.zip** for Apple Silicon or **TinyFrens-Mac-x64.zip** for Intel. Unzip, move TinyFrens.app into Applications, and open it. The build is ad-hoc signed, not notarized. If macOS blocks it, try opening once, then System Settings → Privacy & Security → Open Anyway. Do not disable Gatekeeper globally. A paid Apple membership is not needed to build or locally run this version.

No overlay permission, Accessibility permission, screen recording or administrator access is requested. The app does not read other windows or interact with their contents. Full-screen games, secure desktops, lock screens and some macOS Spaces can prevent overlays from appearing; recover the pet from its tray/menu-bar menu.

## Play

The pet appears when the app opens. Closing the care window leaves the pet running.

- Drag your fren to move it, including between monitors.
- Hover, click or hold to reveal **Feed / Play / Nap / ☰**. Labels fade above it. The care rewards and costs match the full app.
- **☰** opens the full app. **×** at the pet's top right hides it.
- In the app, **Show pet / Hide pet** is one toggle. Looks apply immediately; Free roam wanders and Stay put stops movement. Sleeping and low energy pause wandering.
- Empty space around the pet lets mouse clicks through to the application underneath. Clicking the pet or a visible care button interacts with TinyFrens.
- Use the system tray/menu-bar menu to show/hide, reopen the app, bring the pet back to the primary screen, or quit. Quit ends the app completely.

Wave, Dance and Toy are cosmetic. Toy appears beside the pet and has no care reward; a separate moving desktop toy chase is not implemented. Accepted friends and visits appear inside the care app, using the same optional relay as mobile; guest pets do not yet float on the desktop.

## Effects

Looks → Little touches adds 40–100% pet opacity, sparkles, screen effects, fade and Reduce motion. Desktop care effects stay around the pet and never take keyboard focus or intercept clicks. Hide/show fades are brief. Reduce motion (including the OS preference) disables wandering and care particles. Desktop haptics are unavailable; native Android and iPhone support them on compatible hardware.

## Save and updates

The full app and floating window share one native save, stored as pet.json under Electron's user-data directory (TinyFrens/tinyfrens-desktop depending on packaging). Names, care and appearance survive replacing the executable/app with a newer version. Browser and phone saves remain separate. Do not delete the app-data folder to update.

On Windows, updates check automatically while the care app is active and can be checked manually from Settings. A new version downloads quietly in the background; a banner offers **Restart & install**, and simply closing the app installs it too. Your pet stays saved. On Mac, unsigned builds cannot self-update, so an available update opens the desktop release page to download manually. Desktop releases are separate from Android/iOS releases and do not become GitHub's latest phone release.

## Development

From this directory with Node 24 installed:

```sh
npm ci
npm run prepare-assets
npm start
```

Build on the target operating system:

```sh
npm run dist -- --win --x64
npm run dist -- --mac --arm64
npm run dist -- --mac --x64
```

Run `npm test` for care parity, persistence, and monitor geometry tests; `npx electron . --tinyfrens-smoke` exercises the real renderer and overlay using a temporary save. GitHub Actions runs tests and builds all three downloads. Physical-machine testing is still needed for drag/click-through, DPI changes and full-screen/Spaces behavior.

The renderer is sandboxed with context isolation, no Node integration and a limited preload bridge. IPC accepts only the packaged top-level windows. Remote links open in the browser through an allowlist; the app never loads remote pages with desktop privileges. Care state is written atomically. No desktop signing secrets are required for these initial builds.
