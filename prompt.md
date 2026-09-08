# Berlin, a walkable 3D city in the browser, built from scratch and a first person shooter with open world called "SPREE|FALL"

## Mission

Build a playable, first person, walkable 3D reconstruction of central Berlin that runs in a browser from a single link. The player spawns on Pariser Platz in front of the Brandenburg Gate and can walk east along Unter den Linden to Museum Island, south to Potsdamer Platz and the Holocaust Memorial, and north to the Reichstag and the Spree. Every building, road, path, tree, river and rail line comes from real OpenStreetMap data. The whole engine is written by you, from the ground up. This is a demonstration project, so the constraint is the point: no game engine and no 3D library of any kind.

## Hard constraints, non negotiable

1. Rendering is raw WebGL2. No Three.js, no Babylon, no PlayCanvas, no regl, no twgl, no any wrapper. You write the shaders, the buffer management, the camera, the matrix math and the scene graph yourself. If WebGPU is available you may add a WebGPU backend behind the same renderer interface, but WebGL2 is the required baseline and must work on a mid range Android phone.
2. Physics is yours: a character controller with capsule versus building collision, gravity, stairs and curbs stepping, and no walking through walls. No cannon.js, no ammo, no rapier.
3. Audio is yours on top of the raw Web Audio API: positional ambient sound (traffic near roads, water near the Spree, birds in Tiergarten, a faint U-Bahn rumble near stations), footsteps that change on cobblestone versus asphalt versus grass.
4. The map data is real. Download the OSM extract for the bounding box below, parse it yourself (osm PBF or XML, your choice, but write the parser), and generate the geometry from it. No pre made 3D city models, no Google 3D tiles, no Cesium.
5. Everything ships as static files. One index.html, JS modules, one binary asset bundle. No backend at runtime. It must be deployable to GitHub Pages or Cloudflare Pages by copying a folder.
6. Total download under 25 MB for the whole playable area, and it must reach 60 fps on a laptop with integrated graphics and 30 fps on a 2021 mid range Android phone.
7. No external runtime dependencies at all. Build time tooling (a bundler, a Python or Node preprocessing script, TypeScript) is fine. The shipped page loads nothing from a CDN.
8. Never write an em dash or an en dash anywhere, in code, comments, docs or UI text.

## Geography

Bounding box for the playable area, WGS84: south 52.5080, west 13.3650, north 52.5250, east 13.4050. That covers Brandenburg Gate, Pariser Platz, Unter den Linden, Reichstag, the Holocaust Memorial, Potsdamer Platz on the south west edge, Gendarmenmarkt, Bebelplatz, the Berlin Cathedral, Museum Island and the Lustgarten, and Alexanderplatz with the TV Tower on the east edge. Convert coordinates to a local metric plane using a transverse Mercator or simple equirectangular projection centred at 52.5163, 13.3777 (the Gate). One unit equals one metre.

Spawn point: Pariser Platz, facing west towards the Gate, eye height 1.7 m.

## What to build, in order, each step committed and verified before the next

### Phase 1: Data pipeline (offline, Node or Python script in tools/)

- Fetch the OSM data for the bounding box via the Overpass API and cache the raw response in data/raw/. Print the counts of nodes, ways and relations.
- Parse buildings: ways and multipolygon relations with the building tag. Read height, building:levels, roof:shape, roof:height, min_height, building:colour, building:material. Default missing heights to levels times 3.2 m, and missing levels to a value derived from the building type (church 20 m, apartments 5 levels, and so on). Handle multipolygons with holes correctly (inner rings become holes).
- Parse the road network with highway tags, and store width per class (primary 14 m, secondary 10 m, residential 7 m, footway 2.5 m, cycleway 2 m, pedestrian areas as polygons). Parse surface tags so cobblestone versus asphalt survives into the game.
- Parse water (the Spree and the Spreekanal as natural=water and waterway=riverbank polygons), parks and grass (leisure=park, landuse=grass), trees (natural=tree nodes, plus the tree rows along Unter den Linden), railways and tram lines, and the following landmark tags so they get special treatment: the Gate, the Reichstag, the Cathedral, the TV Tower, the Victory Column if inside the box, and the Holocaust Memorial stelae field.
- Triangulate every polygon with your own ear clipping implementation that supports holes (or port a known algorithm and cite it in a comment). Extrude buildings into walls and flat roofs. Implement gabled and hipped roofs for roof:shape when present, and a cheap domed roof for the Cathedral.
- Generate the Holocaust Memorial procedurally: the real field is a grid of 2711 concrete stelae with varying heights on an undulating ground. Use the OSM outline and generate the grid inside it with heights sampled from a smooth noise function, so the player can walk between the stelae.
- Split the world into 100 m by 100 m tiles. For each tile write interleaved vertex buffers (position, normal, uv, a material id, a per building random seed for facade variation) and an index buffer, quantised to 16 bit where possible. Write a single binary bundle with a small JSON manifest listing tile offsets, bounding boxes and triangle counts. Print total bundle size and per tile stats.
- Write a collision layer per tile: the 2D building footprints as convex decompositions or as edge lists, plus a height field for the ground so curbs, the memorial ground and the river bank have real elevation.
- Unit test the pipeline: a fixture with one L shaped building with a courtyard hole must produce a watertight mesh with the correct triangle count and outward facing normals.

### Phase 2: Engine core (src/engine/)

- Math: vec2, vec3, vec4, mat4, quaternion, with no allocation in the hot path (typed array pools). Perspective projection, look at, frustum extraction, ray versus AABB and ray versus triangle.
- Renderer: WebGL2 context setup, shader compile helper with clear error reporting including the line of the failing shader, VAO and buffer helpers, a uniform block for camera and lighting shared across all programs, a render queue sorted by program then material.
- Scene: a tile manager that streams tiles from the bundle, uploads them to the GPU on demand, keeps a budget of tiles in memory around the player, and frustum culls per tile per frame. Show a debug overlay with fps, frame ms, draw calls, triangles, loaded tiles.
- Camera and controls: first person, mouse look with pointer lock on desktop, touch look plus a virtual joystick on mobile, WASD and arrow keys, shift to run, space to jump onto curbs and low walls. Gamepad support via the Gamepad API is a bonus.
- Character controller: capsule of radius 0.35 m and height 1.8 m, swept against the collision layer, sliding along walls, step up to 0.4 m, gravity, no tunnelling at run speed. Player cannot enter the river.
- Time: a fixed timestep simulation at 60 Hz with interpolated rendering, decoupled from the display refresh rate.

### Phase 3: Looking like Berlin (src/render/)

- Lighting: directional sun with a real position computed from date, time and latitude, so the light matches the actual sun over Berlin. Physically plausible sky gradient with a sun disc, Rayleigh tinted horizon, and a simple day and night cycle the player can scrub. Cascaded shadow maps (two cascades are enough) so buildings cast shadows on streets. Ambient from the sky colour.
- Facades: no textures downloaded from anywhere. Generate facades procedurally in the fragment shader from the per building seed: window grids that respect the building height and levels, ground floor shops with a different pattern, plaster colour from building:colour when present and otherwise from a Berlin palette (ochre, cream, grey, sandstone, red brick for older buildings). Windows emit light at night. Landmarks get bespoke shaders: the Gate and the Reichstag in sandstone with column geometry generated from their footprints, the Cathedral in green copper on the dome, the TV Tower as a proper concrete shaft plus a sphere plus an antenna, the memorial stelae in dark grey concrete.
- Ground: roads with lane markings generated in shader, cobblestone on surfaces tagged as such, grass with a cheap noise texture, water with animated normals and a reflection approximation of the sky. Tree rows on Unter den Linden as instanced billboards that face the camera, with a proper trunk.
- Post processing: tone mapping, a light bloom for night lights, FXAA or MSAA, a subtle vignette. Keep it toggleable for weak devices with an automatic quality tier chosen from measured frame time in the first three seconds.
- Fog and distance: atmospheric fog tuned so the TV Tower is visible from the Gate, which is the shot people will screenshot.

### Phase 4: The game part (src/game/)

- An intro: the page opens with a title over a slow drone shot from above Pariser Platz, then a Press to walk prompt. Include a landmark discovery system: when the player gets within 40 m of a landmark, a small card slides in with its name and one sentence of history. Landmarks to include: Brandenburg Gate, Reichstag, Holocaust Memorial, Unter den Linden, Bebelplatz, Gendarmenmarkt, Berlin Cathedral, Museum Island, TV Tower, Potsdamer Platz, and the Spree. Finding all of them shows a completion screen with time taken and distance walked.
- A minimap in the corner drawn from the same OSM road data on a 2D canvas, with a north arrow and the player as a dot.
- A photo mode: press P to hide the UI, freeze time, adjust the time of day with a slider, and download a PNG. This is the feature that makes people share screenshots.
- A shareable URL that encodes position, heading and time of day, so a link opens exactly at the same view.
- Sound as specified in the constraints, with a mute button and no autoplay before the first user gesture.

### Phase 5: Ship

- Build script that produces a dist/ folder with everything. A README that explains the project in plain language, what is real and what is generated, and gives credit to OpenStreetMap contributors under ODbL as required by the licence, including a visible attribution in the page footer.
- A performance page in the README with measured numbers: bundle size, tile count, triangle count, fps on your machine with the GPU named, and fps on at least one phone if you can test one.
- A 10 second GIF or WebM of the walk from the Gate to the TV Tower in the fog, for the post.
- Deploy to GitHub Pages and confirm the public URL loads in a clean browser profile with no console errors.

## Working style

- Start by writing docs/PLAN.md with the architecture, the data formats and the milestones, then follow it. Update it when you deviate.
- Commit after each phase with a one line commit message, no attribution trailers of any kind.
- Verify with real runs, not assumptions: run the pipeline and print stats, open the page under a headless browser or a local server and capture the console, take screenshots at fixed positions after each visual phase and keep them in docs/screenshots/ so progress is visible.
- When a building looks wrong in the screenshot, fix the data pipeline rather than hiding it. Broken geometry that is visible from the spawn point is a blocker.
- If the Overpass API rate limits you, wait and retry with backoff, or download the Berlin extract from Geofabrik and clip it locally.
- Ask nothing. Make sensible decisions, write them down in the plan, and keep going until Phase 5 is done and the URL is live.
