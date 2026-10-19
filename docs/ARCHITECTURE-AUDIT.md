# Multilayer architecture

The v2 refactor replaces the former two-sided embedded-file model. The source of
truth is a portable project directory. Physical depth, visual evidence, engineering
geometry and transient view state have distinct responsibilities.

| Module           | Responsibility                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| document.js      | v2 schema, stable physical layers, ordered via spans, board-unit geometry, lightweight history |
| legacy-import.js | isolated validation/conversion of v1 and the existing supported upstream subset                |
| files.js         | folder handles, transactional metadata open/save, asset files, safe explicit cleanup           |
| image-pyramid.js | pyramid/manifest rules and cancellable import coordinator                                      |
| image-worker.js  | windowed TIFF decode, sequential PNG tile/pyramid writes, completion marker last               |
| tile-cache.js    | viewport/LOD requests, bounded concurrency, stale generations, weighted LRU and bitmap release |
| registration.js  | forward/inverse scan transforms, explicit flips, 3–5 point least-squares similarity            |
| geometry.js      | board-unit component/pad geometry and copper collision primitives                              |
| connectivity.js  | per-physical-layer collision passes sharing one union node per via                             |
| canvas.js        | at most two tiled scans and active-layer reconstruction, independent interaction overlays      |
| editor.js        | selection, move/copy/paste, corner resize, layer-aware endpoint anchors and tool gestures      |
| workspace.js     | layer/scan stack, inspectors, view controls, alignment preview, shortcuts and HUD              |
| attachments.js   | hash-deduplicated PDF files and normal browser viewing                                         |
| export.js        | BOM and one derived electrical model for Markdown/JSON, streamed ZIP output                    |
| catalog.js       | small adapted parametric package catalog, materialized into explicit board-unit geometry       |

## Electrical truth

Pads and traces participate on one stable layer ID. A visible drill is geometry
only. A via is one conductor on all depth-ordered layers between its endpoints.
Each layer gets a geometry collision sweep; touching objects union their conductor
nodes. Names remain metadata on copper and never create virtual connections.
Reordering warns if via membership changes. Layer deletion adjusts endpoint spans
and removes collapsed vias. Copy/resize/move preserve the existing direct editing
model and layer-aware exact endpoint anchors.

## Memory and disk

No runtime full-size bitmap is created for a large TIFF. A dedicated preprocessing
worker uses a pinned local geotiff.js build, a two-worker decode pool and uncached
windowed reads. Source blocks are checked before decoding. L0 writes exact RGB
pixels into 512-pixel PNG tiles; later levels combine four child tiles at a time.
The completion manifest is written last. Cancellation terminates preprocessing and
leaves no scan metadata adoption. Incomplete folders are safe to ignore/clean.

Rendering chooses a level from zoom and scan scale, inverse-transforms the viewport,
and requests only intersecting tiles for primary and optional comparison. Four
concurrent tile reads, a 64-entry scheduling batch and request generations prevent
rapid navigation from accumulating decode work. The weighted LRU targets 512 MiB,
with a 1 GiB ceiling, and closes discarded/evicted bitmaps.

Save only rewrites engineering metadata. Undo references files on disk rather than
cloning image/PDF data. Cleanup is explicit and limited to app-owned numeric scan
folders and hash-named PDF files, with current/history/clipboard references retained.
AI ZIP output reads PDF streams sequentially and awaits destination writes.

## Validation limits

The implementation checks metadata, manifests and on-demand files, without reading
every tile at startup. Synthetic stripped, tiled, Deflate, LZW and BigTIFF fixtures
exercise import and full-resolution pixels. Large compressed/decompressed TIFF
blocks are rejected rather than exceeding import budgets. PNG/JPEG import and PDF
size have conservative caps. Actual throughput/storage usage on a 15 GB board and
an 8 GB computer remain a manual hardware qualification task.

No stored AI graph, account service, backend, multi-user system, manufacturing
output, perspective warp, automatic trace recognition or built-in PDF viewer is
introduced. The only remaining front/back interpretation lives in legacy import.
