# Validation record

Local validation on 2026-10-19 for the multilayer directory-project refactor.

## Automated coverage

- 31 unit cases cover stable layers, reorder/delete, board-unit geometry,
  arbitrary-layer collisions, continuous via spans, drilled pad semantics, exact
  endpoint anchors, selection/copy/datasheet preservation, v1 migration, alignment,
  flips, cache eviction/concurrency/stale results, directory persistence and PDF files.
- Browser workflows use desktop Chrome and native temporary directory handles.
  The OS folder picker is substituted deterministically; production continues to
  use user-selected read/write folders.
- The browser imports real synthetic TIFFs: stripped RGB, tiled Deflate, stripped
  LZW, and BigTIFF. It checks L0 pixels, edge sizes and pyramid dimensions. The
  compressed and BigTIFF fixtures compare every L0 pixel against the source pattern.
- New/Open/Save, multiple scans, view state isolation, comparison, Space navigation,
  normal versus modified wheel behavior, components, copy/paste, shared PDF files,
  and streaming AI ZIP contents are exercised through the browser.
- Alignment reference/target picking, preview without mutation, apply/undo/redo,
  explicit flips, drag reorder confirmation, layer deletion/undo, cancellation,
  and v1 import into a separate folder are exercised. Legacy conversion preserves
  mirrored pad positions and explicit barrel connectivity, and PDF opening reads
  the migrated project file.
- Unit persistence tests verify metadata-only saves, transactional invalid Open,
  missing manifests leaving copper inspectable, external metadata modification
  protection, shared PDF replace/remove/undo and restricted asset cleanup.
- Cache tests check weighted memory, recent access, eviction/close, hard limits,
  bounded concurrent reads, stale result disposal, and native versus overview LOD.

## Checks

```sh
npm test
npm run test:browser
npm run format:check
git diff --check
```

Browser artifacts are generated under the selected `TEST_OUTPUT` path. Development
fixtures are created in memory; no multi-gigabyte images are committed.

## Practical qualification limits

The tests demonstrate the bounded architecture and correctness on manageable
fixtures. They do not establish end-to-end throughput or memory measurements for
a real 10–15 GB board on an 8 GB computer. Scanner variants beyond the tested RGB
fixtures, physical photo quality, alignment landmark quality, OS-native permissions,
and disk exhaustion during very large imports still warrant manual qualification.

TIFF block limits prevent oversized strips/tiles from silently allocating full
scans. PNG/JPEG imports are capped at 32 megapixels, PDFs at 64 MiB, legacy JSON at
256 MiB, and project metadata Open at 32 MiB. Save uses ordinary browser atomic
writable-file semantics, with a modification check; it cannot eliminate an external
write racing the final close. Missing tiles are detected when viewed, not by an
expensive startup traversal.
