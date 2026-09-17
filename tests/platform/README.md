# Platform checks

Run from the repository root with the installed Node 22 and Playwright browsers:

```sh
bun run test:platform
```

The script builds its test bundles into ignored `tests/platform/.compiled` output before running Node. SQLite tests execute the adapter's generated SQL against Node's SQLite implementation. Browser tests execute IndexedDB in Chromium and WebKit with local route responses. Update tests check complete download, SHA-256 verification, relative URLs, and bridge compatibility before staging. These checks do not exercise Tauri IPC or native cache startup.
