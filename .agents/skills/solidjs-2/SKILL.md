---
name: solidjs-2
description: Implement and debug Bluewing SolidJS 2 components and reactive state, change the Solid toolchain, or verify frontend behavior using lint and browser diagnostics. Use when adapting reference UI from Solid 1.
---

# SolidJS 2 in Bluewing

Read the installed types when an API is uncertain. `package.json` and `bun.lock` identify the supported release; the restart brief owns product decisions. Keep Solid in UI/session presentation adapters: geometry, measurement, recipes, and accepted command state remain plain TypeScript data and logic.

## Before changing code

- Keep the exact Solid package set during feature work. For a dependency upgrade, follow the upgrade section below.
- Adapt reference components to Solid 2 before reusing them. Old Solid 1 examples and React patterns are frequent sources of plausible but broken code.
- Choose the relevant rules below. For a diagnostic code, search that code in `node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`; read its repair section rather than loading the entire upstream guide.

## Imports and JSX

- Import signals, memos, effects, stores, and `snapshot` from `solid-js`. Import DOM rendering and web JSX types from `@solidjs/web`. `solid-js/web` and `solid-js/store` are old paths. Web TypeScript uses `jsxImportSource: "@solidjs/web"`.
- Components execute setup once. Keep reactive property reads in JSX, accessors, memos, or the compute half of effects. Destructuring props or reading a signal into a plain variable in component setup loses tracking. Use `untrack` only for an intentional snapshot.
- Use `class` with strings, arrays, or objects. `classList`, `className`, `htmlFor`, `use:`, and `/*@once*/` are old forms. Use `for` on labels and camel-case handlers such as `onClick`.
- Pass values to DOM attributes, for example `value={name()}`. Pass accessors to a component only when its declared API expects an accessor. Enumerated attributes such as `draggable` and `aria-expanded` use string tokens, for example `aria-expanded={open() ? 'true' : 'false'}`. Boolean `false` can remove an attribute rather than write the string `"false"`.
- Default `<For>` gives a raw item and index accessor; `keyed={false}` gives an item accessor and numeric index; a key function gives item and index accessors. Match the callback to the mode. `Index` is removed.

## Batching, effects, and ownership

Writes are batched into a microtask. Reading immediately after a setter can return the previous committed value. Use functional setters for dependent writes. Await visible results in browser tests; reserve `flush()` for a justified synchronous integration or isolated test. In particular, a Solid setter is not the authoritative commit step for Bluewing project commands.

`createEffect` separates tracked computation from imperative work:

```ts
createEffect(
  () => selectedSheet().title,
  (title) => {
    document.title = `${title} | Bluewing`;
  },
  { name: 'workspace.documentTitle' },
);
```

Read dependencies in the first function. Perform external writes in the second and return teardown there. Derive values with memos instead of copying a derivation into another signal with an effect. Component setup and memo/compute scopes stay free of writes and invoked actions.

Use `onSettled` for setup that needs mounted DOM and return its cleanup. Ref callbacks are unowned in Solid 2: capture the element there, and establish subscriptions and cleanup in component-owned setup or a directive factory's owned half. Dispose roots and external subscriptions when their owning UI goes away.

Use names tied to the domain for important reactive scopes, such as `workspace.selectedSheet`, `inspector.quantities`, or `canvas.viewport`. Attribution can then explain which state caused work. Avoid naming every trivial JSX binding manually.

## Stores and accepted project state

`createStore` setters receive a mutable draft:

```ts
setWorkspace((draft) => {
  draft.selectedSheetId = sheetId;
});
```

Mutate only the setter draft, not the read proxy. `snapshot(store)` obtains plain data; use it at intentional serialization boundaries. Old `produce`, `createMutable`, and `unwrap` patterns need migration. `merge` replaces `mergeProps`, but an explicit `undefined` overrides the previous value. `omit` replaces the rest-props use of `splitProps`.

Publish accepted project data to UI state after the command's atomic save succeeds. UI selections and unfinished drafts can be reactive. Solid optimistic state is not evidence that a project edit saved successfully, and Solid actions do not replace the project's serial command queue or revision checks.

## Async UI

Async computations and `<Loading>` replace `createResource` and `<Suspense>`. `<Errored>` replaces `<ErrorBoundary>`; its fallback error is an accessor. Read potentially pending values in tracked scopes under the appropriate boundary.

`Loading` handles initial readiness. A later update can retain the old screen while the new value is pending. Show feedback with `isPending(() => relevantValue())` or a justified optimistic UI. A bare `refresh()` does not by itself announce pending work; consult the installed `affects`/refresh contract when adding an explicit refresh interaction.

Test feedback while the source is deliberately unresolved, then assert the completed result. Checking only the final text can miss an interaction that appeared unresponsive throughout the wait.

## Verify and diagnose

Use Bun and the scripts in `package.json`; `bun run verify` performs static checks, development browser tests, a production build, then production browser tests. Run focused checks during edits, then the applicable complete sequence before handing off frontend work.

The Vite diagnostics option installs the bridge into the app's own runtime in development. Capture with `@solidjs/diagnostics/playwright`, then use the assertion helpers from `@solidjs/diagnostics`. `toHaveNoSilentHolds()` is a **Vitest** matcher; Playwright tests here call `expectNoSilentHolds(artifact)` directly.

- Assert the interaction's visible result and pending feedback where relevant.
- Assert no unexpected diagnostics or silent holds. Use bounded reruns for important scenarios, with a reason tied to the work the interaction should cause.
- Check that attribution contains the expected activity; an empty recording is not proof of clean reactivity.
- Save the JSON artifact before assertions, so failures retain their evidence. Inspect the diagnostic code, named scope, origin, and owner path before changing the implementation or a budget.
- Keep production verification separate. The browser bridge is absent there. Chromium/WebKit tests do not establish native webview behavior.

RC.8 moved diagnostics from `DEV.diagnostics` to `OBSERVE.diagnostics`, and attribution to `solid-js/attribution`. Some package README prose still describes the older API. Prefer installed exports and types. An observe build can collect attribution but omits strict development checks; normal development verification remains required.

For browser bridge or capture workflow changes, read the relevant section of `node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md` and its installed type declarations. Keep SSR checks conditional on actually introducing SSR.

## Deliberate upgrades

1. Read release notes and peer requirements for the target runtime, web renderer, signals, compiler, diagnostics, and Vite integration. Resolve a compatible set; their version numbers need not all match.
2. Update exact dependencies and transitive overrides together, regenerate `bun.lock` with `bun install`, and inspect `bun pm ls --all` for incompatible or duplicate Solid runtimes, renderers, compilers, diagnostics, and Vite integrations. Use `bun install --frozen-lockfile` for ordinary setup and CI.
3. Run development diagnostics first, then production verification. Exercise any third-party components being used, especially portals and dynamic components. Update this skill only for API or workflow changes that affect Bluewing.
4. Include the manifest and lockfile in the same version-control change. Stable 2.0 adoption is an upgrade, not a reason to float versions during unrelated work.

## Primary references

These links describe the initial RC.8 baseline. Consult the target release's equivalents during an upgrade.

- [Solid migration guide at RC.8](https://github.com/solidjs/solid/blob/f8b40b7/documentation/solid-2.0/MIGRATION.md)
- [Diagnostics and attribution at RC.8](https://github.com/solidjs/solid/blob/f8b40b7/documentation/solid-2.0/08-dev-diagnostics.md)
- [RC.8 release notes](https://github.com/solidjs/solid/releases/tag/solid-js%402.0.0-rc.8)
- [Solid 2 ESLint configuration](https://github.com/solidjs-community/eslint-plugin-solid#solid-20)
