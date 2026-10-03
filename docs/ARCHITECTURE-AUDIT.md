# Simplification audit

Inspected upstream `gamerpaddy/PCB-RevEng` at `f820cc3` before implementation.
The original tracked JS/HTML/CSS total is 23,647 lines. Classic scripts share
global state and require ordered loading; there are no runtime package dependencies.

## Current architecture and decisions

| Module / feature                                          | Classification      | Dependency and removal risk                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `state.js`: objects, nets, IDs, history, serialization    | CORE / SIMPLIFY     | Board aliases, schematic wires, net protection, selective history and persistence are entangled. Separate the document from derived connectivity and session state.                                                                                                                  |
| `footprints/*`, `view/geom.js`                            | CORE                | Rotation, back-side mirroring, pad extents and through-hole semantics directly determine connectivity. Retain and test the geometry. Reduce generators to a small catalog; persist explicit pad geometry.                                                                            |
| `view/core`, `render`, `draw`, `hittest`, `overlays`      | KEEP BUT SIMPLIFY   | Rendering depends on UI selection, tool modes, split panes and schematic helpers. Retain geometry, pan/zoom and hit testing; remove split/X-ray/notes/ratsnest settings.                                                                                                             |
| `tools/core`, `select`, `ops`                             | KEEP BUT SIMPLIFY   | Selection mixes pad editing, schematic jumps, notes, cutting, locking and calculators. One Select tool should move objects and trace vertices and inspect/edit pads.                                                                                                                 |
| `tools/trace`, `via`, `checker`, state net registry       | CORE                | Copper contact and names currently use several distinct merge/overlap policies and modal decisions. Preserve side-aware pad geometry; recompute physical connected components after changes, including deletion. Conflicting names must remain visible and block misleading exports. |
| `align.js`, image layers                                  | KEEP BUT SIMPLIFY   | Crop, perspective warp, deskew and rotation have shared image-history hooks. Replace interaction modes with two-point calibration and two corresponding-point pairs for similarity alignment. Mirror the back photograph explicitly.                                                 |
| `imagetiles.js`                                           | UNSURE / DEPENDENCY | Helps large scans, but depends on the old layer draw pipeline. Remove only with the old renderer; large-image performance remains a documented limit to verify on representative scans.                                                                                              |
| `autosave.js`, `projects.js`                              | REMOVE / REPLACE    | IndexedDB/OPFS, snapshots, ZIPs, URL/paste sharing and welcome pages obscure the source of truth. Browser data must never be mistaken for a disk save. Use file handles and mark saved only after successful close.                                                                  |
| `netlist.js`                                              | KEEP BUT SIMPLIFY   | The first section exports connectivity; most of the file implements schematic symbols/layout/export. Retain netlist escaping and BOM CSV, remove schematic logic.                                                                                                                    |
| `schematic.js`, `boards.js`, `netstab.js`                 | REMOVE              | Board arrays alias active collections and nets span boards. Legacy multi-board and schematic-rich documents cannot be silently flattened. Reject unsupported conversions and preserve originals.                                                                                     |
| `ai.js`, `multiplayer.js`                                 | REMOVE              | Hooks wrap editing, permissions and saves; remove corresponding event wiring/state, not just scripts.                                                                                                                                                                                |
| EAGLE/GENCAD/EasyEDA/Gerber import, resolver              | REMOVE              | Repair/import data and external formats are outside photo reconstruction. Project-file import remains.                                                                                                                                                                               |
| Layer stack/3D, inner layers, blind vias                  | REMOVE              | Constrain the new model to front/back and through vias; reject incompatible old documents.                                                                                                                                                                                           |
| Footprint search/library, quick-add parser, custom import | REMOVE              | Small generators plus directly editable custom pads replace search, library assets and alternate placement paths.                                                                                                                                                                    |
| Key rebinding, selective history, notes, calculators      | REMOVE              | Remove their controls, settings, data and dead documentation.                                                                                                                                                                                                                        |

## Proposed UI

One workspace: project name and Saved/Unsaved indicator with New/Open/Save/Save As
and Export at the top; Select, Component, Trace, Via, Measure on the left; the board
canvas in the center; a context-sensitive properties panel on the right. Bottom
controls select Front/Back/Both, image opacity, visibility, grid and fit/zoom.
Image setup and alignment use the same properties panel. No project dashboard,
schematic tab, modal footprint picker or configurable hotkey system.

## Proposed document and persistence

Versioned, indented `.pcbrev` JSON, one board, two optional embedded image data URLs,
explicit component/pad geometry, traces, vias, names attached to conductors, scale.
Runtime image objects, selection, pointer modes, undo history and file handles are
not serialized. Physical nets are derived from geometry. Embedded photos make the
document self-contained and suitable for an Obsidian folder.

File System Access API on localhost/HTTPS in desktop Chrome/Edge: Open obtains a
handle; Save writes back to that handle; Save As obtains a new handle. Canceled or
failed writes must not change the saved checkpoint or current handle. Concurrent
edits during a write must remain unsaved. New/Open guard unsaved changes; validate
and decode a candidate document before replacing the active document. Legacy
conversions always start without an overwrite handle and require Save As.
Unsupported browsers get an explicit requirement message, not a fake disk-save.

## Incremental implementation and checks

1. Add this inventory and regression tests for preserved pad geometry and exports.
2. Extract the small core; add physical connectivity, file validation and linear
   history tests while the old application remains available in Git history.
3. Consolidate editing into one workspace using the tested core and direct file
   handles. Test image alignment and save/open failure/cancel behavior.
4. Delete removed subsystems, assets, state, styles and obsolete docs. Replace the
   deployment-only workflow with checks; deployment remains explicit.
5. Exercise the browser workflow from photographs through calibration, alignment,
   components, custom pads, traces, vias, net naming, undo, save/reopen and export.
   Record actual validation and limitations; do not claim KiCad desktop validation
   unless KiCad is available and run.
