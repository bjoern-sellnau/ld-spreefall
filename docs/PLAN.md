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
