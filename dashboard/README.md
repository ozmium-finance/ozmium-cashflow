# Ozmium dashboard (Next.js)

Same three pages as the old plain-HTML `dashboard/` folder (Operator,
Investor, Audit trail), rebuilt as a Next.js app so clicking between
them doesn't reload the page and reset the demo's progress. State lives
in a Redux store instead of localStorage -- it survives navigating
between pages because Next.js keeps one JS app running underneath all
three routes. A real browser refresh (F5) still resets it, same as any
other in-memory state would; that's a different problem (page reload,
not page navigation) and wasn't what was breaking before.

## Run it

Needs Node.js 18+ and `dpm sandbox` running separately, same as before:

    dpm sandbox --dar .daml/dist/ozmium-cashflow-0.1.0.dar --json-api-port 7575

Then, in this folder:

    npm install
    npm run dev

Open http://localhost:3000. No separate proxy process to remember to
start -- this app's own API route (`pages/api/v2/[...path].js`) forwards
`/v2/*` calls to the JSON API for you, the way `serve.py` did for the
old dashboard.

If `dpm sandbox` isn't on `localhost:7575`, copy `.env.local.example` to
`.env.local` and adjust `JSON_API_HOST`/`JSON_API_PORT`.

## Why the API route shells out to curl

Same reason `serve.py` did: Canton's JSON API server (pekko-http)
reliably reset the connection against Python's http.client/urllib on
every request, while curl against the identical URL never failed once --
never got a clean root cause, just a decisive fix. This route uses the
same curl-subprocess workaround rather than assuming Node's own
fetch/http client would fare any better against the same server.
Windows 10 (1803+) and 11 ship curl.exe by default, so this should just
work; if the terminal running `npm run dev` prints "Couldn't run curl,"
that's the one thing to check.

## Status

Originally built without npm registry access from where I'm working, so
`npm install`/`next build` couldn't be run before handing it over --
that's since been confirmed working for real (`npm install`, `npm run
dev`, and a production `next build` have all succeeded against a live
`dpm sandbox`). Docker packaging for this *local* two-terminal workflow
was also tried on top of this (see the git history / prior conversation
if you're looking for it) and dropped after hitting a Docker
Desktop/WSL2 networking restriction specific to exposing Canton's
loopback-only JSON API from inside a container -- unrelated to the
dashboard itself, which was never the problem. Two plain terminals
(`dpm sandbox`, then `npm run dev` here) is the supported way to run
this locally, not a fallback.

Separately, this same dashboard image *is* built and run in Docker
successfully as part of the real production deployment on Scaleway --
that's a plain Linux server, not Docker Desktop/WSL2, so the networking
restriction above doesn't apply there. See `../deploy/README.md`.

## What's intentionally different from the old dashboard

- Party selection on the Investor page and the search/status filter on
  the Audit page are also in Redux now, so those survive tab-switching
  too, not just the Operator demo panel.
- No more localStorage anywhere in this app -- the old dashboard's
  `dashboard/index.html` used it as a workaround for full page reloads
  between the three static HTML files; that workaround is gone because
  the underlying problem (full page reload on navigation) is gone.
