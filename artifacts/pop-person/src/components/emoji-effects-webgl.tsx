import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

const DEFAULT_EMOJIS = ["❤️", "🔥", "😂", "👏", "😍", "🎉", "💯", "😮"];
const FLOATS_PER_INSTANCE = 11;
const QUAD_VERTEX_COUNT = 6;
const ATLAS_CELL_SIZE = 128;
const DEFAULT_CAPACITY = 2048;

export interface EmojiEffectsHandle {
  spawn(input: EmojiSpawnInput): void;
  clear(): void;
}

export interface EmojiSpawnInput {
  targetName: string;
  emoji: string;
  count: number;
  actionType: string;
  staggerMs?: number;
  durationMs?: number;
  startDelayMs?: number;
}

export interface EmojiWorldPosition {
  x: number;
  y: number;
}

export interface EmojiEffectsProps {
  targetsRef: {
    current: { get(name: string): EmojiWorldPosition | undefined } | null | undefined;
  };
  transformRef: {
    current: { x: number; y: number; scale: number };
  };
  maxInstances?: number;
}

const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec2 aOrigin;
layout(location = 3) in float aSpawnTime;
layout(location = 4) in float aDuration;
layout(location = 5) in float aDrift;
layout(location = 6) in float aSize;
layout(location = 7) in float aRotate;
layout(location = 8) in float aTexIndex;
layout(location = 9) in float aRise;
layout(location = 10) in float aSway;

uniform float uTime;
uniform vec2 uResolution;
uniform float uAtlasCols;

out vec2 vUV;
out float vAlpha;

float easeOutCubic(float t) {
  float n = 1.0 - t;
  return 1.0 - n * n * n;
}

float remap(float value, float from, float to) {
  return clamp((value - from) / (to - from), 0.0, 1.0);
}

void main() {
  float rawProgress = clamp((uTime - aSpawnTime) / max(aDuration, 0.001), 0.0, 1.0);
  float progress = easeOutCubic(rawProgress);
  float riseProgress = smoothstep(0.0, 1.0, progress);
  float driftProgress = smoothstep(0.08, 1.0, progress);
  float entrance = remap(progress, 0.0, 0.14);
  float exit = 1.0 - remap(progress, 0.76, 1.0);
  float alpha = min(entrance, exit);
  float scale = mix(0.72, 1.0, smoothstep(0.0, 0.13, progress));
  scale *= mix(1.0, 0.88, smoothstep(0.72, 1.0, progress));

  float wobble = sin((uTime - aSpawnTime) * 4.8 + aSway) * aDrift * 0.18;
  float angle = radians(aRotate) * smoothstep(0.0, 1.0, progress);
  float c = cos(angle);
  float s = sin(angle);
  vec2 corner = aCorner * aSize * scale;
  vec2 rotated = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  vec2 centerPx = aOrigin + vec2(aDrift * driftProgress + wobble, aRise * riseProgress);
  vec2 positionPx = centerPx + rotated;

  vec2 clip = vec2(
    positionPx.x / uResolution.x * 2.0 - 1.0,
    1.0 - positionPx.y / uResolution.y * 2.0
  );

  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = vec2((aUV.x + aTexIndex) / uAtlasCols, aUV.y);
  vAlpha = alpha;
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

in vec2 vUV;
in float vAlpha;

uniform sampler2D uAtlas;
out vec4 fragColor;

void main() {
  vec4 texel = texture(uAtlas, vUV);
  fragColor = vec4(texel.rgb, texel.a * vAlpha);
}`;

type ActionProfile = {
  duration: number;
  rise: number;
  drift: number;
  sizeMin: number;
  sizeMax: number;
  rotation: number;
};

type QueuedEmoji = {
  targetName: string;
  fallbackX: number;
  fallbackY: number;
  spawnTime: number;
  duration: number;
  drift: number;
  size: number;
  rotation: number;
  rise: number;
  sway: number;
  texIndex: number;
};

type GLState = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  quadBuffer: WebGLBuffer;
  instanceBuffer: WebGLBuffer;
  atlasTexture: WebGLTexture;
  atlasEmojis: string[];
  atlasIndices: Map<string, number>;
  instanceData: Float32Array;
  slots: Array<QueuedEmoji | null>;
  capacity: number;
  writeIndex: number;
  activeCount: number;
  startTime: number;
  pixelRatio: number;
  uniforms: {
    time: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    atlasCols: WebGLUniformLocation | null;
    atlas: WebGLUniformLocation | null;
  };
};

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): { program: WebGLProgram; vertexShader: WebGLShader; fragmentShader: WebGLShader } {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("Unable to create WebGL program");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown program link error";
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(message);
  }
  return { program, vertexShader, fragmentShader };
}

function getActionProfile(actionType: string): ActionProfile {
  const action = actionType.trim().toLowerCase();

  if (action === "hate") {
    return {
      duration: 1.65,
      rise: -126,
      drift: 42,
      sizeMin: 30,
      sizeMax: 48,
      rotation: 32,
    };
  }

  if (action === "fan") {
    return {
      duration: 1.5,
      rise: -92,
      drift: 28,
      sizeMin: 30,
      sizeMax: 46,
      rotation: 22,
    };
  }

  return {
    duration: 1.55,
    rise: -104,
    drift: 28,
    sizeMin: 29,
    sizeMax: 44,
    rotation: 28,
  };
}

function getTargetPosition(
  targetsRef: EmojiEffectsProps["targetsRef"],
  transformRef: EmojiEffectsProps["transformRef"],
  targetName: string,
  fallbackX: number,
  fallbackY: number,
): { x: number; y: number } {
  const target = targetsRef.current?.get(targetName);
  const transform = transformRef.current;
  const targetX = Number(target?.x);
  const targetY = Number(target?.y);
  const x = Number.isFinite(targetX) ? targetX : fallbackX;
  const y = Number.isFinite(targetY) ? targetY : fallbackY;
  const tx = Number.isFinite(transform?.x) ? transform.x : 0;
  const ty = Number.isFinite(transform?.y) ? transform.y : 0;
  const scale = Number.isFinite(transform?.scale) ? transform.scale : 1;

  return {
    x: (tx + x * scale),
    y: (ty + y * scale),
  };
}

function drawAtlas(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  emojis: string[],
): void {
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = ATLAS_CELL_SIZE * Math.max(1, emojis.length);
  atlasCanvas.height = ATLAS_CELL_SIZE;
  const context = atlasCanvas.getContext("2d");
  if (!context) throw new Error("Unable to create emoji atlas");

  context.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${Math.floor(ATLAS_CELL_SIZE * 0.72)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  emojis.forEach((emoji, index) => {
    context.fillText(
      emoji,
      index * ATLAS_CELL_SIZE + ATLAS_CELL_SIZE / 2,
      ATLAS_CELL_SIZE / 2 + ATLAS_CELL_SIZE * 0.04,
    );
  });

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    atlasCanvas,
  );
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

function ensureEmojiInAtlas(
  state: GLState,
  emoji: string,
): number {
  const existing = state.atlasIndices.get(emoji);
  if (existing !== undefined) return existing;

  const index = state.atlasEmojis.length;
  state.atlasEmojis.push(emoji);
  state.atlasIndices.set(emoji, index);
  drawAtlas(state.gl, state.atlasTexture, state.atlasEmojis);
  state.gl.useProgram(state.program);
  state.gl.uniform1f(state.uniforms.atlasCols, state.atlasEmojis.length);
  return index;
}

function writeInstanceToBuffer(
  state: GLState,
  slotIndex: number,
  instance: QueuedEmoji,
  targetsRef: EmojiEffectsProps["targetsRef"],
  transformRef: EmojiEffectsProps["transformRef"],
): void {
  const target = getTargetPosition(
    targetsRef,
    transformRef,
    instance.targetName,
    instance.fallbackX,
    instance.fallbackY,
  );
  const offset = slotIndex * FLOATS_PER_INSTANCE;
  const dpr = state.pixelRatio;
  state.instanceData[offset] = target.x * dpr;
  state.instanceData[offset + 1] = target.y * dpr;
  state.instanceData[offset + 2] = instance.spawnTime;
  state.instanceData[offset + 3] = instance.duration;
  state.instanceData[offset + 4] = instance.drift * dpr;
  state.instanceData[offset + 5] = instance.size * dpr;
  state.instanceData[offset + 6] = instance.rotation;
  state.instanceData[offset + 7] = instance.texIndex;
  state.instanceData[offset + 8] = instance.rise * dpr;
  state.instanceData[offset + 9] = instance.sway;
  state.instanceData[offset + 10] = 0;
}

function enqueueSpawn(
  state: GLState,
  input: EmojiSpawnInput,
  targetsRef: EmojiEffectsProps["targetsRef"],
  transformRef: EmojiEffectsProps["transformRef"],
): void {
  const targetName = typeof input.targetName === "string" ? input.targetName : "";
  const emoji = typeof input.emoji === "string" && input.emoji.length > 0
    ? input.emoji
    : "✨";
  const count = Math.min(100_000, Math.max(0, Math.floor(Number(input.count))));
  if (!targetName || count <= 0) return;

  const profile = getActionProfile(String(input.actionType ?? ""));
  const texIndex = ensureEmojiInAtlas(state, emoji);
  const now = performance.now() / 1000 - state.startTime;
  const staggerSeconds = Math.min(
    2,
    Math.max(0.004, Number(input.staggerMs ?? 0) / 1000),
  );
  const startDelaySeconds = Math.min(
    2,
    Math.max(0, Number(input.startDelayMs ?? 0) / 1000),
  );
  const durationSeconds = Number(input.durationMs);
  const baseDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds / 1000
    : profile.duration;
  const target = targetsRef.current?.get(targetName);
  const targetX = Number(target?.x);
  const targetY = Number(target?.y);
  const fallbackWorldX = Number.isFinite(targetX) ? targetX : 0;
  const fallbackWorldY = Number.isFinite(targetY) ? targetY : 0;

  for (let index = 0; index < count; index += 1) {
    const slotIndex = state.writeIndex;
    const instance: QueuedEmoji = {
      targetName,
      fallbackX: fallbackWorldX,
      fallbackY: fallbackWorldY,
      spawnTime: now + startDelaySeconds + index * staggerSeconds,
      duration: Math.max(0.24, baseDuration + (Math.random() - 0.5) * 0.16),
      drift: (Math.random() - 0.5) * profile.drift,
      size: profile.sizeMin + Math.random() * (profile.sizeMax - profile.sizeMin),
      rotation: (Math.random() - 0.5) * profile.rotation,
      rise: profile.rise * (0.92 + Math.random() * 0.16),
      sway: Math.random() * Math.PI * 2,
      texIndex,
    };

    state.slots[slotIndex] = instance;
    writeInstanceToBuffer(state, slotIndex, instance, targetsRef, transformRef);
    state.writeIndex = (state.writeIndex + 1) % state.capacity;
    state.activeCount = Math.min(state.capacity, state.activeCount + 1);
  }

  state.gl.bindBuffer(state.gl.ARRAY_BUFFER, state.instanceBuffer);
  state.gl.bufferSubData(state.gl.ARRAY_BUFFER, 0, state.instanceData);
}

function deleteResources(
  gl: WebGL2RenderingContext,
  state: GLState | null,
  vertexShader: WebGLShader | null,
  fragmentShader: WebGLShader | null,
): void {
  if (state) {
    gl.deleteBuffer(state.quadBuffer);
    gl.deleteBuffer(state.instanceBuffer);
    gl.deleteTexture(state.atlasTexture);
    gl.deleteProgram(state.program);
  }
  if (vertexShader) gl.deleteShader(vertexShader);
  if (fragmentShader) gl.deleteShader(fragmentShader);
}

const canvasStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
  pointerEvents: "none",
};

const EmojiEffectsWebGL = forwardRef<EmojiEffectsHandle, EmojiEffectsProps>(
  function EmojiEffectsWebGL({ targetsRef, transformRef, maxInstances }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stateRef = useRef<GLState | null>(null);
    const pendingSpawnsRef = useRef<EmojiSpawnInput[]>([]);
    const [supported, setSupported] = useState<boolean | null>(null);
    const capacity = Math.max(
      1,
      Math.min(50_000, Math.floor(Number(maxInstances) || DEFAULT_CAPACITY)),
    );

    const spawn = useCallback((input: EmojiSpawnInput) => {
      const state = stateRef.current;
      if (!state) {
        pendingSpawnsRef.current.push(input);
        if (pendingSpawnsRef.current.length > 64) {
          pendingSpawnsRef.current.shift();
        }
        return;
      }
      enqueueSpawn(state, input, targetsRef, transformRef);
    }, [targetsRef, transformRef]);

    const clear = useCallback(() => {
      pendingSpawnsRef.current = [];
      const state = stateRef.current;
      if (!state) return;

      state.writeIndex = 0;
      state.activeCount = 0;
      state.slots.fill(null);
      state.instanceData.fill(0);
      state.gl.bindBuffer(state.gl.ARRAY_BUFFER, state.instanceBuffer);
      state.gl.bufferSubData(state.gl.ARRAY_BUFFER, 0, state.instanceData);
    }, []);

    useImperativeHandle(ref, () => ({ spawn, clear }), [clear, spawn]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return undefined;

      let gl: WebGL2RenderingContext | null = null;
      let state: GLState | null = null;
      let vertexShader: WebGLShader | null = null;
      let fragmentShader: WebGLShader | null = null;
      let animationFrame = 0;
      let resizeObserver: ResizeObserver | null = null;
      let disposed = false;

      const resize = () => {
        if (!gl || !state || disposed) return;
        const rect = canvas.getBoundingClientRect();
        const pixelRatio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
        const width = Math.max(1, Math.round(rect.width * pixelRatio));
        const height = Math.max(1, Math.round(rect.height * pixelRatio));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        state.pixelRatio = pixelRatio;
        gl.viewport(0, 0, width, height);
        gl.useProgram(state.program);
        gl.uniform2f(state.uniforms.resolution, width, height);
      };

      const stop = () => {
        disposed = true;
        if (animationFrame) cancelAnimationFrame(animationFrame);
        resizeObserver?.disconnect();
        canvas.removeEventListener("webglcontextlost", handleContextLost);
        if (gl) deleteResources(gl, state, vertexShader, fragmentShader);
        if (stateRef.current === state) stateRef.current = null;
      };

      const handleContextLost = (event: Event) => {
        event.preventDefault();
        setSupported(false);
        stop();
      };

      try {
        gl = canvas.getContext("webgl2", {
          alpha: true,
          antialias: true,
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
        }) as WebGL2RenderingContext | null;
        if (!gl) {
          setSupported(false);
          return undefined;
        }

        const programParts = createProgram(
          gl,
          VERTEX_SHADER_SOURCE,
          FRAGMENT_SHADER_SOURCE,
        );
        vertexShader = programParts.vertexShader;
        fragmentShader = programParts.fragmentShader;

        const quadBuffer = gl.createBuffer();
        const instanceBuffer = gl.createBuffer();
        const atlasTexture = gl.createTexture();
        if (!quadBuffer || !instanceBuffer || !atlasTexture) {
          throw new Error("Unable to allocate WebGL buffers");
        }

        gl.useProgram(programParts.program);
        const quad = new Float32Array([
          -0.5, -0.5, 0, 1,
           0.5, -0.5, 1, 1,
           0.5,  0.5, 1, 0,
          -0.5, -0.5, 0, 1,
           0.5,  0.5, 1, 0,
          -0.5,  0.5, 0, 0,
        ]);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

        const instanceData = new Float32Array(capacity * FLOATS_PER_INSTANCE);
        gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
        const stride = FLOATS_PER_INSTANCE * 4;
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 0);
        gl.vertexAttribDivisor(2, 1);
        [3, 4, 5, 6, 7, 8, 9, 10].forEach((location, index) => {
          gl!.enableVertexAttribArray(location);
          gl!.vertexAttribPointer(location, 1, gl!.FLOAT, false, stride, 8 + index * 4);
          gl!.vertexAttribDivisor(location, 1);
        });

        const atlasEmojis = [...DEFAULT_EMOJIS];
        const atlasIndices = new Map(atlasEmojis.map((emoji, index) => [emoji, index]));
        gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        drawAtlas(gl, atlasTexture, atlasEmojis);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);

        state = {
          gl,
          program: programParts.program,
          quadBuffer,
          instanceBuffer,
          atlasTexture,
          atlasEmojis,
          atlasIndices,
          instanceData,
          slots: new Array(capacity).fill(null),
          capacity,
          writeIndex: 0,
          activeCount: 0,
          startTime: performance.now() / 1000,
          pixelRatio: 1,
          uniforms: {
            time: gl.getUniformLocation(programParts.program, "uTime"),
            resolution: gl.getUniformLocation(programParts.program, "uResolution"),
            atlasCols: gl.getUniformLocation(programParts.program, "uAtlasCols"),
            atlas: gl.getUniformLocation(programParts.program, "uAtlas"),
          },
        };
        stateRef.current = state;
        gl.uniform1i(state.uniforms.atlas, 0);
        gl.uniform1f(state.uniforms.atlasCols, atlasEmojis.length);
        setSupported(true);

        resize();
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(canvas);
        } else {
          window.addEventListener("resize", resize);
        }
        canvas.addEventListener("webglcontextlost", handleContextLost, false);

        const pending = pendingSpawnsRef.current.splice(0);
        pending.forEach((input) => {
          if (state) enqueueSpawn(state, input, targetsRef, transformRef);
        });

        const frame = (timestamp: number) => {
          if (!state || disposed) return;
          const elapsed = timestamp / 1000 - state.startTime;
          let hasLiveInstances = false;

          for (let index = 0; index < state.activeCount; index += 1) {
            const instance = state.slots[index];
            if (!instance) continue;
            writeInstanceToBuffer(state, index, instance, targetsRef, transformRef);
            if (elapsed < instance.spawnTime + instance.duration) {
              hasLiveInstances = true;
            }
          }

          gl!.clearColor(0, 0, 0, 0);
          gl!.clear(gl!.COLOR_BUFFER_BIT);
          gl!.useProgram(state.program);
          gl!.uniform1f(state.uniforms.time, elapsed);

          if (state.activeCount > 0) {
            gl!.bindBuffer(gl!.ARRAY_BUFFER, state.instanceBuffer);
            gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, state.instanceData);
          }
          if (hasLiveInstances) {
            gl!.activeTexture(gl!.TEXTURE0);
            gl!.bindTexture(gl!.TEXTURE_2D, state.atlasTexture);
            gl!.drawArraysInstanced(
              gl!.TRIANGLES,
              0,
              QUAD_VERTEX_COUNT,
              state.activeCount,
            );
          }
          animationFrame = requestAnimationFrame(frame);
        };
        animationFrame = requestAnimationFrame(frame);
      } catch {
        setSupported(false);
        stop();
      }

      return () => {
        if (typeof ResizeObserver === "undefined") {
          window.removeEventListener("resize", resize);
        }
        stop();
      };
    }, [capacity, targetsRef, transformRef]);

    return (
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        data-webgl2-supported={
          supported === null ? "unknown" : supported ? "true" : "false"
        }
        aria-hidden="true"
      />
    );
  },
);

EmojiEffectsWebGL.displayName = "EmojiEffectsWebGL";

export default EmojiEffectsWebGL;