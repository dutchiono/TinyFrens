# Vercel deployment

## Website and web pet

Import dutchiono/TinyFrens with these settings:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Root directory | Repository root (leave blank) |
| Build command | `node scripts/build-site.mjs` |
| Output directory | `dist` |
| Install command | Empty; no dependencies |
| Environment variables | None required |

The committed `vercel.json` supplies the build settings. Do not choose a Python application preset or set the root to server/.
The build copies only the welcome page, site assets, web pet, and legacy play redirect. It does not publish native source, server data, or signing files.

After deployment, open Project → Settings → Domains, add `tinyfrens.lol` and `www.tinyfrens.lol`, and enter the DNS records Vercel displays at your domain provider. The public website should be shared as https://tinyfrens.lol/.

Pushes to the connected main branch deploy website changes. Android and iOS app updates continue through GitHub Actions.

## Friends server: separate deployment for now

The existing server is a Python aiohttp application, not a FastAPI/ASGI Vercel entry point. It uses persistent SQLite storage and in-process WebSocket, presence, and visit registries. The website configuration above does **not** deploy it as Vercel Functions.

Vercel introduced native WebSocket support in public beta in June 2026, but Function instances cannot be treated as one persistent shared process. Deploying this relay there requires a supported runtime adapter, an external durable database for identities/friendships, shared presence/visit state and cross-instance messaging, and connection-lifetime/reconnect handling. Setting a Python preset or a DB_PATH environment variable does not supply those pieces.

Until that adaptation is implemented, use the existing [Docker server instructions](server/README.md) on your server. A suggested separate address is `https://pets.tinyfrens.lol`; only configure it once that server is deployed.

The app's Settings → Friends server setup accepts the relay's HTTPS address. To bundle a default into future web/native builds, set `window.TINYFRENS_SERVER` in `web/social-config.js` to the deployed URL. This is a public URL, not a secret.

No Vercel database credentials, GitHub tokens, Android signing secrets, Apple credentials, or AgentMail API key are needed for the website. Do not copy signing secrets into Vercel.

## References

- https://vercel.com/docs/builds/configure-a-build
- https://vercel.com/changelog/websocket-support-is-now-in-public-beta
- https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections
