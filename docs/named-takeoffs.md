# Named independent takeoffs

A format-5 project contains one automatically created Main (`main`), plus independently named phases and change orders. Main can be renamed but cannot be deleted. A change order records its Main reference; it contains only its own work. New phases and change orders start empty. No rollups, replacement snapshots, merging, accounting, or migration are implemented. Format-4 development projects must be recreated.

PDF assets, page identity/metadata and source-pixel caches are shared. Geometry, group memberships, assignments, applied definitions, scale, construction context and review belong to one takeoff. Existing record collections hold the entities; takeoff records hold ownership ID lists, local calibrations/context, and copy provenance. Unlisted records belong to Main. One project revision, transaction queue, undo/redo history and incremental record persistence serve all takeoffs. Undo can therefore affect a different takeoff from the one currently displayed.

The global assembly library remains reusable. Import or copy a definition into the intended takeoff. Within that takeoff its existing live definition semantics apply. Editing a copied definition never updates its source or another takeoff. Assembly category remains a descriptive scope label; no scope tags or material identities are derived from takeoff names/categories.

## UI workflow

Use **Active takeoff** beside the project name. Switching clears drawing/group selections and changes the navigator, canvas, inspector, quantities, construction and review inputs together. Finish or cancel unfinished drawing/input before switching.

Open **Takeoffs** to create, rename or delete a takeoff. Choose a source takeoff, check drawing items, choose Addition or (for change orders) Deduction, then **Copy selected items**. Copies include associated groups, assignments, independent definitions and construction references. The copy records the source takeoff/entity IDs and project revision. Source scale transfers to an unset destination; conflicting scales reject the complete copy.

For a changed wall, copy the original Main wall as a deduction, then author its replacement as an addition. Neither wall follows later changes to the other. Deleting a takeoff deletes its owned work in one undoable transaction and retains shared PDF assets.

## CLI contract

Discover IDs with `takeoff.list`. `takeoff.create` accepts `{id?, name, kind: "phase" | "change-order"}`. `takeoff.rename` accepts `{id, name}`; `takeoff.delete` accepts `{id}`. These and project-wide calls do not depend on UI selection.

Takeoff reads/edits, calculations, renders, `batch`, and `preview` require an explicit **envelope** `takeoffId` in CLI requests. Mutations additionally require `projectId` and the latest `expectedRevision`. UI selection never supplies CLI context. A batch/preview has one takeoff context; child commands cannot specify another takeoff ID.

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

Only change-order assignments accept `direction: "deduct"`; other assignments use `add`. Geometry, base quantities, waste and package rounding remain positive. Output rows retain the direction and positive purchasing arithmetic; material totals expose gross `additions`, gross `deductions`, and signed net `amount` in each material/unit/cut-stock bucket. Zero-net rows retain both contributions and completeness. An unresolved deduction remains incomplete. Pieces, construction JSON/CSV, quantity CSV/JSON, image metadata and filenames carry takeoff/direction context. Deduction members/surfaces are red in 3D; source geometry and physical dimensions stay positive.

Each takeoff's downstream HTML handoff is independent. Consumers should use `takeoff.inspect` and `quantities.inspect` with the same explicit ID and revision, retain the project ID, takeoff ID/name/kind and contribution directions, and use filenames such as `<project>-<takeoffId>-handoff.html`. This feature exposes the data contract only; document generation and registries are owned separately.

The EstiMaker projection from PR #6 is the shared purchasing presentation path. Its version-2 envelope adds takeoff identity, signed quantity, positive gross quantity and contribution direction after the existing purchasing/conversion steps. See [the export contract](estimaker-export.md). Piece JSON uses `{context, rows}` so an empty schedule still identifies its takeoff.

## Verification

Local Windows verification used the pinned dependency set: static checks, core tests, 14 guarded platform tests (including SQLite plus Chromium/Firefox/WebKit IndexedDB), eight focused development browser scenarios and 20 selected production browser scenarios across Chromium/Firefox, and the guarded production build. Browser workers remained at one; development captures reported no Solid diagnostics or silent holds. Native builds/desktop workflows were not run because no native adapter changed. These results do not establish native webview or other operating-system behavior.
