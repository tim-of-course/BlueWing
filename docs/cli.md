# Desktop CLI

The `bluewing` launcher operates the open desktop application. Start Bluewing first. The launcher forwards arguments to the same TypeScript command session used by the interface; it does not open another project database.

Use `bluewing commands.list` for the current payload schemas and examples. Each request is a JSON object with a `payload`. Mutations of the active project also require the project identity and revision returned by `project.inspect`:

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

Assembly definitions, the device-local global library, per-object inputs, and piece schedules are documented in [Assemblies](assemblies.md#cli-and-compatibility). `assembly.put` and `assembly.delete` extend the existing recipe command path. `library.inspect` works without a project; library writes use `expectedLibraryRevision` in their payload.

## Detailed takeoff

The structured Construction and Review panels use the same commands below. Consult `commands.list` for complete required fields; `put` commands replace full records. All examples use the usual `payload` envelope, with project identity and expected revision on mutations.

| Commands                                          | Purpose                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assembly.put`, `library.put`, `assembly.import`  | Save/import component systems and wall templates as independent copies through the existing library path.                                                                             |
| `wall.fromAssembly`                               | Apply a wall template with `assemblyId`, `geometryId`, `id`, and optional `height`; later template edits do not change the wall.                                                      |
| `wall.put`, `opening.put`, `header.put`           | Author walls, rough openings, and project-specific header components. Each has a matching `.delete`.                                                                                  |
| `level.put`, `placement.put`, `ceiling.put`       | Set elevations, sheet alignment, and ceiling surfaces. Each has a matching `.delete`.                                                                                                 |
| `construction.inspect`                            | Return positioned pieces, finish surfaces, purchases, diagnostics, and completeness.                                                                                                  |
| `construction.export`                             | Return CSV or JSON text. CSV `schedule` is `pieces` (default), `lengths`, or `materials`.                                                                                             |
| `construction.render`                             | Write a bounded 3D PNG to `path`; optional `width`, `height`, `geometryIds`, `levelId`, `materialId`, `role`, `azimuth`, and `elevation` control the view. Returns omission metadata. |
| `snippet.put`, `snippet.delete`, `snippet.render` | Save/delete a source-linked highlighted crop or export its PNG. Render takes `id`, `path`, and optional `maxDimension`.                                                               |
| `review.mark`, `review.inspect`                   | Store review status and inspect effective status, unreviewed sources, and snippets.                                                                                                   |
| `project.backup`                                  | Create a recovery copy of the open desktop project, optionally at `path`; returns the saved path and never overwrites an existing file.                                               |

Construction physical lengths and world positions use metres, areas use square metres, and rotations use radians. World Z points upward. Geometry, snippet bounds/annotation points, and placement `pageOrigin` use page coordinates. A placement's `worldOffset` and rotation align calibrated sheets. Recipe inputs still use their declared units.

Systems have `components: [{id, assembly, bindings}]`, where `assembly` is a copied component definition and `bindings` maps component input names to shared system inputs. Systems have no direct outputs or nested systems. Wall templates use `wallTemplate` with empty inputs/outputs and are applied through `wall.fromAssembly`, not `assignment.put`.

Reapplying `wall.fromAssembly` to an existing wall ID copies the template specification while retaining the wall's `levelId`, `topProfile`, `conditions`, and openings. An explicit `height` removes the old `topProfile` so the override takes effect. Always supply the intended `geometryId`; the command uses that geometry. A new wall starts without contextual relationships excluded from the template. Later template edits never update walls automatically.

Stud and jamb cuts use explicit top/bottom allowances against local wall height. Channel flange envelopes do not impose deductions. Header cuts use rough opening width plus component `startExtension` and `endExtension`; `verticalOffset`, `faceOffset`, and `sectionRotation` locate their sections. Jamb centres sit outside the rough width by half the rotated section width plus authored offsets. Shared conditions use `ownerWallId`; multiple members require explicit positions. Rectangular member envelopes do not describe fabricated metal profiles or infer engineering. Bent/stepped track joints still need project details and report incomplete schedules.

Generated pieces and surfaces supply ordinary `quantities.inspect`/`export` as well as construction schedules and 3D. Ceiling surfaces default to `quantityMode: "reference"` and add no area; `included` explicitly adds it. Existing 2x2/2x4 ceiling grid estimates are unchanged. Do not duplicate their tile scope with an included surface.

Generation has a shared 50,000-piece/surface budget; hitting it reports incomplete results. The scene has a separate 4,000-object cap with visible omissions. Render filters and selection do not limit CSV: exports include every generated piece, even if hidden by the scene cap, but cannot recover generation-budget omissions.

Snippets store `id`, `name`, `sheetId`, page `bounds`, `sources`, highlighted `geometryIds`, `annotations` (`points`, `label`, `color`), and `note`. A source is `{kind, id}`, where kind is `geometry`, `wall`, `opening`, `assembly`, `header`, or `ceiling`. Export returns sheet identity and coordinate mapping. `review.mark` takes `id`, `target`, `status`, and `note`; statuses are `needs-review`, `question`, or `reviewed`. A reviewed mark captures dependencies, so relevant source, calibration, placement, level, assignment, or linked-snippet changes produce effective status `changed`. Use `preview` to inspect quantity changes before applying an edit.

Formats 1 and 2 remain readable. Using construction, review, systems, or wall templates saves format 3; ordinary formula-only edits use format 2. Before the first desktop upgrade to format 3, storage automatically creates a sibling backup. Current web releases require native bridge 5 for backups, bounded PDF transfers, and Wingman attachment exports. Older apps need the pre-upgrade copy rather than the format-3 file.

See [detailed-takeoff verification](detailed-takeoff.md) for current results and pending checks. Earlier dated assembly/ceiling passes do not establish verification of these commands.

## Wingman messages and presentation

`messages.send` accepts `{ "text": "Please review this detail" }` in `payload` and records an agent message in the open project's local conversation. Optional `attachments` contain `id`, `name`, `dataUrl`, `width`, and `height`; the UI supports up to eight images and 32 MiB of encoded image data per message. CLI requests also have the existing 16 MiB transport limit, including their JSON envelope. Desktop attachments are exported to absolute local file paths. CLI responses return attachment `path`, `id`, `name`, `width`, and `height`, without image base64. Conversation saves do not change the estimate revision or undo history. Browser conversations use IndexedDB; desktop conversations use local application data.

`messages.read` accepts `{ "after": 0, "waitMs": 25000 }`. Reads are nondestructive. The optional wait is bounded to 25 seconds and runs outside the project command queue. Keep the latest message `id` as the cursor and reuse it after reconnecting. IDs and conversations are scoped to each project.

Every successfully parsed CLI request accepts an optional top-level `messagesAfter` cursor. Both success and error responses include full `messages` newer than that cursor, including attachment paths, plus `messagesProjectId`. Store the cursor with that project identity; reset it when the identity changes. If the supplied `projectId` differs from the current conversation, response delivery starts at zero. Omitting the cursor returns the entire current conversation. `messages.read` uses the envelope cursor when its payload omits `after`. Supplying `projectId` to `messages.send` or `messages.read` requires it to match the open project.

The UI's pause control rejects all non-messaging CLI commands with `WINGMAN_PAUSED`, including inspection and rendering. Commands queued before a pause remain rejected after resume; submit a new request to retry. Commands already executing may finish. UI operations and messages continue while paused.

Successful CLI `sheet.render`, `snippet.render`, and `construction.render` exports publish their view to Wingman. Each accepts an optional `caption`. `wingman.inspect` reads the presentation, `wingman.flash` expands and glows the corner preview, and `wingman.annotate` replaces local plan annotations with `{ "annotations": [{ "points": [{ "x": 10, "y": 20 }], "label": "Check", "color": "#ff8800" }], "highlightIds": [] }`. These commands do not edit the estimate.

For ordinary work, include the most recent received message ID in the next command. There is no separate acknowledgement command or destructive inbox read:

```sh
bluewing project.inspect '{"messagesAfter":12}'
bluewing messages.send '{"payload":{"text":"I checked the opening. Please confirm the head height."},"messagesAfter":12}'
bluewing messages.read '{"payload":{"after":13,"waitMs":25000},"messagesAfter":13}'
bluewing wingman.flash '{}'
```

A normal user message is delivered with the next CLI result. It does not interrupt an operation already running. The separate **Pause CLI** button cancels pending CLI work. Resume is available only in the desktop UI. The CLI cannot resume itself.
