# Web releases

The macOS shell contains a complete initial web application. Subsequent web releases are complete cached directories served through the same local app origin. No service worker or separate JavaScript runtime is required.

Build a version with:

```sh
bun run web:release 0.1.1
```

The output is `output/web/0.1.1/`, including PDFium's worker and WASM binary, runtime notices, and a `manifest.json` with file hashes and bridge version 9. Rebuild the native shell for bridge 9 before installing this web release. Publish the entire directory to a static HTTP host that permits the desktop origin to fetch it with CORS. The repository does not configure a public release host.

In the app's update dialog, enter the manifest URL and download it. Close the project before activating. The CLI exposes the same workflow through `web.stage` and `web.activate`. A failed download or hash mismatch leaves the current release active. Native activation switches the complete version; missing files do not fall back to files from a different release.

The native bridge rejects activation while a project is open. TypeScript also checks unfinished interface drafts. Cached releases start without reaching the release server. The macOS webview disables background throttling so terminal requests and downloads continue behind other apps; [Tauri documents this policy](https://docs.rs/tauri/2.11.5/tauri/webview/struct.WebviewWindowBuilder.html#method.background_throttling). A web release can change the UI, calculations, and commands. New native capabilities require a desktop build.

Use a new version string for each release. The shell reserves `0.1.0` for its bundled version and `active` in any letter case for its cache marker. Windows can ignore trailing periods in filenames, so those aliases are reserved too. A packaging failure leaves the version available for retry. See the [project-format policy](restart-brief.md#commands-saving-and-history) for supported project files.
