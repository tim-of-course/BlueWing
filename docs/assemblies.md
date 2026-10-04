# Assemblies

A project owns assembly definitions and their applications. Applications reference a group of measured traces and resolve project defaults, group overrides, and per-trace overrides. Editing a project definition updates inherited settings in its applications. The global library is a separate, device-local collection: importing creates an independent project copy, and later global edits do not change that copy.

Project changes use revision checks, atomic saving, preview, and Undo. Global library changes save separately and do not belong to project Undo.

## Calculated materials and estimates

Modeled assemblies generate installed members and surfaces. Their geometry is the source of their cut lengths and areas. The 3D view, required-piece schedule, ordinary Quantities, and exports use those same records. Every material object displayed in 3D contributes a calculation source. There are no reference-only material surfaces.

Purchasing is downstream of installed material. Waste, whole-piece rounding, and packages change orders without creating extra installed objects. A member consumes one stock piece; multiple cuts from one stock piece and offcut reuse are not optimized. A layered finish contributes its geometric area multiplied by the entered layer count. Drywall, FRP, and sheathing require accurate installed area, not individual board orientation or seams.

Formula estimates remain useful when placement has not been entered. They report quantities and optional unpositioned cut schedules, but create no 3D material objects. `quantities.inspect` identifies outputs as `modeled`, `estimate`, or `unresolved`, and reports `coverage` separately from calculation validity. A valid estimate can have incomplete model coverage. Missing inputs or impossible dimensions leave the calculation incomplete with diagnostics.

Replacing an estimate assignment with a modeled assembly replaces that assignment's contribution. Do not add a second assignment for the same scope unless both contributions are intended. A trace can legitimately supply several scopes, such as framing and a separate finish.

## Desktop use

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

The catalog contains 29 starters, including 17 new modeled options. Existing explicitly named estimates remain available for incomplete layout information. **Add missing starters** adds the new definitions to an existing library without replacing company edits or changing project copies.

## Standalone material layouts

`materialTemplate` has three kinds. They emit the same material records used by walls and ceilings; there is no separate visualization formula. All physical settings use metres or square metres internally, with radians for rotation. The desktop editor displays feet/metres and degrees.

- `path-surface`: a path defines the actual horizontal width and direction. `elevation` is the bottom, `height` must be entered before quantities resolve, and `offset` moves the back face left of the directed world-space trace. Thickness extends from that face; layers multiply both installed area and thickness. `openings` are located rectangles with `distance`, `width`, `sill`, and `height`. Overlapping openings subtract their union. Out-of-bounds openings leave diagnostics. No unlocated area deductions are allowed.
- `path-members`: each component produces a member along each path segment. `elevation` and optional `endElevation` define endpoint centrelines, interpolated along plan length. Component vertical/face offsets place the section. End extensions follow the true 3D axis at the outer path ends. Internal bends create separate pieces without automatic joint details. `sectionRotation` rotates the rectangular section about its member axis.
- `area-members`: `spacing`, world XY `origin`, and `rotation` locate parallel centrelines clipped to the traced polygon, including concave boundaries. A centreline exactly on a boundary is included once. `elevation` is the member centreline, so depth extends above and below it. Enter separate rim, bridging, perimeter, and connection scopes as needed.

Level elevation and sheet placement apply to all three. Group `materialOverrides` and per-trace `geometryDetails[geometryId].material` use the same inheritance as other modeled assemblies. Geometry is regenerated after edits; stock shortfalls remain visible and incomplete. Purchasing does not infer splices, sheet layouts, or reuse of offcuts.

For example, a 24 ft FRP trace at 8 ft high with a located 3 × 7 ft opening creates 171 ft² of surfaces and reports exactly 171 ft² installed. A kick with a 4 ft plan run and a 3 ft rise creates a 5 ft member before extensions. An 8 × 8 ft joist area at 2 ft spacing, with grid rows on both edges, generates five 8 ft members. Moving the origin can change that count in both the model and report.

## Ceiling layouts

`ceiling-grid-2x2` and `ceiling-grid-2x4` are modeled ceiling assemblies. Their `ceilingTemplate` defines tile material, layers, elevation, and a `grid` containing:

- `system`: `2x2` or `2x4`.
- `origin`: a world XY intersection of a main runner and a 4 ft cross-tee row.
- `rotation`: the main-runner direction, radians from world +X.
- `main`, `crossTee4`, optional `crossTee2`, and `wallAngle`: actual materials, section dimensions, stock lengths, waste, and package sizes.

The grid uses mains at 4 ft spacing and cross-tee rows at 2 ft spacing. It clips members and tile surfaces to the calibrated room polygon, including concave boundaries. Boundary edges receive wall angle; coincident grid lines do not add another perimeter member. Mains and angle split at their entered stock lengths. Border tee cuts retain their nominal 2 ft or 4 ft purchasing stock. Tile purchasing uses net installed area and an optional coverage-per-package value, not a count inferred from clipped surface fragments.

For an 8 × 8 ft square, with the origin at a corner and mains parallel to a side, both systems produce one 8 ft main, six 4 ft tees, four 8 ft angle pieces, and 64 ft² of tile. The 2x2 system also produces eight 2 ft tees. Moving or rotating the grid changes border cuts and can change piece counts. Those changes appear in both the model and material reports.

Ceiling elevation is its finished underside, added to any level and sheet placement elevation. Member envelopes extend upward from that datum. A specified tile thickness also extends upward; without thickness, its measured surface stays a plane. These are nominal flush lay-in envelopes, not inferred tegular details.

Starter elevation is 9 ft; starter grid origin is world 0,0 with mains along world X. Set them to match the plan. Section envelopes show entered dimensions rather than fabricated tee profiles or connector tabs. Hangers, seismic accessories, perimeter clips, fixture supports, and cut optimization are not inferred.

The `ceiling-grid-2x2-estimate` and `ceiling-grid-2x4-estimate` starters retain area/perimeter estimating for early work. With default 4 ft main spacing, 2 ft cross-tee spacing, and 12 ft main/angle stock, a 24 × 15 ft room produces 360 ft² of tile, 45 four-foot tees, eight main stock lengths, and seven angle stock lengths. The 2x2 estimate adds 45 two-foot tees. Tile and grid deductions are separate inputs. These are estimates, not the piece counts of a positioned layout.

## Walls, finishes, and headers

A wall assembly's `wallTemplate` supplies dimensions, member specifications, finishes, and backing. It uses path geometry and empty formula inputs/outputs. Openings, header details, levels, and sheet placements are project context. Resolved wall and ceiling applications are derived, never persisted as a second editable copy of their definitions.

`wall.fromAssembly` applies a live project definition using `assemblyId`, `geometryId`, `id`, and optional local `height`. `ceiling.fromAssembly` does the same for an area trace. Reapplying a wall preserves its level, top profile, conditions, and openings; an explicit height removes the old top profile. `wall.put`/`ceiling.put` create a local definition and application for a new item, or record the changed local settings for an existing application. `wall.reset`/`ceiling.reset` clear per-trace material overrides so inherited settings apply again.

Construction lengths use metres, areas use square metres, and rotations use radians. World Z points upward. Drawing coordinates and placement `pageOrigin` remain in page coordinates. Calibration, placement `worldOffset`, and rotation align sheets. Wall base elevation plus level elevation locate the wall vertically; sheet placement may add a world Z offset.

Stud and jamb cuts use the local flat, sloped, or stepped top, less entered top/bottom allowances. Channel flange envelopes do not impose a cut deduction. End/corner/junction conditions replace regular studs at their station; shared conditions name `ownerWallId`. Multiple members require explicit offsets. The app does not infer connection design from intersecting traces.

An opening's `distance` locates its first rough edge, and `width` is its rough width. Jamb centres sit half the rotated section width outside those edges. Sill plus opening height locates the rough head above the wall base. Each header component has a material/section, role, start/end extensions, vertical/face offsets, and optional section rotation. Its cut is rough width plus both extensions; its centreline elevation is rough head plus vertical offset. Header envelopes clip affected cripple cuts. Enter each box-header component from its project detail.

Import **Steel box header** into the project, then choose it under **Construction → Header details → Use header assembly** to populate an editable project detail. The CLI equivalent is `header.fromAssembly` with `assemblyId`, `id`, and optional `name`. Assign that detail's id to the opening's `headerId`. This copies component specifications and offsets, not the standalone header's path elevation, and does not add another material application. Later starter edits do not rewrite the copied detail. Avoid also assigning a standalone header trace for the same opening.

Finishes subtract located openings and honor product, face, layers, height, and thickness. Additional numeric area deductions are not allowed in modeled finishes: changing the reported area without changing its surface would break the model. Use an explicit formula estimate for unlocated adjustments until their geometry is known. Bent or stepped track joints retain unresolved joint/end-cut diagnostics; they do not become complete because a line can be drawn.

## Formula estimates and component systems

Formula variables are `length` for paths, `area` and `perimeter` for areas, `count` for count sets, and declared number/boolean inputs. Measurements carry dimensions; ordinary formula numbers are dimensionless. Outputs support length, area, item, and scalar units. Missing required inputs and incompatible dimensions remain visible diagnostics.

A piece estimate uses `ea`, a whole-number quantity formula, a role, and a positive cut-length formula. An optional stock-length formula must produce a length at least as long as the cut. Cut schedules exclude purchasing waste. Within an assignment/output, cuts sharing a stock length share package rounding; without stock length, distinct cuts round separately. This does not create positioned members.

A flat component system holds `components: [{id, assembly, bindings}]`. Each component is a copied formula definition; bindings connect component inputs to compatible shared system inputs and convert units. Unbound inputs use component defaults. Systems have no direct outputs and do not nest. Editing a source assembly does not rewrite a copied component, but editing the project system changes its own applications. Wall and ceiling templates are separate typed generators, not nested procedural systems.

## CLI and storage

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

Project format 4 is the only supported format. Older development takeoffs must be recreated; there is no migration. The global catalog uses version 2 in `data/assemblies-v2.json` on desktop and a separate browser namespace. It starts fresh without reading earlier catalog files. `project.backup` creates an explicitly requested copy without overwriting another file. Native bridge 5 supplies generic backups, bounded file/BLOB transfer, and Wingman attachment export.

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
