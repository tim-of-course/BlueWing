# Named independent takeoffs

A format-6 project contains one automatically created Main (`main`), plus independently named phases and change orders. Main can be renamed but cannot be deleted. A change order records its Main reference; it contains only its own work. New phases and change orders start empty. No rollups, replacement snapshots, merging, accounting, or migration are implemented. Format-4/5 development projects must be recreated. No compatibility/migration code is provided. PR #3 merged first with format 5; this PR therefore uses format 6. Recreate incompatible development files; no adapter is provided.

PDF assets, page identity/metadata, calibration and source-pixel caches are shared. Editing a page's scale updates derived measurements in every takeoff; geometry and applied definitions remain independent. Geometry, group memberships, assignments, applied definitions, construction context and review belong to one takeoff. Existing record collections hold the entities; takeoff records hold ownership ID lists, local context, and copy provenance. Unlisted records belong to Main. One project revision, transaction queue, undo/redo history and incremental record persistence serve all takeoffs. Undo can therefore affect a different takeoff from the one currently displayed.

The global assembly library remains reusable. Import or copy a definition into the intended takeoff. Within that takeoff its existing live definition semantics apply. Editing a copied definition never updates its source or another takeoff. Assembly category remains a descriptive scope label; no scope tags or material identities are derived from takeoff names/categories.

## UI workflow

Use **Active takeoff** beside the project name. Switching clears drawing/group selections and changes the navigator, canvas, inspector, quantities, construction and review inputs together. Finish or cancel unfinished drawing/input before switching.

Wingman previews and saved return views belong to one takeoff and clear when switching. CLI renders for another takeoff still export that takeoff, but do not replace the active takeoff's preview.

Open **Takeoffs** to create, rename or delete a takeoff. Choose a source takeoff, check drawing items, choose Addition or (for change orders) Deduction, then **Copy selected items**. Copies include associated groups, assignments, independent definitions and construction references. The copy records the source takeoff/entity IDs and project revision. Copies reference the same shared pages and calibration; no scale transfer or conflict rules exist.

For a changed wall, copy the original Main wall as a deduction, then author its replacement as an addition. Neither wall follows later changes to the other. Deleting a takeoff deletes its owned work in one undoable transaction and retains shared PDF assets.

## CLI contract

Discover IDs with `takeoff.list`. `takeoff.create` accepts `{id?, name, kind: "phase" | "change-order"}`. `takeoff.rename` accepts `{id, name}`; `takeoff.delete` accepts `{id}`. These and project-wide calls do not depend on UI selection.

The CLI starts on Main when a project opens. `takeoff.select` with `{id}` changes its current takeoff for subsequent reads/edits, calculations, renders, `batch`, and `preview` until selected again. This is open-session state, separate from UI selection, so agent navigation does not move the user's workspace. An optional **envelope** `takeoffId` overrides one request without changing the selection. Every takeoff-scoped result echoes effective ID/name/kind. Deleting the selected takeoff resets CLI context to Main. Mutations additionally require `projectId` and the latest `expectedRevision`. A batch/preview has one effective context; child commands cannot specify another ID.

```json
{
  "projectId": "project-id",
  "expectedRevision": 12,
  "takeoffId": "co-id",
  "payload": {
    "sourceTakeoffId": "main",
    "geometryIds": ["original-wall-id"],
    "direction": "deduct"
  }
}
```

Send this request to `takeoff.copyItems`. `takeoff.inspect` returns only the requested takeoff's drawing, definitions, assignments and context, with project identity/revision. `project.inspect` remains project-wide. Use `commands.list` or `help <command>` for schemas. Unknown/foreign IDs and cross-takeoff references are rejected.

## Quantities and handoff boundary

Only change-order assignments accept `direction: "deduct"`; other assignments use `add`. Geometry, base quantities, waste and package rounding remain positive. Output rows retain the direction and positive purchasing arithmetic; material totals expose gross `additions`, gross `deductions`, and signed net `amount` in each material/unit/cut-stock bucket. Zero-net rows retain both contributions and completeness. An unresolved deduction remains incomplete. Pieces, construction JSON/CSV, quantity CSV/JSON, image metadata and filenames carry takeoff/direction context. Plan deductions use dashed strokes, including area boundaries, count rings and selections. Deduction members/surfaces use screen-space hatching in 3D. Color remains independent and belongs to the category/group palette; source geometry and physical dimensions stay positive.

Each takeoff's downstream HTML handoff is independent. Consumers should use `takeoff.inspect` and `quantities.inspect` with the same explicit ID and revision, retain the project ID, takeoff ID/name/kind and contribution directions, and use filenames such as `<project>-<takeoffId>-handoff.html`. This feature exposes the data contract only; document generation and registries are owned separately.

The EstiMaker projection from PR #6 is the shared purchasing presentation path. Its version-2 envelope adds takeoff identity, signed quantity, positive gross quantity and contribution direction after the existing purchasing/conversion steps. See [the export contract](estimaker-export.md). Piece JSON uses `{context, rows}` so an empty schedule still identifies its takeoff.

The merged category painter retains the independent `deductionIds` option before category dispatch (parallel strokes, area outlines, count rings and selection). Source `direction` survives the category/color scene projection, and 3D hatching applies to category-colored materials without a deduction color override. Project scratchpad notes and category palette edits remain project-wide; page alignment uses the shared page scale.

## Verification

After integration with main at `4ff0273`, Windows verification passed:

- Typecheck, lint, formatting and the guarded production build.
- 282 core tests, with one POSIX-only skip.
- 17 guarded storage tests, including SQLite and Chromium/Firefox/WebKit IndexedDB.
- All 20 focused development workflows across Chromium/Firefox: takeoffs, deduction pixels, categories, scratchpad, handoff viewer and page alignment. Page alignment initially exposed unstable material/role arrays; shallow equality fixed those diagnostics and both browser reruns passed.
- All 46 production browser tests across Chromium/Firefox, with one worker.

Core integration regressions confirm that project notes/category palettes remain shared when edited from another takeoff, and category projection preserves deduction direction and color. Format 6 is reflected in code, fixtures, documentation and release declarations; older formats are rejected without migration.

An additional existing Wingman live-3D development scenario still fails in both browsers: main's fixture performs middle-drag (pan) but asserts that zoom changed. That gesture/assertion mismatch is unchanged by this integration and is not counted as a pass. Native runtime and other operating systems were not tested.
