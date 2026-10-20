# Multilayer sparse TIFF architecture

The source of truth is a portable v3 directory. Physical layers, board-unit copper,
PDFs and alignment remain engineering data. Image cache state is disposable and
never appears in history or `project.json`.

| Module                               | Responsibility                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| document.js                          | v3 validation, metadata-only v2 migration, layers/geometry/history                    |
| files.js                             | transactional folder Open/Save, source checks, cache clearing, asset cleanup          |
| image-pyramid.js                     | logical levels, manifests, 16 MiB streaming source copy, import transaction           |
| image-source.js                      | TIFF format/block limits, logical geometry, consistent page/SubIFD overviews          |
| tile-engine.js                       | persistent worker RPC, cancellation, local timing statistics                          |
| tile-worker.js                       | lazy TIFF lifetimes, bounded block reuse/window sampling, sparse disk reads/writes    |
| tile-cache.js                        | weighted bitmap LRU, viewport priorities/fairness, generation aborts, parent fallback |
| legacy-image-worker.js               | manageable PNG/JPEG/v1 materialized image migration only                              |
| registration.js                      | explicit source transforms, flips and least-squares alignment                         |
| geometry.js / connectivity.js        | physical-layer collisions and continuous shared via conductors                        |
| canvas.js / editor.js / workspace.js | image composition, copper editing, layers, controls and shortcuts                     |
| attachments.js / export.js           | PDF files, normal PDF opening, electrical BOM/context/streamed ZIP                    |

## Import and completeness

TIFF copy uses bounded 16 MiB slices with writable backpressure. Only metadata is
inspected afterward; count/offset tables stay deferred. The manifest is written
before metadata adoption. Failure/cancellation leaves State unchanged and attempts
partial-folder removal; safe cleanup handles remaining orphans. `source.tif` is
authoritative. No TIFF cache files are prerequisites for successful import.

v2 scans migrate to `legacy-pyramid` and retain their existing files. They cannot
have their only pixels cleared as disposable cache. Small ordinary image imports
and v1 embedded photographs still use bounded legacy materialization.

## Demand-driven image engine

The main thread plans logical 512-pixel tiles in source coordinates. Priority is
visible, fallback, one-ring prefetch, persistence, then only the highest two logical
overview levels. Each visible class is center-first and interleaved between scans.
At blend endpoints the hidden image produces no rendering requests. Transform and
alpha edits never invalidate source-space pixels.

One persistent engine worker shares a decoder pool of at most three workers with
at most three main-thread tile requests. Source-block size reduces heavy decode
concurrency to two above 32 MiB and one above 64 MiB; blocks above 128 MiB are
rejected. Compressed byte counts are checked by indexed async tag reads per block.
Parsed sources/images stay open (at most three inactive/active source entries under
normal viewing). Shared decoded block promises use a roughly 96 MiB LRU; in-flight
aborted promises are not reused by a new viewport.

L0 reads native RGB without resampling. Reduced levels map directly into the
closest consistent TIFF page/SubIFD overview, or the original TIFF. GeoTIFF.js 3
allocates its input raster before reducing it, so reduced reads are split into
source windows of at most roughly 1024 square pixels and sampled bilinearly into
a 512-pixel output tile. No child cache levels are generated as dependencies.

Memory miss checks disk, then source. Missing/damaged cache PNGs regenerate.
Bitmap delivery occurs before PNG encoding/write; persistence has a bounded eight
canvas backlog, runs when decode work is quiet, and is optional. Cache write failure
warns once per project and does not prevent rendering. New viewport generations
abort obsolete work and reject/close stale results; coarse parents fill detail holes.
The bitmap LRU targets 512 MiB (1 GiB emergency ceiling), closes evictions, and
preferentially retains coarse navigation tiles. `TileStats` is local-only profiling.

## Data integrity and limits

Open reads project/manifest metadata and source file attributes, never cache trees,
full TIFFs or checksums. TIFF parsers start only for scans requested for display.
Source size/timestamp mismatch refuses stale disk cache and warns; missing sources
leave copper available. Saves and cache operations are independent. Undo retains
asset references; explicit cleanup removes only unreferenced app-owned folders/PDFs.

Tests use real manageable RGB TIFFs, deferred tags, LZW/Deflate, BigTIFF, page and
SubIFD overviews. Synthetic correctness is not a 15 GB/8 GB hardware throughput or
peak-memory qualification. No native code, image daemon, backend, GPU preprocessing,
account system or cloud dependency is introduced.
