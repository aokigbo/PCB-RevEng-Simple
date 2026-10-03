# Validation record

Validated locally on 2026-10-03 against upstream revision `f820cc3`.

## Result

- `npm test`: all 24 unit cases pass across geometry, connectivity, documents,
  alignment, export structure and file handling.
- `npm run test:browser`: passes in headless desktop Chrome with no page errors.
- `npm run format:check`: passes; `git diff --check`: passes.
- All scripts referenced by the entry page exist. No IndexedDB, OPFS, localStorage,
  external API calls or removed subsystem hooks remain in the production scripts.

The browser test imports front/back synthetic board photographs through the file
input, calibrates scale, aligns matching points, places parts, edits values,
traces copper, adds a through via and back-side trace, names GND, creates/resizes a
custom pad, uses conventional undo/redo, saves twice to the same chosen handle,
reopens the saved JSON with images, and downloads a KiCad-format netlist.
It also verifies that a project-name edit is visibly Unsaved before leaving the
field and that Ctrl+S commits it.

The six persistence unit cases cover repeat Save without another picker, write
failure, picker cancellation, concurrent edits during a write, external file
modification and invalid Open preserving the current document and handle.

## Size reduction

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

KiCad itself is not installed in this environment. The test validates exported
net/pin membership, escaping, balanced S-expression structure and the browser
export download. An actual import in KiCad and footprint-library resolution
remain manual checks. Export contains a connectivity netlist, not a schematic or
routed PCB.

Tests use synthetic photographs and a small reconstruction. They do not establish
accuracy for perspective-distorted photographs or performance on very large scans
and dense boards. No deployment or GitHub Actions run is claimed by these local
checks.
