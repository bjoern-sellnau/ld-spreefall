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

- 2026-09-24: buildings are marked by explosions rather than destroyed. The
  geometry is quantised into per tile vertex buffers at build time and the
  collision is a list of segments beside it, so a wall that actually fell would
  mean rebuilding and reuploading a tile and its collision blob in the middle of
  a frame. What the game does instead is carry the sixteen most recent blasts in
  the world shader and scorch, roughen and blow the windows out of whatever is
  inside their radius, with debris knocked off the real surfaces nearby. It is
  the honest version of what this engine can do at sixty frames a second, and
  the README says so plainly rather than calling it destruction.

- 2026-09-24: the ratio of what comes at you was measured rather than guessed.
  A probe stepped the spawners for ninety seconds at four places in the city
  and reported five drones to three soldiers at the opening tier, which is the
  opposite of what an open world shooter on the ground should feel like.
  Drones now start at a budget of two and grow slowly; soldiers start at seven,
  reach eighteen, and arrive in squads of one to three within 45 to 115 m. The
  same probe now reports two drones to seven soldiers at tier zero and five to
  thirteen at tier three.

- 2026-09-24: the pickups are placed by asking the world, not by hand. A list
  of coordinates would be wrong the first time the OSM extract changed, and
  this project rebuilds its city from live data on a schedule. So a pad is a
  point that survives four questions: inside the world, out of the memorial,
  nothing within 2.2 m in any of six directions at standing height, and 45 m
  from every other pad. What that buys is that the same code lays out a usable
  map whether the build came from the live extract or the fallback.

  One thing it cost a debugging session to learn: the plate a pickup stands on
  was invisible, because `groundHeight` is the collision height field and the
  street that is actually drawn sits above it. Pavements are laid 0.12 m proud,
  plazas 0.05, grass 0.05. A plate two centimetres above the height field is a
  plate under the pavement. They now stand fourteen centimetres clear of it.

  The second thing: five emissive colours all came out white. An emissive that
  is bright in all three channels is white after the tone map whatever colour
  it started as, so the five tints are near zero in two channels each.

- 2026-10-11: a cheat menu, including the gore switches, with two lines held.
  The first is the memorial. A warhead with a blast radius of a hundred and
  seventy metres cannot be aimed at the Memorial to the Murdered Jews of
  Europe, nor within a hundred and seventy metres of its edge, and the target
  map draws both circles so that the refusal is something you can see before
  you click rather than a message afterwards. Every other cheat in the menu is
  off limits there too, because they all run through systems that already
  check the zone. The second line is that the run is marked: `cheated` sits
  with the threat readout from the moment anything is switched on and does not
  go away when it is switched off again, and the end screen leads with it.
  Neither of these is a setting.

  The gore is all off by default and stays off unless somebody goes and turns
  it on, so the game anyone arrives at has no blood in it. Ultra gore is a
  multiplier over the other three rather than a fourth effect.

- 2026-10-11: three things the warhead cost, all of them worth writing down.

  A blast at ground level has line of sight to nothing. `explode` tests every
  target against `world.lineOfSight` from the detonation point, and for a
  grenade resting on the cobbles that is fine because its radius is eight
  metres and the ray barely leaves the ground. At a hundred and seventy metres
  every ray scrapes the street it started on and the nuke killed nobody at
  all. The fix is the physical one: the damage radiates from the fireball,
  fifty five metres up, and the mark stays on the ground where the crater is.

  A full screen whiteout must not use the per frame cap. The muzzle flash
  decays by `min(elapsed, 1/45)` so that a long frame cannot swallow it whole,
  which is right for something that has to be seen at all. Copying that onto
  the detonation flash meant a machine running at four frames a second sat in
  a white screen for fifteen seconds, because the cap limited the decay rather
  than the flash. It decays on the real clock.

  Additive billboards cannot draw dark smoke. The first mushroom cloud was
  grey, and grey added to a bright sky is nothing: the blend is `ONE, ONE`, so
  what reads is a warm colour going dark, not a dark colour going transparent.
  The stem now runs hot at the bottom and cools going up, and the cap is lit
  rather than shadowed, which is also what one looks like.

- 2026-10-11: the gibs ask the world less often than anything else here does.
  A projectile raycasts every frame it is in the air; a chunk of somebody
  raycasts only while it is moving faster than six metres a second, and lives
  on the ground height field after that. Forty chunks at one ray each per
  frame is about half a millisecond, and the visible difference is that a
  chunk already at rest will not be stopped by a wall it is sliding into. That
  is a trade rather than an oversight, and this is where it is recorded.

- 2026-10-11: buildings come down now, and the 2026-09-24 entry above stands
  as written. Nothing about the constraint changed: the geometry is still
  baked into per tile vertex buffers and nothing here rebuilds a tile in the
  middle of a frame. What changed is the approach. Instead of moving geometry,
  the world vertex shader bends the city around a short list of collapse
  sites, and the collision is edited in place to match. A site pulls
  everything above the street down towards it and pushes it outward; the
  shadow pass runs the same displacement; the collision segments inside it
  drop to the height of the heap.

  Three things make this honest rather than a trick. The collision opens up at
  45 per cent of the fall rather than at the end, so a wall you can see has
  gone is a wall you can walk through. The crater is dug into the real height
  field with exactly the profile the shader draws, and the test samples five
  radii and compares the two numbers rather than looking at a screenshot. And
  the fall is graded: the middle of a site is flat and the rim keeps most of
  its height, in the collision as well as in the picture.

  The limit is sixteen sites, and the interesting decision is what happens at
  the seventeenth. A ring buffer would be the obvious answer and it is the
  wrong one: evicting a site stands a flattened building back up in front of
  somebody who watched it fall. So a new collapse that overlaps an old one
  grows it, and when all sixteen are taken the nearest one swallows the new
  one. The city gets coarser as you destroy more of it, which is the right
  direction for the error to go in.

- 2026-10-11: the ground cannot crater under a small blast, and the reason is
  worth writing down rather than quietly capping it. The ground is drawn as a
  12.5 m grid of quads with roads and plazas laid over it as triangulated
  rings, so a crater eight metres across has no vertices inside it to move.
  Displacing the collision height field anyway would give an invisible hole in
  the street. So only blasts over 55 m crater at all, and a rocket scorches
  the road and leaves it flat. The alternative, subdividing the ground at
  build time, would roughly double the world's triangle count for an effect
  that almost never fires.

- 2026-10-11: blood needed its own blend, not a brighter colour. Every
  particle in this project was drawn additively, which is right for fire and
  tracers and hopeless for blood: a dark red added to a grey street comes out
  brighter than the street, so the first version read as glowing embers. It is
  now a second instanced draw with an ordinary alpha blend over the same
  shader. WebGL2 has no base instance, so one buffer could not have been drawn
  as two ranges in any case.

  The stains on the pavement cost the same lesson the pickup pads did: they
  were invisible until they were lifted clear of the collision height field,
  because the street that is drawn sits up to 0.12 m above it. That clearance
  is now one named constant in src/shared/constants.js rather than two magic
  numbers in two files.

- 2026-10-11: free travel flies rather than cuts. A teleport is one line and
  the deep link already allows arriving anywhere, so the argument for the
  cheap version was strong. It is still the wrong call: the only thing this
  project has that a generated city would not is a layout that matches the
  real one, and flying over it is the one moment that shows it. The move is
  three parts, timed off the wall clock like the opening shot, because a
  flight that stretches to twelve seconds on a slow machine looks broken.

- 2026-10-11: a test that passed here failed on the live city, and the cause
  was neither the city nor the change. The deep link check sets a view and
  reads it back out of the URL, and it came back pointing almost straight up.
  Playwright's clicks move the real mouse across the page, and while the
  pointer is locked every one of those is a look; the deltas sit in the input
  accumulator until a simulation step takes them. At sixty frames a second
  that is always drained before the next line runs, and at four frames a
  second, which is what the live city under SwiftShader gives, there can still
  be most of a turn waiting when the view is set, landing on top of it one
  frame later. The product is not affected: mouse movement is only
  accumulated while the pointer is locked, and the test had already released
  it. The test now drains the accumulator across three frames before setting
  the view, and waits for the heading it asked for rather than for any URL at
  all, so a write from before the view was set cannot be read as the answer.

- 2026-10-11: destruction, second pass, after it was correctly called too
  coarse. Three things were wrong and each had the same shape: the model was
  binary where the thing it describes is graded.

  A building either stood or was a heap. It now carries a level from zero to
  one and the shader cuts it back to that share of its own height, which it
  gets from the vertex attribute that was already there for the window
  pattern. A quarter gone means the top quarter is missing and the three
  storeys under it are still a facade. Five rockets take a frontage from
  standing to rubble in four visible steps.

  A crater was the size of the blast. A hundred and seventy metre warhead was
  digging a hundred and seventy metre bowl, which is not what one does: the
  crater is a fraction of the damage radius. It is now thirty six metres
  across inside a hundred and forty six metre collapse, with a ring of thrown
  up ground around the lip, and the street is flat again well inside the area
  where the buildings came down.

  And a wall either opened up or did not. Collision walls are one quad per
  building edge, and an edge can be thirty metres long, so whether a facade
  became walkable depended on which side of the blast its midpoint happened
  to fall, while the picture showed the blast cutting across the middle of
  it. The first time a collapse touches a tile, its long walls are now cut
  into five metre pieces and the cached array is replaced. It costs more
  segments in the tiles you have blown up and nothing anywhere else.

  One smaller thing worth keeping: damage was measured from the blast to the
  centre of each grid cell, which made how fast a building came down depend on
  where the invisible grid happened to be. It is measured to the cell now, so
  the cell the rocket landed in takes all of it.

- 2026-10-11: `out` is a reserved word in GLSL, and the compiler's message for
  using it as a local float is a syntax error on the line after the one you
  wrote. Worth an entry only because the whole page fails to boot and the
  console error is the one place it says why.

- 2026-10-11: the cinematic warhead camera does not cut. The temptation with
  a shot like this is to teleport the camera somewhere good and then teleport
  it back, and the reason not to is that a cut throws away the one thing
  worth showing: that the place the bomb lands is a real place a measurable
  distance from where you are standing. So it leaves the eye and arrives at
  its station in one move, and the station is beside the fall line rather
  than behind the bomb, because a camera chasing a falling object from above
  shows an empty sky.

  The slow motion is not constant either. Three seconds of fall held at a
  fifth of speed is fifteen seconds of an object getting smaller, so the shot
  runs at most of real time and eases down over the last half of the descent.
  The world comes back up to speed under the orbit rather than snapping,
  which is the same trick the other way round.

  The simulation keeps running the whole time. `fixed` refuses to step
  anything outside walking mode, which is right for the title screen and
  wrong here: the point of the shot is what happens to the city, so this mode
  steps the world and nothing else, with the controls disconnected and the
  player standing exactly where they were left.

- 2026-10-11: burning trees are a uniform array, not a list of objects. Trees
  are drawn from one instanced call per tile with five floats each and no
  mesh data at all, which is why three thousand seven hundred of them cost
  nothing; making each one burn separately would have meant a per tree state
  buffer uploaded every frame, and that throws the whole design away for an
  effect that only ever touches a few dozen of them at once.

  So a fire is a circle with an age, eight of them, and every tree inside one
  derives its own timeline from its own seed. The cost is that the two sides
  have to agree: the shader decides when a tree bursts, and JavaScript has to
  decide the same thing at the same moment so the flash goes off on the tree
  that burst. Both run the same hash and the same two lines of arithmetic,
  written out twice, and the test checks that the number of trees the game
  saw burst is exactly the number the seeds said would.

- 2026-10-11: the skeletons are the same mesh as the soldiers. A separate
  skeleton model would be a second mesh, a second upload and a second draw
  call for something only a handful of bodies are ever in; instead the
  soldier carries its own bones inside itself and the vertex shader collapses
  whichever set is not wanted to a point. Cloth, webbing and helmet shrink
  towards the body's own centre line as the charring rises and the bones come
  out of the same place. It costs about forty triangles per soldier and
  nothing else at all.

  One thing that had to be split for it: the fragment shader is shared by the
  drones, the projectiles, the pickups, the gibs and the soldiers, and only
  the soldiers can be burnt. Rather than have everything read a varying that
  nothing writes, the shader is now built twice from one template, once with
  the charring compiled out as a constant and once with the real input.

- 2026-10-11: the vehicles are two kinds, not four. A tank is a jeep that is
  slow, heavy, turns badly and hits very hard; a fighter is a helicopter that
  cannot hover and falls below its stall speed. Writing them as four classes
  would have been four sets of the same bugs, so there are two update
  functions and one table of numbers, the same shape as the arsenal.

  Two things the first version got wrong, both the same mistake. An aircraft
  sitting on the ground was pressed into it by its own weight every frame,
  and the landing code counted that as an impact, so a parked fighter
  destroyed itself in four frames and took a building with it. And the
  forward wall check fired on a stationary aircraft with a building beside
  it. Both are now gated on actually having been moving: a parked aircraft is
  parked, not crashing.

  The simulation also had to be split. `fixed` walked the player and then ran
  the world, and driving is the same world with somebody else at the
  controls, so everything from the combat clock down is now one function that
  the walking path, the driving path and the cinematic camera all call. The
  one thing it does not do is move you.

- 2026-10-11: a rocket was reaching forty five metres. The damage grid is
  twenty two metre cells, a nine metre blast touches up to four of them, and
  every cell that took a step was opening a site with the full cell radius.
  Four full sites round one hit reached across the street and took a slice
  out of the buildings either side of what was aimed at. The radius now
  grows with the damage instead: one step is a dent in a frontage, four steps
  is the frontage gone. A warhead is unchanged, because a warhead is supposed
  to take the whole circle at once.

  The check that caught it was also claiming more than the game can give.
  It read the tallest thing within eighteen metres of the hit and asked for
  it to be untouched, but eighteen metres of a frontage is inside the
  footprint of what a rocket legitimately damages. It now reads two things:
  the block the hit is in, which must keep nearly all of its height, and a
  second building more than forty five metres away, found by the same scan,
  which must not move at all. The second one is the real claim, and it is
  measured on something that was never in reach.

## 18. Berlin inside the Ring, as districts

The brief asks for a walkable Berlin under twenty five megabytes of download.
Mitte is 6.5 square kilometres and 2.2 MB over the wire. Inside the Ringbahn is
106, and at Mitte's detail that is about a hundred and thirty megabytes. The
question the city had to answer was therefore not "can the whole of Berlin be
built" but "what does the whole of Berlin have to give up to fit", and the only
honest way to answer that is to build it and weigh it.

- 2026-10-11: the box is the Ringbahn's bounding box, and it is taken from the
  four stations at its corners rather than from a round number: Westkreuz
  52.5010 N 13.2840 E, Ostkreuz 52.5031 N 13.4689 E, Gesundbrunnen 52.5486 N
  13.3894 E, Suedkreuz 52.4720 N 13.3670 E. Sources: the Wikipedia station
  articles for the first three, and latitude.to for Suedkreuz, which is the
  weakest of the four and is the one to check again if the south edge ever
  matters. The ring encloses about 88 square kilometres of the 106 in the box;
  the corners fall outside it, which is why they are built at the cheapest
  tier.

- 2026-10-11: the districts are cut in tiles, not in degrees. The first version
  snapped each district's lat lon box outward onto the global grid, which gave
  twenty four districts whose tile ranges added up to eight hundred more tiles
  than the grid has: every boundary was claimed by both sides. Cutting the grid
  first and deriving each district's box from its own tiles means the city
  partitions exactly, and the test counts it.

- 2026-10-11: the projection is unchanged, and over twelve and a half
  kilometres it is wrong by about fifteen metres at the far corners, because it
  uses one metres per degree of longitude for the whole city rather than
  recomputing it per latitude. That is deliberate. Everything is projected with
  the same two constants, so the city is consistently stretched rather than
  torn; nothing lines up against an external map and nothing has a seam.

- 2026-10-11: the palette had to be frozen. A vertex carries a six bit index
  into the facade palette and the renderer uploads one palette for the whole
  city, but the build grew its palette as the data asked for colours. With one
  district that was fine. With two it would have meant index seven being
  sandstone in Mitte and brick in Wedding. The palette is now computed, sixty
  four fixed shades of the twelve Berlin tones, identical in every district,
  and a building that states its own colour is snapped to the nearest one.

- 2026-10-11: two bugs the clipping found, both of which would have shipped
  silently. The first: `annotate` attaches the surveyed facts, and with no box
  to check against it put the Brandenburg Gate, the Reichstag and the stelae
  field into every district that was built, out by the ring included. It now
  takes the district's own metres and only adds what stands inside them. The
  second: the first road clipper tested the points of a line and cut where one
  went outside, which silently dropped every street whose two ends are both
  outside the district and which crosses the whole of it. That is most of the
  streets in most districts, and the build cheerfully reported sixty roads and
  nought kilometres of road. It is Liang Barsky per segment now.

- 2026-10-11: what the tiers actually save, measured on the offline city rather
  than guessed. The footstep surface map was a tenth of a district at 2.5 m
  across the whole box, so it goes to 5 m and then 10 m. The base ground grid
  at 12.5 m is four thousand cells a square kilometre, so it goes to 25 m and
  then 100. A pitched roof is four more vertices per metre of frontage and
  reads as flat from the next street, so out past the inner districts every
  roof is flat. A small building becomes the box that fits it. The height
  field, 2 kB a tile whichever tier it is in, drops from thirty three points
  across to seventeen, nine and five. What none of that touches is the thing
  that actually dominates, which is the walls: about two thirds of an outer
  district is building vertices, and the only way to spend less there is to
  have fewer buildings, which is what the minimum area does.

- 2026-10-11: the streaming is deliberately boring. One tile array over the
  whole city, sparse, with each record carrying a reference to the district
  buffer its offsets point into. Everything downstream kept working unchanged
  because everything downstream addresses the city by tile index. The three
  things that did have to change are the three that had assumed one buffer: the
  height field, which now reads its own size out of the blob, the surface map,
  which belongs to a district rather than to the world, and the facade palette.

- 2026-10-11: the budget is enforced by a tool rather than by a promise.
  `npm run weigh` prints every district's deployed and gzipped bytes, the code
  and the page, and the total against the twenty five megabyte line, and exits
  non zero when a complete city is over it. The workflow that builds all
  twenty four districts from the live extract runs it, so the answer to "does
  all of Berlin fit" is a number in a log rather than an opinion.

### What the whole city actually weighs

The first complete build of all twenty four districts from the live extract,
on 11 October 2026, is the answer to whether Berlin inside the Ring fits in
the brief's twenty five megabytes. It does not.

```
24 of 24 districts built
area            106.2 km2
buildings       52806
trees           55577
road            2679.3 km
deployed        193.48 MB
download        70.61 MB gzipped, against a 25 MB budget
per km2         0.665 MB of download
```

Every district came out with its own name from the place nodes in its own
extract: Moabit, Gesundbrunnen, Prenzlauer Berg, Hansaviertel, Friedrichshain,
Charlottenburg, Tiergarten, Kreuzberg, Wilmersdorf, Schoeneberg, Neukoelln,
Alt-Treptow, Schmargendorf and the rest. The city is real and it builds. It is
2.8 times the budget.

Where the bytes were going, from the per district byte lines: in
Gesundbrunnen, 8.8 square kilometres, the bundle was 28.7 MB of which 21 MB
was vertices, and the district has 463 km of road in it. A ribbon costs four
vertices per point of the line it follows and twelve with a pavement either
side, and OpenStreetMap puts a point every few metres. Roads, not buildings,
were the largest single thing in every outer district. That is why the build
now prints where its vertices went, and why the tiers changed:

- the four districts you can walk into directly from Mitte keep their roofs,
  windows and trees but lose their pavements, and their centrelines are
  simplified at 1.5 m;
- everything else out to the ring is blocks, with only the roads you can
  drive on, simplified at 5 m;
- the corners outside the ring are an outline, simplified at 10 m.

And because even that does not fit, what ships is decided by measurement
rather than by hope. `tools/fit-city.mjs` takes districts outward from the
middle until the budget is spent, drops the rest out of the index and deletes
their bundles, and says in the log exactly which ones did not fit and by how
much. The deploy is therefore always inside the brief's budget and always a
contiguous city around Mitte, and the question "how much of Berlin fits in
twenty five megabytes" has an answer that is printed on every build rather
than argued about.

### Which twenty five megabytes

Rule 6 of the brief is "total download under 25 MB for the whole playable
area". While the city was one district that sentence never had to be read
closely, because the deployed bundle was 21.33 MB and the same thing over the
wire was 7.90 MB, and both are under twenty five. Districts pulled those two
numbers apart: the live Mitte alone is 20.75 MB on disk and 7.67 MB gzipped,
so on the stricter reading the whole game is Mitte and nothing else, and on
the other one there is room for about a dozen districts.

Download is what travels. Every browser sends an Accept-Encoding header
asking for gzip and GitHub Pages serves it compressed, so the bytes a player
actually downloads are the gzipped ones, and that is what the budget is now
measured against, in all three tools: the packager, the weigher and the
fitter, which until today disagreed with each other. The deployed size is
printed next to it everywhere it appears, because it is the honest other
number and because choosing the more convenient of two readings without
saying so is how a budget stops meaning anything.

If the intended reading was the stricter one, the change is one line in each
of those three tools, and the shipped city becomes Mitte plus whatever fits
in the four megabytes left over.

## 19. Fire, machines, and damage that stays done

- 2026-10-12: the crater was never drawn. The vertex shader decided whether a
  vertex was ground by testing bit one of the facade flags, and bit one is
  GROUND_FLOOR, the shop window band at the bottom of a wall. Streets, squares
  and parks carried no flag at all, so the collapse code treated them as
  buildings, found they were nowhere above the site, and left them alone. The
  collision meanwhile had a ten metre hole in it, because that is dug in
  JavaScript against the same profile. The result was a street that looked
  solid and was not: you walked onto it and fell, which is what "suddenly I am
  in the air after an explosion" means. Ground now carries a flag of its own
  and the shader reads that one.

  The check that was supposed to catch this, "the collision agrees with the
  shape the shader draws", compared the JavaScript crater profile with the
  collision height field. Both are the collision. It never looked at what was
  drawn, and the name of it said it did.

- 2026-10-12: devastation is permanent now, and that is what makes it work
  everywhere. There are sixteen uniform slots for collapses. The old answer to
  the seventeenth blast was for the nearest site to swallow it: its radius
  grew until it covered the new one, so a rocket fired across the square
  flattened a strip between here and there and left nothing where it landed.
  After sixteen explosions, nothing new came down anywhere.

  A finished site is now written into the tile buffers: the same arithmetic
  the shader does, run once in JavaScript over the vertices of every tile it
  touches, with the result stored back into the district's own bytes and the
  tile re-uploaded. The slot is then free. Rubble is marked with a flag the
  fragment shader reads, so a baked ruin lights like rubble for ever rather
  than for as long as it holds a slot. A reload rebuilds the city from the
  bundle; nothing else does.

- 2026-10-12: trees that burn down are struck off by tile and ordinal, which
  means the instance buffer is rebuilt without them and their trunks stop
  blocking. Thirty nine of thirty nine, measured, with no fires left running.

- 2026-10-12: the flamethrower is the first weapon in this game that pours
  rather than fires. It cost a new weapon kind, because every other weapon in
  the table spends a round on a trigger pull and this one spends fuel on a
  clock. Its second trigger throws a wall of fire that travels: a line of
  flame that walks away from you across the ground, burning what it passes and
  leaving the street alight behind it. The wall is not geometry, it is flame
  particles emitted along its length, which is how every other fire here is
  drawn and costs nothing on the card.

- 2026-10-12: Rise of the Machines is a mode, not a cheat, and the score says
  so. A machine is a soldier with a different body and a different gun: the
  skeleton the ion cannon leaves, drawn in steel, with the skull given a part
  id of its own so it can carry one red eye without the whole figure glowing.
  It walks, takes cover and loses you behind a wall because the soldier
  already knew how to do all three. An EMP stops it where it stands, and what
  you do to it then is your business.

### What it would take to build the whole of Berlin

Measured rather than estimated, from the live Overpass extract, at the tiers
as they stand after the retune:

```
tier 0  full      6.5 km2   1.18 MB of download per km2    7.6 MB
tier 1  near     21.8 km2   0.52                          11.3 MB
tier 2  block    60.2 km2   0.45                          27.1 MB
tier 3  outline  17.9 km2   0.24                           4.3 MB
                                                    about 50 MB
```

So the whole area inside the Ringbahn is about fifty megabytes of download at
walkable quality, against a budget of twenty five. It builds: all twenty four
districts have been built from the live extract, with 52,806 buildings and
2,679 km of road in them, and the game streams them. What does not fit is the
download, and nothing else: there is no limit in the engine, the tile grid or
the memory. The city is held a few square kilometres at a time whatever its
total size, and the only number that goes up with the whole is the index.

Three ways to close the gap, in the order they cost quality:

1. Ship less of it. This is what happens today: fit-city takes districts
   outward from Mitte until the budget is spent and the rest are not deployed.
   At the current tiers that is Mitte plus eight or nine districts, about
   forty square kilometres.
2. Spend the budget differently. Mitte is a third of it for six per cent of
   the area. Dropping the middle to the near tier would free about four
   megabytes, which is four more districts.
3. Make the block tier cheaper. It is the biggest single line in the table and
   it is mostly road ribbon: at ten metres of simplification and no pavements
   it is already a third of what it was, and dropping it to a flat extrusion
   with no roof detail at all would take it under 0.25, which would bring the
   whole ring to about thirty five megabytes.

None of those is a decision this project should take on its own, because all
three of them trade away something the brief asks for. The numbers are here so
the trade can be made with eyes open.

## 20. All of Berlin, one district at a time

The city is no longer the area inside the Ringbahn. It is Berlin, out to the
administrative boundary: a box 45.7 km by 37.4 km, 1,706 square kilometres of
which the city proper is about 891, cut into eighty one districts on one tile
grid of 458 by 375 tiles. Steglitz, Lichterfelde and Treptow are in it, which
is what prompted the change.

- 2026-10-12: the lattice is deliberately irregular. Near the middle a
  district is one and a half kilometres across, because that streams in
  quickly and the detail there is high. Out past the ring they are four
  kilometres, and past that eight, because a district is one Overpass query
  and one build and nobody wants four hundred of either. Three bands, two
  cell sizes, five tiers of detail, and the cuts all land on lines of the
  global grid so the districts still partition the city exactly.

- 2026-10-12: one district is in memory at a time. That is the whole answer to
  the budget question. The brief asks for the playable area to come down in
  under twenty five megabytes; all of Berlin at the tiers as they stand is
  about two hundred and forty, and no amount of thinning gets 1,700 square
  kilometres under twenty five. What does fit, and fits easily, is what a
  player actually downloads to play: the code, the index and the district they
  are standing in, which is between one and three megabytes. So that is what
  the budget is now held against, and `tools/fit-city.mjs` fails the build if
  any single district is too big to wait for, because a district that big
  should have been split instead.

  This is a reinterpretation of rule 6 and it is written down here rather than
  quietly applied. The old reading, the whole deployed city under twenty five
  megabytes, is still available: `fit-city --whole=25` cuts the city down to
  what fits and deletes the rest.

- 2026-10-12: crossing a boundary is a loading screen, not a stall. It names
  the district you are entering and says how big it is, the bytes come down,
  the district you were in is let go, and you are put down on the other side.
  The controller holds you at the edge of what is loaded while that happens,
  which it already did; what is new is that something starts the load when you
  walk at the edge rather than after you have been stopped by it.

- 2026-10-12: the map is the whole city whatever is loaded. It draws every
  district in the index, dim for the ones that are not in memory, with their
  names, and you can zoom from a street out to all of Berlin and back. That
  separation, the map knowing the catalogue and the memory holding one entry
  of it, is what makes the city feel whole while costing one district.

- 2026-10-12: the loading screen names a place in the district, not just the
  district. The build picks it: a landmark that came with a written card
  first, then any named attraction from the extract, then the station the
  district is built around, each time the one nearest the middle, and it goes
  into the small index rather than the district's own file, because the screen
  has to say it before any of the district has arrived. A district whose
  extract named nothing says nothing, rather than being given a name it does
  not have. `docs/screenshots/district-03-crossing.png` is the screen itself,
  photographed with the line slowed down so the screen is up for real rather
  than forced open by a hook.

- 2026-10-12: two checks were measuring the machine rather than the game, and
  the live city found both. The flamethrower check held the trigger for eighty
  frames and expected a hundred units of fuel to go, which is a statement
  about how fast the frames are, not about the weapon; it now holds for four
  seconds and asks whether the drain matches the twenty six a second the
  weapon claims. The wall of fire check asked the tree fires whether anything
  was still burning, and on a real street with no trees on it the answer is
  no. That one was a hole in the game, not only in the test: a wall now leaves
  the road itself alight behind it for eleven seconds, the way an incendiary
  does, so crossing Leipziger Strasse with it does something.

- 2026-10-12: vehicles reported as not working were working: F gets you into
  anything within seven metres and W drives it, which the suite has checked
  since phase 15. What was missing is everything that tells you so. There is
  now a prompt on the screen when you are standing next to one, saying which
  key and what it is; empty vehicles are squares on both maps, so you can see
  where the nearest one is parked rather than finding it by accident; and
  crossing into a district parks a fresh set around where you came out,
  because the ones you left were in the district that has just been let go.
  Two checks in the city suite and one in the district suite hold that.

## 21. The ground you see is the ground you stand on

- 2026-10-12: being in the air after an explosion had two causes and both are
  gone. The crater went into the collision field in one go, at the moment the
  collapse opened, while the drawn ground sank over the next second and a
  half; for that second the ground underfoot was six metres below the ground
  in front of your eyes, and when you did fall, you fell the whole way. The
  hole now goes into the field in step with the picture, a share each frame,
  as the difference between two levels of the same profile so that two craters
  on top of each other still add up. And the controller knows the difference
  between the world moving and you moving: ground that sinks under the feet
  you are standing on carries you down with it at nine metres a second, on
  your feet the whole way, so a crater opening where you stand puts you at the
  bottom of it rather than dropping you in. Walking off a kerb is unchanged,
  because that question is asked before the step rather than after it.

- 2026-10-12: the flamethrower had a key that could never be pressed. Its case
  in the keyboard switch was a second `case 'KeyG'`, and the first one holsters
  the weapon, so the branch was unreachable from the day it was written. It is
  Z now, the incendiary is B and the EMP is X, all three are in the help panel
  and the readme, and the interface suite presses each of them for real and
  checks what came up, because nothing else would have noticed.

- 2026-10-12: the loop counts the seconds it has actually simulated, as
  `loop.simTime`, and the fire checks measure against that. A machine slow
  enough for the frame clamp to bite runs the game slower than the clock on
  the wall, so a drain of twenty six fuel a second looked like nine on the CI
  runner. The same slowness burnt the road out before the check could see it
  alight, so what the wall leaves behind is now watched while the wall is
  still running rather than counted afterwards.

## 21. Machines with guns, and mechs

- 2026-10-13: a machine's shot came out of the sky, and the reason is the same
  shape as the dead key: `Effects` had two methods called `beam`, one a line
  from here to there and one a column of light standing on the ground, and a
  class keeps the last one. Every machine shot was being drawn as a pillar
  standing on the machine and going up out of the world. The line is called
  `lance` now, which cannot collide with anything.

- 2026-10-13: and the machine had nothing to shoot with. The soldier's rifle
  is one of the cloth side parts, and a machine is the skeleton with the cloth
  collapsed to nothing, so it went with the uniform. A machine now carries a
  beam rifle of its own, parts 26 and 27 in the same mesh, which the vertex
  shader keeps only when the instance says machine, so a man burnt to the bone
  by the ion cannon does not stand up holding a gun he never had. The shot
  leaves the emitter at the end of that barrel: `MACHINE_MUZZLE` is exported
  by the renderer that builds the gun, and main.js turns it into a world point
  with the body's own rotation, so the gun you see and the line you see are
  the same object. The suite checks that a shot is one line, that no column is
  made, and that the line starts in front of the machine rather than in its
  back, which a distance alone cannot tell you.

- 2026-10-13: and there were too few of them. The mode now keeps twenty two
  machines walking instead of fourteen and puts a new one up every 1.1
  seconds instead of every 3.2, which is the soldier pool nearly full.

- 2026-10-13: forward in a vehicle is forward on the screen. The hull always
  drove nose first, and the suite has checked that since phase 15, but the
  camera kept the heading you had on foot, so a tank parked across your line
  of sight drove sideways or straight past you when you pressed W: it read as
  reverse. Getting in now turns the view to the hull's heading, and steering
  turns the view with the hull, free look still live on top of it. Two checks
  hold it, one that forward goes where you are looking however the thing was
  parked, one that the view and the hull turn by the same angle. The controls
  are also on the screen now while you are in it, which is the other half of
  why nobody could tell.

- 2026-10-13: the map is all of Berlin whether or not Berlin has been built.
  The index now carries an entry for each of the eighty one districts: the
  ones with a bundle behind them as before, and the rest as placeholders with
  their box, their tier and a label saying where they are, at no cost in bytes
  because there is nothing to download. The map draws those as unsurveyed
  ground, free travel refuses them with the reason rather than flying you into
  a hole, and walking at one says so and holds you at the edge. `World.isBuilt`
  is the single gate; everything that loads goes through it.

- 2026-10-13: and the deploy builds the city rather than a corner of it. The
  deploy used to fetch a hardcoded dozen districts, which is why most of
  Berlin was missing from the deployed game. It now restores the extract cache
  the weekly whole city job writes, spends up to twenty minutes filling
  whatever gaps are left, writes back what it got, and builds everything it
  has. Both jobs fetch live only: Overpass failing leaves a district unbuilt
  rather than putting a synthesised Berlin on the website, which is the same
  rule as everywhere else in this project. Fetching all eighty one from cold
  is an hour and three quarters, nearly all of it waiting on Overpass; the
  build itself is two minutes.

## 22. Mechs

- 2026-10-13: eight metres of walking gun platform, theirs and yours, in
  `src/game/mechs.js`. A mech is neither a soldier nor a vehicle: it walks, so
  it follows the ground and steps over kerbs; it is a machine, so its legs
  turn slowly and its torso turns fast, and the torso is what the guns are on.
  That split is the whole feel of it. One update drives both: a pilot is a set
  of controls where the hunting ones have an intent, so there is one physics
  path rather than two that drift apart.

- 2026-10-13: the body is one mesh and one draw call, with the transform doing
  the work. `MECH_VS` swings the legs about the hip line, turns and pitches
  the torso about the same line, bobs the whole body twice a stride and lays
  it over when it dies. The materials are the shared body shader's: hull
  plate, joint steel, gun metal, glass, and the glowing core, which the vertex
  stage swaps from red to blue when the instance says the mech is yours. That
  is the only difference between the thing hunting you and the thing you are
  standing in: one number per instance.

- 2026-10-13: yours is called from the cheat menu, boarded with F like
  everything else, and driven in a chase view from behind the shoulders. W A S
  D walks it, the mouse aims the torso and the legs chase the torso, the left
  mouse is a chaingun and the right is a salvo out of the pod, Shift dashes
  and Space jumps. The landing is its own weapon: forty tonnes arriving opens
  the road and takes apart what is standing in eleven metres of it, and the
  pilot inside the armour is fine, which is the one place where the blast does
  not treat you like everything else.

- 2026-10-13: theirs, the Reaper, walks in from a couple of hundred metres,
  closes to about forty, sidesteps rather than standing still, and fires five
  rounds then waits two seconds, because a mech that fires without pausing
  kills you from across a square before you have found which street it is in.
  Rockets only past fifty five metres, for the same reason. Rise of the
  Machines keeps two of them walking; the cheat menu drops a pair on demand.
  Twenty four checks hold the lot, including that its feet never leave the
  ground, that the chaingun takes another mech apart, and that a jump ends in
  a hole rather than in silence: the first landing did nothing at all, because
  the kerb step in the walker was catching the fall and cancelling it.

## 23. The readout, the fighter, the holes and the memory

- 2026-10-13: a vehicle tells you what it is doing. One panel serves all five
  things you can get into, because the questions are the same in each case:
  what is left of this, how fast is it going, can I fire yet, and in the air,
  how far is it to the ground. The hull bar goes amber under a third and red
  under a sixth, a cooldown is shown in seconds rather than as a bar because
  what a tank wants to know is when and not how far along, an aircraft adds
  its height above the ground under it, a mech adds its dash, and one line
  underneath says what is about to go wrong: stall, hull critical, pull up.
  Everything is read off the entity each frame, so the numbers on the screen
  are the numbers the simulation is using.

- 2026-10-13: the fighter would not fly, and it was two things. The ground
  contact took fourteen per cent of the speed off every frame, which is eight
  hundredths of it left after a second, so a fighter parked in a street could
  never pass ten metres a second and could never reach its stall speed. It
  rolls now, losing a third of its speed a second to the wheels, and it is off
  the ground in about a second and a quarter. The second thing was the pitch
  sign: looking up put the nose down. On a helicopter that only changed which
  way it leaned, on a fighter it meant pulling back on the stick flew you into
  the road. And because a street is not a runway, the cheat menu now hands you
  one already in the air with you in it.

- 2026-10-13: you could see through the city after an explosion. Every wall
  and every street here is a single surface with no thickness, so once a blast
  takes a bite out of one, the back of the next surface faces you, and a back
  face that is culled is a hole straight through the world: sky where the
  inside of a ruin should be. Drawing the whole city from both sides fixes it
  and costs a quarter of the frame on the software rasteriser, which is not a
  price worth paying for damage that is usually not on screen. So the tiles a
  blast has touched are drawn a second time with the front faces culled, which
  fills exactly those holes and nothing else: an undamaged city pays nothing,
  and the inside of a ruin is a handful of tiles. The check draws the same
  frame twice inside one animation frame, with the pass on and off, and
  requires that every pixel it changed got darker.

- 2026-10-13: and the damage is remembered across districts. One district is
  in memory at a time, so leaving one threw away the bytes a ruin had been
  written into and the street was whole again when you came back. A finished
  ruin is eight numbers, so those go to the world against the district they
  are in, and loading a district replays them through the same code the live
  collapse ends with: same cut, same heap, same crater, same collision. A
  street you flattened is flat when you walk back into it from the other side
  of Berlin, and it costs a few dozen bytes a ruin rather than holding the
  district open.

- 2026-10-13: a Reaper walks round a building instead of into it. The live
  city found this one: in Mitte it spawned seventy seven metres out, found a
  frontage in the way and stood there for the rest of the test, having closed
  six metres. A mech that only stops at walls never arrives. It now tries the
  two ways along a wall it has run into, keeps whichever is clear for a second
  and a half so it does not dither in a doorway, and slides along at four
  fifths of its walking speed.

- 2026-10-13: the whole city, measured. The city job built all eighty one
  districts from the live extract: 102,691 buildings over 1,717 square
  kilometres, 304 MB deployed and 107 MB over the wire, which is 0.062 MB of
  download per square kilometre. The biggest district to walk into is 8.65 MB,
  8.89 MB with the code and the index, so the per district budget holds with
  room to spare. Two checks had to learn that a city with nothing left unbuilt
  is the point rather than a failure: they pass by saying so.

- 2026-10-13: the mech guns are harmonised. They sit two metres out on the
  arms and fired straight down their own barrels, so every round went two
  metres to the side of whatever the pilot had the crosshair on, which at
  thirty metres is a clean miss against something three metres wide. They now
  converge on the point the torso is looking at, found by tracing the line of
  sight the way a gun mount is harmonised on a range. What found this was a
  flaky check: it failed only sometimes, and when it was made to say why, it
  said the target was thirteen metres below the muzzle, standing in a crater
  the earlier checks had dug. Two faults in one measurement, one in the test
  and one in the game.

## 24. Titanfall

- 2026-10-16: the mech was walking backwards, and it was the legs rather than
  the animation. The legs followed the torso, and the torso follows where you
  look, so every time you turned round or strafed the body travelled one way
  while the legs pointed another: a walk cycle playing against the direction
  of travel, which reads as moonwalking. The legs now turn towards the way the
  thing is actually going, and the stride runs with the sign of the travel
  along them, so stepping back plays the cycle backwards. The hunting ones got
  the same treatment, which also stopped them sliding sideways round you.

- 2026-10-16: a mech you call for is dropped rather than parked. The words go
  up on the screen, forty tonnes comes down from two hundred metres at sixty
  metres a second, and the landing is the arrival: it opens the road under it
  with half again the radius of an ordinary stomp. It takes two and a half
  seconds, which is about as long as it takes to look up.

- 2026-10-16: the rocket pod throws its salvo at two hundred and thirty metres
  a second rather than a hundred and fifteen, which is the difference between
  a launch and a lob. The check that counts the salvo had to stop counting
  what is still in the air, because at that speed the first rockets have
  already arrived before the last has left.

- 2026-10-16: the help panel scrolls. It has a line for every key now and a
  laptop screen ran out before the list did.

- 2026-10-16: a Titan carries a loadout. Five weapons instead of one, in the
  spirit of what a Titan carries in the games this is named after: the XO
  chaingun that hoses, a forty millimetre cannon that punches, a thermite
  launcher that denies a street, a plasma railgun you hold to charge and
  which goes through four machines on one bolt, and the Leadwall, fourteen
  slugs at once at close range. Each is a row of numbers, the same way the
  hand weapons are, with its own magazine, its own rhythm and its own kick.
  The number row and the wheel choose between them while you are sitting in
  it, and R reloads what it is holding. The hull now has a shield over it
  that soaks the first fifteen hundred and comes back five seconds after
  anybody stops shooting.

- 2026-10-16: and a cockpit to fire them out of. The camera sits on the
  torso's own line of sight, a metre and a half in front of its eye, which is
  not a detail: the guns converge on the point that line runs into, so a
  camera parked beside it would put the crosshair half a metre under the shot
  at fifty paces. A check measures exactly that, level and pitched down, and
  wants the aim point within ten centimetres of the middle of the screen. The
  view bobs with the same walk counter the legs are drawn from, so the step
  you feel is the step you can see, and the pilot's look is held to the same
  limit the torso turns through, because a view that can point somewhere the
  guns cannot is a view that lies. V swaps to the old camera over the
  shoulder. The readout alongside it is the mech's own: the loadout down the
  right with the live magazines, hull and shield, the pod and the dash, and
  the charge on the railgun drawn under a reticle that goes blue while it
  builds.

- 2026-10-16: three things a blast did not do, which it now does. It did not
  touch a mech, so a rocket at a Titan's feet took the paint off and nothing
  else; it did not touch a parked vehicle; and a rocket flew straight through
  a mech to go off on the wall behind it, because the list of bodies a shell
  asks about had every actor in the city on it except the largest. The same
  list now says what it hit as well as where, which is what the gun on a tank
  had been reading all along and never getting. Fire reaches a mech too, at a
  seventh of what it does to a person, which is what makes the thermite
  launcher a way to deny a street to one.

- 2026-10-16: a pilot inside forty tonnes of armour no longer burns to death.
  The street catching light under a Titan was being charged to the man in the
  seat, and so was the blast from a rocket that had already dented the hull:
  both now go to the machine, which is the thing standing in them.

- 2026-10-16: a mech killer. An EMP warhead with a charge behind it, on K,
  which locks onto what it is aimed at and chases it: against a street it is
  a heavy rocket and no more, against anything with a motor it is a pulse
  that stops it dead, and against armour it is three thousand, which takes a
  Reaper apart on its own and leaves a Titan on one knee with its shield
  gone. The shield going is the EMP rather than the warhead: it is held up by
  the same electronics the pulse has just stopped, so what the second rocket
  lands on is bare hull. A mech stopped this way does not walk, aim, fire or
  recharge for four and a half seconds, and the cockpit says so.

- 2026-10-16: and the machines can carry one, by a toggle and a slider in the
  cheat menu: whether any of them have it at all, and what share of them do.
  It is rolled once when a machine walks in rather than every time it shoots,
  so a street is a mix rather than a lottery, and one of them only reaches
  for the warhead when what it is looking at is armour, because an anti mech
  rocket spent on a man on foot is a rocket wasted. Theirs comes out of the
  shoulder a metre and a half in front of the launcher: the list of bodies a
  rocket asks about now has mechs on it, and the first version went off in
  its own hands.

- 2026-10-16: the lock could not see a mech, which made the one thing worth
  locking a rocket onto the one thing you could not lock onto. It can now,
  except for yours, because a dart that chases your own Titan across the
  square is not a feature.

- 2026-10-17: Rise of the Machines starts at the hour it actually is. The
  mode held the light at a quarter past eight in the evening whatever the
  clock said; it now reads the clock on the wall when the mode is picked,
  rounded to the step the slider moves in so that the screen and the world
  cannot disagree about what time it is. Picking the mode again re-reads it,
  because a tab left open since the morning should still start this
  afternoon, and moving the slider stops all of that: a time somebody has
  chosen is a setting rather than a default.

## 25. The city, the drop and the pulse

- 2026-10-17: the cockpit went solid whenever you turned towards something.
  The head sits a metre and a half in front of the torso's eye, which is the
  whole reason the view is worth having, and nothing stopped it going through
  a wall: a mech fighting down a street stands with its shoulder against a
  frontage, and looking at that frontage put the camera inside it. The city
  gets a say now, the same way it does over the shoulder, and the camera
  slides back along the aim line until the wall is in front of it again.
  Pulled all the way in it is back inside the torso, which draws as nothing
  at all. Every one of those positions is on the aim line rather than beside
  it, so the crosshair still says where the shot goes.

- 2026-10-17: the check for it had to move to the top of the suite. It stands
  a mech a metre from a frontage and asks whether the camera stayed on this
  side of it, and at the end of the suite there is no frontage left within
  three hundred metres: the checks above it spend several minutes flattening
  the district, and the first version of this one failed with a hundred and
  forty four rays finding nothing at all.

- 2026-10-17: a titanfall takes half a minute. The words went up and the
  machine arrived two and a half seconds later, which is a delivery rather
  than a drop. Calling one now buys a promise and a place: twenty five
  seconds of countdown on the banner with a column of light standing on the
  piece of road it is coming down on, and then three hundred and twenty
  metres of falling, which works out at four seconds under the same gravity
  everything else here falls at. Nothing exists on the ground until the clock
  runs out. A call is lost if you walk out of the district it was aimed at or
  if the run ends while it is on its way, because a machine landing on a
  corpse helps nobody, and the street can also fill up in the meantime, in
  which case the drop is waved off rather than wedged in.

- 2026-10-17: the spot it lands on is found over several rings rather than
  one. A single ring at a fixed distance answered no about one call in three
  from a square with craters in it, and a Titan you cannot call because of
  where you happen to be standing is a Titan you do not have.

- 2026-10-17: the holes in the ground, and what they were. The city had
  patches you could see the sky through while standing on ground the
  collision layer called solid: a long strip across the Tiergarten was the
  one that gave it away. Three faults, found by switching the sky off and
  flying over the district looking straight down, because with nothing drawn
  behind the city a hole is black and the Spree is not.

  The first is the one that made the hole. A vertex is stored as a sixteen
  bit offset from its tile's origin at a sixty fourth of a metre, which runs
  out at five hundred and twelve metres, and anything further is clamped. The
  park came out of the triangulator as a handful of triangles six hundred
  metres across, the clamp pulled their corners in, and what was left was a
  gap. Ground polygons are now cut to a fifty metre grid before they are laid
  down, and road ribbons have their long runs cut the same way. The cut is
  done with the same arithmetic on both sides of every grid line, so there
  are no T junctions and no hairline cracks, it nests inside the hundred
  metre tiles so a piece of ground belongs to the tile it is drawn in, and as
  a bonus the ground now follows the terrain instead of being a flat sheet
  laid over a city that is not flat. It costs six per cent more triangles and
  four per cent more download.

  The second is the mask that decides where the base plane goes. It was built
  from the source polygons rather than from what was drawn, so a park was
  marked as covering its own holes, a polygon that failed to triangulate was
  marked as covering what it never drew, and a building footprint, which is
  not ground at all, was marked as covering the ground under it. It now
  rasterises the triangles in the mesh, at three quarters of a metre, and
  nothing else: what the base plane fills is exactly what the rest of the
  city did not draw.

  The third is the check that was not there. The city suite now flies over
  twenty five places in the district with the sky switched off and counts the
  black pixels looking straight down. The renderer learned one switch for it,
  which is worth having anyway: with the sky off, every hole in the world
  shows as a hole.

- 2026-10-17: the EMP is a launcher now, and it lands like one. It was a bomb
  you lobbed at your own feet on an arc you had to judge, with a fuse that
  went off late and a radius you could not put where you wanted it; it is now
  a rocket at seventy metres a second that goes off on what it hits, two in
  the magazine, and it reaches thirty eight metres round the impact.

  The pulse itself had almost no weight to it: a blue flash, thirty sparks
  and a rising whine. It now draws as what it is. A ring travels out along
  the ground to exactly the radius it reaches, so what it caught and what it
  missed is on the screen rather than in the kill feed; arcs stand in the
  middle of it; the frame goes white and the view shakes, both falling off
  with distance; and the sound got the thing it was missing, which is seventy
  hertz falling out from under the whine. It answers as well: a hit marker, a
  line in the feed and a count of what it stopped, with mechs called out
  separately because stopping one of those is the shot you fired it for.
  Vehicles caught in it lose their speed, mechs stand there with their shield
  down for seven and a half seconds.

- 2026-10-17: Berlin on the map of Berlin. Only the district you are standing
  in has its streets in memory, so the map of the whole city was one district
  of detail in the middle of eighty labelled grey rectangles, which is not a
  city anybody can pick a warhead target on. Every district now bakes a
  sketch of itself into the index: its big roads, its water and its parks,
  simplified hard and rounded to whole metres, because at the scale the whole
  city fits on a screen a kerb is a tenth of a pixel. It costs a few hundred
  bytes a district, the index is loaded before anything else anyway, and a
  dense district is capped at two hundred and twenty lines so that one of
  them cannot run away with it. The map draws them as one path per kind
  rather than one per road, because eighty one districts is thousands of
  little strokes and the thing is redrawn on every drag, and it draws them
  dimmer than the district you are in, which still draws itself in full. A
  district nobody has built yet is still unsurveyed ground, because the map
  does not promise a street it does not have.

## 26. Nothing you can see through

- 2026-10-17: a floor of last resort. The holes in the ground were fixed in
  the pipeline, but a hole is the one fault in this project the collision
  layer cannot see, and the city is eighty one districts built from live data
  that nobody can check by hand. So there is now a single quad a dozen metres
  under the lowest ground in the district, drawn before the city and covered
  by it everywhere. Nothing is meant to see it. What it is for is the times
  when something does: a gap in the mesh, a tile that has not arrived yet, the
  void past the edge of a district, a hole left by whatever came down. All of
  those showed the sky, and from inside a city the sky at your feet reads as a
  white hole in the world that flickers as you walk past it. Now they show
  dark ground a long way down, which reads as a pit, and a pit in a city that
  has been shelled is not a bug. It costs two triangles and no buffers: the
  corners come out of the vertex id, the fog is the same fog as everything
  else, and it sits fourteen metres down, three metres deeper than the deepest
  crater this game can dig, so a crater is still a crater.

- 2026-10-17: the check for it punches a hole on purpose. It throws away the
  three by three tiles under the camera, looks straight down with the sky
  switched off, and asks what is there: ninety nine and a half per cent of the
  frame was sky with no floor under it, and none at all with one.

- 2026-10-17: the near plane moved from eight centimetres to twenty five, and
  that is a rendering fix rather than a camera one. A twenty four bit depth
  buffer resolves about the square of the distance divided by the near plane,
  so eight centimetres bought a tenth of a millimetre at the end of the street
  and twenty centimetres at half a kilometre: every road laid on every
  pavement in this city is a few centimetres apart, and out there they were
  swapping places. Twenty five centimetres is three times the precision at
  every distance and still clears the player's own collision radius of thirty
  five.

- 2026-10-17: and the fallback plane sinks with distance. It lies nine
  centimetres under everything, which is less than the depth buffer can tell
  apart past about six hundred metres, so it fought with the roads above it.
  It now carries a flag of its own and the vertex shader pushes it down by
  roughly what the buffer loses: a couple of centimetres down the street, a
  quarter of a metre at three hundred, never more than a metre and a half. A
  plane nobody can see is a plane that can go as deep as it likes.

- 2026-10-17: two measurements that were thrown away, because a check that
  cannot be trusted is worse than no check. Moving the camera a centimetre and
  diffing the frames measures parallax, not z fighting; moving the far plane
  instead moves the horizon, and the horizon then reads as the sky fighting
  the ground. Rendering the same frame twice with nothing changed at all still
  differs, because the render path emits particles and they are random. The
  checks that stayed are the ones that read a single frame and ask a question
  about it.

## 27. The title screen, and what a blast is allowed to take

- 2026-10-17: pressing play did not always fly the drone shot, and the reason
  was that the title screen was flying it already. The title camera asked the
  intro where the drone was, and that question is what starts the intro's
  clock, so a player who read the title for longer than the flight lasts
  pressed play, the flight was thirteen seconds past its end, and they were
  put straight down on the pavement. The title now holds the first frame of
  the arc and nothing else, and pressing play winds the clock back. The test
  suite had been catching this for a while as an intro that was there on one
  run and gone on the next.

- 2026-10-17: the same morning's other test failure was the suite's fault
  rather than the game's. Under a software rasteriser one frame of this city
  can take longer than a second, and a check that waited fourteen hundred
  milliseconds and then read the screen was reading it before a single fixed
  step had run at the new position. The waits that care now wait for the
  simulation to advance by so many seconds of its own time, which is the
  thing they were always trying to say.

- 2026-10-17: two switches in the cheat menu for the two halves of
  destruction, and they are the only ones in there that start on, because
  they are the game as it ships. Buildings off and a warhead digs its crater
  in a square with every frontage still standing; ground off and the block
  comes down onto a street that stays level. They are separate all the way
  through: the shader, the collision and the ruin that is written into the
  city afterwards all read the same per site flag, so what you walk on is
  what you can see whichever way the switches are set. The flag reaches the
  shader on the sign of the rubble heap, because both uniform vectors are
  full and a heap is never negative.

- 2026-10-17: what is already down stays down. Turning the buildings switch
  off does not put a frontage back up, and turning it on does not go looking
  for blasts that happened while it was off. A switch here says what happens
  next, which is the only promise it can keep once a ruin has been written
  into the city's own bytes.

- 2026-10-17: and underneath both of those was a loop that believed a frame
  which took less than no time. The clock was started from one reading and
  the frames were stamped with another: a browser stamps a frame callback
  with the time that frame began, so switching the loop on in the middle of a
  three second frame put the clock seconds ahead of the stamp that followed
  it. The accumulator went that far into the red, and until the wall clock
  caught up the simulation ran not at all while the city kept drawing. It is
  worst right after the loading screen, which is exactly where the frames are
  slowest. The clock now comes from the first frame callback, a negative
  frame is treated as no time at all, and `tools/test/loop.test.mjs` drives
  the loop by hand to prove it.

## 28. The last kill, and the switch above ultra gore

- 2026-10-17: a sixth step on the gore ladder, and it is the last one there
  can be. Ultra gore multiplies the other three by four and a fifth; this
  multiplies them by seven and a half, which is exactly where the pools run
  out. A spray was capped at seventy six drops and is now a hundred and
  thirty, the spark pool went from five hundred and twelve to seven hundred
  and sixty eight so that three sprays at once do not leave the tracers with
  nothing, a single body now takes every one of the ninety six pieces the
  gib pool holds when the tearing switch is on with it, and the throw on a
  ragdoll goes from two and a tenth to five and a third. It is the one gore
  switch that does not tear anybody apart on its own, which the first run of
  its check made obvious: the body it was measuring the throw of had been
  turned into ninety six pieces, and nought metres is how far a body that no
  longer exists travels. Coming apart is the absence of a death, so the
  switch whose point is the throw cannot also be the one that removes what is
  thrown. The renderer draws blood in its own instanced
  pass of five hundred and twelve, so none of this costs a draw call.

- 2026-10-17: slow motion on the last kill. It hangs off the one place every
  kill in the game is credited, counts what is still standing within a
  hundred and fifty metres, and only runs when the answer is none: drones,
  soldiers, jets and any machine that is not yours, all of them measured by
  having health left rather than by being on a list, because a body on its
  way down is already gone. A quarter speed for two and a fifth seconds,
  which is a shade faster than the slow motion a blast gets, because what
  you are watching is a body rather than a building. The checks kill one man
  three ways: alone with the switch on, with three of his friends up, and
  with the switch off, and read both the timer and what the world actually
  did with it.

## 29. A map you can read the streets on

- 2026-10-17: the enlarged map opened on two and a half kilometres of city,
  which on a canvas eleven hundred pixels wide is a diagram of a district
  rather than a map of a street. It now opens on seven hundred metres around
  you. The ceiling on the wheel went with it, and for a reason worth writing
  down: the zoom is a ratio against the whole city fitted to the canvas, and
  the city is forty six kilometres across rather than the twelve the old
  ceiling of fourteen was picked for, so the same number meant a district in
  one place and a street in another. Both the opening and the ceiling are
  written in metres across the canvas now, and the zoom is worked out from
  them against whatever canvas there is.

- 2026-10-17: and that opening is held as a span rather than converted to a
  zoom at the moment the map is opened, because at that moment the canvas is
  still its small size: the first run put the map at eighteen times the
  whole city, which on the enlarged canvas was twelve hundred metres across
  rather than seven hundred. The span survives until the wheel is touched.

- 2026-10-17: street names. They come off the `name` on each OSM way, one
  label every two hundred and forty metres along it with the angle of the
  piece it sits on, written by the builder into the district's own manifest
  and nowhere else: the district you are standing in is the one whose names
  you can read, and a city of eighty one districts pays nothing for the
  eighty it is not in. Mitte has a hundred and seventy three labels over
  sixty streets and the json grew by about six kilobytes. On the map they are
  drawn in screen pixels rather than in metres, turned to lie along the road
  and never upside down, main roads first, and a label is kept only if
  nothing has been written where it would go. Ten of the hundred and seventy
  three fit on the opening view, which is the point: a map that writes every
  name it has is a map with no names on it.

## 30. The city OpenStreetMap says it is

- 2026-10-17: building parts. A building that is more than a box is mapped as
  an outline plus a set of `building:part` pieces, each with its own height,
  and the outline is an envelope that is not meant to be drawn once the
  pieces are there. This drew both, so every tower in the city was the box
  around it. Now a piece claims its outline, by its middle falling inside it,
  and the outline is left out of the picture and out of the collision
  together, so a piece that is missing leaves a gap you can walk into rather
  than a tower inside a crate.

- 2026-10-17: `min_height` and `building:min_level`, so a volume can start
  above the street. The skirt that carries a wall below the ground is left
  off when it does, because a volume that starts ten metres up has no ground
  to meet and the skirt was a wall hanging in an archway, and the collision
  for it starts where the volume does, so you can walk under what you can see
  under.

- 2026-10-17: six more roof shapes: pyramidal and cone, skillion, mansard and
  gambrel, dome and onion, with half hipped going to the hip and saltbox to
  the gable. The pyramid and the single slope are cut from the footprint
  itself, so an L shaped shed keeps its shape; the mansard and the dome are
  built over the oriented box like the gable and the hip, and a footprint too
  far from a rectangle still falls back to flat, because a fake mansard on a
  complicated outline looks worse than no mansard. `roof:orientation` decides
  whether a ridge runs along the block or across it, which is the difference
  between a row of houses and one shed, and `roof:direction` says which way a
  single slope falls.

- 2026-10-17: the height on a building is to the top of its roof, which this
  had never honoured: the walls went to the full height and the roof sat on
  top of them, so every pitched building in Berlin was four metres too tall.
  The roof now comes out of the height, and nothing may be more than two
  fifths roof, because a `roof:height` taller than the building under it is
  somebody's typing mistake rather than a spire.

- 2026-10-17: and roofs have colours. Four of them, carried in the two bits
  above the palette index and chosen in the builder from `roof:material`
  first and `roof:colour` second: the dark tile most of the city is under,
  the red tile of the older blocks, grey slate, and copper gone green. Four
  because four is what you can tell apart from a street. A material that has
  a surface of its own in the shader, copper or zinc or glass, gets that
  instead.

- 2026-10-17: the offline city carries the same mix of tags, so the fallback
  extract exercises the same code the live one does: mansards on a fifth of
  the blocks, gables, hips, the odd single slope and pyramid, and roof
  materials on half of them. The whole lot costs eleven thousand triangles
  across eight districts, one and a half per cent, and two hundred kilobytes
  of the download budget.

## 31. Standing dead men, a hole in the world, and the cockpit

- 2026-10-17: the last kill never fired. It asked for nobody alive within a
  hundred and fifty metres, and in a live fight something is always alive
  somewhere in a circle that size, so the slow motion was a switch that did
  nothing. Sixty five metres is the piece of city you are actually in; the
  one you killed has to have been in it too, or a rocket across the district
  would do it; and there is five seconds between flourishes, because clearing
  a square one body at a time is a stutter rather than a flourish. The check
  now kills a man with three of his friends standing a street and a half
  away, which is the case that was reported.

- 2026-10-17: dead men standing. A soldier burnt to the bone stayed on his
  feet for the rest of the session, because the timer that takes a skeleton
  down shipped at nought, which means never. It ships at eighteen seconds
  now, and nought still means never for anybody who wants a field of them.

- 2026-10-17: and a skeleton is a thing you can shoot. It used to be out of
  the raycast with the rest of the dying, so bullets went through it: now a
  standing one is a target, a hit takes it apart into bone rather than flesh,
  and it credits nobody, because whoever that was died when the fire went
  through. Bones are their own burst: eleven pieces a point of scale, bigger
  and lighter than gibs, nothing wet about them.

- 2026-10-17: falling through the floor. Asked for the height of the ground
  on a tile that is not there, the world answered nought. Nought is sea
  level, and a district standing forty metres above it is then a forty metre
  hole with you at the bottom: that is the whole bug. It now answers with the
  nearest ground there is, searching a ring of tiles outwards, so the city
  ends in a plateau rather than in a pit. The check puts the neighbours on a
  forty metre hill, takes the tile in the middle away, and asks again.

- 2026-10-17: a mech walking over somebody puts him into the pavement. The
  foot is the hull's radius and a bit, anybody standing well above it is on
  something else, and what is left is a wide flat stain rather than a body.

- 2026-10-17: and the view out of a mech. Eight rays at head height: when
  nearly all of them are stopped within a few metres the machine is standing
  inside the building rather than against it, the cockpit would be the inside
  of a wall, and the shoulder view takes over until it is not. The pull in
  along the aim line only ever helped when the eye started outside.

- 2026-10-17: three keys. The number row past the end of a mech's loadout
  used to reach the pilot's own weapons, so six put a banana on the screen of
  something eight metres tall; now nothing on his back exists while he is in
  there. The cockpit view moved off V, which is the travel map everywhere
  else in the game and was unreachable from a cockpit, onto Y. And a mech
  runs on the pilot's clock rather than the world's, so the reflex is worth
  having in one: a machine slowed by exactly as much as everything around it
  is a reflex that does nothing at all.

- 2026-10-17: travelling takes your machine with you. Leaving a Titan on the
  other side of Berlin because you used the map is not travel.

## 32. Just a Walk, and a sphere of light

- 2026-10-17: a third mode. Nothing is sent after you, and the way it is done
  is worth writing down: the budgets are held at nought every step rather
  than the layers being switched off. A layer that is off does not update
  what is already in it, so anything the cheat menu brought out would freeze
  where it stood; a budget of nought means nothing new is sent and everything
  already here is a real enemy with a real fight in it, which is exactly what
  was asked for. It is remembered between visits.

- 2026-10-17: and nobody walks round a corner any more. A sphere of light
  stands on the street, a shell of sparks falling inwards rather than blowing
  outwards, which is the whole difference between something arriving and
  something exploding, with arcs off the pavement and a scorch mark under it.
  The soldier comes up through the street over a second: he starts one and
  nine tenths of a metre under it and is blind and harmless until he is on
  his feet, which is in the soldier layer rather than in the picture, so it
  is true for the fight as well as for the eye. The test handle that puts a
  man exactly where a check needs him skips all of it.

- 2026-10-17: two checks in the machines suite were measuring the city rather
  than the thing they are named after, and the rebuilt city is what showed it.
  The flamethrower check stood the player whereever the suite had left him,
  which by then was a heap of rubble three metres up, and the stream tests the
  height of what it lands on: it now puts him back down on the street first.
  The bite check blasted a frontage and counted the pixels of hole: a mansard
  leaves less sky behind it than a flat roof, so the bite is bigger now.

- 2026-10-17: and a mech you call has somewhere to stand. The spot search
  asked for seven metres clear on four sides, which in a street that has been
  shelled flat does not exist, and then answered no: the whole mech half of
  the suite failed on one call that found nowhere to put one. It now gives up
  the room a bit at a time, seven metres then four and a half then two and a
  half, and below that takes whatever loaded ground there is, because a
  machine standing with its shoulder in a wall is better than a machine you
  cannot call.

## 33. The people who live here

- 2026-10-17: passers by, in Just a Walk. They go in the soldier layer with a
  flag of their own rather than in a layer of their own, and that is the whole
  design decision: the walking, the wall sliding, the ground under them, the
  capsule you can hit, the dying, the ragdoll and the one instanced draw call
  are all there already and all of them are the same for a man on his way to
  work. What is his own comes to fifteen lines: somewhere to be, somewhere
  else to be when he gets there, and running away from a noise.

- 2026-10-17: a shot inside seventy metres, a blast heard three times its own
  radius, or anything arriving in a sphere of light sends them off for seven
  and a half seconds, straight away from where it came from, picked fresh each
  step so that turning a corner does not send them back into it. Measured:
  three of three within earshot bolted and all three were further away two
  seconds later.

- 2026-10-17: in the picture they are the same figure with the helmet and the
  rifle collapsed into it, the way the cloth collapses on a man who burns, and
  the cloth and boots recoloured out of a fraction carried in the one instance
  slot that was still spare. Four coats, picked per person, because a pavement
  of them in one colour is a squad.

- 2026-10-17: two checks elsewhere had to learn about them. Just a Walk counts
  what was sent after you, which is now everybody in the layer who is not a
  civilian; and the arrival check has to switch the layer on, because the
  second a soldier spends coming up out of the street is counted in the
  soldier update, which is where it belongs.

## 34. Relief, and what a frontage has left

- 2026-10-17: the first of the three graphics steps. A cornice under the eaves
  on every building over nine metres, and a band over the shop windows where
  the ground floor is a shop, both built in the builder as geometry. Two quads
  an edge: the face you see and the underside the sun never reaches, and the
  second one is the whole point, because what makes a frontage read as relief
  is the shadow line under a projecting band rather than the band itself.
  Edges under three and a half metres are skipped, since a Berlin block has a
  dozen jogs in its outline that nobody can see.

- 2026-10-17: it costs. Mitte went from a hundred and fifty thousand triangles
  to a hundred and eighty eight, and the download for the eight districts
  built here from 13.89 MB to 14.47 of the 25 MB budget. It is on in the
  middle tier only, which is where you walk.

- 2026-10-17: and the cheat menu will tell you what a frontage has left. The
  damage sits on a grid of cells about one block frontage across, which is the
  unit that comes down, so the honest answer to "how much more will that wall
  take" is the cell your shot would land in: seven hundred and twenty for a
  whole one, in four stages of a hundred and eighty. A ruin says so instead of
  giving a number.

- 2026-10-17: writing that switch turned up a worse one. The switches were
  listed in three places, and the last kill was in two of them: in the list
  the menu is built from and not in the constructor. `set` refuses an id it
  cannot find a boolean behind, so that row did nothing at all, and the switch
  only came alive after pressing all off once, which is what reset does. That
  is very probably the whole of what was reported as the slow motion not
  working. The constructor now builds every switch out of the one list, and a
  unit test flips every row in the menu on and off again.

## 35. What stands on the street

- 2026-10-18: the second of the three graphics steps, and the one that changes
  the middle distance most. Lamp posts every forty five metres down anything
  from a residential street upwards, alternating sides; cars at the kerb every
  twenty metres on the quieter classes, half the time; a bench or a bin every
  ninety five metres on the pedestrian and primary streets. All placed off the
  road centreline at a fixed step, with the kerb worked out from the width the
  map gives, and all keyed off the same integer hash as everything else, so two
  builds put the same lamp in the same place.

- 2026-10-18: Mitte went from 187,869 triangles to 263,051: 790 lamps, 1013
  cars and 72 seats and bins. The eight districts built here come to 15.88 MB
  gzipped of the 25 MB budget, and Mitte itself, which is what you download to
  play, is 4.40 MB.

- 2026-10-18: and nothing stands inside anything else. Streets cross, so the
  lamp one of them puts at its kerb lands on the car the other one parked
  there, and the first build had exactly that: a lamp post up through a car
  roof, found by looking at a screenshot of it. What goes down is now kept in
  a coarse grid with the trees seeded into it, and a piece that overlaps
  anything already there is dropped. That is 178 of them across Mitte: 92
  lamps, 78 cars and 8 seats.

- 2026-10-18: collision that matches what is drawn. A lamp is a square 0.30 m
  across, which is the mast; the first pass used 0.44, and a post twice the
  width of the thing you can see is something you bump into beside a lamp post
  rather than on it. A car is the real rectangle, 1.78 by 4.3, turned the way
  the car is turned: a square the width of a car leaves a metre and a half at
  each end that you walk straight through.

- 2026-10-18: the machines suite went to 36 of 54 on the back of this, and
  every one of the eighteen was downstream of two faults that the furniture
  only brought to the surface.

  The first was in the suite. The check that measures the chaingun stands a
  target somewhere the mech can see it, and it looked for that spot by sweeping
  a level ray and then refusing any ground more than three metres off the
  mech's own level. By the time that check runs the district has been shelled
  for ten minutes: eleven of its twenty four candidates were blocked and the
  other thirteen were over a hole, so it gave up, and it gave up silently,
  behind a skip that said nothing at all. It now sweeps five rings and
  seventeen bearings, and a shot down into a crater counts as a shot as long
  as the line is clear.

  Which took two goes to get right, and the second one is the interesting
  one. Sweeping muzzle to chest found a line and the gun still put forty eight
  rounds out of forty eight into the city: the guns do not point at the
  target, they converge on wherever the torso's own ray runs out, which in
  that street was a hundred and eighty metres past it, and from a muzzle two
  metres off the centre line that is a different line entirely. The search now
  turns the torso onto each candidate and asks the mech itself where the shot
  would go, through the same `muzzle`, `aimPoint` and `aimFrom` the gun uses.
  The same search is shared with the railgun check instead of being written
  twice.

  And the street is cleared first. A mech's round goes to the nearest thing on
  the line, and Rise of the Machines keeps a dozen walking at you: ten of them
  were standing between the gun and the target, so what the check measured was
  how long they lasted.

  The second was real. That skip left the player sitting in a mech, and the
  next check reset the mech layer under them: `state.inMech` went on pointing
  at a machine that was no longer in the world, so the key that gets you in
  got you out instead and every mech check after it failed. The layer now says
  so when it takes a mech out from under its pilot, and the frame loop puts a
  stranded pilot back on their feet in any case. `tools/test/mechs.test.mjs`
  holds the layer to it without a browser.

- 2026-10-18: and every skip in the mech half of the suite now says why. Three
  of them read `no room for one` whatever had actually happened, which is how a
  reset layer and a blocked firing line both came to look like a street with
  nowhere to park.

## 36. Surfaces with real maps

- 2026-10-18: the third graphics step, and the one that changes what the city
  is made of rather than what shape it is. Everything here has always been
  shaded procedurally, which gets the structure right: a road knows where its
  own centre line is, a pavement knows where its joints are, and both stay
  sharp at any angle because the pattern is widened to the pixel footprint
  rather than faded out by eye. What it cannot get is grain. A fractal noise
  run per pixel has no mip chain, so it has to be faded away as its features
  go sub pixel, and that is why the middle distance of this city went to flat
  colour at about thirty metres.

- 2026-10-18: so the grain is baked instead. `src/engine/surfaces.js` builds
  ten tiling maps when the page loads, out of the same kind of noise the
  shader used to run, and hands them to the card as one array texture with a
  mip chain and eight times anisotropy on it. The card then does the
  averaging, which is what a mip chain is for, and a road keeps its chippings
  out to the horizon. Nothing is downloaded: it is 2.6 MB of bytes computed in
  216 ms, which is a fifth of a second of the loading screen.

- 2026-10-18: what is in a layer is deliberately not an albedo. The colour of
  a wall comes from the palette and the colour of a road comes from the
  shader, so a map carries what the surface does to the light instead: the
  slope in two channels, a multiplier on the albedo in the third, and how
  buried the point is in its own relief in the fourth. Every one of them is
  worked out from a single height field per material, so a material is
  described once rather than three times over.

- 2026-10-18: the tiling is the whole trick, and it is the one thing that is
  easy to get silently wrong. The lattice coordinates wrap before they are
  hashed rather than after, so the cell at the right hand edge is the cell at
  the left hand one. `tools/test/surfaces.test.mjs` holds it to that by
  comparing the step across the join with the step anywhere else rather than
  by looking at the edge values, which is the test that fails loudly when the
  wrap goes.

- 2026-10-18: measured. No change in frame time on the software renderer the
  checks run on, 74 ms a frame against 73, which is within the noise; what it
  buys is not speed but the grain surviving distance. The first pass had the
  render on a frontage at seven cells across three metres, which is half metre
  blobs, and a Berlin block came out looking like it had damp rather than
  render on it. It is eighteen cells now.

## 37. The street you are standing in

- 2026-10-18: the name on the screen, under the crosshair. Faint while you
  walk, so it is never in the way of a shot, and up in the accent colour for
  four seconds whenever it changes, which is the moment anybody wants to read
  it. In a mech or a vehicle it reads off the machine rather than off you: the
  street under a Titan is the street it is standing in.

- 2026-10-18: the names already existed, and were useless for this. A map
  label is a point every two hundred and forty metres along a way, placed to
  be written across a map, so the nearest label to where you are standing is
  routinely on the next street over. The name now rides on the centreline as
  well, which costs 1.4 kB of manifest in Mitte, and the answer is measured to
  the centreline with half a carriageway and three and a half metres of
  pavement of slack, so standing on the kerb still counts and standing in the
  middle of a block counts as nowhere. A junction is a tie, and a tie goes to
  the wider road, because that is the name people use.

- 2026-10-18: looked up four times a second rather than every frame. It walks
  every named centreline in memory, and the answer cannot change between two
  frames of walking. `tools/test/street.test.mjs` holds the lookup to the real
  bundle: a point on a centreline is named by that street, a point forty
  metres off it is not, and a build whose centrelines carry no names at all
  fails rather than quietly showing nothing.

## 38. Where this goes next (planned, not built)

Written down before any of it is built, because the last plan that lived only
in a conversation was lost. Five asks, in the order they were made, with what
each one costs measured off the tree as it stands today.

### 38.1 The city outside Mitte reads as generic

What makes it generic is the tier table, not the data. Tier 2, which is most
of the ring, is built with `roofs: false` and `windows: false`, so every block
is a flat topped box with a flat colour on it. Tier 3 is the same with a
bigger `minArea`.

The important measurement: **windows cost nothing**. `tier.windows` sets one
flag bit on the vertex, `FACADE_FLAG.NO_WINDOWS`, and the whole window pattern
is a fragment shader that reads the building's own storey count. Turning them
on in tier 2 and 3 adds zero bytes to the download and zero triangles, and
costs only fragment work on buildings that are mostly far away and small on
the screen. That is the cheapest single change available anywhere in this
project.

Roofs are not free: `tier.roofs` builds real pitched geometry. Turning them on
across the ring would be measured before it was kept.

Beyond that, what makes a block read as Berlin rather than as a box is
silhouette variety that costs nothing per building: parapets, a chimney or two
off the same hash that places the street furniture, and a wider spread in the
palette. All of it is builder work on geometry that is already being emitted.

### 38.2 The Brandenburg Gate is not recognisable

It is twelve Doric columns, four cross walls, an entablature, an attic and a
quadriga of five blocks, all in one flat `MAT.SANDSTONE`. Three things are
missing, and none of them is expensive:

- The columns have no flutes. A flute is a shader pattern on a cylinder, not
  geometry.
- The attic is one plain box. The real one is a cornice, a set back block and
  a relief frieze: three boxes and a band instead of one box.
- The quadriga is four rectangles. Legs, necks and heads are a dozen more
  boxes on a model that is drawn once in the whole city.

The flanking pavilions, Haus Liebermann and Haus Sommer, are not there at all,
and they are what makes the square read as the square.

### 38.3 Craters you can shoot

Today only a blast of radius 55 m or more digs one, and the reason is in
`DEMO.craterFrom`: the ground base is a 12.5 m quad grid in Mitte and coarser
outside, so a six metre hole has no vertices inside it to move. It would be an
invisible trap rather than a crater.

Two ways out.

The cheap one is a **crater patch**: emit a bowl as its own little mesh and
draw it over the ground. It does not work on its own, because the flat base
grid is still there and pokes through.

The one that fits what this engine already does is to **re-mesh the ground of
a touched tile at fine resolution**. There is precedent: the memorial floor is
already built at 2.5 m inside the 12.5 m base, because its whole point is that
the ground rolls. And the machinery to replace vertices in a tile and
re-upload it is `src/game/bake.js`, which already does exactly that for a
collapse. A crater of ten metres at 1.5 m resolution is about 140 quads. The
cost is bounded by a cap on how many tiles may be re-meshed.

Seeing through is already handled and would stay handled: damaged tiles are
drawn a second time inside out, and there is a bedrock plane under everything.

### 38.4 Holes shot in a building, and a collapse when too much is gone

Damage already accumulates on a grid, `DEMO.cell` of 22 m, in four stages of
180, and a finished cell comes down. What the shader does with it is cut the
building back from the top. So a building loses its top quarter; it never
loses the middle of a wall.

A real hole is cheaper than it sounds, because the mechanism is already there.
`uScars` is a ring of sixteen blast marks, each a centre, a radius and a
severity, and the fragment shader already draws a ragged soot edge round each
one with noise. A hole is the same loop with a `discard` inside the ragged
edge. What you then see through it is the inside of the building, which the
inside out pass already draws.

So the work is: a hit list that outlives the sixteen scars, a smaller damage
cell so a frontage breaks in pieces rather than in one slab, the collision
segments opened where the hole is, which `DEMO.splitAt` already does for a
collapse, and the existing per cell accumulation to bring the whole thing down
when enough of it is gone.

### 38.5 Crossing a district is abrupt

`World.keepAround` already exists: it loads every built district within reach,
drops the ones past a distance, and caps how many are resident. **Nothing in
the game calls it.** The only caller in the tree is the districts test. The
game calls `enterOnly`, which deliberately unloads everything else and holds
you at a modal card while the bytes arrive.

So the streaming is written and switched off. What has to be decided is the
budget: the eight districts built here are 53.3 MB raw, Mitte alone 16.8 MB,
a ring district 3 to 8 MB. Two or three resident is a few tens of megabytes of
ArrayBuffer, and the tile manager already evicts GPU tiles by distance and
caps residency at 520.

## 39. The ring stops looking like boxes

- 2026-10-18: windows outside Mitte. Tier 2 is most of the ring and tier 3 is
  everything out past it, and both were built with `windows: false`, so every
  block was a blank wall with a parapet on it. The measurement that decided
  this: `tier.windows` sets one flag bit on the vertex, and the whole window
  pattern is a fragment shader that reads the building's own storey count. The
  eight districts built here come to 875,427 triangles and 15.88 MB gzipped
  with the windows off, and to 875,427 triangles and 15.88 MB with them on.
  Not approximately: the same two numbers. Frame time in a ring street came
  out at 58 ms a frame either way on the software renderer the checks run on.
  It had been off for years for no better reason than that it sounded
  expensive.

- 2026-10-18: which only works because the facade now fades. Every other
  pattern in this shader has been widened to the pixel footprint for years;
  the facade never was, and it is the one made of hard edged tests rather than
  smoothsteps, so it is the one that shimmers. Once a pixel covers a storey
  there is nothing left to draw but the mean, so it draws that instead: the
  wall, darkened by the share of it that is glass. That is what a mip chain
  would give, and it is what makes the window shader affordable five
  kilometres out, where a suburb is now a tone rather than a flicker.

- 2026-10-18: two silhouette ideas were built, measured and thrown away, which
  is the useful part of this entry.

  Chimney stacks and lift overruns on flat roofs. A stack is one box and
  twelve triangles, so it reads as the cheapest silhouette there is. On every
  building over ninety square metres it doubled a whole tier, 72,826
  triangles to 144,496. Tuned down to the big half of the big buildings it was
  still a quarter more, and a screenshot from the pavement showed none of it,
  because from a street you cannot see a roof. A second screenshot from roof
  height over Mitte showed almost none either, because tier 0 has real pitched
  roofs and there is hardly a flat one to stand a stack on. Removed.

  A parapet of a different height per building. The quads are emitted either
  way, so this one really did look free. It is not: thirteen different heights
  where there had been one cost a quarter of a megabyte across the city,
  because a column of identical numbers is what a compressor lives on. Half a
  metre on a twenty metre building is also under what anybody can see from the
  pavement. Removed, with the reason written where the next person will look.

- 2026-10-18: one reading in the middle of all that came out at 16.13 MB and
  893,777 triangles and could not be reproduced afterwards from the same
  sources; the two builds either side of it both give 875,427 and 15.88. It is
  recorded rather than explained.

## 40. The ceiling on a district comes off

- 2026-10-18: the brief's rule 6 asked for the download to stay under twenty
  five megabytes, and `tools/fit-city.mjs` enforced it per district: the code,
  the index and any one district had to come to less than that, or the deploy
  failed. It is lifted, at the author's word, on the grounds that what matters
  is whether the thing is playable rather than whether it is under a figure.

- 2026-10-18: worth writing down plainly, because it changes less than it
  sounds. The rule never bound anything. The heaviest district in the real
  city is 8.89 MB with the code beside it, a third of the ceiling, and the
  eight built here come to 4.69 MB to play. Nothing was ever held back by the
  number; what holds detail back is the triangle count and the wait, and both
  of those are still measured on every build.

- 2026-10-18: so the tools report instead of refusing. `fit-city` prints what
  a player waits for and takes `--budget=N` for anyone who wants a ceiling
  back, and then it does fail, because a limit nobody acts on is not a limit.
  `weigh-city` prints the table with no figure to compare against. The build's
  last line says what every district adds up to and points at `fit-city` for
  the number that decides playability. The deploy workflow reports rather than
  gates.

- 2026-10-18: what is still enforced, and should be: the performance budget.
  Under 65,000 triangles and under 170 draw calls in view, one draw call a
  tile, two shadow cascades, and a quality tier chosen from the measured
  median frame time over the first three seconds. That is the budget that was
  ever doing the work.

## 41. Roofs across the ring, and what the measurement said

- 2026-10-18: with the ceiling gone the obvious thing to spend on was roofs
  outside Mitte, which had been flat since the tiers were written. The tier
  table said why: a pitched roof is four more vertices per metre of frontage
  than a flat one.

- 2026-10-18: it is the other way round. A flat roof here is a cap plus a
  parapet, and a parapet is two triangles for every edge of the footprint,
  which on a Berlin block with a dozen jogs in its outline is a great many.
  Switching the roofs on across the ring and the outskirts took one district
  from 72,826 triangles to 66,958, and the whole city from 875,427 to 869,559
  and from 15.88 MB to 15.85. It gave the ring a skyline of red tile, slate
  and copper, and it made the city smaller doing it.

- 2026-10-18: so the thing that was being saved for by keeping the detail off
  was never being saved. Both of the switches turned on in this pass, windows
  and roofs, were off on an assumption about cost that nobody had measured,
  and neither of them costs anything. The comment that had it backwards is
  replaced with the figures.

## 42. The city streams, and the card is only for arriving

- 2026-10-18: crossing a district boundary was a modal card and a wait, and
  the reason was in one line of `main.js`: it called `world.enterOnly`, which
  loads the district you are entering and drops every other one. The world
  layer has had `keepAround` since the districts were written, which holds the
  one you are in, the ones within reach and nothing past a drop distance. The
  only caller in the tree was the districts test. The streaming was written
  and switched off.

- 2026-10-18: so it is switched on. A neighbour starts coming down when you
  are within nine hundred metres of its box, which at walking speed is a
  couple of minutes and far longer than the fetch; the drop distance is 2.6 km
  so that walking back and forth across a boundary cannot thrash; and what is
  held has a ceiling of 128 MB and six districts, because distance alone does
  not give one when a district is anything from three to seventeen megabytes.
  Measured walking east out of Mitte: the neighbour was in before the edge,
  no card, three districts and 26 MB held.

- 2026-10-18: the card is still there, and still needed. It is for arriving
  somewhere that is not in memory, which is now a fast travel or a link
  rather than a walk. What it no longer does is drop the rest of the city, so
  walking back the way you came finds the district you left still standing.

- 2026-10-18: two things the card had quietly owned had to move out of it.
  The damage you did to a district is restored where the bytes land, on
  `world.onDistrict`, rather than at the two places that used to wait for a
  fetch. And arriving in a new district is noticed by the streamer, which is
  what parks a set of vehicles around you: before this, walking into a
  district with the card gone left it with no jeep in it, and the districts
  suite caught it.

- 2026-10-18: three checks in that suite asserted the old behaviour and had to
  be rewritten rather than loosened, which is worth naming because two of them
  were measuring the wrong thing afterwards. "Only ever one district is in
  memory" is now "the district you are walking towards comes down before you
  reach it", with no card, and the one behind you is still there. The check
  that a flattened district is still flat when you come back to it was passing
  on the numbers and failing on its premise: it crossed to a neighbour and
  expected the bytes to be thrown away, and now they are not. It goes to the
  far side of the city and stands there, because loading a district is not
  leaving the one you are in.

- 2026-10-18: one check went red on the run after this and it was not the
  streaming. "A shot sends everybody within earshot running" reported nought
  of nought: a gunshot scares everybody inside seventy metres, and the check
  took whoever happened to be inside that at the moment it fired. Civilians
  spawn in a ring thirty to a hundred and twenty metres out and then walk an
  errand, so the chance that none of six is inside seventy is about one in
  eight. It had been a coin toss since it was written and it finally came up
  tails. Three of them are now stood in the open at known distances before
  the shot, which measures the thing the check is named after instead of the
  dice.

## 43. A hole shot in a frontage

- 2026-10-18: a shell that goes off against a wall now opens it. The whole of
  it is four lines in a loop the fragment shader was already running: `uScars`
  is a ring of sixteen blast marks, each a centre, a radius and a severity,
  and the shader already drew a ragged soot edge round every one of them with
  noise. A hole is a `discard` inside that same ragged edge, so the rim of the
  hole and the soot around it are the same shape, which is what makes it read
  as torn rather than as cut with a compass.

- 2026-10-18: two things had to be true for it to show at all, and both took a
  wrong attempt first.

  The inside out pass has to punch as well. It draws the tiles round a blast a
  second time with the faces reversed, so that a hole shows the inside of a
  building rather than the sky. Left out of the hole test, it draws the back
  of the very wall you just opened, across the hole, and the picture is of
  nothing having happened. That was the first screenshot.

  And the tiles have to be marked as scarred for that pass to run on them at
  all, which until now only a collapse asked for. Without it a hole is a hole
  onto black.

- 2026-10-18: the second attempt failed on a name. The fragment shader had a
  constant `FLAG_GROUND = 1u`, and bit 1 is the shop window storey at the
  bottom of a building; the street you walk on is bit 16. So "not the ground"
  read as "not the ground floor", and the test shot, which went into a
  shopfront, was the one thing excluded. The vertex shader carries a comment
  about exactly this trap at the collapse, written by whoever hit it last
  time. The constant is `FLAG_GROUND_FLOOR` now and the real one is beside it.

- 2026-10-18: measured rather than admired. The city suite draws the frame
  twice, once with the hole and once with the same scar set to nought and
  nothing else changed, and counts what moved: 2.31 m of hole, 40.5 per cent
  of the frame different between the two. If the discard never fired the two
  buffers would be identical.

- 2026-10-18: what this does not do, said plainly. The hole is in the picture
  only. The collision still has the wall whole, so you can see an enemy
  through a hole and your shot will stop in it, and you cannot climb through.
  The collision model is a segment with a base and a top, which can express a
  wall cut down and cannot express a wall with a hole in the middle of it and
  masonry above. Making the two agree needs the wall subdivided, which is the
  same piece of work small craters need in the ground, and it is the next one.

- 2026-10-18: and the hole lives as long as the sixteen most recent blast
  marks. It is the damage you have just done rather than a record. What is
  permanent is still the collapse: enough damage in a cell and the frontage
  comes down for good.

## 44. What a small crater would cost, measured before building it

- 2026-10-18: before writing any of 38.3, the two numbers that decide it.

  The collision height field is 33 samples across a 100 m tile, so **3.125 m**.
  The visible ground is a quad grid at **12.5 m** in Mitte and coarser
  outside. The collision is already four times finer than the picture. That
  is the whole of why `DEMO.craterFrom` refuses to dig anything under 55 m:
  a small crater would be a dip you can walk into and cannot see, which is
  the one class of bug this project refuses outright.

- 2026-10-18: so the fix is on the picture, not on the collision. The obvious
  version, build the ground finer everywhere, is out. Mitte's ground is
  already 210,000 vertices of the district's 600,000, a third of it, because
  ground quads do not share vertices. At 4 m it would be about two million.
  Not a budget question, a frame rate one.

- 2026-10-18: what is affordable is re-meshing the tiles a blast touches, and
  only those. One 100 m tile at 3.125 m is 1,024 quads against 64 today, so
  about two thousand triangles a tile; twenty damaged tiles is forty
  thousand, against the city's 870,000. The precedent is already in the
  builder, where the memorial floor is laid at 2.5 m inside the 12.5 m base
  because its whole point is that the ground rolls.

- 2026-10-18: the work that is left is not the arithmetic, it is the plumbing.
  A tile's vertices are a packed slice of the district's bytes and the tile
  manager uploads them as they come; replacing a tile's ground with sixteen
  times as many vertices means the manager has to accept a mesh that is not
  the one in the file. `src/game/bake.js` can rewrite vertices in place but
  cannot add any. That is the piece to build, and it is the same piece a
  hole in a wall needs before the collision can agree with it.

## 45. The street sign, the embassy, the Tiergarten, and a wood to walk into

- 2026-10-18: the street name moved to the top of the screen. It began under
  the crosshair, which is the one place in a shooter nothing should sit.

- 2026-10-18: the American embassy was reported missing three times and I
  agreed twice, on a bad measurement. `tallestNear(-7, 75, 18)` returns 0
  because the footprint is 60 m by 46 and its middle has no wall within 18 m
  of it: the walls are 23 m away in z and 30 in x. Asking at the wall gives
  **22 m**, which is its tagged height, at z 52 and at z 98. It was built all
  along. What was wrong was its position: Wikipedia gives 52 30 55 N,
  13 22 42 E and Structurae 52 30 55.12 N, 13 22 42.07 E, and the curated fact
  had it 34 m north and 51 m west of that. It now stands where the sources put
  it, and it has a card, so the game names it when you walk up to it.

- 2026-10-18: trees were growing inside the Holocaust memorial. Six of them.
  The mask the synthetic generator uses carries 1 for carriageway, 2 for park
  and lawn, 3 for water and 4 for a building and the ground kept clear around
  it, and the tree scatter refused only water. The stelae field is stamped 4,
  like a building. Trees now go on open ground and lawn only, which also took
  **429** trees out of walls and carriageways across the middle district.

- 2026-10-18: and the Tiergarten was a lawn with trees on it rather than a
  wood. Measured in the park, at its eastern edge and 300 m in, high quality
  under software rendering:

  | one throw per | trees a hectare | in the park | edge | 300 m in |
  | --- | --- | --- | --- | --- |
  | 380 m2 | 21 | 1317 | 112 ms | 144 ms |
  | 170 m2 | 59 | 3615 | 152 ms | 164 ms |
  | 130 m2 | 77 | 4705 | 179 ms | 182 ms |

  The middle one is a wood you walk into and costs a third of a frame over
  the lawn; the thickest is a sixth more again for a difference you cannot
  see from inside it. A lawn stays open, because the Platz der Republik in
  front of the Reichstag is grass and is meant to be. Trees are instanced at
  ten triangles each, so 3564 more of them cost 0.19 MB and no triangles.

## 46. Rubble comes off the wall you shot, not out of the sky

- 2026-10-18: reported as "when I shoot a building the pieces come from
  above". They did. A collapse stage put its chunks on the line the building
  broke at, which at the first stage is the roof, and a blast made no chunks
  at all: it marked the wall and left it. So the only pieces a fight produced
  fell past you from the roof of whatever you were standing next to.

- 2026-10-18: a hit now knocks spall out of the surface it hit. The same rays
  that find the walls near a blast throw pieces off them, along the normal,
  with the blast behind them. Measured against one rocket into a frontage:
  **0 chunks before, 18 after**, between 0.4 m and 2.7 m above the pavement
  with the median at 1.4 m, against an eye height of 1.7 m. They come out of
  the wall where the rocket went in.

- 2026-10-18: and a collapse stage now finds the faces inside its site rather
  than dropping rubble in a disc around the middle of it. A site is a damage
  cell about a Berlin block frontage across and its middle is usually in the
  road. Of the chunks a collapse made, **63 per cent** came down at the foot
  of a standing wall before, **95 per cent** after.

## 47. The ground you could not see in any district you streamed into

- 2026-10-18: found while photographing the Grosser Stern. Arrive in Ring 3-2
  and you stand on a grey plain: no ground, no streets, no park, with the
  skyline visible past it. The collision is there and you walk about on it;
  the picture is not.

- 2026-10-18: the tile manager marks a tile absent when it asks the world for
  it and the district has not landed yet, so that the uploader does not spend
  every frame queueing the same holes. It clears those marks in `onDistrict`,
  which the world calls when a district lands. `src/main.js` then assigned
  `world.onDistrict` again, to put the damage back, and the second assignment
  threw the first one away. Every district streamed in since 42 kept its tiles
  marked as not there, and the skyline never grew either.

- 2026-10-18: the world now keeps a list of listeners rather than one slot.
  The tile under the player at the Grosser Stern went from `absent: true,
  resident: false` to `resident: true`, and the park is a park.

## 48. Berlin west of Mitte: the avenue, the star and the column

- 2026-10-18: the Strasse des 17. Juni stopped at longitude 13.3650, which is
  the western edge of the middle district, so the avenue ended on a district
  line and there was no way to walk to the Grosser Stern. It is now laid
  straight between the two ends that are surveyed, 13.3762/52.51602 at Platz
  des 18. Maerz and 13.350117/52.514542 at the column, and carries on a
  kilometre west of the junction. The points between the ends sit on the line;
  the ones it had dropped south two and a half times too fast.

- 2026-10-18: the Grosser Stern is laid as two arcs of a 95 m ring rather than
  one closed way, because the line simplifier holds the first and last point
  of a way fixed and a way whose first point is its last simplifies to
  nothing. That is why the first attempt built no junction at all. The four
  other arms are there by name and by the quadrant each leaves in; their
  courses past the first few hundred metres are not surveyed here.

- 2026-10-18: the Siegessaeule is built: 66.9 m to the top of the Victoria by
  Structurae and the Bundestag's own note, the viewing platform at 50.66 and
  the figure 8.32 of the total. A square plinth in a ring of sixteen columns,
  three drums with gilded rings where they meet, the mosaic hall, and the
  Victoria. `tallestNear` at the junction returns **66.9**.

- 2026-10-18: gold is a new material. Copper is the same metal left to go
  green and the city already had it; this is the one that was kept, and it is
  what makes a column two kilometres down an avenue worth walking towards.

- 2026-10-18: and the surveyed facts are no longer Mitte's private property.
  A district outside the middle one lays down whatever of them falls in its
  box before it invents anything, and its lattice streets are cut where they
  would run through a park, the river or a landmark's clearance. Ring 3-2
  carries 9 surveyed streets, 1 named building and 1 green, and its invented
  blocks dropped from 2194 to 1234 because the Tiergarten is in the way now.

## 49. Cars you can shoot, and what a mech does to a row of limes

- 2026-10-18: a parked car was four boxes baked into a tile with a collision
  box beside it and nothing anywhere that said car. The builder now writes
  down where it put each one, three numbers each, 1017 of them in Mitte and
  about ten kilobytes of manifest, and the game keeps the list. A round or a
  blast looks up the list rather than the geometry.

- 2026-10-18: what is left of one is written back into the same bytes. The
  geometry is crushed to 42 per cent of its height and marked as rubble, which
  is dark and matt, and the collision box is cut to 72 cm: a burnt out shell
  you still walk round, not a mark on the tarmac. Measured, a car goes from
  **1.51 m standing to 0.72 m**. It is remembered per district, so a street
  you burnt is still burnt when you come back to it from the far side of
  Berlin.

- 2026-10-18: the blast is the ordinary one, 11 m and 120, so it hurts what is
  beside it, cuts the frontage behind it and reaches the next car along. The
  chain is queued rather than recursive: a row of cars going up one after the
  other was otherwise a thousand deep stack of explosions inside each other.

- 2026-10-18: the view out of a mech was reported as still blocked. It was not
  a building. The pilot's eye is at 6.3 m, and on Unter den Linden that is the
  middle of the crown of every lime in the row: the whole screen was leaves.
  A crown now opens up when the eye is inside it, which is a test on the
  height difference and the distance across the ground rather than on distance
  alone, so a man walking under the same tree still has a tree over him. And a
  machine that walks through a row of trees leaves no row of trees.

## 50. Five more arms for the Titan

- 2026-10-18: an 88 mm flak gun whose shell bursts beside what is in the air
  rather than on it, a power laser that goes through three bodies and sets
  what it cuts alight, a car bomb that turns the nearest parked car into the
  charge, a Stinger that locks an aircraft up and slows the world to a third
  while the missile runs it down, and an EMP bomb that stops everything with a
  motor in it for seven seconds inside 48 m. Ten arms now, so the number row
  runs 1 to 9 and nought.

- 2026-10-18: measured, every arm fires and takes a round out of its own
  magazine, the flak and the Stinger both bring a jet down from 200 m, the car
  bomb destroys the car it was aimed at from 29 m, and the Stinger's lock puts
  2.4 s of slow motion on the clock.

## 51. Jets in Just a Walk

- 2026-10-18: reported as spawning a section of soldiers in Just a Walk and
  then jets arriving. The budgets are held at nought at the top of the fixed
  step, but the threat level is raised from inside `combat.update`, which runs
  after it, and the jets' own update runs after that again. Killing what you
  spawned raised the tier, gave the jets a budget of two, and a flight took
  off before the next step could put the budget back. The tier now holds every
  budget at nought in Just a Walk rather than setting them.

## 52. Tiles the game can re-mesh

- 2026-10-18: section 44 ended by naming the piece that had to be built: a
  tile's vertices are a packed slice of the district's bytes and the tile
  manager uploads them as they come, so nothing could give a tile a mesh that
  was not the one in the file. `src/engine/world.js` now has `tileMesh(rec)`,
  which hands back either the file's slice or the tile's own buffer, and the
  uploader, the baker and the crusher all go through it. The collision and the
  trees stay where they were: they are read by their own offsets into the
  district's bytes and nothing about re-meshing touches them.

- 2026-10-18: `src/game/remesh.js` is the cutter. The triangles a blast
  reaches are split at their longest edge until that edge is short enough,
  each new vertex interpolated from the two it sits between so the material,
  the surface, the texture coordinates and the normal all carry over exactly,
  and the midpoint of an edge is shared between the two triangles that own it
  or the halves pull apart and leave a crack. Nothing here moves a vertex:
  displacing them is still the baker's job and the shader's, out of the same
  crater shape they always used.

- 2026-10-18: the first version tested the triangle's corners against the
  hole and missed the case that matters most, which is one long thin triangle
  lying right across the street with both its ends a hundred metres away. It
  tests boxes now, and prunes: a child that has fallen outside the worked
  area is kept whole, so a 100 m sliver is cut only where the hole is.

## 53. Craters small enough to be craters

- 2026-10-18: the floor was 55 m of blast, and the reason was never the look
  of it: the ground is a 12.5 m grid, a hole eight metres across had no
  vertices inside it, and the picture would have stayed flat while the
  collision dipped. With the ground cut finer where a blast lands, the floor
  is what the collision field can follow instead.

- 2026-10-18: measured, drawing the ground out of the tile buffers and
  comparing it with the height field you stand on, worst case across the hole:

  | blast | crater | depth | re-meshed | as it was |
  | --- | --- | --- | --- | --- |
  | 8 m | 4.5 m | 0.62 m | 0.15 m | 0.33 m |
  | 20 m | 4.5 m | 0.62 m | 0.15 m | 0.34 m |
  | 60 m | 12.6 m | 4.79 m | 0.37 m | 3.75 m |
  | 120 m | 25.2 m | 9.58 m | 0.19 m | 4.75 m |

  A warhead used to draw a hole four and three quarter metres away from the
  one you could walk into. The tile it lands in goes from 342 vertices to
  3469, which is 60 kB and about six thousand triangles against the city's
  850,000.

- 2026-10-18: so a rocket digs now, and the numbers that decide how deep are
  stated rather than guessed. A crater narrower than two ground samples is a
  dimple nothing can stand in, so there is a floor of 4.5 m on the radius. A
  bowl sampled every `step` metres is out by about `depth * (step / radius)`
  squared at its worst, so the depth is capped at `0.30 * (radius / step)`
  squared: 0.62 m for a rocket, and no cap at all by the time a warhead is
  digging twenty five metres across.

- 2026-10-18: 0.55 was the first value, which gave a rocket 1.14 m. It reads
  well and a fighter cannot take off over it, which the suite said before I
  did. Half a metre of dish nine metres across is a shell hole you can drive
  through, which is the one that stays.

- 2026-10-18: a hole in the road is its own site now, with `walls: false`, and
  it is kept apart from the sites that bring frontages down. The first version
  let the two merge, and since a crater site is at level one from the moment
  it opens, a frontage that merged with one went from standing to a heap in a
  single step. A car going up does not dig at all: it is a tank of petrol, and
  a shell hole under its own wreck left the burnt out shell standing in the
  air over one.

## 54. A hole in a wall you can shoot through

- 2026-10-18: the shader has punched a hole in a facade since 38.3, out of the
  ring of sixteen most recent blast marks. Nothing else knew about it. You
  could put a rocket through a shopfront, see the inside of the building
  through the hole, and still not be able to shoot or walk through what was
  visibly no longer there, and the mark went when the ring came round again.

- 2026-10-18: the hole is now cut out of the tile and out of the collision.
  The wall is subdivided to a quarter of the hole's radius and every piece
  whose middle is inside it is dropped, which is why the edge is ragged rather
  than a circle. A collision segment runs between two points and stands
  between a base and a top, which is exactly enough to say wall, then nothing,
  then wall again above it: the piece across the hole becomes a sill under it
  and a lintel over it, and the pieces either side are left whole.

- 2026-10-18: measured on a frontage on Unter den Linden. A wall 17.1 m away,
  one rocket, and the same line then reaches past eighty metres with nothing
  in it; a line out of the same eye angled up over the hole still stops at
  17.1 m; and `tallestNear` says 27.1 m of building is still standing. In the
  suite, which runs in streets it has already wrecked, the same thing is
  measured on the wall itself: a wall 0.4 m from the burst before, and nothing
  within 1.89 m of it after.

## 55. Bridges, because the river was a wall

- 2026-10-18: asked whether bridges work. They did not, and the way they did
  not is worse than a missing bridge. The quay wall that stops you walking
  into the Spree is drawn along the whole bank whether or not there is a
  street on top of it, so every street that crosses the water ended at the
  water. Measured on Unter den Linden going east: a ray at knee height is
  stopped **29 m** short of the Spreekanal, and walking it with the real
  controller gets you the same 29 m. Twelve surveyed streets cross the Spree
  or the Spreekanal in Mitte, which is twelve dead ends, and the Museum Island
  could not be reached on foot at all.

- 2026-10-18: the roadway itself was never the problem. The ribbon already
  runs across the water at street level, because the terrain says the ground
  is there. What was missing was the gap in the bank and everything that makes
  the crossing read as a bridge.

- 2026-10-18: a crossing is now found by walking each road a metre at a time
  against each water polygon and keeping the wet runs that have dry land on
  both sides and are under seventy metres long. Without the dry ends a quay
  road that runs inside the river polygon for two hundred metres counts as a
  bridge, and the first version put a parapet down the middle of the street it
  ran into: 19 crossings became 11 once both tests were in.

- 2026-10-18: the bank is cut into three metre pieces where it passes a
  crossing, and the pieces on the bridge are left out. Dropping whole ring
  edges instead was the first attempt and it is useless here: the Spreekanal
  is eight surveyed points, so one edge of its bank is a hundred and fifty
  metres of quay, and taking one out opens the river for the length of a
  street. The deck gets an edge beam and a parapet either side, with the
  collision to match, and a soffit so the river does not show daylight through
  the roadway.

- 2026-10-18: measured again on the same line. Nothing stops the ray now, and
  the walk crosses the canal and carries on into the far side. Mitte went from
  263,268 to 266,046 triangles for the eleven of them.

- 2026-10-18: and a thing found on the way, not fixed here: something 26 m
  tall stands across Unter den Linden at about x 1270, which is where the
  curated buildings put the Kronprinzenpalais. A building on the carriageway
  is a separate bug from the bridges and is written down rather than fixed in
  the same breath.

## 56. The map that shows the whole city, and the way back

- 2026-10-18: asked for a mode that shows the whole map, like the one free
  travel opens, with the wheel to zoom. The wheel has zoomed this map since 12b
  and the whole of Berlin has always been zoom one. What was missing was any
  way to get there: the map opens on a few hundred metres around you, which at
  1.18 a click is twenty eight turns of the wheel from the city.

- 2026-10-18: so the big map has the controls the targeting map has had since
  it was built, plus two of its own. In and out, **all of it**, which is the
  whole 45.8 by 37.5 km box, and **me**, which comes back onto the street you
  are standing in. The readout says how far out you are and how wide the
  window is: 1.0x and 101.6 km across at full fit, and metres when you are in
  among the streets.

- 2026-10-18: the window is wider than the city at full fit because the canvas
  is letterboxed and the fit is the smaller of the two ratios, so the whole
  box is on the screen in both directions. The number is the window's, not
  Berlin's, and it says `across` for that reason.

- 2026-10-18: and the thing that made the buttons useless before they were
  tested: a locked pointer belongs to the game and the canvas takes every
  click, so the controls were drawn and could not be pressed. Opening the map
  lets the pointer go, closing it takes it back.

- 2026-10-18: not done, and not for a technical reason. Laying a map service
  over it to compare was asked for in the same breath, and this project's
  rules say no runtime dependencies and nothing from a CDN: a tile from
  anybody's server at play time breaks that. The comparison that is available
  offline is the one the map already draws, which is our own geometry out of
  the OSM extract. Most of the grid is empty here because 73 of the 81
  districts are not built in this checkout and Overpass cannot be reached from
  this machine, not because the map is wrong.

## 57. The viaduct is a bridge, and there is an S-Bahn on it

- 2026-10-18: bridges over streets, not only over water. The Stadtbahn already
  ran on a brick viaduct 6 m up, and that viaduct was two unbroken faces from
  the pavement to the deck with collision to match: a 6.6 m wall across every
  street the railway crosses. Six surveyed streets cross it in Mitte.
  Measured on Friedrichstrasse: a ray at knee height is stopped **32 m** short
  of the crossing, by a wall 6.3 m tall.

- 2026-10-18: a Berlin viaduct is a row of arches. It is built bay by bay now:
  nine metres from pier to pier, three of that pier, and between them an
  opening that curves from three metres up to a crown at nearly five. The wall
  above the arch is drawn in columns from the curve to the deck, so everything
  over the opening is brick and the opening is the shape of an arch; the first
  attempt drew a straight band with the curve hung under it and from the
  street that read as a row of teeth. The collision is the same three pieces:
  pier, nothing, and the wall above the springing, which is exactly what a
  segment with its own base and top can say.

- 2026-10-18: Friedrichstrasse now runs under it, and a shot at deck height
  still stops in brick. 263,268 to 278,942 triangles for the arches across
  Mitte.

- 2026-10-18: and then an S-Bahn on it, because a city with a railway through
  the middle of it should have something on the railway. Three carriages nose
  to tail, seventeen metres each, running at sixty kilometres an hour along
  the line the builder now writes into the manifest, at the height of the
  deck. Red below the waist and ochre above it, which is the paint Berlin has
  used since the twenties. It is scenery with a timetable: nothing shoots it
  and nothing rides it.

- 2026-10-18: drawn through the vehicle pipeline, which already takes a mesh
  and a list of positions, so a carriage costs an instance rather than a draw
  call. The one thing that had to change there is that the vehicles all shared
  one ceiling of eight instances and the carriages wanted their own.

- 2026-10-18: the train runs whether or not you are near it and is only drawn
  when you are. Stepping it only when it was near froze it the moment it ran
  out past the edge of that circle, which is to say for good.

## 58. Two builds of every district, and a flight over the coarse one

- 2026-10-18: the question was whether a district could carry two tiers, a
  fine one to walk in and a coarse one for a fast travel flight to pass over,
  and what to do where the two meet. The answer to the second half is that
  they never meet: the tier is chosen by what the player is doing, not by how
  far away something is. Walking, everything within reach is the district's
  own build. Flying, everything new is the overflight build. The two moments
  the choice changes are the take off and the landing, which is where the
  camera is already four hundred metres up and moving.

- 2026-10-18: what the flight looks like today, measured before changing
  anything. Mitte to Steglitz, sampled every half second: from 4.5 s to 6.5 s
  of an eleven second flight the camera is over districts with nothing drawn
  at all, `visible: 0`, `tris: 0`. That is the local city, where seventy
  three of eighty one districts have no extract. The deployed one is worse in
  a different way: every district is built, so the streamer tries to pull the
  fine city at four hundred metres a second. A district is in reach for about
  six seconds and weighs between three and fourteen megabytes gzipped.

- 2026-10-18: so every district inside the ring is built twice. The second
  build is a tier of its own rather than the sketch tier the outskirts use,
  and the difference is the minimum area. The sketch tier drops everything
  under 600 m2, which kept eighteen per cent of the buildings in the three
  districts this was measured on, and a city with one house in five reads as
  a bombed one from the air rather than a coarse one. The overflight tier
  keeps everything over 250 m2 and makes all of it the box that fits it.

- 2026-10-18: two things were switched off in it and had to go back on,
  because both are cheaper on than off and this tree has measured each of
  them before. A flat roof is a cap plus a parapet and a parapet is two
  triangles an edge, so `roofs: false` made i24 larger than its own fine
  build, 8.76 MB against 8.06. A window is one flag bit on a vertex and a
  fragment shader, so `windows: false` saves nothing at all.

- 2026-10-18: what it costs, gzipped, own build against overflight build:
  Mitte 4.76 to 1.57 MB, Ring 4-1 2.46 to 1.94, Ring 3-2 0.81 to 0.46, and
  Steglitz 2.86 to 2.85. The last one decided where the second build stops.
  Out past the ring two thirds of what a district weighs is building walls,
  the overflight tier keeps the same walls, and the saving disappears. Tier 3
  and tier 4 fly over themselves.

- 2026-10-18: these are numbers from the synthetic city, because Overpass is
  not reachable from this container, and they understate the case. The real
  ring districts are two to four times heavier than their synthetic stand
  ins, and the overflight tier's minimum area bites hardest where there are
  many small buildings, which is exactly what the synthetic generator does
  not make. The deploy prints the real table.

- 2026-10-18: the runtime change is small, because the tile manager already
  took each tile's mesh through `tileMesh(rec)`, which was written so a
  crater could give a tile its own buffer. A variant is a second pair of
  files on the same index entry; `loadDistrict` picks the pair and nothing
  downstream knows the difference, because both builds carry the same global
  tile indices and each carries its own height field size.

- 2026-10-18: the variant only decides what a fresh fetch asks for. A
  district already in memory is handed back as it is, because swapping one
  underneath a player who can see it buys nothing and costs a fetch. The
  invariant that replaces it is at the other end: the moment a flight lands,
  every district held at the overflight tier is dropped. So nothing a walker
  can reach is ever the coarse build, and no two districts you can walk
  between are at different tiers.

- 2026-10-18: in the air the streamer looks up the line of the flight rather
  than in a circle, centred fourteen hundred metres ahead of the camera and
  never past the far end, with a reach of eighteen hundred metres and a tick
  four times a second. A circle of nine hundred metres at four hundred metres
  a second gives a district two seconds of warning and spends half of its
  budget on ground that is already behind.

- 2026-10-18: one defect this turned up that the probe nearly hid. Flying
  over a district that is not in memory used to call `crossInto`, which is
  the loading card. It never fired locally because the districts under that
  flight are unbuilt and the card refuses those by name; on the deployed city
  every one of them is built and a flight across Berlin would have raised the
  card over and over. A flight is now never interrupted by it: what has to be
  stood on is the far end, and that is asked for at the fine tier before the
  take off.

- 2026-10-18: measured after, Mitte to Ring 1-2, five kilometres: nought
  frames of card, the corridor arriving as `c2r1.lo`, `c3r0.lo`, `c0r0.lo`,
  ground drawn under the camera over every district that is built, 36.3 MB
  held at the peak against a ceiling of 128, and nothing coarse left in
  memory one second after landing.

- 2026-10-18: and the screenshot said the work was not finished. The corridor
  came down, the checks were green, and the picture was a green island in
  grey nothing. The overflight bundle was not the problem: the district held
  over Ring 3-2 carried 25,450 triangles and 196 tiles with something over
  six metres on them. The uploader was. Tiles come up within nine hundred
  metres of the camera, which is a street; from four hundred metres up,
  looking down at seventy five degrees, it is a disc of 1.8 km with the rest
  of the view empty. So the tile radius goes to 2.8 km while a flight is
  running and back to nine hundred when it lands, and the corridor's reach
  goes to 2.9 km so that no tile comes up without a district behind it. The
  same shot after that is the Grosser Stern with its avenues going out of it
  and the streets of the next district beyond.

## 59. The Reichstag, Pariser Platz, and a collapse that smeared

- 2026-10-19: a screenshot from the live site, in front of the Reichstag
  after six rockets: two enormous crumpled sheets where the building had
  been, one of them the glass of the dome. Measured on a full collapse of the
  Reichstag, 1,409 vertices moved and 821 of them fell more than thirty
  metres. The sideways throw was a median 5.2 m, 15.4 m at its worst, and
  350 vertices went more than eight metres. A falling vertex is thrown out by
  a share of how far it fell, with its own hash, so for a house the corners
  of one triangle land a couple of metres apart and it reads as rubble, and
  for a dome 47 m up they land fifteen apart and the triangle is a sail. The
  throw now stops growing past ten metres of fall, in `src/game/bake.js` and
  in the shader together: median 1.7 m, worst 4.1, none over eight. A house
  that falls less than ten metres is thrown exactly as far as before. The
  city suite compares the two number for number and passes.

- 2026-10-19: the Reichstag itself was wrong, measured against the
  Bundestag's own figures and Structurae: the roof terrace is 24 m up and the
  top of the dome is 47 m, the dome being 23.5 m tall and about 38 across.
  The model was a 30 m block with the dome on top of that, so the glass
  stood at 54.5 m. The corner towers carried pyramid spires, which they lost
  in Baumgarten's rebuild of the sixties. The pediment over the portico was a
  26 m square pyramid standing ten metres out past the columns; it is a gable
  now, through a new `pediment` primitive. The mirrored cone inside the dome
  was drawn the wrong way up.

- 2026-10-19: Pariser Platz. The Akademie der Kuenste stood on the north side
  of the square, opposite the DZ Bank; it is on the south side, beside it.
  The square's own list, Baedeker's 1928 guide and Baunetz all say so, and
  the bank's neighbour note says its east wall is the Akademie's west wall,
  which is where it now stands. What could not be checked from here: the
  square's own extent, which starts 28 m east of the Gate's face; the Adlon,
  whose centre lies north of the square's south edge; and the north side,
  which has no French embassy, Eugen-Gutmann-Haus, Palais am Pariser Platz
  or Haus Liebermann in the facts at all. Those need a map, and Overpass and
  Wikipedia are both closed to this container.

- 2026-10-19: none of the Pariser Platz part reaches the live site. The
  deployed city is built from the Overpass extract, and `annotate.mjs` leaves
  any fact whose kind is `block` or `courtyard` alone, so the Adlon, the DZ
  Bank, the Akademie and the US embassy there are OpenStreetMap's own
  footprints. The facts table shapes the offline city. The Reichstag and the
  Gate are different: those are bespoke models and are drawn on the live
  site, so the Reichstag change is the one you will see.

- 2026-10-19: the same screenshot had a whole building, windows and shop
  band and all, hanging in the air behind the ruin. It has not been
  reproduced. Across the full collapse above not one vertex went up, so it
  is not the collapse lifting anything, and a rocket's hole in a wall is
  capped at three metres, so it is not the hole either. The view was looking
  south east from the Reichstag's west front; a link from the game with the
  building in the middle of the frame is what this needs next.

## 60. Chunks from the sky, craters that are craters, overkill and the void cannon

- 2026-10-19: chunks falling out of the sky. Measured at the moment each
  piece of rubble appears, against what is standing within four metres of
  it, over eight frontages in Mitte hit with four rockets a face: 22 of 53
  pieces started more than two metres above anything there, the worst 13.1
  m. A stage of a collapse put its rubble at the break line of the whole
  site, which for a site spanning a tall and a low building is the tall
  one's break line over the low one's roof. Each face now drops its share
  from its own height (`tallestNear` round that face), and a face with
  nothing standing on it drops nothing. Same measurement after: 0 of 68,
  worst 0.0 m.

- 2026-10-19: craters were not craters. A crater was a shader displacement
  with a collision field sampled on a coarse grid, and the second rocket into
  the same spot cut the ground triangles out along with the wall, so on one
  street 45 of 1,421 samples across a crater had no ground drawn at all, and
  you could see out of the bottom of the map. Craters are now analytic: one
  profile in `src/shared/crater.js`, a bowl with a lip, which the collision
  adds to the ground height and the remesh follows. The ground round a
  crater is cut finer the deeper the bowl is, so the middle of a small one
  is not a metre shallower in the picture than under your feet. And a hole
  in a wall only ever takes frontage: ground and roofs stay. After: 0 holes
  in 1,421 samples, the drawn ground within 0.10 m of the collision
  everywhere, the deepest bowl 2.39 m, and standing in the middle of it puts
  you 2.83 m down on ground that is drawn 2.92 m down.

- 2026-10-19: a crater leaves the ground burnt rather than holed. The bake
  writes how burnt each ground vertex is into the spare byte of the vertex
  (byte 16, which on the ground was unused), falling off from the middle of
  the bowl to one and a half radii, and the shader darkens it into a ragged
  black patch with two octaves of noise on its edge.

- 2026-10-19: the cheat menu spawns machines (six, the same one line the
  end of the world mode uses to make one out of a soldier) and passers by
  (eight, within sixty metres). Spawning passers by after machines turned up
  a real bug: the soldier pool reuses its objects and the machine flag was
  never cleared, so six of the eight passers by came out in steel with a
  red eye. The reset clears it now, with the stun and the beam charge.

- 2026-10-19: Overkill, past the top of the gore menu. Every kill comes
  apart whatever else is switched on; the skeleton leaves the body the way
  the round was going; a second burst goes straight up and rains down; a
  fountain stands where they were for nearly three seconds; every wall
  within nine metres is sprayed; the clock stops for half a second while a
  word is stamped across the screen, with a run counter for kills inside
  three seconds and a sting under it. The pools were made bigger for it
  (256 pieces, 2048 sparks, 1536 drawn a pass) rather than letting a bigger
  multiplier run into the old ceiling. The words are our own; the idea is
  the fighting games'.

- 2026-10-19: the void cannon. A slow green ball, after the oldest joke in
  the arena shooters, under a name of its own: it reaches out to everybody
  within sixteen metres of its path as it goes, and where it lands a tendril
  goes to everybody within forty eight metres that a wall does not hide. It
  cuts a hole nine metres in radius into whatever it meets, in the buffers
  and in the collision. The first version also handed the building grid its
  full 700, which brought the whole block down on top of the hole; the grid
  now gets a heavy rocket's worth, and the hole is the point. Measured on a
  frontage seen square on: a rocket opens 16 rays of a one metre grid, 4 m
  across; the ball opens 104, 11 m across, which is the whole width that
  wall had to give. You take eight per cent of it yourself.

## 61. A fighter you can fly, and vehicles that look like vehicles

- 2026-10-19: "the fighter cannot be steered". Three reasons, all in the
  controls rather than in the flight model. The mouse was a rate: the
  camera's pitch went into the stick, so looking up once kept the nose
  climbing until it hit its stop, and only looking exactly at the horizon
  stopped it. A and D turned the aircraft the opposite way to the one they
  named in the air, and the bank was the wrong way round as well: under the
  shader's rotZ a positive roll lifts the right wing, and the old stick
  leaned right while it turned left. And the throttle was a spring, so
  letting go of W took a fighter from cruise to its stall in about two
  seconds. Both aircraft now fly where you look: the hull turns its nose
  onto the view as fast as the airframe allows (0.7 rad/s for the fighter,
  scaled down below one and a half times its stall, 1.3 for the
  helicopter), banks into the turn by itself, and A and D turn the view, so
  the keys alone fly it too. The fighter's throttle is a lever that stays
  where you leave it. The city suite flies one off the menu: 0 degrees off
  after a 69 degree turn left and after a 138 degree turn right, a bank of
  plus and minus 1.05 the right way round, no height lost looking at the
  horizon, and D turns it right.

- 2026-10-19: "the vehicle designs are extremely bad". They were: every one
  of them was painted in the drone's near black, the wheels on the jeep and
  the tank were cylinders about a vertical axis, which is a wheel lying flat
  on the road, and the helicopter's rotor turned about the drone's four
  hubs, which put a wobble in it. `MeshBuild` has an x axis now and a
  `plate` for wings, fins and sloped armour; the palette has olive drab,
  rubber, fighter grey, the gunship's green, headlights, an afterburner and
  hubs. The jeep is a four by four built round its wheels, with arches, a
  raked windscreen, seats, a roll bar and a gun on a post. The tank has
  tracks with six road wheels, an idler and a sprocket a side, skirts, a
  sloped glacis, a turret with angled cheeks and a bustle, and a long gun
  with an evacuator. The helicopter is a gunship with a stepped canopy, stub
  wings and pods, a tapering tail, four blades turning about the mast and a
  tail rotor turning about its own hub. The fighter tapers to a nose, has a
  cranked delta, two canted fins, missiles, and wheels that fold away more
  than 25 m up. Where each one stands was changed with it: the helicopter
  stands on its skids and the fighter's middle is 1.9 m over the road.

## 62. Ten mechs, yours and theirs, and what OpenStreetMap does to a landmark

- 2026-10-19: ten chassis, each a row in `src/game/chassis.js` and a shape
  in `src/render/mechmeshes.js`: Warden (the one the game had), Bruin,
  Heron, Lynx, Bastion, Hornet, Colossus, Mantis, Ram and Wraith. A row is
  size, hip height, gait, speed, turn, armour, shield, jump, dash, landing,
  the two muzzles and the arm weapon it arrives holding, and the mech table
  makes two specs out of each, yours over the Titan's numbers and theirs
  over the Reaper's, so the first chassis is still the Titan and the Reaper
  under the names everything already asks for. The names and shapes are
  ours; a brawler, a marksman, a raptor, a spider and a fortress are the
  genre's.

- 2026-10-19: the mech shader took its hip line as a constant, 4.2 m. It is
  a uniform now, set per chassis with the gait, because a raptor's hips are
  at 3.6 and a colossus' at 5.4, and the spider walks its diagonals together
  with each leg swinging about its own root. The rule the mesh has to keep
  for that is checked for every chassis in the unit tests: no triangle
  across the hip line, no leg triangle across the middle, every triangle
  wound outwards, and a barrel within sixty centimetres of each muzzle. The
  first run of it found four of the ten with a shield, a knee or a gun
  reaching under the hips.

- 2026-10-19: yours wear the chassis' colour, theirs all wear gunmetal with
  red trim, chosen in the shader from the same instance number that already
  turned the core blue. The cheat menu has a row of chips for each side;
  theirs has Random, a new throw for every one that arrives, from the menu
  and in Rise of the Machines. The choice is kept with the cheats but is not
  one: it does not mark the run, and all off leaves it alone.

- 2026-10-19: the live Reichstag, from the link at -114.2, -176.1. The live
  city is built from OpenStreetMap, where the local one is synthetic, and
  the build skipped any outline with building:part pieces in it before it
  asked whether the outline was a landmark. If OpenStreetMap maps the
  Reichstag as an outline with pieces, which large buildings usually are,
  the live site drew those pieces and never the model built from the
  Bundestag's own figures. The landmark is now asked about first, and every
  piece inside it and the envelope round it are left to the model. The
  floating building is very likely the other half of the same rule: pieces
  that start at fifteen or twenty metres with nothing mapped under them,
  drawn without the outline that would have held them up, with a shop band
  at their foot. Such an outline is now built as the podium up to where its
  lowest raised piece starts, and a volume that starts above the street
  gets no shop band. The live site is closed to this container (the proxy
  refuses github.io, and Overpass), so this is reasoned from the code and
  the tagging scheme and checked with unit tests on made up pieces, not
  seen on the real data; the next build of the live city is the check.

- 2026-10-19: two checks failed once each and passed when run again. The
  EMP launcher check picked its target group by a clear line to the group
  but fired at the road short of it, so something on that second line could
  set the pulse off seven metres out; the group is now chosen by the line
  the rocket actually flies. The helicopter climb check read 0 m once in
  three city runs and 36 m in six runs of the same steps on their own; the
  cause is not found, and the check now says what you were sitting in when
  it fails, which is the next thing to know.

## 63. The viaduct on the real city

- 2026-10-19: the branch's browser check against the live city had been red
  for four pushes on two viaduct checks, which pass on the synthetic city
  every time. Both were written for the synthetic city. The first stood at
  x 637, z -422, which is Friedrichstrasse under the Stadtbahn there and
  something else in OpenStreetMap's Berlin; the second ran a train on the
  first railway in the list and wanted exactly three carriages, and the
  real city has seventy six railway lines and thirty three carriages.

- 2026-10-19: under the checks were three real faults. The viaduct's piers
  stood every nine metres whatever was under them, so a street got under
  the railway only when it happened to meet an arch; piers now give way
  where a street crosses, with a lintel from the crown of the arches up,
  4.9 m clear. Each bay drew only the first half of its pier, which left a
  slot a metre and a half wide from the pavement to the deck at the end of
  every bay; both halves are drawn now. And OpenStreetMap maps a railway as
  many short ways, each of which was a line with its own train, so the
  Stadtbahn was eleven trains shuttling up and down a hundred and fifty
  metres each; ways that meet end to end and go on in the same direction
  are joined into one line. Railways in a tunnel or under cover, which were
  built as viaducts standing in the street over them, are left out.

- 2026-10-19: the checks find the crossings in the map instead: every place
  a road crosses a railway on a viaduct, up to twelve, each walked through
  at head height and shot at deck height, and a failure names the street
  and how far in it was stopped. The train is run up to a crossing on the
  line that passes it.

- 2026-10-20: the first run on the real city after that: the train check
  passed (24 carriages on 12 lines, the longest 3.9 km), the deck check
  passed at all twelve crossings, and nine of twelve streets went under.
  The three that did not, Friedrichstrasse, Reinhardtstrasse and
  Unterbaumstrasse, were stopped eleven to thirteen metres short of the
  railway they were checked against, by viaduct brick 1.5 to 7.7 m long:
  the pier of the next track along. The piers were cleared by where each
  street crossed each face, and that misses a face whose railway way ends
  or bends at the street, which OpenStreetMap does at every bridge. A pier
  now asks the streets themselves, through an index of every street
  segment with half its width and its pavement, whether it would stand in
  one, so how the railway was cut no longer matters.

## 64. The Brandenburg Gate was open underneath

- 2026-10-20: a screenshot from under the Gate on the live site: the
  entablature and the plates on the column heads hanging as bent sheets in
  the sky. `box` in `tools/geometry.mjs` built five faces, never the
  bottom one, which nothing on the ground shows and everything in the air
  shows from below: the Gate's entablature, its attic, the abacus on every
  column, the quadriga's plinth, the lamp arms. From the carriageway what
  was left was the near side of each with its far side culled. A box has an
  underside now; the stelae and the parked cars, which stand on the ground
  and are most of the boxes in the city, ask not to have one, so the middle
  district went from 280,404 triangles to 284,296 rather than to 297,854.

## 65. Ultra plasma

- 2026-10-20: asked for a super weapon that fills the ground with the
  plasma rifle's balls from space, with the number of balls (no limit,
  preferably a slider), the angle (shown on the map) and the radius set
  before firing, and the system heard charging after it fires.
- `src/game/ultra.js` holds the numbers and the sequence: charge for 4.2 s,
  then a stream of balls over a uniform disc, launched 420 m above their
  landing point back along the chosen direction, at 120 m/s. The count has
  no ceiling because it is a counter, not a list; what is bounded is how
  many are in the air (480, the size of their own instance buffer), and the
  rate ramps from 30 to 140 a second over six seconds so the start reads as
  a rain and not a wall.
- Each ball is an ordinary projectile of a new kind, `ultra`, built like
  the rifle's bolt: almost no gravity, two bounces, then it goes off. Its
  splash does 80, under the 90 at which a blast cuts its hole into the wall
  it is against, because a hundred re-meshes a second is no frame rate, and
  only one blast in twelve plays the explosion sound.
- The map grows a panel with four rows: count (range to 3000 plus a number
  box that takes anything), radius 20 to 1200 m, bearing 0 to 359, angle
  off the vertical 0 to 75. The minimap's aim draws an arrow from the side
  they come from, its length growing with the angle. The confirmation
  states all four and the charge time.
- First screenshot from the street: the balls were white dots and read as
  snow. The bolt's emissive was 7 times a cyan, which clips to white; it is
  3.2 times now, which stays cyan, and the ultra ball carries a 7 m tapered
  streak behind it and is drawn pointing along its velocity.
- The charge sound first fed its tremolo straight into the voices' gain at
  0.5, which swings far past the voices' own 0.12 and inverts them; the
  tremolo now works on a stage of its own at 0.65 plus or minus 0.35.
- `tools/test-cheats.mjs` opens it from the menu, drags the sliders, types
  4321 into the box, checks the aim and the question, fires 260, and
  checks: nothing comes down while it charges, it will not fire twice, all
  260 come down, nine in ten first touch inside the circle (the rest hit a
  roof on the near side, which at 40 degrees is up to 25 m out), they come
  from the bearing at the angle set, and never more than 480 fly at once.
  Screenshots: `cheat-05-ultra-map.png`, `cheat-06-ultra-rain.png`.

## 67. A mech's reactor

- 2026-10-20: asked for mechs to go up like a small atomic bomb, since they
  carry a fusion reactor, in blue and neon green.
- A mech killed now gives a small blast and a shower of parts at once, so the
  kill reads as a kill, and puts its reactor on a fuse: 2.6 s for theirs, 5 s
  for yours, during which blue sparks come out of the wreck faster and faster
  and the charge chord from ultra plasma rises over the last two seconds.
  Then a fusion blast where the wreck lies: radius 46 m, damage 1100, burst
  7 m up, a crater, fire, and ground that burns for 18 s. It goes through the
  same blast path as everything else, so the next machine in reach takes it
  and, if it dies, goes critical in turn.
- `effects.fusion` is the warhead's ring, stem and cap plus a sphere of
  sparks thrown out evenly, coloured electric blue at the bottom and neon
  green at the top and edges. The first colours were bright, and additive
  billboards that overlap a few times clip to white: on screen it was mint.
  They are kept dark and saturated now and the overlap does the brightening.
- The post pass takes the colour a flash washes the frame to as a uniform:
  white for a warhead, a cyan green for a reactor.
- Pending reactors live on `mechs.reactors`, so clearing the street clears
  them: the first run of the machine suite had a reactor from one check go
  up in the middle of the next and kill a man nine metres from a mech.
- `tools/test-machines.mjs` kills a Reaper with another 20 m away: the
  reactor is pending and nothing is touched halfway through the fuse, the
  flash is tinted green, not white, and the neighbour loses over 900.
  Screenshots: `mech-fusion-01-breach.png`, `mech-fusion-02-column.png`.

## 68. Every chassis its own weapons

- 2026-10-20: asked whether all the mechs have the same weapons, and why,
  since they should all be different. They did: each chassis arrived holding
  a different arm weapon, but yours carried the whole table of ten whatever
  the body, and all ten of theirs fired the Reaper's chaingun and rocket pod
  with a few numbers changed on two of them.
- A chassis row now has a `loadout`, two or three arms with its signature
  one first, and no two rows carry the same set; the mech's `m.arm` is an
  index into its own loadout, the magazines are per loadout slot, and the
  cockpit rows, the number keys and the key hint are built from it.
- A chassis row also has a `gun`, laid over the Reaper's chaingun for
  theirs, whose `kind` decides how it leaves the barrel: auto, shotgun,
  rail, shell, swarm, thermite or laser, seven kinds across the ten. The
  game layer's `FOE_FIRE` turns each into rounds, a lance, shells, small
  rockets or canisters, through the same raycasts and blasts as yours.
- The cheat menu says what each one carries, yours and theirs.
- `tools/test-machines.mjs`: the Warden carries chaingun, cannon and EMP
  bomb; 2 picks the cannon, the wheel goes on to the EMP bomb; every arm of
  every chassis fires (27 of 27) and the ten sets are all different; theirs
  fire seven kinds of gun between them and every one of the ten hurt the
  player from 34 m in twelve seconds. The railgun and thermite checks give
  the Warden the whole table for their length, since what they measure is
  the arm and not the chassis.

## 66. Destruction that looks less wrong, first pass

- 2026-10-20: "the destruction looks better but still not realistic".
  Screenshots of a 30 m blast against a frontage on Unter den Linden showed
  four things that read as fake.
- A black seam, a pixel or two wide, down the corner of every building that
  was caving in. Drawn by the inside out pass, so the first guesses were
  about that pass; colouring each category of fragment in turn showed it was
  the falling top of the building itself. `applyCollapse` turns a falling
  vertex's normal towards up with `normalize(mix(n, up, worst * 0.8))`, and
  for an underside at worst 0.625 that is the zero vector, whose normal is
  not a number, and a pixel lit by not a number is black. Both the vertex
  and the fragment side now fall back to up for a normal of no length.
- Soot as a leopard print: a threshold on fine noise over the whole radius.
  On a wall soot now rises, reaching further above the blast than below it,
  in streaks up the face; on the ground it is a smooth stain with a broad
  variation; and burnt render is a dark warm grey with some of the wall in
  it, nearly black only in the heart of the blast. Crater ground is 0.85 of
  that rather than 0.97.
- Rubble as crates: the gib mesh is three boxes. Rubble now has its own
  mesh, two faceted, flattened, lopsided lumps and a broken slab, drawn
  through the same program, and its sizes run mostly small with a few large
  pieces rather than evenly. Rubble on a wall that came down is dust grey,
  paler than the wall, not darker.
- `tools/test-city.mjs` 81 of 81 and `tools/test-cheats.mjs` 112 of 112.

## 69. A building falls like a building

- 2026-10-20: "how does the destruction behave? a house does not fall down
  realistically". Frames of a 30 m blast against a six storey block from
  across the street showed why: the frontage became a ramp, the roof slid
  down into a slope and the windows smeared along it, and the whole thing
  eased in and out like a hydraulic ram.
- Cause: a wall in the bundle is one quad from the pavement to the eaves,
  with the windows drawn by the shader, so there was nothing in it to break.
  The collapse could only pull its top corners down, by a share that fell
  off smoothly with distance from the middle of the site, and a frontage
  pulled down by its corners by a smooth share is a ramp.
- What it does now:
  - Before a site starts to move (`demolition.onRefine`), every building in
    it is cut into pieces about a storey across (`fineWalls` in
    `src/game/remesh.js`) and then along the four metre column lines the
    shader breaks by, each column with corners of its own (`columnCut`).
    Corners shared across a column line would stretch a sheet from the top
    of a standing column to the heap of a fallen one, which the first
    attempt did: slanted shards the height of the building. Sites over 70 m
    are not cut; everything in them comes down to the ground anyway.
  - Column by column (`columnHash`, `columnShare` in the shader and in
    `src/game/bake.js`), a column comes down or stays up, as a sharp step
    with a ragged edge, and one that stays loses a broken top, more of it
    near the middle. The hash is whole numbers small enough to be exact in a
    float, so the shader, the baker and the collision agree.
  - What falls lands as a stack: each storey on the one under it as a thin
    slab, up to a metre of stack on top of the heap, and the heap is lower
    (3.5 m at most) so that a flattened block is under the five metres a man
    cannot see over.
  - The fall runs under gravity, `k * k` over the fall time, slow to start
    and stopped by the ground, instead of a smoothstep. 1.8 s plus a little
    per metre of site.
  - A cloud: `effects.collapseDust` rolls out low along the street from the
    foot of the site and a column goes up out of the middle, drawn over the
    frame in the blood's alpha blended pool, because grey added to a bright
    sky is nothing at all. It lasts eight to fifteen seconds and hides most
    of the fall, which is what a real one does.
  - Rubble is only coloured as rubble where it properly came down (the
    shader's share interpolates across a piece, and the baker marks a vertex
    as rubble past 0.3 of its height fallen rather than 0.02), so a frontage
    still standing keeps its windows; and the back of a piece in a heap is
    lit like the rest of the heap instead of being the near black inside of
    the world.
- Checks: `test-machines` measured damage by the tallest wall near a hit,
  which with a ragged edge is the one column that stayed up; it measures
  the mean height of the walls within reach now, a metre of wall at a time
  (22 m on average standing, 8.4 m after five rockets, 13 of 13 places came
  down). The inside out check allows 3 % of the pixels it touches to be
  lighter, the backs of rubble in the sun. `test-city`'s fighter takes off
  down whichever way from where it stands is clear furthest, since the
  checks before it leave ruins about.
- The viaduct check on the live city: the new diagnostic still described
  the arch at deck height for the blocked streets, because `raycast` hands
  back one shared result object and the deck ray, cast second, overwrote
  the head height one. Each ray has its own result now.

## 70. What really stopped the three streets

- 2026-10-20: with each ray given its own result the live run named the
  blockers for the first time. Reinhardtstrasse and Unterbaumstrasse: a box
  4.3 m long and 1.5 m high, twelve to fourteen metres past the railway,
  which is a parked car; the probe was at 0.9 m. Friedrichstrasse: a wall
  from the street to exactly 4.0 m, 33 m long, two metres past the railway.
  4 m is this builder's default height for `building=roof`, which it
  extruded as a solid block from the street up.
- Source checked: OSM2World, the open 3D renderer for OpenStreetMap, gives
  `roof` and `carport` `hasWalls = false` in BuildingDefaults.java and
  builds a `building:part=roof` as a RoofBuildingPart, "a roof without
  walls" (github.com/tordanik/OSM2World, core/.../building/). The OSM wiki
  itself is not reachable from this container.
- So a roof with open sides (`unwalled`) starts where its tags say, or else
  as a slab 0.6 m under its own top (`roofFloor`), without windows, and is
  collided against only from there: you walk under the canopy.
- The viaduct probe runs at 1.9 m, a head, rather than 0.9 m, a knee, so a
  parked car under the arches no longer counts as the viaduct blocking the
  street; a pier still does, from the ground to the deck.
- Unit tests 72 of 72; `test-city` 81 of 81 on the synthetic city.
- The live run after that: the viaduct check green, 12 of 12 streets under
  the arches. That let `test-districts` run on the live city for the first
  time in days (it comes after `test-city` in the workflow), and 7 of its
  34 failed. The first: the check that a flattened district stays flat
  started wherever the check before it left you, which on a deploy with
  three districts built is 28 km south east in country nobody has built;
  the blast went off over nothing and the trip home held the page for
  eight minutes, which is what the next three failures look like. It now
  crosses back into Mitte first. Locally 34 of 34.
- The next live run, with the ruin check starting in Mitte: still nothing
  came down. Sixty metres east of the Gate is inside 170 m of the memorial,
  and nothing within reach of a weapons free zone is demolished, so the
  blast was refused whole. The check now picks the nearest point in the
  district with buildings on it that is clear of every zone by 200 m. And
  the check that a neighbour's ground arrives read one point 25 m over the
  edge, which on the live city is a tile with nothing in it and so no tile
  at all; it reads nine points along the edge now.
- With the game's mode in the report, the live run said why nothing came
  down: the mode was `travel`. The free travel check just before it had not
  landed in its 1800 frames, and everything after it ran with the player in
  the air: the blast was never stepped, the travel map would not open, and
  the coarse corridor was never let go. A flight holds at the end until the
  landing is in, and it asked whether there was a tile under the exact spot
  it was landing on; a tile with nothing in it is not in the bundle at all,
  which the neighbour check had already met on the live city, so a flight
  to the middle of such a tile held for good. It asks whether the landing
  district is in, at the fine tier, instead. The flight check now says what
  a flight still in the air is waiting for. A streamer change that could
  not have been the cause (the ceiling is 128 MB and the flight held 47) is
  kept anyway: the landing district is pinned, so no distance or ceiling can
  let it go while you are coming down to it.


  The next live run said what the flight was waiting for: c3r2, which is
  not built on CI at all (the live build there has core, c2r1 and c4r1).
  The test picked its neighbour as the nearest district sharing an edge
  and never asked whether it was built, so the walking check measured the
  ground of a district with no bundle, and the flight went to a place with
  nothing to land on and held over it for good. The test now picks only
  built districts. The game says no as well: beginTravel refuses a district
  nobody has built, as the map already did, and the landing only holds for
  a district that can arrive.

  With the flight landing, the live run was down to three. Two were the
  test measuring the wrong thing on a city of three districts side by
  side. The ruin check read the tallest wall against the ground at the
  blast, which is the bottom of an eleven metre crater afterwards, so every
  wall left standing read eleven metres taller (23 m before, 29 m after,
  when the walls had in fact come down to 18 m). tallestNear takes the
  ground to measure from, and the check gives it the ground from before
  the blast. And there is nowhere on that deploy far enough away for the
  streamer to drop the middle, so the check lets it go by hand when the
  streamer did not, and says which it was. The corridor check asked for an
  overflight district on a flight between two districts that share an edge,
  with nothing built in reach between them; it now works out what is built
  within the flight streamer's reach of the line and only asks when
  something is.

  The run after that was 32 of 34, and both were the test again. Letting
  the middle go by hand and then waiting ten frames gave the streamer time
  to fetch it straight back, since from next door it is in reach; the
  check reads it at once now. And the corridor was worked out from the
  take off, where the flight streamer never centres: it centres one lead
  (1400 m) ahead of the camera and never past the landing, so the test
  sweeps that line instead. Open: one local run of three saw one frame of
  fifty over a built district with nothing drawn under it. Not reproduced
  in the next two; most likely a district adopted a frame before its tiles
  were uploaded. Kept as a finding rather than explained away.

  With the district walk green on the live city, the run went on into the
  machines for the first time in a while and was cancelled by the job's 45
  minute limit, every check so far passing (the last was a mech killer of
  theirs, 3011 off the hull). Twelve minutes of fetch and build come before
  the first test and the suites have grown since the limit was set; it is
  75 minutes now. Locally the machines are 62 of 62 and the interface 35
  of 35.

  With 75 minutes the run got to the end of the machines: 61 of 62. The
  one was the wall check in a mech, "camera 1.6 m out, wall at null": the
  test found the nearest wall from the eye where the mech stood, moved the
  mech to a metre off it, and looked again from there. On the live city
  the ground at the new spot put the eye somewhere the same wall did not
  answer, so there was nothing in front of the head and nothing for the
  camera to be kept off. The test now takes only hits that are walls (a
  rise in the ground is not a frontage), and only a wall that still answers
  from the eye where the mech will stand; if none does, it says how many
  fell out at each step.

## 71. Tier 0 everywhere, on a machine that can hold it

Asked for: every district at tier 0, flown over at tier 2. Measured before
anything was changed, because the last time this was asked the answer was a
wall rather than a cost:

- Published GitHub Pages sites may be no larger than 1 GB, and a deployment
  that takes over ten minutes is stopped. Checked in the source of the docs
  page, github/docs, content/pages/getting-started-with-github-pages/
  github-pages-limits.md.
- The live site is 813 MB of fine bundles today (Pages run 140).
- Each district built at its own tier, at tier 0 and at tier 2, from the same
  extract: tier 1 grows 3.9 times at tier 0, tier 2 5.4 times, tier 3 5.9
  times. An eight kilometre district (o16, synthetic) went from 14 MB to 287
  MB, 274,080 triangles to 4,996,985, 4.6 s to 42 s and 0.6 to 3.5 GB of
  memory to build.
- Applied to the live sizes, every district at tier 0 with a tier 2 overflight
  is about 5.2 GB; only the ring at tier 0 is about 1.7 GB.

So there are two cities now, and a profile picks which:

- `full`, for a machine of your own: every district at tier 0 and the block
  tier for the flight. `npm run world:full`.
- `pages`, for the deploy: the standard city, then as many districts outward
  from the middle moved up to tier 0 as fit under the ceiling, decided by
  building them and measuring.

- 2026-10-20: 71a, the profiles. tools/districts.mjs says what each profile
  builds, and `--tier=` and `--over=` on the command line beat it for one
  district. The overflight bundle is built only when it is coarser than the
  district's own build, and a rebuild without one deletes the one it had.
- 2026-10-20: 71b, the fetch. Tier 0 wants the long list of tags, so an
  extract fetched with the short one is fetched again; older extracts did not
  say which they were and their tier does. A district bigger than three
  kilometres a side is asked for in pieces and put back together with each
  element kept once, because the full query over seventy square kilometres
  is not something a mirror finishes.
- 2026-10-20: 71c, the pages profile. tools/fit-pages.mjs starts from the
  standard build and moves districts up from the middle outward: each is
  rebuilt at tier 0 with a tier 2 overflight, the site is weighed the way
  build-dist ships it, and one that takes it over 950 MB is built back the way
  it was. What a district costs at tier 0 is built and weighed, not guessed,
  because the ratio ran from four to twenty in the measurements above. Three
  misses in a row ends it, since the districts further out are bigger. On the
  local city with a ceiling of 110 MB to make it miss: core, c2r1 and c3r2
  went up, c3r0, c4r1 and c0r1 were built back. The deploy runs it after the
  build, and saves the extract cache after it so the districts fetched again
  with the long list of tags are kept.
- 2026-10-20: 71d, the runtime. The streamer's ceiling was 128 MB, set for
  districts of three to forty. It is now three of the biggest district in the
  index, the one you are in, the one ahead and the one behind, never under 128
  MB and never over 1.5 GB. The local full city (eight districts, synthetic,
  177 MB, i24 the biggest at 47.9) passed the whole district suite, 34 of 34,
  with a ceiling of 144 MB; the standard city still reads 128. The same
  street in Ring 1-2 at both tiers is in tier-01-standard.png and
  tier-02-full.png: tier 0 brings the cornices, the lamps, the parked cars,
  the kerbs and three times the trees.
- 2026-10-20: the checks for 71d went red on one line, and it was not 71d:
  "and all of them stand on the ground" in the arsenal, with no detail. The
  pads took their height once, when they were put down, and the checks before
  that one dig craters and stream districts in. A pad over a hole that came
  later hung in the air above it, which is a real if small fault and why the
  line had passed on the same data an hour before: which pad a blast lands
  near is not fixed. A pad now sits on whatever ground is under it each step,
  and the check says how far off the worst one is.
- 2026-10-20: the first deploy with it, on the live city (Pages run 141).
  The site was already 932.39 MB before anything moved, 813 MB of districts
  and 120.71 MB of overflight bundles, which left 18 MB under the 950 MB
  line. Mitte took its tier 2 overflight (+2.74 MB) and Hansaviertel (c2r1)
  went up to tier 0 (+6.82 MB), to 941.95 MB. Kreuzberg (c3r2) would have
  been 964.51 and Gesundbrunnen (c3r0) 974.04, so both were built back, and
  Tiergarten (c2r2) could not get the full tags out of Overpass. The step
  took 10 min 50 s on an eight minute clock, because one Overpass query can
  hang for ten: fetch-osm takes `--deadline=` now and fit-pages gives it
  what is left, two minutes at most. The honest reading: on Pages the gain is
  two districts, because the standard city already fills the site. Room for
  more would have to come out of the overflight bundles or the outer tiers.
- 2026-10-20: the next deploy (Pages run 142) with the Overpass deadline: the
  step took 1 min 58 s instead of 10 min 50 s. Tiergarten (c2r2) got its full
  tags this time and would have been 961.20 MB, so it was built back too. The
  live site is Mitte and Hansaviertel at tier 0, 941.71 MB of 1000. The checks
  on the same commit are green end to end (run 120).

## 72. The tank drives the way it points, and its turret follows the mouse

- 2026-10-21: reported from the live site, a tank on Pariser Platz: W and S
  swapped, A and D swapped. The driving was right and the drawing was not.
  Everything that moves goes along (-sin yaw, -cos yaw), and the body shader
  turns by rotY(-w), which puts a nose built along -z at (sin w, -cos w); the
  vehicles handed it their heading as w. That is right going north or south
  and wrong by twice the angle otherwise, so a tank driving west was drawn
  facing east. Measured before the change: a tank at yaw 0.6 drawn 69 degrees
  off, at pi/2 drawn backwards; the S-Bahn carriages on a track at yaw 1.07
  lay across it (0.53 along it, 1.00 after). The vehicles and the enemy jets
  now hand the shader the heading negated and a train pi less its track
  angle. The mechs were checked the same way and were already right. The
  tank's muzzle had the same mistake in its own arithmetic and sat behind a
  tank driving west; the slope it pitched to was sampled behind it too.
- 2026-10-21: the turret. The mouse lays it and it traverses at 0.7 rad a
  second, so it comes round rather than snapping; the view no longer turns
  with the hull on a tank, the hull turns under it. The turret is parts 45 to
  47 of the tank mesh, which the shader turns about the ring and draws as the
  olive, the gun and the dark metal, in the shadow pass as well. A ring on
  the screen shows where the gun is pointing and turns green once the turret
  has caught up. Checks: the hull drawn the way it drives at three headings,
  0.35 rad of turret after half a second and 1.2 of 1.2 after three and a
  half, the shell along the turret from 8.8 m out in front. City 84 of 84.

## 73. A frontage under shellfire comes down in pieces, not in spikes

- 2026-10-21: reported from the live site, the ruins at Pariser Platz after a
  tank had been at them: walls drawn out into sheets and spikes twenty
  metres long. Reproduced with eight shells into the Gate end of the square
  (collapse-05-spikes-before.png). Three causes, found in order:
  - Every corner of a piece took its own bite, its own heap and its own throw
    from its own position. A wall is now read by the four metre column it
    stands in, the same lines remesh cuts it on, so the corners of a piece
    move together. In the shader and in the bake alike.
  - The sites were applied in turn, each from where the last had left the
    corner, and a dozen shells threw a frontage's top a few metres a shell
    while its foot stayed put. A wall now takes the one site that brings it
    furthest down, read from where it was built, and rubble a finished site
    baked is left where it lies by the sites still open.
  - The one that mattered most, measured: after six shells 662 of the 6,396
    wall triangles within 20 m of the hits still crossed a column line,
    because columnCut only cut a piece whose middle was inside the site, and
    the corners of an uncut piece just outside came down with the columns
    they were in. Cut two columns past the rim, the count is 0 of 7,704.
  collapse-06-spikes-after.png is the same shot. Still wrong and left for
  later: the Gate's attic has nothing under it, so a piece of it that comes
  down stops at the height the Gate is cut back to and hangs there, and a
  column left standing next to fallen ones is a facade with no sides, which
  reads as a thin panel. Machines 62 of 62, city 84 of 84.

## 74. The memorial is under a force field instead of out of bounds

- 2026-10-21: asked for: no weapons free zone at the memorial, a force field
  so it cannot be damaged instead. The zone was one test, combat.isSanctuary,
  asked by thirteen modules for two different things: keep away (the weapon
  holsters, drones and soldiers turn back and stop seeing you, mechs, pads
  and parked vehicles are not put there, the warhead, the ion cannon and the
  plasma rain refuse it) and do no harm (no collapse, no crater, no fire).
  The first kind is gone: nothing is told about the memorial any more. The
  second is the field, combat.isShielded, 100 m from the middle of the
  stelae rather than the 135 the zone kept clear of the streets round it.
- What it protects, everywhere a blast can change the city: the collapse in
  the world shader (a uniform for the field, and no vertex inside it moves),
  the bake that writes a finished ruin into the tiles, the collision walls,
  the craters in the ground the player stands on, the holes a shell punches
  in a wall, trees catching fire or being blown over, and scorch marks. A
  site may now open on the memorial, and it was wrong that it could not: a
  warhead there used to spare the whole street round it. Measured: a
  warhead on the edge of the field took a block outside it from 17 m to 3 m
  and moved nothing inside it.
- What it looks like: src/render/field.js, a low dome of hexagons generated
  in the vertex shader, additive, faint at rest and lit from the point of a
  hit outward with a ring that runs across it (field-01-dome.png, from a
  helicopter over the synthetic city).
- Checks rewritten to say what is true now: the weapon fires there and
  hurts, a drone parked over the stelae stays and fights, a warhead and the
  ion cannon can be put on it, a blast in it leaves the ground and the walls
  where they were, and the street outside still comes down. The city check
  that a collapse reaches the shader read its site after sixty more blasts
  had merged into it; it reads it first now.

## 75. Blast plasma: harder, orange, ten times the harm

- 2026-10-21: asked for: blast plasma for Ultra Plasma (a toggle on the
  launch screen) and for the plasma rifle (hold the right mouse button, ten
  seconds or so). Harder, no bounce, ten times as strong, very bright orange.
- Two projectile kinds, blast (the rifle) and ultraBlast (the rain), that
  detonate on contact and never bounce; the rifle's is 340 damage over the
  same 1.5 m as a 34 damage bolt, the rain's 800 over 8.25 m. Both meshes
  carry part 48, an emissive orange in the actor shader.
- The orange came out white the first time: the tonemapper (the ACES fit
  with its two colour matrices) whitens anything bright whose green and blue
  are not near nothing. Worked out on the CPU with the same matrices: an
  emissive of (3.4, 0.38, 0) lands on (1.00, 0.64, 0.22) in sRGB, an orange,
  where (9, 4, 0.5) landed on (1.00, 0.96, 0.84). blast-01-bolt.png beside an
  ordinary bolt, blast-02-rain.png from the street.
- The rifle charge runs while aiming, is lost on release before it is full,
  and is announced with a toast and a chord when ready; the next shot uses it
  and the one after is ordinary again. Checks: arsenal (charge, kind, damage,
  no bounce, next shot ordinary) and cheats (a blast rain sends only the hard
  kind, at 800, without a bounce).

## 76. Void storm: the void cannon's ball from orbit

- 2026-10-21: asked for: a new super weapon like Ultra Plasma, Void Storm,
  with the void weapon's ball as the projectile.
- Ultra takes its numbers from a spec now (ULTRA or VOID_STORM), so the
  storm is a second instance of the same queue and the same map mode with
  its own four settings in the cheats (count up to 600 on the slider, any
  number in the box). The blast switch is hidden for it.
- A projectile can carry its own void spec (b.void), which the in-flight
  tendrils and the landing burst read before the weapon row's. The storm's
  balls are a kind of their own, voidStorm, with the void mesh, 90 m/s and
  long enough to live to come in at a slant. Their splash is the cannon's
  without the punch: a hole cut per ball is a tile re-mesh each.
- At most 48 in the air, because each looks for somebody to reach seven
  times a second; that is the cost, not the pool.
- The void ball's green was white from across a square, for the reason
  blast plasma's orange was: brought down to (0, 1.7, 0.05) at the rim and
  (0.3, 3, 0.2) facing you, which lands on a neon green after the ACES fit.
- Checks (cheats): the panel shows its own numbers and leaves ultra plasma's
  alone, it rains only voidStorm, all twelve sent and none left up, the four
  soldiers under it are taken, never more than 48 up. storm-01-map.png,
  storm-02-rain.png. The blast rain check now switches blast off again so
  later checks are not run with it on.

## 77. The Void Maw: every mech of yours carries a void cannon of its own

- 2026-10-21: asked for: give the mechs an even stronger void weapon too.
- An arm, voidmaw, appended to every chassis' own loadout in mechs.js rather
  than written into ten rows, so a chassis added later carries it as well;
  the sets stay distinct. It fires a projectile of its own kind, voidMaw:
  the void ball's mesh at 1.3 m rather than 0.7, 34 m/s, fourteen seconds.
  The ball carries the arm's void spec (the field from phase 76), so the
  tendrils on the way and the burst where it lands are the arm's.
- Numbers against the hand cannon: aura 26 m for 140 against 16 for 70,
  reach 70 m for 900 against 48 for 450, blast 34 m for 1200 against 24 for
  700, a 12 m hole against 9. Two in the magazine, six seconds to reload.
- Checks (machines): the Warden carries chaingun, cannon, EMP bomb and the
  Maw, with a row for each; every arm of every chassis fires; and a man in
  the open sixty metres from where each lands is taken by the Maw and left
  standing by the hand cannon. mech-voidmaw.png from the cockpit.
- Seen once and not again: on the first run the EMP launcher check (rocket
  gone at age 0, 2 m up) and the Reaper hurting check (0) failed together;
  the rerun passed both, 64 of 64. Both spawn at random spots; noted here in
  case it comes back.
- The cockpit hint and the help row said 1 to 5 and named five arms, which
  has not been true since phase 68; they now say the number row.

## 78. A bar over every enemy in sight

- 2026-10-21: asked for: enemy health bars.
- src/ui/healthbars.js: a pool of 24 plain elements in a layer over the
  canvas, placed each frame with the camera's view projection (the same sum
  the tank's gun mark uses) and moved by transform. Soldiers and machines,
  drones, jets (which now keep a maxHealth) and enemy mechs; passers by and
  anything of yours get none, nor do the dead. Nearest first, within a range
  per kind (110 m for a man, 520 for a mech, 700 for a jet), only on the
  screen, and only with a line of sight, asked again per body every 0.2 s
  rather than every frame.
- Green to red by what is left, and a white chip of what the last hit took
  that drains over 0.6 s. Wider for a jet or a mech, and narrower with
  distance down to 26 px.
- Checks (combat): a drone in front gets one bar at the centre of the
  screen at 100% and the drone behind you none; one shot takes it to 25%
  with the chip still at 82%; dead, no bar. combat-01-contact.png shows four.

## 79. A shot with punch, and a muzzle flash that looks like one

- 2026-10-21: asked for: more punch in the firing sound, and a more
  realistic muzzle flash.
- The sound. Four things added to every voice in Audio.SHOT, each a number
  per weapon: snap (1.5 ms of raw noise, the leading edge), boom (noise
  through a falling low pass, the low middle a small speaker can play),
  drive (the body sine starts at 1.8 times its pitch and goes through a tanh
  soft clip, which gives it harmonics a laptop reproduces), and echo (a send
  to two darker delays, about 0.1 s and 0.26 s, the facades across the
  street; the near one moves a little each shot).
- First try put everything through a DynamicsCompressor for density, and it
  measured worse: Chrome's compressor looks ahead by a few milliseconds and
  turned the first ten milliseconds of a rifle shot down by eight decibels,
  which is the punch. Taken out. Measured offline (OfflineAudioContext, one
  shot, same master gain), rifle before and after: peak -12.1 to -7.2 dB and
  at 4 ms both times, first 10 ms -18.9 to -11.8 dB RMS, 10 to 80 ms -27.1 to
  -19.4, the band under 150 Hz -30.9 to -24.5, and 300 to 600 ms -112 to -77
  (the echo, which was not there). The mech cannon peaks at -4.3 dB.
- The flash. The solid cone that shrank back into the barrel is gone. Each
  weapon has two planes crossed along the barrel and a disc across its end,
  drawn from both sides; their normal slot carries where on the flash a
  vertex is, and the viewmodel shader cuts the shape out of that: a ragged
  star (the flash hider's four slots, plus noise round the circle for rays
  of every length) round a white core, and a plume that is widest a third of
  the way out. A seed drawn on every shot turns and re-tears it, so no two
  match. White hot in the middle, orange through it and a deep red at the
  edge, with green and blue held low so the tonemapper keeps the orange. The
  front of the gun is lit warm while it lasts. muzzle-01-rifle.png,
  muzzle-02-dusk.png, muzzle-03-shotgun.png.
- The winding audit in the unit tests skips parts 7 and 8, which are
  two sided on purpose and have no normal to agree with.

## 80. Operations, and Spree Fall Tactics' camps

- 2026-10-21: asked for two new modes. Spree Fall Tactics: in the manner of
  the outpost game, pick one district or all of them, the game puts camps
  down to be taken, points for a camp taken without an alarm (a switch), a
  camp that has you spotted calls for help if its radio is still standing,
  choose the district you start in, reset the camps or raise the difficulty,
  weapons of that kind on top of ours. Spree Fall Slayer: in the manner of
  the demon shooter, break the demonic presence by killing every demon in a
  district, bosses on request, one district or all, waves that spawn while
  you fight, weapons of that kind on top of ours. Names and numbers ours.
- The plan, one phase each: 80 the shared campaign and the camps; 81
  stealth, alarm, radio, reinforcements; 82 the Tactics weapons and a silent
  takedown; 83 demons; 84 nests, waves and presence; 85 the Slayer weapons.
- src/game/campaign.js, shared by both: the settings (scope, start district,
  how many sites a district, the quiet bonus, bosses), the book per mode
  (score, level, sites by district) kept in localStorage, sites placed the
  first time a district is in memory from a generator seeded by mode and
  district so they land in the same place every time, taking a site (1000,
  400 a level, 1500 more if quiet and the switch is on), reset and reset
  harder, and a summary. Unit tests in tools/test/campaign.test.mjs.
- src/game/tactics.js: a camp within 280 m is manned out of the soldier pool
  (5 guards, one more a level, machines among them from level 2), every
  other one a sentry who stands looking out, the rest walking rounds of the
  camp; a camp you walk 460 m away from before an alarm stands down and is
  manned in full when you come back; the last guard down takes it. Soldiers
  learnt a post: rounds inside it, a sentry stands, and the recycling of
  anybody far behind you leaves guards alone. campSpot puts a camp only on
  loaded, dry, level ground, out of the memorial's field, with nothing at
  chest height for 13 m round (less if a district has nowhere that open).
- The camp itself is one instanced mesh in the body shader (parts 64 to
  74): a sandbag ring with four ways in, two tents, crates, a radio on a
  table with a mast and a red light, a flagpole, a siren. Three switches in
  the rotor channel: taken turns the flag blue, radio down takes the set
  and mast away (shadow too), alarm turns the siren red and turning.
- Interface: Tactics and Slayer on the title card with their setup under
  them; a line at the top of the screen; red rings on the map that turn
  blue; the journal on J with each district, and buttons to give the camps
  back or give them back harder. Every spawner is held at nought in both
  modes. Fixed on the way: the difficulty buttons were picked by a selector
  that also caught the mode buttons, so clicking a mode cleared its own
  highlight.
- Checks: tools/test-ops.mjs (12), in CI after the interface suite.
  ops-01-camp.png, ops-02-camp-taken.png.

## 81. Tactics: being seen, the alarm, the radio and the help it calls

- A guard nobody has told has to notice you. Soldiers learnt suspicion, nought
  to one: it fills only inside his cone of vision (60 degrees either side of
  where he faces, out to 80 m), faster the nearer you are (squared), half as
  fast standing still and 1.7 times as fast running, and within 3.2 m it
  fills whichever way he faces; it drains while he cannot see you. Past 0.3
  he stops and turns to where he thinks you are; at one he is sure. Measured:
  behind a sentry at 12 m, nothing in five seconds; in front of him at 40 m,
  half sure after 1.7 s and sure after 3.5 s.
- Sure is not yet the alarm. The camp counts 2.6 s from the first guard who
  is sure, and if every guard who is sure is dead by then nobody else finds
  out. A guard who is shot and lives is sure at once. A rifle shot is heard
  130 m off and an explosion 240 m (a suppressed weapon will carry a few
  metres, phase 82): everybody who hears it is sure and comes to look. A
  guard killed where his mates can see him (30 m, line of sight) leaves them
  more than half sure and walking to the body.
- The alarm: every guard in the camp is told, the siren on its pole turns
  red and the siren is heard (two triangle tones a fourth apart, wailing up
  and down, louder the nearer you are), and if the radio works, a wave of
  help 9 s later and another 38 s after that, three men and one more a
  level, coming up out of the street 45 to 95 m off and knowing where you
  are; machines among them from level 2.
- The radio: 40 points of it, on the table in the camp, hit by any shot whose
  line passes within 0.45 m of it and by any blast that reaches it. Down, it
  goes from the mesh and its shadow, sparks, and no more help is called.
  A camp manned afresh has a working radio again.
- The bonus is for no alarm, which is what was asked: seen and silenced in
  time still counts. A camp taken after the alarm pays the base and its level.
  A camp walked away from with the alarm on stands down after 40 s away.
- The line at the top of the screen shows how seen you are (amber, the
  wariest guard within 160 m), spotted, alarm, and whether the radio is down.
- Checks (ops, 21 now): behind a sentry, in front of one, the alarm left to
  run, the spotter killed in time, a rifle shot heard at 100 m, help with
  the radio working, the radio shot to pieces in two rounds and no wave
  after it, and the loud camp paying no bonus with the siren stopping.
  ops-03-alarm.png.

## 82. Tactics: the quiet three, and a takedown

- Three weapons in arsenal.js, each with a noise: how far a camp guard hears
  the shot (anything without one is heard 130 m off). A suppressed pistol
  (46, three times that in the head, heard at 10 m), a bow (an arrow that
  drops, 125 and three times that in the head, heard at 4 m) and a marksman
  rifle, suppressed, with a scope (165, heard at 20 m). Their own voices in
  the shot synth: a cough and a click, a heavier cough, and a string.
- The arrow is a projectile of its own: it falls, and what it meets it goes
  into. A body takes the arrow's own harm (projectiles.onArrow, with the
  head counted from the actor raycast, which the projectile layer now passes
  on), a wall or the ground keeps it, pointing the way it was going, for 25
  seconds.
- The marksman rifle aims through a scope: an eleven degree field, a black
  surround with a thin cross, and no rifle drawn in the way of it.
- A takedown: F, within 2.6 m of a soldier in front of you who is not
  fighting and whose camp has not been told. Silent, so nobody hears it,
  but a body is still a body and anybody who can see it will go and look.
  The hint by the crosshair says Takedown instead of the nearest vehicle.
- A mode can give the number row a kit of its own (KITS in arsenal.js,
  weapon.setKit): in Tactics 1 to 0 are the pistol, the bow, the marksman
  rifle, the M16, the shotgun, the rocket launcher, the grenade, C4, the
  banana and the railgun, and the wheel goes through the same ten. There
  were two cycle methods in weapon.js and the second one won; it is the one
  left, and it reads the kit.
- Checks (ops, 28 now): the kit through the real play button and the real
  number keys, none of the three heard from 50 m where an M16 is heard by
  six, an arrow in the head without a sound, an arrow that misses staying
  put, the takedown offered behind a guard and done with the real F key with
  no alarm and nobody spotted, and the scope coming up and going again.
  ops-04-bow.png.

## 83. Slayer's demons

- src/game/demons.js: three that walk and one that floats, as numbers, with
  their names ours. A ghoul (110, quick, claws at two metres and throws
  fire), a brute (620, no fire, a roaring charge at 12 m/s across open
  ground, a blow worth 38), the tyrant (9000, three and a half times a man,
  fire in volleys of five, both fists down for 60), and the gazer, a sphere
  of hide with one eye that floats and spits fire (380).
- Built on the pools there are. A walking demon is a soldier with a kind set
  on it: the same body, ragdoll, gore and fire, given a step of its own in
  soldiers.js that hunts (no patrol, no making up its mind), claws in
  reach, throws fire when it can see you and has the breath, and charges.
  The floating one is a drone with a flag, whose shot becomes fire.
- Drawn in their own colours, the kind sent in the machine channel (two
  and up): cloth and webbing become hide (ochre, raw red, or near black with
  fire in the cracks for the tyrant), the helmet horn, the visor a pair of
  eyes, two horns the soldier mesh now carries hidden on everybody else,
  no rifle, and the whole figure and its shadow scaled. A demon is hit
  where it is drawn: the capsule and the head scale with it. The gazer is a
  mesh of its own drawn instead of a drone.
- Their fire (projectile kind fireball) is hostile: it does not go through
  the blast that knocks the city down, it does not touch another demon, it
  looks for you and goes off on the street or on you, and what it does is
  its own (projectiles.onHostile). A roar and a whoomp in the synth.
- Fixed on the way: the body cylinder of a soldier ran to the top of his
  head, and being the nearer surface it took every level shot at a head, so
  a head shot only counted from above or below. It stops at the neck now.
- Demons in the cheat menu's spawn row (a pack of seven), on the health
  bars at their own height and size, and in the ops checks (33 now): the
  four kinds and their sizes, a head shot at three and a half times a
  man's height, closing, clawing and burning, the brute's charge, and fire
  that does not touch another demon. ops-05-demons.png.

## 84. Slayer: nests, waves out of portals, presence, and a boss

- src/game/slayer.js. A nest is a site in the campaign book, placed like a
  camp (three a district by default, 220 m apart, 16 m of open ground),
  drawn as a mound of flesh with a heart in the top, bone spikes and roots
  across the street (parts 75 to 79: slumped with a dark heart once it is
  dead, the heart beating hard while it is awake).
- Within 75 m a nest wakes and the fight is the nest's: three waves (five
  ghouls; four ghouls, a gazer and a brute; five ghouls, two gazers, two
  brutes), more of everything a level. They come out of portals 12 to 34 m
  round it, one every 0.4 s while fewer than eight (two more a level) are
  up, fodder first and the heavy ones after, the way the genre paces it;
  three seconds' breath between waves. Spend the last wave and the nest is
  dead (1500, 600 a level). Run 240 m from a fight and the nest calls its
  demons back and waits for you.
- With bosses on, the last nest still standing in a district keeps a fourth
  wave for itself: four ghouls and a tyrant, out of a portal of its own
  size 22 to 40 m off.
- Presence, per district: each nest standing is its share, and a nest in a
  fight counts by what is left of it. The line at the top says the presence
  where you are, and in a fight the wave and how many are left.
- A demon's arrival is the blue sphere every arrival in the game is, in red
  and orange (effects.arrival takes a tint now), the size of what is
  coming; a gazer's opens in the air. Roars for a wake, a brute and a
  tyrant.
- Checks (ops, 41 now): Slayer and its setup, the nests and a whole
  presence, a nest woken and fought through all its waves with never more
  than eight up, the presence falling, running and the nest resetting, and
  with every other nest taken the last one bringing a tyrant and the
  presence going to nought. A Tactics check that let the other guards see
  the tester on their own was made to check only what it says.
  ops-06-nest.png.

## 85. Slayer's weapons, the finisher, and both modes written up

- A melee kind in the arsenal (KIND.MELEE): no round and no trace, the
  game layer finds what was in reach (in front, within the reach, not
  behind a wall) and decides what happened to it.
- A double barrel (two in it, eighteen pellets at 19, 60 m), a chainsaw, a
  shield saw and a flail, with names and numbers ours, and a Slayer kit for
  the number row: double barrel, M16, plasma rifle, rockets, railgun,
  shield saw, flail, chainsaw, flak, void cannon.
- The chainsaw runs on three pips of fuel. It takes the nearest thing in
  front of you, for one pip (a man, a ghoul, a gazer) or two (a brute), and
  will not take a tyrant; it gives ammunition back all over (half of a
  reserve for the gun in your hand and a third for the rest) and the fuel
  comes back by itself, one pip every fifteen seconds when there is none.
- The flail takes everything in a 3.8 m arc in front of you for 150. A ghoul
  goes in one.
- The shield saw is thrown flat and spinning: it cuts through whatever it
  meets (150 each, each once), turns round after 0.6 s or off a wall, and
  comes back to the hand whatever is in the way, cutting on the way back.
  Held up on the second trigger it stops fire coming at you from in front,
  and raised within 0.35 s of the fire arriving it sends a bolt of blast
  plasma back along your sight for 160.
- A demon brought below a fifth of itself (never the tyrant) reels for
  three seconds and glows from inside. F within 3.2 m of one in front of you
  is a finisher: it goes, and you get thirty health. The hint by the
  crosshair says Finish.
- The kill feed names demons, and in Slayer each one is worth its points in
  the campaign as well (100 a ghoul, 250 a gazer, 400 a brute, 5000 the
  tyrant).
- README: Spree Fall Tactics and Spree Fall Slayer, and F and J in the
  controls and the help panel.
- Checks (ops, 50 now): the kit through the real keys, the flail's arc, a
  reeling ghoul finished for health, the saw's fuel by size and the
  ammunition it gives back, no saw for the tyrant, fuel coming back, the
  double barrel at four metres, the shield saw through two in a line and
  home again, and a fireball blocked and one parried.
  ops-07-doublebarrel.png.

## 86. The Warlord, Slayer's great boss

- A boss in addition to the tyrant, not in place of it: the tyrant still
  ends every district, and the Warlord ends the operation. The last nest of
  the whole operation (with one district in scope, that district's last
  nest; with all of them, the last nest of the last district not yet done)
  keeps a fifth wave after the tyrant's: four ghouls, two gazers and the
  Warlord. Bosses off, neither comes.
- Built on a mech's legs: the mech layer walks it, turns its torso, aims and
  fires for it, so it is drawn by the mech shader with its own chassis row
  (hip 4.4, 9.2 m tall) and its own mesh (goat legs on hooves, an armoured
  chest with iron plates and pauldrons, horns, claws on the left arm, an
  iron launcher for the right, a pod on the shoulder). Parts 80 to 84 in the
  body shader: near black hide with fire in thin cracks, horn, banded iron,
  and the heart and eyes, which burn faster once it is angry.
- The heart is a sphere on its chest turned with the torso. A hit there is
  the core and counts in full; anywhere else is hide and iron and counts a
  third. A blast counts in full only when it goes off at the heart. 24000
  health, more at higher levels like any demon.
- Its arm fires rockets in threes with real splash, slow enough to step out
  of; the pod fires a salvo of six past 36 m. Its own rockets do not hurt it.
- Both hooves down every 5.5 s when you are within 18 m: a ring runs out
  along the ground at 20 m/s to 28 m, sparks along its front, and takes 55
  from you if you are standing on the ground when it passes. A jump clears
  it.
- Two phases: below two thirds it roars, calls four ghouls and a gazer and
  walks and fires faster; below a third it calls three ghouls, two brutes
  and a gazer, faster again, and its heart and eyes burn hotter. What it
  calls is counted with its nest.
- It dies in fire rather than in a reactor: a blast and a crater, a red
  portal, rubble and fire, and 25000 points to the score and the campaign.
- A long bar across the top of the screen with the boss's name, for the
  Warlord (with notches at the two phases) or a tyrant within 260 m; bosses
  get no small bar of their own.
- The cheat menu brings one out (Warlord, under the spawns).
- Checks (ops, 59 now): the last nest of the operation keeps the Warlord;
  it comes 9.2 m tall with the long bar; the heart is the core and the legs
  are not; the hide takes a third; the quake hurts where you stand and a
  jump clears it; both phases call their own, faster and hotter; it dies for
  the points and the bar goes. Unit (88 now): the plan of a nest, the tyrant
  and the Warlord for the last nest, the game layer deciding the last nest
  when every district is in scope, and none of it with bosses off.
  ops-08-warlord.png.

## 87. A compass across the top, a mark of your own, and a Gate you can walk through

- A compass strip across the top of the screen while walking, in the manner
  of the open world shooters: ticks every five degrees, letters every forty
  five, north picked out, a mark at the middle for where you are looking.
- In Tactics and Slayer every camp or nest is on it where it lies, red while
  held, blue once it is yours, pulsing while its alarm is going or its fight
  is on. The nearest one still held is drawn larger with its distance under
  it, and when it is behind you it waits at the edge the near way round,
  with an arrow.
- A mark of your own: click the big map (M) and a yellow pin goes down; a
  click near a camp or nest puts it on the site. The compass shows it with
  its distance, the small map shows it, and when it or the next site is
  further than the small map reaches an arrow at its rim points the way.
  Clicking the pin again, right clicking the map or the clear mark button
  takes it off, and it goes by itself once you are within 14 m of it.
- The top of the screen is in one order now: the compass, the street name,
  the operation line, the boss bar. The operation line was under the street
  name before.
- The Brandenburg Gate could not be walked through. Its mesh has had its
  five passages since the landmarks were built, but every landmark was given
  a wall all the way round its OSM outline, and the Gate's outline is the
  whole gate. A landmark builder can now say where it is solid: for the Gate
  that is the twelve columns and the four cross walls up to the entablature,
  and the entablature and attic over the whole outline above that. Every
  other landmark is solid to its outline as before.
- Checks (ops, 65 now): the compass shows the nearest camp in the middle when
  you face it and at the edge when you turn away; the compass, the street
  name and the operation line do not overlap; a real click on the big map
  sets a mark and shows the button; the compass points at the mark and the
  mark goes once you are there; walking west through three passages of the
  Gate and being stopped by a cross wall. Unit (89 now): the Gate's cross
  wall stops a bullet and a line of sight, and its middle passage and the
  one north of it are open. ops-09-compass.png.

## 88. The memorial can be broken from inside its field, and it always comes back

- The force field over the memorial holds against everything from outside,
  as it did. Stand inside it and it opens: the stelae can be shot down and
  the ground dug like anywhere in the city. Step out and it closes, and
  everything under it is as it was: the stelae, their collision, the ground,
  the scorch marks and anything left burning. Walk back in and it is whole.
  It can be destroyed, and it will always come back.
- How: when the field opens, the walls under it are written down as they
  are (snapshotIn); when it closes they are put back exactly, holes and all,
  while the walls outside keep whatever happened to them (restoreIn). Every
  live collapse site reaching into the field is marked spared, and the world
  shader leaves spared sites out under the field (uSpared, one bit a site;
  uShield.w says whether the field is open). Craters reaching into it are
  marked spared and stop counting there. A finished site that reaches into
  an open field is not baked until it closes, and baking never writes into
  the field, so nothing done to the memorial is made permanent. Trees and
  fires under the field keep to it whether it is open or not, and camps and
  nests are never put there.
- When it closes with something to put back, the field flashes round its
  edge and says so.
- Checks (ops, 69 now): shells from outside change nothing; from inside the
  field opens and the stone under it drops by three per cent and the ground
  by 1.7 m where they landed; stepping out puts both back exactly; walking
  back in finds it whole. A pixel comparison of the same view intact,
  broken and restored was run by hand while building it. ops-10 and
  ops-11.

## 89. Fire, poison and explosive arrows

- The bow carries four heads, changed with R while it is in your hands (the
  bow nocks its own arrow, so R had nothing else to do there): plain, fire,
  poison and blast. The HUD shows the head next to the weapon's name and a
  toast says which it is.
- A fire arrow sets where it lands burning: the trees there catch, a scorch
  mark, and a patch of ground that burns for eight seconds at 24 a second
  for anyone standing in it. It flames in the air on the way.
- A poison arrow lets out a low green cloud 5.5 m across that hangs for nine
  seconds and does 20 a second to everyone in it who breathes, you included
  at half that. It does a fifth less on the arrow itself.
- A blast arrow goes off where it lands, 6.5 m and 240, and is heard like an
  explosion, which is the price of it in a camp.
- All three do their work wherever the arrow ends up: in a man or in a wall
  or the ground. Each leaves a trail of its colour behind it in the air.
- The combat checks were brought up to date with the Gate and the memorial:
  the cover check now fires along a cross wall of the Gate rather than down
  the open carriageway, and the memorial blasts are set off from outside the
  field, where it holds.
- Checks (ops, 73 now): R goes plain, fire, poison, blast and the HUD says
  which; a fire arrow at a man's feet leaves the ground burning and burns
  him; a poison arrow leaves a cloud that hurts him; a blast arrow goes off.

## 93. Every weapon in every mode, from the cheat menu

- A switch in the cheat menu, Every weapon in every mode. Tactics and Slayer
  hand out a kit of ten on the number row and the wheel used to go through
  only those; with the switch on the wheel goes through all twenty two the
  game has, from the M16 to the flail, and switching it on loads them all.
  The number row keeps the mode's kit. Off, the wheel is the kit again. In
  Berlin the wheel already went through everything.
- Checks (ops, 74 now): in Slayer the wheel reaches ten weapons, with the
  switch on all twenty two (the bow and the flamethrower among them), and
  with it off the kit again.

## 90. A faster jeep, and every vehicle goes through what it drives into

- The jeep was slow because of its drag, not its top speed: drag takes the
  speed times the drag off every second, so on the flat it settles where
  that equals its acceleration. Fourteen over nought point eight is
  seventeen and a half metres a second, sixty three kilometres an hour,
  whatever the top speed said; the tank's numbers held it to four metres a
  second. The jeep now reaches 38 m/s (137 km/h) in a few seconds and the
  tank 16 m/s.
- Driven into a wall at seven metres a second or more, a ground vehicle
  goes through: a hole the size of what hit it is punched in the collision
  and the picture, the frontage round it takes a blow by speed squared
  times mass (a tank hits four times as hard as a jeep at the same speed),
  there is dust, rubble and a crash, and the vehicle carries on with some of
  its speed (a tank with most of it). A tree it meets goes over, and a
  parked car goes up. Anything on wheels or tracks going that fast flattens
  the trees it drives through, the way a mech does. The edge of the river
  and the memorial, while its field holds, stay where they are.
- An aircraft flown into a building takes a piece of it with it as well.
- Checks (city, 87 now): eight seconds of full throttle along Unter den
  Linden reaches 38 m/s; a jeep and a tank driven at two different
  frontages from Pariser Platz each go through and come out a long way past
  where the wall was.

## 91. An alarm box in every camp

- Every camp has an alarm box on the siren's pole at chest height: a yellow
  and black housing with a red lamp on top, lit and flashing while the
  alarm sounds. One rifle round, a grenade, a blast or an arrow breaks it
  (30), the way the radio is broken, and it is gone from the picture and
  from the shadows.
- Broken before anybody sees you, the siren cannot be sounded: when they do
  see you they know and they fight, but nothing goes off, nobody is called,
  and the camp taken like that still pays the bonus for no alarm, which is
  the point of going for the box first.
- Broken while the siren is going, it stops: the siren is quiet and no more
  help is called.
- A camp manned afresh, after a reset or a walk away, has a working box
  again.
- Checks (ops, 78 now): a rifle round through the real weapon breaks the
  box and the camp is drawn without it; broken first, the guards are all
  alert but there is no siren and nobody comes, and the camp pays the quiet
  bonus; with the siren going, a grenade at the box stops it and the call.
  ops-12-alarm-box.png.

## 94. The end of an operation

- When every camp or nest in scope has been taken (the start district with
  one district in scope, all of them with all), a card comes up a couple of
  seconds after the last one falls: Operation complete for Tactics, The
  presence is broken for Slayer, with how many were taken, how many camps
  without an alarm, the level, the score and how long it took.
- And the question: New operation starts again on the same settings, every
  camp or nest held again and the score at nought, with you taken back to
  the start district; Main menu goes back to the title screen.
- Checks (ops, 80 now): with every nest gone the card comes up with its rows
  and both buttons; a real click on New operation hides it, puts every nest
  back and the score at nought, still in Slayer. ops-13-end.png.

## 92. Comic carnage, past overkill

- A gore switch past overkill, Comic carnage: everything overkill does,
  drawn as a comic book. The blood is a bright comic red instead of the near
  black of the others, in drops nearly twice the size, thrown further and
  hanging longer, and the pools it leaves are red too and a quarter larger.
- Every hit gushes from the far side for most of a second. A head shot that
  kills takes the head with it in a burst of pieces and four sprays.
- Every kill: the overkill burst, a second burst of twenty two pieces, a
  fountain five seconds long and twice as tall, a red rain over everything
  within seven metres for two seconds that leaves pools where it lands, and
  the word in yellow with a thick red outline from its own list (SPLAT!,
  KA-SPLAT!, GUTS!, SQUELCH! and the rest). A kill within twelve metres
  throws a splash or a few on the lens: a blob with drops round it and a
  run down from it, gone in a couple of seconds, never more than seven up.
- Every weapon the gore switches already affected is affected by this one,
  since it is overkill underneath.
- Checks (cheats, 119 now): the switch is in the menu; a kill with nothing
  else on comes apart with the word in yellow, a blood rain and splashes on
  the lens; the blood is comic red. cheat-07-comic.png.

## 95. The thrown shield saw leaves the hand, and the world slows while it flies

- Thrown, the shield saw is not in your hand: the viewmodel goes until it
  comes back to it, and while it is out there is nothing to block or parry
  with.
- And the world slows to forty per cent while it is in the air (you a little
  less, as with every slow motion here), so you watch it go through a line of
  them and come back, and it is full speed again the moment it is caught.
- Checks (ops, 81 now): thrown, the hand is empty and the world is at
  forty per cent; back, the shield is in the hand and the world at full
  speed.

## 96. Nothing left hanging in the air after a collapse

- A building comes down by four metre columns of the world, and a piece of
  it whose corners stand in different columns, where one column came down
  and the next stood, is pulled between them: a slab of roof or wall hanging
  in the air. The pieces are cut on the column lines before anything moves
  (remesh.js), and two kinds of site were not being cut where they needed to
  be:
  - A site grows when the next shell lands beside it, and it was cut only
    the first time. The ring it grew into was left in whole pieces. Now each
    time it grows the new ring is cut as well (`finedRadius`).
  - A site over seventy metres, a warhead's, was never cut at all, for the
    cost, and even its middle does not come down whole: some columns stand a
    storey or two while their neighbours go. Now it is cut too, coarser, and
    a few tiles a frame within eight milliseconds, so the third of a second
    it takes is spread over a few frames while it falls over seconds.
- And the cornice and the string course on a frontage stand up to 26 cm
  proud of the wall, which near a column line put them in the next column:
  the wall came down and the band stayed. A band now stands out only as far
  as its wall's column goes at each end (tools/geometry.mjs, `inColumn`).
  Mitte is rebuilt with it; the others are rebuilt by the pages workflow.
- Measured from the tile bytes before and after, counting a piece with one
  corner that barely moved and still stands more than two metres up while
  another fell more than three: a warhead left 75 of them before and none
  now; shells landing beside each other left one before and none now.
- Checks (city, 89 now): both of those, the warhead cut over more than one
  frame. Unit (91 now): a point moves out only as far as its own column goes,
  and every corner of a band is in the column of the wall behind it, for
  four hundred buildings at random places and turns. The wall hole check now
  clears the scorch mark ring first, since it reads the first mark in it.

## 97. Comic carnage throws the blood against the walls

- With comic carnage on, the blood stays where it lands on a wall: every
  kill throws it along eight rays at chest height and every wall within nine
  metres gets a splat a metre or two across where its ray met it, and every
  hit puts one on whatever wall is within six metres behind the one hit.
- A splat is its own ring of twenty four in the world shader (uBlood), apart
  from the sixteen blast marks so it never pushes the soot out: a ragged
  blob from the facade noise with drops round it, running down the wall in
  streaks further than it reaches up, wet (low roughness), and the red of a
  comic book. On the street it is a splat without the runs.
- Checks (cheats, 120 now): a comic kill two metres in front of the long
  face of the Brandenburg Gate's cross wall leaves its blood on the wall.
  cheat-08-comic-wall.png.


## 98. A vehicle rigged as a bomb

- Getting out of a vehicle on foot, whole and not thrown clear, puts a
  question on the screen: rig it as a bomb? 1 is a time bomb of ten seconds,
  2 a remote bomb that goes with T along with the C4, 3 or Escape is no. The
  question takes the number row while it stands, so the one does not also
  change the weapon, and it goes by itself after eight seconds or once you
  are 25 m away.
- A time bomb beeps from the vehicle, a square wave falling off with distance,
  faster as it runs out (every tenth of the time left, never under 0.08 s),
  higher in the last three seconds, with a red flash on the roof each beep.
- The blast is the vehicle's own: 20 m for a jeep, 26 for a tank, 22 for a
  helicopter, 32 for a fighter, with a crater, and the vehicle goes with it.
  One shot to pieces with a bomb in it goes up with the bomb. Getting back in
  disarms it.
- A vehicle nobody is driving now has its handbrake on. Since the drag was
  lowered in phase 90 a jeep left at full throttle rolled on for a hundred
  metres after you got out, which took the bomb away with it and was why the
  city check on the ride hint had started to fail: the jeep it stood next to
  had gone. It now stops within two metres. Two tank checks in the city
  suite took their place from wherever that jeep was left, which now is
  where it stopped and sometimes a kerb away from a wall, so they start on
  the open square instead.
- Checks (ops, 86 now): the question comes on getting out; one picks the time
  bomb without changing the weapon; the jeep stands at five seconds and is
  gone at eleven; the remote one stands for twelve seconds and goes on T;
  three says no, and a rigged one is disarmed by getting back in.
  ops-14-vehicle-bomb.png.

## 99. Help that drives in

- A radio call that gets through no longer brings the men out of the
  pavement: it sends them by road (src/game/convoy.js). A start is looked
  for on a carriageway 170 to 240 m out on the far side of the camp from you,
  fanning out from straight behind it, loaded, outside the memorial field
  and at least 120 m from you. The way in is found with A star on a 4 m grid
  over the streets: a cell on a carriageway costs 1, open ground 4, a cell
  with a wall more than 1.2 m tall in it 60. A grid rather than the road
  graph, because the centrelines are simplified at build time and the point
  where two streets meet is often not a point either still has, so a graph
  built from shared points falls apart at every junction.
- Four men to a jeep, so a wave of five is two jeeps. A jeep follows its way
  with a look ahead of 10 m, up to 17 m/s on a straight and 6 in a corner,
  slowing for the stop; stuck against something for 1.6 s it backs off,
  turned the other way, for 1.3 s. It stops 22 m short of you (or of the
  camp, if you are not within 170 m of it), the men get down round it and
  hunt you, and the jeep is left empty for you to take. Under 35 percent of
  its hull left they get out where they are; blown up, they go with it.
- Serious means the second wave, or a camp at level two or more: then a
  tank sets out at the start with the jeeps a little up the road in front of
  it. It stops 55 m from you once it can see you (18 m while it cannot), lays
  its turret at its own slow rate and fires when the turret is within three
  and a half degrees: a shell at 120 m/s every 5.2 s, 60 damage in 8 m,
  within 150 m. Gentler than the one you drive, so it can be lived through
  from behind a corner.
- Theirs are drawn red on the map and carry a health bar. A run stood down
  (a new operation, the camps given back) takes them off the street. A
  vehicle with nobody at the wheel is handed the controls its driver
  decided (`v.ai`) instead of none. Where no street will do, the help still
  comes out of a sphere.
- Checks (ops, 91 now): a call of five sends two jeeps and no tank from at
  least 120 m off, marked as theirs, five inbound; inside a minute all five
  are on their feet, the jeeps 12 to 45 m from you and yours to take. The
  second wave brings a tank that shells you at least twice, from within
  160 m, and standing the run down clears them. The existing reinforcement
  checks count the men still in a jeep as inbound. Unit (97 now): the way
  round an L of two streets keeps to them and never enters the block in the
  corner, a footway does not count as a street, open ground still finds a
  way, and a jeep driven by `follow` with the vehicle's own arithmetic gets
  round the corner, never more than 14 m off the streets, and stops 10 to
  26 m short of the goal. ops-15-convoy.png.

## 100. A cockpit to sit in, with the mech not drawn round you

- From the cockpit view your own mech is no longer drawn (the instance list
  handed to the renderer leaves it out, so its shadow goes with it). That was
  the whole of the complaint: eight metres of armour round the camera filled
  the screen whenever it turned or stood by a wall. With nothing to see past,
  the eye no longer has to be pushed out in front of the hull: it sits a
  metre in front of the head (it was the chassis' own `cockpit` distance,
  1.6 m, which put it outside the canopy and against anything close). It stays on the aim line, so the crosshair still says
  where the shot goes, and boxed in against a frontage the view still falls
  back to over the shoulder, which draws the mech again.
- What you see instead is the inside of it, a canvas over the frame
  (src/ui/cockpit.js): the canopy frame with two pillars and a top bar, a
  faint tint toward the edges, a dashboard along the bottom quarter with a
  radar on the left (260 m, turning with the torso, theirs in red, a sweep),
  the systems on the right (hull, shield, weapon and rounds or reload, speed,
  pod and dash), a heading tape in the middle and a pitch ladder either side
  of the glass. Whatever of theirs is in sight (the health bars' line of
  sight) gets corner brackets within 320 m, bigger for a mech or a vehicle,
  and the one nearest the middle is held in red with its distance. The glass
  cracks as the hull goes, a crack for every seven percent lost, nine at
  most, and they are gone when you climb out. Under a third of the hull a
  warning comes on, blinking below a sixth.
- The status box, the on foot readouts, the buttons and the threat line are
  hidden while you sit in it, because the dashboard says the same; the
  loadout stays down the right inside the pillar. The help line in the mech
  panel said V changes the view, which it has not done since the travel map
  took V; it says Y now.
- Checks (machines, 68 now): from the canopy the mech you are in is not
  among the ones drawn and the cockpit is up with something on its radar and
  the status box hidden; half the hull gone leaves at least five cracks; over
  the shoulder it is drawn again and the cockpit is gone; and climbed out of
  it, it is drawn and the cockpit is gone. Every enemy chassis now gets three
  placements to show its gun can hurt you, since one spot where it walked
  behind a kiosk for twelve seconds read as a gun that could not. Unit (100
  now): the radar puts what is ahead straight up and what is to your right to
  the right, whichever way you face, and the projection lands where clip
  space says and nowhere behind you. mech-05-cockpit.png.

## 101. The Hunt, and the suit

- A third operation on the title card, The Hunt (campaign mode `hunt`, its
  own book in the save, 1200 a ground, 1800 for one cleared without an
  alarm, 450 a level). It runs on the Tactics camps: `tactics.enabled` is now
  `campaign.camps`, true for both, so the guards, the stealth, the alarm, the
  radio, the alarm box and the convoys all come with it. The line at the top
  says The Hunt and grounds; the journal is titled from the operation's own
  name.
- The suit (src/game/nanosuit.js), one bar of energy, 100: Q armour (80
  percent of a hit into the energy at 0.55 a point, 0.88 speed, 1.2 a second
  standing and 3.5 moving), E cloak (0.35 s to come up; 2.5, 7 and 20 a
  second standing, walking and running; inside 3.2 m they see you anyway),
  Shift a sprint at 1.75 times a run for 15 a second, Space held a jump that
  goes again at 1.75 times jump speed a moment after leaving the ground for
  22, F a punch for 30 that does 260. The energy comes back at 24 a second
  1.4 s after the last draw; emptied, whatever was on drops and nothing comes
  back on for 1.2 s. The bow fires from the cloak for 22 and leaves it up;
  any other shot drops it and empties the suit.
- The cloak reaches the soldiers and the drones as a distance (`cloak`):
  beyond it `canSee` stays false, so suspicion never fills, and a fight
  already going loses you and goes looking. The armour reaches you through a
  hook in `combat.hurt` (`absorb`), before the shield.
- On the screen: a SUIT bar over the vitals with the two modes lit while they
  are on, the bar yellow while sprinting and red when low, and the edge of
  the screen tinted, blue with a slow shimmer for the cloak, amber for the
  armour. A sweep for the armour going on and a shimmer for the cloak.
- In the suit Q and E are its modes (not the last weapon and the reflex),
  and you start with the bow in your hands; the number row is bow, rifle,
  suppressed pistol, marksman, shotgun, grenade, C4, rocket launcher,
  railgun, banana.
- Sources, checked: the first game's four modes and the second's Nanosuit 2
  keeping armour and cloak as modes with strength and agility contextual
  (Wikipedia, Crysis; Crysis wiki, Armor); Q armour and E cloak, B visor and
  N Nano Vision in the remastered PC controls (magicgameworld); the third
  game's bow firing from the cloak for a portion of the energy, with draw
  weights (Game Informer, E3 previews). The numbers are ours.
- Checks (hunt, new, 12): the mode is on the title card with its note; a run
  puts grounds in the district held the way camps are, and starts you in the
  suit with the bow; cloaked, a guard looking straight at you from 22 m has
  no suspicion after six seconds and the edge of the screen is blue, but
  walking into him he knows; the same guard without it is sure in under two
  seconds; the bow from the cloak costs 22 and keeps it, a rifle drops it
  with the suit empty; armour takes a 40 point hit down to 8 for 17.6
  energy; Shift covers 9.7 m in a second against 2.6 walking; Space held
  goes 2.34 m up against 0.57 for a tap; F puts a man down for 30. Unit
  (107 now): the suit's arithmetic on its own. hunt-01-cloak.png.

## 102. The visor, Nano Vision, and the bow's draw weights

- B in the suit puts the visor up (src/ui/visor.js): the view narrows to
  42 degrees, a frame and a count go round the middle, and the one of theirs
  nearest the middle within 9 percent of the half width, 260 m and in sight
  is scanned, a ring filling round him over 0.45 s, then tagged. A tag is a
  red marker with the distance over his head, drawn whether or not he can be
  seen and with the visor down, until he dies. Soldiers, drones, mechs of
  theirs and their vehicles can all be tagged.
- N is Nano Vision: a filter on the frame (grey, darkened, contrasted and
  turned blue) and a warm shape, white through orange, drawn over every one
  of theirs that is in sight, sized from where his feet and head land on the
  screen; 6 energy a second, and it drops when the suit is empty. Head or
  chest in sight counts, so a man behind crates with his head over them
  shows; the visor's scan takes the same rule.
- The bow has draw weights, on X in the suit: medium, strong (damage 1.6,
  arrow speed 1.3, time to the next 1.6, and it carries the man four times
  as hard back along the arrow) and light (0.65, 0.8, 0.55). The HUD says
  BOW STRONG FIRE and so on. And a fifth head in every mode, shock: 0.7 of
  the arrow's damage, and everybody within 5 m of where it lands takes 70
  and is put down for 2.4 s, with sparks over them.
- Keys in the suit are the remastered PC ones where the games have them (B
  visor, N Nano Vision); X for the draw is ours. The Crysis 3 bow's draw
  weights: a strong draw with the carbon tip pins a man to a wall and a low
  draw wounds rather than kills (two TrueTrophies guides, Stick Around and
  Arrow to the Knee); a medium setting is in one search summary but I found
  no page that confirms it, so it is ours as much as the numbers are. The
  electric head is in the launch review and the E3 previews (GamesBeat,
  Destructoid). Game pages could not be opened from here, only searched.
- Checks (hunt, 17 now): B narrows the view and a guard held in the middle
  is tagged; the tag is still drawn with the visor down and with every line
  of sight in the world answering no; N filters the frame, shows the guard
  warm and costs energy; X goes medium, strong, light with the time between
  arrows longer and then shorter; a shock arrow puts down and hurts the two
  men beside where it lands and leaves one twenty metres off alone. Unit
  (111 now): Nano Vision's drain and drop, the draw rows, the heads, and the
  weapon cycling draws for a bow and having none for a rifle.
  hunt-02-visor.png, hunt-03-nano.png.

## 103. Theirs at the hunting grounds, and the end of a hunt

- When a ground is manned in The Hunt (`tactics.onManned`), every third
  guard is made a grunt (`makeGrunt`: look 5, 1.22 times a man, 300
  health, the soldier's own rifle and mind), and one stalker per level, one
  to three, is put down six metres from the middle (`DEMON.stalker`, code 6:
  240 health, 8.6 m/s, a 15 m/s charge from 6 to 26 m, a blow of 20 that
  sets your vertical speed to 7.5 m/s). It is `dormant`: it turns where it
  stands until its ground is alerted, it sees you within 26 m (the cloak
  counts at once, not on the sight rota) or it is hurt, and records which
  (`wokeBy`).
- From level one, or at the last ground still held in a district, an enemy
  Heron stands twelve metres from the middle with half again its health and
  a ping: every 6 s, within 50 m, an EMP ring, 30 damage less up to half
  with distance, and the suit emptied with armour, cloak and Nano Vision
  off and nothing back on for 2.5 s. `run.alpha` keeps the ground held
  while it stands; standing the ground down takes it away.
- Drawn on the soldier body as the demons are, codes 5 and 6 in the shader:
  a dark shell (blue black for the grunt, grey for the stalker) with light
  in the seams, cyan and violet, metallic, and eyes to match; the grunt
  keeps its rifle, the stalker does not. A pooled soldier forgets `ceph`,
  `look` and `dormant` when it is spawned again.
- The end card says The hunt is over, Grounds cleared and Of theirs killed
  (`state.cephKilled`, counted in `creditTarget` for grunts, stalkers and
  the walker); a new hunt says the grounds are held again.
- Sources, checked by search (the pages themselves could not be opened from
  here): grunts as infantry, stalkers as fast light units that knock the
  player into the air, the Pinger as a tall tripod walker whose ping is an
  EMP reaching fifty metres (Crysis wiki, Ceph; Crysis 2 guides). The
  numbers are ours, and the walker is one of our own chassis.
- Checks (hunt, 24 now): a ground holds grunts and dormant stalkers and no
  walker at level nought; a stalker waits through a cloaked man 18 m off
  for three seconds and closes when the alarm goes; a stalker's blow hurts
  and lifts you more than a metre; from level one a walker stands over the
  ground, its ping empties the suit with the armour on, and the ground stays
  held with every man down until the walker is too; every ground cleared
  puts the end card up. The cloak check now clears the arrows of the draw
  check first: one still in the air broke the next ground's alarm box and
  woke the stalker through a silent alarm. hunt-04-ceph.png,
  hunt-05-end.png.

## 104. By the throat, thrown, and a grenade off the belt

- In The Hunt F takes the nearest of theirs within 2.4 m and in front by
  the throat (`Grab`, src/game/grab.js; the numbers in `SUIT.grab`): not a
  civilian, not a machine, not a boss and nothing more than 1.3 times a man,
  for 12 energy. He is held 1.45 m out and 0.35 m to the right, lifted off
  his feet and facing you, and kicks; `s.held` keeps the soldier pool off
  him, so he neither walks nor fires. Your gun goes away while he is held,
  and holding costs 5 energy a second; run the energy out, get into
  something or take the suit off and he is let go.
- The trigger held winds the throw up over 0.9 s; let go and he goes along
  the view at 11 to 30 m/s with a lift of 0.22 of that, for 8 to 16 energy.
  F again lets him drop. In the air he is a body in flight (gravity 19, a
  tumble): whoever he passes within 1.1 m of takes 0.8 of 9 times his speed
  and the throw loses four tenths of its speed; a wall stops him where it
  stands, the ground takes him when he comes down, and either hurts him by
  9 times his speed (a wall 1.3 times that). Whoever is not killed gets up
  where he came down. A held man is no takedown, and the prompt says Grab
  or Let go.
- G in the suit throws a grenade from the grenades you carry (`weapon.
  quickGrenade`: magazine first, then the reserve, 0.7 s apart) with the
  grenade's own speed and lob, without putting away what is in your hands.
  Outside the suit G still holsters.
- Sources: the first game's strength mode threw objects and enemies
  (Wikipedia: Crysis (video game)); a grab held longer before the release
  throws harder (Siliconera on the nanosuit); G is the grenade in the
  series' default keys (Steam discussion of the Crysis key map, and the
  Remastered key list). Grab on F is ours: the search found no source that
  names the original game's key for it.
- Checks (hunt, 27 now): F takes a man in reach and holds him up 1.5 m out
  and off his feet with the gun away and nothing hurting you; a full
  wind-up throws him through the man eight metres behind, who is hurt, and
  he dies where he lands; G throws a grenade without putting the bow away.
  Unit tests for who can be taken, the wind-up and the cost of holding, the
  flight through a man and onto the ground, and a wall. The throw checks
  bring the camera's vectors up to date after turning it, because the
  throw goes where the camera points and that is only worked out when it
  is drawn. hunt-06-grab.png.

## 107. A roof whose column went comes down with it

- From the user's screenshot (Steglitz, a block at stage 1 of 4): dark
  slabs hanging in the air over a ruin. A building is walls round the edge
  and a roof over the inside, and the roof is cut on the four metre column
  lines like everything else. Each column of it came down only as far as
  its column was cut back, so over the inside, where there is no wall under
  it, a partly fallen block left a staircase of roof pieces in the air at
  each column's own height. Reproduced here with three heavy hits into a
  frontage, and gone after.
- A face pointing up (normal more than half up) in the top quarter of its
  building is a roof, and in a column that has started to go it is cut back
  to nothing: it lands on the heap with the rest, in the shader and in the
  bake alike (`applyCollapse`, `settle`). The walls in the same column keep
  their cut, so a frontage standing to half its height is a frontage with
  its roof fallen in behind it.
- Checks (city, 90 now): after shells landing beside each other and after a
  warhead, no up facing piece that came down is left above the heap (the
  street before the blast, plus the most rubble a site of that size leaves
  and a metre and a bit): 0 of 1063 and 0 of 20252. Unit (2 more): a roof
  in a column that went is never above the wall beside it and lies on the
  heap; one outside the site is not touched.

- CI follow up: on the live Berlin extract the check found 67 of 2477
  roof pieces over its line after the shells. The line was the last
  blast's rubble (12 m, 1.3 m of it), but shells landing beside each other
  merge into one site whose radius, and so whose rubble, grows with each:
  17.6 m and 1.9 m here, more over real blocks. A roof on that heap is
  where it should be. The line is now the site's own (its ground, its
  rubble with the jitter, the metre a piece slides, and 0.3 m), and the
  log says how high it is and how high the highest piece left over it.
  Still sharp: with the roof rule taken out it fails at 405 and 4998.

## 105. Extreme enemies: wave after wave of help

- A switch in the cheat menu, and a setting beside it with a slider and a
  box to type the number into (1 to 50, 6 to start with; the box is the
  menu's first, and a setting can now ask for one with `box: true`).
- With it on, a camp or a hunting ground that raises the alarm with its
  radio up calls as many waves as the setting says instead of two, 20 s
  apart instead of 38, with two more men in each (`tactics.extreme`,
  `TACTICS.extreme`). From the second wave they are a convoy with a tank,
  as before. A Slayer nest holds that many waves of demons: the three as
  they are, and each past the last 15 percent bigger than the one before
  (`slayer.extremeFrom`, read when the nest plans its waves, because the
  cheats are applied at start up before the nests exist).
- Checks (ops, 93 now): the switch and the number typed into the box reach
  the setting and move the slider; with it on and five waves set, an alarm
  brings five calls of six men 20 s apart. The calls are counted rather than
  sent: five convoys with tanks shelling the street left it in no state for
  the convoy checks after them. And the tank check now stands you up with
  god mode on first: the crew that comes with it shoots too, and once they
  had killed you the tank had nobody to shell.

## 106. Crazy reality: the glass gets dirty

- A switch in the cheat menu. With it on, one canvas over the HUD and under
  the menus (src/ui/grime.js) takes:
  - dust off a blast within its radius and 45 m, more the closer and the
    bigger, from the side it went off and settling in the lower half: soft
    tan smudges with grit in them;
  - blood when you are hit, from the side the shot came from, once a
    second at most (standing in fire is a hit every frame), and when a kill
    is within 9 m: a ragged splat with droplets round it and a run or two
    that crawls down the glass;
  - soot round the edges from fire within five metres of its edge, or from
    pouring the flamethrower.
- It fades over 16 to 26 s by kind, and no kind keeps more than so many
  (50 dust, 18 blood, 16 soot) so a fight does not paint the glass red all
  over. The first try of it did exactly that, from a fire at the feet, and
  was turned down after the screenshot.
- Checks (cheats, 123 now): off, a blast beside you leaves the glass clean;
  on, a blast, a hit and fire at your feet put dust, blood and soot on it;
  and it clears by itself. Unit tests (3): nothing sticks while it is off,
  a closer blast throws more dust and a hit puts blood on its own side, no
  kind fills the glass and the runs grow and it all clears.
  cheat-09-crazy-reality.png.

## 108. More punch in a shot

- The guides on weapon sound for games say a shot that sounds weak is
  usually missing a layer: a transient, a body, a low end kept dry, the
  mechanics just ahead of the report, and a short tail (Splice, Violet
  Recording, designingsound.org on Chuck Russom). We had the transient (snap
  and crack), the body and the tail (the street's echoes); two are new.
  - **Kick**: a dry sine that drops from 110 to 50 Hz in 45 ms and decays
    over a little more than a tenth of a second, kept out of the soft clip.
  - **Mech**: a click of band passed noise round 4 kHz, the action, 6 ms
    ahead of the report.
  Both are numbers per voice in `Audio.SHOT`, as the rest are, and none on
  the bow, the throw or the plasma's mechanics.
- The bus: everything but the kick goes through a gentle clip (tanh at 1.6)
  at 1.12 times the level it had, and the kick and that are summed into a
  ceiling that rounds the top off at 98 percent, so a thump under a report
  never adds up past full scale. The quiet ones have a level of their own
  (pistol 0.4, suppressed 0.45, bow and throw 0.6) so the louder bus does
  not make them loud.
- Measured offline, before and after: the rifle's first 50 ms from -15.3
  to -9.7 dB and its low end under 120 Hz in the first 150 ms from -25.6 to
  -19.0 dB; the shotgun -10.4 to -6.4 and -18.0 to -13.1; the double barrel
  -9.3 to -5.6 and -15.6 to -11.0; the mech cannon -7.6 to -5.6 and -9.4 to
  -5.7. Every peak is at -2 dB or under (the first try without the ceiling
  peaked at +3). The suppressed pistol is where it was, -33 to -32.
- Checks (arsenal, 48 now): a rifle shot rendered offline is louder than
  -12 dB in its first 50 ms and over -21 dB under 120 Hz, and neither it
  nor the shotgun reaches -1 dB; the suppressed pistol is more than 15 dB
  under the rifle.

## 109. Two bows: a Tech Bow and a Tactic Bow

- The ask: two designs for the bow, after two pictures (a Crysis 3 bow and
  the Far Cry 3 bow). Neither picture could be fetched from here (the image
  host refused the proxy, the other did not resolve), so the designs come
  from what the sources say the two bows are.
  - Crysis 3: the hunter's composite bow, a permanent part of the kit, with
    a draw weight you set (Game Informer, GamesBeat). Ours: a compound
    bow, a carbon riser with a cut out, split limbs, cams and cables, a
    stabiliser, a short sight and a cyan strip that flares on the shot.
  - Far Cry 3: a recurve whose stock sight has two pins (voicetube on the
    bows, the Far Cry wiki's first person picture). Ours: an olive riser
    with windows, black limbs curling forward at the tips, limb bolts, the
    two pin sight with green fibre ends, a rest and a stabiliser.
- Four new viewmodel materials: carbon (31, a fine weave in the shading),
  cyan glow (32, brighter with the muzzle term), olive anodised (33) and the
  fibre pin (34).
- Which one: the tech bow in The Hunt, the tactic bow everywhere else, and
  a **Bow** row in the cheat menu (by mode, tech, tactic) that is saved
  with the rest and does not mark the run. The HUD says TECH BOW or TACTIC
  BOW in place of BOW. Nothing about how the bow plays changes.
- Checks (hunt, 28 now): in The Hunt the viewmodel is the tech bow and the
  HUD says so; chosen in the menu it is the tactic bow. Screenshots
  hunt-07-tech-bow and hunt-08-tactic-bow. The draw weight check now waits
  a moment after the menu closes, since the menu holsters the weapon while
  it is up.

## 110. The bow held the way an archer holds one

- The ask: hold the bow as in Crysis, because it aims better. Until now it
  was held like a rifle at the hip, down and to the right and turned in,
  so from the eye it was a stick lying across the right of the screen and
  the arrow pointed nowhere in particular. (A second hold for it at the
  foot of the arsenal, from an older phase, overrode the one in its spec;
  it is gone.)
- What the sources say: Crysis 3 aims the bow with the crosshair and a
  trajectory line, the left trigger to zoom and the right to draw
  (Kotaku); an archer holds the bow upright in the bow hand and draws to an
  anchor at the face, with the arrow just under the aiming eye (Human
  Kinetics on the side of face anchor). How the game draws its first
  person model is not written down anywhere found, so the pose is ours.
- The pose: upright in the left hand, left of the crosshair, the string
  towards the face, the top leaning a little left so the upper limb never
  stands over what you aim at. The arrow lies parallel to the line of
  sight: a line parallel to the view meets the middle of the screen however
  far off to the side it lies, so the arrow points at the crosshair from
  the hip and aimed. Aiming has a pose of its own for the bow (the rifles
  share one, the sight on the centre line): closer and nearer the middle,
  still left of it.
- Checks (hunt, 29 now): the bow's pose from the hip and aimed is left of
  the crosshair, leaning less than a sixth of a turn, with no yaw and no
  pitch, so its arrow is along the line of sight; hunt-07 and hunt-08 show
  it.

## 111. A hunt that opened with grounds already taken

- The report: a new round of The Hunt, and some grounds were already
  taken. Two causes, both real.
  - Dying and coming back cleared the street with `soldiers.reset()`, the
    guards of a ground near you with it. Tactics saw a manned ground with
    nobody standing in it and paid it out as taken. Reproduced in the hunt
    suite: two grounds freed by one respawn. Now the respawn stands every
    camp and nest down first, and Tactics itself never pays for guards that
    left the street without being killed (not alive, health above nothing):
    that ground stands down and is manned again in full.
  - The campaign is kept between runs on purpose, and the title said so
    only in a small line of the setup. The play button now says
    "Continue: 2 of 4 grounds taken" when there is progress, and a "New
    hunt" (or "New operation") button beside it wipes the campaign and
    starts.
- Checks (hunt, 31 now): a respawn beside a manned ground leaves it held and
  manned again (without the fix: two freed); with a ground taken the title
  offers Continue and New hunt, and New hunt leaves nothing taken and no
  score. Ops (93) and UI (35) unchanged and passing.

## 112. A brisker walk

- The ask: the normal pace is a little slow. It was 2.6 m/s, already twice
  what a person walks at (preferred walking speed is about 1.25 m/s in the
  laboratory studies, eLife and the PMC tables collected in the search),
  but a shooter's pace without the run key is faster still: Counter-Strike
  moves at 250 units a second, 4.8 or 6.35 m/s depending on how a unit is
  converted (cs.money, profilerr). Now 3.5 m/s, a third more, with the run
  left at 5.6, so running is still clearly the faster thing.
- It stays under the 4 m/s at which a guard counts you as running and
  notices you 1.7 times as fast (`playerSpeed > 4` in the soldiers), so
  creeping up on a camp at the walk is as quiet as it was.
- Checks: hunt, ops, combat and districts suites run with it, and the unit
  tests.

## 113. Filthier glass, and in a mech only on the glass

- The ask: crazy reality should be much dirtier, and in the mech the dirt
  was on the dashboard at the bottom, where there is no glass.
- More of everything: a blast throws 12 to 52 specks of dust where it threw
  6 to 28, bigger and nearly opaque up close, out to 70 m past its radius
  rather than 45; a hit puts two to six splats of blood on, each with one to
  three drips that run a third of the screen; a kill within 14 m (was 9)
  splashes; being hurt adds blood up to every 0.7 s (was 1.2); soot comes
  two at a time. The glass holds up to 220 (120 dust, 50 blood, 40 soot),
  and everything lasts longer (22, 30 and 32 s) while still clearing inside
  40 s. And a film: as the dirt builds up a haze comes in from the edges,
  brown, or red where it is blood, up to half opaque.
- In a mech: `glassClip` in the cockpit HUD traces the canopy from the same
  shapes the frame is drawn with (under the bar across the top, above the
  dashboard, with the pillars cut out by the even odd rule, the side
  windows outside them kept) and the grime canvas is clipped to it while
  the cockpit is up.
- Checks (cheats): one blast beside you and one hit leave at least 40
  splats; in a titan's cockpit the band across the middle of the glass is
  dirty and the band over the dashboard has no dirt on it at all;
  screenshot cheat-10-mech-grime. The unit checks (caps, sides, clearing)
  still hold.

## 114. The bow held flat, the arrow on top

- The ask: could the bow be held horizontally with the arrow on top. It can,
  and it is now the default: the same bow turned a quarter to the left
  (roll 1.47 from the hip, 1.54 aimed, a little short of a right angle so
  it does not look set with a ruler), so the side of the riser the arrow
  lies against is the top, and set low (12.5 cm under the eye from the hip,
  9 aimed) so you look down on the limbs rather than along their edge.
- The arrow is still parallel to the line of sight, so it still meets the
  middle of the screen: from the flat bow it runs up from the grip to just
  under the crosshair.
- The upright hold from phase 110 is kept: the cheat menu's bow group has a
  second row, Held flat and Held upright, saved with the rest and not
  marking the run.
- Checks (hunt, 31): held flat by default, rolled more than 1.3; Held
  upright from the menu puts it left of the crosshair; all four poses have
  no yaw and no pitch. hunt-07 and hunt-08 now show it flat.

## 115. One Man Army, and Nightmare

- The ask: a cheat menu switch, One Man Army, under which the attacks keep
  getting heavier (jeeps, tanks, mechs, heavier mechs, bombs, bigger
  armies), and a Nightmare switch that adds the ion cannon, the void storm,
  ultra plasma and the warhead.
- `src/game/onslaught.js` decides what comes and when, and nothing else, so
  it is tested on its own. A wave twelve seconds after the switch, then
  every 40 s, 2.5 s less each level, down to 18. Level by level: a squad of
  4 and 2 more a level (up to 34, a third of them machines from level 5);
  from 2 the rest by jeep (4 men and 1 more a level, up to 16); a tank with
  them from 3; a mech from 4, one more every second level up to four, and
  heavier as it goes (their chassis sorted by health, lightest first, the
  heaviest by level 12); from 5 a stick of bombs across your street (6, 2
  more a level, up to 22, nine metres apart, a line 18 to 55 m off to one
  side, falling one after another); jets from 6, up to four.
- Nightmare: from level 3 every other wave, and from 8 every wave, one of
  the four in turn: ion, ultra, storm, nuke. Each lands past what it does:
  the ion cannon 250 to 320 m off (its blast is 210), ultra plasma and the
  void storm with a 70 m circle 150 to 210 m off, a warhead 240 to 320 m
  off (its radius is 170); a bigger radius set in the menu moves them out
  by as much. A warhead sent against you is not followed by the cinematic
  camera.
- The game layer sends each wave with what it already has: the spawners,
  the convoys (to a stand in camp that is wherever you are), the mech drop,
  the jets, a rocket body falling straight down for each bomb, and the
  fire calls of the three super weapons and the warhead. A toast and the
  feed say what came. Switched off it forgets the level; dying and coming
  back keeps the level and gives you twelve seconds.
- Checks: unit (4) on the order things come in, the heavier mechs, the
  clock and the Nightmare rotation; cheats: nothing at once, a squad on the
  first wave, and on the sixth jeeps and a tank, mechs, bombs in the air and
  a jet; with Nightmare the ion cannon firing 240 m off or more on the third
  and a warhead falling 230 m off or more later. Screenshots
  cheat-11-one-man-army and cheat-12-nightmare.

## 116. The Teltowkanal had no water in it

- The report: a link to 52.4306 N, 13.3108 E (x -4532, z 9477), Lichterfelde
  West, looking down at the Teltowkanal: where is the water?
- The cause: the OSM wiki says a long canal's water area is cut into
  segments that are joined into one multipolygon (Tag:water=canal), and the
  build took every member way of a multipolygon as a ring of its own. A
  closed one is; an open piece of a canal's bank is not, and triangulated on
  its own it was a sliver or nothing. Everything mapped that way was broken
  the same way: canals and rivers in pieces, and buildings and parks drawn
  as multipolygons with split outlines.
- `joinRings` puts the member ways end to end where they share a node, in
  either direction, until each ring closes, outers and inners apart; a chain
  that never closes is left out rather than closed with a straight line.
- And `centrelineWater`: where a river or a canal has only its line (the
  wiki asks for the area and the line both, and not every stretch has the
  area), a band of water along the stretches no water area covers, the
  line's own `width` or 30 m for a river and 20 m for a canal. Not for
  tunnels and culverts, and not for streams and ditches.
- Neither OSM nor the live page can be reached from the sandbox, so the
  canal itself is checked by the deploy, which builds from the live
  extract; here the synthetic city builds unchanged (its water is closed
  ways), and the unit checks (3) cover a canal in three pieces with one
  reversed and an island, a chain that does not close, and the band with
  and without a width tag, stopping where an area already is.

## 117. Stronger weapons and grenades, and the arc of a throw

- The ask: stronger weapons and grenades, a path showing where a grenade
  will land, and a harder throw on the right mouse button.
- Everything you carry hits half as hard again: `COMBAT.playerPower` 1.5,
  through the same `damageScale` the quad damage pickup uses, so rounds,
  pellets, splash and the melee all get it (quad is now 4 times that). The
  grenade itself goes from a radius of 8 m and 135 to 11 m and 260 (390
  with the scale), and a little more force.
- The arc: `src/game/throwarc.js` flies the throw ahead of time with the
  projectile's own gravity and drag, the same lift and the same world
  raycast the thrown one meets, and stops at the first thing it hits;
  `src/ui/arcview.js` draws dots along it and a ring the size of the blast
  where it comes down, on a canvas under the dirt on the glass. Shown while
  a grenade, a banana or an incendiary is in your hand in the street.
- The harder throw: with the right button held a throw leaves the hand 1.6
  times as fast (the arc turns orange). Counter-Strike has its full throw on
  the left and a lob on the right (csdb.gg, metabot.gg guides); here the
  left is the ordinary throw and the right the one you line up, since the
  right button is aiming everywhere else in the game. In The Hunt, G with
  the right button held throws the hard one too.
- Checks (arsenal, 51): the arc shows with its ring, 19.8 m out from the
  hip and 36.8 m with the button held, and the grenade thrown with it first
  comes down 0.13 m from the mark; the power and the grenade's numbers. The
  charged plasma check now expects ten times the bolt and the half again.
  Screenshot combat-07-grenade-arc.

## 118. Vehicles burn, and then they go up

- The ask: a destroyed vehicle should burn first and then explode, big,
  with plenty of flames.
- Before: a vehicle at no health went up the same frame (16 m, 300), and a
  parked car a tenth to four tenths of a second later.
- Now `vehicles.onDestroyed` sets it alight instead: a burst of flame and a
  crack, its gun and its driver gone, and a wreck in a list that burns for
  3.2 s, flames every 0.11 s growing to twice the height as the time runs
  out. Then `blowWreck`: a blast of 20 m and 380 for a jeep, 26 and 560 for
  a tank (22 and 24 for the helicopter and the fighter), nine flames thrown
  out round it up to a third of the radius, a tall one in the middle, the
  trees caught 12 m round and 9 m of burning ground for 22 s, more rubble.
  An aircraft burns on the way down and goes up where it lands, or after 9
  s at most. A convoy's men still aboard die in the blast, not the catch.
- A parked car: alight for 2 to 3.2 s (a random share, so a row of them
  still goes as a chain), then 14 m and 220 where it was 11 and 120, seven
  flames thrown round it and 7.5 m of burning road for 20 s.
- A vehicle rigged as a bomb still goes at once, and then burns and goes up
  again as its tank does.
- And it looks burnt: the hit flash channel of the vehicle instances carries
  below nought how burnt it is (a quarter at once, all of it over two and a
  half seconds), and the shader takes the paint to all but black by that
  much. Before, a destroyed jeep stood in its own fireball as green as it
  was parked.
- Found by the city check on the way: `vehicles.reset()` puts the objects
  back in a pool, and the burning list kept the object, so the tank shot down
  in the check before set fire to the jeep spawned into the same slot. The
  entry now carries a token the wreck holds, and a vehicle from the pool
  starts with no driver, bomb, fire or runaway left over.
- Checks (city): a jeep at no health is alight and not blown at once, not
  blown 1.5 s later, blown by 4 s with more burning ground than before;
  a parked car is not gone after a second and is by four. Screenshots
  city-06-vehicle-burning and city-07-vehicle-blast.

## 119. Out of a car at speed, and it drives on

- The ask: jump out of a fast car to the side, pick a remote bomb, a time
  bomb or nothing, and the car just keeps going.
- Before: getting out set the handbrake (phase 98 had it on purpose, since a
  jeep left at full throttle rolled on with a rigged bomb), you were put down
  beside it, and the question went away once the car was 25 m off.
- Now, out of a ground vehicle at more than 8 m/s is a bail out. You go out
  of whichever side has room (the left, unless a raycast finds a wall within
  the vehicle's radius and 2.6 m), with a push of 6 m/s sideways and a third
  of the car's speed along it, 4.2 m/s up, dying away over 0.8 s. The car
  gets a driver with no hands: the throttle where it was (its speed over
  its top speed and a quarter), no steering, for up to 14 s, or until it is
  stopped, hits something hard enough to stop it, or somebody gets in. The
  bomb question is asked as before and holds however far the car has got;
  T still blows a remote one wherever it is.
- Getting out slower than that is what it was: the handbrake, beside it.
- Checks (ops): a jeep at 22 m/s, out of it: you are out and asked, it has
  a driver, after a second and a half it has run 43 m and is 40 m from you,
  you are 4 m from where you got out, the question is still there, 2 rigs it
  remote and T blows it.

## 120a. Nightmare aims at you, not at its own

- The ask: in Nightmare the enemy should try to kill you, not itself, unless
  it has to. As built in 115 the super weapons came down 150 to 320 m off
  you, in whichever direction, so what they mostly killed was the army sent
  after you.
- `pickStrike` in `onslaught.js`: you, and 36 points round you in three
  rings out to a shift of 90 m for the ion cannon, 70 for a warhead and 30
  for the two rains (each a share of what it reaches, so you are inside it
  wherever the aim goes), each costed by the men of theirs inside its reach
  and three for a mech or a vehicle; the cheapest wins, the nearest to you
  of any that tie. With nobody of theirs about it is straight on you; with a
  squad to one side it goes to the other; with them all round you and a
  reach that takes them anyway, it is on you at the cost it cannot avoid.
- The warning is a toast in capitals, the incoming sound and the feed line;
  after that it is the ion cannon's eight second charge, the rains coming
  down, or a warhead's four second fall. The cinematic camera still does
  not take a warhead aimed at you.
- Checks: unit (5, one new) on straight on, sparing a squad, and the cost
  that cannot be helped; cheats: the ion cannon and a warhead land within
  their shift of you, and ultra plasma with four of theirs 60 m east lands
  west of you with none of them in it.

## 120. Dying in slow motion, the camera going round

- The ask: when you die you come apart like the enemies do, in slow
  motion, and the camera goes round you.
- Before: the health bar ran out and the card came up at once over a frozen
  first person view.
- Now the card waits 4.2 s. The moment you go down you burst into pieces
  (the same gibs a soldier makes, at twice the scale whatever the gore
  switches say, since this is the one death always shown), with three jets
  of blood, a stain, a blast and a flash. The world runs at a fifth of its
  speed for as long as the camera goes round: from where you were looking,
  0.55 rad a real second, out from 4.5 to 9 m and up from 2.2 to 4.8 m,
  looking down at the spot, and pulled in along its own line when a wall is
  in the way. The weapon in your hands is gone. Then the card, and the
  button clears it all.
- Checks (combat): health to nothing with godmode off: the burst is out (32
  pieces), the card held back after half a second and after a second, the
  camera 5 to 7 m off the spot with the yaw turning by a radian between the
  first look and the third, the death clock under 3.5 s after more than two
  real seconds (the slow motion), the card after it, and the button brings
  you back with no death left over. Screenshot combat-04-death-cam.png.
- And the Nightmare check from 120a, which was red here: its ultra plasma
  was aimed while the jeeps and men of the earlier One Man Army waves were
  still about, so six of theirs were inside wherever it went. It now clears
  those first and sends the ultra plasma alone, so the squad is the only
  thing it has to miss.

## 121. More weapons, several to a key

- The ask: more and stronger weapons, which can share keys.
- The number row is now groups (`BUCKETS` in `arsenal.js`): a key held a
  single weapon before, and 7 had two (the flamer and the railgun, so the
  railgun was never reached from it). A key from outside its group gives the
  one last held there, the first the first time; pressed again it goes to
  the next in the group and round. The first of each group is what the key
  always gave, so 1 is still the rifle and 4 the grenade. `LOADOUT` is the
  groups in order, which is the order of the wheel. Kits (Tactics, Slayer,
  The Hunt) are still a weapon a key.
- Five new, each the heavy one of its group: a hand cannon (125 a round,
  2.6 on the core, through two), a drum shotgun (ten pellets, automatic, a
  twenty round drum), a rotary cannon (30 a round at 25 a second after a
  0.4 s spin up that winds down at half the rate), a grenade launcher (a new
  `shell` projectile, a third of a grenade's drop, goes off on contact, 9 m
  and 210) and a swarm launcher (four rockets a shot, every one of them
  homing on what the sight was on). Each has its own viewmodel and pose, and
  the hand cannon, the rotary and the launcher their own report.
- Checks (arsenal): the groups go round and remember, every one of the 27
  fires, the hand cannon hurts two in a line, the rotary fires nothing in
  its spin up and sixteen in the second after, four rockets out of the
  swarm, and the shell goes off 60 m out in a second and a half.

## 122. The weapons down the side

- The ask: a modern HUD with the weapons at the side, like Half-Life's but
  down the side.
- `src/ui/arms.js`: a row a number key down the left edge, the key in a box
  and the weapon it would give you under it with a bar of what is left of
  its magazine and reserve together. The row you are on has its key lit in
  the accent and the weapon in your hands a lit bar; a dry one is red. A pick
  by a key, the wheel or anything else opens that key's group, every weapon
  in it listed, for 2.4 s, and then the panel folds to one name a row and
  dims to 55 %. A kit is shown a weapon a key. Hidden in a vehicle, a mech
  (which has its own rows), in photo mode and while you are dying. Smaller
  at phone width.
- Checks (arsenal): ten rows 1 to 0 at the left edge, the right one lit and
  open with its four, the marksman rifle lit; folded and dimmed three
  seconds later; the Tactics kit is a weapon a key. Screenshots
  arsenal-01-side-panel.png and arsenal-02-rotary.png.

## 123. Kills make the suit better

- The ask: upgrades for killing them: more energy for the suit, more speed,
  a higher jump.
- In the manner of the second game's nano catalyst. `Nanosuit.feed(kind)`:
  a man is worth 1, a machine 2, an alien 3, a jeep, tank or jet 3, a mech
  8; the first step costs 3 and each after it 2 more; the steps go round
  energy, speed and jump, skipping one that is full, five of each. Energy
  is 20 on the bar a step (which comes full when the step is taken) and 15
  percent on the refill; speed is 6 percent on your feet and 0.12 on the
  sprint multiple; jump is 0.3 on the held jump's multiple, so five steps
  take it from 1.75 to 3.25. A kill in a hunt feeds it from `creditTarget`,
  a mech from its destruction and a vehicle of theirs from its; each step
  is a toast, a feed line, the charge chord and a flash on its pips. The
  suit's panel has five pips a track and a line to the next step. The steps
  are kept in the hunt's book and put back when the hunt carries on; a new
  hunt starts from none.
- Checks: unit (two new) on the order, the cost, the bigger bar coming full
  and refilling to its own top, quicker feet, a higher jump, the ceiling,
  and keeping them; hunt: three men and the bar is bigger and full, a mech
  and you are quicker, the book has it and the pips read 20 percent.
  Screenshot hunt-08-suit-upgrade.png.

## 124. Death from above, mechs included

- The ask: a takedown out of the jump, and onto their mechs: jump on one
  and take it out.
- In the air, F looks first for one of their mechs whose top you are within
  2.5 m below and 12 m above and within its radius and 3.5 m of, and then
  for a man 0.6 to 14 m below you, within 3.5 m and a third of a metre more
  for every metre of drop, ahead of you or under you. You go to him on a
  curve that gathers speed, a quarter of a second (a third for a mech), and
  the body is not stepped meanwhile.
- A man: dead, blood and a stain, a small blast of dust, and anybody within
  3.2 m knocked down and hurt by up to 140. A mech: no shield stops a hand,
  the reactor comes out with it, so it falls with none of the fusion blast
  a kill otherwise sets off (the one way out of a mech's 46 m blast from
  arm's length); 35 suit energy in a hunt, a second of slow motion, and you
  are thrown up at 1.9 times a jump and back the way you came. On foot in
  any mode; reaching a mech's back takes the suit's jump, the reflex leap or
  a roof. The hint over the crosshair says Takedown or Mech takedown while
  there is one.
- Checks (hunt): six metres over a man, F takes him (and nothing from the
  ground), you end on him, the man beside him is hurt, the kill feeds the
  suit; three metres over a Lynx, F kills it with no reactor left running,
  takes 35 energy, and you go up. Screenshot hunt-09-mech-takedown.png.

## 125. .BACKDOOR: the profiler and the phone

- The ask: a new mode, .BACKDOOR, where you hack your way into the city
  the way the Watch Dogs games do it: passers by, cars, buses, crimes like
  theft and brawls, and a great many things to hack. Built in four phases:
  this one is the mode and the phone, then traffic, then crime, then the
  city's own systems.
- What the games do, checked against the coverage of the first one (the
  PlayStation blog, the Watch Dogs wiki and reviews, found through a web
  search): a phone that profiles every citizen in the street, an app that
  finds crimes about to happen, and hacks on traffic lights, steam pipes,
  blockers, bridges, phones and cars, and a blackout of everything electric
  nearby for a short while. The names, facts and numbers here are ours.
- `src/game/backdoor.js`: `profileFor(seed)` is who somebody is (a name out
  of Berlin's mix, an age, a job and what it pays, one fact they would rather
  you did not know, and a record for about one in nine), the same person for
  the same seed every time. `pickTarget` is what the phone is pointed at:
  the nearest to the crosshair within 48 m and a cone that narrows a little
  with distance. `Phone` is the battery (100, back at 10 a second after
  0.8 s of rest), and a hack under way that wants the phone kept on its
  target until it is done and is lost, battery spent, if it is not.
- The mode: a button on the title card, the peaceful city with 18 people
  about where Just a Walk has 10, and the phone in the corner (battery in
  three cells, what you have taken, how many hacks). Pointed at somebody:
  a bracket round them, red for a record, and a card beside it with who
  they are and the two hacks, Q and E in place of the last weapon and the
  reflex. Q rings their phone (12 battery): they stop where they are and
  look at it for six seconds. E empties their account into yours (25
  battery, 1.4 s with the phone on them). The money is kept between visits.
- Checks: unit (4) on the same person for the same seed, the share with a
  record, the aim, and the battery and the lost hack; browser
  (tools/test-backdoor.mjs, 11, in CI as its own step): the button and its
  note, the street and the phone, the card and its hacks, nothing when
  pointed at nobody, Q stops a man on his way somewhere, E empties his
  account once and the money is kept, looking away loses it, a flat battery
  says so and fills again. Screenshot backdoor-01-profiler.png.

## 126. .BACKDOOR: traffic, and the phone in it

- Cars and buses on the real streets. `src/game/traffic.js` decides what
  each driver does: drive a centreline in the right hand lane (27 percent
  of the road's width right of the line, at most 2.4 m), steer for a point
  9 m ahead, at the end of a line take another that begins or ends within
  14 m of it, at random, or turn round if there is none. It waits behind
  whatever is in its lane (its own frame: ahead, and within 1.4 m across),
  passes what is coming the other way in the other lane, stops for anybody
  standing in the road, and a bus pulls in every 260 m for five seconds.
  Twelve cars and two buses round you, put on a stretch of road 45 to
  170 m off and let go past 210 m. Only carriageways are driven.
- Two new vehicles. A car (36 m/s at most, 320 hull), in one of six paints
  the instance picks through the channel a car has no rotor for (white,
  black, silver, blue, red, and the ivory of a Berlin taxi), and a yellow
  double decker bus (20 m/s, 1100 hull, twelve metres) with its line on a
  lit board. Neither has a gun; the vehicle panel hides its gun row.
- Traffic keeps off the buildings: a car or bus in the traffic does not
  smash through a wall unless the phone has its throttle. Two ground
  vehicles whose footprints overlap (boxes, by separating axes, not
  circles, since two cars in their own lanes pass closer than their
  circles and a bus is twelve metres) are pushed apart, and if they were
  closing faster than 3 m/s both stop, both are hurt by how fast, there
  are sparks and dust and a crash in the feed. A ground vehicle faster
  than 4 m/s hits whoever it drives into.
- The phone: a car in the traffic shows its plate (B for Berlin) and who
  it is registered to; Q stalls it (20 battery, dead for nine seconds) and
  E takes its throttle (30 battery): flat out for three and a half
  seconds at the nearest vehicle or person ahead of it, through a wall if
  one is in the way. A bus shows its line and how many are aboard; Q stops
  it and E opens its doors (15 battery, once a bus), and up to four get off
  onto the pavement. F at a car in the traffic throws the driver out and
  it is yours. A hack that takes no time goes through on the key.
- Checks: unit (7) on the roads indexed, the lane on the right, the next
  road at a junction and turning round, a car round a corner in its lane,
  waiting for its lane and a person and passing the other lane, the stall
  and the bus stop, and where a new one is put; browser (backdoor suite,
  nine more): the streets fill with cars and buses that drive, a car goes
  on along a street on the carriageway and stops for a man in its lane,
  the card, Q stalls it, E rams it into another and both are hurt, a bus's
  doors let its passengers off once, and F takes a car from its driver.
  Screenshot backdoor-02-traffic.png.

## 127. .BACKDOOR: crime in the street

- Somebody near you does something they should not, one at a time: the
  first fourteen seconds into a visit, then every 24 to 42 seconds, 35 to
  110 m off. `src/game/crime.js` runs each one as a small machine and the
  game layer picks who is in it, does the hitting and keeps the score.
- Two kinds. A bag theft: the thief walks up to somebody (1.7 m/s, his
  victim standing there with no idea), takes the bag at 1.5 m and runs
  (4.7 m/s, you run 5.6) away from both of you; past 120 m from you after
  six seconds of running, he is gone. A fight: one walks up to another,
  they square up, and he lands a blow every 0.85 seconds (11 health a
  blow), the other giving one back every third, until somebody stops it,
  the victim is down, or a minute is up. Nothing goes on for longer than a
  minute.
- The phone hears of it first: a toast with what, how far and which way, a
  line on the phone with the same while it goes on, a red diamond with the
  distance over the offender, and pointed at him his card calls him the
  offender, his record the crime in progress.
- Stopping it: a takedown (F within reach) puts the offender down alive,
  subdued, which is the best way (rep +10); Q ringing his phone in a fight
  breaks it up (+8), and a thief stops to look at it, long enough to catch
  him; shot dead it is stopped too, for less (+4). A thief who gets away
  costs 5, a victim on the ground 8, and in .BACKDOOR shooting somebody who
  was only walking down the street costs 12. A crime stopped pays 60 to
  240 into the account. Your good name and how many you stopped are on the
  phone and kept between visits.
- The offender is a civilian with somewhere to be: the people in the
  street take a directive from the crime (where to go, how fast, which way
  to face), and a bold one ignores the panic round him but not his phone.
- Checks: unit (5) on the theft, the getaway, subdued and killed, the fight
  and its blows, broken up by a phone, and the time limit; browser
  (backdoor suite, eight more): a crime starts and the phone says so, the
  thief takes the bag and runs, the card and the mark, Q then F stop him
  and pay, a fight with blows, broken up by a ring, a thief nobody stops
  gets away, and an innocent shot costs your name. Screenshot
  backdoor-03-crime.png.

## 128. .BACKDOOR: traffic lights, and the phone in them

- Lights where a bigger road (primary, secondary, tertiary, trunk) meets
  another, crossing it or ending on it, with at least three ways out in two
  directions. The map fetch keeps the roads and not the signal nodes, so
  `junctionsOf` in `src/game/traffic.js` works them out from where the
  centrelines meet: two segments that cross, or the end of one within 6 m
  of another, merged within 15 m, and the ways out read off the lines that
  pass (both ways) or end there (one way). The axis is the widest road's;
  whatever crosses it is the other direction. On the offline Mitte that is
  39 junctions, among them Unter den Linden at Wilhelmstrasse, Glinkastrasse
  and Friedrichstrasse; two quiet streets crossing get none.
- The German order, checked against sources: green for ten seconds, amber
  for three (the time for 50 km/h), red, and red and amber together for the
  last second before green, which the RiLSA 2015 sets at one second; two
  seconds of red both ways between the two directions. Each junction is
  offset from the next so a street does not change all at once.
- A driver watches for the light ahead (18 m plus his speed): at red, or at
  red and amber, he stops 2 m short of the junction; at amber he stops if
  he still can at 5 m/s2 and goes on if he cannot; over the line he goes on
  whatever it shows. A dark junction is crawled through at 5 m/s.
- A mast for every way in, on the right of whoever is coming, facing them:
  a thin pole, a near black housing with a board behind it and three lamps
  under visors, lit by the shader from what the instance says it shows.
  Up to 96 drawn, the nearest first.
- The phone: pointed at a mast it shows the junction by its streets and
  what each direction shows. Q turns it red both ways for ten seconds (15
  battery) and the traffic piles up at it; E turns it green both ways for
  eight (30 battery), and a driver who has green both ways pays no
  attention to anybody crossing, which is how the crash happens.
- Fixed on the way: a passer by appeared through the sphere of light that
  machines and soldiers arrive in, and everybody within 35 m of it ran,
  which in .BACKDOOR (eighteen people, topped up all the time) meant
  somebody was always running. `spawnNear` now takes whether it arrives,
  and `spawnCivilianNear` says no, as its comment always said it did. It
  showed up as a crime victim who walked off mid crime.
- Checks: unit (5 signals, 1 civilians) on where the lights are and are
  not, the order and the amber time, never green both ways, a car that
  waits at red and goes on green, two that meet on green both ways, held
  on red both ways, a crawl through a dark junction, and a passer by who
  frightens nobody; browser (backdoor suite, six more): the masts are
  there and drawn, the German order off the game clock, the card, Q holds
  a car short of the junction, E lets it through, and two cars from two
  ways crash on green both ways. Screenshot backdoor-04-lights.png.

## 129. .BACKDOOR: steam pipes under the street, and a blackout

- A cover over the steam pipe in the road, every 85 m along every
  carriageway, on its line, never in a junction or within 10 m of one and
  never two within 14 m (two lines down the same street would otherwise
  give two of everything). `src/game/city.js` works out where they are from
  the same centrelines as the traffic and the lights, the same every time.
  A cast iron disc on the road, drawn through the actor shader like the
  masts; red hot while it is about to go, a black hole once it has.
- The phone, pointed at a cover: Q vents steam (10 battery) for eight
  seconds, a white column across the road that the traffic stops short of
  and the people near it walk away from; E blows it (35 battery): a hiss and
  a red glow for 1.2 seconds, which is the warning and which the people
  near it take, then the blast. Anything on four wheels within 7 m goes up,
  at 9 m/s at the middle and less towards the edge (a bus half that),
  turning over a little, comes down where it comes down, and is hurt by up
  to 45 percent of its hull; anybody within 6 m is knocked off their feet
  and slid along the ground, and gets up again; you, if you are that near,
  take up to 20. The hole pours steam for six seconds and is a cover again
  after forty.
- Ground vehicles can leave the ground now (`vehicles.launch`): up, a
  little tumble, gravity, down, half the speed gone. People can be knocked
  down without a banana (`soldiers.knockDown`), and passers by now get up
  from a fall the way soldiers always did; the slide is one function for
  both.
- B is the blackout, on a key of its own, as in the game this is after:
  it takes the whole battery and cuts the power for fifteen seconds. The
  lit windows and the lamps go out (the renderer's night window light, the
  one the lamp glass uses too, times what is left of the power), the
  lights at every junction go dark and the traffic crawls through them,
  everybody within 160 m stops and looks at a phone with no signal, and the
  phone says how long is left. It comes back over a second and a half with
  a flicker.
- Checks: unit (4) on where the covers are and are not, the vent, the
  fuse, the blast and the spent cover, the blast falling off to its edge,
  and the blackout's clock with the flicker coming back; browser (backdoor
  suite, six more): the covers are there, drawn and hackable, Q stops a car
  short of the steam and lets it go after, E throws a car on it 2.2 m up
  and knocks a man beside it flat, and B at one in the morning, looking
  the brightest way round (the live city and the offline one have their
  buildings in different places), takes the view from 81.3 to 4.0 in mean
  brightness, darkens every mast, stops the people, cannot be done twice,
  and comes back. Screenshots
  backdoor-05-steam.png, backdoor-06-night.png and
  backdoor-07-blackout.png.

## 130. The title in three pages, the build under it, and the hour for every game

- The title card is three pages in the one overlay. The start: the
  Brandenburg Gate, SPREE|FALL. (the dot in the accent), the line on what
  this is, Neues Spiel, and under it the build. Neues Spiel: the seven games
  one under another as a menu, the last one played marked, and Zurück. A
  game: its name, what it is, its settings, Spielen and Zurück. Zurück is one
  page back from each. Past the start the logo and the name step back so a
  list of seven fits a short screen. Berlin is listed as Berlin Phototour and
  says so: twelve landmarks to find, P for the camera.
- The build line: `build 263 | 24.10.2026 um 01:30`, on Berlin's own clock
  whatever the visitor's is. `tools/build-dist.mjs` writes version.json next
  to the page with the workflow's run number, the commit and the time;
  `tools/serve.mjs` answers version.json from git when there is none on the
  disk (build dev, the last commit's time); a page with neither says
  `build dev`. `src/ui/version.js` formats it, with unit checks for summer
  and winter time and for a missing or broken file.
- The hour a game starts at can be picked on its page for every game, not
  only Rise of the Machines, and the city behind the title shows it as the
  slider moves; it is kept between visits, and a link's own hour wins. The
  cheat menu has the time of day too, at any time, with the photo mode's
  slider kept in step.
- The difficulty is shown only where anybody is shooting at you (not Just a
  Walk, not .BACKDOOR). The buttons say Spielen, and with an operation under
  way Weiterspielen and Neu anfangen, the progress in the line above.
- Every element the game and the checks already used (the mode buttons, the
  play button, the operation's setup) is the same element in its new place.
- Checks: unit (3 version); browser (ui suite, four more): the start page,
  the seven games and Zurück, a game's page with its name, settings,
  Spielen and Zurück, and the hour moving the sky; (cheats suite, one more)
  the cheat menu's clock; the hunt suite's title check reads the new
  buttons. Screenshots ui-01-title.png, ui-01b-modes.png, ui-01c-mode.png.

## 131. Esc: the pause down the left side, with every game a click away

- Esc in the street stops the world and puts a bar down the left edge: the
  name, Pause, Weiter, the seven games under Spiel wechseln with the one
  being played marked, and Hauptmenü at the foot. The city stays in view to
  the right of it, dimmed. Esc again, Weiter, or a click beside the bar
  carries on; Weiter and the click take the mouse back, Esc cannot (the
  browser does not count Esc as a gesture), so the next click does.
- The browser lets the mouse go before the page hears Esc, so the pause
  opens on the mouse coming free in the street as well, which also covers
  a switch to another window. Where one of our own panels took the mouse
  (the cheat menu, the operation panel, the big map, the target map, the
  bomb question, the crossing card, the completion card, the death card)
  it does not, and photo mode keeps its free mouse.
- Only the game's own step stops: the loop's fixed step is skipped while
  paused, so nothing moves, burns down or counts down, and the frame is
  still drawn.
- A game picked from the bar starts at once where you stand: no title and
  no flight in. Whatever the last game had out is cleared first (you are
  taken out of a mech or a vehicle, a bomb question is answered no, the
  soldiers, mechs, vehicles, jets, shots, a crime under way, a blackout and
  hacked lights all go), then the game is set up as Spielen would set it
  up, with its own weapons and the hour picked on the title. Hauptmenü
  reloads the page onto the start.
- Checks: browser (ui suite, six more): Esc opens the bar at the left edge
  and at most 400 px wide, a second and a half of the real loop moves the
  clock not at all, the seven games are listed with the one being played
  marked, Esc and Weiter each carry on, a game picked there starts at once
  within five metres of where you stood with the phone up for .BACKDOOR,
  and the bar then marks .BACKDOOR and goes back to Berlin the same way.
  The URL check now closes the pause it opens by letting the mouse go.
  Screenshot ui-09-pause.png.

## 132. The shield on the left arm, out of the line of sight

- The ask: the shield should not sit in the middle of the screen, where it
  hides everything, but to the left the way Doom has it. (The shield saw is
  from DOOM: The Dark Ages, where it is held on the left trigger; its
  players make the same complaint about a raised shield.)
- At the hip it sat a little left of the middle at two thirds of a metre,
  which at the viewmodel's 55 degree lens is a disc over most of the frame;
  held up it took the shared aim pose, which puts a sight on the centre
  line, and so put the shield dead in front of your eyes.
- Now a pose of its own for both. At the hip a quarter of it shows in the
  bottom left corner. Held up it covers the left third of the screen with
  its face turned in, the crosshair and the street clear to the right of
  it. The block itself is unchanged: it still stops fire from in front and
  a raise just in time still sends it back.
- Checks: ops suite, one more: where the disc falls on the screen worked
  out from the pose and the lens, at the hip and held up, its middle left
  of two fifths of the way out and its nearest edge left of the crosshair
  by a tenth of the half width (measured: middle -1.09 and -0.78, edge
  -0.57 and -0.22). The arsenal suite screenshots it:
  arsenal-03-shield-hip.png and arsenal-04-shield-up.png.

## 133. Eight more, out of Crysis, DOOM, Far Cry and Halo

- The ask: more weapons, the way Crysis, Doom, Far Cry and Halo have them.
  Eight, each the idea of one weapon there under a name and numbers of our
  own, and checked against what the sources say the weapon does:
  - Hailstorm, after Crysis 3's Typhoon, eight barrels that do not turn and
    about 500 rounds a second
    ([MP1st](https://mp1st.com/news/the-7-wonders-of-crysis-3-episode-4-typhoon),
    [Game Informer](https://gameinformer.com/games/crysis_3/b/xbox360/archive/2013/01/16/new-crysis-3-video-shows-off-the-mighty-typhoon.aspx)).
    Here: three rounds a pull, thirty pulls a second, 12 each, wide and
    short, a 150 pull drum. No spin up, because the barrels do not turn.
  - The volt caster, after the K-Volt of Crysis 2 and 3, which fires
    electrified pellets ([Crysis wiki](https://crysis.fandom.com/wiki/File:Kvoltreflex.png)).
    Here: 20 a hit, and the charge holds whoever it hit for 1.2 s and jumps
    on to the nearest other within 7 m, and from him to the next, three
    jumps at most at 70 % each, never back. The hold and the jumps are ours.
  - The arbalest, after DOOM Eternal's Ballista, whose bolt sticks into the
    target and goes off a short time later
    ([DoomWiki](https://doomwiki.org/wiki/Ballista)). Here: a bolt at
    130 m/s, 60 going in, and 0.45 s later a 6 m blast of 210; in a man it
    rides on him until then.
  - The disc ripper, after Far Cry New Dawn's saw launcher, whose blades
    ricochet off any surface but the floor
    ([Wikipedia](https://en.wikipedia.org/wiki/Far_Cry_New_Dawn),
    [Trusted Reviews](https://trustedreviews.com/reviews/far-cry-new-dawn)).
    Here: a blade at 38 m/s, 140 into everybody it passes through, off a
    wall at the speed it arrived four times, and into the ground for good.
  - The flare pistol, after Far Cry's, which ignites what it lands in
    ([Far Cry wiki](https://farcry.fandom.com/wiki/File:FC3_Flare_Gun_Iron_Sights.png)).
    Here: a slow arc, a small pop, and three pools of fire for 8 s.
  - From Halo (Halopedia on the [plasma grenade](https://halopedia.org/Type-1_plasma_grenade/Gameplay),
    the [sword's lunge](https://halopedia.org/Grenade_lunge) and the
    [gravity hammer](https://halopedia.org/Gravity_hammer/Gameplay)): the cling
    charge, which holds on to the first thing it touches and goes off 1.1 s
    later (7 m, 250), riding on a man wherever he goes; the lunge blade, 600
    a cut within 2.6 m, and within 9 m and a narrow cone in front it takes
    you onto him at 30 m/s first, stopping at a wall; and the quake hammer,
    brought down in front of you: everybody in the half circle out to 7 m
    takes up to 220 and whoever lives is knocked off his feet, a car or bus
    goes into the air, and none of it touches you.
- Groups: 1 Hailstorm, 3 the arbalest and the ripper, 4 the cling charge, 6
  the blade and the hammer, 7 the flare pistol, 8 the volt caster. 35 in
  all. The kits of Tactics, Slayer and The Hunt are unchanged.
- The stun the EMP put on machines is now anybody's: the volt caster sets the
  same timer on a man and he stands still while it runs.
- Projectiles: `cling` on a kind (the bolt and the cling charge) holds on to
  what it touched and shortens the fuse to that many seconds, and if that
  was somebody it keeps its place on him; `blade` (the disc) goes through
  bodies, reflects off walls at full speed and stops in the ground. The disc
  cuts through the same handler as the shield saw, at its own damage.
- Each has its own viewmodel (two new viewmodel colours: a hot orange and an
  electric blue white, and an orange red plastic for the flare pistol), its
  own pose, and the four that fly their own shapes. The two you swing are
  not brought onto the centre line by the second trigger.
- Checks (arsenal suite, ten more): Hailstorm puts out thirty pulls in a
  second and a man at 18 m does not last it; the volt caster's charge jumps
  to the two near the one it hit and not to the one 15 m off, and they hold
  still while it has them; the arbalest's bolt holds and goes off and he is
  dead; the cling charge holds, goes where he goes and kills him; the ripper
  goes through two in a line and comes off a wall at 38 m/s; the blade
  lunges 5 m onto a man 7 m off and kills him, and does not go for one at
  15 m; the hammer floors the three in front, throws the car, and leaves the
  one behind and you untouched; the flare leaves three pools and they burn
  a man standing in one. Every weapon in the loadout still fires.
  Screenshots arsenal-05-hailstorm.png, arsenal-06-blade.png,
  arsenal-07-hammer.png, arsenal-08-flare.png.

## CI: the EMP check clears the street in front of the launcher

- The machines suite's EMP launcher check fired at a group of four at 54 m
  and the warhead went off a fifth of a second out, a metre off the ground:
  something just in front of you that the world's own ray cannot see. The
  mode keeps its own mechs, drones and vehicles about, and they are now
  taken off the street with the soldiers before the shot; and the line is
  tested from where the barrel is (lower, and to either side) as well as
  from the eye.

## CI: .BACKDOOR in the live city, where an avenue has two carriageways

- The first run of the .BACKDOOR suite against the live extract failed
  five checks, and four of them were one thing the offline city does not
  have: Unter den Linden is two carriageways forty metres apart, so a street
  across it meets two lines and makes two junctions, each with lights of
  its own timing. A car through the one it was let through met the other
  at red; two cars sent at each other on green both ways stopped short of
  each other; a car let go after the steam stopped waited at a light down
  the road. Real lights at such a crossing are one installation, and so are
  these now: junctions within 45 m of each other are one crossing, with the
  axis of the widest road among them, one timing, and a hack on any mast of
  it is a hack on all of it. A unit check holds an avenue's two
  carriageways to one light.
- The fifth: pointed at a car in the traffic, the phone got the steam cover
  in front of it, because a car parked at the kerb hid the middle of the
  one in the road. A vehicle counts as seen now if its roof is (a car
  1.55 m up, a bus 4.3 m), and the check steps up to the kerb if something
  is still in the way.
- The order of the lights is checked as every change being the next in the
  German order and the whole round seen, wherever the clock happens to be
  when the check starts; the live run began at amber. The steam check holds
  any lights within 120 m green, so a car waiting at red cannot pass for a
  car waiting for the steam.

## CI: a runway measured the width of the wings, and the panel against the hull

- The city suite's fighter rolled into something and burnt out on the
  ground (hull 0, two metres down, no speed). Its runway was the clearest
  of 32 directions, measured by one ray down the middle at three metres,
  and the checks before it leave heaps of rubble at knee height and ruins
  at the side of the street: neither is on that ray. The run is now the
  shortest of nine rays, at 0.7, 1.6 and 3 m, down the middle and 4.5 m
  either side for the wings. Measured like that, the next run in the live
  city showed the rest of it: where the checks before leave you there was
  33 m of room in any direction. So the long straight streets round the
  square (150 m and more of one line, within 900 m) are tried as well, from
  either end, and the fighter is put at the start of the clearest of all
  of them: 400 m offline.
- The panel check that drives a tank for three seconds wanted the hull at
  exactly 100 percent, and a tank that drove through the fire the wrecks
  before it left on the street came out at 99. The fire is put out first,
  as the takeoff already did, and the panel is held to what the hull really
  is, at no less than 90 percent.

## CI: the compass lost its bearing to the crime line

- The ops suite went red on the compass: facing the nearest camp, the bar
  put it behind you, and facing your own mark, off to one side. Phase 127
  gave the crime line a little helper for the eight points of the compass
  (how a toast says "92 m SW") and called it `bearing`, inside the same
  function as everything else in `main.js`, where it hid the compass's own
  `bearing` in degrees, imported from `ui/compassbar.js`. The compass was
  handed "SW" for an angle. The helper is `pointOf` now; every other name
  the .BACKDOOR phases added was checked for the same thing and none
  clashes.
- The suit pips check in The Hunt read the HUD after a fixed 400 ms, and on
  a slow runner the frame that draws them had not come yet (master's run
  after the merge of #22 read 0 percent). It waits for that frame now, up
  to eight seconds.

## CI: the machines suite stands the run up before it aims

- Since phase 120 dying is four seconds of a camera going round the body,
  and the machines suite gets killed by its own machines before the EMP
  launcher and the bite out of the city. Both aim or look along the camera,
  so the EMP warhead went into the street at the player's feet in a tenth
  of a second and the bite was measured from the orbit. A `standUp()` in
  the page presses the button first. Stood up and in the open, the bite's
  heap comes out 94 to 100 per cent darker from run to run where it was
  measured from the floor before; the bar is nine in ten now, which a hole
  showing sky (thousands of brighter pixels) still fails. The respawn also
  had a bug of its own: the rifle came back in your hands under the name
  of whatever you had held, now told to the HUD (checked in the hunt suite).
- The same in the other suites that can get you killed: the city's fighter
  is stood up and the wreck fires put out before it rolls, the ops suite's
  `fresh()` and the shield saw stand the run up (killed, its stepping loops
  ran at a fifth of the speed, so ninety seconds of convoy was eighteen),
  and the convoy is measured in god mode. The interface check that 6 is the
  banana now presses 4 through the thrown things to it, since 6 is the
  close group from phase 121.
- And the death camera's own check sampled by the clock, so on a CI runner
  that draws a frame or two a second its first look came before the first
  frame of the orbit, with the camera still in your head. It now waits for
  the orbit to get 0.1, 0.6 and 1.6 s round, and reads the slow motion from
  the time scale (a fifth) rather than from the death clock.
- And the district suite's drop check: the city streams round the camera,
  so a run killed before it held the district where its body lies while
  the player was teleported 27 km off. It stands the run up first and says
  so when it had to.

## CI: the combat checks find their lines instead of assuming them

- The browser checks in CI have been red since phase 92 on two combat
  checks that pass here: the Gate stopping a shot, and the weapon firing in
  the memorial. CI builds the city from the live Overpass extract and this
  container from the synthetic one (Overpass and the Pages site cannot be
  reached from here), and since the Gate became walkable in phase 87 where
  its walls and passages fall, and how tall the stelae stand near the middle
  of the memorial, depend on which. The Gate check now walks z out from the
  Gate's landmark until a level shot west from the square stops within ten
  metres of it, and the memorial check puts its drone out over the stelae in
  the first of sixteen directions with a clear line from the eye.
- And the next one along in CI, the city check that a shell opens the wall:
  it read the hole from the first mark in the ring, and in the live city the
  blast sets off something else (a car, a tree) that puts its own mark there
  first. It now takes the mark that punches.
- And a third, in the cheats: overkill's skeleton was asked for more than
  twenty bones, out of thirty three pieces each bone four times in five with
  later bursts taking the oldest slots of a full pool. CI drew exactly
  twenty. It asks for twelve now, a skeleton's worth.
