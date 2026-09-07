let vizCanvas = null;
let vizCtx = null;
let vizRaf = null;
let vizLastTime = 0;
let vizPhase = 0;
let vizGetState = null;

function initVisualizer(canvasElement, stateGetter) {
  vizCanvas = canvasElement;
  vizGetState = stateGetter;

  if (!vizCanvas) return;

  vizCtx = vizCanvas.getContext("2d");

  resizeVisualizer();
  window.addEventListener("resize", resizeVisualizer);

  drawIdle();
}

function resizeVisualizer() {
  if (!vizCanvas) return;

  const rect = vizCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  vizCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
  vizCanvas.height = Math.max(1, Math.floor(rect.height * dpr));

  vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startVisualizer() {
  if (!vizCtx || vizRaf) return;

  vizLastTime = performance.now();
  vizRaf = requestAnimationFrame(visualizerFrame);
}

function stopVisualizer() {
  if (vizRaf) {
    cancelAnimationFrame(vizRaf);
    vizRaf = null;
  }

  drawIdle();
}

function visualizerFrame(now) {
  const state = vizGetState ? vizGetState() : null;

  if (!state) {
    drawIdle();
    return;
  }

  const dt = Math.min(0.1, (now - vizLastTime) / 1000);
  vizLastTime = now;

  if (state.playing && state.rate > 0) {
    vizPhase += dt * state.rate;
    vizPhase %= 1;
  }

  drawPulse(state);

  vizRaf = requestAnimationFrame(visualizerFrame);
}

function clinicalEnvelope(phase, duty) {
  const attack = 0.18;

  if (phase >= duty) {
    return 0;
  }

  const x = duty > 0 ? phase / duty : 0;

  if (x < attack) {
    return 0.5 * (1 - Math.cos((Math.PI * x) / attack));
  }

  if (x > 1 - attack) {
    return 0.5 * (1 - Math.cos((Math.PI * (1 - x)) / attack));
  }

  return 1;
}

function drawPulse(state) {
  if (!vizCtx || !vizCanvas) return;

  const rect = vizCanvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  vizCtx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  const env = clinicalEnvelope(vizPhase, state.duty);

  const minDimension = Math.min(w, h);
  const baseRadius = minDimension * 0.14;
  const pulseRadius = baseRadius + env * minDimension * 0.23;

  // Background reference ring.
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
  vizCtx.strokeStyle = "rgba(255,255,255,0.08)";
  vizCtx.lineWidth = 1;
  vizCtx.stroke();

  // Active pulse ring.
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
  vizCtx.strokeStyle = `rgba(53, 214, 255, ${0.18 + env * 0.82})`;
  vizCtx.lineWidth = 2 + env * 7;
  vizCtx.shadowColor = "rgba(53, 214, 255, 0.55)";
  vizCtx.shadowBlur = 18 * env;
  vizCtx.stroke();
  vizCtx.shadowBlur = 0;

  // Center dot.
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, 3 + env * 4, 0, Math.PI * 2);
  vizCtx.fillStyle = `rgba(255,255,255,${0.25 + env * 0.75})`;
  vizCtx.fill();

  // Text.
  vizCtx.fillStyle = "rgba(232,237,243,0.72)";
  vizCtx.font = "12px ui-sans-serif, system-ui, sans-serif";
  vizCtx.textAlign = "center";
  vizCtx.fillText(
    `${state.rate.toFixed(2)} Hz | duty ${(state.duty * 100).toFixed(0)}%`,
    cx,
    h - 16
  );
}

function drawIdle() {
  if (!vizCtx || !vizCanvas) return;

  const rect = vizCanvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  vizCtx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.14;

  vizCtx.beginPath();
  vizCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  vizCtx.strokeStyle = "rgba(255,255,255,0.10)";
  vizCtx.lineWidth = 1.5;
  vizCtx.stroke();

  vizCtx.beginPath();
  vizCtx.arc(cx, cy, 3, 0, Math.PI * 2);
  vizCtx.fillStyle = "rgba(255,255,255,0.25)";
  vizCtx.fill();

  vizCtx.fillStyle = "rgba(232,237,243,0.45)";
  vizCtx.font = "12px ui-sans-serif, system-ui, sans-serif";
  vizCtx.textAlign = "center";
  vizCtx.fillText("Stopped", cx, h - 16);
}