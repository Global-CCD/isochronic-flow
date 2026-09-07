class IsochronicProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'carrierFreq', defaultValue: 200, minValue: 50, maxValue: 1000 },
      { name: 'pulseRate', defaultValue: 10, minValue: 0.1, maxValue: 40 },
      { name: 'dutyCycle', defaultValue: 0.5, minValue: 0.05, maxValue: 0.95 },
      { name: 'steepness', defaultValue: 15, minValue: 1, maxValue: 50 },
      { name: 'volume', defaultValue: 0.5, minValue: 0, maxValue: 1 }
    ];
  }

  constructor() {
    super();
    this.carrierPhase = 0;
    this.pulsePhase = 0;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const channel = output[0];
    const sampleRate = globalThis.sampleRate;

    // Parameter arrays (k-rate or a-rate)
    const carrier = parameters.carrierFreq;
    const pulse = parameters.pulseRate;
    const duty = parameters.dutyCycle;
    const steep = parameters.steepness;
    const vol = parameters.volume;

    for (let i = 0; i < channel.length; ++i) {
      const cFreq = carrier.length > 1 ? carrier[i] : carrier[0];
      const pFreq = pulse.length > 1 ? pulse[i] : pulse[0];
      const dty = duty.length > 1 ? duty[i] : duty[0];
      const stp = steep.length > 1 ? steep[i] : steep[0];
      const v = vol.length > 1 ? vol[i] : vol[0];

      // 1. Carrier Wave (Sine)
      this.carrierPhase += (2 * Math.PI * cFreq) / sampleRate;
      if (this.carrierPhase > 2 * Math.PI) this.carrierPhase -= 2 * Math.PI;
      const carrierSample = Math.sin(this.carrierPhase);

      // 2. Pulse Envelope (True Clinical Trapezoidal/Raised Cosine)
      this.pulsePhase += (2 * Math.PI * pFreq) / sampleRate;
      if (this.pulsePhase > 2 * Math.PI) this.pulsePhase -= 2 * Math.PI;

      const normPhase = this.pulsePhase / (2 * Math.PI);
      let envelope = 0;

      // Enforce 100% Depth: Absolute silence when outside duty cycle
      if (normPhase < dty) {
        // Normalize phase within the active duty cycle (0.0 to 1.0)
        const localPos = normPhase / dty;
        
        // Smooth raised cosine (0 -> 1 -> 0)
        const rawEnv = Math.sin(localPos * Math.PI);
        
        // Apply steepness (High steepness = flatter top, sharper attack/decay)
        // 1/stp creates a square-like clinical pulse
        envelope = Math.pow(rawEnv, 1 / stp);
      }

      channel[i] = carrierSample * envelope * v;
    }

    // Duplicate left channel to right for stereo output
    if (output.length > 1) {
      output[1].set(channel);
    }

    return true;
  }
}

registerProcessor('isochronic-processor', IsochronicProcessor);