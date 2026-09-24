// The renderer. Owns the GL state, the shadow cascades, the render queue and
// the post chain, and nothing else.

import {
  createProgram, UniformBlock, UBO_CAMERA, Framebuffer, createTexture,
} from '../engine/gl.js';
import { mat4, vec3, Frustum, clamp } from '../engine/math.js';
import { SKY_VS, SKY_FS } from '../shaders/sky.js';
import { WORLD_VS, WORLD_FS, SHADOW_VS, SHADOW_FS } from '../shaders/world.js';
import { TREE_VS, TREE_FS, TREE_SHADOW_VS, TREE_SHADOW_FS } from '../shaders/trees.js';
import { FULLSCREEN_VS, BRIGHT_FS, BLUR_FS, COMPOSITE_FS } from '../shaders/post.js';
import { sunDirection, sunColour, berlinDate } from './sun.js';
import { Actors } from './actors.js';

// std140 layout, see src/shaders/common.js
const CAM_FLOATS = 112;
const OFF = {
  viewProj: 0, view: 16, invViewProj: 32,
  camPos: 48, sunDir: 52, sunColour: 56,
  skyZenith: 60, skyHorizon: 64, fog: 68,
  shadowMat0: 72, shadowMat1: 88, shadowSplit: 104, misc: 108,
};

export const QUALITY = {
  low: { shadow0: 1024, shadow1: 1024, bloom: false, fxaa: false, scale: 0.72, shadows: true, treeDist: 240 },
  medium: { shadow0: 1536, shadow1: 1024, bloom: true, fxaa: true, scale: 0.9, shadows: true, treeDist: 420 },
  high: { shadow0: 2048, shadow1: 1536, bloom: true, fxaa: true, scale: 1.0, shadows: true, treeDist: 700 },
};

export class Renderer {
  constructor(gl, caps, world, tiles) {
    this.gl = gl;
    this.caps = caps;
    this.world = world;
    this.tiles = tiles;
    this.quality = 'high';
    this.q = QUALITY.high;
    this.stats = { drawCalls: 0, triangles: 0, tiles: 0, shadowDraws: 0 };

    this.camBlock = new UniformBlock(gl, CAM_FLOATS, UBO_CAMERA);
    this.cam = this.camBlock.data;

    this.progWorld = createProgram(gl, WORLD_VS, WORLD_FS, 'world');
    this.progSky = createProgram(gl, SKY_VS, SKY_FS, 'sky');
    this.progShadow = createProgram(gl, SHADOW_VS, SHADOW_FS, 'shadow');
    this.progTree = createProgram(gl, TREE_VS, TREE_FS, 'tree');
    this.progTreeShadow = createProgram(gl, TREE_SHADOW_VS, TREE_SHADOW_FS, 'treeShadow');
    this.progBright = createProgram(gl, FULLSCREEN_VS, BRIGHT_FS, 'bright');
    this.progBlur = createProgram(gl, FULLSCREEN_VS, BLUR_FS, 'blur');
    this.progComposite = createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite');

    this.emptyVao = gl.createVertexArray();

    const pal = new Float32Array(64 * 3);
    const src = world.manifest.facadePalette || [];
    for (let i = 0; i < 64; i++) {
      const c = src[i % Math.max(1, src.length)] || [200, 190, 170];
      // sRGB to linear, so the lighting maths is done in the right space.
      for (let k = 0; k < 3; k++) {
        const v = c[k] / 255;
        pal[i * 3 + k] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      }
    }
    this.palette = pal;
    this.progWorld.use();
    const loc = this.progWorld.loc('uPalette');
    if (loc) gl.uniform3fv(loc, pal);
    this.progWorld.int('uShadow0', 4).int('uShadow1', 5).int('uDebugMode', 0);
    this.debugMode = 0;
    this.progTree.use().int('uShadow0', 4).int('uShadow1', 5);

    this.actors = new Actors(gl, caps);
    this.drawActors = true;
    this.viewmodel = null;      // set by the game layer each frame, or null
    this.reflex = 0;            // 0 to 1, how far into slowed time we are

    this.shadowFbo = [];
    this.sceneFbo = null;
    this.bloomFbo = [];
    this.width = 1; this.height = 1;
    this.renderScale = 1;

    this.sunDir = new Float32Array(3);
    this.sunCol = new Float32Array(3);
    this.lightView = mat4.create();
    this.lightProj = mat4.create();
    this.lightVp = [mat4.create(), mat4.create()];
    this.biasMat = new Float32Array([
      0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1,
    ]);
    this.shadowMat = [mat4.create(), mat4.create()];
    this._tmp = mat4.create();
    this._boxTiles = [];
    this.shadowSplits = [110, 460];
    this.timeOfDay = 17.4;
    this.dayOfYear = 166;
    this.exposure = 1.70;
    this.fogDensity = 0.00075;
    this.shadowsEnabled = true;

    this.setQuality('high');
  }

  setQuality(name) {
    const q = QUALITY[name] || QUALITY.high;
    this.quality = name;
    this.q = q;
    this.renderScale = q.scale;
    this.tiles.setQuality(name);
    this._buildShadowTargets();
    if (this.width > 1) this.resize(this.cssWidth, this.cssHeight, this.dpr);
  }

  _buildShadowTargets() {
    const gl = this.gl;
    for (const f of this.shadowFbo) f.dispose();
    this.shadowFbo = [];
    for (const size of [this.q.shadow0, this.q.shadow1]) {
      this.shadowFbo.push(new Framebuffer(gl, size, size, {
        colour: false, depth: true, compareDepth: true,
      }));
    }
  }

  resize(cssWidth, cssHeight, dpr) {
    const gl = this.gl;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;
    const w = Math.max(2, Math.round(cssWidth * dpr * this.renderScale));
    const h = Math.max(2, Math.round(cssHeight * dpr * this.renderScale));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    if (this.sceneFbo) this.sceneFbo.dispose();
    for (const f of this.bloomFbo) f.dispose();
    const halfFloat = this.caps.colourBufferHalfFloat || this.caps.colourBufferFloat;
    this.sceneFbo = new Framebuffer(gl, w, h, {
      internalFormat: halfFloat ? gl.RGBA16F : gl.RGBA8,
      format: gl.RGBA,
      type: halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      depthBuffer: true,
    });
    this.bloomFbo = [];
    if (this.q.bloom) {
      const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
      for (let i = 0; i < 2; i++) {
        this.bloomFbo.push(new Framebuffer(gl, bw, bh, {
          internalFormat: halfFloat ? gl.RGBA16F : gl.RGBA8,
          format: gl.RGBA,
          type: halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        }));
      }
    }
  }

  /** Sun, sky and fog for the current time of day. */
  updateSky(camera, time) {
    const date = berlinDate(this.dayOfYear, this.timeOfDay);
    const { altitude } = sunDirection(date, 52.5163, 13.3777, this.sunDir);
    sunColour(altitude, this.sunCol);
    const night = clamp((0.06 - altitude) / 0.30, 0, 1);
    const dusk = clamp(1 - Math.abs(altitude) / 0.22, 0, 1);

    // Zenith goes from a deep daylight blue to near black, the horizon warms
    // through the golden hour and then cools off.
    const dayZ = [0.085, 0.170, 0.340];
    const nightZ = [0.008, 0.012, 0.028];
    const dayH = [0.60, 0.72, 0.88];
    const duskH = [0.72, 0.36, 0.17];
    const nightH = [0.030, 0.038, 0.062];
    const zen = [0, 0, 0], hor = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      zen[i] = dayZ[i] * (1 - night) + nightZ[i] * night;
      const warm = dayH[i] * (1 - dusk) + duskH[i] * dusk;
      hor[i] = warm * (1 - night) + nightH[i] * night;
    }

    const c = this.cam;
    c.set(camera.viewProj, OFF.viewProj);
    c.set(camera.view, OFF.view);
    c.set(camera.invViewProj, OFF.invViewProj);
    c[OFF.camPos] = camera.position[0];
    c[OFF.camPos + 1] = camera.position[1];
    c[OFF.camPos + 2] = camera.position[2];
    c[OFF.camPos + 3] = time;
    c[OFF.sunDir] = this.sunDir[0];
    c[OFF.sunDir + 1] = this.sunDir[1];
    c[OFF.sunDir + 2] = this.sunDir[2];
    c[OFF.sunDir + 3] = altitude;
    c[OFF.sunColour] = this.sunCol[0];
    c[OFF.sunColour + 1] = this.sunCol[1];
    c[OFF.sunColour + 2] = this.sunCol[2];
    c[OFF.sunColour + 3] = this.shadowsEnabled && this.q.shadows ? clamp(altitude * 6, 0, 1) : 0;
    c[OFF.skyZenith] = zen[0]; c[OFF.skyZenith + 1] = zen[1]; c[OFF.skyZenith + 2] = zen[2];
    c[OFF.skyZenith + 3] = night;
    c[OFF.skyHorizon] = hor[0]; c[OFF.skyHorizon + 1] = hor[1]; c[OFF.skyHorizon + 2] = hor[2];
    c[OFF.skyHorizon + 3] = dusk;
    // Fog tuned so the Fernsehturm is a silhouette from the Gate, 3.3 km away,
    // rather than either invisible or perfectly crisp.
    c[OFF.fog] = this.fogDensity;
    c[OFF.fog + 1] = 0.030;
    c[OFF.fog + 2] = 26.0;
    c[OFF.fog + 3] = camera.far;
    c[OFF.misc] = this.exposure;
    c[OFF.misc + 1] = clamp(night * 1.1 + dusk * 0.35, 0, 1);
    c[OFF.misc + 2] = this.quality === 'low' ? 0 : this.quality === 'medium' ? 1 : 2;
    c[OFF.misc + 3] = 1.0;
    this.night = night;
    this.sunAltitude = altitude;
  }

  /** Fit an orthographic light frustum around a slice of the view. */
  _fitCascade(camera, near, far, size, out) {
    // Centre the cascade on the middle of the slice, snapped to texels so the
    // shadow does not shimmer when the camera moves.
    const cx = camera.position[0] + camera.forward[0] * (near + far) * 0.5;
    const cz = camera.position[2] + camera.forward[2] * (near + far) * 0.5;
    const cy = camera.position[1];
    const radius = (far - near) * 0.62 + 12;

    const lx = this.sunDir[0], ly = Math.max(0.12, this.sunDir[1]), lz = this.sunDir[2];
    const dist = radius * 2.4 + 260;
    const eye = [cx + lx * dist, cy + ly * dist, cz + lz * dist];
    const up = Math.abs(ly) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    mat4.lookAt(this.lightView, eye, [cx, cy, cz], up);

    const texel = (radius * 2) / size;
    // Snap the centre in light space.
    const centreLs = [0, 0, 0];
    vec3.transformMat4(centreLs, [cx, cy, cz], this.lightView);
    const sx = Math.round(centreLs[0] / texel) * texel - centreLs[0];
    const sy = Math.round(centreLs[1] / texel) * texel - centreLs[1];

    mat4.ortho(this.lightProj, -radius + sx, radius + sx, -radius + sy, radius + sy, 1, dist * 2 + 600);
    mat4.multiply(out, this.lightProj, this.lightView);
    return radius;
  }

  renderShadows(camera) {
    const gl = this.gl;
    if (!this.q.shadows || !this.shadowsEnabled || this.sunAltitude < 0.02) {
      // Still clear so the sampler reads as fully lit.
      for (const f of this.shadowFbo) {
        f.bind();
        gl.clearDepth(1);
        gl.clear(gl.DEPTH_BUFFER_BIT);
      }
      for (let i = 0; i < 2; i++) mat4.identity(this.shadowMat[i]);
      return;
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.colorMask(false, false, false, false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.6, 3.0);
    gl.disable(gl.CULL_FACE);

    const ranges = [[0, this.shadowSplits[0]], [this.shadowSplits[0] * 0.75, this.shadowSplits[1]]];
    let draws = 0;
    for (let i = 0; i < 2; i++) {
      const size = i === 0 ? this.q.shadow0 : this.q.shadow1;
      const radius = this._fitCascade(camera, ranges[i][0], ranges[i][1], size, this.lightVp[i]);
      mat4.multiply(this.shadowMat[i], this.biasMat, this.lightVp[i]);

      const f = this.shadowFbo[i];
      f.bind();
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      const cx = camera.position[0] + camera.forward[0] * (ranges[i][0] + ranges[i][1]) * 0.5;
      const cz = camera.position[2] + camera.forward[2] * (ranges[i][0] + ranges[i][1]) * 0.5;
      const pad = radius + 240;
      const list = this.tiles.collectBox(cx - pad, cz - pad, cx + pad, cz + pad, this._boxTiles);

      this.progShadow.use().mat4('uLightViewProj', this.lightVp[i]);
      for (const tile of list) {
        if (!tile.vao) continue;
        this.progShadow.vec3('uTileOrigin', tile.ox, 0, tile.oz);
        gl.bindVertexArray(tile.vao);
        gl.drawElements(gl.TRIANGLES, tile.count, tile.indexType, 0);
        draws++;
      }

      if (i === 0 && this.drawActors) {
        draws += this.actors.drawDroneShadows(this.lightVp[i]);
        draws += this.actors.drawSoldierShadows(this.lightVp[i]);
      }

      if (i === 0) {
        this.progTreeShadow.use().mat4('uLightViewProj', this.lightVp[i]);
        for (const tile of this.tiles.resident.values()) {
          if (!tile.treeVao) continue;
          if (tile.maxX < cx - pad || tile.minX > cx + pad || tile.maxZ < cz - pad || tile.minZ > cz + pad) continue;
          gl.bindVertexArray(tile.treeVao);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, tile.treeCount);
          draws++;
        }
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.CULL_FACE);
    this.stats.shadowDraws = draws;

    const c = this.cam;
    c.set(this.shadowMat[0], OFF.shadowMat0);
    c.set(this.shadowMat[1], OFF.shadowMat1);
    c[OFF.shadowSplit] = this.shadowSplits[0];
    c[OFF.shadowSplit + 1] = this.shadowSplits[1];
    c[OFF.shadowSplit + 2] = 1 / this.q.shadow0;
    c[OFF.shadowSplit + 3] = 1 / this.q.shadow1;
  }

  renderScene(camera, visible) {
    const gl = this.gl;
    this.sceneFbo.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowFbo[0].depth);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowFbo[1].depth);
    gl.activeTexture(gl.TEXTURE0);

    let draws = 0, tris = 0;
    this.progWorld.use();
    this.progWorld.int('uDebugMode', this.debugMode);
    for (const tile of visible) {
      if (!tile.vao) continue;
      this.progWorld.vec3('uTileOrigin', tile.ox, 0, tile.oz);
      gl.bindVertexArray(tile.vao);
      gl.drawElements(gl.TRIANGLES, tile.count, tile.indexType, 0);
      draws++;
      tris += tile.tris;
    }

    // Trees. Two sided, so culling off.
    gl.disable(gl.CULL_FACE);
    this.progTree.use();
    const td = this.q.treeDist;
    for (const tile of visible) {
      if (!tile.treeVao || tile.dist > td) continue;
      gl.bindVertexArray(tile.treeVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, tile.treeCount);
      draws++;
      tris += tile.treeCount * 10;
    }
    gl.enable(gl.CULL_FACE);

    // Drones, which are solid, then the sky, then the additive effects on top.
    if (this.drawActors) {
      gl.enable(gl.CULL_FACE);
      draws += this.actors.drawDrones();
      tris += this.actors.drone.instanceCount * (this.actors.drone.count / 3);
      draws += this.actors.drawSoldiers();
      tris += this.actors.soldier.instanceCount * (this.actors.soldier.count / 3);
      draws += this.actors.drawProjectiles();
      for (const kind in this.actors.props) {
        const mesh = this.actors.props[kind];
        tris += mesh.instanceCount * (mesh.count / 3);
      }
    }

    // Sky last, depth equal to the far plane, so it only fills what is left.
    gl.depthFunc(gl.LEQUAL);
    this.progSky.use();
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    draws++;

    if (this.drawActors) {
      gl.disable(gl.CULL_FACE);
      draws += this.actors.drawSparks();
      gl.enable(gl.CULL_FACE);
    }

    // The weapon in your hands, in its own projection on a cleared depth buffer.
    if (this.viewmodel) {
      draws += this.actors.drawViewmodel(
        this.width / Math.max(1, this.height), this.viewmodel, this.viewmodel.muzzle);
      tris += ((this.actors.weapons[this.viewmodel.weapon] || this.actors.weapons.m16).count) / 3;
    }

    gl.bindVertexArray(null);
    this.stats.drawCalls = draws;
    this.stats.triangles = tris;
    this.stats.tiles = visible.length;
  }

  post(targetWidth, targetHeight) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVao);

    let bloomTex = this.sceneFbo.colour;
    if (this.q.bloom && this.bloomFbo.length === 2) {
      const [a, b] = this.bloomFbo;
      a.bind();
      this.progBright.use().float('uThreshold', 1.02).float('uKnee', 0.55).int('uScene', 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneFbo.colour);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      this.progBlur.use().int('uSource', 0);
      for (let pass = 0; pass < 2; pass++) {
        b.bind();
        this.progBlur.vec2('uDirection', (1 / a.width) * (1 + pass), 0);
        gl.bindTexture(gl.TEXTURE_2D, a.colour);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        a.bind();
        this.progBlur.vec2('uDirection', 0, (1 / a.height) * (1 + pass));
        gl.bindTexture(gl.TEXTURE_2D, b.colour);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      bloomTex = a.colour;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, targetWidth, targetHeight);
    this.progComposite.use()
      .int('uScene', 0).int('uBloom', 1)
      .vec2('uTexel', 1 / this.width, 1 / this.height)
      .float('uExposure', this.exposure)
      .float('uSlow', this.reflex || 0)
      .float('uBloomAmount', this.q.bloom ? 0.62 : 0)
      .float('uVignette', 0.34)
      .float('uFxaa', this.q.fxaa && !this.debugMode ? 1 : 0)
      .float('uRaw', this.debugMode ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFbo.colour);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.q.bloom ? bloomTex : this.sceneFbo.colour);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  render(camera, time, targetWidth, targetHeight) {
    this.updateSky(camera, time);
    this.camBlock.upload();
    this.renderShadows(camera);
    this.camBlock.upload();
    const visible = this.tiles.cull(camera.frustum, camera.position[0], camera.position[2]);
    this.renderScene(camera, visible);
    this.post(targetWidth, targetHeight);
  }
}
