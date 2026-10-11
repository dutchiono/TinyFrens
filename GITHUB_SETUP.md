# TinyFrens: GitHub builds and phone updates

Repository: https://github.com/dutchiono/TinyFrens

## What works without your server

Every main-branch push runs the Android workflow and produces a test APK under Actions → Android APK → latest successful run → Artifacts. Download the artifact ZIP and extract the APK. This is a test build: runner-generated debug keys can change between runs, so do not rely on debug APKs for persistent updates. Use signed release APKs for your ongoing pet.

Once the signing secrets below are configured, each main-branch push also publishes a signed APK and update manifest under Releases. The app checks the latest public release when you open it. You can also press Check for updates. Download opens your browser; open the downloaded APK and approve Android's install prompt. Permit installation from that browser/file manager when asked. There are no silent installs or checks while the app is closed.

## One-time signing setup

Create a release keystore on a trusted computer with JDK keytool installed:

```sh
keytool -genkeypair -keystore pet-release.jks -alias pocket-familiar -keyalg RSA -keysize 3072 -validity 10000
```

Keep a secure backup of the key and passwords. Never commit them. In repository Settings → Secrets and variables → Actions, add these repository secrets:

| Secret | Value |
|---|---|
| PET_KEYSTORE_BASE64 | Base64-encoded bytes of pet-release.jks |
| PET_STORE_PASSWORD | Keystore password |
| PET_KEY_ALIAS | pocket-familiar |
| PET_KEY_PASSWORD | Key password (often the same as the store password) |

Linux: `base64 -w0 pet-release.jks`.
macOS: `base64 < pet-release.jks | tr -d '\n'`.
PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\pet-release.jks)))`.

Paste this value only into the secret field. Run Actions → Android APK → Run workflow after adding all four secrets. Download the first signed APK from Releases and install it. Keep using this same signing key forever.

If you already installed a debug APK, Android may require uninstalling it before the first signed release. Uninstalling erases the native pet save. Set up signing before starting a pet you want to keep.

## Updating

Push to main → Actions builds → signed release appears → open Pocket Familiar → Download update → approve installation. PR builds never receive signing secrets and do not publish releases. The release version code is 1000 + this workflow's run number. Keep the workflow identity/run history; if migrating it, raise the version-code offset above the highest shipped code.

The checker uses public GitHub Releases without a token, so this repository must remain public. A private repository needs a different authenticated distribution design; never embed a GitHub token in an APK. GitHub rate limits/offline failures appear as a status message, and gameplay still works offline.

## Scope and validation

App ID remains com.example.floatingpet to preserve compatibility with the starter. Updates replace the app and bundled assets; native SharedPreferences data remains. Sprites/dialogue hot updates are not implemented in this version. The existing pixel overlay and web pet remain unchanged visually.

Device checklist: install signed release; feed pet; publish another build; open app and check update; install it without uninstalling; verify pet stats and position remain; test offline check, no-release repo, invalid repo, and permissions. Reopen/show the overlay after installation.

GitHub Actions is the compile validation environment. This source has not been locally compiled or tested on a physical phone in ChatGPT's workspace.
