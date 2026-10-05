# Validation record

Validated locally on 2026-10-05, including datasheets, AI package export, selection, copy/paste and anchored resizing.

## Result

- `npm test`: all 42 unit cases pass across geometry, connectivity, documents,
  alignment, export structure and file handling.
- `npm run test:browser`: passes in headless desktop Chrome with no page errors.
- `npm run format:check`: passes; `git diff --check`: passes.
- All scripts referenced by the entry page exist. No IndexedDB, OPFS, localStorage,
  external API calls or removed subsystem hooks remain in the production scripts.

The browser test imports front/back synthetic board photographs through the file
input, calibrates scale, aligns matching points, places parts, edits values,
traces copper, adds a through via and back-side trace, names GND, creates/resizes a
custom pad, uses conventional undo/redo, saves twice to the same chosen handle,
reopens the saved JSON with images, and downloads an AI package ZIP.
It also verifies that a project-name edit is visibly Unsaved before leaving the
field and that Ctrl+S commits it.

The six persistence unit cases cover repeat Save without another picker, write
failure, picker cancellation, concurrent edits during a write, external file
modification and invalid Open preserving the current document and handle.

The direct-resizing browser workflow verifies fixed opposite corners, all four
rotated/back-side body corners, untouched copper during body resizing, pad contact
changes on release, one history entry per drag, undo/redo and Escape cancellation.
It exercises circular SMD/plated pads, a fixed drill and minimum copper margin,
Space/middle-button panning over handles, interior component/pad movement, trace
vertex editing, zoomed handles and save/reopen of the final geometry. Screenshots
of selected body and pad handles were inspected. Unit coverage also checks old
scale migration, equivalent world geometry and idempotent normalization.

The selection browser workflow opens a three-component fixture through the normal
Open command and verifies full-containment marquees, pads inside bodies, parent
canonicalization, mixed group movement and deletion, and exactly one undo entry
per edit. Attached endpoints follow moved pads while intermediate bends stay put.
It verifies Ctrl/Cmd copy and paste, fresh identities/references/pin numbers, no
copied net assignments or traces, relative spacing and same-parent pad paste.
Free and Shift-constrained body/pad resizing keep their opposite corners anchored;
body offsets and trace attachments survive save/reopen. Pin labels and their absence
on group selections are checked as canvas text, with formatting covered separately
by a unit test. New/Open clears the internal clipboard. AI package export succeeds.

## Initial size reduction

The following records the initial simplification, before direct resizing was added.
Measure only runtime JS, HTML and CSS actually loaded by the entry page; exclude
both old large sample/library assets and new development dependencies/tests/docs.

| Measure                |  Upstream | Simplified |
| ---------------------- | --------: | ---------: |
| Loaded source files    |        50 |         12 |
| Formatted source lines |    23,641 |      3,988 |
| Source bytes           | 1,155,225 |    118,724 |

That is about 83% fewer lines and 90% fewer source bytes. The deleted application
modules and old sample/library assets are retained in the local Git history.

## Practical limits

The test file pickers use deterministic handles, rather than driving OS-native
Open/Save dialogs. Saved file contents and their full application round trip are
verified; native picker permissions remain a manual desktop check.

The datasheet browser workflow attaches one PDF to two components and verifies
SHA-256 deduplication. It replaces one copy with a different PDF of the same name,
checks Undo/Redo and Remove/Undo, opens a PDF in a new tab, saves and reopens the
single JSON project, then verifies PDF bytes and distinct ZIP paths. It confirms
connectivity warnings appear in both graph and context, and that corrupt embedded
PDF checksums reject Open without replacing the current project. The ZIP is
unpacked and checked for its expected files and omitted physical coordinates.

Tests use synthetic photographs and a small reconstruction. They do not establish
accuracy for perspective-distorted photographs or performance on very large scans
and dense boards. No deployment or GitHub Actions run is claimed by these local
checks.
