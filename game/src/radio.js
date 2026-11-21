// radio.js — 3-station radio for Crescent Bay (gta6-01 v5).
// First declaration: the station list is the contract hud.js reads
// (station name + animated equalizer) and audio.js already honours.
// Behaviour (spec §3.4): R cycles the station; the HUD shows the
// station name plus a small animated equalizer. Three stations, each a
// distinct procedural WebAudio loop, via the base Audio class's
// setStation hook (its startMusic loop already plays a different bass
// line per station — Bay FM driving synthwave bass, Harbor Jazz slow
// swing roots, Crescent Rock driving rock riff). Station 1 ("Bay FM")
// is the default on New Game. The radio keeps playing through missions
// and free roam. Music only, no talk. The old single music loop is
// replaced by this station system.

// game.time is a plain seconds number in the base main loop.
function now(game) {
  if (typeof game.time === 'number') return game.time;
  if (game.time && typeof game.time.now === 'number') return game.time.now;
  return 0;
}

export const RADIO_STATIONS = [
  { name: 'Bay FM', style: 'synthwave, driving bass', tempo: 'fast', wave: 'triangle' },
  { name: 'Harbor Jazz', style: 'slow swing', tempo: 'slow', wave: 'sine' },
  { name: 'Crescent Rock', style: 'driving rock riff', tempo: 'fast', wave: 'sawtooth' },
];

export function createRadioState() {
  return {
    station: 0, // Bay FM is the default on New Game
    lastSwitchAt: -99,
    eqPhase: 0,
  };
}

export function ensureRadio(game) {
  if (!game.radio) game.radio = createRadioState();
  // Keep the Audio instance in sync if it was created separately.
  if (game.audio && typeof game.audio.stationIndex === 'number') {
    game.audio.stationIndex = game.radio.station;
  }
  return game.radio;
}

export function stationName(game) {
  ensureRadio(game);
  return RADIO_STATIONS[game.radio.station].name;
}

export function currentStation(game) {
  ensureRadio(game);
  return RADIO_STATIONS[game.radio.station];
}

// Cycle to the next station (R key). Uses Audio.setStation so the
// procedural loop follows immediately.
export function cycleStation(game) {
  const r = ensureRadio(game);
  r.station = (r.station + 1) % RADIO_STATIONS.length;
  r.lastSwitchAt = now(game);
  game.radioStation = RADIO_STATIONS[r.station].name; // render.js reads this
  if (game.audio && typeof game.audio.setStation === 'function') {
    game.audio.setStation(r.station);
  }
  if (game.hud) game.hud.message = `Radio: ${RADIO_STATIONS[r.station].name}`;
  return RADIO_STATIONS[r.station].name;
}

export function setStation(game, index) {
  const r = ensureRadio(game);
  r.station = ((index % RADIO_STATIONS.length) + RADIO_STATIONS.length) % RADIO_STATIONS.length;
  r.lastSwitchAt = now(game);
  game.radioStation = RADIO_STATIONS[r.station].name;
  if (game.audio && typeof game.audio.setStation === 'function') {
    game.audio.setStation(r.station);
  }
  return RADIO_STATIONS[r.station].name;
}

// Start the radio on New Game: station 1, music loop running.
export function startRadio(game) {
  ensureRadio(game);
  game.radio.station = 0;
  game.radioStation = RADIO_STATIONS[0].name; // render.js reads this
  if (game.audio && typeof game.audio.setStation === 'function') game.audio.setStation(0);
  if (game.audio && typeof game.audio.startMusic === 'function') game.audio.startMusic();
}

// Equalizer levels for the HUD: 5 bars, animated from the station's
// tempo (fast stations bounce quicker). Deterministic-ish, driven by
// game time so the HUD draw stays pure.
export function equalizerLevels(game, at) {
  const r = ensureRadio(game);
  const st = RADIO_STATIONS[r.station];
  const speed = st.tempo === 'slow' ? 3.2 : 7.5;
  const t = (at != null ? at : now(game)) * speed;
  const levels = [];
  for (let i = 0; i < 5; i++) {
    levels.push(0.35 + 0.65 * Math.abs(Math.sin(t + i * 1.3)));
  }
  return levels;
}

// main.js owns the R key (it cycles the station itself and calls
// Audio.setStation) — this update only keeps game.radioStation in sync
// with the Audio instance, so the HUD never shows a stale station.
// Cycling here too would skip a station on every press.
export function updateRadio(game, dt) {
  void dt;
  ensureRadio(game);
  if (game.audio && typeof game.audio.stationIndex === 'number') {
    const idx = game.audio.stationIndex;
    if (idx !== game.radio.station) game.radio.station = idx;
  }
  game.radioStation = RADIO_STATIONS[game.radio.station].name;
}

// main.js calls update(game, dt) on every loaded system.
export function update(game, dt) {
  updateRadio(game, dt);
}

export function init(game) {
  ensureRadio(game);
  game.radioStation = RADIO_STATIONS[game.radio.station].name;
}
