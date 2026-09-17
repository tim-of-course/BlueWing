# MVP validation

Validated locally on September 16, 2026. The first macOS MVP supports PDF import, calibration, path/area/count drawing and editing, reusable groups, editable recipes, traceable quantities, exports, session undo/redo, local saving, a desktop CLI, and cached web updates.

The release app is at `src-tauri/target/release/bundle/macos/Bluewing.app`. This is a local Apple Silicon build requiring macOS 15.4 or newer. It is unsigned and not notarized. Windows support and a public web-release host remain deferred.

## Results

| Check                 | Result and scope                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Static checks         | TypeScript, strict lint, formatting, and Rust formatting passed.                                                                                                                                                                                             |
| Core                  | 26 tests passed, covering geometry, formulas, units, quantities, atomic commands, saving failures, revision conflicts, and undo/redo.                                                                                                                        |
| Storage and updates   | 6 platform tests passed, including real SQLite execution and IndexedDB in Chromium and WebKit.                                                                                                                                                               |
| Native unit tests     | 6 Rust tests passed.                                                                                                                                                                                                                                         |
| Development browsers  | 4 scenarios passed across Chromium and WebKit. The calibration/drawing capture had 192 reruns against a 260 budget, zero diagnostics, and zero silent holds.                                                                                                 |
| Production browsers   | 4 scenarios passed across Chromium and WebKit. The production diagnostics bridge is absent. A later Chromium run also passed and captured the final quantities screenshot.                                                                                   |
| Native bridge         | `tests/native/smoke.py` passed SQLite, CLI transport, cached-version activation, and offline reopening checks.                                                                                                                                               |
| Packaged product      | `tests/desktop/workflow.py` passed against the release app's included binaries, including import, calculation, export, image rendering, conflict handling, undo, close, and reopen.                                                                          |
| Complete web delivery | The release app downloaded the 203-file `0.1.1-qa` bundle plus its manifest, activated it between project sessions, and restarted and rendered a saved project after the local release server stopped. Download time was about 3.15 seconds on this machine. |

These are local results. GitHub Actions is configured for web verification and a macOS build, but no hosted CI run has been observed.

## Independently checked quantities

- A 24 ft wall at 8 ft high with two layers gives 384 sq ft. Adding 10% waste and rounding to 32 sq ft packages gives 14 packages covering 448 sq ft.
- Reusing the wall in a second group contributes independently; two unrounded assignments total 768 sq ft.
- A 24 by 15 ft area gives 360 sq ft, and three markers give three items.
- A separate 100 sq ft example with 10% waste gives four 32 sq ft packages covering 128 sq ft.
- A stale mutation returns a conflict without changing accepted state. Preview does not save. Reopening retains project data and clears session undo history.

The core and native CLI checks use exact authored coordinates. Browser pointer checks allow for pixel rounding at the fitted sheet scale; WebKit's area gesture measured 360.84 sq ft in one run. That tolerance does not change calculation precision.

## Real plan and visual review

The Behavioral Health Group permit set in Downloads imported as 15 sheets. Its A2.0 new-work floor plan rendered through the packaged app, including a detailed crop whose dimensions and text remained legible. This verifies a representative real PDF, not every estimating function or the correctness of an estimate for that building. The source PDF and rendered copies are excluded from Git.

The production quantities screen, native combined takeoff image, and Behavioral Health Group floor-plan images were visually inspected. Native pointer gestures could not be checked through Computer Use: its window lookup returned `cgWindowNotFound` for both Bluewing and Finder. Chromium and WebKit exercised the UI gestures; the actual native webview exercised product commands, PDF rendering, SQLite, and offline updates through the CLI. Native interactive use remains a separate manual check.

Validation caught and fixed SQLite lock contention, background-webview suspension during downloads/rendering, and low-resolution crop exports. The final release was rebuilt and the packaged workflow passed after those fixes.

Local artifacts are retained in the ignored `test-results/` and `tmp/desktop-workflow/` directories. See [README verification commands](../README.md#verify) to reproduce the checks.

## Git checkpoints

The project was initialized on `main`, with checkpoints for the Bun/Solid toolchain (`8acd9f4`), takeoff core (`5bfd6f5`), and native bridge/storage (`94955cd`). The final MVP checkpoint includes the application, browser and desktop workflows, CI, and these notes. No remote or push was configured.

## Delegated work record

All six Banana Split workflows reached mechanical completion. Their root results were inspected and integrated; all six child submissions were accepted. The host reviewed integration and ran the final packaged-product checks.

There were 12 distinct delegated agents: six workflow coordinators and six child workers. Eleven used `gpt-6-astra` with medium reasoning; the canvas worker used `gpt-6-astra` with high reasoning. Routing came from the configured preset catalog, with no workflow override. The host used GPT-6; its reasoning level is unavailable.

Runtime diagnostics recorded seven managed tool rejections, five formal revisions, six child acceptances, and zero turns without a disposition. Rejections involved unknown or unavailable message recipients and were recovered. An initial workflow launch requesting broader permissions was rejected before execution and retried with inherited permissions. Host assistance included native tooling/test approvals and integration verification; a redundant browser rerun was declined after the identical host check had passed. These events left no unresolved workflow or approval.

| Work                  | Workflow ID                               | Root coordinator                           | Children                                                                                                                                                            |
| --------------------- | ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core                  | `wf_f40e56c2-3570-42e6-a37d-a25baba381f8` | `agt_9b1c7112-c497-46c0-a2ab-d195f47bbda0` | Geometry: `agt_f8373b79-bad0-46d2-9629-29d57559657c`; calculations: `agt_05da0278-a85d-491a-af6b-0b741def4495`; session: `agt_76ad2b84-b244-46ee-8187-3ff866dc7bbb` |
| Reference inspection  | `wf_73b4489d-53eb-4f2c-a9a1-2a6344a64e30` | `agt_7d83d008-00d7-4ccd-8115-c434e357d29f` | None                                                                                                                                                                |
| Native bridge         | `wf_a7329702-c3b4-401d-ab6c-053f1dc70e85` | `agt_06f0cec0-9d81-4655-94cb-ade10491fceb` | Storage: `agt_a59c7145-b1bd-4f8a-b5fc-393894facf7d`                                                                                                                 |
| Interface             | `wf_01663db5-476d-4648-917e-8c915f97e43b` | `agt_53dd1ce4-6828-448e-95a6-f46902bc10c8` | Canvas: `agt_9ca2b268-9b2b-46bb-b666-63fe3f8d2a7d`; editors: `agt_03d1e8e0-d00f-453e-a9b1-9cfbcf2690d3`                                                             |
| Platform verification | `wf_ae9ee224-3ae6-4d9b-aced-52eb1b3cf9cf` | `agt_7cc34b6a-d3ac-463c-acb5-25d3e4af4973` | None                                                                                                                                                                |
| Application review    | `wf_b51fcbb3-9a39-4153-9f00-a0b81f1f4736` | `agt_4e8cec68-f4d3-471b-8df0-1f5fac8f1fa4` | None                                                                                                                                                                |
