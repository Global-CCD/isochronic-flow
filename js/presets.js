const PRESETS = {
  focus: {
    label: "Deep Focus",
    mode: "manual",
    carrier: 216,
    pulse: 14,
    duty: 50,
    volume: 55,
    harmonicEnabled: false,
    harmonicCarrierRatio: "2",
    harmonicPulseRatio: "1",
    harmonicLevel: 18,
    noiseEnabled: false,
    noiseType: "pink",
    noiseLevel: 10
  },

  calm: {
    label: "Wind Down",
    mode: "descent",
    carrier: 216,
    descentStart: 12,
    descentEnd: 6,
    duration: 15,
    curve: "smooth",
    duty: 45,
    volume: 52,
    harmonicEnabled: true,
    harmonicCarrierRatio: "2",
    harmonicPulseRatio: "0.5",
    harmonicLevel: 16,
    noiseEnabled: false,
    noiseType: "pink",
    noiseLevel: 12
  },

  sleep: {
    label: "Deep Sleep Descent",
    mode: "descent",
    carrier: 136,
    descentStart: 10,
    descentEnd: 1.5,
    duration: 30,
    curve: "smooth",
    duty: 35,
    volume: 48,
    harmonicEnabled: true,
    harmonicCarrierRatio: "1",
    harmonicPulseRatio: "0.5",
    harmonicLevel: 20,
    noiseEnabled: true,
    noiseType: "brown",
    noiseLevel: 18
  }
};