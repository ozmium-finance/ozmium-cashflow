# Deploying Ozmium Cashflow to Scaleway

This covers the real, live deployment — a Scaleway Cloud instance
running the whole stack in Docker, behind HTTPS, kept up to date by a
GitHub Actions pipeline. Local development is unaffected by any of
this — see the root `README.md` and `dashboard/README.md` for the plain
two-terminal `dpm sandbox` + `npm run dev` workflow.

## Architecture

```
GitHub push to main
  │
  ├─ test.yml        (every PR)  → dpm build/test, dashboard npm build
  │
  └─ deploy.yml       (every push to main)
       ├─ build-and-push          builds canton + dashboard images,
       │                          pushes to Scaleway Container Registry
       └─ deploy   (needs manual approval — see One-time setup below)
            ├─ stop the old canton container
            ├─ wipe and recreate canton's 3 Postgres databases
            └─ docker compose pull && up -d

Scaleway Instance (single Linux box, /opt/ozmium-cashflow)
  ├─ caddy       — binds :80/:443, gets a Let's Encrypt cert automatically,
  │                reverse-proxies to dashboard:3000
  ├─ dashboard   — Next.js app, talks to canton:7575 over Compose's
  │                internal network (not published to the host directly)
  └─ canton      — participant "sandbox" + sequencer "sequencer1" +
                   mediator "mediator1", each with its own Postgres
                   database on a separate Scaleway Managed Database
```

The live site is at `https://163-172-155-168.sslip.io` — a free
hostname that just resolves to the instance's own IP, which is all
Let's Encrypt needs (see the comment in `Caddyfile`).

## Required GitHub configuration

**Secrets** (Settings → Secrets and variables → Actions → Secrets):
- `SCW_SECRET_KEY` — Scaleway Secret Key, used to log in to Container Registry
- `SCW_SSH_PRIVATE_KEY` — private half of the deploy SSH keypair; the
  public half needs to be registered under the Scaleway account's own
  (per-user, not per-Organization) SSH Keys settings
- `SCW_DB_PASSWORD` — the managed Postgres instance's password

**Variables** (same location, Variables tab):
- `SCW_REGISTRY` — e.g. `rg.fr-par.scw.cloud/ozmium-cashflow`
- `SCW_INSTANCE_IP` — the instance's public IP
- `CADDY_DOMAIN` — the sslip.io hostname Caddy requests a cert for
- `SCW_DB_HOST`, `SCW_DB_PORT`, `SCW_DB_NAME`, `SCW_DB_USER` — managed
  Postgres connection details. `SCW_DB_NAME` is the *base* name (e.g.
  `rdb`); the three per-node databases are derived from it as
  `<name>_participant1`, `<name>_sequencer1`, `<name>_mediator1`.

**One-time setup:**
1. Repo Settings → Environments → new environment named exactly
   `production`, with yourself (or whoever approves deploys) as a
   required reviewer. This is what makes the `deploy` job pause for
   approval instead of running unattended.
2. The three per-node Postgres databases need to exist before the very
   first deploy (after that, the deploy pipeline itself keeps them wiped
   and recreated on every run — see below). Easiest way: a throwaway
   `docker run --rm -it postgres:16 psql ...` session against the
   managed database, running `CREATE DATABASE <name>_participant1;`
   etc. three times.
3. Port 443 needs to be reachable — check the instance's Security Group
   (Scaleway console → Instance → Security tab). If no explicit inbound
   rules are defined, the default policy accepts everything and there's
   nothing to do.

## Non-obvious things that had to be fixed here

Deploying Canton under Docker with real persistent storage surfaced a
few issues that aren't documented anywhere obvious. Recording them here
so they don't get re-discovered the hard way:

- **Each Canton node needs its own actual database, not just its own
  schema.** Canton's own config validation rejects the participant,
  sequencer, and mediator sharing one Postgres database differentiated
  only by `schema` — `CONFIG_VALIDATION_ERROR: Nodes ... share same DB
  access`. Digital Asset's own example configs use separate databases
  too; `canton-production.conf` derives three from one `POSTGRES_DB` via
  Compose's `${VAR}suffix` interpolation rather than needing three
  separate GitHub variables.

- **`ssl = true` alone isn't enough for the Postgres JDBC driver.**
  Setting bare `ssl = true` in `PGSimpleDataSource` properties defaults
  to full certificate-chain verification, which looks for a root CA
  file at `/root/.postgresql/root.crt` — a file that doesn't exist in
  the container. Fix is `sslmode = "require"` alongside it, which still
  encrypts the connection but doesn't require verifying against a root
  cert.

- **`dpm sandbox`'s built-in bootstrap isn't restart-safe.** It always
  tries to create the embedded synchronizer and register the
  participant's trust certificate on every startup, unconditionally.
  Against in-memory storage that's harmless (every start is a blank
  slate); against persistent Postgres storage, every restart after the
  first replays the same registration against state that already has
  it, and Canton refuses with `TOPOLOGY_MAPPING_ALREADY_EXISTS` — which
  crashes the whole node, which Docker then restarts, which crashes
  again, forever. Also, the `sandbox` command explicitly refuses
  `--bootstrap` ("bootstrap script cannot be defined together with the
  'sandbox' command"), so there's no way to swap in a fixed version of
  it while still using that command.

  The fix (`canton-entrypoint.sh`, `canton-bootstrap.canton`,
  `canton-defaults/sandbox-defaults.conf`): run Canton's lower-level
  `daemon` command directly instead of `dpm sandbox`, using dpm
  sandbox's own default topology config (extracted from the
  canton-open-source jar at image build time, since `daemon` doesn't
  auto-merge it the way `sandbox` does) plus a copy of its bootstrap
  script with the synchronizer-registration step wrapped in a
  try/catch, so an "already exists" failure is logged and skipped
  instead of taking the node down. DAR upload moved to Canton's
  declarative-state config API (`alpha-dynamic.dars`), which is
  idempotent by design, instead of `--dar` or scripting the upload
  ourselves.

  This was validated directly against a real already-bootstrapped
  deployment (stopped the production container, ran the fixed bootstrap
  against the same live databases in a throwaway container) before ever
  going into the actual Dockerfile — see chat history for the full
  trace if the exact Canton console API used here ever needs revisiting
  for a newer Canton version.

- **The demo resets on every deploy, on purpose.** The dashboard's own
  design is click-through-from-scratch (its "1. Setup" → "9. Mark third
  payment paid" demo controls), so `deploy.yml` deliberately wipes and
  recreates the three databases on every deploy rather than letting old
  demo data persist across pushes. This is separate from the
  restart-safety fix above: that fix protects against *unplanned*
  restarts (a crash, an OOM-kill, a host reboot) *between* deploys, so
  those don't wipe or crash the demo mid-session — only an actual
  deploy resets it. If persistence across deploys is ever wanted
  instead, remove the "Reset canton's databases" step from `deploy.yml`.

- **Disk fills up over repeated deploys.** Every deploy pushes a
  brand-new SHA-tagged image, and the per-deploy database reset also
  pulls a fresh `postgres:16` image each time. `deploy.yml` runs
  `docker image prune -af` after every successful deploy to keep this
  from accumulating — if the instance's disk ever needs a bigger volume
  regardless, that's done via Instance Settings → Storage in the
  Scaleway console (requires a power-off first; the filesystem
  auto-grows on next boot, no manual `growpart`/`resize2fs` needed).

- **HTTP alone gets rewritten by some networks.** Plain `http://` to the
  instance worked fine from most networks but showed an endless
  redirect loop from at least one (confirmed via `curl` from both the
  server and the client machine returning clean single responses — the
  rewriting was happening in the network path, not in this app).
  Caddy + HTTPS (via the free `sslip.io` hostname) fixes this since
  encrypted traffic can't be rewritten that way, which is the real
  reason this deployment runs on HTTPS rather than just being cosmetic.
