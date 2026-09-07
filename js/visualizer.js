let canvas, ctx, animationId;
let vizParams = { pulseRate: 10, dutyCycle: 0.5 };

function initVisualizer(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  drawStatic();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function updateVisualizerParams(params) {
  Object.assign(vizParams, params);
}

function drawStatic() {
  if (!ctx) return;
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}

function draw() {
  if (!ctx) return;
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

  const pulsesToShow = 4;
  const cycleWidth = w / pulsesToShow;
  const duty = vizParams.dutyCycle || 0.5;
  
  ctx.lineWidth = 2;
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#00d2ff';
  ctx.strokeStyle = '#00d2ff';
  ctx.beginPath();
  
  for (let x = 0; x <= w; x++) {
    const cyclePos = (x % cycleWidth) / cycleWidth;
    let y = h / 2;
    
    if (cyclePos < duty) {
      const localPos = cyclePos / duty;
      const env = Math.sin(localPos * Math.PI); 
      const steepEnv = Math.pow(env, 0.5); // Visual steepness
      y = (h / 2) - (steepEnv * (h / 2 - 10));
    }
    
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  
  ctx.stroke();
  ctx.shadowBlur = 0;
  animationId = requestAnimationFrame(draw);
}

function startVisualizer() { if (!animationId) draw(); }
function stopVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
    drawStatic();
  }
}