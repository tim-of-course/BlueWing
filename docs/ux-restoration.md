# UI flow restoration

September 17, 2026. This review compares Bluewing with the tracked PlanVyper reference at `1738faab46fee3878f34c497bff39b19c3096bf0`. The reference stays read-only and outside the application. This is not a claim that every legacy behavior was correct or requested by the user.

## Evidence of intent

The current user explicitly requested plan previews on hover, groups under sheets, ordinary wheel zoom, and draggable panel dividers. The old [product specification](../../PlanVyper/docs/PlanVyper_Product_Technical_Spec_v1_1.html) records detailed navigator and panel requirements in its Application Shell section and acceptance criteria AC-019/020. Those passages date to the original reference commit, rather than later repair work.

[Mockup findings](../../PlanVyper/docs/Mockup_Findings_PlanVyper.html) explicitly explain the right-side tool rail, moving next-drawing settings into the inspector, stable previews over child groups, and informative group symbols. [Addendum 05](../../PlanVyper/docs/PlanVyper_Product_Technical_Spec_v1_1_Review_Addendum_05.html) records product-owner approval for preserving authoring context and calibration behavior. The original user conversations are not present in the inspected repository, so the other requirements are described as documented design intent, not authenticated user quotations. Git author names alone do not establish user origin.

Two small reference commits corroborate deliberate follow-through: `821e2ce` adds keyboard-focus previews, and `2d9d1a7` persists panel layout preferences.

## Findings and changes

| Finding                                                      | Change in Bluewing                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hover previews were missing.                                 | Real PDF previews appear beside hovered or keyboard-focused sheets without activating them. The preview stays on the same sheet while moving over its child groups. Loading and failure states are visible.                                                                                                            |
| Groups were detached from sheet navigation.                  | Groups appear under each sheet containing their members. A shared group can appear under multiple sheets without copying it. Empty groups remain accessible. This does not introduce parent/child groups in project data.                                                                                              |
| Panel width sliders were the wrong affordance.               | Both panels have draggable inner-edge separators with keyboard resizing. The sliders and their footer space are removed.                                                                                                                                                                                               |
| Collapse controls lacked the old peek/pin behavior.          | Fixed edge controls collapse, temporarily reveal on hover/focus, and pin panels. Peeks preserve keyboard focus and close with Escape. Drawing tools can reveal the inspector temporarily. Widths and pinned state are saved per device. Duplicate header panel buttons are removed.                                    |
| Wheel scrolling panned instead of zooming.                   | Ordinary wheel and pinch zoom toward the pointer. Space-drag and middle-drag pan.                                                                                                                                                                                                                                      |
| Panel changes and workspace switches reset the drawing view. | Resizing preserves zoom and the page point at the view center. Sheet views are remembered while the project is open. The drawing canvas remains mounted when viewing quantities.                                                                                                                                       |
| Group clicks did not select the visible members.             | A group row activates its sheet, selects that sheet's members, and opens inspection. Counts are sheet-local. Cross-sheet group identity and calculations remain shared.                                                                                                                                                |
| Inspection silently changed the next drawing's group.        | Separate UI state holds the next-drawing group. The New Work inspector exposes that choice explicitly and preserves it through commits. Inspecting a group or quantity source does not change it. Ungrouped drawing remains allowed by the restart brief.                                                              |
| Selecting geometry did not show its measurements.            | The selection inspector shows object name/type, path length, area/perimeter, or count; compatible multi-selection totals; calibration diagnostics; and group membership controls. Name edits use revision-aware saving.                                                                                                |
| Sheet rows were unnecessarily tall and noisy.                | Rows are compact, text-first, and truncate long names. Dimensions move to properties; calibration uses restrained text and accessible labeling. No permanent thumbnails or large generic page icons.                                                                                                                   |
| Sheet discovery and ordinary row operations were missing.    | Sheets/groups filter, non-activating sheet context menu, rename, properties, delete with confirmation, and explicitly named source-sheet duplication. Drag reorder has a visible insertion cue and Alt-Up/Down equivalent. Order persists through saving and reopening.                                                |
| Editing names and shortcuts were misleading or incomplete.   | Immediate Copy is renamed Duplicate, with Cmd/Ctrl-D. Backspace works as macOS Delete outside fields. Canvas fit and selection controls are available without resetting the tool. Text-field editing keeps ordinary typing behavior.                                                                                   |
| Multi-object selection and movement were cumbersome.         | Rectangle selection, Shift-additive selection, and direct dragging of selected objects complement point editing and Shift-click. Independent objects remain independent.                                                                                                                                               |
| Snapping lacked the deliberate drafting assistance.          | Nearby-point snapping remains, paths gain assistance near multiples of 45 degrees, and Shift bypasses snapping. A snap indicator makes the result visible. No automatic junctions are introduced.                                                                                                                      |
| Legacy draft finishing rules differ from the restart.        | Enter/Finish commits and Escape cancels remain explicit. The old Escape-to-commit convention is not silently restored. Escape deselection is retained separately.                                                                                                                                                      |
| All groups used the same dot.                                | Color and compact path/area/count/mixed symbols describe member kinds. Empty recipe-backed groups derive their cue from compatible recipe kinds; the cue does not restrict membership.                                                                                                                                 |
| Formula authoring and quantity review needed better context. | Recipe editor gains a variable/unit/function reference and a read-only preview on selected drawing with default inputs. Existing dimensional diagnostics remain. Quantities gains a filter for source breakdowns; the project totals remain project-wide. Existing source links and waste/package explanations remain. |
| Persistent chrome did not show enough estimating context.    | The status line shows calibration and selected count; floating zoom/fit controls remain near the canvas. Panel headers are compact and aligned with fixed controls. The right tool rail stays visible during inspector peeks.                                                                                          |

Additional ordinary-flow corrections: New/Open are unavailable while a project is already open, rather than opening a form that cannot succeed; unfinished inspector edits keep selection from changing out from under their editor; sheet menus support keyboard invocation and arrow navigation.

## Deliberate limits

This pass does not revive Layers, nested group data, shared topology, geometry generators, permanent history, collaboration, or recipe publication/versioning. Those remain excluded by the restart decisions.

The old design also has a full native command menu, true clipboard cut/copy/paste across sheets, a selection brush, formula autocomplete, and richer quantity sorting. This pass restores implemented actions and their names without presenting those larger interactions as complete. Source-sheet duplication duplicates the source page and calibration, not its takeoff. Group authoring currently chooses one group for the next drawing; membership editing still supports multiple groups.

## Verification

TypeScript, lint, formatting, 26 core tests, and six storage/update tests passed. Ten development scenarios and six production scenarios passed across Chromium and WebKit. Captured development scenarios reported no Solid diagnostics or silent holds. The navigator workflow also checks selection measurements/name saving, a 192 sq ft recipe preview from a 24 ft wall with default inputs, and saved sheet order. The final sheet-menu Escape correction was checked in focused development and production navigator runs.

The navigator and hover preview were visually reviewed from browser screenshots. The macOS app was rebuilt at `src-tauri/target/release/bundle/macos/Bluewing.app`. Computer Use still returned `cgWindowNotFound` for Bluewing, so this pass does not claim native pointer verification. Restart an already-running app to load the rebuilt UI.

Git checkpoint `b16d337` saves persistent sheet ordering and separate drawing-assignment state. The subsequent **Restore intentional sheet navigation and editing interactions** checkpoint saves the UI, checks, and documentation. No dependency versions changed.

## Delegation record

Four Banana Split workflow coordinators performed the reference audit, canvas work, panel component, and selection inspector; none spawned children. All used the configured `gpt-6-astra` medium-reasoning preset. The host model is GPT-6; its reasoning level is unavailable. The host integrated the work and ran browser verification. One canvas test launch was declined while the host was changing App; the host subsequently ran the integrated tests instead.

All four workflows reached mechanical completion with successful root outcomes. Runtime diagnostics recorded zero managed tool rejections, formal revisions, child acceptances, or turns without a disposition. The canvas coordinator processed additional host context over three continuation turns. Host review fixed a selection-inspector effect callback that returned the signal setter's boolean as a cleanup value, and integration checks caught and repaired camera effect relays before the final passing runs.

| Work                | Workflow                                  | Coordinator                                |
| ------------------- | ----------------------------------------- | ------------------------------------------ |
| Reference audit     | `wf_f3547621-f084-4984-b471-4f5194080501` | `agt_64996474-8f74-411a-bc9b-7efbfad67dae` |
| Canvas              | `wf_881d2178-35d3-48bf-97cc-a85dd5d000cd` | `agt_e40d7c39-96ba-4f02-a5f9-ab7154d6bced` |
| Panels              | `wf_42d1b144-db18-4704-9ea5-fee612b2aa9d` | `agt_f821f17e-e107-4423-baa0-76d388c7005f` |
| Selection inspector | `wf_bd759c0f-8d33-4efa-a758-b50040ba6c17` | `agt_2a4df6ce-91d7-46ae-8111-3ec6b3292641` |

## Printed-scale follow-up

Set scale (R) now opens presets and custom paper-to-real ratios before offering two-point measurement. Architectural presets use the same fractions as PlanVyper; metric ratios and true 1:1 are also available. New sheets suggest 1/4″ = 1′-0″ without applying it. Reopening shows the saved scale, and the footer uses a matching preset label when available. The explicit `sheet.scale` command shares persistence, revision checks, and Undo with the UI. Existing geometry is unchanged when a scale is applied.

Reference: PlanVyper `ModalManager.tsx` scale setup and `store/calibration.ts`. This follows the user's September 17 direction; measurement remains useful when the PDF has been resized or the printed scale is missing.

Follow-up validation: static checks, 28 core tests, 6 platform tests, 12 development browser tests, and 8 production browser tests passed. Chromium and WebKit verified ratio entry, preset changes, two-point measurement, cancellation, Undo/Redo, and reopening. Development captures had no diagnostics or silent holds. Printed-scale test gestures use actual-size zoom to avoid browser pointer rounding changing the physical fixture dimensions. Production screenshots of both scale forms were visually checked.

The follow-up reference review used one Banana Split coordinator on configured `gpt-6-astra` / medium reasoning, with zero child agents. Workflow `wf_4e57d6f9-be91-4554-a577-5a2637c278d7`, coordinator `agt_80509b5d-0955-4f6d-8d3b-934e5f50084e`, completed with a successful read-only result. Runtime diagnostics recorded no rejections, revisions, acceptances, or turns without a disposition; there were no approval requests or host-assisted actions. The GPT-6 host implemented and verified the change; its reasoning level is unavailable.

## Compact functionality follow-up

The user supplied PlanSwift image `2998.jpg` and made compact functionality a product priority. The implementation retains Bluewing's styling and follows the reference's useful arrangement:

- Full-canvas horizontal and vertical crosshairs track the mouse, remain legible over light/dark content, and disappear during pan or after leaving the canvas. A separate overlay avoids repainting the PDF when moving the pointer in selection mode.
- Sheet rows are 24px and group rows 22px. One-line groups show a kind icon, truncated name, right-aligned measured totals, a solid color square, and a separate visibility button. New groups receive distinct colors automatically, and those colors remain editable. Totals use ft, ft², and ea, with separate values for mixed geometry and unavailable physical measurements shown as dashes.
- The 26px search has an explicit clear button and remains above the scrolling list. Indentation is tighter; header padding is reduced. Sheet preview, context menus, ordering, panel resizing, and keyboard access remain.
- Per-sheet and per-group visibility is saved per project on this device. Hidden drawing cannot be selected or snapped to, and hiding removes it from the current selection. The PDF remains visible. Measurements, recipe quantities, and exports are unaffected. Geometry shared by groups remains visible through any visible group.
- Following a quantity source or saving new drawing into a hidden group reveals the relevant drawing. Normal group inspection respects visibility.
- General navigation help moved to the status bar; the canvas shows calibration instructions only when needed.
- A repeated WebKit development failure exposed Vite HMR code being loaded inside the PDF worker. The prebuilt worker now ships unchanged with the existing offline PDF assets. No dependency versions changed.

The navigator was implemented by one Banana Split coordinator on configured `gpt-6-astra` / medium reasoning, with zero child agents. Workflow `wf_c54219dd-e23a-4a99-a0cd-12c73c88d0d8`, coordinator `agt_35bb27ef-3546-4d47-a5da-1b0318d7dbd3`, completed with a successful result. It used two turns to incorporate the supplied image. Runtime diagnostics recorded no rejections, formal revisions, acceptances, or turns without a disposition; there were no approvals or host-assisted actions. The GPT-6 host integrated visibility and crosshairs, reviewed the implementation, and ran verification; its reasoning level is unavailable.
