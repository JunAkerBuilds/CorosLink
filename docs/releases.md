# Releases: CorosLink, the C-LINK beta, and C-LINK

C-LINK desktop ships from the CorosLink repo (`JunAkerBuilds/CorosLink`) with CorosLink's app id (`app.coroslink`)
and signing team, so an update moves a CorosLink install to C-LINK in place. Two tracks share the feed while C-LINK
is in beta:

| Track | Tags | GitHub | Update file | Who takes it |
|---|---|---|---|---|
| CorosLink (legacy) | `v0.1.84`, `v0.1.85`… (CorosLink's `main`) | release | `latest-mac.yml` (+ Windows, Linux) | every CorosLink that didn't opt in |
| C-LINK beta | `v0.2.0-clink.1`, `-clink.2`… (this branch) | **prerelease** | `clink-mac.yml` | CorosLink 0.1.84+ that opted in, and C-LINK betas |
| C-LINK | `v0.2.0`… | release | `latest-mac.yml` | everyone on a Mac (CorosLink and C-LINK betas) |

How electron-updater (6.8, GitHub provider) routes them:
- **CorosLink, not opted in**: `allowPrerelease` off, so it reads `/releases/latest`, which is never a prerelease.
  It keeps getting CorosLink releases, then the stable C-LINK.
- **CorosLink, opted in** (0.1.84's pop-up, macOS only): `channel = "clink"`, `allowPrerelease` on, `allowDowngrade`
  off. A custom channel only matches tags whose prerelease id is `clink` and reads `clink-mac.yml`, so it takes the
  newest C-LINK beta and never a legacy CorosLink release.
- **C-LINK beta** (`0.2.0-clink.N`): `desktop/main/updates.ts` asks the stable track first (a stable C-LINK wins),
  then its own `clink` channel (the next beta).
- **C-LINK stable**: only the stable track.

Rules:
- Every C-LINK beta tag is `vX.Y.Z-clink.N` (`scripts/release-version.mjs` refuses other suffixes) and is published
  as a **prerelease**. A beta published as a normal release would go to everyone.
- Keep C-LINK betas above every CorosLink release (0.2.0-clink.N > 0.1.x), and the first stable C-LINK above the last
  beta's base version.
- Windows and Linux: C-LINK isn't built for them yet; CorosLink there never opts in and keeps CorosLink releases.
  When C-LINK ships there, its release must include `latest.yml` / `latest-linux.yml`.
- Going back from the beta isn't automatic: download CorosLink's last DMG. The move only copies, so CorosLink's data
  is still there.
