# CorosLink relay protocol, version 1

The relay at `relay.coroslink.com` handles **setup only**: it links desktops to website accounts, gives each desktop a Cloudflare Tunnel, brokers one-time credentials for phones, and sends push alerts. Coach traffic goes from the phone to the desktop directly (LAN) or through the desktop's tunnel. It never passes through the relay. The relay never sees a desktop session token, and its tokens are never accepted as a desktop login.

`src/protocol.ts` is the source of truth for every constant, claim and body named here. It has no imports, so desktop code and test fixtures can import it directly.

## Who talks to whom

| Caller | Proves itself with | Endpoints |
| --- | --- | --- |
| Desktop (CorosLink, "environment") | Environment signature, plus a website relay token when linking | link, recovery, unlink, activity |
| Phone (C-LINK) | Website relay token and a DPoP proof | list, connect, devices, unlink |
| Relay → desktop | Relay mint request, signed with `RELAY_SIGNING_KEY` | `POST https://<hostname>/v1/relay/mint` |

## Credentials

### Website relay token (P4)

An ES256 JWT that `watchfaces.coroslink.com` issues at `POST /api/v1/app/relay-token`. It is sent as `Authorization: Bearer <jwt>`.

- **Header:** `alg: "ES256"` and a `kid` that is published at `https://watchfaces.coroslink.com/.well-known/relay-jwks.json`.
- **Claims:**
  - `iss` = `https://watchfaces.coroslink.com`
  - `aud` = `relay.coroslink.com`
  - `sub` = the website user id
  - `client_id` = `c-link-ios` or `coroslink-desktop`
  - `sid` = the app session id
  - `iat`, and `exp` no more than 600 s after `iat`
  - `jti`
- **What the relay checks:** the signature, against the JWKS. It caches the keys for 10 minutes and refetches at most once per 30 s when it sees an unknown `kid`. It also checks `iss`, `aud`, `exp` (with 30 s of skew), the lifetime, and that `client_id` is allowed for the endpoint. `sub`, `sid` and `jti` must be present.
- **Revocation:** the relay cannot see a website session being revoked. The 10-minute lifetime is the bound, so the website must stop minting tokens for a revoked session.

### Environment key and signature (P2/P6)

Every desktop has a P-256 key, created once and stored with `safeStorage`, and an `environmentId` (8 to 64 characters from `[A-Za-z0-9_-]`). Its `kid` is the RFC 7638 SHA-256 thumbprint of the public JWK `{crv, kty, x, y}`.

Every desktop call carries a compact JWS in the `CorosLink-Environment-Signature` header:

```
protected header: { "alg": "ES256", "typ": "coroslink-env-request+jws", "kid": <thumbprint> }
payload: {
  "aud": "https://relay.coroslink.com",      // RELAY_ORIGIN of the relay being called
  "environmentId": "<same as the body>",
  "op": "environment.link" | "environment.recovery" | "environment.unlink" | "environment.activity",
  "nonce": "<≥16 random bytes, base64url, fresh per call>",
  "iat": <unix seconds>,
  "bodySha256": "<base64url(SHA-256(the exact request body bytes))>"
}
```

- Sign the exact bytes you send as the body, and send them unchanged.
- The relay refuses the call in any of these cases:
  - `iat` is more than 60 s from its clock. The error is `signature_stale`, and `error.details.serverTime` gives the relay's time.
  - The `nonce` was already used for this environment (`signature_replayed`).
  - `aud`, `op` or `environmentId` don't match the call.
  - The body hash differs.
- **Why a nonce instead of `GET /v1/nonce`:** the desktop picks the nonce and the relay keeps it for three minutes, longer than the ±60 s window, so a captured request can't be replayed. This costs no extra round trip, which matters for activity pushes.
- **Key lookup:**
  - At link time the public key comes from the body, and `kid` must be its thumbprint.
  - On later calls the relay looks up the active link for `(environmentId, kid)`. If there is none, the answer is 404 `environment_not_linked`, and the desktop should treat itself as unlinked.

### DPoP proof (P3/P7)

On connect, the phone sends an RFC 9449 proof in the `DPoP` header. It is signed by its Secure Enclave key.

- **Header:** `typ: "dpop+jwt"`, `alg: "ES256"`, and `jwk` = the public P-256 key.
- **Claims:**
  - `htm` = `"POST"`
  - `htu` = `https://relay.coroslink.com/v1/environments/<environmentId>/connect` (no query)
  - `iat` within ±60 s
  - `jti`: 16 to 128 characters, never reused
  - `ath` = base64url(SHA-256(the website relay token))

The relay binds the credential to `jkt`, the SHA-256 thumbprint of that `jwk`. The phone must use the same key for the desktop's `POST /v1/auth/bootstrap`.

### Relay signing key and the mint exchange (P2)

The relay publishes its public keys at `GET /.well-known/jwks.json` (`{keys: [{kty, crv, x, y, kid, alg: "ES256", use: "sig"}]}`).

- **Desktops pin these keys.** Fetch and cache them at link time, and refresh on an unknown `kid`. During a rotation the relay publishes the next key alongside the current one.
- **Trust assumption:** whoever holds `RELAY_SIGNING_KEY` can ask any linked desktop for credentials on behalf of its linked user. DPoP binds each credential to a phone key, so a stolen credential can't be redeemed without that key. It does not make a compromised relay key harmless.

For `POST /v1/environments/:id/connect`, the relay calls `POST https://<hostname>/v1/relay/mint` with `{"request": "<jwt>"}`. It does not follow redirects and gives up after 10 s.

The request JWT:

```
header: { "alg": "ES256", "typ": "coroslink-relay-mint+jwt", "kid": <relay kid> }
claims: {
  "iss": "https://relay.coroslink.com",
  "aud": "coroslink-env:<environmentId>",
  "environmentId": "<environmentId>",
  "userId": "<website user id of the phone>",
  "jkt": "<phone DPoP key thumbprint>",
  "nonce": "<random>",
  "iat": <now>, "exp": <now + 120>
}
```

**The desktop must:**
1. Verify the signature against the pinned relay JWKS.
2. Check `typ`, `iss` and `aud`; check that `exp` hasn't passed and is no more than 120 s after `iat`; check that `environmentId` is its own and `userId` is the linked user.
3. Refuse a `nonce` it has seen.
4. Mint a one-time credential bound to `jkt`, lasting at most 10 minutes.
5. Answer `200`:

```
{ "credential": "<opaque>", "expiresAt": "<ISO 8601>", "proof": "<JWS>" }

proof header:  { "alg": "ES256", "typ": "coroslink-env-mint+jws", "kid": <environment thumbprint> }
proof payload: {
  "environmentId": "<environmentId>",
  "nonce": "<the request nonce>",
  "jkt": "<the request jkt>",
  "credentialSha256": "<base64url(SHA-256(UTF-8 credential))>",
  "exp": <floor(expiresAt / 1000)>,
  "iat": <now>
}
```

The relay checks the proof against the environment key it stored at link time, then checks every bound field and that `iat` is within ±60 s. Only then does it return the credential to the phone. If anything fails it answers 502 `environment_response_invalid`. That stops another process behind the tunnel from posing as the desktop. The credential is never logged or stored.

## Tunnels

- **Hostnames:** each user/environment pair gets one hostname for life: `<16 hex>.<TUNNEL_ZONE_NAME>`. It is first-level, so the zone's free certificate covers it, and it is derived from a hash that reveals neither id. The tunnel is named `clink-<same 16 hex>` (`clink-<stage>-…` outside production).
- **Ingress:** `[{hostname, service: "http://localhost:<port>"}, {service: "http_status:404"}]`. cloudflared sends the original `Host`, so the desktop server must accept the tunnel hostname. It should listen on `127.0.0.1`; cloudflared tries every address `localhost` resolves to.
- **Generations:** every write to an allocation bumps its `generation`, and only lands if the generation is still the one the writer read. Link and recovery checkpoint each Cloudflare step (tunnel id, ingress, DNS record), so a retry resumes where it stopped. Unlink and cleanup claim the generation before deleting anything. If a concurrent writer wins, the loser answers `allocation_conflict` (retry) or `allocation_busy` (retry after `Retry-After`).

## Endpoints

Every response is JSON. Every non-2xx body is `{ "error": { "code", "message", "details"? } }`. Codes are listed in `ERROR_CODES` in `src/protocol.ts`. 429 and 503 answers carry `Retry-After`.

| Endpoint | Auth | Body → response |
| --- | --- | --- |
| `POST /v1/environments/link` | Bearer (`coroslink-desktop`) + env signature, `op` link | `LinkRequest {environmentId, publicJwk, label, platform, port}` → `LinkResponse {environmentId, userId, hostname, httpBaseUrl, tunnelId, connectorToken, generation}` |
| `POST /v1/environments/recovery` | env signature, `op` recovery | `RecoveryRequest {environmentId, tunnelId \| null, port}` → `RecoveryResponse {…, action, connectorToken?}` |
| `POST /v1/environments/unlink` | Bearer (any client) **or** env signature, `op` unlink | `{environmentId}` → `{environmentId, unlinked: true, teardown: "complete" \| "pending"}` |
| `GET /v1/environments` | Bearer (any client) | → `{environments: EnvironmentSummary[]}` |
| `POST /v1/environments/:environmentId/connect` | Bearer (`c-link-ios`) + `DPoP` | empty → `ConnectResponse {environmentId, hostname, httpBaseUrl, credential, expiresAt}` |
| `POST /v1/devices` | Bearer (`c-link-ios`) | `{token: <APNs hex>, environment: "sandbox" \| "production"}` → `{registered: true}` |
| `DELETE /v1/devices` | Bearer (any client) | `{token}` → `{unregistered: true}` |
| `POST /v1/activity` | env signature, `op` activity | `{environmentId, sessionId, event: "replied" \| "approval"}` → `{sent, failed, removed}` |
| `GET /.well-known/jwks.json` | none | → `{keys}` |
| `GET /health` | none | → `{service, stage, protocol, tunnels, push, cleanupMode}` |

### Link

- **Who calls it:** the desktop, after website sign-in.
- **What happens:**
  1. The relay records the link: the key, a label (1 to 64 characters, shown on the phone) and the platform (`darwin`, `win32` or `linux`).
  2. It creates or adopts the tunnel, sets the ingress to `port`, and creates or updates the proxied CNAME to `<tunnelId>.cfargotunnel.com`.
  3. It returns the connector token.
- **Idempotent:** link again whenever the port or label changes, or to recover a lost connector token.
- **Changing accounts:** if this desktop key is linked under another account, that account's link is revoked and its tunnel torn down.
- **Limit:** an account can link `MAX_LINKED_ENVIRONMENTS_PER_USER` (10) computers. Past that the answer is 409 `link_limit_reached`.
- **The connector token is a secret.** Store it with `safeStorage` and run `cloudflared tunnel --no-autoupdate run` with `TUNNEL_TOKEN` in the environment.

### Recovery

- **When the desktop calls it:**
  - at **every startup**, which is what registers recovery;
  - right after linking;
  - whenever cloudflared exits or reports repeated tunnel rejections.
- **What it does:**
  - registers recovery (cleanup only ever deletes tunnels of hosts that did this);
  - updates the ingress if the port changed;
  - re-provisions the tunnel under the same allocation and hostname if Cloudflare no longer has it. The DNS record is repointed, so phones keep the same address.
- **Response:**
  - `action` is `unchanged`, `reconfigured` or `reprovisioned`.
  - `connectorToken` is present whenever `tunnelId` in the request is not the current tunnel. Restart cloudflared with it.
- **Limits:**
  - At most once per 120 s per environment; otherwise 429 with `Retry-After`. Inside that window, start the stored connector anyway.
  - 503 `allocation_busy` means cleanup holds the tunnel. Retry after `Retry-After`; it doesn't use up the 120 s.

### Unlink

- **Who can call it:** the phone (user token), the desktop's own settings (env signature), or the desktop with a user token.
- **Order:**
  1. The relay commits the revocation first, so the link is dead even if teardown fails.
  2. It claims the allocation's generation.
  3. It deletes the DNS record, then the tunnel's connections, then the tunnel. The hostname stays reserved for a later relink.
- **Failed teardown:** `teardown: "pending"` means teardown failed part way. The 5-minute cron retries it.
- **Afterwards:** a desktop's later signed calls get 404 `environment_not_linked`. It should stop cloudflared and drop the connector token.

### List

`status` is one of:
- `online`: Cloudflare reports the tunnel `healthy` or `degraded`.
- `offline`: the tunnel is `down` or `inactive`, or it was released, with `offlineReason` `tunnel_released` or `busy`.
- `provisioning`
- `unknown`: Cloudflare couldn't be reached.

Cloudflare's status is cached for 30 s.

### Connect

The relay checks that the link and allocation are active, signs the mint request and verifies the desktop's proof. It answers with:
- 404 `environment_not_linked`;
- 409 `environment_not_ready`;
- 502 `environment_unreachable` (asleep or offline), `environment_redirect_refused`, `environment_refused` (the desktop answered 4xx) or `environment_response_invalid`.

The phone then calls `POST https://<hostname>/v1/auth/bootstrap` with a DPoP proof made with the same key and `{credential}`.

### Activity push

The relay sends APNs alerts to every device the linked user registered:
- **Topic and headers:** topic `APNS_BUNDLE_ID`, `apns-push-type: alert`, priority 10, and a one-hour expiry.
- **Payload** (no message text ever leaves the desktop):

```
{
  "aps": { "alert": { "title": "Coach", "body": "Coach replied" | "Coach needs your approval" },
           "sound": "default", "thread-id": "coach:<sessionId>" },
  "kind": "coach", "sessionId": "<sessionId>", "environmentId": "<environmentId>", "event": "replied" | "approval"
}
```

- **Dead tokens:** a token APNs reports as `410`/`Unregistered`, `BadDeviceToken` or `DeviceTokenNotForTopic` is deleted.
- **Device limit:** an account keeps its 20 most recently registered devices.

## Cleanup (cron, every 5 minutes)

- **Replay guards:** expired nonces are purged.
- **Unlinks:** failed unlink teardowns are retried, up to 10 per run.
- **Idle tunnels:** when `RELAY_TUNNEL_CLEANUP_MODE` is `dry-run` or `enabled`, idle tunnels are reaped.
  - **Candidates:**
    - same-stage tunnels Cloudflare reports `down` for at least 5 minutes;
    - tunnels that never connected (`inactive`) and are at least an hour old.
  - **Deleted only if:**
    - the allocation registered recovery;
    - it still records that tunnel id;
    - it is `ready` or `provisioning`.
  - **Skipped and counted:**
    - orphans, which have no allocation (`skippedOrphan`; clear these by hand);
    - replaced tunnels (`skippedReplaced`);
    - unrecorded tunnels (`skippedUnrecorded`);
    - hosts without recovery (`skippedNoRecovery`);
    - busy allocations (`skippedBusy`).
  - **Claiming:** each delete claims the allocation's generation and rechecks the tunnel first. A host that reconnects mid-sweep keeps its tunnel, and a recovery that arrives while the claim is held gets `allocation_busy`.
  - **Bounds per sweep:** 10 list requests, 100 deletions and a 110 s deadline. A Cloudflare 429 stops the sweep. Each sweep starts one budget further along the candidate list.
  - **After a reap:** the DNS record stays. The desktop's next recovery re-provisions the tunnel behind the same hostname.
