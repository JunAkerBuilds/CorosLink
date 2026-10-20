# CorosLink relay

A Cloudflare Worker at `relay.coroslink.com` that sets up the remote Coach. The phone (C-LINK) talks to the desktop (CorosLink) directly on the LAN, or through a Cloudflare Tunnel that belongs to that desktop. The relay never carries chat traffic and never sees a desktop session token. It handles only the setup:

- **Linking:** connects a desktop to a website account (watchfaces.coroslink.com).
- **Tunnels:** gives each linked desktop a Cloudflare Tunnel and a DNS name, re-provisions it when it disappears, and deletes idle ones.
- **Credentials:** asks a desktop to mint a one-time credential for a phone, bound to the phone's DPoP key, and verifies the desktop's signed answer.
- **Push:** sends text-free APNs alerts ("Coach replied", "Coach needs your approval") and keeps C-LINK's Coach Live Activity current (phase and word count only).

The wire contract, including what the website, the desktop and the phone must implement, is in [PROTOCOL.md](PROTOCOL.md), with the types in [`src/protocol.ts`](src/protocol.ts). The design follows T3 Code's T3 Connect relay (MIT), reimplemented without Effect and Alchemy.

## Layout

| Path | What it is |
| --- | --- |
| `src/index.ts` | Worker entry: router, error mapping, the 5-minute cron |
| `src/protocol.ts` | Wire contract shared with the desktop and the phone |
| `src/routes.ts` | Endpoint handlers |
| `src/allocations.ts` | Tunnel provisioning, recovery and teardown with generation checkpoints |
| `src/connect.ts` | The mint exchange with a desktop |
| `src/reaper.ts` | Idle tunnel cleanup |
| `src/apns.ts` | APNs provider token (WebCrypto) and delivery |
| `src/auth/` | Website JWTs, environment signatures, DPoP, replay guard |
| `src/cloudflare.ts` | The Tunnel and DNS API calls the relay makes |
| `migrations/` | D1 schema |
| `test/` | Workers-runtime tests with a fake Cloudflare API, APNs and desktop |

## Develop and test

```bash
cd relay
npm install
npm test            # vitest in the Workers runtime (@cloudflare/vitest-plugin)
npm run typecheck   # tsc --noEmit
npm run build       # wrangler deploy --dry-run into dist/
```

The tests mock every external call through an injected `fetch`, so they need no Cloudflare account. `npm run check` runs all three.

## Configuration

Vars live in `wrangler.jsonc`, with one block per stage. Secrets are set with `wrangler secret put <NAME> [--env dev]` and are never committed.

| Name | Kind | Value |
| --- | --- | --- |
| `RELAY_STAGE` | var | `production` or `dev` (lowercase letters and digits). Both stages share one account and tunnel zone, so the stage is built into every name: production uses `<16 hex>.coroslinkrelay.com` and tunnel `clink-<16 hex>`; dev uses `dev-<16 hex>.coroslinkrelay.com` and tunnel `clink-dev-<16 hex>`. Each stage only ever deletes tunnels and records named like its own. |
| `RELAY_ORIGIN` | var | `https://relay.coroslink.com` (dev: `https://relay-dev.coroslink.com`). The `aud` of environment signatures, the `iss` of mint requests, and the origin in DPoP `htu`. |
| `WEBSITE_ISSUER` | var | `https://watchfaces.coroslink.com` |
| `WEBSITE_JWKS_URL` | var | `https://watchfaces.coroslink.com/.well-known/relay-jwks.json` |
| `WEBSITE_JWT_AUDIENCE` | var | `relay.coroslink.com`. This is what the website puts in `aud`. |
| `CF_ACCOUNT_ID` | var | The Cloudflare account that holds `coroslink.com` and the tunnels |
| `TUNNEL_ZONE_ID` | var | The `coroslinkrelay.com` zone's ID (its Overview page → API) |
| `TUNNEL_ZONE_NAME` | var | `coroslinkrelay.com`. It is used only for per-computer tunnel addresses, always one label under the zone, which is all the phone accepts. |
| `CF_API_TOKEN` | secret | An API token with **Account · Cloudflare Tunnel · Edit** and **Zone · DNS · Edit** on the tunnel zone only |
| `RELAY_SIGNING_KEY` | secret | ES256 private key, PKCS8 PEM. Signs mint requests; desktops pin its public key. |
| `RELAY_SIGNING_KEY_ID` | var | Its `kid`, e.g. `relay-2026-10`. Change it whenever the key changes. |
| `RELAY_EXTRA_JWKS` | var, optional | JSON array of extra public JWKs to publish during a key rotation |
| `APNS_KEY_ID` | var | The APNs auth key id (10 characters) for production device tokens |
| `APNS_TEAM_ID` | var | Apple team id |
| `APNS_BUNDLE_ID` | var | `com.akerrules.clink`. The APNs topic. |
| `APNS_PRIVATE_KEY` | secret | That key's `.p8` (PKCS8 PEM) |
| `APNS_SANDBOX_KEY_ID` | var, optional | A separate key for sandbox device tokens (Xcode builds). Without it, sandbox pushes use `APNS_KEY_ID`, which must then be a Sandbox & Production key. |
| `APNS_SANDBOX_PRIVATE_KEY` | secret, optional | That key's `.p8` |
| `RELAY_TUNNEL_CLEANUP_MODE` | var | `off` (default), `dry-run` or `enabled`. It is read at deploy time, so changing it means a deploy. |

Binding: `DB` is the D1 database `coroslink-relay` (dev: `coroslink-relay-dev`).

Missing configuration fails only the endpoints that need it:
- without the tunnel vars or token, link, recovery and connect answer 503 `not_configured`;
- without the APNs vars, activity and live activity answer 503;
- `GET /health` reports what is configured.

## Before the first deploy

Only the tunnel zone exists so far. The rest still needs creating in the Cloudflare account:

1. **Tunnel domain (done).** `coroslinkrelay.com` is a full-setup zone on the free plan, in the same account as `coroslink.com`. It has no DNS records; the relay creates one proxied CNAME per linked computer. Put the account ID and this zone's ID into `wrangler.jsonc` for both stages; they're left blank in the repo.
   - Keeping it separate from `coroslink.com` means the tunnel token's DNS · Edit can't touch the main site.
   - The free Universal SSL certificate covers `*.coroslinkrelay.com`, which is why hostnames are first-level. Check the zone is **Active** before linking a desktop.
2. **API token.** Create it with Account · Cloudflare Tunnel · Edit (this account) and Zone · DNS · Edit on `coroslinkrelay.com` only. One token serves both stages.
   ```bash
   npx wrangler secret put CF_API_TOKEN --env=""
   ```
   ```bash
   npx wrangler secret put CF_API_TOKEN --env dev
   ```
3. **D1 databases.** Create both, then put each printed id into `wrangler.jsonc`, replacing the `00000000-…` placeholders. Then apply the migrations:
   ```bash
   npx wrangler d1 create coroslink-relay
   ```
   ```bash
   npx wrangler d1 create coroslink-relay-dev
   ```
   ```bash
   npm run db:migrate:dev
   ```
   ```bash
   npm run db:migrate
   ```
4. **Relay signing keys.** Use one key per stage. Generate a key, then store it:
   ```bash
   openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out relay-dev-signing-key.pem
   ```
   ```bash
   npx wrangler secret put RELAY_SIGNING_KEY --env dev < relay-dev-signing-key.pem
   ```
   Repeat for production with `--env=""` and a new file. Keep the PEM files out of the repo.
5. **APNs.** The team allows only two team-scoped Sandbox & Production keys, and both are taken (the website's and Expo's), so the relay has topic-specific keys for `com.akerrules.clink`, one per environment. Set `APNS_KEY_ID` (production) and `APNS_SANDBOX_KEY_ID`, then `wrangler secret put APNS_PRIVATE_KEY` and `APNS_SANDBOX_PRIVATE_KEY` with each `.p8`. A device's registration says which environment, and so which host and key, its pushes use. `GET /health` reports `pushSandbox` and `pushProduction`.
6. **Custom domains.** `relay.coroslink.com` and `relay-dev.coroslink.com` are declared as `custom_domain` routes on the `coroslink.com` zone. The first deploy creates them.
7. **Website.** `watchfaces.coroslink.com` must serve `/.well-known/relay-jwks.json` and issue relay tokens (CorosLink-web, P4).

## Deploy

Apply any new migration (such as `0002_live_activities.sql`) to a stage before deploying code that uses it: `npm run db:migrate:dev`, then `npm run db:migrate`.

Deploy `relay-dev` first and link a real desktop to it:

```bash
npm run check
```
```bash
npm run deploy:dev
```

Then confirm, on `relay-dev.coroslink.com`:
- `GET /health` reports `tunnels: true` and `push: true`;
- a linked desktop's tunnel shows **Healthy** under Zero Trust → Networks → Tunnels;
- `scripts/remote-client.mjs` connects through the hostname;
- the dev stage runs cleanup in `dry-run`, and `wrangler tail --env dev` shows the expected candidates in the `maintenance` log line.

Then production:

```bash
npm run deploy
```

Deploys are by hand at first. A GitHub Action can run `npm run check` and `wrangler deploy` later.

## Operating it

- **Cost:** Cloudflare includes 1,000 tunnels per account, then charges $4.50 per tunnel per month, and idle tunnels count. Cleanup keeps that in check.
  - It starts `off`. Move a stage to `dry-run`, watch the `maintenance` log (`wouldDelete`, `skipped*`, `candidates`), then switch to `enabled`.
  - Accounts are capped at 10 linked computers.
- **Orphans:** a tunnel named like the relay's but with no allocation row is never deleted automatically (`skippedOrphan`). Delete it by hand after checking.
- **Hosts that never registered recovery:** their tunnels are never reaped (`skippedNoRecovery`). The desktop is expected to call recovery at startup and right after linking. A host that links but never runs recovery can therefore hold up to 10 tunnels per account indefinitely; watch `skippedNoRecovery` in the `maintenance` log.
- **Unlinked leftovers:** a tunnel left behind by an unlink that raced a link is deleted once it shows up idle (`unlinked` in the log).
- **Logs:** structured JSON lines carrying ids and counters only. Tokens, connector tokens and credentials are never logged.
- **Rotating the relay key:**
  1. Publish the next public key in `RELAY_EXTRA_JWKS` and deploy.
  2. Wait until desktops have refreshed their pinned keys.
  3. Swap `RELAY_SIGNING_KEY` and `RELAY_SIGNING_KEY_ID`.
  4. Drop the old key from the list.
