# Wingman

Wingman gives a user and an external CLI participant a shared visual and a small project conversation. Bluewing does not run a model or an agent.

## Use

Wingman sits in the drawing workspace's lower-right corner, keeping inspector and sheet controls accessible. Expand or collapse the preview independently of Chat. Successful CLI `sheet.render`, `snippet.render`, and `construction.render` calls publish their view quietly. Optional `caption` text describes the view; otherwise the app uses the sheet name or a 3D label. `wingman.flash` expands and briefly glows the preview, including a nonanimated indication when reduced motion is enabled.

Click the preview to swap with the main workspace. Clicking again restores the user's sheet, camera, selection, group context, visibility, workspace mode, and 3D filters. Subsequent agent renders while swapped update the agent view without replacing the saved return view. Draft edits disable swapping; updates that arrive during an edit remain available through **Show latest agent view**. Preview content follows accepted project edits. It is not the original exported PNG. A deleted source is shown as unavailable, and capped 3D previews report omissions.

**Attach screenshot** or **Cmd/Ctrl+Shift+X** captures a rectangle anywhere inside the app, including headers, sidebars, plans, and 3D. Captures remain in the message draft until sent and can be removed or supplemented. Escape cancels capture. Sent images stay fixed. The application content is captured, not operating-system chrome or other apps.

CLI messages are delivered as text with image paths, including on application errors. Message reads do not remove history. Callers report their last received message so concurrent calls or a lost response cannot consume another caller's messages. Chat saves separately from estimate revision and Undo.

Conversations and screenshot files are local application data keyed by project identity. They survive reopening on the same device but are not included when copying the `.bluewing` file to another computer. No model, provider, external message service, or agent runtime is embedded. See [CLI examples and cursor rules](cli.md#wingman-messages-and-presentation).

Pause blocks new non-messaging CLI actions and rejects queued actions that have not started. A running atomic action can finish. Resuming never replays rejected actions. Desktop editing and messaging remain available.

## Verification, September 29, 2026

All heavy checks use the repository resource guard with one browser worker and one Cargo job. The guard stopped one production browser run when macOS reported warning memory pressure. After pressure returned to normal, the remaining WebKit suite passed. Stopped or unrun checks are not passes.

| Check                          | Result                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| TypeScript, ESLint, formatting | Passed                                                                                                    |
| Core tests                     | 119 passed, including nine messaging tests                                                                |
| Resource-guard tooling tests   | Nine passed                                                                                               |
| Development browsers           | 34 passed across Chromium and WebKit, with no Solid diagnostics or silent holds                           |
| Production web build           | Passed; existing bundle-size advisory remains                                                             |
| Production browsers            | 26 workflows passed across Chromium and WebKit; resource-stopped run completed with a separate WebKit run |
| Platform storage regression    | Nine passed                                                                                               |
| Rust tests and native build    | Nine Rust tests passed; debug binaries and macOS release app built                                        |
| Native Wingman CLI workflow    | Passed against both debug and packaged release desktop/CLI                                                |
| Native UI pointer interaction  | Not completed: Computer Use returned `cgWindowNotFound` for the packaged app                              |
| Windows native behavior        | Not tested in this session                                                                                |

Focused browser coverage exercises quiet publication, captions, flashing, annotation pixels without estimate changes, exact plan restoration after another render, live 3D updates, split-view/filter restoration, unfinished-drawing protection, successful/failed-command message delivery, nondestructive cursors, long polling without blocking commands, pause with continued UI editing and chat, screenshot pixels from headers/sidebar/canvas regions, attachment removal/cancellation, and conversation persistence after reopening.

Core coverage includes concurrent readers, persistence failure without consumed IDs, immediate cancellation of queued commands, no replay after resume, completion of an already executing action, request cursor validation, project identity, and attachment paths without base64 in CLI responses. The native workflow checks exported image bytes and path persistence across process restart, message/estimate/Undo separation, real transport concurrency, and sheet/snippet/3D publication. The native workflow passed all of these assertions.

Repeat the feature checks serially with:

```sh
bun run test:production
bun run test:platform
bun run test:native
bun run native:build
python3 tests/desktop/wingman.py
```

Browser evidence is in ignored `test-results/dev/` and `test-results/production/`. The native workflow writes ignored `tmp/wingman-workflow/commands.json`, its native log, and rendered PNGs. A passing browser test does not establish native WebView pointer behavior. Computer Use recognized the packaged app but could not locate its window (`cgWindowNotFound`); manual screenshot dragging and pause/swap clicking still need native UI verification. Native PNG rendering, attachment export/storage, CLI messaging, and publication were verified through the real native bridge.

## Implementation checkpoints and delegated work

Work is on `feat/wingman`. `c2b46ad` records the agreed scope/contracts; `dafb6b1` records the integrated feature and test workflows.

Five independent Banana Split worker contexts completed successfully, with no descendants, plus the host coordinator. All five workers used configured `gpt-6-astra` with low reasoning. The host model is GPT-6; its exact routing/reasoning setting is unavailable. Host review found and fixed a chat reactive relay, reset-on-edit behavior, and inspector overlap before the final passing development suite.

| Assignment                  | Workflow                                  | Root agent                                 | Mechanical status / outcome |
| --------------------------- | ----------------------------------------- | ------------------------------------------ | --------------------------- |
| Messaging and native bridge | `wf_5e851137-9a78-4eb3-a535-9514ba60dd49` | `agt_ce015343-63c1-4f89-9595-185c0e5d8e36` | Completed / success         |
| Screenshot capture          | `wf_a599ee29-d0f6-4a9a-9547-cc5eeb0107ab` | `agt_8a44c71d-851f-42d7-a07f-ee4f0178a932` | Completed / success         |
| Viewport adapters           | `wf_06db309e-4242-4526-aacd-b6cea5699ddc` | `agt_d4b631b1-7e5e-487f-9e06-e1be3c813154` | Completed / success         |
| Browser test authoring      | `wf_ef77d0e7-861e-43cf-af16-4d718cfbb3aa` | `agt_d19bfa4b-e679-4278-aede-429d61aa8cdf` | Completed / success         |
| Native workflow authoring   | `wf_423a62bf-e4eb-4885-9e47-3e8ebd8d9f0d` | `agt_a9717f80-9d33-4d41-9de7-f0b1e3e1afae` | Completed / success         |

Recorded managed-tool rejections: two `banana_send:not_found` attempts by roots trying to address a parent. Neither blocked implementation. No recorded formal revisions, child acceptances, or turns without disposition. The host approved the exact screenshot dependency installation and the native workflow's Python syntax check under existing task authorization. One host follow-up reached an already completed worker and was rejected; the host completed that integration directly. All build/browser/native execution remains host-owned and serialized.
