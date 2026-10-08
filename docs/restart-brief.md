# Bluewing restart brief

Restart direction and MVP decisions, September 16, 2026, updated for calculated materials on October 3, 2026. Implementation recommendations are identified separately from confirmed product choices.

Build a small, dependable takeoff application whose ordinary features can be developed and delivered as a web application. The first users are a small group working in the desktop app with AI assistance through its CLI. Progress means completing real estimating workflows and being able to change them without breaking unrelated behavior.

The previous PlanVyper application is a reference. **Its code, documentation, tests, and architecture are not authoritative, necessarily correct, or necessarily the best approach.** Use it to recover useful behavior and visual decisions. Resolve disagreements using the new product decisions and independently checked examples.

**Decision status.** Confirmed directions are TypeScript application logic, SolidJS 2 with an exact-pinned toolchain, a small Rust native adapter, web application updates, a desktop-dependent CLI, independent geometry with snapping, flat reusable groups with recipe assignments, session undo/redo with reliable saving, and reuse of the interface design. Calculations include editable formulas, inputs with declared types and units, multiple outputs, source explanations, waste allowances, and whole-package rounding. Authored wall layouts, component systems, snippets, and review status are implemented. Layers, nested groups, and recipe publishing/version migration are deferred. Other MVP cuts below are recommendations.

## A small useful MVP

Complete this workflow: create a project, import a PDF, choose and calibrate a sheet, draw lengths/areas/counts, apply a simple calculation, inspect its sources, export quantities, close, and reopen. An agent can inspect the same project and make the same edits through the CLI while the desktop app shows the results.

The first usable MVP targeted macOS. Windows is now supported with a WebView2 desktop shell and NSIS installer; local Windows verification is recorded in `docs/validation.md`.

Initial scope:

- One open project session, multiple sheets, local project storage, and one base calibration per sheet.
- Paths, explicit area polygons, and count markers; selection, point editing, move, copy, and delete.
- Reusable groups with editable recipes, traceable quantities, waste allowances, whole-package rounding, and CSV/JSON export.
- One command path for UI and CLI, reliable saving, and session undo/redo.
- The existing layout adapted to these features, with offline use after the web application has been installed/cached.

Confirmed deferrals include automatic shared junctions, Layers and nested groups, a permanent historical timeline, and recipe publishing/version migration. Also recommended for later are automatic room finding, scale regions, overlays, alternate estimates, collaboration, and cloud project synchronization. Add these when a real workflow requires them, without implementing placeholder systems in advance.

## Ownership and runtime

TypeScript owns all product behavior, including commands, geometry, measurement, calculation, undo, persistence mapping, project-format validation, CLI command definitions, rendering, and update orchestration. It runs in the native shell's webview. A separate Node/Bun runtime is unnecessary for the MVP.

Rust owns native capabilities: windows and menus, file dialogs, authorized file access, database connections and atomic transactions, the terminal connection, and any native bootstrap needed to load cached web assets. It does not understand walls, recipes, takeoff commands, or calculation history. A small CLI launcher is part of this adapter and ships with the desktop app.

```mermaid
flowchart TD
  UI[TypeScript interface] --> Commands[TypeScript commands and project session]
  CLI[Terminal / AI] --> Transport[Rust CLI transport]
  Transport --> Commands
  Commands --> Geometry[Geometry edits]
  Geometry --> Measurement[Measurements]
  Measurement --> Calculation[Recipe calculations]
  Commands --> Persistence[TypeScript persistence mapping]
  Persistence --> Native[Rust file and transaction adapter]
  Native --> File[Local project file]
```

These are responsibilities within one application, not a requirement for separate services or packages. Start with a small TypeScript codebase organized by these responsibilities. The geometry and calculation modules should work on plain data without importing UI stores, SQL, or Tauri.

The application session owns accepted project state. The UI owns selection, camera, panel layout, and unfinished input. A draft becomes project data through a command; pointer movement does not save a command. Derived measurements and quantities come from the core, including the values displayed in inspectors.

## Geometry: describe the drawing

**Confirmed simplification: independent objects with snapping.** A path owns its ordered points, an area owns its polygon, and a count set owns its markers. Snapping aligns coordinates without creating a hidden relationship. Moving a point changes its object; an explicit multi-object selection can move several objects together. Areas are drawn directly instead of being inferred from a shared edge graph.

Geometry belongs to a sheet and remains valid without any group membership. The same geometry ID can supply several calculations, so a shared wall can be measured once and used for several materials. Removing a membership, recipe assignment, or group leaves the geometry intact.

Use stable page coordinates independent of zoom, pixel density, and physical calibration. Choose and document a single origin/orientation convention at import, and retain the transform needed to relate original page coordinates to rendered images. Camera transforms belong to rendering.

The geometry module answers geometric questions: segment length in page units, polygon area, hit tests, intersections needed by current tools, and valid edits. It does not decide construction quantities. Start with simple valid polygons; holes and shared junctions can become explicit additions when required.

## Measurement: convert drawing into physical facts

Measurement combines geometry with sheet calibration. It supplies typed length, area, perimeter, and count metrics to both the UI and calculations. Keep units explicit, convert through a consistent internal convention, and round for display or a specified calculation rule rather than during each geometric step.

Changing calibration changes derived measurements, not stored points or object IDs. Uncalibrated geometry is still drawable and editable. Counts remain valid; physical lengths and areas are unavailable until calibrated. An unavailable measurement is not zero.

Sheet scale setup defaults to the printed scale: architectural/metric presets, then a custom paper-to-real ratio. Two-point measurement is the secondary choice for a known dimension. Opening setup never changes calibration; apply the selected scale explicitly. Reopening shows the existing scale, including custom or measured values. Ratio conversion uses the imported PDF's paper size, independent of canvas zoom.

A later scale-region implementation can extend measurement without changing geometry ownership. That boundary is the preparation needed now; region partitioning and precedence rules can wait.

## Calculation: explain quantities from measurements

**Reusable groups with recipe assignments are essential to the MVP.** Keep three concepts explicit: a geometry object describes the drawing, a group references a set of geometry IDs, and a recipe assignment attaches a recipe and its inputs to that group. Geometry can belong to zero, one, or several groups. Membership is unique within a group. Groups can be empty and can hold several recipe assignments.

For example, one wall can belong to an assembly group for framing and insulation and a second group for an additional finish. Both reference the same wall. Their distinct assignments intentionally contribute quantities; matching geometry IDs across groups are not a reason to discard one calculation. Deleting geometry removes its memberships as part of the same undoable command. Deleting a group removes its assignments and memberships while preserving the drawing.

**Confirmed simplification: flat named groups, with Layers and nesting deferred.** The proposed organization is project-level groups that can reference geometry on several sheets. Alternate-estimate relationships can follow. A group name and optional highlight color are organization and presentation; they do not control geometry ownership or whether an object exists. Duplicating a group can copy its assignments and memberships while retaining references to the same geometry.

A recipe consumes measured metrics and explicit inputs, then returns outputs with units and an explanation. Keep recipe definitions as project data. **The confirmed authoring scope includes editable named inputs and formulas, multiple outputs, units/dimension checks, and source explanations.** Use a constrained evaluator over declared metrics and inputs, with ordinary arithmetic and useful functions such as rounding, minimum/maximum, and conditions.

Assemblies resolve measured traces, project defaults, and application overrides into calculated material pieces and surfaces. The 3D view, installed quantities, and cut schedules consume those same records. Purchasing adds waste and packaging afterward. Formula-only estimates remain available and explicitly unmodeled; they do not invent material geometry.

| Job                 | Implemented                                                                                                                                               | Still outside scope                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Drywall             | Net wall finish area by product, face, and layers, with opening deductions, waste, and packages.                                                          | Individual board placement, seams, cut optimization, and offcut reuse.                                          |
| Wall framing        | Authored walls/openings, elevations, sloped or stepped tops, positioned members, component headers, backing, and explicit end/corner/junction conditions. | Inferred engineering or automatic shared-junction design; bent/stepped track joints still need project details. |
| Acoustical ceilings | Positioned 2x2/2x4 mains, cross tees, wall angle, and clipped tile area from an explicit grid origin/direction.                                           | Hangers, connection hardware, offcut reuse, and supplier cut optimization.                                      |

Counts, cuts, finish quantities, and 3D views derive from the same calculated pieces and surfaces. Their dimensions are measured from their geometry. No reference-only material surfaces or unlocated deductions are allowed in the model. Formula estimates have a separate modeling status, and model coverage is reported independently from calculation validity. Replacing an assignment with a modeled assembly replaces its estimate contribution. Separate assignments remain separate scopes.

Initially evaluate each assignment against each compatible group member, retaining the source result before summing compatible outputs. Height, spacing, and similar estimating inputs belong to the recipe assignment rather than the drawing's points.

**Waste allowances and whole-package rounding are included.** Start with a percentage allowance and an optional quantity per package for each output, using recipe defaults that can be changed on the group's assignment. The initial calculation order is: sum the members' base amounts for that assignment/output, add the waste allowance, then round up to whole packages. Package rounding happens at that group assignment/output level, rather than separately for each drawn object. Combining purchases across groups or optimizing cuts is deferred.

For example, 100 sq ft of calculated material plus 10% waste gives 110 sq ft. At 32 sq ft per sheet, the order is 4 sheets covering 128 sq ft. Show the base amount, waste allowance, package count, and purchased coverage separately. Retain each object's base contribution; the extra allowance and package rounding belong to the group result. Advanced scrap formulas and stacked override rules from the old app are not required for this first implementation.

Calculations never mutate authored geometry. Applications reference authored geometry and generate derived pieces and surfaces; generated pieces do not become editable drawing objects. Persist assembly definitions, assignments, local overrides, and contextual openings/headers/levels/placements, not a second editable copy of resolved walls or ceilings.

Project assemblies extend the recipe records with categories, descriptions, detail references, required inputs, per-object assignment overrides, and optional piece cut/stock lengths. A device-local global library stores reusable definitions; import makes an independent project copy. Saving a project definition to the library is explicit. Global changes do not alter existing project copies or use project Undo. Component systems store independent assembly snapshots with shared inputs. Wall and ceiling templates are project assembly definitions applied through the ordinary assignment path or `wall.fromAssembly`/`ceiling.fromAssembly`. Applications inherit live project defaults with group and per-trace overrides. `wall.put` and `ceiling.put` create a project-local assembly/application for a new item or update sparse local overrides for an existing one. Reset clears the per-trace overrides. See [Assemblies](assemblies.md) for scope, CLI commands, and examples.

Project recipes are independent copies of any starter library. Updating the app or starter library does not silently replace a project's recipe definition. Editing a project recipe updates the groups using it through one undoable command; Undo restores the previous recipe. Keep ordinary editable project recipes in the MVP. Defer publishing, archiving, pinned recipe revisions, and choosing which assignments migrate to a newer revision.

Use a single calculation path for the inspector, quantity table, export, and CLI. Results retain the group, assignment, geometry source, recipe, effective inputs, output unit, and diagnostic. Sum compatible outputs; preserve different units and material identities. An invalid calculation remains visible and makes affected totals incomplete instead of quietly contributing zero.

The open project session owns one lazy, deeply readonly calculation result shared by UI, CLI, exports, and 3D views. Project names, sheet names/order, geometry names, group names/colors, snippets, and review marks retain it when calculation inputs are unchanged. All other mutations invalidate it by default, including new commands. Compare only the replaced record for these exceptions; do not hash the whole project. Report labels and revisions come from current project data. Batch and preview reads use their current draft, and only a successfully saved batch can publish its final calculation. Undo/redo retains results only for presentation/review edits. Command replies remain independent copies, and closing the session drops its cache. Standalone core calculation functions and unsaved assembly previews remain independent of this session cache.

Example expectations to retain as independent checks: a 24 ft wall at 8 ft high with two layers gives 384 sq ft; a 24 by 15 ft rectangle gives 360 sq ft; three markers give 3 items. These examples establish arithmetic, not every construction rule.

## Commands, saving, and history

One TypeScript command registry supplies validation, execution, CLI help, and payload schemas. Both UI and CLI submit semantic commands through a serial queue. Each accepted command validates against current state, creates a change, persists it atomically, and then publishes the accepted state. Failed persistence does not report success or discard the user's draft.

Commands based on an earlier observation carry the project identity and expected revision. A stale request returns a clear conflict so the caller can inspect and retry. A single process simplifies ownership but does not eliminate stale AI observations or UI drafts.

**Confirmed simplification: session undo/redo.** Keep a bounded stack of before/after changes for affected records, with an action label and origin. UI and CLI actions share this stack. One completed drawing gesture or atomic batch is one undo step. Undo and redo use the same saving path and advance the project revision. Closing the project clears the stack; the current saved state remains.

Store the current project, not an event-sourced reconstruction of every past entity. A future checkpoint feature can save named project states without requiring a permanent timeline now. Reliable saving and crash recovery are separate from retaining every historical edit.

SQLite is a reasonable proposed container for current records and imported source assets. Keep SQL mapping and project-format validation in TypeScript; Rust executes generic, bounded transactions on an opened project connection. Ordinary edits update affected records without copying PDFs or all history. Use one writable application session per project in the MVP. Opening the same project in another writer is outside that scope.

The implementation uses a `.bluewing` SQLite container with project format 4 only. Earlier development projects are disposable and must be recreated. Do not add compatibility adapters, old-format loading, automatic upgrade backups, or migration code while this policy holds. `project.backup` creates an explicitly requested recovery copy of a current project. Generic native bridge 7 supplies backups, bounded file/BLOB transfers, and local image exports for Wingman messages. TypeScript maps project metadata, individual records, and separately stored PDF assets. Native file locking enforces one writer. Browser development uses IndexedDB through the same persistence interface; the desktop file remains the deliverable project format.

The device-local global library uses its own current format and namespace. This development reset starts it with the new built-in catalog rather than upgrading old definitions. Recovery during development comes from useful Git checkpoints; it does not require preserving obsolete takeoff data.

## CLI: operate the desktop project

The CLI is a required product interface from the first working workflow. Its launcher connects to the desktop app, forwards arguments/input, waits for the result, prints structured JSON, and returns an exit status. The TypeScript app interprets product commands. Adding a command or changing its help must not require rebuilding the launcher.

Start with commands for project/sheet inspection, geometry reads and edits, groups and memberships, recipe assignments, quantities/explanations, undo/redo, export, and bounded image rendering. Provide examples and machine-readable schemas from the same command registry. Agent images include sheet identity, bounds, and coordinate mapping so their pixels can be related to edits.

An atomic batch contains ordinary commands and validates the resulting project as a unit. A preview can execute against a temporary in-memory state without committing. Both use the same command logic. The scope is the active desktop project; the CLI does not open a second independent database session.

For the simplest first implementation, return an actionable error if the desktop app is unavailable. Automatically opening the app can be a later convenience. Keep the terminal connection local and limited to the current user's application session.

## Interface: retain the useful design

Use the current SolidJS interface as the visual reference: dark canvas-centered layout, left sheet navigator, right contextual inspector, tool rail at the far right, collapsible panels, and a bottom status bar. Retain its density, spacing, colors, keyboard affordances, and panel behavior where they help the smaller workflow.

Expose drawing and quantities workspaces, with groups accessible from navigation and recipe assignments in the contextual inspector. Structured Construction and Review panels author walls, openings, header components, levels, sheet placements, ceilings, source snippets, and review marks. Plan, 3D, and split views link source selection; level, material, role, and selection filters affect the view, not the estimate. A session undo stack does not require the existing History workspace. Hide deferred features instead of building inactive navigation around them.

**Compact functionality takes priority.** The user's PlanSwift reference (`2998.jpg`) calls for a dense sheet/group tree with one-line rows, clear indentation, measured totals, color swatches, visibility controls, and a compact search. Keep the modern styling while making common work available directly in those rows. Full-canvas crosshairs follow the mouse; general navigation help belongs in the status bar, leaving the plan unobstructed.

Visibility is local view state, saved per project on the device. A sheet control hides its takeoff drawing while leaving the PDF visible; a group control applies to that group on that sheet. Hidden geometry is excluded from selection and snapping, but retains its measurements and contributions to the estimate. Shared geometry remains visible through any visible group; ungrouped geometry follows the sheet control. Drawing into a hidden group or following a quantity source reveals the relevant drawing.

Sheet auto-naming uses a small deterministic local text extractor, with no cloud AI or OCR service. It examines the visually bottom-right quarter of each PDF page for a capital-letter sheet code followed by digits (including spaces and decimal codes), then nearby title lines. Names are proposed for review and editing before a selected batch is applied through the ordinary command/Undo path. No-text and unmatched pages retain their names. This is a heuristic for varied title blocks, not a guarantee that every sheet can be named.

Review components individually before copying them. Presentation components and CSS are stronger reuse candidates than the canvas controller, project stores, or native projections. A component can preserve its appearance while receiving new, smaller inputs and actions.

Keep one drawing implementation for the MVP and reuse its geometry/measurement conventions for CLI images. Browser development should execute the actual TypeScript core through a small development storage adapter, rather than a separately maintained read-only mock application. Shipping full browser-only project storage is a later decision.

Hold B for temporary paint selection without clicking, and release it to resume the current tool. The brush adds objects by default; Alt/Option subtracts. Shift remains additive for click and rectangle selection, and Alt/Option also subtracts for those operations. Unfinished drawing and inspector edits keep their context. Canvas pointer feedback uses a center-dot scope with full crosshairs; panning keeps a hand cursor. Collapsed panel controls have reserved toolbar space. Source-page thumbnails load only for rows visible in the scrolling sidebar; an open hover or keyboard preview takes priority and stays resident. Duplicate source pages share one decoded image. The sidebar releases its displayed images when their rows and preview leave view or the sidebar is hidden. A separate bounded image cache retains reusable source pixels across renaming and calibration. Background preparation starts near the selected sheet and eventually covers every page, yielding to foreground work.

The September 17 UI review confirms source-page previews on hover or keyboard focus, groups shown beneath each sheet containing their members, ordinary wheel zoom toward the pointer, and draggable panel dividers. Group nesting in the navigator is a projection of flat reusable groups, not a hierarchy in project data. Preserve the reference's compact rows, sheet/group search, sheet-local group selection, contextual selection measurements, and separate next-drawing group choice. Panels collapse, temporarily peek, pin, and retain device-local widths. Resizing and navigation preserve the drawing view. See the [UI restoration record](ux-restoration.md) for provenance, implemented details, and historical behaviors intentionally left out.

## SolidJS 2 and agent tooling

**Confirmed framework choice: SolidJS 2.** At setup on September 16, 2026, the newest published Solid 2 version was `2.0.0-rc.8`; stable 2.0 had not been released. This is the initial pin. The npm `latest` tag still selected Solid 1, and related packages had different tag defaults, so resolve concrete compatible versions rather than installing a tag across the package set. See the [RC.8 release](https://github.com/solidjs/solid/releases/tag/solid-js%402.0.0-rc.8).

Treat the runtime, renderer, JSX compiler, diagnostics, and integrations as one compatibility boundary. Bun is the package manager and command runner for development and CI. Exact-pin direct dependencies, constrain the transitive Solid compiler/runtime packages, and keep `bun.lock` under version control. Use `bun install --frozen-lockfile` in CI. Upgrades, including eventual adoption of stable 2.0, are deliberate changes with release-note review and development and production verification. Unrelated feature work preserves the existing pins.

The repository includes substantial linting: strict type-aware TypeScript rules, Solid 2 rules, JSX accessibility checks, and formatting. Use Solid 2-aware rules rather than presets that recommend removed Solid 1 APIs. The [repo skill](../.agents/skills/solidjs-2/SKILL.md) records likely agent mistakes and the workflow for diagnosing them. Package versions and enabled rules are owned by the package manifest, lockfile, and configuration files.

Use `@solidjs/diagnostics` in development and CI. Give important UI stores, signals, memos, and effects meaningful names so artifacts identify the source of a rerun or wait. Browser scenarios should assert visible behavior and inspect diagnostics, silent holds, and justified rerun budgets. Preserve artifacts for failures. A silent hold needs visible pending feedback; increasing a budget alone does not repair it. Introduce scenario budgets for actual interactions, without imposing arbitrary timing thresholds across the application.

Run development checks before the production build and browser smoke checks. RC.8 also supports an observe build, but it omits some development checks, so it does not replace development verification. Bluewing starts as a client-rendered application; SSR and SSR tests are not required for this desktop workflow. Chromium and WebKit checks supplement the later native app checks.

Development checks include sheet-panel toggling and an estimating workflow through PDF import, calibration, drawing, recipes, quantities, export, and reopening. Native checks exercise the desktop bridge, SQLite, CLI image rendering, and complete cached web-version activation. See [repository setup](../README.md) for commands and the separate validation scopes.

PDF page images are disposable derived data, separate from saved takeoff projects. Use memory caching and the operating system's temporary directory on desktop; cache files need not follow a moved/shared project. No reboot detection, project-format migration, permanent cache attachment, or app-owned disk cleanup policy is required. Cache misses regenerate from the embedded PDF. Background preparation starts with nearby sheets and eventually covers the whole project, while foreground rendering and interaction take priority. Previews use the same memory/disk approach and can be generated from full-page images. Main PDF images use 3,300 pixels along the longest edge.

PDF drawing, thumbnail resizing, cache PNG encoding, and cached-image decoding run outside the UI thread. Viewers share immutable source images through explicit leases. Selected pages take priority over background preparation, which exposes progress and a user pause control. On-demand performance recordings combine product stage measurements with the browser's available responsiveness measurements; capture stays bounded and does not run continuously. These decisions apply to macOS and Windows alike.

## Web application updates

The deliverable is a remotely updatable PWA-style application inside a native Rust shell. A web release includes the UI, domain code, CLI definitions, recipes shipped as defaults, rendering assets, and supported project-format validation. Native releases are reserved for changed native capabilities and dependencies.

Tauri can load a remote URL and permit an explicit origin to call selected native APIs. Neither setting provides offline delivery on its own. See [Tauri asset configuration](https://v2.tauri.app/reference/config/#frontenddist) and [remote API access](https://v2.tauri.app/security/capabilities/#remote-api-access).

Keep a complete usable web version locally. Download the next version as a complete unit and activate it between project sessions, after saving and resolving unfinished work. If the download is interrupted, continue using the previous version. A web release declares its required bridge version and supported project format. A code rollback does not make an incompatible project file readable.

Prove the delivery mechanism in the target native webviews early. Service workers are a possible cache mechanism, but their support and lifecycle in the shell need verification. If necessary, use a small native cache/loader for web bundles while keeping product and update policy in TypeScript. Choose one mechanism for the MVP. [Service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) and [Tauri's webview process model](https://v2.tauri.app/concept/process-model/) describe the relevant platform boundaries.

## Keep the reference outside the new application

Maintain sibling directories for the new application and the frozen reference. The reference is neither a workspace dependency nor a default instruction source. Copy this brief and its [reference map](restart-reference-map.md) into the new project; consult only the map entries relevant to the task at hand.

The map uses paths relative to the reference repository, so it travels between machines. It also identifies the assessed checkpoint: the ordinary Git checkout was older than the tested source. Preserve a normal source snapshot of that checkpoint, rather than making the new project depend on the old tooling to recover it.

Write new product decisions into this brief in place. Historical specs remain evidence of prior choices. When reusing code, keep the smallest useful piece and understand its assumptions before importing dependencies around it.

## Build order and evidence of progress

1. Make the shell load the web app, execute a CLI request in TypeScript, and save/reopen a tiny project. Demonstrate a second web version without rebuilding Rust, then start offline.
2. Complete one real workflow through both UI and CLI: import, calibrate, draw a wall, assign it to a group, apply a recipe, calculate, inspect, export, undo, and reopen. Include a waste allowance and package rounding with independently expected results. Reuse that wall in a second group and verify its independent contribution.
3. Add area and count workflows. Use representative source plans and independently expected quantities, including an agent image-and-edit loop.
4. Change a persisted property and a calculation command. Observe which modules change and whether unrelated behavior breaks before expanding the feature list.

Use focused domain examples and a few complete workflows to check these boundaries. Test the actual native app as well as the browser development view. Do not infer readiness from the number of generated tests or implemented command names.

Use the local Behavioral Health Group permit set dated March 27, 2026 as a real import/rendering reference. It has 15 sheets, including the A2.0 new-work floor plan. The source PDF is in the user's Downloads directory and is not committed to the repository. It supplements the independent wall, area, count, and package-rounding examples; it is not a complete MVP acceptance specification.

Keep the project in Git and save useful working checkpoints after the relevant checks pass. The reference repository remains separate.

## Detailed construction and review

Construction dimensions use metres and rotations use radians, with world Z upward. Drawing points, snippet bounds/annotations, and sheet placement `pageOrigin` stay in page coordinates; calibrated sheet placement maps them into the model. Exact stud/jamb cuts use the local wall top less explicit top and bottom allowances. Track channel flanges are display envelopes and impose no automatic cut deductions. Header component cuts use rough opening width plus entered end extensions; vertical and face offsets and section rotation position each component. Jamb centres sit outside the rough opening width by half their rotated section width, plus explicit offsets.

Shared conditions name their owning wall and multiple members need explicit positions. Sizes, gauges, connections, and engineering come from the project. Rectangular section envelopes support placement and quantities, not metal-profile fabrication. Bent or stepped track joints still need project joint/end-cut details; diagnostics keep schedules incomplete. Ceiling surfaces always contribute their measured area. ACT grids use positioned members clipped to the boundary; factor estimates remain unmodeled. Additional finish deductions must be located in geometry so the drawn surface and reported area agree.

Review stores source references, highlighted snippets, annotations, notes, and status. Relevant source/dependency edits invalidate a reviewed fingerprint and show changed status. Preview quantities calculates material changes without saving. Neither review status nor successful arithmetic establishes engineering adequacy or a complete building takeoff.

Generation shares a 50,000-piece/surface budget and reports incomplete results at the limit. The Three.js viewer displays all generated objects matching its filters, with instanced members, merged finishes, depth-tested selection, and rendering on demand. Its orthographic camera supports orbit, pan, zoom, standard views, and fitting selections. Solid, framing, and X-ray finish-outline modes change visibility without changing quantities. Desktop, Wingman, and CLI share the renderer and camera state. Construction CSV includes all generated pieces regardless of scene filters or selection, but cannot include pieces omitted by the generation budget. Current validation and pending checks belong in [the detailed-takeoff report](detailed-takeoff.md), separate from older verification records.

## Wingman collaboration

Wingman is a collapsible live preview in the drawing workspace with a project conversation. Successful CLI sheet, snippet, and 3D renders publish their location and optional caption. Clicking swaps the main and corner views; later CLI renders preserve the user's saved return view. Preview content follows accepted project changes, while sent screenshot attachments remain fixed. Temporary annotations do not change the estimate or selection.

The conversation is provider-agnostic. Bluewing does not start a model or agent. User messages and local screenshot paths accompany the next CLI result, with nondestructive per-project cursors. The CLI can reply, flash the preview, or wait for a message outside the project command queue. Chat is stored in local application data separately from the project file and Undo.

The user's Pause CLI button rejects all new and queued non-messaging CLI requests. An action already executing can finish. Desktop editing and messaging continue, and only the user can resume. Rejected requests never replay. Cmd/Ctrl+Shift+X or Attach screenshot lets the user drag a rectangle anywhere inside the app, including sidebars and headers, then add/remove captures in the message draft. See [Wingman](wingman.md) for operation and verification.
