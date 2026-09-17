# Bluewing

A macOS-first construction takeoff app. Import PDF plans, calibrate sheets, draw paths, areas, and counts, and calculate quantities with editable project recipes. Flat groups can reuse the same drawing objects. Quantities show source contributions, waste, whole-package rounding, and incomplete calculations.

Projects save locally as `.bluewing` SQLite files. UI and CLI edits share one TypeScript command session with revision checks and session undo/redo. The small Tauri shell provides files, database transactions, the CLI connection, and offline web bundles. Windows support follows macOS.

## Run

The initial desktop build requires macOS 15.4 or newer for the current PDF renderer's web APIs. Use Bun 1.3.14, Node from `.node-version`, Rust, and the macOS Xcode command-line tools:

```sh
bun install --frozen-lockfile
bun run desktop
```

For browser development, use `bun run dev`. It runs the real application with IndexedDB storage; Open reopens the most recently created browser project. Desktop projects use native file dialogs and SQLite.

Build the macOS app:

```sh
bun run desktop:build
```

The output is `src-tauri/target/release/bundle/macos/Bluewing.app`. The bundle includes the `bluewing` CLI beside its desktop executable in `Contents/MacOS`. The local build is unsigned and not notarized. Signing for distribution is separate from running the MVP on this machine.

## Use

1. Create a project and import a PDF. Every page becomes a sheet.
2. Choose Set scale (R) and select the scale printed on the sheet. Architectural and metric presets come first, followed by Custom ratio. For a resized plan or a missing printed scale, choose Two points, then Measure on plan, click a known dimension's endpoints, and enter its physical length. A scale is only saved when you apply it.
3. Draw a Path, Area, or Count set. Finish a gesture with Enter or Finish; Escape cancels.
4. Select drawing objects and add a named group. Assign a recipe, edit its inputs, and inspect Quantities.
5. Export CSV or JSON. Each completed edit saves before the UI accepts it. Close and reopen to continue later; undo history lasts for the current project session.

Shortcuts: V select, L path, F area, C count, R scale setup, Q drawing/quantities, Cmd-Z / Shift-Cmd-Z undo/redo, Cmd-D duplicate, Backspace/Delete remove, Cmd-0 fit sheet, and Cmd-1 actual size. Use Ctrl in place of Cmd outside macOS. Scroll zooms toward the pointer; Space-drag or middle-drag pans. Shift-click or a selection rectangle selects multiple objects; drag selected objects to move them or a selected point to edit it. Shift bypasses point and angle snapping. Snapping copies coordinates without linking objects.

Hover or focus a sheet to preview its source page. Groups appear under each sheet containing their drawing objects; selecting a group inspects its sheet-local members. The inspector's **Group for new drawing** choice is separate from inspection. Drag a panel's inner edge to resize it, or use its fixed corner control to collapse, peek, and pin it. Layout preferences are saved on this device. Right-click a sheet for its actions, and drag rows or use Alt-Up/Down to reorder them.

The compact navigator shows each group's length (ft), area (ft²), or marker count (ea), followed by its color and eye button. New groups receive distinct editable colors. Mixed groups show separate totals; uncalibrated lengths/areas show a dash. Search stays above the scrolling list and has a clear button. Sheet and group eyes hide drawing without changing estimate totals; hidden drawing cannot be selected or snapped to. These visibility choices are saved on this device. Full-canvas crosshairs follow the mouse and disappear during panning or when the pointer leaves the canvas.

The recipe editor supports number/boolean inputs, declared units, multiple outputs, and constrained formulas. Starter recipes cover wall area, floor area, counts, and a stud estimate. See the [product brief](docs/restart-brief.md) for calculation rules and deferred features.

The CLI operates the running desktop app:

```sh
src-tauri/target/release/bundle/macos/Bluewing.app/Contents/MacOS/bluewing commands.list
```

See [CLI requests and coordinates](docs/cli.md) and [building web releases](docs/web-releases.md). A public web-release host is not configured in this repository.

## Verify

Install the browsers once, then run the web checks:

```sh
bunx --no-install playwright install chromium webkit
bun run verify
```

On Linux, add `--with-deps` to the browser install. Verification runs type checking, lint, formatting, core/storage tests, development diagnostics, the production build, and production browser workflows. The platform test command uses Bun to bundle its tests and Node's SQLite implementation to execute SQL; Chromium and WebKit exercise actual IndexedDB transactions.

Native checks:

```sh
bun run build
bun run test:native
cargo build --manifest-path src-tauri/Cargo.toml --locked --bins
python3 tests/native/smoke.py
python3 tests/desktop/workflow.py
```

Set `BLUEWING_TEST_PLAN` to the local Behavioral Health Group PDF when running the desktop workflow to include its 15-sheet import and rendering check. That source plan is not stored in Git. Independent fixtures establish 384 sq ft wall area, 360 sq ft floor area, three items, and allowance/package arithmetic.

To verify full web delivery, build a release with `bun run web:release <version>` and set `BLUEWING_TEST_RELEASE_DIRECTORY` to that output directory when running `tests/desktop/workflow.py`. The test starts a local release server, stages and activates the release, stops the server, then restarts and uses the cached app. Set `BLUEWING_NATIVE_BIN_DIR` to an app bundle's `Contents/MacOS` directory to test its included binaries.

Browser traces and Solid diagnostic JSON are retained in `test-results/`. Native product evidence is written to `tmp/desktop-workflow/`. The GitHub workflow checks web behavior and builds a macOS app; a local pass does not imply a hosted CI run.

See the [MVP validation record](docs/validation.md) for the completed checks, real-plan evidence, and remaining verification limits.

The [UI restoration record](docs/ux-restoration.md) documents the subsequent reference review and restored interaction decisions.

## Development

The [Solid 2 repo skill](.agents/skills/solidjs-2/SKILL.md) covers RC-specific APIs and diagnostics. Solid is pinned to `2.0.0-rc.8` with its compatible compiler, renderer, diagnostics, and Vite integration. Keep `bun.lock` and `src-tauri/Cargo.lock` committed. Upgrade the Solid package set deliberately.

`src/core` owns plain TypeScript geometry, measurement, recipes, commands, and accepted state. `src/platform` maps records/assets to storage and orchestrates web updates. `src/app` connects UI and CLI to the session. `src/pdf` and the shared canvas painter serve both drawing and CLI images. Rust in `src-tauri` supplies generic native capabilities.

Use Git checkpoints after relevant checks pass. The old PlanVyper project is a separate reference, never a runtime dependency.
