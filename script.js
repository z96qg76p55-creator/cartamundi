// ═══════════════════════════════════════════════════════════
//  CARTAMUNDI — script.js
// ═══════════════════════════════════════════════════════════

window.addEventListener('load', () => {
  gsap.registerPlugin(ScrollTrigger);
  initSplashCursor();
  initStarfield();
  initLanding();
  initNav();
  initAccordions();
  initTimeline();
  initReveal();
  initCounters();
  initLiquidGlass();
});

// ─── SPLASH CURSOR — WebGL Fluid Simulation ──────────────
// Based on Pavel Dobryakov's WebGL-Fluid-Simulation (MIT)
// Adapted for transparent canvas overlay
function initSplashCursor() {
  const canvas = document.getElementById('fluid');
  if (!canvas) return;

  // ── config ────────────────────────────────────────────
  const DENSITY_DISSIPATION  = 3.5;
  const VELOCITY_DISSIPATION = 2.0;
  const PRESSURE_VALUE       = 0.1;
  const PRESSURE_ITERATIONS  = 20;
  const CURL_STRENGTH        = 3;
  const SPLAT_RADIUS         = 0.25;
  const SPLAT_FORCE          = 6000;
  const COLOR_UPDATE_SPEED   = 10;
  const SIM_RESOLUTION       = 128;
  const DYE_RESOLUTION       = 1024;

  // ── WebGL context ─────────────────────────────────────
  const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
  let gl = canvas.getContext('webgl2', params);
  const isWebGL2 = !!gl;
  if (!isWebGL2) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
  if (!gl) return;

  let ext = {};
  if (isWebGL2) {
    gl.getExtension('EXT_color_buffer_float');
    ext.supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
  } else {
    const hf = gl.getExtension('OES_texture_half_float');
    ext.supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    ext.halfFloatTexType = hf ? hf.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
  }
  ext.halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (ext.halfFloatTexType || gl.UNSIGNED_BYTE);

  function getFormat(internalFmt, fmt) {
    const ok = (() => {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, 4, 4, 0, fmt, ext.halfFloatTexType, null);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    })();
    return ok ? { internalFormat: internalFmt, format: fmt } : null;
  }

  let fmtRGBA, fmtRG, fmtR;
  if (isWebGL2) {
    fmtRGBA = getFormat(gl.RGBA16F, gl.RGBA) || getFormat(gl.RGBA, gl.RGBA);
    fmtRG   = getFormat(gl.RG16F,   gl.RG)   || fmtRGBA;
    fmtR    = getFormat(gl.R16F,    gl.RED)   || fmtRGBA;
  } else {
    fmtRGBA = fmtRG = fmtR = getFormat(gl.RGBA, gl.RGBA);
  }
  if (!fmtRGBA) return; // device unsupported

  // ── shaders ───────────────────────────────────────────
  const VS = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform vec2 texelSize;
    void main(){
      vUv = aPosition*.5+.5;
      vL = vUv-vec2(texelSize.x,0.); vR = vUv+vec2(texelSize.x,0.);
      vT = vUv+vec2(0.,texelSize.y); vB = vUv-vec2(0.,texelSize.y);
      gl_Position = vec4(aPosition,0.,1.);
    }`;

  const programs = {};
  function prog(fragSrc) {
    const p = gl.createProgram();
    const vs = gl.createShader(gl.VERTEX_SHADER);   gl.shaderSource(vs, VS);   gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, fragSrc); gl.compileShader(fs);
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  const SPLAT = prog(`
    precision highp float; precision highp sampler2D;
    varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio;
    uniform vec3 color; uniform vec2 point; uniform float radius;
    void main(){
      vec2 p = vUv - point; p.x *= aspectRatio;
      vec3 splat = exp(-dot(p,p)/radius)*color;
      gl_FragColor = vec4(texture2D(uTarget,vUv).xyz + splat, 1.);
    }`);

  const ADVECT = prog(`
    precision highp float; precision highp sampler2D;
    varying vec2 vUv; uniform sampler2D uVelocity, uSource;
    uniform vec2 texelSize, dyeTexelSize; uniform float dt, dissipation;
    vec4 bilerp(sampler2D sam, vec2 uv, vec2 ts){
      vec2 st=uv/ts-.5; vec2 i=floor(st); vec2 f=fract(st);
      vec4 a=texture2D(sam,(i+vec2(.5,.5))*ts); vec4 b=texture2D(sam,(i+vec2(1.5,.5))*ts);
      vec4 c=texture2D(sam,(i+vec2(.5,1.5))*ts); vec4 d=texture2D(sam,(i+vec2(1.5,1.5))*ts);
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    void main(){
      vec2 coord=vUv-dt*bilerp(uVelocity,vUv,texelSize).xy*texelSize;
      gl_FragColor = bilerp(uSource,coord,dyeTexelSize)/(1.+dissipation*dt);
    }`);

  const CURL = prog(`
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vL,vR,vT,vB; uniform sampler2D uVelocity;
    void main(){
      float L=texture2D(uVelocity,vL).y, R=texture2D(uVelocity,vR).y;
      float T=texture2D(uVelocity,vT).x, B=texture2D(uVelocity,vB).x;
      gl_FragColor=vec4(.5*(R-L-T+B),0.,0.,1.);
    }`);

  const VORTICITY = prog(`
    precision highp float; precision highp sampler2D;
    varying vec2 vUv,vL,vR,vT,vB; uniform sampler2D uVelocity,uCurl;
    uniform float curl,dt;
    void main(){
      float L=texture2D(uCurl,vL).x, R=texture2D(uCurl,vR).x;
      float T=texture2D(uCurl,vT).x, B=texture2D(uCurl,vB).x;
      float C=texture2D(uCurl,vUv).x;
      vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));
      f/=length(f)+.0001; f*=curl*C; f.y*=-1.;
      gl_FragColor=vec4(texture2D(uVelocity,vUv).xy+f*dt,0.,1.);
    }`);

  const DIVERGENCE = prog(`
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv,vL,vR,vT,vB; uniform sampler2D uVelocity;
    void main(){
      float L=texture2D(uVelocity,vL).x, R=texture2D(uVelocity,vR).x;
      float T=texture2D(uVelocity,vT).y, B=texture2D(uVelocity,vB).y;
      vec2 C=texture2D(uVelocity,vUv).xy;
      if(vL.x<0.)L=-C.x; if(vR.x>1.)R=-C.x;
      if(vT.y>1.)T=-C.y; if(vB.y<0.)B=-C.y;
      gl_FragColor=vec4(.5*(R-L+T-B),0.,0.,1.);
    }`);

  const PRESSURE = prog(`
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv,vL,vR,vT,vB; uniform sampler2D uPressure,uDivergence;
    void main(){
      float L=texture2D(uPressure,vL).x, R=texture2D(uPressure,vR).x;
      float T=texture2D(uPressure,vT).x, B=texture2D(uPressure,vB).x;
      float div=texture2D(uDivergence,vUv).x;
      gl_FragColor=vec4((L+R+B+T-div)*.25,0.,0.,1.);
    }`);

  const GRAD_SUBTRACT = prog(`
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv,vL,vR,vT,vB; uniform sampler2D uPressure,uVelocity;
    void main(){
      float L=texture2D(uPressure,vL).x, R=texture2D(uPressure,vR).x;
      float T=texture2D(uPressure,vT).x, B=texture2D(uPressure,vB).x;
      vec2 vel=texture2D(uVelocity,vUv).xy-vec2(R-L,T-B);
      gl_FragColor=vec4(vel,0.,1.);
    }`);

  // KEY: display shader derives alpha from brightness → transparent where no fluid
  const DISPLAY = prog(`
    precision highp float; precision highp sampler2D;
    varying vec2 vUv; uniform sampler2D uTexture;
    void main(){
      vec3 c = texture2D(uTexture, vUv).rgb;
      float a = max(c.r, max(c.g, c.b));
      gl_FragColor = vec4(c * a, a);
    }`);

  const CLEAR = prog(`
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value;
    void main(){ gl_FragColor = value * texture2D(uTexture,vUv); }`);

  // ── geometry ──────────────────────────────────────────
  const vbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,-1,1,1,1,1,-1]), gl.STATIC_DRAW);
  const ibuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2,0,2,3]), gl.STATIC_DRAW);

  function blit(target) {
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.w, target.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // ── FBO ───────────────────────────────────────────────
  function makeFBO(w, h, iFmt, fmt, type, filter) {
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, iFmt, w, h, 0, fmt, type, null);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h, tsx: 1/w, tsy: 1/h,
      attach(id){ gl.activeTexture(gl.TEXTURE0+id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; } };
  }

  function makeDoubleFBO(w, h, iFmt, fmt, type, filter) {
    let r = makeFBO(w,h,iFmt,fmt,type,filter), wr = makeFBO(w,h,iFmt,fmt,type,filter);
    return { w, h, tsx: r.tsx, tsy: r.tsy,
      get read(){ return r; }, get write(){ return wr; },
      swap(){ const t=r; r=wr; wr=t; } };
  }

  function simRes() {
    const ar = gl.drawingBufferWidth / gl.drawingBufferHeight;
    const s = ar > 1;
    return { w: s ? Math.round(SIM_RESOLUTION*ar) : SIM_RESOLUTION,
             h: s ? SIM_RESOLUTION : Math.round(SIM_RESOLUTION/ar) };
  }
  function dyeRes() {
    const ar = gl.drawingBufferWidth / gl.drawingBufferHeight;
    const s = ar > 1;
    return { w: s ? Math.round(DYE_RESOLUTION*ar) : DYE_RESOLUTION,
             h: s ? DYE_RESOLUTION : Math.round(DYE_RESOLUTION/ar) };
  }

  const filter = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
  const T = ext.halfFloatTexType;

  function initFBOs() {
    const sr = simRes(), dr = dyeRes();
    density   = makeDoubleFBO(dr.w, dr.h, fmtRGBA.internalFormat, fmtRGBA.format, T, filter);
    velocity  = makeDoubleFBO(sr.w, sr.h, fmtRG.internalFormat,   fmtRG.format,   T, filter);
    divergence= makeFBO      (sr.w, sr.h, fmtR.internalFormat,    fmtR.format,    T, gl.NEAREST);
    curlFBO   = makeFBO      (sr.w, sr.h, fmtR.internalFormat,    fmtR.format,    T, gl.NEAREST);
    pressure  = makeDoubleFBO(sr.w, sr.h, fmtR.internalFormat,    fmtR.format,    T, gl.NEAREST);
  }

  let density, velocity, divergence, curlFBO, pressure;
  initFBOs();

  // ── canvas resize ─────────────────────────────────────
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.floor(window.innerWidth  * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      initFBOs();
    }
  }

  // ── color ─────────────────────────────────────────────
  let colorHue = Math.random() * 360;
  function nextColor() {
    colorHue = (colorHue + COLOR_UPDATE_SPEED * 3.6) % 360;
    // HSL → RGB
    const h = colorHue / 60; const x = 1 - Math.abs(h % 2 - 1);
    let r=0,g=0,b=0;
    if      (h<1){r=1;g=x;}
    else if (h<2){r=x;g=1;}
    else if (h<3){g=1;b=x;}
    else if (h<4){g=x;b=1;}
    else if (h<5){r=x;b=1;}
    else         {r=1;b=x;}
    return { r: r*0.25, g: g*0.25, b: b*0.25 };
  }

  // ── splat ─────────────────────────────────────────────
  function splat(x, y, dx, dy, color) {
    const ar = canvas.width / canvas.height;
    const radius = SPLAT_RADIUS / 100 * (ar > 1 ? ar : 1);

    gl.useProgram(SPLAT.p);
    gl.uniform1i (SPLAT.u.uTarget,     velocity.read.attach(0));
    gl.uniform1f (SPLAT.u.aspectRatio, ar);
    gl.uniform2f (SPLAT.u.point,       x / canvas.width, 1 - y / canvas.height);
    gl.uniform3f (SPLAT.u.color,       dx, -dy, 0);
    gl.uniform1f (SPLAT.u.radius,      radius);
    blit(velocity.write); velocity.swap();

    gl.uniform1i (SPLAT.u.uTarget,  density.read.attach(0));
    gl.uniform3f (SPLAT.u.color,    color.r, color.g, color.b);
    blit(density.write); density.swap();
  }

  // ── pointer ───────────────────────────────────────────
  const ptr = { x:0, y:0, px:0, py:0, dx:0, dy:0, moved:false, color: nextColor() };

  function onMove(cx, cy) {
    ptr.px = ptr.x; ptr.py = ptr.y;
    ptr.x  = cx;    ptr.y  = cy;
    ptr.dx = (cx - ptr.px) / canvas.width;
    ptr.dy = (cy - ptr.py) / canvas.height;
    ptr.moved = true;
  }

  window.addEventListener('mousemove', e => onMove(e.clientX * (canvas.width / window.innerWidth),
                                                    e.clientY * (canvas.height / window.innerHeight)));
  window.addEventListener('touchmove', e => {
    e.preventDefault();
    onMove(e.touches[0].clientX * (canvas.width / window.innerWidth),
           e.touches[0].clientY * (canvas.height / window.innerHeight));
  }, { passive: false });

  // ── simulation step ───────────────────────────────────
  let lastTime = performance.now();

  function step(dt) {
    gl.disable(gl.BLEND);

    // curl
    gl.useProgram(CURL.p);
    gl.uniform2f(CURL.u.texelSize, velocity.tsx, velocity.tsy);
    gl.uniform1i(CURL.u.uVelocity, velocity.read.attach(0));
    blit(curlFBO);

    // vorticity
    gl.useProgram(VORTICITY.p);
    gl.uniform2f(VORTICITY.u.texelSize, velocity.tsx, velocity.tsy);
    gl.uniform1i(VORTICITY.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(VORTICITY.u.uCurl,     curlFBO.attach(1));
    gl.uniform1f(VORTICITY.u.curl, CURL_STRENGTH); gl.uniform1f(VORTICITY.u.dt, dt);
    blit(velocity.write); velocity.swap();

    // divergence
    gl.useProgram(DIVERGENCE.p);
    gl.uniform2f(DIVERGENCE.u.texelSize, velocity.tsx, velocity.tsy);
    gl.uniform1i(DIVERGENCE.u.uVelocity, velocity.read.attach(0));
    blit(divergence);

    // clear pressure
    gl.useProgram(CLEAR.p);
    gl.uniform1i(CLEAR.u.uTexture, pressure.read.attach(0));
    gl.uniform1f(CLEAR.u.value, PRESSURE_VALUE);
    blit(pressure.write); pressure.swap();

    // pressure solve
    gl.useProgram(PRESSURE.p);
    gl.uniform2f(PRESSURE.u.texelSize, velocity.tsx, velocity.tsy);
    gl.uniform1i(PRESSURE.u.uDivergence, divergence.attach(0));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(PRESSURE.u.uPressure, pressure.read.attach(1));
      blit(pressure.write); pressure.swap();
    }

    // gradient subtract
    gl.useProgram(GRAD_SUBTRACT.p);
    gl.uniform2f(GRAD_SUBTRACT.u.texelSize, velocity.tsx, velocity.tsy);
    gl.uniform1i(GRAD_SUBTRACT.u.uPressure, pressure.read.attach(0));
    gl.uniform1i(GRAD_SUBTRACT.u.uVelocity, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();

    // advect velocity
    gl.useProgram(ADVECT.p);
    gl.uniform2f(ADVECT.u.texelSize, velocity.tsx, velocity.tsy);
    gl.uniform2f(ADVECT.u.dyeTexelSize, velocity.tsx, velocity.tsy);
    gl.uniform1i(ADVECT.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(ADVECT.u.uSource,   velocity.read.attach(0));
    gl.uniform1f(ADVECT.u.dt, dt);
    gl.uniform1f(ADVECT.u.dissipation, VELOCITY_DISSIPATION);
    blit(velocity.write); velocity.swap();

    // advect density
    gl.uniform2f(ADVECT.u.dyeTexelSize, density.tsx, density.tsy);
    gl.uniform1i(ADVECT.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(ADVECT.u.uSource,   density.read.attach(1));
    gl.uniform1f(ADVECT.u.dissipation, DENSITY_DISSIPATION);
    blit(density.write); density.swap();
  }

  // ── render to transparent canvas ──────────────────────
  function render() {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(DISPLAY.p);
    gl.uniform1i(DISPLAY.u.uTexture, density.read.attach(0));
    blit(null);
  }

  // ── main loop ─────────────────────────────────────────
  function loop() {
    resizeCanvas();
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.016667);
    lastTime  = now;

    if (ptr.moved) {
      ptr.moved = false;
      ptr.color = nextColor();
      splat(ptr.x, ptr.y, ptr.dx * SPLAT_FORCE, ptr.dy * SPLAT_FORCE, ptr.color);
    }

    step(dt);
    render();
    requestAnimationFrame(loop);
  }

  resizeCanvas();
  loop();
}

// ─── CANVAS STARFIELD ────────────────────────────────────
function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx    = canvas.getContext('2d');

  let W, H, stars;
  let mouse   = { x: -9999, y: -9999 };
  let scrollY = 0;
  const CURSOR_RADIUS   = 120;
  const CURSOR_STRENGTH = 0.28;
  const STAR_COUNT      = 320;
  const PARALLAX_FACTOR = 0.25;

  const COLORS = [
    'rgba(255,255,255,',
    'rgba(200,220,255,',
    'rgba(255,240,200,',
    'rgba(180,210,255,',
  ];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeStar() {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    return {
      ox: Math.random() * W, oy: Math.random() * H,
      x: 0, y: 0,
      r:       Math.random() * 1.4 + 0.3,
      alpha:   Math.random() * 0.6 + 0.3,
      twinkle: Math.random() * Math.PI * 2,
      speed:   Math.random() * 0.008 + 0.003,
      color,
      vx: 0, vy: 0,
    };
  }

  function init() {
    resize();
    stars = Array.from({ length: STAR_COUNT }, makeStar);
    stars.forEach(s => { s.x = s.ox; s.y = s.oy; });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const parallaxOffset = scrollY * PARALLAX_FACTOR;

    stars.forEach(s => {
      s.twinkle += s.speed;
      const tw = 0.5 + 0.5 * Math.sin(s.twinkle);
      const a  = s.alpha * (0.6 + 0.4 * tw);

      const dx = mouse.x - s.x, dy = mouse.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CURSOR_RADIUS) {
        const force = (1 - dist / CURSOR_RADIUS) * CURSOR_STRENGTH;
        s.vx += dx * force * 0.06;
        s.vy += dy * force * 0.06;
      }
      s.vx *= 0.88; s.vy *= 0.88;
      s.x  += s.vx; s.y  += s.vy;

      const drawY = s.y - parallaxOffset % H;
      const grd = ctx.createRadialGradient(s.x, drawY, 0, s.x, drawY, s.r * 2.5);
      grd.addColorStop(0, s.color + a + ')');
      grd.addColorStop(1, s.color + '0)');

      ctx.beginPath();
      ctx.arc(s.x, drawY, s.r * (1 + 0.3 * tw), 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      if (s.r > 1.2) {
        ctx.strokeStyle = s.color + (a * 0.3) + ')';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r * 4, drawY); ctx.lineTo(s.x + s.r * 4, drawY);
        ctx.moveTo(s.x, drawY - s.r * 4); ctx.lineTo(s.x, drawY + s.r * 4);
        ctx.stroke();
      }
    });

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => {
    resize();
    stars.forEach(s => { s.ox = Math.random() * W; s.oy = Math.random() * H; s.x = s.ox; s.y = s.oy; });
  });
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });
  window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });

  init();
  draw();
}

// ─── LANDING ANIMATION ───────────────────────────────────
function initLanding() {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#landing',
      start: 'top top',
      end: '+=500%',
      scrub: 1.2,
      pin: true,
      anticipatePin: 1,
    }
  });

  // Start: image slightly smaller and invisible, rises and sharpens into view
  gsap.set('#card-fan', { scale: 0.82, opacity: 0, y: 40 });

  tl
    .to('#card-fan',        { scale: 1, opacity: 1, y: 0, duration: 1, ease: 'power2.out' }, 0)
    .to('#scroll-indicator', { opacity: 0, duration: 0.3 }, 0.2)
    .to('#text-1',          { opacity: 1, y: 0, duration: 0.5 }, 1.4)
    .to('#text-1',          { opacity: 0, y: -24, duration: 0.4 }, 2.3)
    .to('#text-2',          { opacity: 1, y: 0, duration: 0.5 }, 2.7)
    .to('#text-2',          { opacity: 0, y: -24, duration: 0.4 }, 3.6)
    .to('#card-fan',        { y: -120, scale: 1.06, opacity: 0, duration: 0.9 }, 3.65)
    .to('#landing-logo',    { opacity: 1, duration: 0.9 }, 4.2)
    .to({},                 { duration: 0.6 }, 5.0);
}

// ─── NAVIGATION ──────────────────────────────────────────
function initNav() {
  const nav   = document.getElementById('main-nav');
  const links = document.querySelectorAll('.nav-link');
  const sections = ['ontstaan', 'groei', 'nu', 'toekomst'];

  ScrollTrigger.create({
    trigger: '#ontstaan',
    start: 'top 85%',
    onEnter:     () => nav.classList.add('visible'),
    onLeaveBack: () => nav.classList.remove('visible'),
  });

  sections.forEach(id => {
    ScrollTrigger.create({
      trigger: `#${id}`,
      start: 'top center',
      end:   'bottom center',
      onEnter:     () => setActive(id),
      onEnterBack: () => setActive(id),
    });
  });

  function setActive(id) {
    links.forEach(l => l.classList.toggle('active', l.dataset.section === id));
  }
}

// ─── ACCORDIONS ──────────────────────────────────────────
function initAccordions() {
  document.querySelectorAll('.accordion').forEach(accordion => {
    const sectionId = accordion.id.replace('accordion-', '');
    const img       = document.getElementById(`accordion-img-${sectionId}`);
    const fallback  = img ? img.nextElementSibling : null;

    accordion.querySelectorAll('.accordion-item').forEach(item => {
      item.querySelector('.accordion-trigger').addEventListener('click', () => {
        const wasActive = item.classList.contains('active');

        accordion.querySelectorAll('.accordion-item').forEach(i => {
          i.classList.remove('active');
          i.querySelector('.accordion-trigger').setAttribute('aria-expanded', 'false');
        });

        if (!wasActive) {
          item.classList.add('active');
          item.querySelector('.accordion-trigger').setAttribute('aria-expanded', 'true');

          if (img && item.dataset.image) {
            img.style.opacity   = '0';
            img.style.transform = 'scale(1.04)';
            setTimeout(() => {
              img.src = item.dataset.image;
              img.onload = () => {
                img.style.display   = 'block';
                img.style.opacity   = '1';
                img.style.transform = 'scale(1)';
                if (fallback) fallback.style.display = 'none';
              };
              img.onerror = () => {
                img.style.display = 'none';
                if (fallback) {
                  fallback.style.background = getFallback(item.dataset.imageFallback);
                  fallback.style.display    = 'flex';
                }
                img.style.opacity   = '1';
                img.style.transform = 'scale(1)';
              };
            }, 160);
          } else if (img && !item.dataset.image) {
            img.style.display = 'none';
            if (fallback) {
              fallback.style.background = getFallback(item.dataset.imageFallback);
              fallback.style.display    = 'flex';
            }
          }

          triggerCounters();
        }
      });
    });
  });
}

function getFallback(name) {
  return ({
    'grad-red':    'linear-gradient(135deg,#E30613 0%,#7a0009 100%)',
    'grad-blue':   'linear-gradient(135deg,#1a3a8f 0%,#0f2460 100%)',
    'grad-purple': 'linear-gradient(135deg,#4a1a8f 0%,#1a0460 100%)',
    'grad-gold':   'linear-gradient(135deg,#b8860b 0%,#5a4000 100%)',
    'grad-green':  'linear-gradient(135deg,#1a6b3a 0%,#0a3020 100%)',
    'grad-teal':   'linear-gradient(135deg,#0d6b6b 0%,#062020 100%)',
  })[name] || 'linear-gradient(135deg,#E30613 0%,#7a0009 100%)';
}

// ─── TIMELINE ────────────────────────────────────────────
function initTimeline() {
  const nodes = document.querySelectorAll('.timeline-node');
  if (!nodes.length) return;

  nodes[0].classList.add('active');

  nodes.forEach(node => {
    node.querySelector('.node-btn').addEventListener('click', () => {
      const wasActive = node.classList.contains('active');
      nodes.forEach(n => n.classList.remove('active'));
      if (!wasActive) {
        node.classList.add('active');
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });
  });
}

// ─── SCROLL REVEAL ───────────────────────────────────────
function initReveal() {
  const els = document.querySelectorAll('.reveal');

  function check() {
    els.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92) {
        el.classList.add('visible');
      }
    });
  }

  // fire on scroll + resize
  window.addEventListener('scroll', check, { passive: true });
  window.addEventListener('resize', check);

  // also run immediately and after GSAP pin settles
  check();
  setTimeout(check, 800);
  setTimeout(check, 2000);
}

// ─── STAT COUNTERS ────────────────────────────────────────
let countersRan = false;

function initCounters() {}

function triggerCounters() {
  if (countersRan) return;
  const omzetItem = document.querySelector('#accordion-nu .accordion-item.active [id="counter-employees"]');
  if (!omzetItem) return;
  countersRan = true;
  animateCount('counter-employees', 3000, '+');
  animateCount('counter-countries', 20,   '+');
  animateCount('counter-factories', 13,   '');
}

function animateCount(id, target, suffix) {
  const el = document.getElementById(id);
  if (!el) return;
  let start = null;
  const duration = 1800;
  function step(ts) {
    if (!start) start = ts;
    const progress = Math.min((ts - start) / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(eased * target) + (progress === 1 ? suffix : '');
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── LIQUID GLASS NAV ─────────────────────────────────────
function initLiquidGlass() {
  if (typeof Container === 'undefined' || typeof html2canvas === 'undefined') return;

  const navInner = document.querySelector('#main-nav .nav-inner');
  if (!navInner) return;

  // Create a pill-shaped liquid glass container
  const container = new Container({ type: 'pill', tintOpacity: 0.12 });

  // Preserve nav-inner layout/style classes on the new element
  container.element.classList.add('nav-inner', 'glass-pill');

  // Move nav links & dots into the container
  while (navInner.firstChild) {
    container.element.appendChild(navInner.firstChild);
  }

  // Swap into DOM
  navInner.parentNode.replaceChild(container.element, navInner);

  // Force size recalculation after DOM insertion
  requestAnimationFrame(() => container.updateSizeFromDOM());
}
