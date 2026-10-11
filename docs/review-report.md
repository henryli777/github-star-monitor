# Independent source review

Reviewed on 2026-10-11 against `docs/design.md` and `docs/implementation-plan.md`. Scope: all `public/*`, `lib/*`, `server.mjs`, and `test/*.mjs` source in this new repository. There is no committed baseline, so this is a whole-source review. No application source or production data was changed by the reviewer.

The findings below preserve the original reproductions. Their original source locations moved during repairs. A scoped follow-up review of the repairs is recorded at the end of this report.

## Findings

### P2 — A pending detail response overwrites a subsequently opened form

**Location:** `public/app.mjs:185`, `public/app.mjs:222`.

`detailRequest` changes when another detail request starts, but opening an add/revenue/delete dialog does not invalidate the previous detail request. The response guard accepts any open modal.

**Reproduction:** Begin a delayed repository detail request, close its modal, and open the Add Monitor form. Resolve the old detail request. An isolated execution of the real `app.mjs` with a minimal DOM printed `add form retained=false` and `old detail visible=true` after the response; the form had been present before it.

**Impact:** A response for a closed detail view replaces the user's current form and loses their entered values. Invalidate outstanding detail requests whenever modal ownership changes, including close and native cancel, and require the request to belong to the current modal.

### P2 — Completion of an old mutation closes a different current dialog

**Location:** `public/app.mjs:190`; the same pattern occurs at `public/app.mjs:201` and `public/app.mjs:208`.

The monitor creation, revenue creation, and deletion handlers unconditionally close the shared modal after their API request succeeds. The user can close the original dialog and open another while the request is pending.

**Reproduction:** Submit Add Monitor with the POST response delayed; close that modal and open Revenue. Complete the original POST. Isolated real-source execution confirmed the revenue form was open before completion and `modal.open=false` afterward.

**Impact:** Successful background completion can dismiss an unrelated form, discarding its current entry. Guard dialog close/render side effects with the modal generation that initiated the mutation; still refresh workspace data when the old mutation completes.

### P2 — Repository renames and transfers silently stop monitor updates

**Location:** `server.mjs:98`, `lib/store.mjs:161`.

Refresh retains only the repository returned by GitHub and the store matches that repository's canonical `fullName`. GitHub redirects an old repository path to its new canonical name after a rename or transfer; the returned name no longer matches the monitored entry, so the successful sample is skipped.

**Reproduction:** Add `Owner/Old` with 100 stars. Apply a successful refresh whose returned repository is `Owner/New` with 120 stars. A real `openStore` run against an in-memory filesystem retained `Owner/Old` at 100 stars, reported no errors, and advanced the global refresh timestamp.

**Impact:** A renamed monitored project never updates again and appears successfully refreshed. Carry the requested monitor identity through collection, then update or migrate its canonical identity and associated history without creating a duplicate monitor.

### P2 — A delayed refresh can replace a re-added monitor with older metrics

**Location:** `lib/store.mjs:165`.

Collection gathers repositories before committing the batch. `recordRefresh` applies a matching-name sample without checking whether the monitor was removed/re-added or whether its current acquisition time is newer.

**Reproduction:** Capture A=110 at time T while a batch waits on B. Remove A, then re-add A=150 at T+1 second. Commit the captured batch at T+2 seconds. A real `openStore` run with an in-memory filesystem returned A=110 with `fetchedAt=T`, while the newest history entry remained A=150 at T+1 second.

**Impact:** The displayed current metric and acquisition time move backward and disagree with the newest trend sample. Associate results with the monitor generation present when collection began and reject a sample older than the monitor's current `fetchedAt`.

### P2 — Monitor CSV exports label samples with an unrelated ranking timestamp

**Location:** `public/app.mjs:243`.

Every exported repository row uses `state.meta.fetchedAt`, which belongs to the last Star/new ranking query. Monitor and growth views now have their own per-project `fetchedAt`, but export ignores it.

**Reproduction:** Export the monitor view with a monitor acquired at `2026-10-11T09:00:00Z` and ranking metadata acquired at `2026-10-11T10:00:00Z`. Isolated execution of the real exporter produced the monitor's row with `2026-10-11T10:00:00Z`. Loading directly into `#monitors` instead leaves that timestamp empty.

**Impact:** Exported stale monitoring values can be presented as acquired more recently, compromising the source/provenance guarantees. Use each monitor's `fetchedAt` for monitor-backed exports and ranking metadata only for ranking-backed rows.

## Other review results and boundaries

- Ranking/navigation request sequencing already guards against an older ranking response replacing a newer query or a different view.
- Revenue selection isolates currency/period and uses only the newest disclosure per repository; duplicate validation prevents equal-date ambiguity in normal API data.
- Growth stays unknown without the required historical baseline and retains signed changes. Atomic mutation serialization, failure rollback, public-only repository handling, static path restrictions, HTML escaping, safe HTTP(S) links, and the tested CSV formula guards have no additional important finding from this source review.
- The implementer had already identified or was repairing refresh POST content type/body, inline styles blocked by CSP, refresh batch/client timeout mismatch, Shanghai revenue-date validation, and persisted monitoring failure/freshness metadata. These are outside the open findings above.
- Targeted reproductions used the real frontend functions with an isolated minimal DOM and real store code with an in-memory filesystem. The reviewer did not rerun the whole test suite or claim independent browser validation; the parent agent owns those checks.

## Scoped repair verification

The follow-up review inspected only the five findings and possible regressions in their fixes.

**Final scoped verdict: all five findings are fixed; no important issue remains in the reviewed repairs.**

- **Detail/form response ownership: fixed.** `public/app.mjs:233` and `public/app.mjs:239` now check the current modal owner. Re-running the real app functions with the actual imported `core.mjs` and `modal-controller.mjs` confirmed both delayed success and failure leave a replacement form intact.
- **Mutation/dialog ownership: fixed.** `public/app.mjs:202`, `public/app.mjs:213`, and `public/app.mjs:220` now close only their captured owner. Delayed monitor creation, revenue creation, and deletion all left the replacement form open; a current submission still closed its own dialog.
- **Ordinary canonical rename: fixed.** Collection now carries requested identity and monitor generation into the store. The HTTP regression confirms canonical name migration, updated metrics, retained history, and detail history returned through the old name.
- **Delayed remove/re-add: fixed.** The original same-name race passes, including a fixed-clock HTTP regression. Per-project acquisition guards also reject an older observation. The additional equal-time canonical collision case described below now preserves the re-added monitor and its history.
- **Monitor CSV provenance: fixed.** `public/app.mjs:254` uses per-project `fetchedAt` for monitor/growth rows and ranking metadata for ranking rows. Real-exporter checks returned 09:00 for monitor/growth and 10:00 for the ranking in the original reproduction. The header now reads “指标采集时间”.

Fresh reviewer commands: `node --test test/modal.test.mjs` passed 3/3; `node --test --test-name-pattern='rename|generation|acquisition|alias collision' test/store.test.mjs test/server.test.mjs` passed 7/7. The frontend execution checks additionally exercised the actual handler wiring instead of only the standalone controller. Full-suite and real-browser checks remain with the implementer.

### Additional collision repair — verified fixed

**Current location:** `lib/store.mjs:183`, `lib/store.mjs:187`.

The initial rename repair checked the alias monitor's generation, but a renamed result that collided with a different existing canonical monitor used `fetchedAt >= canonical.fetchedAt`. Its unconditional snapshot write also overwrote a canonical history point at that timestamp.

**Reproduction:** At a fixed clock, add `Owner/Old`=100 and `Owner/A`=150; capture an Old-generation refresh that returns canonical A=110; remove/re-add A=160; commit the captured observation. A fresh run against the real store with an in-memory filesystem returned only A=110 and history containing 110, replacing the re-added monitor and its 160 sample.

**Repair and verification:** The collision branch now replaces canonical metrics only for a strictly newer acquisition and retains an existing canonical history point on equal timestamps. Re-running the exact in-memory reproduction preserved the sole A monitor at 160 stars and its 160-star history point. The new equal-time alias-collision regression also passed in the targeted 7/7 run. No open finding remains from this scoped follow-up.
