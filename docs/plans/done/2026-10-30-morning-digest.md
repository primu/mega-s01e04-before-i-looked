---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
closed: 2026-10-30
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Completion record

Completed on 2026-10-30 after review and removal of the public lane marker.

### Issues

Contract #1 was committed first. Issues #3–#6 could start against that contract, then used their integration dependencies for acceptance. Each issue had a dedicated worker.

| Issue | Title | Blocked by | Worker | Status |
|-------|-------|------------|--------|--------|
| [1](https://github.com/primu/mega-s01e04-before-i-looked/issues/1) | Define the shared digest types and reader contract | None | codex · gpt-6-astra · high | Completed |
| [2](https://github.com/primu/mega-s01e04-before-i-looked/issues/2) | Implement the run-log reader and its tests | #1 | codex · gpt-6-astra · high | Completed |
| [3](https://github.com/primu/mega-s01e04-before-i-looked/issues/3) | Render the digest HTML page | #1 to start; #2 to accept integration | codex · gpt-6.1-sol · medium | Completed |
| [4](https://github.com/primu/mega-s01e04-before-i-looked/issues/4) | Expose the digest as JSON | #1 to start; #2 to accept integration | codex · gpt-6.1-sol · medium | Completed |
| [5](https://github.com/primu/mega-s01e04-before-i-looked/issues/5) | Link board nights to their digests with status counts | #1 to start; #2 and #3 to accept integration | codex · gpt-6.1-sol · medium | Completed |
| [6](https://github.com/primu/mega-s01e04-before-i-looked/issues/6) | Test digest HTML and JSON routes | #1 to start; #2, #3 and #4 to accept integration | codex · gpt-6.1-sol · medium | Completed |
| [7](https://github.com/primu/mega-s01e04-before-i-looked/issues/7) | Publish a marked HTML copy and submit it for review | #2, #3, #4, #5, #6; human publication approval | codex · gpt-6.1-sol · medium | Completed |
| [8](https://github.com/primu/mega-s01e04-before-i-looked/issues/8) | Remove the public marker and archive the finished plan | #7; review received; human replacement approval | codex · gpt-6.1-sol · medium | Completed |

### Validation, review and cleanup

- Implementation validation passed all 32 tests across 4 files and `pnpm typecheck`, each with exit code 0. Private workspace evidence: `s01e04/artifacts/final-test.stdout.log`, `final-test.exitcode` and `final-typecheck.exitcode`. This Markdown archival change did not require rerunning code tests.
- The reviewer actually saw https://megadev-preview.pages.dev/ before cleanup. The course confirmed review in `s01e04/artifacts/claim-preview-06.exchange.json`; `issue-7-reviewed.json` records #7 CLOSED/COMPLETED.
- Issue #7 was prematurely closed on link delivery, reopened after the course rejected that closure, then closed only after actual review. Delivery alone did not prove review.
- The human explicitly approved rebuilding the page with `LANE_MARKER` unset and manually replaced the public page at the same URL. The agent performed no hosting upload.
- Public verification at 2026-10-30T10:14:56Z returned HTTP 200 from https://megadev-preview.pages.dev/. The response matched the clean local export byte-for-byte, showed `no marker set`, and did not contain the issued lane marker. SHA256: `5f9aa429af610e5e75595b170ddd26b843d46609ac896c9120202ed26ee7768e` (2300 bytes). Private workspace evidence: `s01e04/artifacts/cleanup/public-verification.json`.
- The original plan prose is preserved above. The finished plan is archived here with all eight issue URLs and worker provenance. Preview HTML, issued marker and private course proofs remain outside the repository.
