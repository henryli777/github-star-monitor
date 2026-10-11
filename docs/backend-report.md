# Backend implementation and verification

Implemented Task 1 in `server.mjs`, `lib/errors.mjs`, `lib/github.mjs`, `lib/store.mjs` and the three backend test files. Runtime dependencies: Node.js standard library only.

## HTTP contract

All routes from `docs/design.md` are implemented. Creation responses use HTTP 201; duplicate monitor or disclosure records use 409; missing records use 404; malformed inputs use 400. Errors follow `{error:{code,message}}`. `/api/refresh` accepts JSON `{}` with `Content-Type: application/json`.

The Repo and Revenue fields follow the design. Additive metadata supports the frontend's source disclosure:

- Repository details include `meta:{source,fetchedAt,stale,warning?}`. They retain `history:[]` and unknown growth for projects without recorded snapshots.
- Stale ranking or detail fallback includes a human-readable `meta.warning`.
- Monitor items include their actual `fetchedAt`; monitor metadata includes persisted `errors:[{repo,code,message}]` from the latest refresh attempt, including after a restart.
- Exported monitor entries also include their saved `history`, so JSON export preserves monitoring data.

Public rankings query the official GitHub REST search endpoint with `stars:>0 fork:false archived:false is:public`, optional validated language/topic/text filters, and a creation-date cutoff for new projects. Results request at most 50 repositories, sort by stars descending, and state their search-result scope. `is:public` and a private-repository guard prevent a configured token from exposing private repositories. The token appears only in the upstream Authorization header.

## Persistence and collection boundaries

`data/state.json` contains monitor repositories, real snapshots, disclosures, and ranking caches. Writes serialize through a queue, write and fsync a temporary file, and atomically rename it over the existing state. In-memory state changes only after replacement succeeds. Failed writes remove temporary files and preserve the previous state; corrupt or structurally invalid existing data refuses startup without overwriting it.

Ranking caches last 15 minutes and retain up to 50 distinct query entries. Upstream rate limits, timeout, and network/API failures can return an existing cached result with its original acquisition time and `stale:true`. Repository detail reuses recent monitoring/ranking data and falls back to older cached data during upstream failures. Adding a monitor performs a fresh request so cached values do not become falsely current snapshots.

The running process attempts monitor refresh every 60 minutes. Manual refresh uses the same collector, and overlapping attempts share the active operation. Batches use at most three concurrent GitHub requests. Failed projects keep their previous repository data, acquisition time and history; successful projects retain each request's actual acquisition time rather than the batch completion time. `lastRefreshAt` denotes the last attempt, while each item's `fetchedAt` denotes its successful data acquisition. Errors persist alongside that attempt.

The collector carries the requested repository and its durable monitor generation through each request. A renamed/transferred repository migrates its monitor and history to the returned canonical name; an existing canonical monitor merges without duplication or regressing newer data. At equal acquisition times, the existing canonical entry and its historical point take priority over an alias response, including a canonical monitor removed and re-added during that batch. Results from a removed/re-added monitor generation are ignored, and older acquisition timestamps cannot overwrite a newer snapshot. Repository details use the canonical returned name for history lookup.

Snapshots retain 90 days. Growth compares the most recent saved sample against a sample at or before the 1/7/30-day target, within two hours of that target; missing coverage is `null`, and negative net changes remain negative. Collection stops when the service stops. Removing a monitor stops collection and retains its existing real history. The maximum monitor count is 30.

Revenue begins empty and accepts only user-supplied, sourced disclosures. Currency and period remain explicit fields. Same repository (case insensitive), currency, period and date duplicates are rejected. Records validate a positive finite numeric amount, supported currency/period, genuine non-future calendar date using the explicit Asia/Shanghai current date, and noncredentialed HTTP(S) source URL. No revenue is inferred from stars.

Only `127.0.0.1` is bound by the executable entry point, with port 4320 by default and a validated `PORT` override. Mutations reject foreign Origin and cross-site fetch metadata; JSON content type and a 16 KiB request limit are enforced. Host checks prevent rebinding to an arbitrary hostname. Static serving is limited to regular files below `public`, rejects traversal, dot paths, and every symlink including intermediate symlinks, and sends CSP/nosniff headers.

## Verification evidence

Initial test run: 22/22 backend tests failed with explicit assertions identifying the absent implementation before production code was written. Additional observed RED cases identified public-only token behavior, nested symlinks, a stale initial monitor snapshot, control characters in disclosure URLs, and invalid persisted record shapes; their fixes passed regression runs.

Backend test command: `node --test test/github.test.mjs test/store.test.mjs test/server.test.mjs` — 37 tests passed. Full project command: `npm test` — 55 tests passed at the time of this report. Tests use actual temporary files and a real loopback HTTP server, injecting only the external GitHub response boundary and the failed filesystem replacement boundary. They cover rate limits/timeouts/cache fallback, malformed search/repository inputs, token secrecy/private repositories, monitor duplicates and cap, first-snapshot/covered/negative/missing growth, failed refresh retention across restart, per-project timestamps, monitor generation/rename races, canonical collision equality, scheduler shutdown, three-request concurrency, Shanghai calendar boundaries, revenue validation/duplicates, concurrent atomic writes/rollback, corrupt startup, static traversal/symlinks, and foreign-Origin writes.

The integration followups were verified with observed RED→GREEN regressions: at `2026-10-10T16:30:00Z`, Shanghai's `2026-10-11` disclosure is accepted and `2026-10-12` rejected; failed refreshes preserve the prior item time and errors after restart; redirects migrate history and collapse an existing canonical monitor; and a blocked batch cannot overwrite a removed/re-added monitor, even when both generations share the same millisecond acquisition timestamp.

Live smoke on 2026-10-11 at `2026-10-11T08:26:51.069Z`: a real local HTTP request to `/api/rankings` fetched the official GitHub API successfully (HTTP 200), returned 50 items, and reported totalCount 27,745,349. Representative official values at acquisition were `sindresorhus/awesome` 517,386 stars, `openclaw/openclaw` 391,663 stars, and `vinta/awesome-python` 326,478 stars. Immediate repeated rankings and top-project detail used cache; detail history was empty and all growth periods were null. The smoke used a temporary data directory, which was removed, and did not seed production monitor or income data.

No external resources were created, and no Git operations were performed by this backend worker.
