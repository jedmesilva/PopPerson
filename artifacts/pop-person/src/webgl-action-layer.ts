type CellPosition = {
  x: number;
  y: number;
  r?: number;
};

type ActionEffect = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  controlX: number;
  controlY: number;
  startTime: number;
  duration: number;
  targetName: string;
  direction?: number;
};

type ImpactEffect = {
  targetName: string;
  x: number;
  y: number;
  r: number;
  color: string;
  startTime: number;
  duration: number;
};

type WebGLActionLayerInput = {
  now: number;
  width: number;
  height: number;
  pixelRatio: number;
  scale: number;
  projectiles: ActionEffect[];
  impacts: ImpactEffect[];
  resolveCell: (name: string) => CellPosition | null;
};

type WebGLActionLayer = {
  resize: (width: number, height: number, pixelRatio: number) => void;
  render: (input: WebGLActionLayerInput) => void;
  destroy: () => void;
};

const FLOATS_PER_PARTICLE = 8;
const INITIAL_PARTICLE_CAPACITY = 4096;
const MAX_POINT_SIZE = 180;

const vertexShaderSource = `
  attribute vec2 a_position;
  attribute float a_size;
  attribute vec4 a_color;
  attribute float a_kind;
  uniform vec2 u_resolution;
  uniform float u_pixelRatio;
  varying vec4 v_color;
  varying float v_kind;

  void main() {
    vec2 zeroToOne = a_position / u_resolution;
    vec2 clipSpace = zeroToOne * 2.0 - 1.0;
    gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
    gl_PointSize = a_size * u_pixelRatio;
    v_color = a_color;
    v_kind = a_kind;
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec4 v_color;
  varying float v_kind;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceFromCenter = length(centered) * 2.0;

    if (v_kind > 0.5) {
      float ring = 1.0 - smoothstep(0.62, 0.84, distanceFromCenter);
      float glow = 1.0 - smoothstep(0.18, 0.95, distanceFromCenter);
      float alpha = max(ring * 0.95, glow * 0.38) * v_color.a;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(v_color.rgb, alpha);
      return;
    }

    float glow = 1.0 - smoothstep(0.08, 1.0, distanceFromCenter);
    float alpha = glow * v_color.a;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(v_color.rgb, alpha);
  }
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeOutQuad(value: number): number {
  return 1 - (1 - value) * (1 - value);
}

function quadBezier(p0: number, p1: number, p2: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function parseColor(value: string): [number, number, number] {
  const parts = value.split(",").map((part) => Number(part.trim()) / 255);
  return [
    Number.isFinite(parts[0]) ? parts[0] : 1,
    Number.isFinite(parts[1]) ? parts[1] : 1,
    Number.isFinite(parts[2]) ? parts[2] : 1,
  ];
}

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Não foi possível criar o shader WebGL.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "Shader inválido.";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  if (!program) throw new Error("Não foi possível criar o programa WebGL.");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "Programa WebGL inválido.";
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}

export function createWebGLActionLayer(canvas: HTMLCanvasElement): WebGLActionLayer | null {
  const glContext = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    depth: false,
    premultipliedAlpha: true,
    powerPreference: "high-performance",
  });
  if (!glContext) return null;
  const gl = glContext;

  try {
    const program = createProgram(gl);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Não foi possível criar o buffer WebGL.");

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const sizeLocation = gl.getAttribLocation(program, "a_size");
    const colorLocation = gl.getAttribLocation(program, "a_color");
    const kindLocation = gl.getAttribLocation(program, "a_kind");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const pixelRatioLocation = gl.getUniformLocation(program, "u_pixelRatio");
    let particleData = new Float32Array(INITIAL_PARTICLE_CAPACITY * FLOATS_PER_PARTICLE);

    function ensureCapacity(requiredParticles: number): void {
      const requiredLength = requiredParticles * FLOATS_PER_PARTICLE;
      if (requiredLength <= particleData.length) return;
      let nextLength = particleData.length;
      while (nextLength < requiredLength) nextLength *= 2;
      const nextData = new Float32Array(nextLength);
      nextData.set(particleData);
      particleData = nextData;
    }

    function resize(width: number, height: number, pixelRatio: number): void {
      const safePixelRatio = Math.max(1, pixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * safePixelRatio));
      canvas.height = Math.max(1, Math.round(height * safePixelRatio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform2f(resolutionLocation, width, height);
      gl.uniform1f(pixelRatioLocation, safePixelRatio);
    }

    function render(input: WebGLActionLayerInput): void {
      const { now, width, height, pixelRatio, scale, projectiles, impacts, resolveCell } = input;
      let particleCount = 0;
      ensureCapacity(projectiles.length * 4 + impacts.length);

      const addParticle = (
        x: number,
        y: number,
        size: number,
        color: [number, number, number],
        alpha: number,
        kind: number,
      ): void => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || alpha <= 0) return;
        const offset = particleCount * FLOATS_PER_PARTICLE;
        particleData[offset] = x;
        particleData[offset + 1] = y;
        particleData[offset + 2] = clamp(size, 1, MAX_POINT_SIZE);
        particleData[offset + 3] = color[0];
        particleData[offset + 4] = color[1];
        particleData[offset + 5] = color[2];
        particleData[offset + 6] = clamp(alpha, 0, 1);
        particleData[offset + 7] = kind;
        particleCount += 1;
      };

      projectiles.forEach((projectile) => {
        const target = resolveCell(projectile.targetName);
        const duration = Math.max(1, projectile.duration || 1);
        const progress = clamp((now - projectile.startTime) / duration, 0, 1);
        const eased = easeOutQuad(progress);
        const endX = target?.x ?? projectile.endX;
        const endY = target?.y ?? projectile.endY;
        const originalMidX = (projectile.startX + projectile.endX) / 2;
        const originalMidY = (projectile.startY + projectile.endY) / 2;
        const controlX = (projectile.startX + endX) / 2 + (projectile.controlX - originalMidX);
        const controlY = (projectile.startY + endY) / 2 + (projectile.controlY - originalMidY);
        const color: [number, number, number] = (projectile.direction ?? -1) > 0
          ? [0.133, 0.773, 0.365]
          : [0.937, 0.267, 0.267];
        const baseSize = clamp((target?.r ?? 18) * scale * 0.56, 7, 28);

        [0.27, 0.18, 0.09, 0].forEach((offset, index) => {
          const trailProgress = eased - offset;
          if (trailProgress <= 0) return;
          addParticle(
            quadBezier(projectile.startX, controlX, endX, trailProgress),
            quadBezier(projectile.startY, controlY, endY, trailProgress),
            baseSize * (1 - index * 0.12),
            color,
            0.3 + (3 - index) * 0.16,
            0,
          );
        });
      });

      impacts.forEach((impact) => {
        const target = resolveCell(impact.targetName);
        const progress = clamp((now - impact.startTime) / Math.max(1, impact.duration), 0, 1);
        const color = parseColor(impact.color);
        addParticle(
          target?.x ?? impact.x,
          target?.y ?? impact.y,
          clamp((target?.r ?? impact.r) * scale * (1.8 + progress * 0.8), 12, MAX_POINT_SIZE),
          color,
          1 - progress,
          1,
        );
      });

      gl.viewport(0, 0, Math.max(1, Math.round(width * pixelRatio)), Math.max(1, Math.round(height * pixelRatio)));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (particleCount === 0) return;

      gl.useProgram(program);
      gl.uniform2f(resolutionLocation, width, height);
      gl.uniform1f(pixelRatioLocation, Math.max(1, pixelRatio || 1));
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, particleData.subarray(0, particleCount * FLOATS_PER_PARTICLE), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, FLOATS_PER_PARTICLE * 4, 0);
      gl.enableVertexAttribArray(sizeLocation);
      gl.vertexAttribPointer(sizeLocation, 1, gl.FLOAT, false, FLOATS_PER_PARTICLE * 4, 2 * 4);
      gl.enableVertexAttribArray(colorLocation);
      gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, FLOATS_PER_PARTICLE * 4, 3 * 4);
      gl.enableVertexAttribArray(kindLocation);
      gl.vertexAttribPointer(kindLocation, 1, gl.FLOAT, false, FLOATS_PER_PARTICLE * 4, 7 * 4);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, particleCount);
    }

    function destroy(): void {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    }

    return { resize, render, destroy };
  } catch (error) {
    console.warn("[WebGL] Action layer unavailable; using 2D fallback.", error);
    return null;
  }
}