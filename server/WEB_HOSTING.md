# Public website on miono

The registrar keeps authoritative DNS. Both public website names point at
198.71.54.203: `@ A 198.71.54.203`, `www CNAME tinyfrens.lol`.
The site does not require a Vercel deployment.

nginx serves `scripts/build-site.mjs` output from
`/var/www/tinyfrens/current`, a symlink into `releases/<git SHA>`.
The API and native app endpoint remain `https://tinyfrens.miono.live`.
Snap content negotiation and `/snap` and `/api/snap/*` requests proxy to the
existing relay on 127.0.0.1:8790. The admin surface remains relay-only.

## First installation

1. Build and upload the static output to a release directory and point `current`
   at that directory. Keep files readable/traversable by nginx.
2. Add an HTTP nginx site for both public names and serve
   `/.well-known/acme-challenge/` from `/var/www/html`.
3. Obtain a certificate with
   `sudo certbot certonly --webroot -w /var/www/html -d tinyfrens.lol -d www.tinyfrens.lol`.
4. Install `server/nginx-tinyfrens.conf` as
   `/etc/nginx/sites-available/tinyfrens.lol` and enable its symlink in
   `sites-enabled`. Run `sudo nginx -t` before `sudo systemctl reload nginx`.
5. Enable the Certbot renewal timer and ensure renewals reload nginx.

## Automatic updates

`.github/workflows/publish-server.yml` publishes every new `main` revision,
and can be run manually on `main` from GitHub Actions. It uses repository
secrets `TF_WEB_SSH_KEY` and `TF_WEB_KNOWN_HOSTS`. Pull requests never publish.
The trusted owner auto-merge workflow explicitly dispatches both production
workflows after GitHub completes a native auto-merge whose `GITHUB_TOKEN`
suppresses downstream push workflows. Unchanged releases skip the build and
upload.

The `tinyfrens-deploy` system account is separate from the API user and has
no sudo privileges. Its SSH key is restricted to the root-owned Node 22
`/usr/local/libexec/tinyfrens-publish-web` receiver (`server/publish-web.mjs`).
That receiver validates the archive, locks concurrent publishes, records the
commit in `/release.json`, and atomically switches `current`. It verifies
HTTPS responses on both names and restores the previous release on failure.
The current release is idempotent; failed releases can be retried.

After public verification, the workflow invokes the same restricted receiver
with `notify <commit SHA>`. The receiver re-verifies the release and calls the
loopback-only TypeScript endpoint using a server-owned secret. Telegram
subscriptions are managed by the owner-only `/deploynotify` command.

Documentation is built offline with bundled marked 15.0.12 under `/docs/`;
links now use that path instead of an unconfigured documentation subdomain.
The same artifact contains the landing page, browser app, icons, manifests,
robots launch package, skills, and docs. No external CDN is required to build.

## Manual recovery and rollback

For an authorized recovery publish, set `TF_WEB_SSH_KEY_FILE` and
`TF_WEB_KNOWN_HOSTS_FILE` to local deployment credentials, then run
`bash scripts/deploy-web.sh`. Normal updates need no local key.

To roll back as an operator, point `current` at the previous verified release
with a new symlink and atomic rename. Keep previous releases until the update
is verified. The receiver is root-owned and is installed separately from site
artifacts; changes to that receiver require explicit operator deployment.

Vercel automatic Git deployments are disabled by the minimal `vercel.json`,
and the obsolete GitHub Pages workflow and Pages site have been removed.

## Verification

Run `node scripts/verify-web-hosting.mjs --address 198.71.54.203` to bypass DNS
caches while still validating the actual TLS certificate for each name. The
checks cover HTML, docs, app/gallery, skills, manifests, Snap negotiation and
POST, redirects, and blocked private paths. The server's regular-DNS version
of the same checks should pass too. `certbot renew --cert-name tinyfrens.lol
--dry-run --no-random-sleep-on-renew` validates renewal. The domain-scoped
reload hook is `server/renew-web-certificate.sh`.

This workflow publishes the **website**, not backend modules, native app
releases, contracts, or funds. Production server-bound code is Node/TypeScript.
