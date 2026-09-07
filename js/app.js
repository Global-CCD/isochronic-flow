(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    playBtn: $("playBtn"),
    status: $("status"),
    timer: $("timer"),
    visualizer: $("visualizer"),

    mode: $("mode"),
    outputDevice: $("outputDevice"),
    outputGroup: $("outputGroup"),

    carrierFreq: $("carrierFreq"),
    carrierVal: $("carrierVal"),

    pulseRate: $("pulseRate"),
    pulseVal: $("pulseVal"),

    dutyCycle: $("dutyCycle"),
    dutyVal: $("dutyVal"),

    volume: $("volume"),
    volVal: $("volVal"),

    manualControls: $("manualControls"),
    descentControls: $("descentControls"),

    descentStart: $("descentStart"),
    descentStartVal: $("descentStartVal"),

    descentEnd: $("descentEnd"),
    descentEndVal: $("descentEndVal"),

    descentDuration: $("descentDuration"),
    descentDurationVal: $("descentDurationVal"),

    curve: $("curve"),

    harmonicEnabled: $("harmonicEnabled"),
    harmonicCarrierRatio: $("harmonicCarrierRatio"),
    harmonicPulseRatio: $("harmonicPulseRatio"),
    harmonicLevel: $("harmonicLevel"),
    harmonicLevelVal: $("harmonicLevelVal"),

    noiseEnabled: $("noiseEnabled"),
    noiseType: $("noiseType"),
    noiseLevel: $("noiseLevel"),
    noiseLevelVal: $("noiseLevelVal")
  };

  const ATTACK_RATIO = 0.18;

  const MIN_PULSE = 0.1;
  const MAX_PULSE = 40;

  const MIN_CARRIER = 20;
  const MAX_CARRIER = 1000;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  const supportsSinkSelection =
    !!AudioContextClass && "setSinkId" in AudioContextClass.prototype;

  let audioCtx = null;

  let masterGain = null;

  let primaryNode = null;
  let primaryGain = null;

  let harmonicNode = null;
  let harmonicGain = null;

  let noiseGain = null;
  let noiseSource = null;
  let noiseStartTimeout = null;
  let stopTimeout = null;

  const noiseBuffers = {};

  let isPlaying = false;
  let wakeLock = null;
  let timerInterval = null;
  let descentState = null;

  const displayMap = {
    carrierFreq: "carrierVal",
    pulseRate: "pulseVal",
    dutyCycle: "dutyVal",
    volume: "volVal",
    descentStart: "descentStartVal",
    descentEnd: "descentEndVal",
    descentDuration: "descentDurationVal",
    harmonicLevel: "harmonicLevelVal",
    noiseLevel: "noiseLevelVal"
  };

  function clamp(value, min, max) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      return min;
    }

    return Math.min(max, Math.max(min, n));
  }

  function paramMin(param, fallback) {
    if (param && typeof param.minValue === "number") {
      return param.minValue;
    }

    return fallback;
  }

  function paramMax(param, fallback) {
    if (param && typeof param.maxValue === "number") {
      return param.maxValue;
    }

    return fallback;
  }

  function safeGetLocalStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSetLocalStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore storage errors.
    }
  }

  function setStatus(message) {
    if (els.status) {
      els.status.textContent = message;
    }
  }

  function formatControlValue(id, rawValue) {
    const value = Number(rawValue);

    if (
      id === "pulseRate" ||
      id === "descentStart" ||
      id === "descentEnd"
    ) {
      return value.toFixed(1);
    }

    return String(rawValue);
  }

  function syncDisplay(id) {
    const input = els[id];
    const displayId = displayMap[id];

    if (!input || !displayId) {
      return;
    }

    const display = els[displayId];

    if (!display) {
      return;
    }

    display.textContent = formatControlValue(id, input.value);
  }

  function syncAllDisplays() {
    Object.keys(displayMap).forEach((id) => {
      syncDisplay(id);
    });
  }

  function toggleModeUI() {
    if (!els.mode || !els.manualControls || !els.descentControls) {
      return;
    }

    const mode = els.mode.value;

    els.manualControls.classList.toggle("hidden", mode !== "manual");
    els.descentControls.classList.toggle("hidden", mode !== "descent");
  }

  function updateTransport() {
    if (!els.playBtn) {
      return;
    }

    if (isPlaying) {
      els.playBtn.textContent = "Stop Session";
      els.playBtn.classList.add("stop");
    } else {
      els.playBtn.textContent = "Start Session";
      els.playBtn.classList.remove("stop");
    }
  }

  async function initAudio() {
    if (audioCtx) {
      return;
    }

    if (!AudioContextClass) {
      setStatus("Web Audio is not supported in this browser.");
      throw new Error("Web Audio is not supported.");
    }

    audioCtx = new AudioContextClass({
      latencyHint: "playback"
    });

    await audioCtx.audioWorklet.addModule("audio/isochronic-processor.js");

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(audioCtx.destination);

    const carrier = clamp(els.carrierFreq.value, MIN_CARRIER, MAX_CARRIER);
    const pulse = clamp(els.pulseRate.value, MIN_PULSE, MAX_PULSE);
    const duty = clamp(els.dutyCycle.value, 5, 95) / 100;

    const harmonicCarrierRatio = clamp(els.harmonicCarrierRatio.value, 1, 3);
    const harmonicPulseRatio = clamp(els.harmonicPulseRatio.value, 0.25, 4);

    primaryNode = new AudioWorkletNode(audioCtx, "isochronic-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: {
        carrierFreq: carrier,
        pulseRate: pulse,
        dutyCycle: duty,
        attackRatio: ATTACK_RATIO
      }
    });

    harmonicNode = new AudioWorkletNode(audioCtx, "isochronic-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: {
        carrierFreq: clamp(carrier * harmonicCarrierRatio, MIN_CARRIER, MAX_CARRIER),
        pulseRate: clamp(pulse * harmonicPulseRatio, MIN_PULSE, MAX_PULSE),
        dutyCycle: duty,
        attackRatio: ATTACK_RATIO
      }
    });

    primaryGain = audioCtx.createGain();
    primaryGain.gain.value = 1;

    harmonicGain = audioCtx.createGain();
    harmonicGain.gain.value = 0;

    noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0;

    primaryNode.connect(primaryGain).connect(masterGain);
    harmonicNode.connect(harmonicGain).connect(masterGain);
    noiseGain.connect(masterGain);

    applyCarrier();
    applyDuty();
    applyHarmonicGain();
    applyNoiseGain();

    if (!supportsSinkSelection && els.outputGroup) {
      els.outputGroup.hidden = true;
    }
  }

  function setParamSmooth(param, value, timeConstant = 0.025) {
    if (!param || !audioCtx) {
      return;
    }

    const now = audioCtx.currentTime;

    const min = paramMin(param, -Infinity);
    const max = paramMax(param, Infinity);

    const safeValue = clamp(value, min, max);

    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.setTargetAtTime(safeValue, now, timeConstant);
  }

  function applyCarrier() {
    if (!audioCtx || !primaryNode || !harmonicNode) {
      return;
    }

    const carrier = clamp(els.carrierFreq.value, MIN_CARRIER, MAX_CARRIER);
    const ratio = clamp(els.harmonicCarrierRatio.value, 1, 3);

    const primaryCarrier = clamp(carrier, MIN_CARRIER, MAX_CARRIER);
    const harmonicCarrier = clamp(carrier * ratio, MIN_CARRIER, MAX_CARRIER);

    setParamSmooth(primaryNode.parameters.get("carrierFreq"), primaryCarrier);
    setParamSmooth(harmonicNode.parameters.get("carrierFreq"), harmonicCarrier);
  }

  function applyDuty() {
    if (!audioCtx || !primaryNode || !harmonicNode) {
      return;
    }

    const duty = clamp(els.dutyCycle.value, 5, 95) / 100;

    setParamSmooth(primaryNode.parameters.get("dutyCycle"), duty);
    setParamSmooth(harmonicNode.parameters.get("dutyCycle"), duty);

    setParamSmooth(primaryNode.parameters.get("attackRatio"), ATTACK_RATIO);
    setParamSmooth(harmonicNode.parameters.get("attackRatio"), ATTACK_RATIO);
  }

  function applyManualPulse() {
    if (!audioCtx || !primaryNode || !harmonicNode) {
      return;
    }

    if (els.mode.value !== "manual") {
      return;
    }

    descentState = null;

    const rate = clamp(els.pulseRate.value, MIN_PULSE, MAX_PULSE);
    const pulseRatio = clamp(els.harmonicPulseRatio.value, 0.25, 4);

    const harmonicRate = clamp(rate * pulseRatio, MIN_PULSE, MAX_PULSE);

    setParamSmooth(primaryNode.parameters.get("pulseRate"), rate);
    setParamSmooth(harmonicNode.parameters.get("pulseRate"), harmonicRate);

    updateTimer();
  }

  function scheduleParam(
    param,
    startValue,
    endValue,
    durationSeconds,
    curve,
    startTime
  ) {
    if (!param || !audioCtx) {
      return;
    }

    const min = paramMin(param, MIN_PULSE);
    const max = paramMax(param, MAX_PULSE);

    let safeStart = clamp(startValue, min, max);
    let safeEnd = clamp(endValue, min, max);

    if (curve === "exponential") {
      safeStart = Math.max(safeStart, 0.1);
      safeEnd = Math.max(safeEnd, 0.1);
    }

    param.cancelScheduledValues(startTime);
    param.setValueAtTime(safeStart, startTime);

    if (durationSeconds <= 0.05) {
      param.setValueAtTime(safeEnd, startTime + 0.05);
      return;
    }

    if (curve === "linear") {
      param.linearRampToValueAtTime(safeEnd, startTime + durationSeconds);
      return;
    }

    if (curve === "exponential") {
      param.exponentialRampToValueAtTime(safeEnd, startTime + durationSeconds);
      return;
    }

    // Smooth step curve.
    const points = Math.max(
      64,
      Math.min(12000, Math.floor(durationSeconds * 8))
    );

    const values = new Float32Array(points);

    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      const smooth = t * t * (3 - 2 * t);

      values[i] = safeStart + (safeEnd - safeStart) * smooth;
    }

    param.setValueCurveAtTime(values, startTime, durationSeconds);
  }

  function scheduleDescent() {
    if (!audioCtx || !primaryNode || !harmonicNode) {
      return;
    }

    if (els.mode.value !== "descent") {
      return;
    }

    const start = clamp(els.descentStart.value, MIN_PULSE, MAX_PULSE);
    const end = clamp(els.descentEnd.value, MIN_PULSE, MAX_PULSE);

    const durationMinutes = clamp(els.descentDuration.value, 1, 120);
    const durationSeconds = durationMinutes * 60;

    const curve = els.curve.value;

    const pulseRatio = clamp(els.harmonicPulseRatio.value, 0.25, 4);

    const harmonicStart = clamp(start * pulseRatio, MIN_PULSE, MAX_PULSE);
    const harmonicEnd = clamp(end * pulseRatio, MIN_PULSE, MAX_PULSE);

    const startTime = audioCtx.currentTime + 0.05;

    scheduleParam(
      primaryNode.parameters.get("pulseRate"),
      start,
      end,
      durationSeconds,
      curve,
      startTime
    );

    scheduleParam(
      harmonicNode.parameters.get("pulseRate"),
      harmonicStart,
      harmonicEnd,
      durationSeconds,
      curve,
      startTime
    );

    descentState = {
      start,
      end,
      startTime,
      durationSeconds,
      curve
    };

    updateTimer();
  }

  function getCurrentPrimaryRate() {
    const manualRate = clamp(els.pulseRate.value, MIN_PULSE, MAX_PULSE);

    if (els.mode.value !== "descent" || !descentState || !audioCtx) {
      return manualRate;
    }

    const now = audioCtx.currentTime;
    const d = descentState;

    if (now < d.startTime) {
      return d.start;
    }

    const elapsed = now - d.startTime;

    if (elapsed >= d.durationSeconds) {
      return d.end;
    }

    const t = elapsed / d.durationSeconds;

    if (d.curve === "linear") {
      return d.start + (d.end - d.start) * t;
    }

    if (d.curve === "exponential") {
      const safeStart = Math.max(d.start, 0.1);
      const safeEnd = Math.max(d.end, 0.1);

      return safeStart * Math.pow(safeEnd / safeStart, t);
    }

    const smooth = t * t * (3 - 2 * t);

    return d.start + (d.end - d.start) * smooth;
  }

  function getVisualizerState() {
    return {
      playing: isPlaying,
      rate: getCurrentPrimaryRate(),
      duty: clamp(els.dutyCycle.value, 5, 95) / 100
    };
  }

  function applyHarmonicGain() {
    if (!audioCtx || !harmonicGain) {
      return;
    }

    const enabled = els.harmonicEnabled.checked;
    const level = clamp(els.harmonicLevel.value, 0, 100) / 100;

    harmonicGain.gain.setTargetAtTime(
      enabled ? level : 0,
      audioCtx.currentTime,
      0.03
    );
  }

  function applyNoiseGain() {
    if (!audioCtx || !noiseGain) {
      return;
    }

    const enabled = els.noiseEnabled.checked;
    const level = clamp(els.noiseLevel.value, 0, 100) / 100;

    noiseGain.gain.setTargetAtTime(
      enabled ? level : 0,
      audioCtx.currentTime,
      0.04
    );
  }

  function createNoiseBuffer(type) {
    if (!audioCtx) {
      return null;
    }

    const cacheKey = type;

    if (noiseBuffers[cacheKey]) {
      return noiseBuffers[cacheKey];
    }

    const length = audioCtx.sampleRate * 2;
    const buffer = audioCtx.createBuffer(2, length, audioCtx.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);

      if (type === "pink") {
        let b0 = 0;
        let b1 = 0;
        let b2 = 0;
        let b3 = 0;
        let b4 = 0;
        let b5 = 0;
        let b6 = 0;

        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;

          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.969 * b2 + white * 0.153852;
          b3 = 0.8665 * b3 + white * 0.3104856;
          b4 = 0.55 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.016898;

          data[i] =
            (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;

          b6 = white * 0.115926;
        }
      } else {
        let last = 0;

        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;

          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.5;
        }
      }
    }

    noiseBuffers[cacheKey] = buffer;

    return buffer;
  }

  function startNoise() {
    if (!audioCtx || !noiseGain) {
      return;
    }

    if (!els.noiseEnabled.checked) {
      return;
    }

    if (!isPlaying) {
      return;
    }

    stopNoise(true);

    if (noiseStartTimeout) {
      clearTimeout(noiseStartTimeout);
    }

    noiseStartTimeout = setTimeout(() => {
      noiseStartTimeout = null;

      if (!audioCtx || !noiseGain) {
        return;
      }

      if (!els.noiseEnabled.checked || !isPlaying) {
        return;
      }

      const buffer = createNoiseBuffer(els.noiseType.value);

      if (!buffer) {
        return;
      }

      noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;
      noiseSource.connect(noiseGain);
      noiseSource.start();

      applyNoiseGain();
    }, 140);
  }

  function stopNoise(fade = true) {
    if (noiseStartTimeout) {
      clearTimeout(noiseStartTimeout);
      noiseStartTimeout = null;
    }

    if (!noiseSource) {
      return;
    }

    const source = noiseSource;

    noiseSource = null;

    if (fade && audioCtx && noiseGain) {
      noiseGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.03);

      setTimeout(() => {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }

        try {
          source.disconnect();
        } catch {
          // Already disconnected.
        }
      }, 130);
    } else {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }

      try {
        source.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }

  function setMasterVolumeFromUI() {
    if (!audioCtx || !masterGain) {
      return;
    }

    const volume = clamp(els.volume.value, 0, 100) / 100;
    const perceived = volume * volume;

    if (!isPlaying) {
      masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
      return;
    }

    masterGain.gain.setTargetAtTime(perceived, audioCtx.currentTime, 0.04);
  }

  async function startSession() {
    try {
      if (stopTimeout) {
        clearTimeout(stopTimeout);
        stopTimeout = null;
      }

      setStatus("Starting audio engine...");

      await initAudio();

      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      applyCarrier();
      applyDuty();
      applyHarmonicGain();
      applyNoiseGain();

      if (els.mode.value === "descent") {
        scheduleDescent();
      } else {
        applyManualPulse();
      }

      const now = audioCtx.currentTime;

      const volume = clamp(els.volume.value, 0, 100) / 100;
      const perceived = volume * volume;

      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.linearRampToValueAtTime(
        Math.max(perceived, 0.0001),
        now + 0.25
      );

      isPlaying = true;

      updateTransport();

      if (typeof startVisualizer === "function") {
        startVisualizer();
      }

      if (timerInterval) {
        clearInterval(timerInterval);
      }

      timerInterval = setInterval(updateTimer, 250);

      if (els.noiseEnabled.checked) {
        startNoise();
      }

      await requestWakeLock();

      setStatus("Session running.");
    } catch (error) {
      console.error(error);
      setStatus("Failed to start audio. Check browser permissions and HTTPS.");
    }
  }

  function stopSession() {
    if (!audioCtx) {
      return;
    }

    isPlaying = false;

    const now = audioCtx.currentTime;

    if (masterGain) {
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.18);
    }

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    if (stopTimeout) {
      clearTimeout(stopTimeout);
    }

    stopTimeout = setTimeout(() => {
      stopTimeout = null;

      stopNoise(true);

      if (audioCtx && audioCtx.state === "running") {
        audioCtx.suspend().catch(() => {
          // Ignore suspend errors.
        });
      }
    }, 220);

    releaseWakeLock();

    if (typeof stopVisualizer === "function") {
      stopVisualizer();
    }

    updateTransport();

    if (els.timer) {
      els.timer.textContent = "Stopped";
    }

    setStatus("Session stopped.");
  }

  async function togglePlay() {
    if (isPlaying) {
      stopSession();
    } else {
      await startSession();
    }
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      setStatus("Wake Lock unsupported. Keep screen active manually if needed.");
      return;
    }

    try {
      wakeLock = await navigator.wakeLock.request("screen");

      wakeLock.addEventListener("release", () => {
        setStatus("Wake Lock released.");
      });
    } catch (error) {
      console.warn(error);
      setStatus("Wake Lock unavailable.");
    }
  }

  async function releaseWakeLock() {
    if (!wakeLock) {
      return;
    }

    try {
      await wakeLock.release();
    } catch {
      // Ignore release errors.
    }

    wakeLock = null;
  }

  async function populateOutputDevices() {
    if (!supportsSinkSelection) {
      if (els.outputGroup) {
        els.outputGroup.hidden = true;
      }

      return;
    }

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.enumerateDevices
    ) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const outputs = devices.filter(
        (device) => device.kind === "audiooutput"
      );

      els.outputDevice.innerHTML = `
        <option value="default">Default System Output</option>
      `;

      outputs.forEach((device, index) => {
        const option = document.createElement("option");

        option.value = device.deviceId;
        option.textContent = device.label || `Output ${index + 1}`;

        els.outputDevice.appendChild(option);
      });

      const savedSink = safeGetLocalStorage("isochronic-preferred-sink");

      if (
        savedSink &&
        els.outputDevice.querySelector(`option[value="${savedSink}"]`)
      ) {
        els.outputDevice.value = savedSink;
      }
    } catch (error) {
      console.warn(error);
    }
  }

  async function changeOutputDevice() {
    const sinkId = els.outputDevice.value;

    safeSetLocalStorage("isochronic-preferred-sink", sinkId);

    if (!audioCtx || !supportsSinkSelection) {
      return;
    }

    try {
      await audioCtx.setSinkId(sinkId === "default" ? "" : sinkId);
      setStatus("Output device changed.");
    } catch (error) {
      console.warn(error);
      setStatus("Output change failed. Stop and start the session.");
    }
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.ceil(totalSeconds));

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(
        secs
      ).padStart(2, "0")}`;
    }

    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function updateTimer() {
    if (!els.timer) {
      return;
    }

    if (!isPlaying || !audioCtx) {
      els.timer.textContent = "Manual";
      return;
    }

    if (els.mode.value === "descent" && descentState) {
      const remaining =
        descentState.startTime +
        descentState.durationSeconds -
        audioCtx.currentTime;

      if (remaining > 0) {
        els.timer.textContent = `Descent ${formatTime(remaining)}`;
      } else {
        const target = clamp(els.descentEnd.value, MIN_PULSE, MAX_PULSE);

        els.timer.textContent = `Holding ${target.toFixed(1)} Hz`;
      }

      return;
    }

    els.timer.textContent = "Manual";
  }

  function applyPreset(preset) {
    if (!preset) {
      return;
    }

    if (preset.mode) {
      els.mode.value = preset.mode;
    }

    if (preset.carrier !== undefined) {
      els.carrierFreq.value = preset.carrier;
    }

    if (preset.pulse !== undefined) {
      els.pulseRate.value = preset.pulse;
    }

    if (preset.duty !== undefined) {
      els.dutyCycle.value = preset.duty;
    }

    if (preset.volume !== undefined) {
      els.volume.value = preset.volume;
    }

    if (preset.descentStart !== undefined) {
      els.descentStart.value = preset.descentStart;
    }

    if (preset.descentEnd !== undefined) {
      els.descentEnd.value = preset.descentEnd;
    }

    if (preset.duration !== undefined) {
      els.descentDuration.value = preset.duration;
    }

    if (preset.curve !== undefined) {
      els.curve.value = preset.curve;
    }

    if (typeof preset.harmonicEnabled === "boolean") {
      els.harmonicEnabled.checked = preset.harmonicEnabled;
    }

    if (preset.harmonicCarrierRatio !== undefined) {
      els.harmonicCarrierRatio.value = preset.harmonicCarrierRatio;
    }

    if (preset.harmonicPulseRatio !== undefined) {
      els.harmonicPulseRatio.value = preset.harmonicPulseRatio;
    }

    if (preset.harmonicLevel !== undefined) {
      els.harmonicLevel.value = preset.harmonicLevel;
    }

    if (typeof preset.noiseEnabled === "boolean") {
      els.noiseEnabled.checked = preset.noiseEnabled;
    }

    if (preset.noiseType !== undefined) {
      els.noiseType.value = preset.noiseType;
    }

    if (preset.noiseLevel !== undefined) {
      els.noiseLevel.value = preset.noiseLevel;
    }

    syncAllDisplays();
    toggleModeUI();

    if (audioCtx) {
      applyCarrier();
      applyDuty();
      applyHarmonicGain();
      applyNoiseGain();

      if (els.mode.value === "manual") {
        applyManualPulse();
      } else if (isPlaying) {
        scheduleDescent();
      }

      if (isPlaying && els.noiseEnabled.checked) {
        startNoise();
      }

      if (isPlaying && !els.noiseEnabled.checked) {
        stopNoise(true);
      }

      setMasterVolumeFromUI();
    }

    setStatus(`Preset loaded: ${preset.label || "Custom"}`);
  }

  function bindEvents() {
    if (!els.playBtn) {
      return;
    }

    els.playBtn.addEventListener("click", togglePlay);

    Object.keys(displayMap).forEach((id) => {
      const input = els[id];

      if (!input) {
        return;
      }

      input.addEventListener("input", (event) => {
        syncDisplay(event.target.id);

        switch (event.target.id) {
          case "carrierFreq":
            applyCarrier();
            break;

          case "pulseRate":
            applyManualPulse();
            break;

          case "dutyCycle":
            applyDuty();
            break;

          case "volume":
            setMasterVolumeFromUI();
            break;

          case "harmonicLevel":
            applyHarmonicGain();
            break;

          case "noiseLevel":
            applyNoiseGain();
            break;

          default:
            break;
        }
      });
    });

    ["descentStart", "descentEnd", "descentDuration"].forEach((id) => {
      const input = els[id];

      if (!input) {
        return;
      }

      input.addEventListener("change", () => {
        if (isPlaying && els.mode.value === "descent") {
          scheduleDescent();
        }
      });
    });

    els.mode.addEventListener("change", () => {
      toggleModeUI();

      if (!isPlaying) {
        return;
      }

      if (els.mode.value === "descent") {
        scheduleDescent();
      } else {
        applyManualPulse();
      }
    });

    els.curve.addEventListener("change", () => {
      if (isPlaying && els.mode.value === "descent") {
        scheduleDescent();
      }
    });

    els.harmonicEnabled.addEventListener("change", applyHarmonicGain);

    els.harmonicCarrierRatio.addEventListener("change", applyCarrier);

    els.harmonicPulseRatio.addEventListener("change", () => {
      if (els.mode.value === "descent" && isPlaying) {
        scheduleDescent();
      } else {
        applyManualPulse();
      }
    });

    els.noiseEnabled.addEventListener("change", () => {
      if (!isPlaying) {
        return;
      }

      if (els.noiseEnabled.checked) {
        startNoise();
      } else {
        stopNoise(true);
      }
    });

    els.noiseType.addEventListener("change", () => {
      if (!isPlaying || !els.noiseEnabled.checked) {
        return;
      }

      startNoise();
    });

    els.outputDevice.addEventListener("change", changeOutputDevice);

    document.querySelectorAll(".preset-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const presetKey = button.dataset.preset;

        if (typeof PRESETS === "undefined") {
          return;
        }

        const preset = PRESETS[presetKey];

        applyPreset(preset);
      });
    });

    document.addEventListener("visibilitychange", async () => {
      if (!isPlaying) {
        return;
      }

      if (document.visibilityState === "visible") {
        if (audioCtx && audioCtx.state === "suspended") {
          try {
            await audioCtx.resume();
            setStatus("Audio resumed.");
          } catch {
            // Ignore resume errors.
          }
        }

        await requestWakeLock();
      }
    });
  }

  function init() {
    syncAllDisplays();
    toggleModeUI();
    updateTransport();
    bindEvents();
    populateOutputDevices();

    if (typeof initVisualizer === "function") {
      initVisualizer(els.visualizer, getVisualizerState);
    }

    if (!supportsSinkSelection) {
      setStatus("Output selection is not supported in this browser.");
    }
  }

  init();
})();