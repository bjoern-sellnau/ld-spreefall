# SPREE|FALL

A walkable, first person reconstruction of central Berlin that runs from a single
link in a browser. You spawn on Pariser Platz facing the Brandenburg Gate, and
you can walk east down Unter den Linden to Museum Island and the Fernsehturm,
south to the Holocaust Memorial and Potsdamer Platz, and north to the Reichstag
and the Spree.

Every building, street, path, tree, river and rail line is generated from
OpenStreetMap data by a pipeline in this repository. The renderer, the physics,
the sound and the data pipeline are all written from scratch.

**No game engine. No 3D library. No runtime dependency of any kind.**

| | |
|---|---|
| Rendering | raw WebGL2, own shaders, own matrix maths, own scene graph |
| Physics | own capsule character controller against a 2D segment world |
| Audio | raw Web Audio API, every sound synthesised at run time |
| Map data | OpenStreetMap, parsed and triangulated by our own code |
| Shipped as | one HTML file, JS modules, one binary bundle, no backend |
| Payload | 9.45 MB, 2.30 MB over the wire with gzip |
| Third party code at run time | none |

## Try it

```
npm install          # only Playwright, and only for the tests and screenshots
npm run fetch        # download the OSM extract for the box, cached in data/raw/
npm run world        # build public/world.bin and public/world.json
npm run serve        # http://localhost:8080/
```

`npm run build` writes a `dist/` folder that can be copied onto GitHub Pages,
Cloudflare Pages, or any static host. There is nothing to run on the server.

## Controls

| | |
|---|---|
| W A S D, arrow keys | walk |
| Shift | run |
| Space | jump onto kerbs and low walls |
| Mouse | look, with pointer lock |
| Touch | drag left to walk, drag right to look |
| Gamepad | left stick walks, right stick looks, A jumps, L3 or LT runs |
| P | photo mode: hides the interface, unlocks the clock, saves a PNG |
| M | enlarge the map |
| N | sound on and off |
| H | help |
| F | debug overlay |
| `spreefall.debugMode(n)` in the console | 1 material, 2 normals, 3 uv, 4 world position, 5 material id, 6 detail fade, 7 view distance |
| 1 2 3 | quality tier: low, medium, high |

Getting within 40 m of one of the eleven landmarks slides in a card with its
name and a sentence of history. Find all eleven and you get a completion screen
with the time taken and the distance walked. The URL always carries your
position, heading and time of day, so a link opens exactly the view you were
looking at.

## What is real and what is generated

This matters, so it is spelled out rather than glossed over.

**Surveyed, from the map.** Every street centreline and its width and surface,
every landmark footprint and its height, the course of the Spree and the
Spreekanal, the outlines of the Tiergarten, the Lustgarten, Monbijoupark and the
Marx-Engels-Forum, the line of the Stadtbahn viaduct, the positions of the
station entrances, and the outline of the memorial. All in WGS84, projected to a
local metric plane centred on the Brandenburg Gate.

**Generated, from that data.** Everything you actually see. There are no
downloaded textures and no downloaded models anywhere in this project:

- Facades are generated in the fragment shader from a per building random seed
  and the building's own storey count, so a five storey block gets five rows of
  windows in its own rhythm, with shopfronts on the ground floor and lit windows
  at night. Landmarks get a separate monumental treatment: taller arched
  openings on a wider pitch and a rusticated base.
- Landmark silhouettes are assembled from primitives to match the real building:
  twelve Doric columns and the quadriga on the Gate, four corner towers and
  Foster's glass dome on the Reichstag, a copper dome and four turrets on the
  Cathedral, a tapering concrete shaft with a sphere and an antenna on the
  Fernsehturm.
- The 2711 stelae of the Holocaust Memorial are placed on Eisenman's grid inside
  the real outline, on an undulating floor sampled from smooth noise, so the
  field rises past your head as you walk into the middle of it.
- Roads draw their own lane markings, kerbs and cobblestones; water animates two
  wave trains and reflects the sky; trees are instanced billboards with a real
  trunk.
- Where the map gives a `building:colour`, that colour is used. Where it does
  not, a colour is picked from a Berlin palette of ochre, cream, grey, sandstone
  and red brick.

**The fallback, and why it exists.** `tools/fetch-osm.mjs` is a complete Overpass
client with retry and backoff, and it is what runs when a network is available.
The sandbox this project was built in denies every OpenStreetMap host at the
egress proxy, so `tools/synth-osm.mjs` exists as a fallback: it writes an OSM XML
document in exactly the same schema from a table of real, hand transcribed Berlin
coordinates in `tools/berlin-facts.mjs`, and fills the gaps between those streets
with generated perimeter blocks in the Berlin pattern. `data/raw/source.json`
records which of the two produced the cached file. Nothing downstream of the
parser can tell the difference, so pointing the pipeline at a live Overpass
response changes nothing else.

## How it is built

```
tools/
  fetch-osm.mjs      Overpass client, retry with exponential backoff, caching
  synth-osm.mjs      the offline fallback dataset, in the same OSM XML schema
  berlin-facts.mjs   the surveyed coordinate table
  osm-xml.mjs        our own OSM XML reader, one forward pass, no library
  earcut.mjs         our own ear clipping triangulator with hole support
  geometry.mjs       extrusion, roofs, ribbons, and the landmark primitives
  landmarks.mjs      the bespoke shape for each building people came to see
  terrain.mjs        the ground height field
  build-world.mjs    the whole pipeline, tiling and the binary bundle
  build-dist.mjs     produces dist/
  verify.mjs         headless screenshots and console error check
  test-ui.mjs        headless test of the game layer
src/
  shared/            constants the pipeline and the runtime both import
  engine/            maths, GL plumbing, tile streaming, controller, input, loop
  render/            renderer, sun position
  shaders/           all GLSL, as JS template strings
  game/              landmarks, minimap, audio, photo mode, intro, URL state
```

### The data format

The world is cut into 100 m by 100 m tiles. Each tile carries an interleaved
vertex buffer at 20 bytes a vertex, an index buffer, a collision blob and a tree
instance list, all inside one `world.bin`, with `world.json` listing the offsets.

```
offset  type        meaning
0       int16 x3    position, tile local, quantised at 1/64 m
6       int8  x4    normal, plus a vertex ambient occlusion term
10      uint16 x2   uv in units of 1/32 m
14      uint8       material id
15      uint8       facade palette index in the low six bits, variation above
16      uint8       storeys
17      uint8       facade flags
18      uint16      building height in 1/16 m
```

The collision blob per tile is a list of 2D segments with a vertical span, plus a
33 by 33 ground height field. The character controller only ever tests a capsule
against 2D segments, which is why it is both cheap and impossible to tunnel
through at a run.

Full architecture notes, including every deviation from the original brief and
why, are in [docs/PLAN.md](docs/PLAN.md).

## Performance

Measured numbers, not estimates. See `docs/screenshots/index.json` for the raw
capture, which the verification run writes.

### The build

```
parsed 1.53 MB of OSM: nodes 11203  ways 1877  relations 5
features: buildings 1792  roads 65  areas 1  water 2  green 7  rails 2, trees 3627
ground:   30,188 base cells drawn, 10,733 skipped as already covered
geometry: 270,403 vertices, 134,373 triangles, 1792 buildings, 2711 stelae,
          3609 trees, 43.2 km of road
tiles     646, of 34 by 19, 614 of them non empty
world.bin 9.15 MB
world.json 0.14 MB
dist      9.45 MB, 2.30 MB over the wire with gzip, against a 25 MB budget
max tile  589.6 kB, 12,139 triangles (the stelae field)
mean tile 12.3 kB
build     about one second
```

### Frame rate

The only machine available to build this had no GPU at all, so the numbers below
come from Chromium running the ANGLE SwiftShader software rasteriser, which is
roughly two orders of magnitude slower than any real graphics chip. They are
reported because they are what was actually measured, and because they set a
floor: everything below is what a pure software rasteriser managed.

| Viewpoint | triangles in view | draw calls |
|---|---|---|
| Pariser Platz | 30,536 | 120 |
| Through the Gate | 64,364 | 161 |
| Unter den Linden | 21,348 | 77 |
| Inside the stelae field | 39,319 | 45 |
| Under the Fernsehturm | 7,700 | 44 |
| Gendarmenmarkt | 16,748 | 51 |

Software rasteriser, 1600 by 900: 3 to 5 fps.

**No measurement on real hardware, and none on a phone.** The build environment
has no GPU and no device to test on, so the 60 fps on integrated graphics and
30 fps on a mid range phone that the brief asks for are unverified. What the
project does instead is make the budget explicit and keep the geometry inside it:
under 65,000 triangles and under 170 draw calls in view at any time, one draw
call per tile, no per object uniform updates beyond a tile origin, two shadow
cascades rather than four, and an automatic quality tier chosen from the measured
median frame time over the first three seconds. Anyone with a GPU can run
`npm run verify` and replace this section with real numbers.

Three things in here were found by measuring rather than by looking, and they are
worth naming because each of them was invisible until something was checked:

- Every wall was wound against its own normals, so with back face culling on the
  entire city would have been inside out. The unit test that checks a building is
  watertight caught it before a single pixel had been drawn.
- The view distance was a vertex attribute. On a square the size of Pariser Platz
  the corners are a hundred metres away, so the ground under your feet reported
  itself as ninety metres distant, which silently picked the wrong shadow cascade
  and switched off every surface texture. It is now computed per fragment.
- Procedural detail with no mip chain aliases into moire the moment a pixel
  covers more than half a feature. Every ground pattern now widens its own edges
  to the measured pixel footprint instead of being faded out by distance
  thresholds picked by eye, which were wrong at every grazing angle.

## Screenshots

![Pariser Platz](docs/screenshots/01-pariser-platz.png)
*The spawn, on Pariser Platz looking west at the Gate.*

![The stelae field](docs/screenshots/04-memorial.png)
*Inside the field of 2711 stelae, on the undulating floor.*

![The Fernsehturm](docs/screenshots/08-tower-over-the-roofs.png)
*The Fernsehturm over the roofs, with the Cathedral dome on the left.*

![Unter den Linden at night](docs/screenshots/09-night.png)
*Unter den Linden after dark, with the windows lit.*

The rest are in [docs/screenshots](docs/screenshots), and
[docs/media/gate-to-tower.webm](docs/media/gate-to-tower.webm) is the eleven
second walk from the Gate down Unter den Linden to the foot of the Fernsehturm.
`npm run clip` records it, straight from the page.

## Attribution and licence

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
available under the [Open Database Licence](https://opendatacommons.org/licenses/odbl/).
The attribution is shown in the page footer at all times and is burnt into every
PNG that photo mode saves, because screenshots travel further than the page does.

Any derived database produced from this data must be released under the ODbL. The
geometry in `public/world.bin` is a produced work in ODbL terms: it is generated
from OSM data and is distributed with the attribution above.

The code in this repository is offered under the MIT licence.

## Deploying

`.github/workflows/pages.yml` runs the unit tests, fetches the OSM extract,
builds the world bundle and `dist/`, and publishes it to GitHub Pages. Two things
have to be true for it to reach a public URL:

1. **Pages has to be switched on for the repository**, under Settings, Pages,
   with the source set to GitHub Actions. That is a repository setting and cannot
   be done from a commit.
2. **The workflow has to run on a branch the `github-pages` environment allows.**
   It is wired to `main`, `master` and `claude/**`, so merging to the default
   branch will deploy.

The runners can reach the Overpass API, so the deployed build uses a live
OpenStreetMap extract rather than the offline fallback described above. The
`Record which source was used` step in the workflow prints which one it was.

To host it anywhere else: run `npm run build` and copy `dist/`. There is no
backend, no environment variable, and no build step at the far end.
