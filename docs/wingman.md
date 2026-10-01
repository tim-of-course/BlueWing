# Wingman

Wingman gives a user and an external CLI participant a shared visual and a small project conversation. Bluewing does not run a model or an agent.

## Use

Choose **Copy AI prompt**, then **Wingman + chat** to talk in either place, or **Chat only** to keep the conversation in your AI's chat. Paste the prompt into your AI's chat. The desktop app supplies the installed command path and current project automatically. No model or provider setup lives in Bluewing. A browser-only workspace explains that connecting needs the desktop app.

Enter sends a chat message; Shift+Enter adds a new line. Confirming composed text does not send it. If copying a prompt is unavailable, select and copy the displayed prompt instead.

Wingman sits in the drawing workspace's lower-right corner, keeping inspector and sheet controls accessible. Expand or collapse the preview independently of Chat. Successful CLI `sheet.render`, `snippet.render`, and `construction.render` calls publish their view quietly. Optional `caption` text describes the view; otherwise the app uses the sheet name or a 3D label. `wingman.flash` expands and briefly glows the preview, including a nonanimated indication when reduced motion is enabled.

Click the preview to swap with the main workspace. Clicking again restores the user's sheet, camera, selection, group context, visibility, workspace mode, and 3D filters. Subsequent agent renders while swapped update the agent view without replacing the saved return view. Draft edits disable swapping; updates that arrive during an edit remain available through **Show latest agent view**. Preview content follows accepted project edits. It is not the original exported PNG. A deleted source is shown as unavailable, and capped 3D previews report omissions.

**Attach screenshot** or **Cmd/Ctrl+Shift+X** captures a rectangle anywhere inside the app, including headers, sidebars, plans, and 3D. Captures remain in the message draft until sent and can be removed or supplemented. Escape cancels capture. Sent images stay fixed. The application content is captured, not operating-system chrome or other apps.

CLI messages are delivered as text with image paths, including on application errors. Message reads do not remove history. Callers report their last received message so concurrent calls or a lost response cannot consume another caller's messages. Chat saves separately from estimate revision and Undo.

Conversations and screenshot files are local application data keyed by project identity. They survive reopening on the same device but are not included when copying the `.bluewing` file to another computer. No model, provider, external message service, or agent runtime is embedded. See [CLI examples and cursor rules](cli.md#wingman-messages-and-presentation).

Pause blocks new non-messaging CLI actions and rejects queued actions that have not started. A running atomic action can finish. Resuming never replays rejected actions. Desktop editing and messaging remain available.

**Waiting for your message** appears while a CLI message wait is pending. **End conversation** wakes that wait and prevents it renewing. Neither asks an external host to stop a running task. An agent that cannot remain available should explain that in Wingman. If its process disconnects, the waiting indicator clears when the outstanding application wait expires, within 25 seconds. Bluewing communicates your intent; the external host controls agent availability.

## Discovery and conversation verification, October 1, 2026

Implemented on `main`: two copyable connection prompts, concise CLI help and `connect`, reply guidance beside user messages, native `messages.wait` renewal, waiting/end controls, and Enter-to-send with Shift+Enter for a new line. Connection prompts carry the installed executable, shell quoting, project identity, and any custom application-data location. They communicate conversation intent without saving a global mode or choosing an agent provider.

| Check                               | Result                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, ESLint, formatting      | Passed                                                                                                                                                                          |
| Core tests                          | 128 passed; includes prompt quoting, selected intent, cursor delivery, user-only wake, concurrent waits, timeout, stop, project switch/reopen, pause, and attachment paths      |
| Development browsers                | 38 passed across Chromium and WebKit; no Solid diagnostics or silent holds                                                                                                      |
| Production browsers                 | 28 passed across Chromium and WebKit                                                                                                                                            |
| Platform storage regression         | Nine passed                                                                                                                                                                     |
| Rust tests                          | 13 passed; includes native renewal, identity binding, retained cursors, terminal/error responses, malformed requests, and timeout races                                         |
| Production web and macOS app builds | Passed                                                                                                                                                                          |
| Packaged native CLI workflow        | Passed; includes concise help, connection modes, a real 27-second wait spanning renewal, nonblocking inspection, project-close termination, and stale wait tokens after restart |

Browser checks cover both copied prompts, missing/denied clipboard fallback, Enter vs Shift+Enter, composition and repeated key events, waiting visibility, and End conversation. Existing visual swap, annotations, screenshot attachments, and persistence checks continue to pass. Native Computer Use again returned `cgWindowNotFound` by both app path and bundle ID. Native clipboard and keyboard/pointer interaction remain unverified; the browser results do not establish those behaviors. Windows native behavior was not run. Heavy checks ran serially under the resource guard without resource refusals.

A final keyboard assertion reproduced Chromium losing composer focus after sending. The composer now stays focused while read-only during the save. After that fix, all 12 focused development and four production Wingman checks passed, static checks passed, and the macOS app was rebuilt.

A live Astra-low agent through the Codex harness used the exact generated **Wingman + chat** prompt against the packaged CLI. It inspected the isolated sample, answered its seeded user question with `messages.send`, and started `messages.wait` with the received cursor. The host observed the waiting process after 20 seconds and closed the sample project; the agent received `project_changed` and stopped successfully. This establishes routing and a bounded active wait; it does not establish a second live user message after idle or indefinite availability. User-message wake and multiple exchanges are covered by deterministic browser/core tests. The native UI limitation prevented typing the live question through the desktop. Evidence is in ignored `tmp/wingman-live/`.

Four independent Banana Split roots completed successfully, with no descendants: UI implementation, native implementation, read-only review, and the live conversation check. All used configured Astra low; the host used Astra ultra. Runtime diagnostics recorded no managed tool rejections, revisions, acceptances, or turns without disposition. The host approved five exact local CLI operations for the live agent after its sandbox blocked loopback access. One host context message reached the UI worker after completion and was rejected without affecting the work. Host verification fixed lint findings and a Chromium focus-loss issue after Enter-to-send.

| Assignment              | Workflow                                  | Root agent                                 |
| ----------------------- | ----------------------------------------- | ------------------------------------------ |
| UI and browser coverage | `wf_f0d97443-6f1b-4f3e-b97e-ec017e281b1c` | `agt_94133e23-e5b5-48f7-aed1-891650c3d89d` |
| Native waiting          | `wf_50f929f7-6910-4e23-826f-ac981b4234bf` | `agt_57b569e8-855a-4e00-a15d-e9927f9439a1` |
| Code review             | `wf_35409ab7-1989-483e-acc1-d73b70fd18fd` | `agt_b9070ecd-269e-478c-b350-3207956c2e06` |
| Live agent check        | `wf_578bf877-0f86-432a-bcdb-c3322eb01ad0` | `agt_e3da8aa0-fbae-4804-98f7-848d33d587ee` |

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

The initial work used `feat/wingman` and was merged to `main`. `c2b46ad` records the agreed scope/contracts; `dafb6b1` records the integrated feature and test workflows.

Five independent Banana Split worker contexts completed successfully, with no descendants, plus the host coordinator. All five workers used configured `gpt-6-astra` with low reasoning. The host model is GPT-6; its exact routing/reasoning setting is unavailable. Host review found and fixed a chat reactive relay, reset-on-edit behavior, and inspector overlap before the final passing development suite.

| Assignment                  | Workflow                                  | Root agent                                 | Mechanical status / outcome |
| --------------------------- | ----------------------------------------- | ------------------------------------------ | --------------------------- |
| Messaging and native bridge | `wf_5e851137-9a78-4eb3-a535-9514ba60dd49` | `agt_ce015343-63c1-4f89-9595-185c0e5d8e36` | Completed / success         |
| Screenshot capture          | `wf_a599ee29-d0f6-4a9a-9547-cc5eeb0107ab` | `agt_8a44c71d-851f-42d7-a07f-ee4f0178a932` | Completed / success         |
| Viewport adapters           | `wf_06db309e-4242-4526-aacd-b6cea5699ddc` | `agt_d4b631b1-7e5e-487f-9e06-e1be3c813154` | Completed / success         |
| Browser test authoring      | `wf_ef77d0e7-861e-43cf-af16-4d718cfbb3aa` | `agt_d19bfa4b-e679-4278-aede-429d61aa8cdf` | Completed / success         |
| Native workflow authoring   | `wf_423a62bf-e4eb-4885-9e47-3e8ebd8d9f0d` | `agt_a9717f80-9d33-4d41-9de7-f0b1e3e1afae` | Completed / success         |

Recorded managed-tool rejections: two `banana_send:not_found` attempts by roots trying to address a parent. Neither blocked implementation. No recorded formal revisions, child acceptances, or turns without disposition. The host approved the exact screenshot dependency installation and the native workflow's Python syntax check under existing task authorization. One host follow-up reached an already completed worker and was rejected; the host completed that integration directly. All build/browser/native execution remains host-owned and serialized.
