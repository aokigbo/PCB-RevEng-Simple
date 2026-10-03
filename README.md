# PCB RevEng Simple

A focused PCB reverse-engineering workspace: photographs → components and pads →
traces and vias → electrical nets → KiCad netlist.

A smaller derivative of [gamerpaddy/PCB-RevEng](https://github.com/gamerpaddy/PCB-RevEng),
starting at `f820cc3`. One board, one workspace, five tools. No runtime dependencies,
accounts, browser project database, AI, multiplayer or built-in schematic editor.

## Run

Use desktop **Chrome or Edge** and serve this folder locally:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open <http://127.0.0.1:8080>. A static HTTPS host also works. There is no build step.
File System Access support is required for Open / Save / Save As. Browsers without
it display a clear notice and disable those actions. Prefer localhost/HTTPS over
opening `index.html` directly.

## Workflow

1. Add a front and/or back PNG, JPEG or WebP photograph.
2. Use **Measure → Set scale**: click two points and enter their known separation.
3. Use **Align front & back**: select two matching landmarks on the front, then
   those same landmarks on the back, in the same order. Back photos are mirrored
   on import; their properties let you change this if the scan is already mirrored.
4. Place components. Use **Select** to edit references, values, rotation, package
   body dimensions and individual pad geometry. Drag a selected body's or pad's
   corner to resize it around its centre. Body resizing leaves copper unchanged;
   round pads stay circular and keep their drill size. Custom components support
   manually placed pads.
5. Draw traces. Click to add corners, click a conductor or press Enter to finish.
   Place vias to connect the front and back. Inspect and name nets in Properties.
6. **Save As** chooses a `.pcbrev` file. **Save / Ctrl+S** updates that same file.
7. Export a **KiCad `.net` netlist** or a **BOM `.csv`**.

The `.net` export contains components and pad connectivity, not a finished KiCad
schematic or routed PCB. Assign or verify footprints in KiCad. The small package
catalog is a tracing aid; custom footprints can leave the KiCad footprint blank.

Files are self-contained, versioned JSON with embedded photographs. Put them in
an Obsidian vault or any normal folder. The actual file is the source of truth:
there is **no browser autosave**. Unsaved work needs Save before closing the app.

## Reliability and limits

- Nets are derived from physical copper contact, including pad shapes, trace
  widths, same-side crossings, plated pads and front/back vias. Deleting or moving
  copper recalculates connectivity. Names do not create invisible connections.
- Touching copper with conflicting names is highlighted. Disconnected groups with
  the same imported name are reported. Resolve warnings before netlist export.
- Saves are marked Saved only after the write closes successfully. Canceled and
  failed saves keep the old handle/checkpoint; edits during a write stay Unsaved.
  Files modified externally are not overwritten by ordinary Save.
- Undo/redo retains 60 document changes in memory, including photo import and
  alignment; image bytes are shared between snapshots. View changes aren't edits.
- One board and two copper sides only. Alignment corrects translation, rotation
  and uniform scale, not perspective distortion. Use flat, perpendicular photos
  or scans. Very large scans/boards have not been performance-qualified.
- Some older v1/v2 projects can be converted. Unsupported multi-board, schematic,
  annotation, inner-layer, warped/linked-image or unknown-footprint data causes a
  clear refusal. Original files are never silently flattened. Converted projects
  require Save As. See the [format documentation](docs/PROJECT-FORMAT.md).

## Development

```sh
npm ci
npm test
npx playwright install chromium
npm start                       # keep running in another terminal
npm run test:browser
npm run format:check
```

Node 20+ is recommended. Python 3 runs the local preview. Playwright and Prettier
are development-only dependencies; they are not loaded by the application.
Browser tests use deterministic file-picker handles and a synthetic board image.
They verify the UI workflow and saved JSON round trip, but cannot validate the OS
file-picker dialogs. Native dialog checks and an actual KiCad import remain manual.
`CHROME_PATH` can select an installed Chrome; `TEST_URL` overrides the preview URL;
`TEST_OUTPUT` selects the browser-test artifact folder.

See [the user guide](docs/USER-GUIDE.md), [architecture audit](docs/ARCHITECTURE-AUDIT.md),
and [validation record](docs/VALIDATION.md).

## Attribution

The original PCB RevEng application is by gamerpaddy. This derivative retains
adapted parametric footprints, pad/segment geometry, and KiCad netlist/CSV export
code. Full upstream history is retained in the original local checkout; this
repository is uploaded as a source snapshot. Upstream's README license statement is
preserved in [UPSTREAM-NOTICE.md](UPSTREAM-NOTICE.md); no replacement license is implied.
