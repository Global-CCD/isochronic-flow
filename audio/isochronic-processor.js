class IsochronicProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "carrierFreq",
        defaultValue: 200,
        minValue: 20,
        maxValue: 1000,
        automationRate: "a-rate"
      },
      {
        name: "pulseRate",
        defaultValue: 10,
        minValue: 0.1,
        maxValue: 40,
        automationRate: "a-rate"
      },
      {
        name: "dutyCycle",
        defaultValue: 0.5,
        minValue: 0.05,
        maxValue: 0.95,
        automationRate: "k-rate"
      },
      {
        name: "attackRatio",
        defaultValue: 0.18,
        minValue: 0.01,
        maxValue: 0.49,
        automationRate: "k-rate"
      }
    ];
  }

  constructor() {
    super();
    this.carrierPhase = 0;
    this.pulsePhase = 0;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || !output.length) return true;

    const left = output[0];
    if (!left) return true;

    const right = output.length > 1 ? output[1] : null;

    const sampleRate = globalThis.sampleRate;
    const twoPi = Math.PI * 2;

    const carrierParam = parameters.carrierFreq;
    const pulseParam = parameters.pulseRate;
    const dutyParam = parameters.dutyCycle;
    const attackParam = parameters.attackRatio;

    const carrierIsConstant = carrierParam.length === 1;
    const pulseIsConstant = pulseParam.length === 1;
    const dutyIsConstant = dutyParam.length === 1;
    const attackIsConstant = attackParam.length === 1;

    const fixedCarrier = carrierIsConstant ? carrierParam[0] : 0;
    const fixedPulse = pulseIsConstant ? pulseParam[0] : 0;
    const fixedDuty = dutyIsConstant ? dutyParam[0] : 0;
    const fixedAttack = attackIsConstant ? attackParam[0] : 0;

    for (let i = 0; i < left.length; i++) {
      const carrierFreq = carrierIsConstant ? fixedCarrier : carrierParam[i];
      const pulseRate = pulseIsConstant ? fixedPulse : pulseParam[i];
      const duty = dutyIsConstant ? fixedDuty : dutyParam[i];
      const attackRatio = attackIsConstant ? fixedAttack : attackParam[i];

      // Carrier phase accumulation.
      this.carrierPhase += (twoPi * carrierFreq) / sampleRate;
      while (this.carrierPhase >= twoPi) {
        this.carrierPhase -= twoPi;
      }
      while (this.carrierPhase < 0) {
        this.carrierPhase += twoPi;
      }

      // Pulse phase accumulation.
      this.pulsePhase += (twoPi * pulseRate) / sampleRate;
      while (this.pulsePhase >= twoPi) {
        this.pulsePhase -= twoPi;
      }
      while (this.pulsePhase < 0) {
        this.pulsePhase += twoPi;
      }

      const pulsePosition = this.pulsePhase / twoPi;

      let envelope = 0;

      // True clinical isochronic behavior:
      // 100% modulation depth with complete silence outside the duty window.
      if (pulsePosition < duty) {
        const x = duty > 0 ? pulsePosition / duty : 0;

        // Clamp attack/release to avoid overlapping regions.
        const attack = Math.min(0.49, Math.max(0.01, attackRatio));
        const releaseStart = 1 - attack;

        if (x < attack) {
          // Raised-cosine attack.
          // First derivative is zero at x = 0.
          envelope = 0.5 * (1 - Math.cos((Math.PI * x) / attack));
        } else if (x > releaseStart) {
          // Raised-cosine release.
          // First derivative is zero at x = 1.
          envelope = 0.5 * (1 - Math.cos((Math.PI * (1 - x)) / attack));
        } else {
          // Flat top.
          envelope = 1;
        }
      }

      left[i] = Math.sin(this.carrierPhase) * envelope;
    }

    if (right) {
      right.set(left);
    }

    return true;
  }
}

registerProcessor("isochronic-processor", IsochronicProcessor);