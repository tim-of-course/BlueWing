# Desktop CLI

The `bluewing` launcher operates the open desktop application. Start Bluewing first. The launcher forwards arguments to the same TypeScript command session used by the interface; it does not open another project database.

Wingman's copied prompt includes both the executable and the running app's `BLUEWING_DATA_DIR`. Keep both for subsequent calls: the data directory selects the app connection, not the executable's location. This prevents an inherited test profile from directing commands to a different app. `bun run desktop` also builds its sibling debug CLI before starting the app.

`web.inspect` reports `runningSource`, `runningVersion`, and `runningUrl` for the current webview. `activeVersion` remains the selected offline bundle; it can differ while `bun run desktop` is displaying the development server.

In Wingman, choose **Copy AI prompt**, then **Wingman + chat** or **Chat only**, and paste the prompt into your agent's chat. It includes the installed executable, the open project identity, and your conversation preference. Keep Bluewing open. This works with any agent that can run local commands; Bluewing does not run or select a model.

Start with `bluewing help` for a short introduction, or `bluewing help messages.send` for one command's schema and examples. `bluewing connect '{"payload":{"mode":"wingman"}}'` returns the current project and Wingman conversation instructions; mode `chat` keeps answers in the external chat. These modes communicate intent through instructions, without changing other callers' behavior or storing a global conversation mode. `commands.list` still returns the full registry.

Each request is a JSON object with a `payload`. Mutations of the active project also require the project identity and revision returned by `project.inspect`:

```sh
bluewing project.create '{"payload":{"name":"Estimate","path":"/absolute/path/estimate.bluewing"}}'
bluewing project.inspect
bluewing project.rename '{"projectId":"PROJECT_ID","expectedRevision":0,"payload":{"name":"Clinic estimate"}}'
bluewing project.import '{"projectId":"PROJECT_ID","expectedRevision":1,"payload":{"path":"/absolute/path/plans.pdf"}}'
```

For longer requests, use `bluewing <command> --stdin` and send the same JSON through standard input. A success response includes `ok`, `data`, `projectId`, and `revision`. Errors include a message and code. A stale mutation exits with status 3 and `PROJECT_CONFLICT`; inspect the project before preparing a new request. Other command errors exit with status 1.

`batch` takes `payload.commands`, an array of `{name,payload}` commands, and saves them as one revision and one undo step. `preview` evaluates the same array without saving and returns the temporary project, results, and `quantityChanges` with before/after material amounts, deltas, and completeness. Neither accepts nested batches or history operations. `history.undo` and `history.redo` use the shared UI history and advance the revision.

Geometry points use unzoomed, rotated PDF viewport coordinates: origin at the top left, positive x rightward, positive y downward. Import stores the original PDF-to-page transform. Calibration changes physical measurements, never the authored points. `sheet.calibrate` accepts two page points and a known distance in `ft`, `in`, `m`, or `mm`.

Prefer `sheet.scale` when the sheet states its printed scale. Its payload is `{ "id": "SHEET_ID", "paper": { "value": 0.25, "unit": "in" }, "real": { "value": 1, "unit": "ft" } }` for 1/4″ = 1′-0″. Each distance supports `ft`, `in`, `m`, or `mm`; 1 mm on paper to 100 mm real distance sets 1:100. Both scale commands save through the same session and support Undo.

`sheet.render` writes a PNG and returns its sheet ID, revision, pixel dimensions, page bounds, `pageToPixel`, and `pixelToPage` transforms. Supply `sheetId`, an output `path`, and optionally `maxDimension` (capped at 4096), `mode` (`plan`, `takeoff`, or `combined`), and page-coordinate `bounds`. It shares the takeoff painter with the drawing canvas. Use the returned inverse transform when turning an observed pixel position into a geometry edit.

`quantities.inspect` returns source contributions, diagnostics, allowance details, purchased quantities, and totals. `quantities.export` returns CSV or JSON text in `data`; the UI export buttons save that same calculation. Invalid calculations mark affected totals incomplete.

`web.stage` accepts a manifest URL and verifies the complete web release before caching it. `web.activate` accepts the staged version and reloads the web application after acknowledging the terminal response. Close the project and finish or cancel drafts first. These commands do not rebuild the Rust shell.

Assembly definitions, the device-local global library, per-object inputs, and piece schedules are documented in [Assemblies](assemblies.md#cli-and-storage). `assembly.put` and `assembly.delete` extend the existing recipe command path. `library.inspect` works without a project; library writes use `expectedLibraryRevision` in their payload.

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

## Detailed takeoff

The structured Construction and Review panels use the same commands below. Consult `commands.list` for complete required fields. Most `put` commands replace full records; `wall.put` and `ceiling.put` accept a resolved specification and store its local differences from the applied project assembly. All examples use the usual `payload` envelope, with project identity and expected revision on mutations.

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

Construction physical lengths and world positions use metres, areas use square metres, and rotations use radians. World Z points upward. Geometry, snippet bounds/annotation points, and placement `pageOrigin` use page coordinates. A placement's `worldOffset` and rotation align calibrated sheets. Recipe inputs still use their declared units.

`construction.render` uses the same Three.js renderer as the interactive 3D view and Wingman. Its payload supports:

| Option                                         | Meaning                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `width`, `height`                              | PNG dimensions, default 1600 × 1000. Each side supports 64–8192 pixels, subject to the GPU's render-buffer limit. Requests beyond a limit fail explicitly. |
| `geometryIds`, `levelId`, `materialId`, `role` | Filter the displayed construction. These never change calculations or schedules.                                                                           |
| `view`                                         | `isometric`, `top`, `front`, `back`, `left`, or `right`. Defaults to isometric.                                                                            |
| `azimuth`, `elevation`                         | Explicit camera angles in radians, instead of a named `view`. Elevation must be between −π/2 and π/2. Supplying both approaches is an error.               |
| `target`                                       | Camera focus point `{ "x": 0, "y": 0, "z": 0 }` in world metres. Defaults to the filtered model's centre.                                                  |
| `span`                                         | World span in metres across the shorter image axis at zoom 1. Defaults to fitting the filtered model.                                                      |
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

Calculated pieces and surfaces supply ordinary `quantities.inspect`/`export`, construction schedules, and 3D. Member cuts come from endpoints, and surface quantities come from polygon area and layers. Surface/piece source IDs connect every modeled output to the displayed record. Waste and package rounding affect purchases without adding installed material.

`quantities.inspect` marks outputs with `modeling: "modeled"`, `"estimate"`, or `"unresolved"`, and returns `coverage` with modeled/estimate output counts and completeness. Formula estimates create no model objects. The `ceiling-grid-2x2` and `ceiling-grid-2x4` starters are actual layouts; their `-estimate` counterparts retain area/perimeter factors. Replacing an assignment replaces its contribution. There is no `quantityMode: "reference"`, and modeled finishes reject numeric unlocated deductions.

Generation has a shared 50,000-piece/surface budget; hitting it reports incomplete results. The renderer displays every generated object allowed by the requested filters and display mode. Render filters and selection do not limit CSV: exports include every generated piece, but cannot recover generation-budget omissions. `construction.render` returns calculation completeness and diagnostics alongside the displayed-object count.

Snippets store `id`, `name`, `sheetId`, page `bounds`, `sources`, highlighted `geometryIds`, `annotations` (`points`, `label`, `color`), and `note`. A source is `{kind, id}`, where kind is `geometry`, `wall`, `opening`, `assembly`, `header`, or `ceiling`. Export returns sheet identity and coordinate mapping. `review.mark` takes `id`, `target`, `status`, and `note`; statuses are `needs-review`, `question`, or `reviewed`. A reviewed mark captures dependencies, so relevant source, calibration, placement, level, assignment, or linked-snippet changes produce effective status `changed`. Use `preview` to inspect quantity changes before applying an edit.

Only project format 4 is supported. Recreate older development takeoffs; the app does not load or migrate them. The global library starts fresh in version 2 rather than importing earlier definitions. `project.backup` is still available for an explicit current-project recovery copy. Current web releases require native bridge 7.

See [detailed-takeoff verification](detailed-takeoff.md) for actual results and pending checks.

## Wingman messages and presentation

`messages.send` accepts `{ "text": "Please review this detail" }` in `payload` and records an agent message in the open project's local conversation. Optional `attachments` contain `id`, `name`, `dataUrl`, `width`, and `height`; the UI supports up to eight images and 32 MiB of encoded image data per message. CLI requests also have the existing 16 MiB transport limit, including their JSON envelope. Desktop attachments are exported to absolute local file paths. CLI responses return attachment `path`, `id`, `name`, `width`, and `height`, without image base64. Conversation saves do not change the estimate revision or undo history. Browser conversations use IndexedDB; desktop conversations use local application data.

`messages.read` accepts `{ "after": 0, "waitMs": 25000 }`. Reads are nondestructive. The optional wait is bounded to 25 seconds and runs outside the project command queue. Keep the latest message `id` as the cursor and reuse it after reconnecting. IDs and conversations are scoped to each project.

For a conversation, use `messages.wait` with `{ "after": 0, "timeoutMs": 300000 }`. It waits for **user** messages, so an agent's own replies do not wake it. The native launcher quietly renews bounded 25-second application waits until a user message arrives or the total timeout expires (five minutes by default). `timeoutMs: 0` reads immediately. Browser dispatch and older launchers return after one bounded application wait. Waiting does not occupy the project command queue or make repeated model calls. Your agent still needs to await the process using the tools its host supports.

The result is `{ status, projectId, waitToken, after, messages }`. On `messages`, process the messages and reply. On `timeout`, renew if continuing is supported. On `ended` or `project_changed`, stop waiting; a project switch is not permission to continue on the newly open project. The launcher binds renewals to the original desktop, project, and wait token. It preserves cursors over intermediate responses so the final response includes their messages. Application errors and transport failures return immediately rather than being retried.

**Wingman + chat:** send questions, progress, and answers with `messages.send` when communicating through Wingman; inspect screenshot attachment paths. After answering or completing work, call `messages.wait` again. Use the host's waiting tools while the process is pending. If the host cannot keep the agent available, explain that briefly in Wingman before ending the turn. The external chat remains available, and duplicate replies are optional. **Chat only:** keep questions and answers in the external chat, including answers to any Wingman input. Wait for further instructions there. A small `messageGuidance` field accompanies newly delivered user messages to remind agents of these choices; ordinary results without user messages do not carry it.

Every successfully parsed CLI request accepts an optional top-level `messagesAfter` cursor. Both success and error responses include full `messages` newer than that cursor, including attachment paths, plus `messagesProjectId`. Store the cursor with that project identity; reset it when the identity changes. If the supplied `projectId` differs from the current conversation, response delivery starts at zero. Omitting the cursor returns the entire current conversation. `messages.read` uses the envelope cursor when its payload omits `after`. Supplying `projectId` to `messages.send` or `messages.read` requires it to match the open project.

For `messages.wait`, the payload's `after` (or the envelope cursor when omitted) applies to both result messages and the response envelope. A pending wait never delivers messages from a different project. Always consume messages returned by a send or another action before starting the next wait, and pass the greatest received ID forward. Reads do not acknowledge or delete messages.

The UI's pause control rejects all non-messaging CLI commands with `WINGMAN_PAUSED`, including inspection and rendering. Commands queued before a pause remain rejected after resume; submit a new request to retry. Commands already executing may finish. UI operations and messages continue while paused.

Successful CLI `sheet.render`, `snippet.render`, and `construction.render` exports publish their view to Wingman. Each accepts an optional `caption`. `wingman.inspect` reads the presentation, `wingman.flash` expands and glows the corner preview, and `wingman.annotate` replaces local plan annotations with `{ "annotations": [{ "points": [{ "x": 10, "y": 20 }], "label": "Check", "color": "#ff8800" }], "highlightIds": [] }`. These commands do not edit the estimate.

For ordinary work, include the most recent received message ID in the next command. There is no separate acknowledgement command or destructive inbox read:

```sh
bluewing project.inspect '{"messagesAfter":12}'
bluewing messages.send '{"payload":{"text":"I checked the opening. Please confirm the head height."},"messagesAfter":12}'
bluewing messages.read '{"payload":{"after":13,"waitMs":25000},"messagesAfter":13}'
bluewing messages.wait '{"projectId":"PROJECT_ID","payload":{"after":13,"timeoutMs":300000},"messagesAfter":13}'
bluewing wingman.flash '{}'
```

A normal user message is delivered with the next CLI result. It does not interrupt an operation already running. The separate **Pause CLI** button cancels pending CLI work. Resume is available only in the desktop UI. The CLI cannot resume itself.

While a message wait is pending, Wingman shows **Waiting for your message** and **End conversation**. Ending wakes active waits and prevents their renewal. A later new wait can start another conversation. This indicator establishes that a request is waiting, not that a model is guaranteed to respond; if a caller is killed, the outstanding application wait expires within 25 seconds. Pausing CLI actions leaves messaging and waits available.
