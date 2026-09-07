let audioCtx = null;
let isochronicNode = null;
let isPlaying = false;
let wakeLock = null;

const playBtn = document.getElementById('playBtn');
const outputSelect = document.getElementById('outputDevice');

const sliders = {
  carrier: { el: document.getElementById('carrierFreq'), val: document.getElementById('carrierVal'), param: 'carrierFreq', format: v => v },
  pulse: { el: document.getElementById('pulseRate'), val: document.getElementById('pulseVal'), param: 'pulseRate', format: v => parseFloat(v).toFixed(1) },
  duty: { el: document.getElementById('dutyCycle'), val: document.getElementById('dutyVal'), param: 'dutyCycle', format: v => v, scale: 0.01 },
  vol: { el: document.getElementById('volume'), val: document.getElementById('volVal'), param: 'volume', format: v => v, scale: 0.01 }
};

async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Load the worklet module
    await audioCtx.audioWorklet.addModule('audio/isochronic-processor.js');
    
    isochronicNode = new AudioWorkletNode(audioCtx, 'isochronic-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2], // Stereo
      parameterData: {
        carrierFreq: parseFloat(sliders.carrier.el.value),
        pulseRate: parseFloat(sliders.pulse.el.value),
        dutyCycle: parseFloat(sliders.duty.el.value) * 0.01,
        volume: parseFloat(sliders.vol.el.value) * 0.01,
        steepness: 15 // Fixed clinical steepness
      }
    });
    
    connectToOutput();
  }
  
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
}

async function connectToOutput() {
  if (!audioCtx || !isochronicNode) return;
  
  isochronicNode.disconnect();
  const sinkId = outputSelect.value === 'default' ? '' : outputSelect.value;

  if (audioCtx.setSinkId && sinkId) {
    try {
      await audioCtx.setSinkId(sinkId);
    } catch (err) {
      console.warn('Failed to set sinkId:', err);
    }
  }
  isochronicNode.connect(audioCtx.destination);
}

async function populateOutputDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
    
    outputSelect.innerHTML = '<option value="default">Default System Output</option>';
    
    audioOutputs.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      // Note: Labels may be hidden by browser privacy settings until a stream is active
      option.text = device.label || `Output ${index + 1}`;
      outputSelect.appendChild(option);
    });
    
    const savedSink = localStorage.getItem('preferredSink');
    if (savedSink && outputSelect.querySelector(`option[value="${savedSink}"]`)) {
      outputSelect.value = savedSink;
    }
  } catch (err) {
    console.error('Error enumerating devices:', err);
  }
}

outputSelect.addEventListener('change', async () => {
  const sinkId = outputSelect.value;
  localStorage.setItem('preferredSink', sinkId);
  
  if (audioCtx && audioCtx.setSinkId) {
    try {
      await audioCtx.setSinkId(sinkId === 'default' ? '' : sinkId);
      // Re-connect to ensure the new sink is active
      isochronicNode.disconnect();
      isochronicNode.connect(audioCtx.destination);
    } catch (err) {
      alert('Could not switch output. Please Stop and Start the session again.');
    }
  }
});

function setupSliderListeners() {
  Object.keys(sliders).forEach(key => {
    const s = sliders[key];
    s.el.addEventListener('input', (e) => {
      const rawVal = parseFloat(e.target.value);
      s.val.textContent = s.format(e.target.value);
      
      if (isochronicNode) {
        const paramVal = s.scale ? rawVal * s.scale : rawVal;
        isochronicNode.parameters.get(s.param).setValueAtTime(paramVal, audioCtx.currentTime);
        
        if (typeof updateVisualizerParams === 'function') {
          updateVisualizerParams({ [s.param]: paramVal });
        }
      }
    });
  });
}

async function togglePlay() {
  if (!isPlaying) {
    await initAudio();
    requestWakeLock();
    isPlaying = true;
    playBtn.textContent = 'Stop Session';
    playBtn.classList.add('stop');
    startVisualizer();
  } else {
    isPlaying = false;
    playBtn.textContent = 'Start Session';
    playBtn.classList.remove('stop');
    
    if (audioCtx) {
      // Smooth fade out to prevent clicks
      const volParam = isochronicNode.parameters.get('volume');
      volParam.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
      setTimeout(() => {
        if (audioCtx.state === 'running') {
           audioCtx.suspend();
           volParam.setValueAtTime(sliders.vol.el.value * 0.01, audioCtx.currentTime);
        }
      }, 150);
    }
    
    releaseWakeLock();
    stopVisualizer();
  }
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.warn('WakeLock failed:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => { wakeLock = null; });
  }
}

document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible') requestWakeLock();
});

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = PRESETS[btn.dataset.preset];
    if (preset && isPlaying) {
      Object.keys(preset).forEach(param => {
        const sliderObj = Object.values(sliders).find(s => s.param === param);
        if (sliderObj) {
          sliderObj.el.value = preset[param];
          sliderObj.el.dispatchEvent(new Event('input'));
        }
      });
    }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  setupSliderListeners();
  populateOutputDevices();
  playBtn.addEventListener('click', togglePlay);
  if (typeof initVisualizer === 'function') initVisualizer(document.getElementById('visualizer'));
});