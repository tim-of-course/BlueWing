# Detailed takeoff implementation

Approved September 25, 2026. Work is isolated on `feat/detailed-takeoff`.

## Scope

1. Reusable systems of component assembly snapshots with shared inputs, in project and device-local global libraries.
2. Explicit walls, openings, elevations, sloped/stepped heights, member spacing and end conditions.
3. Positioned framing pieces and exact cut lengths, derived from entered dimensions and details.
4. Project-specific component headers, including box headers, with source references.
5. Finish surfaces and net quantities by product/face/layer, plus backing and blocking.
6. Plan/3D/split views driven by the same piece data, with linked selection and sheet alignment.
7. Highlighted plan/detail snippets with coordinate mapping and export.
8. Review status, changed-since-review detection, unresolved inputs, and quantity-change previews.
9. Shared desktop/CLI authoring, inspection, rendering, schedules and exports.
10. Compatibility, recovery, bounded large-project work, and independent expected-result tests.

Ceiling grids retain the approved 2x2/2x4 area/perimeter estimates. Ceiling extent and elevation can be represented in 3D; estimated tees are not portrayed as placed pieces. Drywall requires accurate square footage, not board orientation or cutting layouts. Structural sizes and connection details are entered from project requirements, not designed by the software.

## Checkpoints and verification

Commit useful working stages as systems, construction data/pieces, headers/finishes, 3D, snippets/review, and integrated verification become usable. Preserve formula-only estimating. New project data must save atomically, participate in Undo, and survive reopening. Provide an explicit saved-file backup before an older project first upgrades; Git reverts alone cannot downgrade a project file.

Only the integrating agent runs heavy verification, through README guarded commands with one browser worker. Delegated agents run small core tests only. Record actual passes, failures and resource refusals here; do not turn an unrun check into a claimed pass.

The user supplied a private link to a Bingham Elementary School conformed set. The downloaded PDF is kept in ignored `tmp/reference-plans/`, never committed. Use selected real sheets for import/render checks and relevant construction examples; synthetic fixtures remain the reproducible automated basis.

## Validation results

Implementation is complete enough for integrated verification; final native and full browser runs remain in progress. Resource refusals and stops are recorded as unrun checks, never passes.

| Check                                               | Actual result                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| TypeScript, ESLint, Prettier                        | Pass                                                                           |
| Core                                                | 110 pass                                                                       |
| Resource guard/tooling                              | 9 pass                                                                         |
| Platform storage, SQLite and IndexedDB              | 9 pass                                                                         |
| Rust/native unit tests                              | 9 pass                                                                         |
| Native debug binaries                               | Build passes                                                                   |
| Web production build                                | Pass; existing large-bundle advisory remains                                   |
| New development workflows, Chromium                 | 2 pass, including nonempty Solid attribution, no diagnostics or silent holds   |
| New production workflows, Chromium                  | 2 passed before final PDF-worker and 3D-display refinements; final run pending |
| Full development and production suites              | Stopped by memory-pressure guard; pending                                      |
| Native detailed CLI workflow and private large plan | Pending                                                                        |
| Final desktop bundle                                | Pending                                                                        |

Core scenarios include independent project/global copies; shared typed inputs; imperial/metric conversion; exact flat, sloped and stepped cuts; allowances; rotated component headers and extensions; rough opening widths; off-module jamb replacement; sill and cripple clipping; explicit shared junction ownership; bent wall finishes; partial-height finishes and layers; stock segmentation, waste and packages; 2x2/2x4 ceiling estimates; reference ceiling exclusion; generation limits; atomic rollback; Undo/Redo; geometry duplication; template reapplication preserving local context; relevant review invalidation; and quantity previews that never save.

The 3D tests cover section orientation, surface thickness, sheet/level transforms, filtering before the display limit, camera projection and nearest-piece picking. A dedicated byte-reader test covers sequential bounded chunks, native array-buffer and fallback-array responses, empty assets, and short reads.

The browser workflows author a 24 ft wall with 19 studs and 240 ft² of board, preview a height change, reapply its template, inspect a filtered split view, create/export highlighted evidence, review it and reopen. A second workflow builds a steel-and-board system, copies it through the global library, edits shared height and verifies both quantities and cuts after reopening. A new malformed-PDF test checks actual worker termination after repeated rejection.

Native coverage checks immutable temporary snapshots, bounded reads, incremental SQLite BLOB writes, transactional rollback, format-3 recovery backups, and independent persistence. The integrated CLI script additionally checks malformed-import rollback, inspect/preview/Undo, box-header components, rendered evidence, CSV/JSON, global copies, close/restart equality and backup reopening. Its optional large-plan run imports all 164 pages, renders first/middle/last and compares the reopened last-page pixels.

## Operational limits

- Enter heights, allowances, member sizes, opening dimensions and project details explicitly. The software computes those details; it does not establish engineering requirements.
- Rectangular section envelopes show position, dimensions and cuts. The viewer draws framing through translucent finishes for inspection. It does not model C-shaped flanges, fasteners, connection fabrication or automatic joint design.
- Bent/stepped track joints are flagged for explicit review. Multiple jambs and junction members require offsets and ownership; automatic general-purpose connection resolution is deferred.
- Exact cuts and stock purchases are available. Offcut reuse and optimized cutting plans are deferred.
- Drywall, FRP and sheathing use net square footage by product/face/layer. Ceiling grid counts remain the approved estimating factors; ceiling surfaces default to reference-only.
- Other trades retain editable formula assemblies. Only authored wall/ceiling geometry gets positioned 3D representation.
- Generation stops at 50,000 pieces/surfaces with an incomplete warning. The scene displays at most 4,000 filtered objects and reports omissions; exports retain generated records.
- Native import/reopen uses bounded IPC and incremental BLOB storage, removing full-file base64/JSON transfers. PDF.js still holds a whole PDF buffer; import temporarily retains a second binary buffer. This is not a claim of constant total memory.
- New native behavior has not been verified on Windows.

## Recovery checkpoints

- `f3e8916`: scope and implementation plan.
- `3b1f715`: component systems, construction model, commands and review.
- `6996d28`: format-3 persistence, recovery backups and initial bounded encoding.
- `5f504db`: LGMF cut semantics, reusable wall templates and review dependencies.
- Next checkpoint: desktop authoring, 3D/review, bounded native transport and integration coverage.

Older app versions should use the automatic pre-upgrade backup, not a format-3 project with unsupported data. The private 349,354,454-byte Bingham PDF and verification images remain in ignored `tmp/`.

## Delegated work record

Banana Split ran 14 distinct root coordinators and zero child subagents. All roots used the configured `gpt-6-astra` model at medium reasoning; no preset override was supplied. The integrating host is GPT-6; its reasoning setting is unavailable.

Twelve workflows completed with successful bounded results. Two UI workflows failed at startup with HTTP 401, before edits; the host implemented their work. All are mechanically terminal. Runtime diagnostics total one managed tool rejection (`banana_send:not_found`), zero no-disposition turns, zero formal revisions and zero formal acceptances. Host review and follow-up messages are not formal child revisions. Three lightweight command approvals were granted after inspecting their commands; no heavy work was delegated. One later host message reached an already-completed viewer agent and was refused as unavailable.

Host integration corrected a reviewer’s solid-track deduction assumption for LGMF channel nesting, a Rust API mismatch, empty-system preview validation, excessive toolbar reactive reads, 3D picking/display, off-module jamb collisions and failed-PDF worker cleanup. Only the host ran guarded browser/native/build checks.

| Workflow                                | Root agent                               | Mechanical status |
| --------------------------------------- | ---------------------------------------- | ----------------- |
| wf_16865433-9823-417b-bcb3-6cd5f4966f41 | agt_12971e73-7c6d-4895-9949-657992116bda | completed         |
| wf_33ae7a10-ca71-499e-b91d-ab986318a41c | agt_719109a3-6054-48d8-b9c3-9053f4a9676b | completed         |
| wf_28efdeb1-399a-41b5-8786-ea76550ef066 | agt_a6cfde7a-446b-43f6-9942-dacda9ea8ddb | completed         |
| wf_0b61cd2a-aa67-45c2-bc35-dd23d81a739f | agt_b42780f5-af99-4c8d-a08d-937c31946e5a | failed            |
| wf_85e4941b-7eed-4cd4-a10b-3ca05bdfb2e8 | agt_c67d5669-8871-4e93-b234-f0bf3ee3d6a1 | failed            |
| wf_34ec5ccc-12d5-4f9e-abfa-e2fedda87147 | agt_ec95bda0-9caa-48d0-bced-90f993d51ba2 | completed         |
| wf_be699298-445e-4b70-a236-98f9cb30c2d4 | agt_8a0880e2-9b22-4fe7-b950-2bbe7398a133 | completed         |
| wf_a1c1d791-a3fe-4626-b5de-819ec7b34d2a | agt_2673b8f4-cd8e-474a-94c1-0318730d5f30 | completed         |
| wf_fac31209-258d-45e2-84b8-adba920eecf5 | agt_59b8f20a-bcb3-4893-aadd-94b6e36f6510 | completed         |
| wf_0d139e5e-2ad7-4932-910d-b23c157b4121 | agt_fcbcb0b5-2e67-4d50-8678-57dff93b362c | completed         |
| wf_157bfbad-7ffe-4aa7-8629-1ac5ce7eb34a | agt_7050562c-5471-46ce-903b-6d31d9cb69a6 | completed         |
| wf_d269cbed-1665-47e7-9705-5cbe0a284c22 | agt_c9bb3e2a-0650-454c-b2f3-9e6c9f4f15dd | completed         |
| wf_534bdcc0-f7e6-40dc-98d1-e5a583d403a5 | agt_1bc883d1-e49c-4c53-b0c5-7055a00e82ab | completed         |
| wf_361d5287-8e76-49bb-9297-ee598331758b | agt_05365048-1a10-42d2-84b4-fbbb07a0fd8b | completed         |
