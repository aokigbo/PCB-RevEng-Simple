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
