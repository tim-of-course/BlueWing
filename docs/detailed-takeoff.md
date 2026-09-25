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

Implementation in progress. No new feature verification is claimed yet.
