**Bluewing repeated-work audit, October 6, 2026**

The largest avoidable cost is the way project snapshots invalidate downstream work. Unchanged records get new identities, publications unrelated to project editing can publish those snapshots, and numerical calculations depend on the whole project. That combination can repeat drawing paints, list construction, material generation, and GPU uploads. PDF raster caching will help sheet revisits, but it will leave most of these paths intact.

Several smaller changes are particularly clear: avoid whole-project construction resolution for ordinary form fields; stop painting idle drawing-tool hover; reuse number formatters; reuse measured formula inputs; sort openings once per calculation; and avoid copying old screenshot contents into CLI responses that contain no new messages.

This is a findings report. Application code, dependencies, estimating behavior, and project formats were not changed. The audit covers commit `8c35b6be3e1f1c2f60b00c644f08e5b8bae05b22` on `main`. The other machine's PDF-cache changes were not available here.

The findings and measurements below describe that audited revision. See [implementation follow-up](#implementation-follow-up) for the decisions made after merging this report with the PDF-cache work.

**Evidence and limits.** I read the product brief, repository instructions, verification commands, and SolidJS 2 skill. The audit traced the app/controller/session, core calculations and commands, PDF rendering, navigator, inspectors and editors, Three renderer, Wingman, screenshots, browser/native storage, CLI transport, and web updates. Installed PDF.js and modern-screenshot implementations were inspected where their behavior mattered.

Three independent probe sets exercised repository code. The core calculation probes used valid modeled and formula projects. The state probes used real session, command, mapping, messaging, and update code with mocked storage/native calls. The canvas probes executed the repository effects and painter with the installed production Solid 2 runtime, mocked canvas/PDF/image APIs, and JSX/mount lifecycle removed. These establish calls and dependencies; the canvas probes do not establish browser pixels, native latency, or GPU timing.

The T3 browser was opened and retried. Environment-port navigation failed; direct loopback samples could not be matched reliably to this checkout and disagreed with local source behavior. Those samples were excluded. No browser test suite, native build, or desktop workflow is claimed as passing. The guarded development server ran without a resource refusal. The existing core suite passed: **177 tests, zero failures**.

Counts and exact result comparisons carry more weight here than timings. Timings below come from Bun 1.3.14 on this Linux environment, with warmup and uninstrumented timing runs. They are indicative costs, not an estimate of production frame rate. Serialized sizes describe the synthetic ASCII fixtures, not measured resident memory or physical disk writes.

Probe inputs, scripts, and raw outputs are retained locally in [tmp/performance-audit](../tmp/performance-audit/). That directory is ignored by Git. A portable record of the measured outputs accompanies this report in [performance-audit-evidence.json](performance-audit-evidence.json).

| Probe                                                      | Result                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 100 valid walls, 100 openings                              | 2,000 pieces and 400 surfaces; complete result                                     |
| Rename project, change group name/color, add review mark   | Entire calculation result remains deeply equal                                     |
| Calculate that unchanged 100-wall model                    | Median 12.04 ms; scene preparation adds about 3.02 ms before GPU work              |
| Opening preparation in that calculation                    | 100 sorts of the same 100 openings                                                 |
| Review inspection with 100 reviewed walls                  | Another 100 opening sorts; median 8.58 ms                                          |
| 100 formula traces, four identical outputs                 | 400 measurement/calibration reads and 400 formula tokenizations                    |
| 20 idle Path pointer moves in the isolated component probe | 20 full canvas paints, 20 PDF bitmap copies, zero PDF raster jobs                  |
| Same moves with Select                                     | Zero canvas paints                                                                 |
| Warm Wingman plan after metadata publication               | Two composition passes, one clear, zero PDF raster jobs                            |
| Application project inspection, 2,000 geometries           | Six whole-project clones in the instrumented application path                      |
| Metadata rename, same fixture and subscriber               | Eleven whole-project clones, 8,008 JSON comparison calls, one SQL statement        |
| One review snippet note edit                               | A 567-byte changed snippet produces a 150,519-byte review record                   |
| 100-page batch added to an existing project                | 103 whole-project clones, one save                                                 |
| CLI response with all 100 messages acknowledged            | Still clones a 2.1 MB transcript including an old image                            |
| Native conversation load with 20 old screenshots           | 21 native calls; eagerly hydrates about 21 million base64 characters               |
| Format 3,000 numbers                                       | 67.56 ms with a formatter per value; 1.34 ms with one formatter; identical strings |
| 165 sheets referring to 164 source pages                   | 164 thumbnail renders/encodes/decodes; metadata resync adds zero renders           |

**Recommended order.** First address project publication and snapshot access, shared derivations, construction-field lookups, idle paints, canvas resets, and the formatter. Then tackle formula/opening preparation, stable list keys, Wingman transcript delivery, and screenshot composition. Storage record granularity and retained GPU resources need a more careful implementation than these local changes. The recommendations below explicitly identify those tradeoffs.

**01. Whole-project cloning occurs at many read boundaries. High priority; measured.**

[ProjectSession.project](../src/core/session.ts), lines 137–139, clones the complete accepted project on every getter call. [Application](../src/app/application.ts), lines 91–98 and 613–617, uses that getter for both ordinary snapshots and lightweight identity/revision information. Checks, observation, result metadata, UI publication, and error metadata can each repeat it. Read commands also clone the whole project in [executeCommand](../src/core/commands.ts), line 849, before the session clones its returned project/data.

The 349 KB synthetic project was cloned six times for an application `project.inspect`. A metadata rename with one application subscriber cloned it eleven times. Accessors that only need a project ID or revision should not copy all drawings and reviews.

Keep isolated snapshots where callers can mutate them. Add cheap session metadata access, reuse a captured snapshot within an operation, and avoid cloning unused read-command results. Preserve the existing tests that prevent adapters, subscribers, and returned data from corrupting accepted state. Returning the session's mutable object directly is not a safe remedy.

**02. Library and CLI connection publications can refresh an unchanged project. High priority; measured.**

[Application](../src/app/application.ts), lines 103–105 and 453–470, publishes for CLI connection and library inspection/editing. Its [workspace subscriber](../src/app/controller.ts), lines 125–129, responds by reading and setting a fresh project clone. These events do not change the project revision, but replace its identity.

The `library.inspect` probe copied the project three times and delivered a different project identity at the same revision. It can invalidate quantities, drawing inputs, sheet/group rows, and any open form that observes project state. Merely opening Assemblies calls `refreshLibrary` in [RecipeEditor](../src/components/RecipeEditor.tsx), lines 248–249, and can cause this fanout.

Publish project data only when its accepted identity/revision changes. Continue publishing library and connection state independently. Check lightweight session metadata before obtaining a new project snapshot; a revision check performed after cloning would still pay the copy cost.

**03. Numerical and material calculations depend on irrelevant project fields. High priority; result equivalence measured.**

[controller.quantities](../src/app/controller.ts), lines 109–115, observes the whole project. [calculateProject](../src/core/calculations.ts), line 279, resolves and generates the complete construction model. When quantities are observed, project renames, group presentation edits, review edits, and unrelated sheet metadata can therefore regenerate unchanged materials.

The 100-wall probe changed project name, group name/color, and review records separately. Every complete calculation result, including sources, diagnostics, model, and totals, remained deeply equal. Each fresh calculation still cost a median 12.04 ms in the probe.

Separate calculation dependencies from presentation/review metadata. Retain an unchanged calculation/model while labels and colors update through their own inputs. For later per-source reuse, include calibration, placements, levels, assembly defaults, local overrides, openings, shared owner-wall conditions, and deterministic generation-budget ordering. A blanket deep comparison of the complete project would add another broad pass rather than solve the dependency problem.

**04. Batches clone the whole project once per subcommand. High priority for import and bulk edits; measured.**

[ProjectSession](../src/core/session.ts), lines 187–203, invokes `executeCommand` for every batch item. [executeCommand](../src/core/commands.ts), line 849, creates a full project copy each time, even when final validation is deferred. Import, sheet naming/reordering, multiple deletes, and multiple copies all use batches.

Adding 1, 10, and 100 sheets to an existing 2,000-geometry project caused 4, 13, and 103 whole-project clones respectively. There was still only one save. The repeated copies contribute nothing to the atomic result.

Clone one batch draft, apply subcommands through an internal helper that owns that draft, then validate and save once. Preserve rollback, sequential subcommand results, expected-revision checks, one undo step, and request isolation. The public independent command executor can retain its snapshot contract.

**05. History and storage separately discover the same changes by serializing all records. High priority on large projects; measured.**

[session.difference](../src/core/session.ts), lines 54–87, JSON-compares every old/new sheet, geometry, group, recipe, and assignment. [recordChanges](../src/platform/storage-model.ts), lines 42–60, repeats the comparison for persistence. Metadata-only edits still walk all those unchanged records.

The 2,000-geometry rename probe recorded 8,008 comparison calls and about 1.03 MB of comparison text, while the resulting native save contained one SQL statement. This is CPU/allocation amplification; ordinary saves do not necessarily rewrite every geometry record.

Carry one affected-record change set from command execution into history and persistence, or share one computed diff. Batches and deletion cascades must include every affected record. Keep the save transaction and revision advancement exactly as today.

**06. Every undo entry copies complete construction and review trees, including unchanged ones. High priority as those trees grow; source-confirmed and counted.**

[session.difference](../src/core/session.ts), lines 83–87, stores before/after copies of both extensions unconditionally. A project rename or count edit can retain two copies of every unrelated opening, header, level, placement, review snippet, and annotation. The bounded 50-entry history multiplies that retained data. Most wall/ceiling settings live in per-assignment overrides rather than this construction extension.

Store extension snapshots only when that extension changed, using an explicit unchanged marker. For changed extensions, affected-record history can reduce the copy further. Preserve the distinction between an absent extension and an unchanged extension, and preserve all undo/redo restoration behavior. This improvement does not require changing the project file format.

**07. A small construction/review edit rewrites an entire extension record. Medium priority; measured, with a format caveat.**

[recordChanges](../src/platform/storage-model.ts), lines 58–60, treats all construction as one record and all review data as another. [NativeStorage.writes](../src/platform/storage.ts), lines 118–128, serializes the changed extension as one SQL value; browser storage has the same logical granularity.

Changing one snippet note produced a 150,519-byte review payload even though the changed snippet was 567 bytes. A single opening, header, level, or placement edit has the analogous scope. Wall/ceiling override edits commonly change an assignment record instead. This is distinct from the repeated comparison cost in finding 05.

Affected-record persistence would reduce the scope while retaining one atomic save. However, changing the persisted mapping needs an explicit plan for the current format-4 reopen contract. Do not add legacy migrations or quietly make existing current-format files unreadable. A format-compatible patch strategy or an intentional development-format reset is a larger choice. Treat this as a qualified implementation opportunity, not a drop-in cache fix.

**08. Validation repeats at adjacent trusted save boundaries. Medium priority; source-confirmed.**

Command/session execution validates the final project. [checkSave](../src/platform/storage-model.ts), lines 63–68, validates it again for both adapters; [BrowserStorage.persist](../src/platform/browser-storage.ts), line 107, adds a third pass after `save` calls `checkSave`. Project validation includes construction, review, assembly, and formula work across the whole graph. Loading also validates before constructing a session that validates again.

Within a single validation call, project schema traversal and later entity/assembly validation also repeat some schema checks. Detailed validation resolves construction before review validation resolves it again. Consolidate identical checks and pass an already resolved context where possible.

The storage boundary still needs validation when called independently, and project load must still validate persisted data. Consolidate duplicate checks within the same trusted call chain, using an internal validated-save path if worthwhile. Removing validation wholesale would violate current behavior and ownership guarantees. This is secondary to removing unnecessary calls and broad comparisons.

**09. Idle Path/Area/Count hover can paint an identical canvas. High priority; isolated effect probe.**

[DrawingCanvas](../src/components/canvas/DrawingCanvas.tsx), line 875, updates `hover` on every non-Select pointer move. The paint effect reads it at line 394. With no draft and no snap marker, hover does not contribute any canvas pixels. Crosshairs and the cursor are separate DOM/SVG elements, lines 1149–1182.

Twenty idle Path moves caused twenty full paints and twenty static PDF bitmap copies in the production-runtime effect probe. The same Select moves caused zero paints. Neither case rerasterized the PDF.

Track paint-relevant hover only when a draft needs a live segment or a snap marker is displayed. Preserve snapping and cursor updates. Count drafts also do not append a hovering segment, so unsnapped movement can avoid painting there. Equality-identical snapped points should not force another paint.

**10. Tiny transient changes repaint the PDF and every visible trace. High priority on dense sheets; source-confirmed.**

The single [canvas.paintScene](../src/components/canvas/DrawingCanvas.tsx) effect, lines 381–513, repaints the viewport, source page, colors, all takeoff paths, selection handles, and transient content. Draft segment movement, a moving snap marker, or a selection rectangle normally changes only a small part of that composition.

A PDF raster cache avoids PDF.js work but cannot remove this bitmap copy and repeated path construction. A retained static layer plus transient overlay can preserve pixels while reusing unchanged plan/takeoff content. Respect existing draw order, alpha blending, selected styles, edited-geometry replacement, camera transforms, and pixel density. Fix idle hover and dimension resets first; layered composition is a larger rendering change. Frame coalescing belongs only to interactive painting, not background CLI rendering.

**11. Every paint resets both canvas backing dimensions. Medium priority; isolated effect probe.**

[DrawingCanvas](../src/components/canvas/DrawingCanvas.tsx), lines 403–404, assigns width and height even when they are unchanged. Each assignment clears the backing surface and resets context state. The effect probe counted one pair of writes per paint.

Resize only when physical dimensions differ, then clear/redraw normally. Explicitly preserve the context reset that those assignments currently provide. For example, selection-box painting leaves a dashed stroke at line 507; simply removing dimension writes can leak that dash into the next paint. Transform, dash, path, and other relied-upon state must start each pass correctly.

**12. Active-sheet paints depend on unrelated sheet and group data. High priority; isolated effect probe.**

[DrawingCanvas](../src/components/canvas/DrawingCanvas.tsx), lines 385–391, tracks the whole active Sheet object and project group collection. Its geometry comparator, lines 236–238, compares object identity. Fresh accepted snapshots replace those geometry objects, so the comparator cannot protect an unchanged nonempty sheet.

Both a metadata-only publication and a same-revision cloned publication caused a full paint in the effect probe. Neither caused a PDF raster job: the separate render-sheet equality, lines 243–249, correctly excludes title/calibration metadata.

After fixing publication scope, preserve unchanged UI record identities and derive paint inputs from fields that affect pixels. Restrict group/color dependencies to the active sheet. Project rename, a review note, and an edit on another sheet should update their own visible content without repainting an unchanged plan.

**13. Hidden plan canvases still load and paint. Medium/high priority; source-confirmed.**

[App](../src/App.tsx), lines 540–558, hides the drawing workspace for Quantities and the plan pane for 3D, while retaining DrawingCanvas. Its PDF-load and paint effects have no visibility input. Its resize handling retains the old positive viewport when hidden, so later edits can still paint the previously sized canvas. Changing the active sheet can load a plan that is not displayed.

Pass plan visibility explicitly. Retain camera, draft, presentation, and cached-image state while suspending unnecessary hidden painting. Paint the current state before reveal. Hidden loading can be deferred or shared with an explicit prewarm policy. Blindly unmounting DrawingCanvas would discard state and viewport ports, so it is not equivalent.

**14. Geometry wholly outside a viewport or snippet still has its paths constructed. Medium priority; source-confirmed.**

[paintTakeoff](../src/components/canvas/paint.ts), lines 22–55, constructs paths for all supplied geometry. DrawingCanvas supplies the whole visible active sheet. [renderImage](../src/app/render.ts), lines 64–66, and Wingman likewise supply sheet geometry for bounded crops. Browser clipping removes pixels after the JavaScript has traversed every point/marker.

Skip objects whose expanded bounds cannot intersect the output rectangle. Include stroke width, marker radius, highlights, and selection handles in the bounds expansion. Keep the full geometry collection for snapping and selection unless those algorithms are separately optimized. Start with simple bounds, not an unsolicited spatial-index subsystem.

**15. Every transient paint rebuilds unchanged group color maps. Low/medium priority; source-confirmed.**

[DrawingCanvas](../src/components/canvas/DrawingCanvas.tsx), lines 416–419, scans visible groups and their memberships for each paint. [renderImage](../src/app/render.ts), lines 59–61, and [WingmanPreview](../src/components/WingmanPreview.tsx), lines 190–193, similarly build project-wide maps for one sheet/crop.

Prepare the relevant sheet's effective colors once per membership/color/visibility change and reuse them through the gesture. Preserve the current precedence when an object belongs to multiple groups; changing which group's color wins would change behavior.

**16. Fresh record identities cause sheet, group, and option rows to remount. Medium/high priority; source-confirmed Solid contract.**

[SheetNavigator](../src/components/SheetNavigator.tsx), lines 130–135, creates an ordered array from accepted sheet objects. Its default `<For>` at lines 462–472 keys by object identity; group rows at lines 621–630 do the same. A cloned project replaces all keys, including unchanged sheets/groups. Row controls, reactive owners, and metric memos can be recreated.

Use stable sheet/group IDs and item accessors in the pinned Solid 2 keyed-list API. Preserve live property updates. The same pattern appears in recipe choices, selection-group summaries, ConstructionView level options, and construction piece rows. Fix broad publication and stable list keys together; row-local caches help little if each publication destroys their owner.

**17. Navigator associations and measurements are recomputed across sheets and bindings. Medium priority; source-confirmed.**

[SheetNavigator](../src/components/SheetNavigator.tsx), lines 165–180, repeatedly enumerates all groups and filters their memberships by sheet. Expansion controls, displayed group lists, searching, and group selection ask for those associations separately. Per-row totals, lines 306–339, remeasure members when their project dependency changes, including irrelevant metadata.

Build sheet-to-group/member associations once per membership/sheet change. Share geometry measurements keyed by geometry and sheet calibration. Preserve cross-sheet groups, sheet-local group selection, order, mixed-unit displays, and unavailable-measurement dashes. Search still filters the same labels; it need not rebuild the associations it searches.

**18. Search reconstructs matching Review and Construction rows. Medium priority; source-confirmed.**

[ReviewPanel](../src/components/ReviewPanel.tsx), lines 69–85, maps fresh row objects before filtering on every input change. The default identity list at line 310 replaces even rows that match both searches. [ConstructionEditor](../src/components/ConstructionEditor.tsx), lines 398–408 and 661, has the same issue with fresh `Object.entries` tuples.

Create stable unfiltered records, then filter them; key Review rows by source kind/ID and Construction rows by record ID. Keep matching DOM owners alive. This differs from removing rows that no longer match, which is required. Browser focus/remount timing was not measured in this audit.

**19. Warm Wingman previews clear and compose twice for unrelated edits. Medium priority; isolated effect probe.**

[WingmanPreview](../src/components/WingmanPreview.tsx), lines 72–78, observes the whole project and construction even for a plan view. Lines 83–84 reset generic dimensions, then lines 158–159 change them again to the crop aspect. Line 202 draws without the plan image; lines 204–220 show loading and draw again when the already resolved raster promise yields.

After a metadata-only publication, the warmed-plan probe counted one clear, two width and two height writes, two composition passes, and zero region raster jobs. Cached PDF pixels are not enough to avoid this refresh.

Separate plan/3D dependencies, retain the resolved raster value, and redraw changed overlays directly over it. Show loading only for a pending new raster. Assign final dimensions once when needed. Relevant accepted edits must continue updating the live preview; sent attachments remain fixed.

**20. Pause and message-wait status changes copy the entire transcript. Medium/high priority with screenshots; measured.**

[Messaging.snapshot](../src/app/messaging.ts), lines 38–44, deep-copies all messages and attachments. Wingman's subscription calls it on every publication, including Pause/Resume and wait start/end. The [transcript list](../src/components/Wingman.tsx), line 306, uses fresh message object identity, so status-only changes can also rebuild unchanged message/image DOM.

The 100-message fixture copied about 2.1 MB for Pause, although no message changed. Stable message IDs plus separately published status can eliminate this copy/remount path. Keep snapshots isolated at external boundaries; reuse immutable message records inside presentation state. Image DOM replacement may cause decode/paint work, but this audit does not claim a new network fetch for each replacement.

**21. CLI delivery copies old image data before filtering and stripping it. High priority in screenshot-heavy AI loops; measured.**

[dispatchCli](../src/app/cli.ts), lines 132–140, first takes a full transcript snapshot, then filters by `messagesAfter`, then strips image data through `wireMessage`. A response with no unread messages still copied the fixture's 2.1 MB transcript. Separately, immediate `Messaging.read` copied its result twice: once to check length and once to return it, at [messaging.ts](../src/app/messaging.ts), lines 165–167. A regular CLI read adds the delivery snapshot on top. While waiting, notifications can also clone results merely to check whether a message arrived.

Filter/project-scope messages before copying, and create wire records directly from the selected records. Check message availability without cloning, then clone the required public result once. Status-only metadata should not hydrate image bytes. Preserve nondestructive cursors, project mismatch handling, message ordering, and the current response schema. This reduces work without making delivery destructive or changing synchronization behavior.

**22. Opening a native project eagerly reads every old chat screenshot. Medium/high priority; native-call probe.**

[messagingStorage.read](../src/platform/messaging-storage.ts), lines 47–62, sequentially reads every attachment file and hydrates its base64 data. [Application project open](../src/app/application.ts), lines 510–511, awaits conversation binding before publishing the project. This happens while chat and the preview can be closed.

The native-adapter probe with 20 screenshots performed 21 calls, including the transcript read, and loaded about 21 million base64 characters. CLI responses ultimately need paths/metadata, not the hydrated images.

Load message metadata at bind and hydrate image contents when a visible chat image needs them. Reuse immutable loaded attachments afterward. Preserve attachment display and fixed sent captures. This recommendation is qualified: an attachment read failure currently prevents project opening, so deferring the read can change error timing. Retain equivalent open-time access/error checks where possible; changing that failure behavior needs a product decision.

**23. Sending one text message rewrites the full conversation. Medium priority; measured, platform-specific scope.**

[Messaging.send](../src/app/messaging.ts) builds and persists the complete transcript. [messagingStorage.write](../src/platform/messaging-storage.ts), lines 65–80, serializes all native message metadata or writes the complete browser value. The fixture's 97-byte message caused a 2.1 MB browser transcript payload because an old image was retained.

Native persistence already removes screenshot base64 when a path exists. Its repeated write is metadata, not repeated image-file writing. A per-message/append mapping can preserve ordering, durability, and the existing conversation view while avoiding old-record writes. This is a larger storage change than filtering before CLI delivery. Do not weaken save-before-accept behavior or truncate conversation history.

Browser messaging storage also opens/closes its IndexedDB connection for each operation. A connection owned by that storage lifecycle can avoid repeat connection setup independently of a new per-message mapping.

**24. Screenshots process hidden app branches and canvases. Medium priority; app and installed-library source.**

[captureViewport](../src/platform/capture.ts), lines 20–42, filters only the screenshot overlay and prepares every included canvas. Installed modern-screenshot recursively clones hidden branches and calls canvas `toDataURL` before cloning its styles. Hidden DrawingCanvas can therefore be PNG-encoded in Quantities/3D; collapsed panels are still traversed. Registered hidden GPU canvases can be redrawn for capture too.

Prune known `hidden`/`display:none` branches before descendant cloning/preparation. Preserve all visible app pixels, including dialogs and scrolled panels. Do not blanket-prune `visibility:hidden` ancestors or offscreen rectangles: children may override visibility or be positioned into view. This finding has no measured screenshot latency claim.

**25. The frozen screenshot preview encodes and decodes an unnecessary full PNG. Medium priority at large pixel density; source-confirmed.**

[ScreenshotCapture](../src/components/ScreenshotCapture.tsx), line 65, converts the already captured canvas to a PNG data URL. Lines 125–130 display it through an image, requiring decoding of the same pixels. [cropCapture](../src/platform/capture.ts), lines 65–83, later uses the original canvas and performs the required final attachment encoding.

Display the captured canvas directly, or copy it into the visible overlay canvas. Retain final crop encoding. The same frozen preview and attachment result remain; canceled attempts avoid a full-image encode/decode and base64 allocation too.

**26. Auto-name extracts the same PDF text again. Medium priority; counted class probe.**

[SheetNamesDialog](../src/components/SheetNamesDialog.tsx), lines 50–85, scans initial sheets each time it mounts. [PdfDocuments.suggestName](../src/pdf/documents.ts), lines 86–97, requests text content each time. Installed PDF.js sends a new text extraction request; the application's complete suggestion is not cached by the document/page promise cache.

The same sheet, a duplicate sheet referencing its source page, and the original again caused three text-content requests and identical suggestions. Cache the compact extraction/suggestion result by source page and rotation, sharing pending work too. Clear on document release and evict failures for retry. Keep current sheet-name fallback behavior separate from the source suggestion so renames remain visible.

**27. Construction forms resolve the whole project for ordinary scalar fields. High priority; source-confirmed.**

[ConstructionFields.choices](../src/components/ConstructionEditor.tsx), lines 72–101, resolves all applied construction before checking the field key. Numeric/free-text fields return no choices but still pay the full resolution. Geometry/sheet choices need only authored records. Reference selectors can call `choices` again for their options. Nested finishes, header components, and backing multiply the work.

The fields are also used in GroupInspector and RecipeEditor. Check the key before resolving; use project records where sufficient and share one resolved construction accessor for actual wall references. Memoize a choice list once instead of calculating it for both its condition and its options. The source proves repeated mount/refresh work; it does not prove that every ordinary numeric keystroke independently reruns this lookup.

**28. Assembly metadata edits calculate previews hidden inside closed details. Medium/high priority with large selection; source-confirmed.**

[RecipeEditor](../src/components/RecipeEditor.tsx), lines 94–129, recalculates its selected-drawing preview on any draft change. The outer `Show` at line 570 observes it even while the details at line 572 is closed. Description/reference edits therefore calculate a hidden preview. Both the preview and validation memo validate the same assembly, lines 101 and 137.

Share validation and distinguish computation-driving fields from description/reference metadata. Calculate the expensive preview when its section is visible, and update it before displaying it. Maintain immediate save validity and visible validation messages. Arbitrary debouncing of correctness checks would change feedback behavior and is not the recommendation.

**29. The same group-level assembly merge repeats for each group member. Medium priority; source-confirmed.**

[resolveConstruction](../src/core/applied-assemblies.ts), lines 114–121, 131–137, and 144–150, merges template plus group overrides inside the geometry loop, then merges per-trace overrides. The first merge is identical for every compatible member of that assignment.

Hoist the assignment/template merge once and retain independent trace-specific resolved records. Do not share a mutable resolved object among traces. This saves preparation even when a full recalculation is required.

**30. Formula outputs repeat measurements, input preparation, and parsing. Medium/high priority; counted probe.**

[calculateProject](../src/core/calculations.ts), lines 209–217, loops outputs before sources. Each `source` repeats effective inputs, validation, geometry measurement, and variable conversion, lines 111–155. [evaluateFormula](../src/core/formula.ts), line 274, reparses each formula. Piece cut/stock formulas add further parsing.

For 100 traces and four identical `length` outputs, the probe counted 400 measurement/calibration reads and 400 tokenizations. A per-calculation measurement cache needs 100 measurements; one parse serves that exact formula string. Evaluation still runs for each source's variables.

Prepare source variables per assignment/geometry/component and parse distinct formulas once per pass or unchanged definition. Preserve unit conversions, per-output diagnostics, lazy conditional branches, error text, and independent source explanations. A bounded per-pass map avoids a permanent cache invalidation system.

**31. Openings, placements, assignments, and review coverage are repeatedly scanned. Medium/high priority; counted probe.**

[construction generation](../src/core/construction.ts), lines 588–590, sorts/scans all openings for each wall. The 100-wall fixture performed 100 sorts of the same 100 openings. Placement lookups also repeat per source. Opening overlap validation iterates the complete opening list for every opening, including unrelated walls; actual overlap checks run after the wall-ID guard.

[reviewFingerprint](../src/core/review.ts), lines 91–99 and 141, repeatedly sorts openings and assignments. `inspectReview` repeatedly scans wall/ceiling coverage and marks for each target, lines 201–217. The 100-reviewed-wall probe repeated 100 opening sorts and took a median 8.58 ms.

Prepare ordered openings-by-wall, placements-by-sheet, assignments-by-geometry, and review-target sets once per pass. Compare opening overlaps within each wall. Preserve canonical fingerprint order, related-source dependency inclusion, tie ordering, and diagnostics. These are lookup changes, not weaker validation/review rules.

**32. UI, exports, review, and CLI have separate uncached derivation paths. High priority for repeated inspection/render loops; source-confirmed.**

The workspace memo is not shared with [Application construction.render](../src/app/application.ts), lines 333–336, [construction.inspect](../src/core/detailed-commands.ts), lines 488–492, or quantity/piece export in [calculations](../src/core/calculations.ts), lines 355 and 441–442. Construction render/inspect calculate and then resolve construction again. App's level mapping, ConstructionEditor, and ReviewPanel have additional resolutions; `inspectReview` resolves independently of the panel's memo.

Share one accepted-state calculation/resolution among reads and allow core helpers to accept prepared inputs. Keep shared prepared results readonly, and copy before any caller mutation so existing result isolation remains. Isolate candidate preview projects from accepted-state results. Repeated camera-only 3D exports should reuse model/filter scene preparation while updating camera, size, and display mode. Reusing the WebGL context alone does not prevent model rebuilding.

**33. New identities for unchanged models trigger complete GPU rebuilds. High priority downstream of findings 02–03; source-confirmed.**

[ConstructionView](../src/components/ConstructionView.tsx), lines 79 and 105–121, creates new scene data from a new result. [ConstructionRenderer.render](../src/three/renderer.ts), lines 419–421, compares scene identity; `setModel`, lines 294–389, disposes and recreates model buffers, instances, surface triangles, and materials.

Thus a metadata edit with a deeply equal model can still trigger a full replacement. Share stable model/scene identities when their inputs are unchanged. Preserve real geometry/filter changes. Incremental GPU updates may help later, but eliminating unnecessary model replacement comes first. No live GPU upload count or GPU timing was established here.

**34. Initial GPU colors are written twice, and selection rewrites every color. Medium priority; source-confirmed.**

[setModel](../src/three/renderer.ts), lines 311–344, initializes member/surface colors. The first render calls `updateSelection` because the model changed, lines 481–486, rewriting all colors even with empty selection. Later selection changes also traverse every member and surface range, lines 393–413. The same material color is repeatedly hashed and allocated.

Initialize buffers with final selected colors, avoiding the second pass, and reuse a small material palette. If selection cost remains material, update only old/new selected source ranges. Camera changes on a stable scene do not inherently recolor the model; this is not an every-frame color upload finding.

**35. Quantities/3D switching destroys and recreates the 3D viewer. Medium priority; lifecycle confirmed, behavior caveat.**

[App](../src/App.tsx), lines 560–566, unmounts ConstructionView while Quantities is open. [ConstructionView](../src/components/ConstructionView.tsx), lines 161–187, creates/disposes the renderer with its component. Returning repeats context setup and model upload.

Retaining GPU resources across this temporary view change can avoid that work. However, simply CSS-hiding the component also preserves camera/filters that today's remount resets. Preserve those current reset semantics explicitly if strict behavior parity is required. This is a qualified resource-lifetime improvement, not a recommendation to silently change navigation behavior.

**36. Quantities creates an Intl formatter for each cell value. Small change, measurable cost.**

[Quantities](../src/components/Quantities.tsx), lines 4–5, constructs `Intl.NumberFormat` on every format call. Source and output tables can invoke it thousands of times. SelectionInspector already uses a shared formatter.

Formatting 3,000 values took median 67.56 ms with per-value construction and 1.34 ms with a shared instance; output strings were identical. Reuse one instance with the existing locale/options. The app has no reactive locale preference today; a future preference would become an explicit formatter input.

**37. Bounded UI schedules allocate the entire export schedule first. Low/medium priority; measured.**

[PieceSchedule](../src/components/PieceSchedule.tsx), lines 20 and 44, builds every schedule row, then displays 300. [pieceSchedule](../src/core/calculations.ts), lines 415–438, allocates metadata/diagnostic records for all pieces. The 2,000-piece probe discarded 1,700 rows from display; full allocation cost was only about 0.24 ms at that size.

Build only the displayed rows and compute total count cheaply, retaining full schedule construction for exports. Preserve exact ordering and the 300-row cap. ConstructionEditor's selected-piece filtering can also use an ID Set rather than repeated array `includes`. Do not treat the UI cap as permission to truncate exported quantities or pieces.

**38. Installed web assets are served with caching disabled. Medium priority; native source, no native measurement.**

[native resource interception](../src-tauri/src/lib.rs), lines 269–285, sets `Cache-Control: no-store` on installed-release resources. [cache.resource](../src-tauri/src/cache.rs), lines 111–130, reads file contents for each request. Hashed scripts/styles and unchanged PDF workers/fonts/CMaps/codecs cannot use normal HTTP reuse across requests/reloads through this path.

Allow appropriate reuse for immutable versioned/content-hashed assets while retaining activation freshness. Stable `/pdfjs` URLs need a release/version identity before long-lived caching is safe. HTML and the activation boundary need their own policy. Do not blindly cache stable paths or infer a native latency saving from source alone.

**39. Restaging an installed release downloads its files before rejecting it. Low/medium priority; counted fetch probe.**

[stageWebUpdate](../src/platform/updates.ts), lines 59–95, already reads `cachedVersions`, but downloads/hashes/encodes all manifest files before native `cache_stage` rejects a duplicate version. The probe fetched the manifest and every listed asset, then received the existing “Web version already exists” error.

After validating the manifest and bridge version, reject an already cached release before fetching its assets. Keep the current error semantics and all hash checks for new releases. This is a small change distinct from more ambitious content-addressed reuse across releases.

**40. Browser transactions include stores their operation does not use. Medium priority in browser development; source-confirmed.**

[BrowserStorage.transaction](../src/platform/browser-storage.ts), lines 70–72, always includes projects, records, and assets. Asset-only reads include project records; normal edits include assets even when no asset is staged. IndexedDB transaction scope can therefore make independent asset reads and record writes wait for each other.

Use assets alone for asset reads, projects/records for ordinary load/save, and all needed stores for an import. Preserve a single transaction across every store actually changed. This reduces unnecessary synchronization without weakening atomicity. It applies to browser storage, not native SQLite, and contention latency was not measured.

**41. Startup sequences independent record requests one at a time. Low/medium priority; source-confirmed.**

[NativeStorage.load](../src/platform/storage.ts), lines 82–107, awaits metadata, five collection queries, and an extension query separately. [BrowserStorage.load](../src/platform/browser-storage.ts), lines 77–98, likewise issues/awaits each collection request in sequence. The independent records do not need that ordering before reconstruction.

Native loading can fetch metadata and all non-asset record rows with fewer round trips, then group them in TypeScript. Browser loading can enqueue the independent requests within its existing readonly transaction and await their results together. Preserve the reconstructed project, validation, errors, and exclusion of PDF asset bytes. This is a startup round-trip opportunity rather than evidence of repeated PDF loading.

**Additional small opportunities.** These are lower priority than the paths above, but the repeated work is visible in source:

- [ConstructionView](../src/components/ConstructionView.tsx), lines 123–133: selected-piece lookup scans all scene members/surfaces even when the selected ID is null. Return early for null.
- [App](../src/App.tsx), lines 577–593: level options concatenate/filter all resolved sources once per level. Build level-to-geometry sets in one pass, preserving deduplication and order.
- [ConstructionView](../src/components/ConstructionView.tsx), lines 271–283: ResizeObserver and window resize both create new viewport objects for unchanged positive dimensions. Compare width/height/pixel ratio before setting. Existing frame cancellation already coalesces many notifications.
- [DrawingCanvas](../src/components/canvas/DrawingCanvas.tsx), lines 957–973: resize notifications likewise publish unchanged viewport objects and update the per-sheet camera map. Compare measured size/pixel ratio before those writes, preserving actual pane-resize behavior.
- [GroupInspector](../src/components/GroupInspector.tsx), line 105, and [SystemComponents](../src/components/SystemComponents.tsx), line 19: each edit clones the entire assignment/component, including unrelated overrides/definitions. Copy only changed branches after the initial isolated draft snapshot. Also update handlers that currently mutate a nested clone.
- [SelectionInspector](../src/components/SelectionInspector.tsx), lines 94–101: group summaries repeatedly use selected-member array searches and create fresh summary objects. Shared selected-ID sets and stable group keys can reduce both scans and remounts.
- [scene preparation](../src/three/scene.ts), lines 166–187: nearest-track searches recompute track direction/length for every vertical piece. Prepare track properties once while retaining nearest-distance and tie-order behavior.
- [buildConstructionScene](../src/three/scene.ts), lines 248–262, and [renderer](../src/three/renderer.ts), lines 312 and 336: member frames and thickened surface faces are calculated for bounds and again for GPU geometry. Reuse immutable prepared shapes if this remains costly after scene invalidation is fixed.
- [material summaries](../src/core/material-results.ts), lines 47–51 and 90: generated lengths/areas can be measured again after generators already computed them. Consolidate measurement at final record creation only after proving all generators supply current geometry-derived values. Removing the independent summarization check without that proof is unsafe.
- [sourceEntity](../src/core/review.ts), lines 32–41: its default resolved-construction argument is evaluated even for geometry/assembly lookups that only need project records. Resolve conditionally or pass an existing context.
- [assemblyOutputs](../src/core/systems.ts), lines 89–101: the same system definition is validated/mapped for repeated assignments. Prepare it once per unchanged recipe per calculation.

**Qualified opportunities and deliberate work.** These deserve separate treatment because the current work can be useful or its removal has an observable tradeoff:

- **Thumbnail warming is deliberate.** [SheetThumbnails](../src/components/sheet-thumbnails.ts), lines 43–49 and 103–125, renders, PNG-encodes, and decodes every unique source page. The 164-page probe confirms the full workload, but README explicitly promises background warming and cached decoded previews. Disabling it would trade away hover readiness. Pausing low-priority warming while the panel is hidden or prioritizing visible/imminent rows may be useful; measure the latency/memory tradeoff. Duplicate pages and metadata resync already reuse the cache correctly.
- **Thumbnail notifications are broader than their consumer.** One global `thumbnailVersion` wakes the active preview when any page finishes. Suppress preview notifications while no preview is shown, continuing deliberate warming; use per-key notifications while shown. Primitive source/error bindings may suppress DOM writes, so 164 completions are not evidence of 164 tooltip renders.
- **Obsolete PDF tasks continue after a consumer stops waiting.** DrawingCanvas's teardown only marks the result canceled; the PDF render task continues. Rapid switching can discard completed rasters and delay the serial thumbnail queue. Coordinate cancellation with shared in-flight caching: an abandoned consumer does not make a job unnecessary if another consumer or a revisit cache needs it.
- **Repeated exports/snippet previews repeat composition and PNG encoding.** Exact output reuse can help explicit identical requests, but sizes, labels, annotations, highlights, colors, output mode, and current metadata must match. Preview and export defaults differ. First share the source raster; broader output caching adds retained data and key complexity.
- **Collapsed panels retain their children.** This preserves drafts and hover-peek behavior, but mounted observed measurements/forms can keep reacting. Suspend expensive derivations while retaining drafts, and refresh before reveal. Unmounting a panel blindly changes behavior. Unobserved Solid memos should not be assumed to run.
- **New releases include many unchanged PDF support files.** The release includes CMaps/fonts/codecs/worker assets; hash-addressed reuse could reduce cross-release transfers while still assembling a complete offline bundle. This is a larger cache/delivery change than early duplicate-version rejection. Download parallelism changes latency rather than the amount of unnecessary work, so it is not a finding by itself.

**Coordination with the PDF-cache thread.** [PdfDocuments](../src/pdf/documents.ts), lines 10–46, already deduplicates document loading by asset ID. It does not cache rendered regions: lines 100–122 allocate a canvas and start a page raster each time. A → B → A navigation and duplicate source-sheet views therefore repeat full-page raster work. Shared bounded raster/in-flight reuse addresses that directly.

Main drawing uses a 3,000-pixel request, thumbnails 640, region picking 1,200, snippet previews 1,400, and ordinary exports typically 2,048. Different sizes/crops are not automatically duplicate source rasters. Plan and combined modes can share the same PDF raster; takeoff-only mode skips it. Labels, annotations, highlights, and mode belong in composed-output keys. Lower-resolution reuse or downsampling needs an explicit quality decision.

There is an important ownership constraint: [SheetThumbnails](../src/components/sheet-thumbnails.ts), line 122, zeroes the returned canvas dimensions after encoding; DrawingCanvas retains its returned canvas as a live image. Returning one mutable cached canvas to both consumers can erase the drawing's image. Cache ownership must account for that, for example with immutable image resources, copies, or leases. Do not add a shared canvas cache without addressing existing disposal behavior.

Wingman's local one-key promise cache helps repeated use while mounted, but disappears when the expanded preview unmounts. Shared raster caching can help remounts. It does not fix Wingman's broad dependencies, blank intermediate composition, repeated dimensions, or the canvas painter's transient bitmap copies.

Keep PDF.js `intent: 'print'`: the source explicitly uses it because static/background WebKit renders must not depend on animation frames. Interactive paint scheduling must not become a prerequisite for CLI image generation.

**Existing boundaries that should remain.** Ordinary saves already update only changed main records and staged assets; they do not rewrite PDF BLOBs on every edit. Native imported assets use bounded/streamed transfer. PDF document promises share concurrent loading and remove failed entries for retry. Render-sheet equality already protects metadata edits from PDF rerasterization. Thumbnail keys retain source-page images over renames/calibration/reordering. Camera and visible-selection memos have useful equality checks. Three renders on demand, uses instanced members, and retains GPU buffers for camera/display-mode changes on the same scene. Snapshot rendering uses a separate shared context so CLI exports do not disturb the user's view.

Save-before-publish, isolated caller/adapter data, atomic batches, bounded generation diagnostics, fixed screenshot attachments, nondestructive message cursors, fresh results after relevant dependency changes, and complete exports are required behavior. Do not remove them to reduce counts. Identical accepted commands can also advance revision/history under the current contract; suppressing such commands needs an explicit decision rather than being disguised as a cache optimization.

**Validation for implementing these findings.** Prefer a few targeted comparisons over new generic gates: the metadata variants above should retain deeply equal numerical/model results; relevant geometry/calibration/opening/default changes should still alter them; canvas optimizations should compare pixels across drafts, snaps, dashed selection boxes, highlights, and retina sizes; snapshot changes should retain the existing mutation-isolation tests; and chat delivery should preserve project/cursor/wait behavior with screenshots present. Run any browser/native verification through the repository's resource guard and one-worker commands. Real Chromium/WebKit and native-webview profiling remain necessary before claiming frame-time or desktop speedups.

## Implementation follow-up

Reviewed October 6, 2026 after merge `88b94d1`. The previous PDF-cache work and the remote report were merged without conflicts and pushed to `main` before this follow-up. The selected changes remove repeated copying, parsing, sorting, DOM replacement, and image encoding. They add no dependencies, project-format changes, migrations, generic performance gates, or cross-revision model caches.

| Findings           | Decision and remaining scope                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01, 04             | Session batches and previews now use one owned draft. Reads avoid an unnecessary project draft; public results, command inputs, subscribers, and storage still receive isolated data. Cheap application/session metadata access was already included in the merged work.                                                                                         |
| 02, 09, 11, 13, 27 | Already addressed by the merged responsiveness work: revision-aware project publication, paint-relevant hover updates, unchanged canvas dimensions retained, hidden plan activity suspended, and construction form context reused.                                                                                                                               |
| 03, 12, 32, 33     | Deferred together. Stable calculation dependencies and shared results across UI/CLI/export need one clear invalidation boundary, including openings, shared walls, placements, levels, defaults, and generation order. Local per-pass reuse below improves the work without risking stale quantities or models. This remains the most valuable larger follow-up. |
| 05                 | Partially addressed. Project rename shares private unchanged records with its draft, allowing history to skip those collections. Storage still computes its own diff. Sharing command change sets across history/storage would touch every mutation and deletion cascade; defer that broader contract change.                                                    |
| 06                 | History retains construction/review snapshots only when those extensions change. Zero-length history skips diff generation. Undo/redo still distinguishes absent extensions from unchanged ones.                                                                                                                                                                 |
| 07                 | Deferred. Finer extension storage is a separate persistence-format decision. No migration or format reset is needed for the selected changes.                                                                                                                                                                                                                    |
| 08                 | Removed the extra browser persistence validation after `checkSave`. Initialization and independent save/load validation remain. Broader validation consolidation is deferred.                                                                                                                                                                                    |
| 10, 14, 15         | Deferred. Layered drawing, viewport culling, and persistent color-map caching need separate pixel comparisons and dense-sheet profiling. Existing idle-paint suppression addresses an established frequent trigger first.                                                                                                                                        |
| 16                 | Sheet, group, review, and construction rows now retain DOM identity by record key while reading current record values. Minor option lists remain unchanged.                                                                                                                                                                                                      |
| 17                 | The merged work already indexes sheet/group associations. Group geometry kinds are now memoized within retained rows. Shared cross-row measurement is deferred with the broader derivation boundary.                                                                                                                                                             |
| 18                 | Review and Construction filtering now reuses prepared rows/record entries. Keyed rows avoid remounting matching items. Construction selection filtering uses one selected-ID set.                                                                                                                                                                                |
| 19                 | A warm Wingman plan now composes once from its retained raster, with no preliminary clear, canvas resize, or loading flash. Changed sources still cancel and replace their raster.                                                                                                                                                                               |
| 20, 21             | Wingman status notifications no longer clone the transcript. New messages append isolated records while existing rows remain stable. CLI delivery filters by project/cursor before constructing attachment metadata, without copying screenshot bytes.                                                                                                           |
| 22, 23             | Deferred. Lazy native screenshot reads change loading/error timing; append-only conversation persistence changes storage behavior. Current fixed attachments and full conversation persistence remain.                                                                                                                                                           |
| 24, 25             | Screenshot capture prunes computed `display:none` branches before cloning/preparing canvases. The frozen preview displays its captured canvas directly; only the selected attachment rectangle is PNG-encoded. Visible children of `visibility:hidden` ancestors remain included.                                                                                |
| 26                 | PDF name suggestions share successful/pending extraction by source page and rotation while that PDF document is retained. Failed extraction retries, callers receive independent results, and document release/eviction drops the cache. No extracted page text is retained in a new persistent cache.                                                           |
| 28                 | Assembly preview calculations run only while the preview is expanded. Structural validation is shared between validation and preview eligibility. Open previews still update with edits; immediate form validation remains.                                                                                                                                      |
| 29                 | Group-level material settings merge once per assignment, then each geometry receives its independently merged detail.                                                                                                                                                                                                                                            |
| 30                 | Each calculation pass reuses geometry measurements, effective source inputs, parsed formulas, and system output definitions. No result survives the call, so relevant edits require no cache invalidation policy. Output explanations, diagnostic order, lazy formula branches, piece buckets, and purchasing remain independent.                                |
| 31                 | Openings sort once per generation and index by wall; placements index by sheet. Review inspection prepares its assignment/opening/placement/source indexes once. Existing fingerprint dependency order is preserved.                                                                                                                                             |
| 34, 35             | Deferred pending GPU profiling. Retaining the viewer changes resource lifetime; incremental color updates add renderer state. On-demand rendering and instancing remain.                                                                                                                                                                                         |
| 36                 | Quantities reuses one locale formatter with the existing formatting options.                                                                                                                                                                                                                                                                                     |
| 37                 | Deferred. The measured schedule-allocation saving is small; introducing a second schedule API is not justified in this pass. Full exports remain intact.                                                                                                                                                                                                         |
| 38                 | Deferred. Stable installed asset URLs need a release identity before relaxing cache policy safely. Activation freshness and offline delivery remain unchanged.                                                                                                                                                                                                   |
| 39                 | Duplicate release versions are rejected after manifest/bridge validation and before asset downloads. New releases still receive hash validation.                                                                                                                                                                                                                 |
| 40                 | Browser asset reads use only the assets store; ordinary load/save uses project/record stores. Imports still atomically include every changed store.                                                                                                                                                                                                              |
| 41                 | Deferred. Startup query consolidation is plausible, but no startup latency was measured for these small metadata queries. It does not reduce PDF bytes or rendering work.                                                                                                                                                                                        |

The additional `sourceEntity` and `assemblyOutputs` opportunities are included: simple geometry/assembly lookups no longer resolve construction, and repeated system assignments share prepared definitions within a calculation. Remaining small scene/inspector/resize opportunities are deferred rather than broadening this pass without a measured interaction problem.

Background preparation still warms every PDF page when resources and idle time permit, starting nearby. Main pages render at 3,300 pixels. Bounded memory caches and disposable native disk rasters were merged before this review; they preserve canvas ownership and allow rerendering after cache loss. The original audit's thumbnail/raster-cache observations therefore do not describe the merged cache implementation.

### Verification evidence

Focused regressions establish constant batch copying (four whole-project copies for 1, 10, and 100 commands), rollback and one-step undo, extension restoration, isolated read results, screenshot-free CLI metadata delivery, and stable message rows across pause/wait notifications. Formula preparation tests independently check quantities, diagnostics, piece/purchasing behavior, lazy branches, opening order, sparse overrides, and canonical review dependencies. Existing modeled construction/catalog tests retain physical-piece and surface expectations.

Real Chromium/WebKit regressions check retained sidebar elements with updated labels, lazy preview reopening with current amounts, one warm Wingman composition without clearing/resizing, PDF name extraction reuse/retry/release, hidden screenshot pruning, zero full-viewport PNG encodes, and attachment pixels identical to the frozen canvas crop. These are work-count and behavior checks, not measured Windows frame-time or latency improvements.

Web verification passed: static type/lint/format checks, 197 core tests, 11 resource-guard tests, 12 storage/update tests, 116 development browser tests, production build, and 32 production browser tests. Browser suites used one worker and all heavy commands used the resource guard.

Native build and all four selected native/CLI workflows passed: `tests/native/smoke.py`, `tests/desktop/assemblies.py`, `tests/desktop/detailed.py`, and `tests/desktop/wingman.py`. They cover IPC and offline activation, modeled material quantities/3D/CSV, preview and undo/redo, sparse overrides, snippets/review, backups, restart, messaging cursors/waits, and rendered PNG attachments. Browser workflows establish screenshot selection, pause/resume, and view swapping; the native Wingman script does not drive those UI gestures. The optional large-plan import was not repeated in this pass (`BLUEWING_TEST_DETAILED_PLAN` unset); the earlier merged cache report retains the real Bingham evidence. Windows native latency and GPU frame times remain unmeasured here.

### Delegated review record

Three independent Banana Split root workflows completed with successful results and no child agents. Each used the configured `default` tier with no overrides or tier changes: observed model `gpt-6.1-sol`, resolved reasoning `high`. The host used `gpt-6-astra` at `ultra`, reviewed all changes, and ran the integrated checks serially. Final workflow diagnostics recorded zero managed tool rejections, turns without a disposition, formal revisions, acceptances, or advice resolutions. No approval or host Computer Use requests occurred. The host corrected typing/formatting issues, an untracked screenshot JSX read caught by development diagnostics, and screenshot test instrumentation before the passing integrated runs; these were not formal workflow revisions. Late informational messages to two already completed agents returned `recipient_unavailable`; the host handled the remaining corrections.

| Scope                          | Completed workflow                        | Root agent                                 |
| ------------------------------ | ----------------------------------------- | ------------------------------------------ |
| Session copying/history        | `wf_38f3d559-6ef0-4c72-a55f-751c15aa1334` | `agt_cf12c2c8-8fd4-432d-b4df-afe53a10c39f` |
| Calculation preparation/review | `wf_b61f0aca-6513-48d2-a8cc-89a5bcb1d262` | `agt_b0bd8979-bd7c-4894-aff6-db00ef495331` |
| Messaging/screenshots          | `wf_8439abb2-da06-4683-b3ba-101189c1035f` | `agt_c47f6a3f-623d-4773-b6b1-3f38b8443368` |
