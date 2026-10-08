# Bluewing

A construction takeoff app for Windows and macOS. Import PDF plans, calibrate sheets, draw paths, areas, and counts, and calculate quantities with editable project assemblies. Flat groups can reuse the same drawing objects. Quantities show source contributions, waste, whole-package rounding, and incomplete calculations.

Projects save locally as `.bluewing` SQLite files. UI and CLI edits share one TypeScript command session with revision checks and session undo/redo. The small Tauri shell provides files, database transactions, the CLI connection, and offline web bundles.

## Run

Use Bun (the project pins 1.3.14), Node from `.node-version`, Rust, and Python 3 for verification. Windows development requires Visual Studio Build Tools with Desktop development with C++ and the Windows SDK, the MSVC Rust toolchain, and Microsoft Edge WebView2. macOS requires 15.4 or newer and Xcode command-line tools.

```sh
bun install --frozen-lockfile
bun run desktop
```

For browser development, use `bun run dev`. It runs the real application with IndexedDB storage; Open reopens the most recently created browser project. Desktop projects use native file dialogs and SQLite.

Build the desktop app for the current platform:

```sh
bun run desktop:build
```

On Windows, the installer is in `src-tauri/target/release/bundle/nsis/`. You can also run `src-tauri/target/release/bluewing-desktop.exe` directly; `bluewing.exe` is its CLI. On macOS, the output is `src-tauri/target/release/bundle/macos/Bluewing.app`, with the CLI beside its desktop executable in `Contents/MacOS`. Local builds are unsigned; distribution signing is separate.

From PowerShell, with the desktop app running, call the CLI with:

```powershell
.\src-tauri\target\release\bluewing.exe commands.list
```

## Use

1. Create a project and import a PDF. Every page becomes a sheet.
2. Choose Set scale (R) and select the scale printed on the sheet. Architectural and metric presets come first, followed by Custom ratio. For a resized plan or a missing printed scale, choose Two points, then Measure on plan, click a known dimension's endpoints, and enter its physical length. A scale is only saved when you apply it.
3. Draw a Path, Area, or Count set. Finish a gesture with Enter or Finish; Escape cancels.
4. Select drawing objects and add a named group. Assign an assembly, edit its inputs, and inspect Quantities.
5. Export CSV or JSON. Each completed edit saves before the UI accepts it. Close and reopen to continue later; undo history lasts for the current project session.

Shortcuts: V select, L path, F area, C count, R scale setup, Q drawing/quantities, Cmd-Z / Shift-Cmd-Z undo/redo, Cmd-D duplicate, Backspace/Delete remove, Cmd-0 fit sheet, and Cmd-1 actual size. Use Ctrl in place of Cmd outside macOS. Scroll zooms toward the pointer; Space-drag or middle-drag pans. Hold B and sweep the pointer to paint-select without clicking; Alt/Option+B removes objects. Release B to return to the current tool. This temporary brush is available when no drawing or inspector edit is unfinished. Shift-click/Shift-drag adds to selection; Alt/Option-click or Alt/Option-drag subtracts. Drag selected objects to move them or a selected point to edit it. Shift bypasses point and angle snapping. Snapping copies coordinates without linking objects.

Hover or focus a sheet to preview its source page. The sidebar requests thumbnails only for visible rows and an open preview. Completed page images and previews are cached separately from the project, so scrolling away and returning can reuse them. Background preparation starts near the selected sheet and works through the remaining pages, yielding to foreground rendering and interaction. Groups appear under each sheet containing their drawing objects; selecting a group inspects its sheet-local members. The inspector's **Group for new drawing** choice is separate from inspection. Drag a panel's inner edge to resize it, or use its fixed corner control to collapse, peek, and pin it. The toolbar reserves space for collapsed panel controls. Layout preferences are saved on this device. Right-click a sheet for its actions, and drag rows or use Alt-Up/Down to reorder them.

Use **Auto-name sheets** (the **Aa** button beside Sheets) to suggest names from embedded PDF text in the bottom-right quarter of each page. Review or edit the suggestions, then apply the chosen names together. Extraction runs entirely on this device. Scanned pages without embedded text keep their existing names; Undo restores the batch.

The compact navigator shows each group's length (ft), area (ft²), or marker count (ea), followed by its color and eye button. New groups receive distinct editable colors. Mixed groups show separate totals; uncalibrated lengths/areas show a dash. Search stays above the scrolling list and has a clear button. Sheet and group eyes hide drawing without changing estimate totals; hidden drawing cannot be selected or snapped to. These visibility choices are saved on this device. A center-dot scope cursor replaces the system pointer over the canvas, alongside full-canvas crosshairs. Both disappear during panning or when the pointer leaves the canvas; panning uses a hand cursor.

The Assemblies editor manages project definitions and a device-local global library. Definitions support required number/boolean inputs, units, formulas, material outputs, and piece cut/stock lengths. Assignments have group values and individual drawing-object overrides. The 29 starter templates include modeled steel walls, box headers, joists, kicks, furring, blocking, FRP, acoustical wall panels, drywall, plywood, gypsum sheathing, cement board and 2x2/2x4 acoustical ceilings, alongside explicitly labeled formula estimates. **Add missing starters** adds new catalog entries while preserving company edits. See [assemblies and tested examples](docs/assemblies.md). See the [product brief](docs/restart-brief.md) for calculation rules and deferred features.

Project/global libraries also hold component systems with copied assembly definitions and shared inputs. Wall and ceiling assemblies apply to groups or individual traces. Changing a project definition updates its applications, while explicit local overrides remain. Imported global definitions remain independent project copies. Use the structured **Construction** panel for walls, openings, component headers, levels, sheet placements, finishes, backing, and ceilings. **Preview quantities** shows material changes before saving. Plan, 3D, and split views share generated pieces and linked source selection, with level, material, role, and selection filters. Every material object in 3D comes from the same calculated piece or surface that contributes to Quantities. Formula estimates remain explicitly unmodeled; the quantity view reports model coverage separately from calculation validity.

Construction dimensions use metres and rotations use radians internally; drawing and snippet points remain in page coordinates. Cuts follow explicit allowances and project details. Track channel flange envelopes do not impose stud-cut deductions. Header components use entered extensions and offsets; jamb centres sit outside the rough opening width. Shared conditions and multiple-member positions are explicit. The rectangular 3D envelopes do not design connections or describe metal-profile fabrication; bent/stepped track joints still need project details. Ceiling layouts clip mains, 4 ft tees, 2 ft tees, wall angle, and tile surfaces to the measured room. Enter the grid origin, direction, elevation, and actual member specifications. Waste and package rounding change purchasing quantities without adding material to the 3D layout. Hangers, connection hardware, and offcut reuse are not included.

The 3D viewer uses Three.js with WebGL 2 for depth-correct rendering and selection. Drag to orbit, right-drag to pan, and scroll to zoom. Choose isometric, top, front, back, left, or right views; fit the whole model or selected materials. **Solid** shows opaque finishes, **Framing** hides finishes, and **X-ray** shows their outlines through the framing. Desktop, Wingman, and CLI images use the same renderer and camera state. A WebGL 2 context is required for 3D. The viewer draws on demand, batches members into GPU instances, and uses the screen's pixel density up to the graphics device's limits.

Use **Review** for source-linked snippets, geometry highlights, annotations, and review marks. Relevant dependency changes flag previously reviewed sources as changed. Generation shares a 50,000-piece/surface budget and reports incomplete results when exhausted. The 3D viewer displays all generated objects matching its filters; CSV retains all generated pieces regardless of scene filters or selection.

This development release supports project format 4 only. Start a new takeoff for older projects; there are no old-format loading or migration paths. The global library also starts fresh with the current catalog. `project.backup` remains an explicit recovery-copy command. Current web releases require native bridge 7 for disposable page-image storage, backups, bounded PDF transfers, and Wingman screenshot attachments.

The CLI operates the running desktop app:

```sh
src-tauri/target/release/bundle/macos/Bluewing.app/Contents/MacOS/bluewing commands.list
```

Wingman shows the latest CLI-rendered plan or 3D location in a live corner preview. Click to swap views and click again to return. Choose **Copy AI prompt**, then **Wingman + chat** or **Chat only**, and paste it into your AI's chat to get started. In Wingman chat, Enter sends and Shift+Enter adds a new line. **Pause CLI** stops new and queued CLI actions; **End conversation** ends an active message wait. Use **Attach screenshot** or Cmd/Ctrl+Shift+X to capture any rectangle inside the app for the next message. See [Wingman behavior and verification](docs/wingman.md).

See [CLI requests and coordinates](docs/cli.md) and [building web releases](docs/web-releases.md). A public web-release host is not configured in this repository.

## Verify

Install the browsers once, then run the web checks:

```sh
bunx --no-install playwright install chromium webkit
bun run verify
```

Heavy commands use a shared resource guard across Bluewing checkouts on the same computer. Browser tests run with one worker; native builds default to one Cargo job. A second heavy command exits immediately with the active command and PID. Nested build steps share the parent's guard, so `desktop:build` can build its web assets without blocking itself.

Before starting, the guard requires a memory reading of at least 2 GiB, macOS memory pressure below critical, and system load no higher than twice the CPU count. Every three seconds it checks memory again and stops its process tree if macOS reports critical pressure or the memory reading falls below 1 GiB. macOS warning pressure logs a warning and allows work to continue. A resource refusal or stop exits with code 75, not a test pass. Run `bun run resources:check` for the current readings, memory metric, warnings, and active job. Continue lightweight checks while resources recover; keep the guard enabled when retrying.

On macOS, the memory reading is an estimate of the non-compressed memory pool, calculated from `memory_pressure -Q`'s free percentage and total RAM. This pool includes active application pages, so it does not measure how much more memory a job can allocate. The 2 GiB and 1 GiB thresholds apply to that pool. Linux uses `MemAvailable`; Windows uses available physical memory.

Use the `bun run` scripts for browser tests and builds, including focused runs such as `bun run test:dev tests/browser/assemblies.dev.spec.ts`. Direct Playwright test execution and worker-count overrides are rejected before tests run. The Python native/desktop scripts automatically enter the same guard even when called directly. Extra Cargo commands should use `bun scripts/heavy.ts -- cargo ...`. Raw external commands and other applications do not participate in the lock, so this reduces contention rather than imposing a machine-wide memory limit.

The slot uses loopback port 47631. The OS releases it when the guard exits, so there is no stale lock file to delete. Keep the guard process alive for the duration of its job; use ordinary Ctrl-C to cancel, which cleans up the supervised process tree. Process-tree cancellation is tested on macOS; Windows uses `taskkill /T` and still needs native verification.

`bun run test:tooling` checks mutual exclusion across checkouts, nested commands, startup refusal, cancellation of detached descendants, exit codes, worker enforcement, and release after a killed guard. These tests use tiny dummy jobs and injected readings, without exhausting real memory. No desktop rebuild is needed for changes confined to this guard or test configuration.

On Linux, add `--with-deps` to the browser install. Verification runs type checking, lint, formatting, core/storage tests, development diagnostics, the production build, and production browser workflows. The platform test command uses Bun to bundle its tests and Node's SQLite implementation to execute SQL; Chromium and WebKit exercise actual IndexedDB transactions.

Native checks:

```sh
bun run build
bun run test:native
bun run native:build
python3 tests/native/smoke.py
python3 tests/desktop/workflow.py
python3 tests/desktop/assemblies.py
python3 tests/desktop/detailed.py
python3 tests/desktop/wingman.py
```

Set `BLUEWING_TEST_PLAN` to the local Behavioral Health Group PDF when running the desktop workflow to include its 15-sheet import and rendering check. That source plan is not stored in Git. Independent fixtures establish 384 sq ft wall area, 360 sq ft floor area, three items, and allowance/package arithmetic.

The detailed-takeoff desktop/CLI workflow is `tests/desktop/detailed.py`. Optionally set `BLUEWING_TEST_DETAILED_PLAN` to the local path of the private Bingham Elementary School conformed PDF (about 333 MB, 164 pages) for real-plan import/render coverage. The downloaded plan belongs in ignored `tmp/reference-plans/` and is not committed. The command above is a verification instruction, not a claimed pass. See [the current detailed-takeoff report](docs/detailed-takeoff.md) for pending checks and actual results.

On Windows, use `python` in place of `python3`. Set test environment variables with PowerShell syntax, for example `$env:BLUEWING_NATIVE_BIN_DIR = "$PWD/src-tauri/target/release"`. Formatting accepts the checkout's LF or CRLF line endings.

To verify full web delivery, build a release with `bun run web:release <version>` and set `BLUEWING_TEST_RELEASE_DIRECTORY` to that output directory when running `tests/desktop/workflow.py`. The test starts a local release server, stages and activates the release, stops the server, then restarts and uses the cached app. Set `BLUEWING_NATIVE_BIN_DIR` to an app bundle's `Contents/MacOS` directory to test its included binaries.

Browser traces and Solid diagnostic JSON are retained in `test-results/`. Native product evidence is written to `tmp/desktop-workflow/`. The GitHub workflow checks web behavior and builds a macOS app; a local pass does not imply a hosted CI run.

See the [MVP validation record](docs/validation.md) for the completed checks, real-plan evidence, and remaining verification limits.

The [UI restoration record](docs/ux-restoration.md) documents the subsequent reference review and restored interaction decisions. The [PDF worker performance record](docs/pdf-worker-performance.md) describes the rendering refactor and separates passing checks from pending browser/native verification.

## Icon assets

Edit the vector master at [`assets/brand/bluewing.svg`](assets/brand/bluewing.svg), then run `bun run icons:generate`. The script uses the installed Tauri CLI to export the browser SVG/favicons and Windows/macOS icons. Commit the master and generated files together. See [the branding notes](docs/branding.md) for the design, research, and output sizes.

## Development

The [Solid 2 repo skill](.agents/skills/solidjs-2/SKILL.md) covers RC-specific APIs and diagnostics. Solid is pinned to `2.0.0-rc.8` with its compatible compiler, renderer, diagnostics, and Vite integration. Keep `bun.lock` and `src-tauri/Cargo.lock` committed. Upgrade the Solid package set deliberately.

`@solidjs/diagnostics` is installed and enabled by `diagnostics: true` in Vite. Development browser tests save its artifacts in `test-results/dev/`. For a manual desktop recording, POST `{"method":"begin"}` to `http://127.0.0.1:1420/__solid/diagnostics`, reproduce the interaction, then POST `{"method":"costs"}` and `{"method":"end"}`. Keep one development window connected while recording. These reports explain reactive updates; browser performance recordings are also needed for PDF parsing, canvas work, and long input delays. Production bundles omit the diagnostics bridge.

Desktop PDFs use random-access reads from their import snapshot or saved SQLite asset, with automatic whole-file prefetch disabled. Pages render on demand and through background preparation. Obsolete foreground renders are cancelled; shared requests retain work still needed by another viewer. Two idle PDF workers are retained for reuse; active operations stay pinned. PDF.js still reserves a source-length worker buffer and retains fetched bytes until that worker is destroyed, so this is not a constant-memory PDF engine. Browser development currently loads imported asset bytes in full.

The main plan image uses a 3,300-pixel maximum dimension; previews use 640 pixels. Page images have a 256 MiB memory budget and previews have a separate 32 MiB budget, excluding images held by viewers after eviction, encoded PNGs, PDF workers and browser/GPU overhead. The main viewer holds an immutable image lease instead of copying a full-size canvas. Recent foreground images have priority over speculative background images. Desktop PNGs live in the OS temporary directory under `bluewing-page-images-v1`, never in or beside the takeoff file. Bluewing does not purge them on project close or reboot; the OS may remove them, and missing or unreadable images are regenerated. Browser development uses disposable Cache Storage instead. Background preparation eventually covers every page, one at a time, and makes previews from full images without another PDF render. The footer shows preparation progress and lets the user pause or resume it. Selected-page pixels display before PNG encoding and disk persistence finish. These caches contain source pixels only; overlays and calculations remain live. Rebuild the native binaries for bridge 7 when updating from an older checkout.

See [the PDF worker performance record](docs/pdf-worker-performance.md) for the current implementation and pending runtime checks. The earlier [desktop performance record](docs/desktop-performance.md) retains historical Bingham measurements for comparison.

PDF.js 6.4.299 runs page drawing, preview resizing, and PNG encoding in a dedicated worker. A sibling parser worker communicates directly with it; font and drawing-operator traffic bypasses the UI. Native worker fonts and OffscreenCanvas render the actual PDF. PDF.js's software filter paths preserve transfer maps and transparency without DOM SVG filters. Cached PNGs decode in a separate lazy worker. Closing a document terminates both PDF workers and settles pending requests, so the earlier range-destruction dependency patch is no longer used. Unsupported worker graphics APIs report an error rather than performing heavy PDF drawing on the UI thread.

Choose **Record performance** in the footer, reproduce the slowdown, then choose **Save performance recording**. The JSON includes page/cache stages, worker draw/resize/encoding times, frame gaps, and supported browser input-delay and long-task measurements. Capture is bounded and starts only on request. Reports omit plan text, file paths, screenshots, and DOM targets; they include browser/device context and source page IDs. Missing timing APIs are reported explicitly. The CLI offers `performance.start`, `performance.status`, `performance.stop`, and `performance.export`; see [CLI diagnostics](docs/cli.md#performance-recordings).

Activity summaries preserve whole-recording counts, durations, worst completed stages and latest preparation progress after detailed events are overwritten. See the [real-plan before/after comparison](docs/performance-diagnostics-comparison.md) for what the diagnostics detected and what remains unverified.

Recordings also time pointer handling, canvas painting, trace commits, full-page display and CLI commands. Frame summaries count gaps above 17, 33, 50 and 100 ms. A small [workflow performance suite](docs/workflow-performance.md) runs as part of `verify`; use `bun run test:performance` for just tracing, page navigation, navigator search and CLI lookup/view scenarios. The document defines measurement boundaries, budgets and report locations.

`src/core` owns plain TypeScript geometry, measurement, recipes, commands, and accepted state. `src/platform` maps records/assets to storage and orchestrates web updates. `src/app` connects UI and CLI to the session. `src/pdf` and the shared canvas painter serve both drawing and CLI images. Rust in `src-tauri` supplies generic native capabilities.

Use Git checkpoints after relevant checks pass. The old PlanVyper project is a separate reference, never a runtime dependency.
