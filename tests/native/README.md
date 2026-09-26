# Native adapter checks

Build the web app first (`bun run build`), then:

```sh
bun run test:native
bun run native:build
python3 tests/native/smoke.py
```

The smoke test opens a real desktop webview with an isolated `BLUEWING_DATA_DIR`, loads a cached bundle, exercises IPC and CLI, activates another complete bundle without rebuilding Rust, and restarts offline. It needs a graphical desktop session. Unit tests cover database and cache failure cases.

To verify a local macOS app bundle after building both debug binaries:

```sh
bun scripts/heavy.ts -- bun x --no-install tauri bundle --debug --bundles app --no-sign
BLUEWING_NATIVE_BIN_DIR="$PWD/src-tauri/target/debug/bundle/macos/Bluewing.app/Contents/MacOS" python3 tests/native/smoke.py
```

The default bundled version is `0.1.0`. `cache_stage` accepts `{version, files: [{path, data}]}` with base64 file bytes. Versions are immutable and must differ from `0.1.0`. `index.html` is required. Paths are relative; traversal is rejected. `cache_activate({version})` requires a closed database, updates the active pointer, and marks the bridge unready. TypeScript must reload the window after activation; for CLI activation, send `cli_respond` first and then reload. `cache_info()` returns `{bridgeVersion: 4, activeVersion, cachedVersions}`. The frontend owns download policy and manifest bridge compatibility checks. Missing cached assets return an error, never another version's asset.

The loader uses Tauri's documented [`on_web_resource_request`](https://docs.rs/tauri/2.11.5/tauri/webview/struct.WebviewWindowBuilder.html#method.on_web_resource_request) hook. It applies to packaged app-origin resources, not a Vite development server. Use the ordinary Cargo build with its default `custom-protocol` feature when verifying cached updates.

Install the `bluewing` executable next to `bluewing-desktop`. `bridge_ready()` returns `{bridgeVersion:4,webVersion,cliPath}`; call it after installing the `bluewing:cli-request` listener. Its payload is `{id,args,input?}`. Respond with `cli_respond({id,response,exitCode})`. The launcher reserves `--stdin` and forwards other arguments unchanged. Both availability errors and successful responses print JSON. Requests time out after 60 seconds; a timeout does not cancel a running frontend command.

Generic database/file commands use camelCase payloads. SQLite query results return booleans as integer 0/1 and blobs as `{blob:base64}`. `database_query` is read-only; mutations belong in `database_transaction`. An OS lock on a canonical sibling `.lock` file excludes other adapter writers until `database_close` or process exit. The small lock file remains on disk; it contains no project data. Locking the database itself conflicts with SQLite on some filesystems. Filesystem access and SQL are local application capabilities, so cache only trusted application bundles.

Bridge 4 adds `file_snapshot_open({path})`, `file_snapshot_read({token,offset,length})` and `file_snapshot_release({token})`. Snapshots use immutable temporary files. Reads return raw bytes in chunks of at most 1 MiB. A transaction statement can supply `blob:{token,table,column}` to stream that snapshot into its newly inserted `zeroblob` row inside the same transaction. `database_read_blob({table,column,rowId,offset,length})` provides bounded raw reads for reopening saved assets. The TypeScript PDF path uses these APIs instead of whole-file base64 queries. `database_close` releases remaining snapshots. `database_backup({path?})` creates a recovery copy without overwriting an existing file.

The earlier adapter was verified on macOS and Windows with both binary builds, six Rust tests, and the real webview smoke test. Bridge 4 has nine Rust tests and new macOS integration coverage; see [the detailed-takeoff verification record](../../docs/detailed-takeoff.md). Its new capabilities have not been verified on Windows. On Windows, use `python` instead of `python3`; the binaries have an `.exe` extension, resolved automatically by the test launcher. Linux builds have not been run. Tauri bundles a macOS app or a Windows NSIS installer; distribution signing is not configured. Development uses `http://127.0.0.1:1420`; Tauri starts Vite on that port, and builds the web frontend before production builds.

`app_data_read({key})` returns UTF-8 text or null; `app_data_write({key,data})` atomically replaces a UTF-8 file under the native app data directory. Keys are simple filenames, not paths. Product/library validation stays in TypeScript.

Build commands and direct Python test invocations use the shared resource guard described in [README.md](../../README.md#verify). Run them sequentially; resource-blocked runs are unverified.
