# Bluewing

Construction takeoff application restart. Product scope and architecture live in [the restart brief](docs/restart-brief.md). This checkout currently provides the Solid 2 web scaffold and development tooling. Native integration, project saving, PDF import, drawing, recipes, and offline web updates are still to be built.

## Run

Use Bun (the tested version is recorded in `package.json`). Node from `.node-version` is also used by tools with Node entry points, including Playwright. Install the locked dependencies:

```sh
bun install --frozen-lockfile
bun run dev
```

The page contains an empty workspace and a working sheet-panel toggle. It is a small browser integration target, not a completed takeoff workflow.

## Verify

Install the test browsers once:

```sh
bunx --no-install playwright install chromium webkit
```

On Linux, use `bunx --no-install playwright install --with-deps chromium webkit` to install the system dependencies too. Then run:

```sh
bun run verify
```

This runs type checking, ESLint, formatting checks, development browser diagnostics, the production build, and production browser smoke tests in that order. Individual commands are defined in `package.json`. `bun run format` applies formatting.

ESLint uses strict type-aware TypeScript rules, the Solid 2 preset, and JSX accessibility rules, with zero warnings allowed. ESLint 9 is retained because the current accessibility plugin declares support through version 9. TypeScript 6 matches the supported range of typescript-eslint; installing the newest major of each package independently would produce incompatible peers.

Development browser tests record Solid diagnostics and attribution, check visible behavior and silent holds, and bound expected reruns. Production tests verify the built page and the absence of the development bridge. Both run in Chromium and WebKit. The current sheet toggle is synchronous; its no-silent-holds assertion does not yet prove async estimating workflows are responsive. Add delayed-source scenarios when those workflows are implemented.

JSON diagnostic artifacts and failure traces are retained in `test-results/` and the HTML reports in `playwright-report/`. The GitHub Actions workflow runs the same stages and uploads browser evidence. It takes effect when this project is put in a GitHub repository; no hosted CI run is implied by local verification.

The diagnostic bridge is installed only by the development server, including its local `/__solid/diagnostics` endpoint. Production uses the ordinary static Vite build. SSR is not part of the current desktop architecture.

## Dependencies and agents

Read [the Solid 2 repo skill](.agents/skills/solidjs-2/SKILL.md) when working on components, reactive state, dependency upgrades, or frontend tests. `AGENTS.md` points agents to it automatically.

Direct packages are exact-pinned; package overrides keep the transitive Solid compiler and signals runtime aligned. `bunfig.toml` makes new dependencies exact by default. Keep `bun.lock` in version control and use `bun install --frozen-lockfile` for reproducible installs. Upgrade the Solid package set deliberately, including its compiler, renderer, diagnostics, and integrations, with development and production checks in the same change.

Browser checks are only the web portion of validation. The native shell, desktop CLI, saving/reopening, web-version activation, and offline startup remain the first product milestone in the restart brief.
