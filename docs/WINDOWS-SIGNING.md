# Windows code signing & trust

Unsigned Windows apps trigger SmartScreen ("Windows protected your PC"). Signing fixes this.
The desktop workflow is already wired so signing turns on automatically once the secrets below exist —
nothing else needs changing in the repo.

## Recommended: Azure Trusted Signing (~$9.99/month)

Microsoft's cloud signing service. No certificate files to babysit, it works from GitHub Actions,
and signed builds are trusted by SmartScreen immediately — no multi-week reputation grind.

Setup (one time, Microsoft's own quickstart has the click-by-click):

1. **Azure account + Trusted Signing account** — create a *Trusted Signing Account* in the Azure
   portal and a *certificate profile* inside it. The profile's subject (e.g. `CN=Your Name`)
   is what users see as the publisher. Microsoft validates your organization first, which can
   take a few days.
2. **App registration** — in Microsoft Entra ID create an app registration, create a client
   secret for it, and give the registration the role **Trusted Signing Certificate Profile
   Signer** on the certificate profile (search by the app registration's name when assigning).
3. **Repository secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   | --- | --- |
   | `AZURE_TENANT_ID` | Entra ID tenant (directory) ID |
   | `AZURE_CLIENT_ID` | App registration (client) ID |
   | `AZURE_CLIENT_SECRET` | Client secret value |
   | `AZURE_SIGNING_ENDPOINT` | Regional endpoint, e.g. `https://eus.codesigning.azure.net/trust/HSM/` (must match where the account was created; `eus`/`wus`/`neu`/`eus2`…) |
   | `AZURE_CODE_SIGNING_ACCOUNT` | Trusted Signing account name |
   | `AZURE_CERT_PROFILE_NAME` | Certificate profile name |
   | `AZURE_PUBLISHER_NAME` | Exact `CN=` subject from the certificate profile (e.g. `CN=Your Name`) |

4. Push to `main`. The Windows build now signs the installer; the release notes switch to the
   "signed" wording automatically. Users installing it see **TinyFrens** as the publisher with
   no SmartScreen block.

Keep the client secret rotated and never commit it — it only lives in Actions secrets. Builds
stay unsigned (and functional) while the secrets are absent, so forks and local builds are unaffected.

## Alternatives

- **OV code signing certificate** (~$70–200/yr from DigiCert, Sectigo, SSL.com, …): export a
  `.pfx`, set `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` secrets. SmartScreen still warns until the
  app accumulates download reputation (days to weeks).
- **EV certificate** (~$300+/yr): key lives on a hardware token, awkward in CI, and since 2024
  Microsoft no longer grants EV instant SmartScreen reputation — Azure Trusted Signing is the
  better deal.
- **Microsoft Store** ($19 one-time developer account): publish the app as MSIX/Win32 —
  Store installs never show SmartScreen. More setup, and Store review policies apply.
- **winget** (free): submit the installer to the winget-pkgs repository for `winget install`.
  Doesn't remove SmartScreen for direct downloads, but gives users a trusted install path.

## macOS

Gatekeeper trust needs an Apple Developer Program membership ($99/yr), a Developer ID
Application certificate, and notarization. It is also required before macOS can self-update
(Squirrel.Mac validates signatures), which is why the Mac build currently uses the manual
download flow while Windows updates automatically.