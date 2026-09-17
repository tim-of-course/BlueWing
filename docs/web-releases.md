# Web releases

The macOS shell contains a complete initial web application. Subsequent web releases are complete cached directories served through the same local app origin. No service worker or separate JavaScript runtime is required.

Build a version with:

```sh
bun run web:release 0.1.1
```

The output is `output/web/0.1.1/`, including PDF workers, fonts, CMaps, codecs, and a `manifest.json` with file hashes and bridge version 1. Publish the entire directory to a static HTTP host that permits the desktop origin to fetch it with CORS. The repository does not configure a public release host.

In the app's update dialog, enter the manifest URL and download it. Close the project before activating. The CLI exposes the same workflow through `web.stage` and `web.activate`. A failed download or hash mismatch leaves the current release active. Native activation switches the complete version; missing files do not fall back to files from a different release.

The native bridge rejects activation while a project is open. TypeScript also checks unfinished interface drafts. Cached releases start without reaching the release server. The macOS webview disables background throttling so terminal requests and downloads continue behind other apps; [Tauri documents this policy](https://docs.rs/tauri/2.11.5/tauri/webview/struct.WebviewWindowBuilder.html#method.background_throttling). A web release can change UI, calculations, commands, and TypeScript storage migrations; new native capabilities still require a desktop build.

Use a new version string for each release. The bundled version is `0.1.0`. Rollback does not reverse project data migrations, so future format changes must state which app versions can reopen the resulting files.
