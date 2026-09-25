# Assemblies

Assemblies extend the existing recipe calculation path. Each project owns its definitions and assignments. The global library is a separate, device-local collection of reusable definitions. Importing makes an independent project copy; subsequent global edits or deletion do not alter it. Project edits use ordinary revision checks, atomic saving, preview, and Undo. Global edits save independently and do not belong to project Undo.

## Desktop use

1. Open **Assemblies**, then **Global library**. Choose a starter and **Import into project**, or create a new project assembly.
2. Set its name, category, material/product, description, and detail/specification reference. Use a different material identifier for each distinct product, size, gauge, or thickness. Identical identifiers and units combine in material totals, including across different assemblies.
3. Declare number or boolean inputs with units. An input without a default is required. Numeric inputs can have a minimum. Add material outputs with formulas, waste, and optional package sizes.
4. Assign the assembly to a group. **Input scope** switches between group values and individual drawing objects. Values resolve from the object override, then the group value, then the assembly default. Reset removes an override. Changing a default preserves explicit overrides.
5. Use **Quantities** for material totals and source contributions. Piece outputs also appear in **Required pieces by location** and **Export piece CSV**.
6. **Save a copy to global library** creates a reusable copy with a new identity. Edit an existing global definition through the Global library tab. Importing an updated definition makes another project copy; there is no automatic replacement of assigned project definitions.

A drawing object may supply several assembly assignments, for example framing, drywall on each face, and backing. An assembly still uses a flat group; a group with one object provides an individual assignment. Different openings in one count set share the object's inputs. Draw separate count objects when opening dimensions or construction details differ.

Missing required values, impossible dimensions, negative calculated quantities, or incompatible units leave results incomplete with source diagnostics. “Calculated” describes arithmetic validity, not whether the whole building has been taken off or reviewed.

## Material quantities and pieces

Ordinary outputs produce quantities in feet, inches, metres, millimetres, square feet, square metres, items, or scalar units. Formula variables are `length` for paths, `area` and `perimeter` for areas, `count` for count sets, and declared inputs. Measurements and input quantities carry dimensions; plain formula numbers are dimensionless. The existing arithmetic, condition, min/max, and rounding functions remain available.

A piece output uses `ea`, a whole-number quantity formula, a role, and a positive cut-length formula. An optional stock-length formula must produce a length at least as long as the cut. Formulas consume inputs in their declared units. Schedules normalize lengths to metres; the desktop displays feet and inches. CSV length columns explicitly use `_m`.

Required piece schedules retain the drawing location, assembly, assignment, material, role, count, cut length, and stock length. They exclude purchasing waste. Purchasing quantities add waste and round to whole pieces or packages. Piece allowances apply to each ordered stock length within an assignment/output, combining different cuts that use the same stock. Without a stock length, each distinct cut length is rounded separately. Material totals then combine matching materials and ordered stock lengths; without a stock length they retain the cut-length distinction. This counts one stock length per required piece and does not optimize multiple cuts or reuse offcuts. Sources retain their individual cuts even when purchasing totals combine.

Quantity CSV retains assembly/output totals and adds role and length columns. Piece CSV supplies the location-by-location schedule. JSON exports retain full source details and diagnostics.

## Starter templates and scope

| Template                  | Computes                                                                                     | Explicit limits                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drywall wall face         | `(length × height − deduction) × layers`                                                     | One face and one board product per assignment. Deduction is area per layer. No panel layout.                                                                     |
| Steel studs, straight run | Spacing count plus explicitly entered extra studs; cut length from height less end allowance | Uninterrupted run estimate. No automatic opening, corner, junction, sloped-deck, or individual stud-position calculation. Specify the material and stock length. |
| Header component schedule | Counted openings × specified components; width plus entered end extensions                   | The project detail supplies all dimensions and component rules. Add outputs for distinct header components. No structural design is assumed.                     |
| Acoustical ceiling area   | Net area and perimeter trim                                                                  | No grid or hanger layout.                                                                                                                                        |
| FRP / wall sheathing face | Net area by height, layers, and deduction                                                    | Set the actual panel product; no panel cutting layout.                                                                                                           |
| Blocking / backing runs   | Measured length × rows                                                                       | Set the material/section; no automatic intersections or backing locations.                                                                                       |
| Acoustical wall panels    | Panel count and coverage from entered dimensions                                             | Separate products/dimensions use distinct assignments or objects.                                                                                                |

These are editable estimating templates, not a complete company catalog. The framework supports additional trades through project or global definitions. System bundles, automatic wall/opening relationships, detail-image references, and richer review tools remain later work.

## CLI and compatibility

`commands.list` supplies schemas and examples. New commands:

- `assembly.put`, `assembly.delete`: project definitions. Existing `recipe.put` and `recipe.delete` remain compatible aliases. Project inspection retains the `recipes` collection and assignment `recipeId` to preserve existing scripts.
- `assembly.import`: `{ "libraryId": "drywall-face", "id": "project-board" }`. Requires the active project identity/revision and rejects an existing project assembly ID.
- `library.inspect`: returns `version`, `revision`, and `assemblies`; works without an open project.
- `library.put`: `{ "assembly": { ... }, "expectedLibraryRevision": 0 }`.
- `library.delete`: `{ "id": "library-id", "expectedLibraryRevision": 1 }`.
- `pieces.inspect`, `pieces.export`: required-piece rows; export accepts `format: "csv"` or `"json"`.

All parameters go in the usual request `payload`. Library writes use their separate library revision and do not change the project revision. A stale library write fails without overwriting the accepted library. Refresh and review before retrying.

`assignment.put` accepts optional `geometryInputs`, a map from member geometry IDs to input overrides. Replacing an assignment is a complete-record write. Nonmember overrides are rejected. Removing a member or deleting geometry removes its overrides in the same undoable edit. Duplicating a group copies its assignments and overrides while retaining the geometry references.

Project format 2 supports the extended records. Format 1 projects still open and upgrade on the next accepted edit; the format marker is saved in the same transaction as the records. The SQLite table layout is unchanged. Older app versions cannot open a format 2 project. Global library files use a separate version 1 format and atomic replacement, stored at the native app data directory's `data/assemblies.json`. Browser development stores its separate library in local storage. Nothing is synchronized between devices.

Native bridge version 2 adds generic `app_data_read` and `app_data_write` operations. Newly built web-release manifests require bridge 2.

## Validation and remaining examples to check

Automated assembly examples are in `tests/core/assemblies.test.ts`; global persistence/failure checks are in `tests/core/assembly-library.test.ts`. Browser workflows are in `tests/browser/assemblies.ts`; the actual desktop/CLI workflow is `tests/desktop/assemblies.py`.

| Scenario                                                                                              | Independently expected result                                                                           |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 24 ft wall, 10 ft height, 21 ft² deduction, two layers                                                | 438 ft²                                                                                                 |
| Two 24 ft walls, group height 8 ft; second wall overrides height to 10 ft and layers to two           | 672 ft²; changing default layers to three produces 1,056 ft² while retaining the second wall's override |
| Two 24 ft straight runs at 16 in spacing, heights 10 and 11 ft, ½ in end allowance                    | 19 required studs at 9 ft 11½ in, and 19 at 10 ft 11½ in                                                |
| Those stud groups with 10% waste and 12 ft stock                                                      | 42 stock pieces, or three 20-piece bundles when packaged; required schedule remains 38 pieces           |
| Three 4 ft openings, 3 in extension at each end, two components plus one distinct closure per opening | Six components and three closures, each 4½ ft                                                           |
| FRP: 24 ft × 4 ft less 12 ft²                                                                         | 84 ft²                                                                                                  |
| Ceiling: 24 × 15 ft rectangle less 20 ft²                                                             | 340 ft² and 78 ft perimeter                                                                             |
| Blocking: two rows along 24 ft                                                                        | 48 ft                                                                                                   |
| Three acoustical panels, each 2 × 4 ft                                                                | Three panels and 24 ft²                                                                                 |
| Metric height of 3,048 mm                                                                             | Same 10 ft cut length as imperial input                                                                 |

Checks also cover missing inputs; short stock; nonpositive cut lengths; fractional piece counts; incompatible dimensions; invalid object overrides; material aggregation; project/library copy independence; stale library writes; failed saves; legacy format upgrade; membership deletion and restoration; group copying; preview; atomic rollback; and Undo/Redo.

Browser workflows exercise importing and editing a project copy, saving/editing a global copy without changing the project, required-input diagnostics, individual overrides, Undo/Redo, reload/reopen, retained global defaults, piece display, and CSV download. Development tests inspect Solid diagnostics. Native verification closes/restarts the actual desktop app, reuses the global definition in a second project, deletes the global original, and reopens the first project's unchanged quantities and cut list.

Not established by these examples: correctness of your project's particular header details, a complete opening/junction framing takeoff, supplier stock optimization, ceiling grid/hanger quantities, very large-project interaction performance, or native Windows interaction for these new controls. Those need representative job examples as the relevant calculations are introduced.

## Local verification, September 24, 2026

- TypeScript, strict lint, formatting, and Rust formatting passed.
- 53 core tests, seven platform tests, and six Rust tests passed.
- All 20 development scenarios were checked across Chromium and WebKit. The initial combined run had 19 passes and one existing navigation scenario failed on a PDF.js fake-worker warning; its focused WebKit rerun passed without relaxing the assertion. After the final purchasing-rounding correction, assembly and takeoff development scenarios passed again in both browsers with their diagnostic checks.
- All 16 production browser scenarios passed against the final build. The assembly quantities and piece-schedule screenshot was visually inspected.
- The macOS app was rebuilt. Its included binaries passed `tests/native/smoke.py`, `tests/desktop/assemblies.py`, and `tests/desktop/workflow.py`. The last workflow included the 15-sheet Behavioral Health Group reference-plan import and rendering.
- The assembly native workflow additionally verifies that different cut lengths using the same stock share package rounding: 38 required studs plus 10% waste need three bundles of 20, while the required piece schedule remains unchanged.

Local native evidence is in `tmp/assembly-workflow/`, including `commands.json`, `pieces.csv`, and `assemblies.png`. Browser evidence is in `test-results/`. These ignored artifacts contain local test data and are not committed. Native Windows testing of the new library and editor remains outstanding.
