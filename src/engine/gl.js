// WebGL2 plumbing. Context creation, shader compilation with useful errors,
// program and VAO helpers, and the shared uniform block every program binds.

export const UBO_CAMERA = 0;

export function createContext(canvas, opts = {}) {
  const attrs = {
    alpha: false,
    antialias: opts.antialias !== false,
    depth: true,
    stencil: false,
    desynchronized: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    failIfMajorPerformanceCaveat: false,
  };
  const gl = canvas.getContext('webgl2', attrs);
  if (!gl) throw new Error('WebGL2 is not available in this browser');
  const caps = {
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    anisotropic: gl.getExtension('EXT_texture_filter_anisotropic'),
    colourBufferFloat: gl.getExtension('EXT_color_buffer_float'),
    colourBufferHalfFloat: gl.getExtension('EXT_color_buffer_half_float'),
    floatLinear: gl.getExtension('OES_texture_float_linear'),
    debugRendererInfo: gl.getExtension('WEBGL_debug_renderer_info'),
    loseContext: gl.getExtension('WEBGL_lose_context'),
  };
  caps.renderer = caps.debugRendererInfo
    ? gl.getParameter(caps.debugRendererInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  caps.vendor = caps.debugRendererInfo
    ? gl.getParameter(caps.debugRendererInfo.UNMASKED_VENDOR_WEBGL)
    : gl.getParameter(gl.VENDOR);
  return { gl, caps };
}

/**
 * Compile a shader and, on failure, print the source with line numbers and an
 * arrow at the line the driver complained about. Finding a typo in a 300 line
 * generated shader without this is miserable.
 */
export function compileShader(gl, type, source, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;

  const log = gl.getShaderInfoLog(sh) || '';
  const lines = source.split('\n');
  const bad = new Set();
  for (const m of log.matchAll(/^\w*ERROR:\s*\d+:(\d+)/gm)) bad.add(parseInt(m[1], 10));
  for (const m of log.matchAll(/^\d+:(\d+)/gm)) bad.add(parseInt(m[1], 10));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const near = [...bad].some((b) => Math.abs(b - n) <= 3);
    if (!bad.size || near) {
      out.push(`${bad.has(n) ? '>>' : '  '} ${String(n).padStart(4)} | ${lines[i]}`);
    }
  }
  gl.deleteShader(sh);
  const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
  throw new Error(`${kind} shader "${name}" failed to compile\n${log}\n${out.join('\n')}`);
}

export function createProgram(gl, vsSource, fsSource, name, opts = {}) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource, `${name}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource, `${name}.frag`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  if (opts.attribs) {
    for (const [loc, attr] of Object.entries(opts.attribs)) gl.bindAttribLocation(prog, +loc, attr);
  }
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program "${name}" failed to link\n${log}`);
  }
  return new Program(gl, prog, name);
}

export class Program {
  constructor(gl, handle, name) {
    this.gl = gl;
    this.handle = handle;
    this.name = name;
    this.uniforms = new Map();
    const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(handle, i);
      if (!info) continue;
      const base = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(handle, info.name);
      if (loc) this.uniforms.set(base, loc);
    }
    const blocks = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORM_BLOCKS);
    for (let i = 0; i < blocks; i++) {
      const bn = gl.getActiveUniformBlockName(handle, i);
      if (bn === 'Camera') gl.uniformBlockBinding(handle, i, UBO_CAMERA);
    }
  }
  use() { this.gl.useProgram(this.handle); return this; }
  loc(name) { return this.uniforms.get(name) || null; }
  int(name, v) { const l = this.loc(name); if (l) this.gl.uniform1i(l, v); return this; }
  float(name, v) { const l = this.loc(name); if (l) this.gl.uniform1f(l, v); return this; }
  vec2(name, x, y) { const l = this.loc(name); if (l) this.gl.uniform2f(l, x, y); return this; }
  vec3(name, x, y, z) { const l = this.loc(name); if (l) this.gl.uniform3f(l, x, y, z); return this; }
  vec4(name, x, y, z, w) { const l = this.loc(name); if (l) this.gl.uniform4f(l, x, y, z, w); return this; }
  vec3v(name, v) { const l = this.loc(name); if (l) this.gl.uniform3fv(l, v); return this; }
  vec4v(name, v) { const l = this.loc(name); if (l) this.gl.uniform4fv(l, v); return this; }
  mat4(name, m) { const l = this.loc(name); if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }
  mat4v(name, m) { const l = this.loc(name); if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }
}

/** A std140 uniform buffer wrapper backed by one Float32Array. */
export class UniformBlock {
  constructor(gl, floats, binding) {
    this.gl = gl;
    this.data = new Float32Array(floats);
    this.buffer = gl.createBuffer();
    this.binding = binding;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, binding, this.buffer);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  }
  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.data);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  }
}

export function createTexture(gl, opts) {
  const tex = gl.createTexture();
  const target = opts.target || gl.TEXTURE_2D;
  gl.bindTexture(target, tex);
  gl.texImage2D(target, 0, opts.internalFormat, opts.width, opts.height, 0,
    opts.format, opts.type, opts.data || null);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, opts.min || gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, opts.mag || gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, opts.wrap || gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, opts.wrap || gl.CLAMP_TO_EDGE);
  if (opts.compare) {
    gl.texParameteri(target, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(target, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  }
  gl.bindTexture(target, null);
  return tex;
}

export class Framebuffer {
  constructor(gl, width, height, opts = {}) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.handle = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.handle);
    if (opts.colour !== false) {
      this.colour = createTexture(gl, {
        width, height,
        internalFormat: opts.internalFormat || gl.RGBA8,
        format: opts.format || gl.RGBA,
        type: opts.type || gl.UNSIGNED_BYTE,
        min: opts.min || gl.LINEAR, mag: opts.mag || gl.LINEAR,
      });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colour, 0);
    } else {
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
    }
    if (opts.depth) {
      this.depth = createTexture(gl, {
        width, height,
        internalFormat: gl.DEPTH_COMPONENT24,
        format: gl.DEPTH_COMPONENT,
        type: gl.UNSIGNED_INT,
        min: gl.NEAREST, mag: gl.NEAREST,
        compare: !!opts.compareDepth,
      });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
    } else if (opts.depthBuffer) {
      this.depthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`framebuffer incomplete: 0x${status.toString(16)} (${width} by ${height})`);
    }
  }
  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.handle);
    gl.viewport(0, 0, this.width, this.height);
  }
  dispose() {
    const gl = this.gl;
    if (this.colour) gl.deleteTexture(this.colour);
    if (this.depth) gl.deleteTexture(this.depth);
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb);
    gl.deleteFramebuffer(this.handle);
  }
}

/** A full screen triangle, drawn with gl_VertexID so it needs no buffers. */
export function drawFullscreen(gl, vao) {
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
