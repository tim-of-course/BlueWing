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
3. For a wall or ceiling assembly, edit its material settings and apply it to a group or trace. Use **Construction** for openings, project headers, levels, sheet alignment, and local application details.
4. For an estimate, declare typed inputs, formulas, outputs, waste, and package sizes. **Input scope** switches between group values and individual trace values.
5. Inspect **Quantities** and the model coverage. Use Plan, 3D, or split view to inspect calculated material. Filters affect the view, not quantity totals or export scope.
6. Save a reusable project definition to the global library explicitly. **Add missing starters** restores absent built-in definitions and preserves existing definitions.

Input precedence is per-trace override, then group override, then project assembly default. Reset removes the relevant local override. Arrays such as finish faces replace the collection when overridden; nested member settings inherit individual fields. For CLI material overrides, `null` clears an optional inherited setting.

## Starter catalog

| Starter                                 | Result                                                                                | Limits                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Steel wall with drywall                 | Positioned studs, track, finish faces, and authored opening/header/backing details    | Enter height, actual sections, products, and project details. No inferred engineering.               |
| Acoustical ceiling 2x2 / 2x4 layout     | Positioned mains, 4 ft tees, 2 ft tees for 2x2, wall angle, and clipped tile surfaces | Explicit origin, direction, elevation, and member specifications. No hangers or connection hardware. |
| Drywall wall face / FRP wall sheathing  | Estimated `(length × height − deduction) × layers`                                    | Unmodeled area; deduction is area per layer.                                                         |
| Steel studs, straight run               | Estimated spacing count and cuts from height less allowance                           | Unmodeled uninterrupted run; no positioned openings, corners, or junctions.                          |
| Header component schedule               | Estimated count × components and width plus extensions                                | Project detail supplies dimensions; no positioned header.                                            |
| Acoustical ceiling area / grid estimate | Estimated tile area, perimeter, and grid factors                                      | Unmodeled; separate from the layout starters.                                                        |
| Blocking / backing runs                 | Estimated length × rows                                                               | No inferred placement. Positioned backing can instead be included in a wall assembly.                |
| Acoustical wall panels                  | Estimated count and coverage from dimensions                                          | No inferred panel placement.                                                                         |

These are editable starters, not a complete company catalog. Required heights and other project details must come from the plans. Starter sections and ceiling elevation are examples to replace with the specified values.

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

Finishes subtract located openings and honor product, face, layers, height, and thickness. Additional numeric area deductions are not allowed in modeled finishes: changing the reported area without changing its surface would break the model. Use an explicit formula estimate for unlocated adjustments until their geometry is known. Bent or stepped track joints retain unresolved joint/end-cut diagnostics; they do not become complete because a line can be drawn.

## Formula estimates and component systems

Formula variables are `length` for paths, `area` and `perimeter` for areas, `count` for count sets, and declared number/boolean inputs. Measurements carry dimensions; ordinary formula numbers are dimensionless. Outputs support length, area, item, and scalar units. Missing required inputs and incompatible dimensions remain visible diagnostics.

A piece estimate uses `ea`, a whole-number quantity formula, a role, and a positive cut-length formula. An optional stock-length formula must produce a length at least as long as the cut. Cut schedules exclude purchasing waste. Within an assignment/output, cuts sharing a stock length share package rounding; without stock length, distinct cuts round separately. This does not create positioned members.

A flat component system holds `components: [{id, assembly, bindings}]`. Each component is a copied formula definition; bindings connect component inputs to compatible shared system inputs and convert units. Unbound inputs use component defaults. Systems have no direct outputs and do not nest. Editing a source assembly does not rewrite a copied component, but editing the project system changes its own applications. Wall and ceiling templates are separate typed generators, not nested procedural systems.

## CLI and storage

Use `bluewing help <command>` or `commands.list` for complete schemas. Commands use the usual `payload` envelope; project mutations also require the observed `projectId` and `expectedRevision`.

| Commands                                                                     | Purpose                                                                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `assembly.put`, `assembly.delete`, `assembly.import`                         | Edit project definitions or import an independent global copy. The existing `recipe` command names remain aliases.                             |
| `assignment.put`                                                             | Apply an assembly to a group. Supports formula `geometryInputs`, material `wallOverrides`/`ceilingOverrides`, and per-trace `geometryDetails`. |
| `wall.fromAssembly`, `ceiling.fromAssembly`                                  | Apply a live project definition to one trace.                                                                                                  |
| `wall.put`, `ceiling.put`, matching `.reset`/`.delete`                       | Edit, reset local overrides, or remove an application.                                                                                         |
| `construction.inspect`                                                       | Return resolved `applications`, calculated pieces/surfaces, purchases, and diagnostics.                                                        |
| `construction.export`, `construction.render`                                 | Export schedules or a bounded 3D PNG from calculated materials.                                                                                |
| `quantities.inspect`, `quantities.export`, `pieces.inspect`, `pieces.export` | Inspect/export material quantities and required-piece schedules, including unmodeled estimates.                                                |
| `library.inspect`, `library.put`, `library.delete`, `library.addStarters`    | Manage the separate global library using `expectedLibraryRevision` for writes.                                                                 |

`assignment.put` replaces a complete assignment. Geometry overrides must reference group members. Removing a member or geometry removes its overrides in the same undoable edit. Duplicating a group copies assignments and overrides while retaining geometry references.

Project format 4 is the only supported format. Older development takeoffs must be recreated; there is no migration. The global catalog uses version 2 in `data/assemblies-v2.json` on desktop and a separate browser namespace. It starts fresh without reading earlier catalog files. `project.backup` creates an explicitly requested copy without overwriting another file. Native bridge 5 supplies generic backups, bounded file/BLOB transfer, and Wingman attachment export.

## Review and verification

Review snippets retain source references, page bounds, geometry highlights, annotations, and notes. A reviewed source records a dependency fingerprint; relevant changes make its effective status `changed`. Review is estimator status, not engineering approval. See [CLI commands](cli.md#detailed-takeoff).

Generation has a shared 50,000-piece/surface budget and reports incomplete calculations when exhausted. The scene displays at most 4,000 filtered objects and reports omissions. Exports retain all generated records, even when filtered or omitted from the scene; they cannot recover generation-budget omissions.

The current checks and remaining verification are recorded in [Detailed takeoff](detailed-takeoff.md). Test scripts and historical passes alone do not establish that the new implementation passed. Representative job sections still need comparison with manually checked dimensions, counts, and project-specific details.
