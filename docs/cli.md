# Desktop CLI

`connect` and `takeoff.list` identify the current CLI selection in the response's top-level `takeoff` field. `takeoff.select` with `{id}` changes this shared setting (Main initially). Supply an envelope `takeoffId` on reads, edits, batch/preview, exports and renders to keep them on the intended takeoff if another caller switches. The UI has its own selector. See [named takeoffs](named-takeoffs.md) for copy/deduction examples, ownership, the format-8 reset and per-takeoff handoff filenames.

The `bluewing` launcher operates the open desktop application. Start Bluewing first. The launcher forwards arguments to the same TypeScript command session used by the interface; it does not open another project database.

Wingman's copied prompt includes both the executable and the running app's `BLUEWING_DATA_DIR`. Keep both for subsequent calls: the data directory selects the app connection, not the executable's location. This prevents an inherited test profile from directing commands to a different app. `bun run desktop` also builds its sibling debug CLI before starting the app.

`web.inspect` reports `runningSource`, `runningVersion`, and `runningUrl` for the current webview. `activeVersion` remains the selected offline bundle; it can differ while `bun run desktop` is displaying the development server.

Choose **Copy AI prompt** in the empty chat or in **Wingman options**, then **Wingman + chat** or **Chat only**, and paste the prompt into your agent's chat. It includes the installed executable, the open project identity, and your conversation preference. Keep Bluewing open. This works with any agent that can run local commands; Bluewing does not run or select a model.

Start with `bluewing help` for a short introduction, or `bluewing help messages.send` for one command's schema and examples. `bluewing connect '{"payload":{"mode":"wingman"}}'` returns the current project and Wingman conversation instructions; mode `chat` keeps answers in the external chat. These modes communicate intent through instructions, without changing other callers' behavior or storing a global conversation mode. `commands.list` returns an alphabetical index of names, short descriptions and mutation flags, plus the request protocol.

`bluewing estimating.skill` returns the company estimating skill (scopes, takeoff standards, and the agent-written handoff document). It also returns `projectFolder`, the open desktop project file's folder (null in the browser), where agents save the handoff document. `connect` tells agents to read it before any takeoff work. The text lives in `src/app/estimating-skill.ts`.

## Connection troubleshooting

`bluewing.exe` is a client for an already-running desktop app. Running it without arguments asks that app for help; it does not start a connection service. Start Bluewing or `bluewing-desktop.exe` to open the desktop, then keep the executable and `BLUEWING_DATA_DIR` from the copied prompt together on every call.

On Windows, an agent installed as an MSIX package can see a private copy of AppData. [Windows reads a package's redirected file before the ordinary AppData file](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes). A stale `cli-session.json` there can make a copied command report connection refused while the current desktop is available outside that agent.

This occurred with ChatGPT on October 16, 2026: its redirected file under `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\bluewing\Bluewing\data` still pointed to a September desktop session. A read-only probe using Microsoft's `Invoke-CommandInDesktopPackage` confirmed the stale endpoint. Backing up and renaming only that confirmed stale `cli-session.json` made the same package-context probe read the current endpoint from the ordinary AppData directory. After restarting the desktop, the exact copied `connect --stdin` command also succeeded in that package context and returned the expected project identity and Chat-only mode. Do not remove the rest of the app data or print the session token when comparing files. A live desktop listener is still required; a correct connection file cannot connect after the app exits.

For an unexpected exit during `bun run desktop`, inspect its terminal output. The resource guard reports `[resource guard] Stopping heavy work: ...` and exits with code 75 on a resource stop. An app crash or a terminated parent process is a separate cause; a stale connection file alone does not establish why the desktop exited.

## Requests

Each request is a JSON object with a `payload`. Project reads, exports, renders, and `project.backup` accept optional `projectId` and `expectedRevision` guards. Each supplied guard must match before the operation runs. Use both to bind a file to the same project and revision as its supporting reads. Mutations of the active project require both fields.

```sh
bluewing project.create '{"payload":{"name":"Estimate","path":"/absolute/path/estimate.bluewing"}}'
bluewing project.inspect
bluewing project.rename '{"projectId":"PROJECT_ID","expectedRevision":0,"payload":{"name":"Clinic estimate"}}'
bluewing project.import '{"projectId":"PROJECT_ID","expectedRevision":1,"payload":{"path":"/absolute/path/plans.pdf"}}'
```

For longer requests, use `bluewing <command> --stdin` and send the same JSON through standard input. A success response includes `ok`, `data`, `projectId`, and `revision`. A `PROJECT_CONFLICT` exits with status 3 and reports the current project ID and revision. Supply any missing mutation fields from your observation. For a stale revision, reread the records you are editing, merge your changes, and submit with the new revision. If the project ID differs, stop and reconnect to the intended project. Other command errors exit with status 1.

`batch` takes `payload.commands`, an array of `{name,payload}` commands, and saves them as one revision and one undo step. `preview` evaluates the same array without saving. Its response data contains the ordered operation results in `data`, material deltas in `quantityChanges`, and the resulting `calculationComplete`, `constructionComplete`, and `diagnostics`. Set `payload.includeProject` to `true` for the temporary project. Neither command accepts nested batches or history operations. `history.undo` and `history.redo` use the shared UI history and advance the revision.

A failed child is identified by its zero-based `commands` index and command name. Run application commands such as `assembly.import` on their own before a batch that uses their results. Final validation checks the combined draft before saving.

Geometry points use unzoomed, rotated PDF viewport coordinates: origin at the top left, positive x rightward, positive y downward. Import stores the original PDF-to-page transform. Calibration changes physical measurements, never the authored points. `sheet.calibrate` accepts two page points and a known distance in `ft` or `in`.

Prefer `sheet.scale` when the sheet states its printed scale. Its payload is `{ "id": "SHEET_ID", "paper": { "value": 0.25, "unit": "in" }, "real": { "value": 1, "unit": "ft" } }` for 1/4″ = 1′-0″. Each distance supports `ft` or `in`. Both commands store `calibration.feetPerUnit`, the real length in decimal feet of one page point, and support Undo.

`sheet.render` writes a PNG and returns its sheet ID, revision, pixel dimensions, page bounds, `pageToPixel`, and `pixelToPage` transforms. Supply `sheetId`, an output `path`, and optionally `maxDimension` (capped at 4096), `mode` (`plan`, `takeoff`, or `combined`), and page-coordinate `bounds`. It shares the takeoff painter with the drawing canvas. Use the returned inverse transform when turning an observed pixel position into a geometry edit.

`quantities.inspect` returns source contributions, diagnostics, allowance details, purchased quantities, and totals. `quantities.export` returns CSV or JSON text in `data`; the UI export buttons save that same calculation. Invalid calculations mark affected totals incomplete.

For the selected takeoff, inspection also returns `data.sourceCoverage` with five lists, each with a `count` and `items`. The four drawing lists are `ungroupedGeometry`, `geometryInUnassignedGroups`, `geometryWithIncompatibleRecipes`, and `geometryWithoutOutputOrDiagnostic`. Each item includes its geometry ID, current name, sheet ID, and kind. The separate `assignmentsWithEmptyGroups` list identifies each assignment, group, and recipe. These advisories are for inspection only and leave totals, completeness, and exports unchanged.

`quantities.exportEstiMaker` saves purchased LF/SF/count lines as versioned `bluewing.takeoff` JSON using the same projection as Quantities. CLI calls require `payload.path`. UI calls can choose a destination. The response identifies the takeoff and revision. Its `data` contains the saved `path`, total `rowCount`, and `missingQuantityRowCount`. Counts are normal import rows. Missing physical dimensions produce descriptions marked `(missing quantity)` and actual numeric zero. Coverage is informational. Unresolved sources and invalid import identity prevent saving. See [the contract and checked fixtures](estimaker-export.md).

```sh
bluewing quantities.exportEstiMaker '{"payload":{"path":"/absolute/path/estimate.estimaker.json"}}'
```

`web.stage` accepts a manifest URL and verifies the complete web release before caching it. `web.activate` accepts the staged version and reloads the web application after acknowledging the terminal response. Close the project and finish or cancel drafts first. These commands do not rebuild the Rust shell.

Assembly definitions, the device-local global library, per-object inputs, and piece schedules are documented in [Assemblies](assemblies.md#cli-and-storage). `assembly.put` and `assembly.delete` extend the existing recipe command path. `library.inspect` works without a project; library writes use `expectedLibraryRevision` in their payload.

## Permanent sheet annotations

Read `annotation.list` with `{sheetId}` before working on a sheet. It returns complete records across Main, phases and change orders, including hidden annotations and freehand points. Use `annotation.inspect` with `{id}` for one record.

Use `annotation.add` with `{sheetId, kind, points, text?}`. A text annotation takes one anchor and nonempty text. Arrow and line take a start and end. Rectangle, ellipse and revision-cloud take opposite corners. Draw freehand strokes using the Annotations tool. All points use rotated PDF page coordinates. Use `annotation.update` with `{id, points?, text?}` and `annotation.delete` with `{id}`. These edits support batch, preview, revision guards and shared Undo/Redo. Bluewing records the originating author and UTC creation time.

Use permanent annotations for location-specific information that future estimators should see. The Annotations toggle beside View controls the canvas and sheet PNGs, including cropped renders. Review snippet annotations belong to a source-linked review crop. Wingman annotations last for a presentation. Notes hold project-wide Markdown.

## Project scratchpad

`notes.read` returns `{markdown}`. `notes.write` replaces the full Markdown string using `{markdown}` and the normal project identity/expected revision; an empty string clears it. Read before writing and preserve unrelated text. `notes.search` accepts a nonempty `{query}` and returns matching `lines` with 1-based `line` numbers and `text`, plus `totalMatches` (occurrences). Search is case-insensitive literal substring matching in accepted text, without regex or an index. Notes use shared Undo/Redo, batch, preview, saving, and Pause CLI behavior.

The right inspector has an alternate **Notes** view with a plain multiline editor, draft Find/previous/next, explicit Save/Cancel, and Ctrl/Cmd+S. Save failures and revision conflicts retain the draft; inspect changes before cancelling and reapplying it. Notes are freeform Markdown, separate from review, snippets, chat, and structured reports. Sheet/detail names and snippet IDs/bounds are ordinary prose references and are never rewritten automatically.

## AI Page Naming workflow

Choose **AI Page Naming** (the **Aa** button beside Sheets) to prepare title blocks
and copy a task for an external agent. This replaces the old heuristic suggestion
and review dialog. The agent can also choose the workflow directly from CLI help
or the connection guide:

```sh
bluewing sheet.naming.start
bluewing sheet.naming.read '{"payload":{"offset":0,"limit":5}}'
bluewing sheet.naming.apply '{"projectId":"PROJECT_ID","expectedRevision":12,"payload":{"sheets":[{"id":"SHEET_ID_1","name":"A101 · FLOOR PLAN"},{"id":"SHEET_ID_2","name":"S201 · FOUNDATION PLAN"}]}}'
```

**Start** returns specific agent instructions and starts sequential background
prefetch for all sheets (or `payload.sheetIds`, up to 2,000). It returns immediately;
a repeated start reuses cached results. The UI prepares the same cache as the CLI.

**Read** returns compact bottom-right title-block snippets in small batches (five
by default, at most 20), stable sheet IDs/current names, source asset/page numbers,
and page-coordinate `region` bounds. Follow `nextOffset`; `queued` and `reading`
describe outstanding work. Reading does not launch extraction or change revisions.
The agent identifies the printed sheet number and page title rather than relying
on a local naming guess.

The extraction rectangle is the visually bottom-right quarter used by the previous
naming tool, accounting for PDF rotation and crop transforms. Filtering happens
inside PDFium **before** the 1,500 UTF-16-unit per-page limit: unrelated drawing
notes cannot consume the title-block budget even if they precede the title in PDF
reading order. Text is returned once, without a duplicate full-page text/geometry
dump. `characterCount` counts only regional text; `truncated` reports regional
overflow. No whole-page extraction is offered by this workflow.

For `no-title-block-text`, ambiguous or truncated snippets, the workflow tells the
agent to request a **title-block image only** using `sheet.render` with the returned
`region` as `bounds`, `mode: "plan"`, a path, and `maxDimension: 1600`. This lets
the agent visually read scans or unusual title blocks without loading every
drawing into context. Bluewing itself does not run OCR or a model. Unresolved
pages should retain their names and be reported; the agent should not invent titles.

**Apply** accepts up to 500 `{id,name}` entries, saves atomically as one revision
and one Undo step, and preserves all other sheet fields. Duplicate IDs, missing
sheets, blank names, and stale revisions reject the request. The workflow asks
the agent to use the project ID/revision returned by its latest snippet read,
and to reread affected names after conflicts. A full-project dump is not needed
just to get revision metadata. No per-page user review is required.

`sheet.naming.cancel` stops unfinished preparation and preserves completed results.
Extraction errors remain explicit and can be retried with Start. The application
session caches snippets using a 16 MiB serialized-string estimate (not a process
memory bound), cleared on project close/reopen; renaming preserves cached text.
Evicted/unrequested pages report `not-cached` and can be prepared in smaller groups.
No project text is duplicated into the saved file.

## Performance recordings

Record a slowdown while using the actual desktop app:

```sh
bluewing performance.start
bluewing performance.status
bluewing performance.stop
bluewing performance.export '{"payload":{"path":"/absolute/path/performance.json"}}'
```

Start before importing or switching pages. Use menus, type, pan, and change sheets while preparation runs, then stop. `performance.status` includes preparation progress. Stop returns the report; export saves the current or last recording. These commands work without a project and bypass the project edit queue, so a long import cannot prevent stopping a recording. Pause CLI still blocks them, and messages still accompany CLI results.

The footer offers the same recording flow. Reports retain a bounded set of stage timings, worker drawing/resize/encoding measurements, frame gaps, and available input-delay/long-task measurements. Capability fields identify browser APIs that are unsupported. Capture starts only on request and has no observers or animation loop while idle. Reports contain page IDs and browser/device context, but omit plan text, paths, screenshots, and DOM targets. The report describes the recorded session, not a hardware-independent performance guarantee.

Read `summary.activities` for whole-recording counts, total durations, worst completed spans and latest events, including `page.preparation` progress. These survive detailed timeline eviction; the summary holds at most 64 activity/purpose/resolution/cache/priority groups and reports overflow in `ungroupedActivityEvents`. Page IDs do not create groups. Nested stage durations overlap and must not be added together. Frame p95 describes retained samples only, so also inspect worst frame gaps, long tasks and page-request durations. See the [measured comparison](performance-diagnostics-comparison.md) for examples and limitations.

Recordings now include `canvas.pointer`, `canvas.paint`, `canvas.commit`, `page.display` and `cli.command` spans. CLI timing includes application queue wait and response formatting, but excludes process launch/IPC and the subsequent UI paint. `performance.*` commands do not time themselves. `summary.frames.over17Ms`, `over33Ms`, `over50Ms` and `over100Ms` are cumulative counts of frame intervals strictly above those thresholds; the browser Long Tasks API still has its fixed 50 ms threshold. See [workflow performance checks](workflow-performance.md) for exact boundaries and the standard regression suite.

## Detailed takeoff

### Assembly category filters

`sheet.render`, `construction.render`, and `construction.inspect` accept optional
`categories`, an array of assembly category names. Omit it for all categories,
use `[]` for no matches, and include `null` for Uncategorized. Matching trims names
and ignores case, and uses OR across categories.
Other filters intersect. Explicit CLI filters are independent of UI preferences.

```sh
bluewing construction.render '{"payload":{"path":"/absolute/path/drywall.png","categories":["Drywall hang/finish"]}}'
bluewing construction.inspect '{"payload":{"categories":["Light-gauge metal framing"]}}'
bluewing sheet.render '{"payload":{"sheetId":"SHEET_ID","path":"/absolute/path/scopes.png","categories":["Drywall hang/finish","Light-gauge metal framing"]}}'
bluewing project.category.put '{"projectId":"PROJECT_ID","expectedRevision":12,"payload":{"name":"Specialty scope","color":"#8236DC"}}'
```

Project inspection exposes custom colors in `categoryColors`. Standard categories
use fixed vivid colors. Published Wingman views retain render category filters.
Sheet filters affect takeoff strokes/highlights, leaving the PDF layer unchanged.
Quantity inspection and exports remain unfiltered. Separately filtering framing
and drywall requires separate assemblies, even when they share a trace.

The structured Construction and Review panels use the same commands below. Consult `bluewing help <command>` for required fields, units and example payloads. Most `put` commands replace full records; `wall.put` and `ceiling.put` accept a resolved specification and store its local differences from the applied project assembly. All examples use the usual `payload` envelope, with project identity and expected revision on mutations.

| Commands                                          | Purpose                                                                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assembly.put`, `library.put`, `assembly.import`  | Edit project definitions or save/import independent global copies, including formula systems and modeled wall/ceiling assemblies.                                                                  |
| `wall.fromAssembly`, `ceiling.fromAssembly`       | Apply a live project definition with `assemblyId`, `geometryId`, and `id`; walls accept optional local `height`. Later project definition edits update inherited settings.                         |
| `wall.put`, `opening.put`, `header.put`           | Create/edit wall applications, rough openings, and project-specific header components. Each has a matching `.delete`.                                                                              |
| `level.put`, `placement.put`, `ceiling.put`       | Set elevations, sheet alignment, and ceiling surfaces. Each has a matching `.delete`.                                                                                                              |
| `wall.reset`, `ceiling.reset`                     | Clear per-trace material overrides to inherit the applied assembly settings.                                                                                                                       |
| `construction.inspect`                            | Return resolved `applications`, calculated pieces/surfaces, purchases, diagnostics, and completeness.                                                                                              |
| `construction.export`                             | Return CSV or JSON text. CSV `schedule` is `pieces` (default), `lengths`, or `materials`.                                                                                                          |
| `construction.render`                             | Write a depth-tested 3D PNG to `path`; filter materials or traces, choose a named view or exact camera, and select solid, framing, or X-ray display. Returns the camera and completeness metadata. |
| `snippet.put`, `snippet.delete`, `snippet.render` | Save/delete a source-linked highlighted crop or export its PNG. Render takes `id`, `path`, and optional `maxDimension`.                                                                            |
| `review.mark`, `review.inspect`                   | Store review status and inspect effective status, unreviewed sources, and snippets.                                                                                                                |
| `project.backup`                                  | Create a recovery copy of the open desktop project, optionally at `path`; returns the saved path and never overwrites an existing file.                                                            |

Construction physical lengths and world positions use decimal feet, areas use square feet, and rotations use radians. World Z points upward. Geometry, snippet bounds/annotation points, and placement `pageOrigin` use page coordinates. A placement's `worldOffset` and rotation align calibrated sheets. Numeric recipe inputs and outputs use their declared units (`ft`, `in`, `ft2`, `ea` or `scalar`). Piece schedules return decimal feet in `cutLength_ft` and `stockLength_ft`.

`construction.render` uses the same Three.js renderer as the interactive 3D view and Wingman. Its payload supports:

`sheetIds` limits the page scope: omit it for all project sheets, pass one ID for a single page, or pass `[]` for an empty scene. Unknown sheet IDs fail the request. `alignment` is `saved` by default, or `none` to ignore combined 3D transforms. Saved transforms apply only when the scope contains at least two sheets, before the other filters. Single-page views retain their original placement. The result includes resolved `sheetIds`, `alignment`, and `appliedAlignments` alongside the camera. Wingman receives this explicit scope and shows construction without an unrelated active PDF background.

Combined 3D alignment is a saved presentation transform after calibration and construction placement. It does not change source geometry, placement, quantities, or single-page views. Numeric offsets use world XY feet and rotation uses radians about world Z. Set it with `construction.alignment.put`, remove it with `construction.alignment.delete`, or solve it with `construction.alignment.match`. These project mutations require the usual project identity and expected revision.

```sh
bluewing construction.alignment.put '{"projectId":"PROJECT_ID","expectedRevision":12,"payload":{"sheetId":"SOURCE_SHEET_ID","offset":{"x":2,"y":-1},"rotation":0.1}}'
bluewing construction.alignment.match '{"projectId":"PROJECT_ID","expectedRevision":13,"payload":{"sheetId":"SOURCE_SHEET_ID","referenceSheetId":"REFERENCE_SHEET_ID","sourcePoints":[{"x":72,"y":144},{"x":216,"y":144}],"referencePoints":[{"x":100,"y":200},{"x":244,"y":200}]}}'
bluewing construction.render '{"payload":{"path":"/absolute/path/combined.png","sheetIds":["SOURCE_SHEET_ID","REFERENCE_SHEET_ID"],"alignment":"saved","view":"top"}}'
bluewing construction.render '{"payload":{"path":"/absolute/path/original.png","alignment":"none","view":"top"}}'
bluewing construction.alignment.delete '{"projectId":"PROJECT_ID","expectedRevision":14,"payload":{"sheetId":"SOURCE_SHEET_ID"}}'
```

Match points are corresponding source and reference **page coordinates**, in the order supplied, on distinct calibrated sheets. One pair preserves the source's saved rotation and solves translation; two pairs solve rigid rotation and translation without scaling. The reference's saved combined transform is included. The result reports `alignment`, `sourceDistance`, `referenceDistance`, `residual`, and per-pair `residuals` in feet (distances are null for one pair). A distance mismatch remains visible as residual error; matching never recalibrates either sheet.

| Option                                         | Meaning                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `width`, `height`                              | PNG dimensions, default 1600 × 1000. Each side supports 64–8192 pixels, subject to the GPU's render-buffer limit. Requests beyond a limit fail explicitly. |
| `geometryIds`, `levelId`, `materialId`, `role` | Filter the displayed construction. These never change calculations or schedules.                                                                           |
| `view`                                         | `isometric`, `top`, `front`, `back`, `left`, or `right`. Defaults to isometric.                                                                            |
| `azimuth`, `elevation`                         | Explicit camera angles in radians, instead of a named `view`. Elevation must be between −π/2 and π/2. Supplying both approaches is an error.               |
| `target`                                       | Camera focus point `{ "x": 0, "y": 0, "z": 0 }` in world feet. Defaults to the filtered model's centre.                                                    |
| `span`                                         | World span in feet across the shorter image axis at zoom 1. Defaults to fitting the filtered model.                                                        |
| `zoom`                                         | Magnification from 0.01 to 10000, default 1. Larger values move closer without changing the target.                                                        |
| `displayMode`                                  | `solid` (default) respects depth for all materials; `framing` hides finish and tile surfaces; `xray` shows finish outlines through framing.                |
| `caption`                                      | Optional user-facing description of the view published to Wingman.                                                                                         |

For example, show an ACT layout from above, then a framing detail from the front:

```sh
bluewing construction.render '{"payload":{"path":"/absolute/path/ceiling-top.png","geometryIds":["ROOM_AREA_ID"],"view":"top","displayMode":"framing","caption":"Ceiling grid layout"}}'
bluewing construction.render '{"payload":{"path":"/absolute/path/opening-front.png","geometryIds":["WALL_TRACE_ID"],"view":"front","target":{"x":4,"y":2,"z":1.5},"span":4,"zoom":1.25,"displayMode":"framing","caption":"Opening framing"}}'
```

Every export returns its resolved `camera` (`yaw`, `pitch`, `zoom`, `target`, `span`) and `displayMode`. That exact view is published to Wingman, where the user can swap it into the main view, orbit, pan, or focus a selected piece. To reproduce an export, pass its camera's `yaw` as `azimuth`, `pitch` as `elevation`, and reuse `target`, `span`, `zoom`, filters, dimensions, and `displayMode`. Different image proportions keep the target and shorter-axis span, while showing more context along the longer axis. These are presentation settings, so exporting or navigating never changes quantities or project revision.

Systems have `components: [{id, assembly, bindings}]`, where `assembly` is a copied component definition and `bindings` maps component input names to shared system inputs. Systems have no direct outputs or nested systems. Modeled definitions use `wallTemplate` or `ceilingTemplate` with empty inputs/outputs. They use the ordinary `assignment.put` path; the `fromAssembly` commands are single-trace conveniences. `assignment.put` supports group-wide `wallOverrides`/`ceilingOverrides` and per-trace `geometryDetails: { GEOMETRY_ID: { id, wall: {...} } }` (or `ceiling`). Overrides are sparse: nested member fields inherit separately, arrays replace their collection, and `null` clears an optional inherited value.

`construction.inspect` returns `applications.walls` and `applications.ceilings` with resolved settings and their assignment, group, and recipe IDs. `project.inspect` stores definitions and assignments; its `construction` collection contains only contextual openings, headers, levels, and placements. There is no separately persisted wall/ceiling copy to drift away from the assembly.

When preparing a `wall.put` or `ceiling.put` from an inspected application, send the authored settings, `id`, and `geometryId`. Omit derived provenance fields such as `assignmentId`, `recipeId`, and `groupId`; the application resolves them.

For a new ID, `wall.put` or `ceiling.put` creates a project-local definition and application. For an existing ID, it records the differences from inherited settings as per-trace overrides. `wall.reset` and `ceiling.reset` remove those overrides. Reapplying `wall.fromAssembly` retains the wall's level, top profile, conditions, and openings; an explicit `height` removes its top profile. Global edits never change imported project definitions.

For example, after importing the `ceiling-grid-2x2` starter and drawing an area, apply it with:

```sh
bluewing ceiling.fromAssembly '{"projectId":"PROJECT_ID","expectedRevision":12,"payload":{"assemblyId":"PROJECT_CEILING_ID","geometryId":"ROOM_AREA_ID","id":"room-ceiling"}}'
bluewing construction.inspect
bluewing quantities.inspect
```

Inspect the next revision before another edit. In the project definition or local ceiling settings, enter the actual elevation, grid origin/direction, and member specifications. `grid.origin` is world XY at the intersection of a main and a 4 ft tee row; `grid.rotation` is the main direction in radians from world +X. Ceiling elevation is the finished underside above its level, before sheet placement. Member envelopes extend upward from that datum; a specified tile thickness does the same. Unknown tile thickness is a measured plane, not an invented thickness.

Stud and jamb cuts use explicit top/bottom allowances against local wall height. Channel flange envelopes do not impose deductions. Header cuts use rough opening width plus component `startExtension` and `endExtension`; `verticalOffset`, `faceOffset`, and `sectionRotation` locate their sections. Jamb centres sit outside the rough width by half the rotated section width plus authored offsets. Shared conditions use `ownerWallId`; multiple members require explicit positions. Rectangular member envelopes do not describe fabricated metal profiles or infer engineering. Bent/stepped track joints still need project details and report incomplete schedules.

Use `opening.put` once on the framing application. All modeled wall finishes and cavity insulation on the same geometry ID automatically deduct the part of the rough opening they cover, including surfaces assigned through other groups. Enter the full rough dimensions for partial-height finishes. A 3 × 7 ft door in a 10 ft wall leaves 59 ft² on an 8 ft face and 28 ft² on a 4 ft wainscot. Formula estimates still use their entered deduction.

Calculated pieces and surfaces supply ordinary `quantities.inspect`/`export`, construction schedules, and 3D. Member cuts come from endpoints, and surface quantities come from polygon area and layers. Surface/piece source IDs connect every modeled output to the displayed record. Waste and package rounding affect purchases without adding installed material.

`quantities.inspect` marks outputs with `modeling: "modeled"`, `"estimate"`, or `"unresolved"`, and returns `coverage` with modeled/estimate output counts and completeness. Formula estimates create no model objects. The `ceiling-grid-2x2` and `ceiling-grid-2x4` starters are actual layouts; their `-estimate` counterparts retain area/perimeter factors. Replacing an assignment replaces its contribution. There is no `quantityMode: "reference"`, and modeled finishes reject numeric unlocated deductions.

Generation has a shared 50,000-piece/surface budget; hitting it reports incomplete results. The renderer displays every generated object allowed by the requested filters and display mode. Render filters and selection do not limit CSV: exports include every generated piece, but cannot recover generation-budget omissions. `construction.render` returns calculation completeness and diagnostics alongside the displayed-object count.

Snippets store `id`, `name`, `sheetId`, page `bounds`, `sources`, highlighted `geometryIds`, `annotations` (`points`, `label`, `color`), and `note`. A source is `{kind, id}`, where kind is `geometry`, `wall`, `opening`, `assembly`, `header`, or `ceiling`. Export returns sheet identity and coordinate mapping. `review.mark` takes `id`, `target`, `status`, and `note`; statuses are `needs-review`, `question`, or `reviewed`. A reviewed mark captures dependencies, so relevant source, calibration, placement, level, assignment, or linked-snippet changes produce effective status `changed`. Use `preview` to inspect quantity changes before applying an edit.

Only project format 10 is supported. Bluewing is pre-alpha; recreate incompatible development takeoffs. The app does not load or migrate other formats. The global library starts fresh in version 5 rather than importing earlier definitions. `project.backup` is still available for an explicit current-project recovery copy. Current web releases require native bridge 9.

See [detailed-takeoff verification](detailed-takeoff.md) for actual results and pending checks.

## Wingman messages and presentation

`messages.send` accepts `{ "text": "Please review this detail" }` in `payload` and records an agent message in the open project's local conversation. Optional `attachments` contain `id`, `name`, `dataUrl`, `width`, and `height`; the UI supports up to eight images and 32 MiB of encoded image data per message. CLI requests also have the existing 16 MiB transport limit, including their JSON envelope. Desktop attachments are exported to absolute local file paths. CLI responses return attachment `path`, `id`, `name`, `width`, and `height`, without image base64. Conversation saves do not change the estimate revision or undo history. Browser conversations use IndexedDB; desktop conversations use local application data.

On Windows PowerShell, set `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)` in each shell. For text with quotes or non-ASCII characters, pipe `Get-Content -Raw -Encoding UTF8 -LiteralPath request.json` to the CLI with `--stdin`. Request parsing accepts one leading UTF-8 BOM.

`messages.read` returns rows in top-level `messages` with `data: null`. Its optional `payload.waitMs` waits up to 25 seconds for any message outside the project command queue. `messages.send` returns the saved `id` in `data` and delivers new rows in the same top-level list.

For a conversation, use `messages.wait` with optional `payload.timeoutMs`. It waits for **user** messages, so an agent's own replies do not wake it. The native launcher quietly renews bounded 25-second application waits until a user message arrives or the total timeout expires (five minutes by default). `timeoutMs: 0` reads immediately. Browser dispatch and older launchers return after one bounded application wait. Waiting does not occupy the project command queue or make repeated model calls. Your agent still needs to await the process using the tools its host supports.

Wait `data` contains `{ status, projectId, waitToken }`. Read the top-level `messages` for every status. On `messages`, process the messages and reply. On `timeout`, renew if continuing is supported. On `resumed`, the user clicked Resume CLI and work may continue. On `ended` or `project_changed`, stop waiting; a project switch is not permission to continue on the newly open project. The launcher binds renewals to the original desktop, project, and wait token. It preserves cursors over intermediate responses so the final response includes their messages. Application errors and transport failures return immediately rather than being retried.

**Wingman + chat:** send questions, progress, and answers with `messages.send` when communicating through Wingman; inspect screenshot attachment paths. After answering or completing work, call `messages.wait` again. Use the host's waiting tools while the process is pending. If the host cannot keep the agent available, explain that briefly in Wingman before ending the turn. The external chat remains available, and duplicate replies are optional. **Chat only:** keep questions and answers in the external chat, including answers to any Wingman input. Wait for further instructions there. A small `messageGuidance` field accompanies newly delivered user messages to remind agents of these choices; ordinary results without user messages do not carry it.

Every CLI request accepts one optional envelope cursor, `messagesAfter`. Parsed success and error responses deliver rows newer than that ID, with `messagesProjectId` identifying the conversation. Omitting the cursor starts at the beginning. A cursor beyond the last stored ID is rejected before the command runs. Bind requests to `projectId`. Stale bindings receive an empty message list. Successfully opening another project starts delivery for the opened project.

`connect` puts earlier rows in `messageHistory` without reply guidance. Read them for context, act only on clearly open requests, and ask if unsure. New input during connection arrives in `messages`. Process unseen rows from history and then new messages in ascending ID order on every response, including sends. Then pass the highest processed ID for that project on the next request. Reads are nondestructive.

The UI's pause control rejects all non-messaging CLI commands with `WINGMAN_PAUSED`, including inspection and rendering. Commands queued before a pause remain rejected after resume; submit a new request to retry. Commands already executing may finish. UI operations and messages continue while paused.

Successful CLI `sheet.render`, `snippet.render`, and `construction.render` exports publish their view to Wingman. Each accepts an optional `caption`. Wingman logs the saved position under **Rendered**. A render for a different takeoff leaves the main workspace in place. The result includes `notShownToUser` with both takeoff names and the log location. Clicking the thumbnail opens that takeoff. `wingman.inspect` reads the presentation, `wingman.flash` reveals and briefly highlights the sidebar, and `wingman.annotate` replaces local plan annotations with `{ "annotations": [{ "points": [{ "x": 10, "y": 20 }], "label": "Check", "color": "#ff8800" }], "highlightIds": [] }`. These commands do not edit the estimate.

For ordinary work, include the most recent received message ID in the next command. There is no separate acknowledgement command or destructive inbox read:

```sh
bluewing project.inspect '{"messagesAfter":12}'
bluewing messages.send '{"payload":{"text":"I checked the opening. Please confirm the head height."},"messagesAfter":12}'
bluewing messages.read '{"payload":{"waitMs":25000},"messagesAfter":13}'
bluewing messages.wait '{"projectId":"PROJECT_ID","payload":{"timeoutMs":300000},"messagesAfter":13}'
bluewing wingman.flash '{}'
```

A normal user message is delivered with the next CLI result. It does not interrupt an operation already running. The separate **Pause CLI** button cancels pending CLI work. Resume is available only in the desktop UI. The CLI cannot resume itself.

While a message wait is pending, the Wingman header shows **Waiting for you**. Choose **End conversation** in **Wingman options** to end the wait. Ending wakes active waits and prevents their renewal. A later new wait can start another conversation. This indicator establishes that a request is waiting, not that a model is guaranteed to respond; if a caller is killed, the outstanding application wait expires within 25 seconds. Pausing CLI actions leaves messaging and waits available.
