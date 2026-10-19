# PCB RevEng Simple

A local workspace for reconstructing PCB connectivity from destructive inspection.
Organize the physical board depth as layers, keep several scans per layer, and
trace copper in one common coordinate system. Compare two scans while following
one shared via through its physical layer span.

A focused derivative of [gamerpaddy/PCB-RevEng](https://github.com/gamerpaddy/PCB-RevEng).
The application is static: no account, cloud service, database or runtime install.

## Run

Use desktop **Chrome or Edge**, served on localhost or HTTPS:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open <http://127.0.0.1:8080>. There is no build step. Directory access requires
Chrome/Edge's File System Access API. The app requests a folder with read/write
access when creating or opening a project.

## Workflow

1. Choose **New** and select a new empty project folder, or **Open** an existing one.
2. Add physical layers, describe their depth, and drag their rows to reorder them.
3. Add TIFF scans to each layer. Preparation writes a lossless PNG tile pyramid.
   The original TIFF can then be moved or deleted.
4. Click a layer and one of its scans. Choose an optional **Comparison** from any
   layer and adjust **Blend**. **Drawing opacity** fades the reconstruction.
5. Select a scan's **⋯** properties to flip or align it against any other scan
   using 3–5 matching landmarks. Preview before applying. Only that scan moves.
6. Place components and pads, trace copper, and add vias with explicit layer spans.
   Calibration is optional and only changes displayed units.
7. Attach component PDFs. Identical files share one hash-named file on disk.
8. **Save / Ctrl+S** writes only `project.json`. Export a BOM CSV or an AI ZIP with
   electrical context, a net-centric graph, warnings and referenced PDFs.

Projects are portable folders:

```text
My-Board/
  project.json
  images/scan-21/manifest.json
  images/scan-21/L0/0_0.png
  images/scan-21/L1/0_0.png
  ...
  datasheets/<sha256>.pdf
```

Keep the whole folder when moving or backing up a project. **Import .pcbrev**
converts an existing v1 project into a separate new folder and preserves the original.
Save As is superseded by normal folder copying outside the app.

## Inspection shortcuts

| Action                                  | Shortcut                          |
| --------------------------------------- | --------------------------------- |
| Previous / next physical layer          | Space+W / Space+S                 |
| Previous / next scan on active layer    | Space+Z / Space+C, or Space+wheel |
| Image blend toward primary / comparison | Space+A / Space+D                 |
| Drawing opacity down / up               | Space+Q / Space+E                 |
| Pan                                     | Space+left drag, or middle drag   |
| Zoom / fit                              | Wheel / F                         |

All inspection actions have visible mouse controls. Conventional New/Open/Save,
copy/paste, undo/redo and Select/Component/Trace/Via/Measure shortcuts remain.

## Memory and data integrity

Scans are read in small windows during TIFF import. Viewing loads only appropriate
visible tiles for at most two scans. The weighted LRU targets 512 MiB of decoded
pixels, has a 1 GiB hard ceiling, closes evicted bitmaps, and permits four concurrent
tile reads. Preprocessing runs in a worker with a two-worker decoder pool.

L0 preserves RGB source pixels losslessly. TIFFs with decoded or compressed blocks
above 128 MiB are refused with a smaller-strip/tile instruction, rather than risking
an unbounded allocation. Ordinary PNG/JPEG import is limited to 32 megapixels;
larger scans should use TIFF. PDFs are limited to 64 MiB each, project metadata to
32 MiB on Open, and legacy JSON import to 256 MiB. The AI ZIP streams to a chosen
file with write backpressure rather than collecting every PDF in RAM.

Undo keeps metadata only; image/PDF files stay on disk. **Clean unused assets**
removes only app-owned scan folders/hash-named PDFs that are no longer referenced
by the current project, undo, redo or the component clipboard. Missing scan assets
produce an error while leaving copper inspectable. Conflicting net names remain
visible and are included in AI exports.

The architecture bounds image memory independently of project disk size. The test
suite uses manageable synthetic scans; a real 15 GB project on an 8 GB machine has
not been performance-qualified. See [validation](docs/VALIDATION.md).

## Development

```sh
npm ci
npm test
npx playwright install chromium
npm start
npm run test:browser
npm run format:check
```

Node 20+ and Python 3 are development tools. `CHROME_PATH`, `TEST_URL` and
`TEST_OUTPUT` override browser-test defaults. Browser tests use native temporary
directory handles as a deterministic stand-in for the OS folder picker.

Read the [guide](docs/USER-GUIDE.md), [format](docs/PROJECT-FORMAT.md), and
[architecture](docs/ARCHITECTURE-AUDIT.md).

## Attribution

Adapted parametric packages and pad/segment geometry come from gamerpaddy's PCB
RevEng. Preserve [UPSTREAM-NOTICE.md](UPSTREAM-NOTICE.md). TIFF decoding uses
[geotiff.js 3.0.4](https://github.com/geotiffjs/geotiff.js) and ZIP output uses
[fflate 0.8.3](https://github.com/101arrowz/fflate), vendored locally with their MIT
notices under `vendor/`. End users need no package installation or CDN access.
