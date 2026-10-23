# Sidebar page preloading recommendation

Recommendation only, October 20, 2026. No cache behavior or memory limits changed.

Use sidebar visibility to choose a small set of decoded full-resolution pages. Treat 25 as the maximum number of candidates, and admit only the pages that fit a byte budget. Keep PNG initially. WebP may reduce encoded storage and transfer costs, but cannot shrink the decoded bitmaps under the current cache accounting.

## Current behavior

- `src/pdf/page-images.ts` defaults to 512 MiB for full images and 32 MiB for previews. `src/pdf/raster.ts` counts decoded memory as width × height × 4. Encoded bytes, viewer leases after eviction, PDF workers, temporary rendering buffers, and browser/GPU overhead sit outside that limit.
- Preparation ranks pages by distance from the active page, without sidebar visibility. A full image and preview on disk count as prepared without loading the full image into memory. Thus, “Prepared” does not mean ready for an immediate memory-only swap.
- Background images enter the front of the eviction order. A newly prepared image can be evicted before previously opened pages when the cache is full.
- `SheetNavigator.tsx` already tracks intersecting rows with `visibleRows`. That signal currently drives thumbnails and can also supply full-page preload candidates.

## What fits

At the existing 200 DPI, before rounding and additional overhead:

- A 24 × 36-inch page needs about 132 MiB decoded. Three fit in 512 MiB; 25 need 3.22 GiB.
- A 30 × 42-inch page needs about 192 MiB. Two fit; 25 need 4.69 GiB.
- A 36 × 48-inch page needs about 264 MiB. One fits; 25 need 6.44 GiB.

These counts include the active page. A 1 GiB decoded budget would fit roughly seven, five, or three pages respectively. Increasing the budget is a separate decision after measuring whole-process memory on the constrained 8 GiB reference machine.

## Suggested implementation order

1. Feed the existing visible-row set into a separate decoded-page preload queue. Keep the active page first, then rank visible candidates by distance from it in sheet order. Limit candidates to 25 and admission by decoded bytes.
2. Decode existing disk images even when preparation has already marked them complete. Render only on a cache miss. Reuse existing jobs and raster resources.
3. Protect the active page and admitted visible pages during eviction. Avoid decoding candidates that cannot remain resident. Project-wide disk preparation stays lower priority.
4. Preload one page at a time, cancel obsolete queued work after scrolling/filtering, and give page clicks priority. Today's full-size `acquire()` calls are foreground work, so calling it concurrently for every candidate would needlessly compete with clicks. Running native image decoding cannot be interrupted; keep speculative work bounded.
5. Measure the resulting working set before considering a higher memory budget or another image format.

## Compression and other memory savings

Lossless WebP is worth benchmarking only if cache reads or decoding remain a bottleneck. Smaller encoded files could reduce disk reads, native IPC traffic, and retained encoded-byte memory. The same page still becomes a full-size decoded bitmap.

WebP supports lossy and lossless encoding, but the canvas API exposes format and quality rather than a portable explicit lossless switch. Merely requesting `image/webp` does not establish pixel fidelity. Unsupported formats may fall back to PNG. WebP also has a 16,383-pixel side limit, while Bluewing allows 16,384. See [Google's compression documentation](https://developers.google.com/speed/webp/docs/compression), [canvas serialization](https://html.spec.whatwg.org/multipage/canvas.html#serialising-bitmaps-to-a-file), and [WebP dimensions](https://developers.google.com/speed/webp/faq#what_is_the_maximum_size_a_webp_image_can_be).

The most useful other memory targets to measure are retained full-image encoded bytes after persistence, idle PDF document workers and their source chunks, and overlapping full-page rendering/encoding buffers. Those savings could make a higher decoded budget practical, but would not automatically change the existing 512 MiB limit. The 32 MiB preview cache is too small to recover even one ordinary architectural master.

The viewer already shares immutable raster leases and uses a viewport-sized drawing canvas. Keep that ownership model.

## Verification before adopting

Compare disk-cached and decoded-preloaded navigation on real plans at unchanged resolution. Record page-display time, cache reads/decodes, raster count, frame gaps, and whole-process memory. A resident-page click should require neither disk decoding nor PDF rendering. Exercise scrolling far from the active page, filtering, closing the sidebar, and clicking during a preload. Check that admission and eviction do not create a repeated decode/evict loop.

Use the guarded browser commands at one worker, then measure native WebView2 and WKWebView behavior. No performance improvement or codec fidelity result is claimed by this recommendation.
