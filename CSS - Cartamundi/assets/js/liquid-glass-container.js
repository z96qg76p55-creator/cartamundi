class Container {
  static instances = []
  static pageSnapshot = null
  static isCapturing = false
  static waitingForSnapshot = []

  constructor(options = {}) {
    this.width = 0
    this.height = 0
    this.borderRadius = options.borderRadius || 48
    this.type = options.type || 'rounded'
    this.tintOpacity = options.tintOpacity !== undefined ? options.tintOpacity : 0.2

    this.canvas = null
    this.element = null
    this.gl = null
    this.gl_refs = {}
    this.webglInitialized = false
    this.children = []

    Container.instances.push(this)
    this.init()
  }

  addChild(child) {
    this.children.push(child)
    child.parent = this
    if (child.element && this.element) this.element.appendChild(child.element)
    if (child instanceof Button) child.setupAsNestedGlass()
    this.updateSizeFromDOM()
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index > -1) {
      this.children.splice(index, 1)
      child.parent = null
      if (child.element && this.element.contains(child.element)) this.element.removeChild(child.element)
      this.updateSizeFromDOM()
    }
  }

  updateSizeFromDOM() {
    requestAnimationFrame(() => {
      const rect = this.element.getBoundingClientRect()
      let newWidth = Math.ceil(rect.width)
      let newHeight = Math.ceil(rect.height)

      if (this.type === 'circle') {
        const size = Math.max(newWidth, newHeight)
        newWidth = size; newHeight = size
        this.borderRadius = size / 2
        this.element.style.width = size + 'px'
        this.element.style.height = size + 'px'
        this.element.style.borderRadius = this.borderRadius + 'px'
      } else if (this.type === 'pill') {
        this.borderRadius = newHeight / 2
        this.element.style.borderRadius = this.borderRadius + 'px'
      }

      if (newWidth !== this.width || newHeight !== this.height) {
        this.width = newWidth; this.height = newHeight
        this.canvas.width = newWidth; this.canvas.height = newHeight
        this.canvas.style.width = newWidth + 'px'; this.canvas.style.height = newHeight + 'px'
        this.canvas.style.borderRadius = this.borderRadius + 'px'

        if (this.gl_refs.gl) {
          this.gl_refs.gl.viewport(0, 0, newWidth, newHeight)
          this.gl_refs.gl.uniform2f(this.gl_refs.resolutionLoc, newWidth, newHeight)
          this.gl_refs.gl.uniform1f(this.gl_refs.borderRadiusLoc, this.borderRadius)
        }

        this.children.forEach(child => {
          if (child instanceof Button && child.isNestedGlass && child.gl_refs.gl) {
            const gl = child.gl_refs.gl
            gl.bindTexture(gl.TEXTURE_2D, child.gl_refs.texture)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, newWidth, newHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
            gl.uniform2f(child.gl_refs.textureSizeLoc, newWidth, newHeight)
            if (child.gl_refs.containerSizeLoc) gl.uniform2f(child.gl_refs.containerSizeLoc, newWidth, newHeight)
          }
        })
      }
    })
  }

  init() {
    this.createElement()
    this.setupCanvas()
    this.updateSizeFromDOM()

    if (Container.pageSnapshot) {
      this.initWebGL()
    } else if (Container.isCapturing) {
      Container.waitingForSnapshot.push(this)
    } else {
      Container.isCapturing = true
      Container.waitingForSnapshot.push(this)
      this.capturePageSnapshot()
    }
  }

  createElement() {
    this.element = document.createElement('div')
    this.element.className = 'glass-container'
    if (this.type === 'circle') this.element.classList.add('glass-container-circle')
    else if (this.type === 'pill') this.element.classList.add('glass-container-pill')
    this.element.style.borderRadius = this.borderRadius + 'px'

    this.canvas = document.createElement('canvas')
    this.canvas.style.borderRadius = this.borderRadius + 'px'
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.boxShadow = '0 25px 50px rgba(0,0,0,0.25)'
    this.canvas.style.zIndex = '-1'
    this.element.appendChild(this.canvas)
  }

  setupCanvas() {
    this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true })
    if (!this.gl) console.error('WebGL not supported')
  }

  getPosition() {
    const rect = this.canvas.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  capturePageSnapshot() {
    html2canvas(document.body, {
      scale: 1, useCORS: true, allowTaint: true, backgroundColor: null,
      ignoreElements: el =>
        el.classList.contains('glass-container') ||
        el.classList.contains('glass-button') ||
        el.classList.contains('glass-button-text')
    }).then(snapshot => {
      Container.pageSnapshot = snapshot
      Container.isCapturing = false
      const waiting = Container.waitingForSnapshot.slice()
      Container.waitingForSnapshot = []
      waiting.forEach(c => { if (!c.webglInitialized) c.initWebGL() })
    }).catch(err => {
      console.error('html2canvas error:', err)
      Container.isCapturing = false
      Container.waitingForSnapshot = []
    })
  }

  initWebGL() {
    if (!Container.pageSnapshot || !this.gl) return
    const img = new Image()
    img.src = Container.pageSnapshot.toDataURL()
    img.onload = () => { this.setupShader(img); this.webglInitialized = true }
  }

  setupShader(image) {
    const gl = this.gl
    const vsSource = `
      attribute vec2 a_position; attribute vec2 a_texcoord; varying vec2 v_texcoord;
      void main() { gl_Position = vec4(a_position,0,1); v_texcoord = a_texcoord; }`
    const fsSource = `
      precision mediump float;
      uniform sampler2D u_image; uniform vec2 u_resolution; uniform vec2 u_textureSize;
      uniform float u_scrollY; uniform float u_pageHeight; uniform float u_viewportHeight;
      uniform float u_blurRadius; uniform float u_borderRadius; uniform vec2 u_containerPosition;
      uniform float u_warp; uniform float u_edgeIntensity; uniform float u_rimIntensity;
      uniform float u_baseIntensity; uniform float u_edgeDistance; uniform float u_rimDistance;
      uniform float u_baseDistance; uniform float u_cornerBoost; uniform float u_rippleEffect;
      uniform float u_tintOpacity; varying vec2 v_texcoord;

      float roundedRectDistance(vec2 c,vec2 s,float r){
        vec2 center=s*.5; vec2 p=c*s; vec2 t=abs(p-center)-(center-r);
        float o=length(max(t,0.)); float i=min(max(t.x,t.y),0.); return o+i-r; }
      float circleDistance(vec2 c,vec2 s,float r){
        vec2 p=c*s; vec2 cp=vec2(.5)*s; return length(p-cp)-r; }
      bool isPill(vec2 s,float r){ return abs(r-s.y*.5)<2. && s.x>s.y+4.; }
      bool isCircle(vec2 s,float r){ return abs(r-min(s.x,s.y)*.5)<1. && abs(s.x-s.y)<4.; }
      float pillDistance(vec2 c,vec2 s,float r){
        vec2 center=s*.5; vec2 p=c*s;
        vec2 cs=vec2(r,center.y); vec2 ce=vec2(s.x-r,center.y);
        vec2 ax=ce-cs; float al=length(ax);
        if(al>0.){vec2 tp=p-cs; float t=clamp(dot(tp,ax)/dot(ax,ax),0.,1.);
          return length(p-(cs+t*ax))-r;}
        return length(p-center)-r; }

      void main(){
        vec2 coord=v_texcoord; float scrollY=u_scrollY;
        vec2 containerSize=u_resolution; vec2 textureSize=u_textureSize;
        vec2 containerCenter=u_containerPosition+vec2(0.,scrollY);
        vec2 containerOffset=(coord-.5)*containerSize;
        vec2 pagePixel=containerCenter+containerOffset;
        vec2 textureCoord=pagePixel/textureSize;

        float distFromEdgeShape; vec2 shapeNormal;
        if(isPill(u_resolution,u_borderRadius)){
          distFromEdgeShape=-pillDistance(coord,u_resolution,u_borderRadius);
          vec2 center=vec2(.5); vec2 p=coord*u_resolution;
          vec2 cs=vec2(u_borderRadius,center.y*u_resolution.y);
          vec2 ce=vec2(u_resolution.x-u_borderRadius,center.y*u_resolution.y);
          vec2 ax=ce-cs; float al=length(ax);
          if(al>0.){vec2 tp=p-cs; float t=clamp(dot(tp,ax)/dot(ax,ax),0.,1.);
            vec2 np=p-(cs+t*ax); shapeNormal=length(np)>0.?normalize(np):vec2(0.,1.);}
          else shapeNormal=normalize(coord-center);
        } else if(isCircle(u_resolution,u_borderRadius)){
          distFromEdgeShape=-circleDistance(coord,u_resolution,u_borderRadius);
          shapeNormal=normalize(coord-vec2(.5));
        } else {
          distFromEdgeShape=-roundedRectDistance(coord,u_resolution,u_borderRadius);
          shapeNormal=normalize(coord-vec2(.5));
        }
        distFromEdgeShape=max(distFromEdgeShape,0.);
        float distFromEdge=distFromEdgeShape/min(u_resolution.x,u_resolution.y);
        float nd=distFromEdge*min(u_resolution.x,u_resolution.y);
        float baseI=1.-exp(-nd*u_baseDistance);
        float edgeI=exp(-nd*u_edgeDistance);
        float rimI=exp(-nd*u_rimDistance);
        float baseComp=u_warp>.5?baseI*u_baseIntensity:0.;
        float totalI=baseComp+edgeI*u_edgeIntensity+rimI*u_rimIntensity;
        vec2 baseRef=shapeNormal*totalI;
        float cx=min(coord.x,1.-coord.x); float cy=min(coord.y,1.-coord.y);
        float cn=max(cx,cy)*min(u_resolution.x,u_resolution.y);
        float cornerBoost=exp(-cn*.3)*u_cornerBoost;
        vec2 cornerRef=shapeNormal*cornerBoost;
        vec2 perp=vec2(-shapeNormal.y,shapeNormal.x);
        float ripple=sin(distFromEdge*25.)*u_rippleEffect*rimI;
        textureCoord+=baseRef+cornerRef+perp*ripple;

        vec4 color=vec4(0.); vec2 ts=1./u_textureSize;
        float sigma=u_blurRadius/2.; vec2 bs=ts*sigma; float tw=0.;
        for(float i=-6.;i<=6.;i+=1.) for(float j=-6.;j<=6.;j+=1.){
          float d=length(vec2(i,j)); if(d>6.) continue;
          float w=exp(-(d*d)/(2.*sigma*sigma));
          color+=texture2D(u_image,textureCoord+vec2(i,j)*bs)*w; tw+=w; }
        color/=tw;

        vec3 tinted=mix(color.rgb,mix(vec3(1.),vec3(.7),coord.y),u_tintOpacity);
        color=vec4(tinted,color.a);

        float maskD;
        if(isPill(u_resolution,u_borderRadius)) maskD=pillDistance(coord,u_resolution,u_borderRadius);
        else if(isCircle(u_resolution,u_borderRadius)) maskD=circleDistance(coord,u_resolution,u_borderRadius);
        else maskD=roundedRectDistance(coord,u_resolution,u_borderRadius);
        gl_FragColor=vec4(color.rgb,1.-smoothstep(-1.,1.,maskD));
      }`

    const program = this.createProgram(gl, vsSource, fsSource)
    if (!program) return

    gl.useProgram(program)

    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
    const tb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,1,1,1,0,0,0,0,1,1,1,0]), gl.STATIC_DRAW)

    const posLoc = gl.getAttribLocation(program,'a_position')
    const tcLoc  = gl.getAttribLocation(program,'a_texcoord')
    const refs = {
      gl, texture: null,
      resolutionLoc:       gl.getUniformLocation(program,'u_resolution'),
      textureSizeLoc:      gl.getUniformLocation(program,'u_textureSize'),
      scrollYLoc:          gl.getUniformLocation(program,'u_scrollY'),
      pageHeightLoc:       gl.getUniformLocation(program,'u_pageHeight'),
      viewportHeightLoc:   gl.getUniformLocation(program,'u_viewportHeight'),
      blurRadiusLoc:       gl.getUniformLocation(program,'u_blurRadius'),
      borderRadiusLoc:     gl.getUniformLocation(program,'u_borderRadius'),
      containerPositionLoc:gl.getUniformLocation(program,'u_containerPosition'),
      warpLoc:             gl.getUniformLocation(program,'u_warp'),
      edgeIntensityLoc:    gl.getUniformLocation(program,'u_edgeIntensity'),
      rimIntensityLoc:     gl.getUniformLocation(program,'u_rimIntensity'),
      baseIntensityLoc:    gl.getUniformLocation(program,'u_baseIntensity'),
      edgeDistanceLoc:     gl.getUniformLocation(program,'u_edgeDistance'),
      rimDistanceLoc:      gl.getUniformLocation(program,'u_rimDistance'),
      baseDistanceLoc:     gl.getUniformLocation(program,'u_baseDistance'),
      cornerBoostLoc:      gl.getUniformLocation(program,'u_cornerBoost'),
      rippleEffectLoc:     gl.getUniformLocation(program,'u_rippleEffect'),
      tintOpacityLoc:      gl.getUniformLocation(program,'u_tintOpacity'),
      imageLoc:            gl.getUniformLocation(program,'u_image'),
      positionBuffer: pb, texcoordBuffer: tb
    }

    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    refs.texture = tex

    this.gl_refs = refs
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, pb)
    gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, tb)
    gl.enableVertexAttribArray(tcLoc); gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 0, 0)

    gl.uniform2f(refs.resolutionLoc, this.canvas.width, this.canvas.height)
    gl.uniform2f(refs.textureSizeLoc, image.width, image.height)
    gl.uniform1f(refs.blurRadiusLoc, 5.0)
    gl.uniform1f(refs.borderRadiusLoc, this.borderRadius)
    gl.uniform1f(refs.warpLoc, 0.0)
    gl.uniform1f(refs.edgeIntensityLoc, 0.01)
    gl.uniform1f(refs.rimIntensityLoc, 0.05)
    gl.uniform1f(refs.baseIntensityLoc, 0.01)
    gl.uniform1f(refs.edgeDistanceLoc, 0.15)
    gl.uniform1f(refs.rimDistanceLoc, 0.8)
    gl.uniform1f(refs.baseDistanceLoc, 0.1)
    gl.uniform1f(refs.cornerBoostLoc, 0.02)
    gl.uniform1f(refs.rippleEffectLoc, 0.1)
    gl.uniform1f(refs.tintOpacityLoc, this.tintOpacity)

    const pos = this.getPosition()
    gl.uniform2f(refs.containerPositionLoc, pos.x, pos.y)
    gl.uniform1f(refs.pageHeightLoc, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))
    gl.uniform1f(refs.viewportHeightLoc, window.innerHeight)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(refs.imageLoc, 0)

    this.startRenderLoop()
  }

  startRenderLoop() {
    const render = () => {
      if (!this.gl_refs.gl) return
      const gl = this.gl_refs.gl
      gl.clear(gl.COLOR_BUFFER_BIT)
      const scrollY = window.pageYOffset || document.documentElement.scrollTop
      gl.uniform1f(this.gl_refs.scrollYLoc, scrollY)
      const pos = this.getPosition()
      gl.uniform2f(this.gl_refs.containerPositionLoc, pos.x, pos.y)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    render()
    window.addEventListener('scroll', render, { passive: true })
    this.render = render
  }

  createProgram(gl, vs, fs) {
    const v = this.compileShader(gl, gl.VERTEX_SHADER, vs)
    const f = this.compileShader(gl, gl.FRAGMENT_SHADER, fs)
    if (!v || !f) return null
    const p = gl.createProgram()
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('Program link error:', gl.getProgramInfoLog(p)); return null }
    return p
  }

  compileShader(gl, type, src) {
    const s = gl.createShader(type)
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('Shader error:', gl.getShaderInfoLog(s)); return null }
    return s
  }
}
