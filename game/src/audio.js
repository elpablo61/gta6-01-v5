// Crescent Bay — synthesized WebAudio sound. No audio files: every effect
// is built from oscillators and noise, and the music is a small procedural
// loop. Audio starts only after the first user interaction (a click on New
// Game), so it never errors on load.

export function playSiren(audio) {
  audio.siren(true);
}

export function playGunshot(audio) {
  audio.gunshot();
}

export function startMusicLoop(audio) {
  audio.startMusic();
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicTimer = null;
    this.stationIndex = 0;
    this.stations = ['Bay FM', 'Harbor Jazz', 'Crescent Rock'];
    this.musicOn = true;
    this.sirenOsc = null;
    this.engineOsc = null;
    this.engineGain = null;
    this._beat = 0;
  }

  // Lazily create the context on first user gesture.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  _tone(freq, dur, type, vol, slideTo) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise(dur, vol, lowpass) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol || 0.3;
    let node = src;
    if (lowpass) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      src.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  click() { this._tone(660, 0.07, 'square', 0.12); }
  gunshot() { this._noise(0.14, 0.5, 1800); this._tone(140, 0.1, 'sawtooth', 0.25, 50); }
  pickup() { this._tone(880, 0.08, 'sine', 0.2); setTimeout(() => this._tone(1320, 0.1, 'sine', 0.2), 70); }
  crash() { this._noise(0.3, 0.4, 900); }
  cash() { this._tone(990, 0.09, 'sine', 0.2); setTimeout(() => this._tone(1480, 0.14, 'sine', 0.2), 90); }
  door() { this._tone(220, 0.08, 'triangle', 0.2, 160); }

  siren(on) {
    if (!this.ensure()) return;
    if (on && !this.sirenOsc) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 700;
      g.gain.value = 0.05;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.6;
      const lg = this.ctx.createGain();
      lg.gain.value = 250;
      lfo.connect(lg);
      lg.connect(o.frequency);
      o.connect(g);
      g.connect(this.master);
      o.start();
      lfo.start();
      this.sirenOsc = { o, lfo, g };
    } else if (!on && this.sirenOsc) {
      try { this.sirenOsc.o.stop(); this.sirenOsc.lfo.stop(); } catch { /* already stopped */ }
      this.sirenOsc = null;
    }
  }

  engine(on, speedRatio) {
    if (!this.ensure()) return;
    if (on && !this.engineOsc) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = 60;
      g.gain.value = 0.04;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400;
      o.connect(f);
      f.connect(g);
      g.connect(this.master);
      o.start();
      this.engineOsc = o;
      this.engineGain = g;
    } else if (!on && this.engineOsc) {
      try { this.engineOsc.stop(); } catch { /* already stopped */ }
      this.engineOsc = null;
      this.engineGain = null;
    }
    if (this.engineOsc && speedRatio !== undefined) {
      this.engineOsc.frequency.value = 55 + speedRatio * 140;
      this.engineGain.gain.value = 0.03 + speedRatio * 0.04;
    }
  }

  // Radio: the radio system calls setStation(i); the music loop follows it.
  setStation(i) {
    this.stationIndex = ((i % this.stations.length) + this.stations.length) % this.stations.length;
    this._beat = 0;
    return this.stations[this.stationIndex];
  }

  stationName() {
    return this.stations[this.stationIndex];
  }

  startMusic() {
    if (!this.ensure() || this.musicTimer) return;
    const bassLines = [
      [55, 55, 65.4, 49], // Bay FM: driving synthwave bass
      [65.4, 49, 58.3, 49], // Harbor Jazz: slow swing roots
      [73.4, 73.4, 98, 82.4], // Crescent Rock: driving rock riff
    ];
    this.musicTimer = setInterval(() => {
      if (!this.musicOn || !this.ctx || this.ctx.state !== 'running') return;
      const line = bassLines[this.stationIndex] || bassLines[0];
      const note = line[this._beat % line.length];
      this._beat++;
      const tempo = this.stationIndex === 1 ? 520 : 300;
      this._tone(note, 0.28, this.stationIndex === 2 ? 'sawtooth' : 'triangle', 0.12);
      if (this._beat % 2 === 0) this._tone(note * 4, 0.12, 'sine', 0.05);
      void tempo;
    }, 300);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
