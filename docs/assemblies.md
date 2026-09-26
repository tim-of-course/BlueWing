# Assemblies

Assemblies extend the existing recipe calculation path. Each project owns its definitions and assignments. The global library is a separate, device-local collection of reusable definitions. Importing makes an independent project copy; subsequent global edits or deletion do not alter it. Project edits use ordinary revision checks, atomic saving, preview, and Undo. Global edits save independently and do not belong to project Undo.

## Desktop use

1. Open **Assemblies**, then **Global library**. Choose a starter and **Import into project**, or create a new project assembly.
2. Set its name, category, material/product, description, and detail/specification reference. Use a different material identifier for each distinct product, size, gauge, or thickness. Identical identifiers and units combine in material totals, including across different assemblies.
3. Declare number or boolean inputs with units. An input without a default is required. Numeric inputs can have a minimum. Add material outputs with formulas, waste, and optional package sizes.
4. Assign the assembly to a group. **Input scope** switches between group values and individual drawing objects. Values resolve from the object override, then the group value, then the assembly default. Reset removes an override. Changing a default preserves explicit overrides.
5. Use **Quantities** for material totals and source contributions. Piece outputs also appear in **Required pieces by location** and **Export piece CSV**.
6. In an existing saved library, **Add missing starters** adds new built-in templates and restores deleted starters. It preserves every existing definition and project copy.
7. **Save a copy to global library** creates a reusable copy with a new identity. Edit an existing global definition through the Global library tab. Importing an updated definition makes another project copy; there is no automatic replacement of assigned project definitions.

A drawing object may supply several assembly assignments, for example framing, drywall on each face, and backing. An assembly still uses a flat group; a group with one object provides an individual assignment. Different openings in one count set share the object's inputs. Draw separate count objects when opening dimensions or construction details differ.

Missing required values, impossible dimensions, negative calculated quantities, or incompatible units leave results incomplete with source diagnostics. “Calculated” describes arithmetic validity, not whether the whole building has been taken off or reviewed.

## Material quantities and pieces

Ordinary outputs produce quantities in feet, inches, metres, millimetres, square feet, square metres, items, or scalar units. Formula variables are `length` for paths, `area` and `perimeter` for areas, `count` for count sets, and declared inputs. Measurements and input quantities carry dimensions; plain formula numbers are dimensionless. The existing arithmetic, condition, min/max, and rounding functions remain available.

A piece output uses `ea`, a whole-number quantity formula, a role, and a positive cut-length formula. An optional stock-length formula must produce a length at least as long as the cut. Formulas consume inputs in their declared units. Schedules normalize lengths to metres; the desktop displays feet and inches. CSV length columns explicitly use `_m`.

Required piece schedules retain the drawing location, assembly, assignment, material, role, count, cut length, and stock length. They exclude purchasing waste. Purchasing quantities add waste and round to whole pieces or packages. Piece allowances apply to each ordered stock length within an assignment/output, combining different cuts that use the same stock. Without a stock length, each distinct cut length is rounded separately. Material totals then combine matching materials and ordered stock lengths; without a stock length they retain the cut-length distinction. This counts one stock length per required piece and does not optimize multiple cuts or reuse offcuts. Sources retain their individual cuts even when purchasing totals combine.

Quantity CSV retains assembly/output totals and adds role and length columns. Piece CSV supplies the location-by-location schedule. JSON exports retain full source details and diagnostics.

## Starter templates and scope

| Template                          | Computes                                                                                     | Explicit limits                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drywall wall face                 | `(length × height − deduction) × layers`                                                     | One face and one board product per assignment. Deduction is area per layer. No panel layout.                                                                     |
| Steel studs, straight run         | Spacing count plus explicitly entered extra studs; cut length from height less end allowance | Uninterrupted run estimate. No automatic opening, corner, junction, sloped-deck, or individual stud-position calculation. Specify the material and stock length. |
| Header component schedule         | Counted openings × specified components; width plus entered end extensions                   | The project detail supplies all dimensions and component rules. Add outputs for distinct header components. No structural design is assumed.                     |
| Acoustical ceiling area           | Net area and perimeter trim                                                                  | No grid or hanger layout.                                                                                                                                        |
| FRP / wall sheathing face         | Net area by height, layers, and deduction                                                    | Set the actual panel product; no panel cutting layout.                                                                                                           |
| Blocking / backing runs           | Measured length × rows                                                                       | Set the material/section; no automatic intersections or backing locations.                                                                                       |
| Acoustical wall panels            | Panel count and coverage from entered dimensions                                             | Separate products/dimensions use distinct assignments or objects.                                                                                                |
| Acoustical ceiling 2x2 / 2x4 grid | Tile area, separate 2 ft/4 ft tee counts, main runner stock counts, wall angle stock counts  | Area/perimeter factors; no placed grid, border cuts or hangers.                                                                                                  |

These are editable estimating templates, not a complete company catalog. The framework supports additional trades through project or global definitions. Component systems, authored wall/opening relationships, highlighted detail snippets, and review tools are available as described below. Construction details remain explicit project inputs.

## Acoustical ceiling grid estimates

Import **Acoustical ceiling 2x2 grid estimate** or **Acoustical ceiling 2x4 grid estimate** from the global library. Use **Add missing starters** if a previously saved library does not contain them. Keep the area-only starter for work that needs finish quantities alone; do not assign it alongside the grid starter for the same tile scope.

Each grid starter returns five separate material outputs. With the default 4 ft main spacing, 2 ft cross-tee spacing, and 12 ft main/angle stock:

| Output                    | Estimating basis before waste and rounding                                          |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Ceiling tile area         | Measured area minus `tileDeduction`                                                 |
| 2 ft tees, 2x2 system     | Grid area / 8 SF, plus `extraTwoFootTees`                                           |
| 2 ft tees, 2x4 system     | `extraTwoFootTees` only; default zero                                               |
| 4 ft tees, either system  | Grid area / 8 SF                                                                    |
| Main runner stock lengths | Grid area / 4 ft main spacing / 12 ft stock length                                  |
| Wall angle stock lengths  | (Measured perimeter + `extraWallAngle` − `wallAngleDeduction`) / 12 ft stock length |

Grid area is measured area minus `gridDeduction`. Tile and grid deductions are separate totals: a light replacing a tile need not remove its supporting grid. If a ceiling area is omitted entirely, enter it in both deductions. Perimeter adjustments are explicit because an area deduction cannot identify the edges that need wall angle. Adjacent polygons are counted independently, so exclude shared edges when they do not receive angle.

The area factors are derived from the repeating 4-by-2-foot module. The [Armstrong installation guide](https://www.armstrongceilings.com/content/dam/armstrongceilings/commercial/north-america/technical-guides/installing-suspended-ceilings-guide.pdf) describes the main/cross-tee system and separately treats borders and offcuts. These formulas are our estimating model, not the manufacturer's room-layout calculation. Small rooms, narrow corridors and intricate borders need appropriate adjustments/waste or a future layout takeoff. Hangers, seismic accessories, perimeter clips and fixture supports are not included.

All four grid outputs use `ea`. Their default package size is one, so fractional estimates sum across rooms in an assignment, then waste is added, then quantities round to whole stock pieces. Set each output's waste and actual carton quantity independently. For example, two 360 SF rooms need an estimated 15 main lengths before waste, rather than rounding each room's 7.5 to eight. Estimates are in material quantities/CSV; they are not placed pieces and do not appear in the cut schedule.

`mainStockLength` and `wallAngleStockLength` are editable. Choose a distinct material ID for each purchased product, including its stock length, profile and finish. If using a different stock length, change the material ID to match; use separate assemblies/assignments for distinct stock products rather than mixing them through object overrides. Existing project copies are never automatically changed to a newer starter.

Test examples cover both systems on a 24 × 15 ft room: 360 SF tile, 45 four-foot tees, eight 12-foot mains and seven 12-foot angles; the 2x2 system also has 45 two-foot tees. Deducting 40 SF of tile leaves the grid unchanged. Deducting the same area from the grid yields 40 of each tee and seven mains. Tests also cover added two-foot tees, angle additions/deductions, ten-foot angle stock, per-room overrides, multi-room/carton rounding, independent waste, millimetre calibration, an L-shaped room, zero remaining quantities, invalid deductions/stock lengths, saved-library upgrades, CSV exports and reopening the native project.

## CLI and compatibility

`commands.list` supplies schemas and examples. New commands:

- `assembly.put`, `assembly.delete`: project definitions. Existing `recipe.put` and `recipe.delete` remain compatible aliases. Project inspection retains the `recipes` collection and assignment `recipeId` to preserve existing scripts.
- `assembly.import`: `{ "libraryId": "drywall-face", "id": "project-board" }`. Requires the active project identity/revision and rejects an existing project assembly ID.
- `library.inspect`: returns `version`, `revision`, and `assemblies`; works without an open project.
- `library.put`: `{ "assembly": { ... }, "expectedLibraryRevision": 0 }`.
- `library.addStarters`: `{ "expectedLibraryRevision": 0 }`. Add missing starters (including deleted ones), preserving existing definitions; no revision change if nothing is missing.
- `library.delete`: `{ "id": "library-id", "expectedLibraryRevision": 1 }`.
- `pieces.inspect`, `pieces.export`: required-piece rows; export accepts `format: "csv"` or `"json"`.

All parameters go in the usual request `payload`. Library writes use their separate library revision and do not change the project revision. A stale library write fails without overwriting the accepted library. Refresh and review before retrying.

`assignment.put` accepts optional `geometryInputs`, a map from member geometry IDs to input overrides. Replacing an assignment is a complete-record write. Nonmember overrides are rejected. Removing a member or deleting geometry removes its overrides in the same undoable edit. Duplicating a group copies its assignments and overrides while retaining the geometry references.

Formats 1 and 2 remain readable. Formula-only edits use format 2; component systems, wall templates, construction, and review records require format 3. The first desktop save upgrading an older project to format 3 automatically creates a sibling backup before the atomic save. `project.backup` creates an additional recovery copy, optionally at an explicit new path, and never overwrites a file. Older apps cannot open format 3; use the pre-upgrade backup to return to them. The SQLite table layout is unchanged. Global library files retain their separate version 1 format and atomic replacement at the native app data directory's `data/assemblies.json`; browser development uses local storage. Nothing is synchronized between devices.

Native bridge version 4 supplies generic database backups, immutable temporary file snapshots, and bounded file/BLOB transfers, alongside the existing app-data operations. Current web releases require bridge 4.

## Component systems and wall templates

Project and global libraries can hold a system whose `components` contain copied assembly definitions. Each component has a stable `id`, an `assembly` snapshot, and `bindings` mapping component input names to shared system input names. Compatible numeric units convert when bound. Unbound inputs use component defaults; required missing inputs remain diagnostics. Systems have no direct outputs and cannot nest systems. Editing a source assembly or a global original does not update an existing component snapshot or project copy. System outputs use the ordinary assignment, per-object override, quantity, and piece-schedule paths.

A wall template is a separate assembly with `wallTemplate`, path geometry, and empty inputs/outputs. It supplies reusable dimensions, member specifications, finishes, and backing. It excludes instance IDs, geometry, level, top profile, and conditions. Apply it in Construction or with `wall.fromAssembly` using `assemblyId`, `geometryId`, `id`, and optional `height`. This copies the template specification into an independent authored wall; subsequent template edits do not update it. Reapplying to an existing wall retains its level, top profile, conditions, and openings. Supplying an explicit `height` removes the existing top profile so the height override takes effect. A new wall starts without those contextual relationships. Wall templates are not formula assignments or system components.

## Authored construction

Open **Construction** to select or create walls, openings, header details, levels, sheet placements, and ceilings. Structured fields edit dimensions, member specifications, conditions, finishes, and backing. **Preview quantities** shows calculated material changes without saving; save applies the edit through the shared command/Undo path. Missing heights and other unresolved inputs remain visible in diagnostics.

Construction lengths are metres, areas are square metres, and rotations are radians. World Z points upward. Drawing geometry and placement `pageOrigin` remain in unzoomed page coordinates; calibration, `worldOffset`, and placement rotation align the sheets. Level elevation and wall base elevation locate walls vertically. Choose Plan, 3D, or split view and filter by level, material, role, or selected geometry. Clicking a member selects its drawing source. Filters and selections change the view, not generated quantities or CSV scope.

Walls follow their path, spacing, offsets, and constant, sloped, or stepped top. Exact stud and jamb lengths use the local top less the explicitly entered `topAllowance` and `bottomAllowance`, both defaulting to zero. Channel flange envelopes do not deduct from stud cuts. End/corner/junction conditions replace regular studs at their station; shared conditions name `ownerWallId`. Multiple members need explicit `memberOffsets`, and multiple jambs need `jambOffsets`. The app does not infer shared framing or engineering from intersecting lines.

An opening's `distance` is its first rough edge along the wall, and `width` is the rough opening width. Nominal jamb centres lie half the rotated section width outside each rough edge. Positive jamb `along` offsets move farther into framing, mirrored on the two sides; face offsets follow the wall normal. Sill and height locate the rough head above the wall base. Each header component specifies its material/section, role, start/end extensions, vertical/face offsets, and optional section rotation. Its cut is rough width plus both extensions; its centreline offsets are relative to the rough head. Enter every component of a box header from its project detail. Header envelopes bound affected cripple cuts.

Members render as rectangular section envelopes, not fabricated metal profiles. Enter structural sizes, gauges, connections, and details from the project; the app does not design them. Bent and stepped tracks show centreline lengths but report unresolved joint/end-cut details. Such diagnostics leave schedules provisional and incomplete.

Finish surfaces subtract openings and account for product, face, layers, height, thickness, additional area deductions, waste, and packages. Quantities and 3D use the same generated pieces and surfaces; construction counts and finish areas appear in ordinary Quantities and its exports. Avoid assigning a formula estimate to duplicate the same construction scope. Ceiling 2x2/2x4 estimates above are unchanged: ceiling surfaces default to `quantityMode: "reference"`, rendering extent/elevation without adding tile quantities. Set `included` only when that surface should contribute area.

Construction generation shares a 50,000-piece/surface budget. Reaching it produces diagnostics and incomplete quantities. The scene separately caps display at 4,000 objects and shows the omitted count. Construction CSV includes all generated pieces, including those outside scene filters or its display cap; generation-budget omissions remain missing and incomplete.

## Snippets and review

Open **Review** to manage source status and saved plan/detail snippets. A snippet stores sheet/page bounds, source references, highlighted geometry IDs, annotations with page-coordinate points, labels/colors, and a note. Sources can reference geometry, walls, openings, assemblies, headers, or ceilings. PNG export retains sheet identity and coordinate mapping for locating the crop on its source page.

Mark a source `needs-review`, `question`, or `reviewed`. Reviewing saves a dependency fingerprint. Relevant changes to geometry, calibration, construction, level/placement, assignments, or linked snippets make the effective status `changed`; review again after resolving them. Review also lists unreviewed sources, while construction diagnostics identify unresolved inputs. Review status records estimator review, not engineering approval.

Use `wall.put`/`delete`, `opening.put`/`delete`, `header.put`/`delete`, `level.put`/`delete`, `placement.put`/`delete`, and `ceiling.put`/`delete` for full records. `construction.inspect`, `construction.export`, and `construction.render` expose derived results. `snippet.put`/`delete`/`render` and `review.mark`/`inspect` use the same records as the UI. See [CLI details](cli.md#detailed-takeoff).

## Validation and remaining examples to check

The dated results below describe the earlier assembly and ceiling work. Current detailed-takeoff checks and pending results are recorded separately in [the implementation report](detailed-takeoff.md). The new desktop workflow is `tests/desktop/detailed.py`; its existence is not a passing result.

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

Not established by these examples: correctness of your project's particular header details, a complete opening/junction framing takeoff, supplier stock optimization, ceiling layout/hanger quantities, very large-project interaction performance, or native Windows interaction for these new controls. Those need representative job examples as the relevant calculations are introduced.

## Local verification, September 24, 2026

- TypeScript, strict lint, formatting, and Rust formatting passed.
- 53 core tests, seven platform tests, and six Rust tests passed.
- All 20 development scenarios were checked across Chromium and WebKit. The initial combined run had 19 passes and one existing navigation scenario failed on a PDF.js fake-worker warning; its focused WebKit rerun passed without relaxing the assertion. After the final purchasing-rounding correction, assembly and takeoff development scenarios passed again in both browsers with their diagnostic checks.
- All 16 production browser scenarios passed against the final build. The assembly quantities and piece-schedule screenshot was visually inspected.
- The macOS app was rebuilt. Its included binaries passed `tests/native/smoke.py`, `tests/desktop/assemblies.py`, and `tests/desktop/workflow.py`. The last workflow included the 15-sheet Behavioral Health Group reference-plan import and rendering.
- The assembly native workflow additionally verifies that different cut lengths using the same stock share package rounding: 38 required studs plus 10% waste need three bundles of 20, while the required piece schedule remains unchanged.

Local native evidence is in `tmp/assembly-workflow/`, including `commands.json`, `pieces.csv`, and `assemblies.png`. Browser evidence is in `test-results/`. These ignored artifacts contain local test data and are not committed. Native Windows testing of the new library and editor remains outstanding.

## Ceiling addition verification, September 24, 2026

The ceiling addition passed TypeScript, lint and formatting, all 58 core tests, all seven platform tests, and all 22 development browser scenarios. Its ceiling and existing assembly workflows passed production Chromium and WebKit; all nine Chromium production scenarios passed. The production ceiling-quantity screenshot was visually checked.

The combined production run passed 12 of 18 scenarios. Six existing WebKit scenarios timed out while the host was under very high load (observed load average 105); some failed during browser-page setup. A single-worker rerun with unchanged timeouts passed the compact-workspace scenario, while the other existing scenarios continued timing out. These five broader WebKit scenarios remain unverified in this environment; the full `bun run verify` command did not pass. No product checks or assertions were relaxed.

The macOS app bundle built successfully. The native desktop/CLI assembly workflow passed against the new web build, including both ceiling systems, independent tile deductions, all four grid material outputs in CSV, saved-library starter additions and conflicts, and reopening the unchanged ceiling quantities. Ceiling CSV evidence is in `tmp/assembly-workflow/ceilings.csv`; the native command transcript is in `tmp/assembly-workflow/commands.json`.
