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

## Updating the website

Run `bash scripts/deploy-web.sh` from the desired merged checkout on a machine
with the `miono` SSH alias. This builds the normal site artifact, uploads it,
and atomically switches `current`. This is a manual deployment; no GitHub SSH
credential has been provisioned. Vercel/GitHub Pages builds do not update it.

To roll back, point `current` at the previous verified release with a new
symlink and atomic rename. Retain previous releases until the update is verified.

Verify HTML on both names, the web app, gallery, skills, Farcaster manifest,
Snap JSON via `/snap` and `Accept: application/vnd.farcaster.snap+json` on `/`,
and HTTPS/HTTP redirects. Paid deposits and RPC settings are unrelated to this
static-site deployment and must not be changed during it.
