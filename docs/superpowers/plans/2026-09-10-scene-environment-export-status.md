# Scene Environment Export — Implementation Status

Tracks execution progress across all five plans implementing
`docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`, via
`superpowers:subagent-driven-development`. Branch: `scene-environment-export`.

## Plans

| Plan | Status | Tasks | Final commit |
|---|---|---|---|
| [foundation](2026-09-10-scene-environment-export-foundation.md) | Merge-ready | 5/5 | (see git log) |
| [compiler](2026-09-10-scene-environment-export-compiler.md) | Merge-ready | 8/8 | `b0ed3d6` |
| [cli](2026-09-10-scene-environment-export-cli.md) | Merge-ready | 5/5 | `7056eb4` |
| [server](2026-09-10-scene-environment-export-server.md) | In progress | 5/6 | `5039dfd` (Task 5, review pending) |
| [editor-ui](2026-09-10-scene-environment-export-editor-ui.md) | Not started | 0/6 | — |

## Foundation plan

WFC provenance, `generateWfcScene`, `SceneRecipe` domain types + builder,
`EnvironmentManifest` types + deterministic encoder, GLB reader + package
validator. All 5 tasks complete; final whole-branch review found and fixed:
a validation-throw-outside-try/catch bug, an internally-inconsistent test
fixture, a truncated SHA-256 known-answer hash, a validator that threw on
malformed input instead of reporting diagnostics (two rounds), and
locale-dependent JSON key ordering that broke byte-identical export
determinism. Merge-ready.

## Compiler plan

Asset resolution, geometry flattening/instancing/merging, seam removal, GLB
writing, manifest assembly, navigation graph. All 8 tasks complete; final
whole-branch review found and fixed two Critical issues (seam removal
mutating geometry shared by reference across placements of the same asset —
real data corruption; no end-to-end test for seam removal) and one Important
issue (navigation graph read a socket field zero real road-tile assets
populate, making the feature non-functional against real data). Fixed in one
wave; a re-review of that wave found a new regression (an "optional" guard
that silently disabled seam removal for multi-neighbor cells) and required a
second, tightly-scoped correction. Deferred and documented: ground-quad
generation + vertex welding (spec stages never implemented), synthetic
manifest bounds, seam-matching algorithmic complexity. Merge-ready.

## CLI plan

`npm run scene:export`: headless WFC generation → compile → write package.
All 5 tasks complete. Task 5's manual verification (run against the real
asset catalog, as required) surfaced a real gap no automated test caught:
`FileReader` is undefined in real Node/vite-node, only present in this
project's jsdom test environment, but `GLTFExporter` needs it for GLB
assembly. Fixed by relocating the polyfill into the project's existing
centralized `src/environment/nodeGltfShim.ts` (not a new ad hoc copy) so
future Node-side callers — notably the server plan — inherit it
automatically. Final whole-branch review found no Critical issues; one fix
wave addressed six Important findings (malformed `--seed`/numeric flags
silently truncated instead of rejected; `process.exit()` inside
unit-testable logic; a misleading WFC error for a bad `--asset-root`;
unguarded non-null assertions in `sceneFromGeneration`) plus several Minor
items (comment accuracy, diagnostic aggregation, deterministic scene IDs).
Two findings were deliberately deferred rather than fixed: locale-dependent
asset/palette ordering (inherited from already-merged plans, needs its own
review) and the CLI's structural inability to exercise the discrete-object
compiler path (not a defect — a WFC-only CLI has no discrete objects).
Merge-ready.

## Server plan (in progress)

Scene-owned package storage + export/import API routes. Progress:

- **Task 1** (`Scene.environment` reference field): complete, approved with
  zero findings.
- **Task 2** (`createEnvironmentPackageStore`, wired into duplicate/delete):
  complete. Task-level review found `replace()` had a real zero-package
  crash window (delete-old-then-rename-new, with a gap where neither
  existed) — fixed by renaming the old package aside first instead of
  deleting it, closing the window to zero.
- **Task 3** (export routes — compile server-side, serve manifest/model
  separately): complete. Review found three Important issues, all
  plan-mandated: unbounded export-cache growth across distinct scenes, an
  export-ID route not scoped to its owning scene, and a missing
  route-vs-body scene-ID consistency check (unlike the existing PUT route's
  equivalent check). The first two were ruled acceptable tradeoffs for this
  local, single-developer, no-auth dev tool; the third was fixed (one-line
  check, mirrors existing convention).
- **Task 4** (import routes — stage, validate, commit): complete. Review
  found a genuine correctness gap (not just a dev-tool tradeoff): a rejected
  import's staged files were never cleaned up, so a later partial re-upload
  could silently pair a new file with a stale, previously-rejected one.
  Fixed by clearing staging on both failure paths (invalid JSON, rejected
  pair) while leaving the "still mid-upload" path alone.
- **Task 5** (client API wrappers in `src/api/client.ts`): implementer
  reports DONE (commit `5039dfd`); task-level review not yet completed as of
  this snapshot.
- **Task 6** (serve committed package for reload on scene open): not started.

## Editor-UI plan (not started)

Project panel Export/Import controls, `EditorState.exportEnvironment`/
`importEnvironment`, File System Access API integration, locked-environment
world feature. Depends on the server plan. No tasks dispatched yet.

## Process notes

- Each plan's live working state (task briefs, implementer reports, review
  packages) lives in `.superpowers/sdd/<plan-basename>/` — git-ignored,
  deleted once a plan reaches merge-ready.
- Per this session's controller rulings: plan-mandated findings from a task
  review are fixed immediately when they affect real correctness, and
  deliberately deferred (with a recorded reason) when they're genuine but
  low-risk given this app's actual threat model (a local, single-developer,
  no-auth dev server).
- Once all 5 plans are merge-ready, `superpowers:finishing-a-development-branch`
  runs once for the whole branch, not per plan.
