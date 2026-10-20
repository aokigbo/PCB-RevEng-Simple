# Validation record

Sparse TIFF architecture validation on 2026-10-19.

Unit tests cover existing electrical/editor semantics plus streaming bounded copy,
copy cancellation, failed metadata inspection, metadata-only v2 migration, opening
without cache enumeration, missing sources, priority ordering, comparison fairness,
blend endpoints, coarse retention/fallback and stale read aborts. Real TIFF fixtures
verify deferred byte-count tags and consistent page/SubIFD overview discovery.

Browser tests exercise New/Open/Save, TIFF source copy without eager cache,
stripped/tiled/LZW/Deflate/BigTIFF native pixel fidelity, direct L3 generation without
child levels, disk and memory reuse, cache clear/regenerate, source identity changes,
missing-source copper preservation, write-denied cache degradation and actual
page/SubIFD overview pixels. Existing editing, navigation, alignment, clipboard,
PDF/BOM/AI ZIP and v1 migration workflows continue to run.

```sh
npm test
npm run test:browser
npm run format:check
git diff --check
```

Fixtures are created in memory at manageable sizes; no multi-gigabyte assets are
committed. Temporary browser directories substitute the OS folder picker. Cache
write denial is injected into the test worker's filesystem capability, with no
production test hooks. Tests inspect completed nonempty cache files before reuse.

Actual throughput and peak RSS on a 10–15+ GB project/8 GB computer remain a manual
qualification task. TIFF block geometry and storage speed affect first-visit
latency. The implementation bounds raster windows, decoder concurrency, block reuse,
bitmap memory and persistence backlog; project disk size does not imply equivalent
RAM use. PNG/JPEG remain capped at 32 megapixels, PDF files at 64 MiB, legacy JSON
at 256 MiB and project JSON on Open at 32 MiB. External source replacement detection
uses size/timestamp checks, not a whole-file checksum. Source/file modification can
race a filesystem read; ordinary browser writable-file atomic-close semantics apply.

## One-row scanner TIFF regression

The reported file was reproduced read-only in an isolated Chrome project using a
project-owned copy: 1,718,664,684 bytes, RGB8, 20,400 × 28,080, uncompressed, 28,080
one-row strips. No private image data or source paths are included in the repository.

Before the fix, no tile appeared after 22 seconds of viewing. Proportional browser
memory rose from approximately 336 MiB to 1,419 MiB, while as many as 2,775 strip
reads waited. The controlled run was stopped at its memory guard before a crash.
The old 1024-row raster windows and wake-all decode gate were traced directly.

After the fix, the same file produced its first visible tile about 4 seconds after
import. All five requested tiles completed, the decode queue peaked at 3 waiters,
and measured proportional memory settled near 482 MiB. These are observations on
this machine, not universal timing promises. The original file's size, modification
time and file identity were unchanged before and after both runs.

The copied scan also passed reopening, native-resolution source-pixel comparisons,
12 rapid pans with cancellation, and returning to the cached fit view. Native/pan
runs remained below approximately 505 MiB proportional memory in the sampled data.
The automated regression checks the same logical image dimensions without a large
fixture, asserts two-row demand reads, FIFO permits, immediate queued cancellation,
and imports a real manageable one-row-strip TIFF in the full browser workflow.
This validates the reported scan; a full 10–15 GB multi-scan session is still a
separate hardware qualification task.
