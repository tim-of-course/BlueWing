# Assemblies

A project owns assembly definitions and their applications. Applications reference a group of measured traces and resolve project defaults, group overrides, and per-trace overrides. Editing a project definition updates inherited settings in its applications. The global library is a separate, device-local collection: importing creates an independent project copy, and later global edits do not change that copy.

Project changes use revision checks, atomic saving, preview, and Undo. Global library changes save separately and do not belong to project Undo.

## Calculated materials and estimates

Modeled assemblies generate installed members and surfaces. Their geometry is the source of their cut lengths and areas. The 3D view, required-piece schedule, ordinary Quantities, and exports use those same records. Every material object displayed in 3D contributes a calculation source. There are no reference-only material surfaces.

Purchasing is downstream of installed material. Waste, whole-piece rounding, and packages change orders without creating extra installed objects. For modeled members with stock lengths, Bluewing pools cuts across assignments in the takeoff. Each order shares a scope category, material ID, stock length, direction, waste percent and package size. Cuts go longest first into the first stick with room. Waste applies to the packed stick count before rounding up to whole sticks or whole packages. Framing and ceiling starters use 5% waste. Wall coverings and batts order gross through openings at zero default waste. A layered finish contributes its geometric area multiplied by the entered layer count. Drywall, FRP, and sheathing require accurate installed area, not individual board orientation or seams.

For example, two wall types contribute top and bottom track cuts of 6, 6, 4 and 4 ft. Each 10 ft stick takes one 6 ft cut and one 4 ft cut. The order is 2 packed sticks × 1.05, rounded up to 3 sticks or 30 LF. The wall assignments still show 12 and 8 installed LF. To price a breakout separately, give it a distinct material ID or scope category. If the 4 ft wall has a separate category, the first order is 3 sticks and the second is 2 sticks (50 LF total).

Formula estimates remain useful when placement has not been entered. They report quantities and optional unpositioned cut schedules, but create no 3D material objects. `quantities.inspect` identifies outputs as `modeled`, `estimate`, or `unresolved`, and reports `coverage` separately from calculation validity. A valid estimate can have incomplete model coverage. Missing inputs or impossible dimensions leave the calculation incomplete with diagnostics.

Replacing an estimate assignment with a modeled assembly replaces that assignment's contribution. Do not add a second assignment for the same scope unless both contributions are intended. A trace can legitimately supply several scopes, such as framing and a separate finish.

## Desktop use

### Scope categories

Each assembly has one category covering all its outputs and generated objects.
Assign separate framing and drywall assemblies to the same trace to filter them
independently. A combined framing/drywall assembly remains one categorized scope;
studs and track in a framing assembly stay together. Component systems use the
applied system's category.

Standard scope colors are vivid for visibility over blueprints. Additional
category names and editable colors belong to the project; library copies retain
names without transferring project color preferences.

The standards are Light-gauge metal framing, Wood blocking/backing, Sheathing/FRP,
Moisture barriers, Drywall hang/finish, Acoustical ceilings/acoustical work, Demo,
and **Insulation**. Insulation uses vivid purple and includes fiberglass and
rockwool in framed walls, plus small gap-fill spray foam. Demo stays red.

Plan traces use category colors instead of group colors. Shared traces show
parallel strokes, one per distinct category. Uncategorized traces use a thick,
semitransparent hatched gray-blue stroke. The Categories control filters plan and
3D. Each 3D object follows its generating assembly, even when its source trace has
other scopes. Category filters never change geometry, quantities, or exports.

1. Open **Assemblies**, then **Global library**, choose a starter, and import it into the project. Alternatively create a project definition.
2. Set the actual products, dimensions, and detail reference. Give distinct products, gauges, or stock lengths distinct material identifiers.
3. For a modeled assembly, edit its material settings and apply it to a group or trace. **Material values** edits standalone finishes, member runs, and joist/furring layouts at group or individual-trace scope. Use **Construction** for framed wall openings, project headers, levels, sheet alignment, and local wall/ceiling details.
4. For an estimate, declare typed inputs, formulas, outputs, waste, and package sizes. **Input scope** switches between group values and individual trace values.
5. Inspect **Quantities** and the model coverage. Use Plan, 3D, or split view to inspect calculated material. Filters affect the view, not quantity totals or export scope.
6. Save a reusable project definition to the global library explicitly. **Add missing starters** restores absent built-in definitions and preserves existing definitions.

Input precedence is per-trace override, then group override, then project assembly default. Reset removes the relevant local override. Arrays such as finish faces replace the collection when overridden; nested member settings inherit individual fields. For CLI material overrides, `null` clears an optional inherited setting.

## Starter catalog

| Starter                                                                             | Result                                                                                | Limits                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Steel wall with drywall                                                             | Positioned studs, track, finish faces, and authored opening/header/backing details    | Enter height, actual sections, products, and project details. No inferred engineering.                                    |
| Steel framing wall                                                                  | The same wall generator without finishes                                              | Enter wall height and the specified framing.                                                                              |
| Steel track run / wood blocking pieces                                              | One positioned member per traced segment                                              | Trace actual joints/ends; oversize cuts are flagged rather than silently spliced.                                         |
| Steel box header                                                                    | Two stud sections and top/bottom track, each with its own cut and position            | Editable example, not a structural specification; can be copied into a project opening detail.                            |
| Steel kick brace                                                                    | Sloped members from the traced plan run and entered start/end elevations              | Cuts use the true 3D length. Connections are separate scope.                                                              |
| Steel joist / ceiling furring layout                                                | Parallel members clipped to the area boundary                                         | Enter direction, origin, spacing and centreline elevation; border members and connections are separate scope.             |
| Acoustical ceiling 2x2 / 2x4 layout                                                 | Positioned mains, 4 ft tees, 2 ft tees for 2x2, wall angle, and clipped tile surfaces | Explicit origin, direction, elevation, and member specifications. No hangers or connection hardware.                      |
| Acoustical ceiling tile area                                                        | Modeled tile-only coverage without a grid                                             | Enter carton coverage; no inferred panel cuts or mounting hardware.                                                       |
| FRP / acoustical wall panel / drywall wall finish                                   | Standalone surfaces from paths, heights, layers, thickness and located openings       | No hidden framing. Trace individual acoustic panels for gaps; quantities are installed area and entered package coverage. |
| Plywood backing strip / plywood or gypsum wall sheathing / cement board wall finish | Standalone sheet-material surfaces                                                    | Set mounting elevation, height, product and thickness; no sheet-cut optimization.                                         |
| Drywall ceiling finish / plywood horizontal sheathing                               | Modeled surfaces following the traced area                                            | Enter underside elevation, thickness and layers. Framing is separate scope.                                               |
| Drywall wall face / FRP wall sheathing                                              | Estimated `(length × height − deduction) × layers`                                    | Unmodeled area; deduction is area per layer.                                                                              |
| Steel studs, straight run                                                           | Estimated spacing count and cuts from height less allowance                           | Unmodeled uninterrupted run; no positioned openings, corners, or junctions.                                               |
| Header component schedule                                                           | Estimated count × components and width plus extensions                                | Project detail supplies dimensions; no positioned header.                                                                 |
| Acoustical ceiling area / grid estimate                                             | Estimated tile area, perimeter, and grid factors                                      | Unmodeled; separate from the layout starters.                                                                             |
| Blocking / backing runs                                                             | Estimated length × rows                                                               | No inferred placement. Positioned backing can instead be included in a wall assembly.                                     |
| Acoustical wall panels                                                              | Estimated count and coverage from dimensions                                          | No inferred panel placement.                                                                                              |

These are editable starters, not a complete company catalog. Required heights and other project details must come from the plans. Starter sections and ceiling elevation are examples to replace with the specified values.

The catalog contains 30 starters, including 17 new modeled options. Existing explicitly named estimates remain available for incomplete layout information. **Add missing starters** adds the new definitions to an existing library without replacing company edits or changing project copies.

**Danback backing** orders pieces one stud bay long (16 in by default). Each traced run rounds up to whole pieces. The total for each size takes 10% waste and rounds up to whole pieces again. EstiMaker receives the ordered count, piece length and purchased LF. Use **Wood blocking pieces** for material cut from longer stock.

## Standalone material layouts

`materialTemplate` has three kinds. They emit the same material records used by walls and ceilings; there is no separate visualization formula. All physical settings use feet or square feet internally, with radians for rotation. The desktop editor shows lengths in feet and inches and angles in degrees.

- `path-surface`: a path defines the actual horizontal width and direction. `elevation` is the bottom, `height` must be entered before quantities resolve, and `offset` moves the back face left of the directed world-space trace. Thickness extends from that face; layers multiply both installed area and thickness. Wall openings on the trace apply automatically. The surface can also have local `openings` with `distance`, `width`, `sill` above the surface bottom, and `height`. Overlapping rectangles remove their union. A local opening beyond the trace length raises a diagnostic.
- `path-members`: each component produces a member along each path segment. `elevation` and optional `endElevation` define endpoint centrelines, interpolated along plan length. Component vertical/face offsets place the section. End extensions follow the true 3D axis at the outer path ends. Internal bends create separate pieces without automatic joint details. `sectionRotation` rotates the rectangular section about its member axis.
- `area-members`: `spacing`, world XY `origin`, and `rotation` locate parallel centrelines clipped to the traced polygon, including concave boundaries. A centreline exactly on a boundary is included once. `elevation` is the member centreline, so depth extends above and below it. Enter separate rim, bridging, perimeter, and connection scopes as needed.

Level elevation and sheet placement apply to all three. Group `materialOverrides` and per-trace `geometryDetails[geometryId].material` use the same inheritance as other modeled assemblies. Geometry is regenerated after edits; stock shortfalls remain visible and incomplete. Purchasing reuses member offcuts within each stock order. Splices and sheet layouts require separate detailing.

For example, a 24 ft FRP trace at 8 ft high with a located 3 × 7 ft opening creates 171 ft² of surfaces and reports exactly 171 ft² installed. A kick with a 4 ft plan run and a 3 ft rise creates a 5 ft member before extensions. An 8 × 8 ft joist area at 2 ft spacing, with grid rows on both edges, generates five 8 ft members. Moving the origin can change that count in both the model and report.

## Ceiling layouts

`ceiling-grid-2x2` and `ceiling-grid-2x4` are modeled ceiling assemblies. Their `ceilingTemplate` defines tile material, layers, elevation, and a `grid` containing:

- `system`: `2x2` or `2x4`.
- `origin`: a world XY intersection of a main runner and a 4 ft cross-tee row.
- `rotation`: the main-runner direction, radians from world +X.
- `main`, `crossTee4`, optional `crossTee2`, and `wallAngle`: actual materials, section dimensions, stock lengths, waste, and package sizes.

The grid uses mains at 4 ft spacing and cross-tee rows at 2 ft spacing. It clips members and tile surfaces to the calibrated room polygon, including concave boundaries. Boundary edges receive wall angle; coincident grid lines do not add another perimeter member. Mains and angle split at their entered stock lengths. Border tee cuts retain their nominal 2 ft or 4 ft purchasing stock. Tile purchasing uses net installed area and an optional coverage-per-package value, not a count inferred from clipped surface fragments.

For an 8 × 8 ft square, with the origin at a corner and mains parallel to a side, both systems produce one 8 ft main, six 4 ft tees, four 8 ft angle pieces, and 64 ft² of tile. The 2x2 system also produces eight 2 ft tees. At 5% waste, the order is two 12 ft mains (24 LF), seven 4 ft tees (28 LF), five 12 ft angles (60 LF) and 67.2 ft² of tile before any carton rounding. The 2x2 layout also orders nine 2 ft tees (18 LF). Moving or rotating the grid changes border cuts and can change piece counts. Those changes appear in both the model and material reports.

Ceiling elevation is its finished underside, added to any level and sheet placement elevation. Member envelopes extend upward from that datum. A specified tile thickness also extends upward; without thickness, its measured surface stays a plane. These are nominal flush lay-in envelopes, not inferred tegular details.

Starter elevation is 9 ft; starter grid origin is world 0,0 with mains along world X. Set them to match the plan. Section envelopes show entered dimensions rather than fabricated tee profiles or connector tabs. Seismic accessories, perimeter clips and fixture supports require project details.

Every acoustical ceiling starter that includes grid also includes a 12 gauge hanger wire count; the tile-only starter does not. Each room rounds up to one drop per 16 SF of traced area. A 6 ft drop plus 1 ft 6 in for ties yields one cut per 12 ft wire. Entering a 3 ft drop yields two cuts per wire. Round each room up to whole wires before totaling, with zero waste. The model positions grid members and tiles. Its wire count is an area estimate.

The `ceiling-grid-2x2-estimate` and `ceiling-grid-2x4-estimate` starters retain area/perimeter estimating for early work. With default 4 ft main spacing, 2 ft cross-tee spacing, and 12 ft main/angle stock, a 24 × 15 ft room produces 360 ft² of tile, 45 four-foot tees, eight main stock lengths, and seven angle stock lengths. The 2x2 estimate adds 45 two-foot tees. Tile and grid deductions are separate inputs. These are estimates, not the piece counts of a positioned layout.

## Walls, finishes, and headers

A wall assembly's `wallTemplate` supplies dimensions, member specifications, finishes, and backing. It uses path geometry and empty formula inputs/outputs. Openings, header details, levels, and sheet placements are project context. Resolved wall and ceiling applications are derived, never persisted as a second editable copy of their definitions.

`wall.fromAssembly` applies a live project definition using `assemblyId`, `geometryId`, `id`, and optional local `height`. `ceiling.fromAssembly` does the same for an area trace. Reapplying a wall preserves its level, top profile, conditions, and openings; an explicit height removes the old top profile. `wall.put`/`ceiling.put` create a local definition and application for a new item, or record the changed local settings for an existing application. `wall.reset`/`ceiling.reset` clear per-trace material overrides so inherited settings apply again.

Construction lengths use feet, areas use square feet, and rotations use radians. World Z points upward. Drawing coordinates and placement `pageOrigin` remain in page coordinates. Calibration, placement `worldOffset`, and rotation align sheets. Wall base elevation plus level elevation locate the wall vertically; sheet placement may add a world Z offset.

To price high drywall separately on one face of a 10 ft long, 14 ft high wall, give the lower finish the material ID `board-A` and set `height` to 10 ft. Give the upper finish the material ID `board-B-above-10ft`, set `startHeight` to 10 ft, and leave `height` blank so it follows the wall top. One layer gives two installed lines of 100 SF and 40 SF. A 3 × 7 ft door at the base reduces the lower line to 79 SF and leaves the upper line at 40 SF.

Stud and jamb cuts use the local flat, sloped, or stepped top, less entered top/bottom allowances. Channel flange envelopes do not impose a cut deduction. End/corner/junction conditions replace regular studs at their station; shared conditions name `ownerWallId`. Multiple members require explicit offsets. The app does not infer connection design from intersecting traces.

The two steel wall starters use 3-5/8 in 20EQ studs at 16 in on center and 10 ft track. For each wall, choose the shortest standard stud stock that covers its tallest actual stud, jamb or cripple cut after framing allowances. Standard lengths are 8, 9, 10, 12, 14, 16, 18 and 20 ft. Use that stock for the wall's stud cuts so the order can reuse offcuts. An explicitly entered stock length wins. A cut over 20 ft flags a stock shortfall until the estimator enters suitable stock. Vertical wall board selects the shortest available sheet at its width that covers the finish. Horizontal board uses the chosen sheet (default 4 by 12 ft) and rounds height up to a whole foot. Ceiling board orders by area at its chosen sheet size. Batts order to whole-foot heights and round to bags.

Enable **Kickers** on a steel wall when specified. Enter the cut length and spacing (6 ft by default). Each wall rounds its length divided by spacing up to whole kickers. They rise at 45 degrees from the wall top. The default member is a 3-5/8 in 20EQ stud with its own material ID and 5% modeled waste. For repeated equal cuts, choose the standard stud stock with the smallest leftover fraction, breaking ties toward shorter stock. A 6 ft cut uses 12 ft stock and a 3 ft cut uses 9 ft stock. An entered kicker stock length overrides the selection.

An opening's `distance` locates its first rough edge, and `width` is its rough width. Jamb centres sit half the rotated section width outside those edges. Sill plus opening height locates the rough head above the wall base. Each header component has a material/section, role, start/end extensions, vertical/face offsets, and optional section rotation. Its cut is rough width plus both extensions; its centreline elevation is rough head plus vertical offset. Header envelopes clip affected cripple cuts. Enter each box-header component from its project detail.

Import **Steel box header** into the project, then choose it under **Construction → Header details → Use header assembly** to populate an editable project detail. The CLI equivalent is `header.fromAssembly` with `assemblyId`, `id`, and optional `name`. Assign that detail's id to the opening's `headerId`. This copies component specifications and offsets, not the standalone header's path elevation, and does not add another material application. Later starter edits do not rewrite the copied detail. Avoid also assigning a standalone header trace for the same opening.

Enter a rough opening once on its framing application. Every modeled finish face and cavity insulation surface on that trace loses the intersecting area, across assemblies and groups. A 3 × 7 ft door deducts 21 ft² per full-height face and 12 ft² from a 4 ft wainscot starting at the sill. The deduction applies before multiplying by layers. An opening copied onto a second application removes the shared area once. Formula estimates use their own inputs for unlocated deductions. Bent or stepped track joints retain unresolved joint/end-cut diagnostics; they do not become complete because a line can be drawn.

## Formula estimates and component systems

Formula variables are `length` for paths, `area` and `perimeter` for areas, `count` for count sets, and declared number/boolean inputs. Measurements carry dimensions; ordinary formula numbers are dimensionless. Outputs support length, area, item, and scalar units. Missing required inputs and incompatible dimensions remain visible diagnostics.

A piece estimate uses `ea`, a whole-number quantity formula, a role, and a positive cut-length formula. An optional stock-length formula must produce a length at least as long as the cut. Cut schedules exclude purchasing waste. Matching material requirements across the takeoff share package and piece rounding. Distinct stock or cut lengths stay separate. This does not create positioned members.

A flat component system holds `components: [{id, assembly, bindings}]`. Each component is a copied formula definition; bindings connect component inputs to compatible shared system inputs and convert units. Unbound inputs use component defaults. Systems have no direct outputs and do not nest. Editing a source assembly does not rewrite a copied component, but editing the project system changes its own applications. Wall and ceiling templates are separate typed generators, not nested procedural systems.

## CLI and storage

`quantities.inspect` and quantity JSON list each stock order once in `outputs`. `baseAmount` counts installed cuts, `installedByAssignment` gives installed count and length for each assignment, and `sources` identifies individual pieces. `packedCount`, `wastePercent`, `adjustedAmount`, `purchasedAmount`, `stockLength` and `purchasedLength` describe the order. Quantity CSV carries the same stock figures and installed assignment breakdown. Piece schedules and their exports distinguish installed rows from `stock-purchase` rows. Construction JSON lists `purchases`, and each construction CSV schedule includes one row per stock order. Construction and piece schedule lengths are feet. The quantity report and EstiMaker give purchased footage in feet.

Use `bluewing help <command>` or `commands.list` for complete schemas. Commands use the usual `payload` envelope; project mutations also require the observed `projectId` and `expectedRevision`.

| Commands                                                                     | Purpose                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assembly.put`, `assembly.delete`, `assembly.import`                         | Edit project definitions or import an independent global copy. The existing `recipe` command names remain aliases.                                                 |
| `assignment.put`                                                             | Apply an assembly to a group. Supports formula `geometryInputs`, material `wallOverrides`/`ceilingOverrides`/`materialOverrides`, and per-trace `geometryDetails`. |
| `header.fromAssembly`                                                        | Copy member-run components into an independent opening header detail.                                                                                              |
| `wall.fromAssembly`, `ceiling.fromAssembly`                                  | Apply a live project definition to one trace.                                                                                                                      |
| `wall.put`, `ceiling.put`, matching `.reset`/`.delete`                       | Edit, reset local overrides, or remove an application.                                                                                                             |
| `construction.inspect`                                                       | Return resolved `applications`, calculated pieces/surfaces, purchases, and diagnostics.                                                                            |
| `construction.export`, `construction.render`                                 | Export schedules or a bounded 3D PNG from calculated materials.                                                                                                    |
| `quantities.inspect`, `quantities.export`, `pieces.inspect`, `pieces.export` | Inspect/export material quantities and required-piece schedules, including unmodeled estimates.                                                                    |
| `library.inspect`, `library.put`, `library.delete`, `library.addStarters`    | Manage the separate global library using `expectedLibraryRevision` for writes.                                                                                     |

`assignment.put` replaces a complete assignment. Geometry overrides must reference group members. Removing a member or geometry removes its overrides in the same undoable edit. Duplicating a group copies assignments and overrides while retaining geometry references.

**Duplicate** and `geometry.copy` add another trace to every group the original belongs to. Each compatible assignment gains one contribution with the same category, direction and per-trace settings. The copy has its own modeled applications, openings and header details. On a calibrated sheet, an offset copy also moves the room’s ceiling or joist grid origin by the same world-space distance. The CLI returns `geometry` and the lists `groupIds`, `assignmentIds`, `applicationIds`, `openingIds`, `headerIds` and `conditionIds`. Group and assignment IDs identify existing records. Undo removes the duplicate and its details together.

A copied junction keeps its shared members when the owning wall application is also on the duplicated trace. When another trace owns the members, the copy leaves that junction behind and frames the station as a free-standing wall would: an ordinary stud at a wall end, or the regular spacing elsewhere. The original owner continues to supply the original's members.

Project format 10 is the only supported format. Older development takeoffs must be recreated; there is no migration. The global catalog uses version 5 in `data/assemblies-v5.json` on desktop and a separate browser namespace. It starts fresh without reading earlier catalog files. `project.backup` creates an explicitly requested copy without overwriting another file. Native bridge 7 supplies generic backups, bounded file/BLOB transfer, and Wingman attachment export.

## Review and verification

Review snippets retain source references, page bounds, geometry highlights, annotations, and notes. A reviewed source records a dependency fingerprint; relevant changes make its effective status `changed`. Review is estimator status, not engineering approval. See [CLI commands](cli.md#detailed-takeoff).

Generation has a shared 50,000-piece/surface budget and reports incomplete calculations when exhausted. The Three.js viewer displays all generated objects matching its filters. Exports retain all generated records, including objects hidden by scene filters; they cannot recover generation-budget omissions.

The current checks and remaining verification are recorded in [Detailed takeoff](detailed-takeoff.md). Test scripts and historical passes alone do not establish that the new implementation passed. Representative job sections still need comparison with manually checked dimensions, counts, and project-specific details.

### Modeled catalog verification, October 4, 2026

The 17 additional starters and standalone material layouts passed:

- Type checking, ESLint, formatting, production build, and all 177 core tests.
- Twelve development browser cases across Chromium and WebKit, including Solid diagnostics for a live finish-height edit. The final new-material rerun passed both browsers after correcting test locators and reopening the Quantities panel; earlier development reloads interrupted two cases while code was being edited.
- Fourteen production browser cases across Chromium and WebKit, covering assemblies, ceiling layouts, the new finish/header workflow, persistence, detailed takeoff, review, component systems and failed-import cleanup.
- `python3 tests/desktop/assemblies.py` through the guarded native app and real CLI. It checked installed FRP area of 171 ft², acoustic treatment of 96 ft², a 5 ft kick, five 8 ft joists, four 6 ft header components, independent header detail copying, exact model/source correspondence, 3D capture, and unchanged results after closing/reopening.

The new core cases cover all 17 starters, opening union deductions, layers/thickness, rotated and concave joist boundaries, true-axis brace extensions, stock shortfalls, missing heights/calibration, shared generation limits, group/per-trace inheritance, invalid overrides on empty groups, copy/delete/Undo, level-dependent review changes, and library restoration without replacing company edits. Every retained generated object is checked against its quantity source; waste and packages change purchasing without changing installed geometry.

Heavy checks ran sequentially with the resource guard enabled and one browser worker. macOS warning pressure occurred and the updated guard allowed the jobs to complete. No Rust code changed; native verification used the current debug shell with the fresh production web assets. Release installers and Windows native checks were not rerun for this catalog change.

In the assembly editor, choose **Global library → Standard sizes** to edit company sizes for new projects. **Project assemblies → Standard sizes** edits the independent job copy. The CLI exposes `library.sizes.inspect`, `library.sizes.put`, `project.sizes.inspect` and `project.sizes.put`. Library edits use the observed library revision. Project edits use project history.

Automatic stud stock can become a special order when a single wall-type assignment reaches the job table’s minimum at one cut length of at least 7 ft. Lengths match to 1/16 inch. Explicit stock overrides take precedence. **Allow special-order studs for this job** is on by default in Project assemblies. The CLI setting is `project.specialOrderStuds.put` with `{enabled:false}` for a quick-turnaround job.
