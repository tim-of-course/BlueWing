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

`batch` takes `payload.commands`, an array of `{name,payload}` commands, and saves them as one revision and one undo step. `preview` evaluates the same array without saving and returns the temporary project and results. Neither accepts nested batches or history operations. `history.undo` and `history.redo` use the shared UI history and advance the revision.

Geometry points use unzoomed, rotated PDF viewport coordinates: origin at the top left, positive x rightward, positive y downward. Import stores the original PDF-to-page transform. Calibration changes physical measurements, never the authored points. `sheet.calibrate` accepts two page points and a known distance in `ft`, `in`, `m`, or `mm`.

Prefer `sheet.scale` when the sheet states its printed scale. Its payload is `{ "id": "SHEET_ID", "paper": { "value": 0.25, "unit": "in" }, "real": { "value": 1, "unit": "ft" } }` for 1/4″ = 1′-0″. Each distance supports `ft`, `in`, `m`, or `mm`; 1 mm on paper to 100 mm real distance sets 1:100. Both scale commands save through the same session and support Undo.

`sheet.render` writes a PNG and returns its sheet ID, revision, pixel dimensions, page bounds, `pageToPixel`, and `pixelToPage` transforms. Supply `sheetId`, an output `path`, and optionally `maxDimension` (capped at 4096), `mode` (`plan`, `takeoff`, or `combined`), and page-coordinate `bounds`. It shares the takeoff painter with the drawing canvas. Use the returned inverse transform when turning an observed pixel position into a geometry edit.

`quantities.inspect` returns source contributions, diagnostics, allowance details, purchased quantities, and totals. `quantities.export` returns CSV or JSON text in `data`; the UI export buttons save that same calculation. Invalid calculations mark affected totals incomplete.

`web.stage` accepts a manifest URL and verifies the complete web release before caching it. `web.activate` accepts the staged version and reloads the web application after acknowledging the terminal response. Close the project and finish or cancel drafts first. These commands do not rebuild the Rust shell.
