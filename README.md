# PCB RevEng Simple

A focused PCB reverse-engineering workspace: photographs → components and pads →
traces and vias → electrical nets → portable AI analysis package.

A smaller derivative of [gamerpaddy/PCB-RevEng](https://github.com/gamerpaddy/PCB-RevEng),
starting at `f820cc3`. One board, one workspace, five tools. No accounts,
browser project database, AI chat, multiplayer or built-in schematic editor.

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
   corner to resize with the opposite corner fixed; hold Shift to preserve ratio.
   Body resizing leaves copper unchanged; round pads keep their drill size.
   Drag empty space to select multiple components/pads, then move, delete or
   copy/paste them with Ctrl+C / Ctrl+V (Command on macOS). Custom components
   support manually placed pads.
5. Draw traces. Click to add corners, click a conductor or press Enter to finish.
   Place vias to connect the front and back. Inspect and name nets in Properties.
6. Select a component to attach a PDF datasheet. Open it in a new browser tab,
   replace it or remove it in Properties. Identical PDFs are stored once even when
   several components use them.
7. **Save As** chooses a `.pcbrev` file. **Save / Ctrl+S** updates that same file.
8. Export a **BOM `.csv`** or an **AI package `.zip`**.

The AI package contains `graph.json`, a readable `context.md`, and referenced
datasheets. It uses a net-centric representation of connectivity and includes
warnings for incomplete reconstructions. Board photos and geometry are omitted.

Files are self-contained, versioned JSON with embedded photographs and PDFs. Put them in
an Obsidian vault or any normal folder. The actual file is the source of truth:
there is **no browser autosave**. Unsaved work needs Save before closing the app.

## Reliability and limits

- Nets are derived from physical copper contact, including pad shapes, trace
  widths, same-side crossings, plated pads and front/back vias. Deleting or moving
  copper recalculates connectivity. Names do not create invisible connections.
- Touching copper with conflicting names is highlighted. Disconnected groups with
  the same imported name are reported. AI packages include these warnings.
- Saves are marked Saved only after the write closes successfully. Canceled and
  failed saves keep the old handle/checkpoint; edits during a write stay Unsaved.
  Files modified externally are not overwritten by ordinary Save.
- Undo/redo retains 60 document changes in memory, including photo import and
  alignment; photo and PDF bytes are shared between snapshots. View changes aren't edits.
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
They verify the UI workflow, PDF attachments, saved JSON round trip and ZIP contents,
but cannot validate the OS file-picker dialogs.
`CHROME_PATH` can select an installed Chrome; `TEST_URL` overrides the preview URL;
`TEST_OUTPUT` selects the browser-test artifact folder.

See [the user guide](docs/USER-GUIDE.md), [architecture audit](docs/ARCHITECTURE-AUDIT.md),
and [validation record](docs/VALIDATION.md).

## Attribution

The original PCB RevEng application is by gamerpaddy. This derivative retains
adapted parametric footprints and pad/segment geometry. The browser ZIP library is
[fflate 0.8.3](https://github.com/101arrowz/fflate) under its bundled MIT notice in
`vendor/fflate-LICENSE.txt`. Full upstream history is retained in the original local checkout; this
repository is uploaded as a source snapshot. Upstream's README license statement is
preserved in [UPSTREAM-NOTICE.md](UPSTREAM-NOTICE.md); no replacement license is implied.
