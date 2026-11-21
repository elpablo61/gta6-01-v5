// hud.js — DOM overlays + objective state for Crescent Bay (gta6-01 v5).
// First declaration: the overlay ids are the contract main.js and the
// playtest harness read (title-screen, pause-menu, game-over-screen,
// mission-dialog, controls-list, save-slot).
// The overlays themselves live in index.html (created by the base
// builder); this file only toggles their `hidden` class and fills
// their text — it never creates duplicate elements with the same id.
// The in-game canvas HUD (stars, minimap, banner, cash, speed, ammo,
// weapon, radio equalizer) is drawn by render.js from game state; this
// file owns the objective text/target the canvas HUD reads, and the
// living-city depth helpers (spec §3.6).
// Naming: game-over says CAUGHT / DOWN — never Busted/Wasted.

export const OVERLAY_IDS = {
  title: 'title-screen',
  pause: 'pause-menu',
  gameOver: 'game-over-screen',
  dialog: 'mission-dialog',
  controls: 'controls-list',
  garage: 'garage-menu',
};

export function createHudState() {
  return {
    message: '',
    messageTimer: 0,
    damageFlash: 0,
    weaponFlash: 0,
    titleShown: false,
    pauseShown: false,
  };
}

export function ensureHud(game) {
  if (!game.hud) game.hud = createHudState();
  return game.hud;
}

// Objective state: the canvas HUD reads game.objective (banner text)
// and game.objectiveTarget (minimap diamond + world marker).
export function setObjective(game, text, target) {
  game.objective = text || '';
  game.objectiveTarget = target || null;
  return game.objective;
}

function el(id) {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id);
}

function show(id) {
  const e = el(id);
  if (e) e.classList.remove('hidden');
  return e;
}

function hide(id) {
  const e = el(id);
  if (e) e.classList.add('hidden');
  return e;
}

// --- Title screen (overlay already in index.html) ---------------------
export function showTitleScreen(game) {
  ensureHud(game).titleShown = true;
  hide(OVERLAY_IDS.pause);
  hide(OVERLAY_IDS.gameOver);
  hide(OVERLAY_IDS.dialog);
  return show(OVERLAY_IDS.title);
}

export function hideTitleScreen(game) {
  ensureHud(game).titleShown = false;
  hide(OVERLAY_IDS.title);
}

// --- Pause menu --------------------------------------------------------
export function showPauseMenu(game) {
  ensureHud(game).pauseShown = true;
  return show(OVERLAY_IDS.pause);
}

export function hidePauseMenu(game) {
  ensureHud(game).pauseShown = false;
  hide(OVERLAY_IDS.pause);
}

// --- Game over: CAUGHT (arrested) or DOWN (health 0) ------------------
export function showGameOver(game, reason) {
  const label = reason === 'caught' ? 'CAUGHT' : 'DOWN';
  const sub = reason === 'caught'
    ? 'The police took you in. You lose some cash — the city keeps moving.'
    : 'You went down. The crew patches you up — you lose some cash.';
  const title = el('game-over-title');
  if (title) title.textContent = label;
  const text = el('game-over-text');
  if (text) text.textContent = sub;
  return show(OVERLAY_IDS.gameOver);
}

export function hideGameOver() {
  hide(OVERLAY_IDS.gameOver);
}

// --- Mission dialog (fixer hook, Accept / Decline) --------------------
// Uses main.js's showDialog when present (it fills #mission-title /
// #mission-text and wires the Accept button to closeDialog(true)).
export function showMissionDialog(game, def) {
  if (game.showDialog) {
    game.showDialog(
      `${def.name} — ${def.fixer}`,
      `${def.hook} Reward $${def.reward} • ${def.timeLimit}s`,
      () => { if (game.acceptDialog) game.acceptDialog(game); },
    );
    return el(OVERLAY_IDS.dialog);
  }
  const title = el('mission-title');
  if (title) title.textContent = `${def.name} — ${def.fixer}`;
  const text = el('mission-text');
  if (text) text.textContent = `${def.hook} Reward $${def.reward} • ${def.timeLimit}s`;
  return show(OVERLAY_IDS.dialog);
}

export function hideMissionDialog() {
  hide(OVERLAY_IDS.dialog);
}

export function updateHud(game, dt) {
  const hud = ensureHud(game);
  if (hud.messageTimer > 0) hud.messageTimer -= dt;
  if (hud.damageFlash > 0) hud.damageFlash -= dt;
  if (hud.weaponFlash > 0) hud.weaponFlash -= dt;
}

// main.js calls update(game, dt) on every loaded system.
export function update(game, dt) {
  updateHud(game, dt);
}

export function init(game) {
  ensureHud(game);
}

// --- Living city depth (spec §3.6, stretch) ---------------------------
// Pedestrian variety: different colours and walking speeds, some in
// pairs. Traffic density varies by time of day: busier at midday,
// quieter at night. Pure helpers — the base traffic/pedestrian systems
// call these when spawning.
export const PEDESTRIAN_COLORS = [
  '#e8b13c', '#3e7cb1', '#c94f3d', '#2fae4e', '#7b4fd0',
  '#e87ab8', '#5bc8c8', '#f2f2f2', '#8a5a2b', '#4a4a4a',
];

export function pedestrianVariety(rng) {
  const speed = rng ? rng.range(55, 130) : 55 + Math.random() * 75;
  const color = rng
    ? PEDESTRIAN_COLORS[Math.floor(rng.next() * PEDESTRIAN_COLORS.length)]
    : PEDESTRIAN_COLORS[Math.floor(Math.random() * PEDESTRIAN_COLORS.length)];
  const inPair = rng ? rng.next() < 0.25 : Math.random() < 0.25;
  return { color, speed, inPair };
}

// hour 0–24 → density multiplier: midday busy (1.0), night quiet (0.45).
export function trafficDensityFactor(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h < 10) return 0.85;
  if (h >= 10 && h < 16) return 1.0;
  if (h >= 16 && h < 19) return 0.9;
  if (h >= 19 && h < 22) return 0.65;
  return 0.45; // night: quiet streets
}

export const PARKED_CAR_COLORS = [
  '#3e7cb1', '#f2b705', '#d92638', '#2fae4e', '#7b4fd0', '#e8ecf2',
  '#e87ab8', '#5bc8c8', '#8a8f98', '#ff7a2d', '#c9a227', '#4a6b8a',
];

export function parkedCarColor(rng) {
  const list = PARKED_CAR_COLORS;
  return rng ? list[Math.floor(rng.next() * list.length)] : list[Math.floor(Math.random() * list.length)];
}
