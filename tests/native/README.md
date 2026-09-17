# Native adapter checks

Build the web app first (`bun run build`), then:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked --bins
python3 tests/native/smoke.py
```

The smoke test opens a real desktop webview with an isolated `BLUEWING_DATA_DIR`, loads a cached bundle, exercises IPC and CLI, activates another complete bundle without rebuilding Rust, and restarts offline. It needs a graphical desktop session. Unit tests cover database and cache failure cases.

To verify a local macOS app bundle after building both debug binaries:

```sh
bunx --no-install tauri bundle --debug --bundles app --no-sign
BLUEWING_NATIVE_BIN_DIR="$PWD/src-tauri/target/debug/bundle/macos/Bluewing.app/Contents/MacOS" python3 tests/native/smoke.py
```

The default bundled version is `0.1.0`. `cache_stage` accepts `{version, files: [{path, data}]}` with base64 file bytes. Versions are immutable and must differ from `0.1.0`. `index.html` is required. Paths are relative; traversal is rejected. `cache_activate({version})` requires a closed database, updates the active pointer, and marks the bridge unready. TypeScript must reload the window after activation; for CLI activation, send `cli_respond` first and then reload. `cache_info()` returns `{bridgeVersion: 1, activeVersion, cachedVersions}`. The frontend owns download policy and manifest bridge compatibility checks. Missing cached assets return an error, never another version's asset.

The loader uses Tauri's documented [`on_web_resource_request`](https://docs.rs/tauri/2.11.5/tauri/webview/struct.WebviewWindowBuilder.html#method.on_web_resource_request) hook. It applies to packaged app-origin resources, not a Vite development server. Use the ordinary Cargo build with its default `custom-protocol` feature when verifying cached updates.

Install the `bluewing` executable next to `bluewing-desktop`. `bridge_ready()` returns `{bridgeVersion:1,webVersion,cliPath}`; call it after installing the `bluewing:cli-request` listener. Its payload is `{id,args,input?}`. Respond with `cli_respond({id,response,exitCode})`. The launcher reserves `--stdin` and forwards other arguments unchanged. Both availability errors and successful responses print JSON. Requests time out after 60 seconds; a timeout does not cancel a running frontend command.

Generic database/file commands use camelCase payloads. SQLite query results return booleans as integer 0/1 and blobs as `{blob:base64}`. `database_query` is read-only; mutations belong in `database_transaction`. An OS lock on a canonical sibling `.lock` file excludes other adapter writers until `database_close` or process exit. The small lock file remains on disk; it contains no project data. Locking the database itself conflicts with SQLite on some filesystems. Filesystem access and SQL are local application capabilities, so cache only trusted application bundles.

Verified on macOS: Cargo check, both binary builds, six Rust tests, and the real webview smoke test. Windows and Linux builds have not been run. Tauri app bundling is enabled for macOS; distribution signing is not configured. Both Cargo binaries are included in the app's `Contents/MacOS` directory. Development uses `http://127.0.0.1:1420`; Tauri starts Vite on that port, and builds the web frontend before production builds.
