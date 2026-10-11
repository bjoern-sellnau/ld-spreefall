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
