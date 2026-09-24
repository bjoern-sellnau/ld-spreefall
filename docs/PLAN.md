# SPREE|FALL, architecture and plan

A walkable first person reconstruction of central Berlin that runs from a single
static link. Raw WebGL2, own physics, own audio, own data pipeline. No engine, no
3D library, no runtime dependency.

## 1. Coordinate system

Bounding box, WGS84: south 52.5080, west 13.3650, north 52.5250, east 13.4150.
Projection origin: 52.5163 N, 13.3777 E (Brandenburg Gate).

We use a local equirectangular metric plane, which over a 2.7 km by 1.9 km box is
accurate to a few centimetres, far below what a walker can perceive:

    x = (lon - lon0) * 111320 * cos(lat0)      east, metres
    z = -(lat - lat0) * 110574                 south, metres, so +z is south
    y = up, metres

One unit is one metre. The world is right handed with y up. The playable plane is
about 3386 m east to west and 1880 m north to south.

Spawn: Pariser Platz, 52.51625 N, 13.37940 E, eye height 1.7 m, facing west
towards the Gate.

## 2. Data pipeline, tools/

Stages, each one a separate module so it can be tested on its own:

1. `fetch-osm.mjs` queries the Overpass API for the bounding box and caches the
   raw XML in `data/raw/berlin-center.osm`. Retries with exponential backoff and
   jitter on 429 and 504. If every mirror is unreachable it falls back to
   `synth-osm.mjs`.
2. `synth-osm.mjs` writes an OSM XML file in exactly the same schema from a
   curated table of real Berlin coordinates (street centrelines, landmark
   footprints, the Spree, parks) plus procedurally placed perimeter blocks. This
   exists so the project builds and is playable in a sandbox with no network. It
   is a fallback, never a preference: if `data/raw/berlin-center.osm` came from
   Overpass, that file is used untouched.
3. `osm-xml.mjs` is our own parser. A single pass tokeniser over the XML text
   producing `{nodes, ways, relations}` with tag maps. No XML library.
4. `annotate.mjs` attaches the surveyed facts in `berlin-facts.mjs` to the
   parsed document: the eleven landmark cards, the size and count of the stelae,
   and the bespoke shape of each landmark. Real OSM has never heard of our
   `spreefall:*` tags, so without this pass a build from the live extract has no
   memorial, no landmark cards and no weapons free zone, while a build from the
   fallback has all three. It prefers the real feature every time, by distance,
   area and name, and only invents a footprint where the data has nothing. It is
   idempotent, so on the fallback it is a no op.
5. `earcut.mjs` is our own ear clipping triangulator with hole support. The hole
   elimination step follows the bridge method described by Eberly, "Triangulation
   by Ear Clipping" (2002), section 3: find the hole vertex with maximum x, cast
   a ray to the right, split the outer ring with a two sided bridge.
6. `build-world.mjs` turns the parsed OSM into geometry:
   buildings (walls, flat, gabled, hipped and domed roofs), roads (ribbon meshes
   with joins), pedestrian areas, water, parks and grass, trees, rails and trams,
   the procedural stelae field, and the landmark specials.
7. Tiling: the world is cut into 100 m by 100 m tiles. Every triangle is assigned
   to the tile containing its centroid. Per tile we write an interleaved vertex
   buffer, an index buffer, and a collision blob.
8. `bundle.mjs` writes `public/world.bin` plus `public/world.json`.

### 2.1 Vertex format, 20 bytes, interleaved

    offset  type        name
    0       int16 x3    position, tile local, quantised at 1/64 m
    6       int8  x3    normal, signed normalised
    9       int8        material id low byte is also carried in the byte at 14,
                        this slot holds the vertex ambient occlusion term
    10      uint16 x2   uv in units of 1/32 m, so up to 2048 m of run
    14      uint8       material id
    15      uint8       per building random seed
    16      uint8       building levels, 0 when not a building
    17      uint8       facade flags: bit 0 ground floor, bit 1 landmark
    18      uint16      building height in 1/16 m, for the facade shader

Indices are uint16 when the tile has fewer than 65536 vertices, otherwise uint32.
The manifest records which.

### 2.2 Collision blob, per tile

    uint16 segCount
    uint16 gridN            always 33, a 33 by 33 height field over the tile
    segCount x {
      int16 x1, z1, x2, z2  tile local, 1/64 m
      uint16 base           1/32 m
      uint16 top            1/32 m
      uint8  surface        0 asphalt 1 cobble 2 grass 3 water 4 gravel
      uint8  pad
    }
    gridN*gridN x int16     ground height, 1/256 m, plus a per tile base

Segments are the outward oriented footprint edges of every solid, so the
character controller only ever has to test 2D segments plus a vertical span.

### 2.3 Manifest, world.json

    {
      version, origin{lat,lon}, bbox, tileSize, tileCountX, tileCountZ,
      groundBase, materials[], landmarks[], roadLines[] (for the minimap),
      tiles[ { tx, tz, min[3], max[3], vOff, vCount, iOff, iCount, iType,
               cOff, cLen, tris } ]
    }

## 3. Engine, src/engine/

- `math.mjs`: vec2, vec3, vec4, mat4, quat over Float32Array with a scratch pool,
  so the hot path never allocates. Frustum extraction, ray versus AABB, ray versus
  triangle.
- `gl.mjs`: context creation, shader compile with the offending source line
  printed, program cache, VAO helper, uniform buffer objects for the shared camera
  and lighting block.
- `renderer.mjs`: render queue sorted by program then material, per frame stats.
- `tiles.mjs`: streams tile ranges out of `world.bin` with HTTP range requests
  when available and one full fetch otherwise, uploads on demand, keeps a budget
  around the player, frustum culls per tile.
- `input.mjs`: pointer lock mouse look, touch look plus virtual stick, keyboard,
  Gamepad API.
- `controller.mjs`: capsule radius 0.35 m, height 1.8 m. Swept in up to four
  substeps, slides along contact normals, steps up to 0.4 m, gravity 22 m/s^2,
  jump 5.2 m/s. The river is a solid wall to the player.
- `loop.mjs`: fixed 60 Hz simulation with an accumulator and interpolated render
  state.

## 4. Render, src/render/

Sun position from the standard NOAA solar position equations for the given date,
time and latitude. Sky is an analytic Rayleigh plus Mie gradient with a sun disc,
rendered as a full screen triangle at maximum depth. Two cascade shadow maps at
2048 and 1024 for the near and far ranges. Facades are generated in the fragment
shader from the per building seed: window grid derived from the level count,
shopfront band on the ground floor, plaster colour from `building:colour` or from
a Berlin palette, emissive windows at night with a per window random on state.
Roads draw lane markings and kerbs from the uv run, cobblestone uses a Worley like
cell noise, water uses two scrolling normal waves and a sky reflection
approximation. Trees are instanced billboards with a real trunk quad cross.
Post: tone map (ACES fit), threshold plus blur bloom, FXAA, vignette. A quality
tier is chosen from the mean frame time over the first three seconds.

## 5. Game, src/game/

Intro drone shot over Pariser Platz on a spline, then a Press to walk prompt.
Landmark discovery inside 40 m with a sliding card. Minimap on a 2D canvas from
`roadLines`. Photo mode on P. URL state in the hash: `#x,z,yaw,pitch,tod`.
Audio graph built on the first gesture: ambience beds crossfaded by proximity to
roads, water, park and stations, plus footsteps whose sample is picked from the
surface id under the player.

## 5.1 The shooter, src/game/

SPREE|FALL is an open world shooter, so the city is the level and there are no
arenas, no waves and no scripted encounters. What follows is the whole loop.

**Targets are drones, not people.** This is a reconstruction of a real place,
with the Reichstag, the Cathedral and the Memorial to the Murdered Jews of
Europe standing where they really stand. Putting human targets in it would be
grotesque, and it would be a worse demo besides: quadrotors fly, which exercises
real three dimensional tracking, flight AI and line of sight through actual
buildings rather than a corridor. The pool is 48, of which the threat tier keeps
between six and fourteen in the air; a hull is 0.85 m across with a 0.34 m core
that is worth 2.2 times the damage.

**The memorial is a weapons free zone.** Inside 135 m of Peter Eisenman's field
the weapon holsters itself, it will not fire, and the reason is written on the
screen. No drone spawns in the circle, any drone that drifts into it turns and
accelerates back out, and while you stand there none of them can see you, so
nothing follows you in. The rule lives in `combat.js` rather than in the
interface, and `tools/test-combat.mjs` checks each part of it in a browser.

- `world.js` `raycast(ox,oy,oz, dx,dy,dz, maxDist)`: a 2D DDA over the 100 m tile
  grid, testing the collision segments of each tile as vertical quads, then
  marching the ground height field with an eight step bisection. Measured at
  4.3 microseconds a ray, which is what makes hitscan and per drone line of sight
  affordable at 60 Hz. `lineOfSight(a, b)` is the same call with no hit.
- `drones.js`: a fixed pool with states patrol, pursue, attack, evade and dying.
  Steering is boids like, with four horizontal probes and a ground clearance term
  keeping them out of walls and off the pavement. Line of sight is re-tested on a
  staggered 0.22 s rota, so the cost is spread across frames rather than spiking
  with the size of the flock.
- `arsenal.js`: the table of what you can carry, six rows of numbers. An M16, a
  shotgun that throws eleven pellets, a rocket launcher, grenades, C4 and a
  banana. Every difference the game cares about between a rifle and a shotgun is
  a number in that table.
- `weapon.js`: the one piece of code that fires all of them. A traced shot
  raycasts the world first and only then the drones and soldiers within that
  distance, so cover is real: the Gate stops the bullet. Recoil is an offset
  rather than an increment, which is the bug this replaced: the first version
  added the kick into the camera pitch every frame and sprang its own variable
  back to zero, so the view climbed and stayed climbed. Now the view carries the
  offset while it lasts and gets it back as it decays, minus the small share
  each weapon keeps, which is what makes a burst walk.
- `projectiles.js`: everything that leaves your hand under its own steam. They
  integrate, and they collide against the same raycast the bullets use, so a
  grenade bounces off a real wall and rolls down a real kerb. Rockets go off on
  contact, grenades on a fuse, C4 when you press the trigger, and the banana
  never: it lies there until somebody walks onto it.
- `reflex.js`: super reflexes. Only the simulation is scaled: looking around,
  the weapon and the interface stay on the real clock, so the city crawls and
  your aim does not, which is the whole fantasy. Scaling everything would just
  be a slower game. The high jump comes out of the same meter, because both are
  the same idea: for a few seconds you are quicker than the city is.
- `jets.js`: fighter jets, which neither hover nor stop. One state machine over
  a curve: bank towards a heading, hold a height above whatever ground is under
  you, and never turn faster than the turn rate allows. Inbound, attack, break,
  orbit, and round again. You cannot chase it; you can only be ready for the
  next pass.
- `soldiers.js`: the enemy that walks. Patrol, advance, fight, slipped and
  dying. They test line of sight from their eyes to yours on the same staggered
  rota as the drones, strafe rather than stand still, fire in bursts with an
  accuracy that falls off with distance, and stay out of the weapons free zone.
  Hostile militia in a scenario: no insignia, no nation, no faces.
- `combat.js`: integrity with delayed regeneration, score, a threat tier that
  raises the drone budget as you hold ground, and the sanctuary list.
- `effects.js`: a pool of 256 sparks for tracers, impacts and the explosion, plus
  the shake, which is applied to the eye and never to the aim. The muzzle flash
  is not in the pool: it is a cone on the weapon mesh that the shader retracts
  towards the barrel as the flash decays.

Rendering: drones are one instanced draw with generated geometry and their own
shadow pass. The weapon viewmodel is drawn last, in its own 55 degree projection
against a cleared depth buffer, so it can never poke through a wall. Hip fire
holds it low and right; aiming brings the front post onto the centre line.
Sound is synthesised like everything else: a noise burst through a swept bandpass
for the shot, one rotor bed whose level and pitch track the nearest drone rather
than one voice per drone, and two different hit confirms for hull and core.

## 6. Milestones

1. Pipeline prints stats and the unit test on the L shaped courtyard passes.
2. A grey box city renders at 60 fps and the player cannot walk through a wall.
3. It looks like Berlin at golden hour from Pariser Platz.
4. The game layer is complete and a screenshot is worth sharing.
5. `dist/` deploys to GitHub Pages with no console errors.
6. The shooter: a drone dies to a burst in a real browser, the Gate stops a shot
   fired at one behind it, and the memorial stays a weapons free zone.
7. The deployed city is the same city: the surveyed facts reach a build from the
   live extract, and a browser in CI renders it, fights in it and drives its
   interface, because nothing here can open the deployed page.
8. The arsenal: six things to carry, recoil that comes back, explosives that
   bounce off real walls, and soldiers in the streets who slip on a banana.
9. Survivable: a shield that comes back, three difficulties, reflexes that slow
   the city down, four more weapons, jets overhead, and a scene target that
   shrinks to hold the frame rate.

## 7. Deviations from the original brief

Recorded here as they happen, per the working style.

- 2026-09-08: the sandbox running this build has an egress policy that denies
  every OpenStreetMap host (`overpass-api.de`, all Overpass mirrors,
  `download.geofabrik.de`, `nominatim`, the tile servers) with a 403 at the proxy.
  The Overpass client in `tools/fetch-osm.mjs` is complete and is what runs when a
  network is available. Because the build has to produce something playable, the
  fallback in `tools/synth-osm.mjs` emits an OSM XML document from real, checked
  Berlin coordinates for every street centreline, landmark footprint, park and
  waterway in the box, and fills the remaining blocks with generated perimeter
  buildings. Everything downstream of the parser is identical either way. The
  README states plainly which parts are surveyed geometry and which are
  generated.

- 2026-09-08: the brief gives the east edge as 13.4050 and in the same paragraph
  says the box covers Alexanderplatz and the TV Tower, and phases 3, 4 and 5 all
  depend on the tower. The tower stands at 13.40942 and Alexanderplatz at
  13.4131, both east of 13.4050. The landmark list wins over the number, so the
  east edge is 13.4150 and the playable plane is 3386 m by 1880 m.
- 2026-09-08: the Victory Column is at 13.3501, west of the box on any reading,
  so it is left out, as the brief allows.
- 2026-09-09: three defects found by measurement rather than by looking, all
  recorded here because each was invisible in the code:
  1. Every wall and every solid was wound against the normals it declared, so
     with back face culling the whole city would have rendered inside out. Found
     by the watertight test on the L shaped courtyard fixture, before the
     renderer existed. There is now a test that checks the winding of every
     generator against its own normals.
  2. The view distance was a vertex attribute, so on a triangle the size of
     Pariser Platz the ground under the player reported ninety metres. That
     picked the wrong shadow cascade and switched off every ground texture. It
     is now computed per fragment from the interpolated world position.
  3. Procedural patterns with no mip chain alias into moire. Distance thresholds
     do not fix this, because the pixel footprint at a grazing angle has nothing
     to do with distance. Every ground pattern now widens its own edges to the
     measured screen space footprint, which is what a mip chain would have done.
- 2026-09-09: the base ground grid is not drawn where a road, square, park, water
  body, building or the memorial already covers it, which removes about a quarter
  of the cells. It is also drawn ninety millimetres low, because the grid
  interpolates the terrain linearly over 12.5 m and a base plane at the true
  height pokes through everything laid on top of it.
- 2026-09-09: at street level in a city this dense, the Fernsehturm is not
  visible from Pariser Platz: it subtends ten degrees at two kilometres, and any
  twenty metre building within a hundred and ten metres of the sightline hides
  it. The fog is tuned as the brief asks, and the shot that shows it is taken
  from Schlossplatz, where the sightline is real.

- 2026-09-23: the brief calls for an open world shooter and this is a
  reconstruction of real streets, so two content decisions are recorded rather
  than left implicit. The targets are drones, because human targets at the
  Reichstag or on Pariser Platz would be indefensible and because flying targets
  are the harder and more interesting engineering. And the Memorial to the
  Murdered Jews of Europe is a weapons free zone: the weapon holsters itself
  inside it and the drones will not enter. Both are enforced in the game layer
  and covered by `tools/test-combat.mjs`.

- 2026-09-23: the deployed city and the city built here are not the same. The
  sandbox cannot reach OpenStreetMap, so it builds from the fallback; the
  GitHub Actions deploy fetches the live extract. Until the build log was read,
  that difference silently cost the deployed site every piece of curated
  content, because it all hung off tags that only the fallback writes. The
  deploy reported `0 stelae` and nobody had looked. `tools/annotate.mjs` now
  attaches the surveyed facts to either source, and a second workflow renders
  the live city in a browser and fights drones in it, because the log of that
  run is the only way anyone here can see it.

- 2026-09-24: the targets are drones and soldiers. The drones came first and the
  reasoning for them stands, but an open world shooter with nothing on the
  ground is a demo of flight AI, not a game, and the ask was for soldiers. They
  are hostile militia in a scenario: no insignia, no nation, no faces, and they
  keep out of the memorial like everything else that carries a weapon here. The
  one line that does not move is the weapons free zone.
