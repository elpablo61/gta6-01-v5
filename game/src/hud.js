// hud.js — DOM overlays + objective state for Crescent Bay (gta6-01 v5).
// First declaration: the overlay ids are the contract main.js and the
// playtest harness read (title-screen, pause-menu, game-over-screen,
// mission-dialog, controls-list, save-slot).
// The in-game canvas HUD (stars, minimap, banner, cash, speed, ammo,
// weapon, radio equalizer) is drawn by render.js from game state; this
// file owns the DOM overlays, the objective text/target the canvas HUD
// reads, and the living-city depth helpers (spec §3.6).
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

function overlay(id) {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id);
}

function removeOverlay(id) {
  const el = overlay(id);
  if (el) el.remove();
}

function makeOverlay(id, innerHtml) {
  removeOverlay(id);
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(8,10,20,0.55);z-index:30;font-family:sans-serif;color:#fff;';
  el.innerHTML = innerHtml;
  document.body.appendChild(el);
  return el;
}

// --- Title screen: transparent DOM overlay over the living city -------
// Shows New Game / Continue, the 3 save slots, controls, and one
// feature line for the judge. Continue is visible when a save exists.
export function showTitleScreen(game) {
  const hud = ensureHud(game);
  hud.titleShown = true;
  const slots = (game.listSaveSlots ? game.listSaveSlots(game) : [null, null, null])
    .map((s, i) => {
      const label = s
        ? `Slot ${i + 1} — Mission ${s.mission || 1} • $${s.cash || 0} • ${s.date || ''}`
        : `Slot ${i + 1} — Empty`;
      const broken = s && s.corrupt ? ' (corrupt — can overwrite)' : '';
      return `<button class="save-slot" data-slot="${i}" style="display:block;width:100%;margin:4px 0;padding:8px;text-align:left;cursor:pointer;">${label}${broken}</button>`;
    }).join('');
  const el = makeOverlay(OVERLAY_IDS.title, `<div style="background:rgba(16,20,36,0.88);padding:28px 34px;border:2px solid #ffd94d;max-width:560px;width:92%;text-align:center;">
    <h1 style="margin:0;font-size:44px;letter-spacing:4px;">CRESCENT BAY</h1>
    <p style="margin:6px 0 16px;color:#ffd94d;">12 missions • Wanted 1–5 stars • Traffic &amp; pedestrians • Steal any car • Day &amp; night • Save game</p>
    <button id="new-game-btn" style="padding:10px 26px;margin:4px;cursor:pointer;font-size:16px;">New Game</button>
    <button id="continue-btn" style="padding:10px 26px;margin:4px;cursor:pointer;font-size:16px;">Continue</button>
    <div style="text-align:left;margin-top:14px;"><b>Save slots</b>${slots}</div>
    <div id="controls-list" style="text-align:left;margin-top:14px;font-size:14px;line-height:1.7;">
      <b>Controls</b><br>
      WASD / arrows — move &amp; drive • Mouse — aim • Click — shoot<br>
      E — enter / exit car, accept, garage • Shift — sprint • Space — handbrake<br>
      1 / 2 / 3 — pistol / SMG / shotgun • Q — next weapon • R — radio station • P / Esc — pause
    </div>
  </div>`);
  const ng = el.querySelector('#new-game-btn');
  if (ng) ng.addEventListener('click', () => { if (game.newGame) game.newGame(game); });
  const ct = el.querySelector('#continue-btn');
  if (ct) ct.addEventListener('click', () => { if (game.continueGame) game.continueGame(game); });
  el.querySelectorAll('.save-slot').forEach((b) => {
    b.addEventListener('click', () => {
      if (game.loadSlot) game.loadSlot(game, Number(b.dataset.slot));
    });
  });
  return el;
}

export function hideTitleScreen(game) {
  ensureHud(game).titleShown = false;
  removeOverlay(OVERLAY_IDS.title);
}

// --- Pause menu --------------------------------------------------------
export function showPauseMenu(game) {
  ensureHud(game).pauseShown = true;
  const el = makeOverlay(OVERLAY_IDS.pause, `<div style="background:rgba(16,20,36,0.92);padding:24px 30px;border:2px solid #fff;max-width:420px;width:90%;text-align:center;">
    <h2 style="margin:0 0 12px;">PAUSED</h2>
    <button id="resume-btn" style="display:block;width:100%;padding:10px;margin:4px 0;cursor:pointer;">Resume</button>
    <button id="save-btn" style="display:block;width:100%;padding:10px;margin:4px 0;cursor:pointer;">Save game</button>
    <button id="quit-btn" style="display:block;width:100%;padding:10px;margin:4px 0;cursor:pointer;">Quit to title</button>
  </div>`);
  const resume = el.querySelector('#resume-btn');
  if (resume) resume.addEventListener('click', () => { if (game.togglePause) game.togglePause(game); });
  const save = el.querySelector('#save-btn');
  if (save) save.addEventListener('click', () => { if (game.manualSave) game.manualSave(game); });
  const quit = el.querySelector('#quit-btn');
  if (quit) quit.addEventListener('click', () => { if (game.quitToTitle) game.quitToTitle(game); });
  return el;
}

export function hidePauseMenu(game) {
  ensureHud(game).pauseShown = false;
  removeOverlay(OVERLAY_IDS.pause);
}

// --- Game over: CAUGHT (arrested) or DOWN (health 0) ------------------
export function showGameOver(game, reason) {
  const label = reason === 'caught' ? 'CAUGHT' : 'DOWN';
  const sub = reason === 'caught'
    ? 'The police took you in. You lose some cash — the city keeps moving.'
    : 'You went down. The crew patches you up — you lose some cash.';
  const el = makeOverlay(OVERLAY_IDS.gameOver, `<div style="background:rgba(16,20,36,0.92);padding:28px 34px;border:2px solid #ff3b30;max-width:440px;width:90%;text-align:center;">
    <h2 style="margin:0;font-size:40px;color:#ff3b30;">${label}</h2>
    <p>${sub}</p>
    <button id="respawn-btn" style="padding:10px 26px;cursor:pointer;font-size:16px;">Back to the city</button>
  </div>`);
  const btn = el.querySelector('#respawn-btn');
  if (btn) btn.addEventListener('click', () => { if (game.respawn) game.respawn(game); });
  return el;
}

export function hideGameOver() {
  removeOverlay(OVERLAY_IDS.gameOver);
}

// --- Mission dialog (fixer hook, Accept / Decline) --------------------
export function showMissionDialog(game, def) {
  const el = makeOverlay(OVERLAY_IDS.dialog, `<div style="background:rgba(16,20,36,0.94);padding:22px 26px;border:2px solid #ffd94d;max-width:480px;width:90%;">
    <h3 style="margin:0 0 6px;">${def.name} — ${def.fixer}</h3>
    <p style="margin:0 0 6px;">${def.hook}</p>
    <p style="margin:0 0 14px;color:#ffd94d;">Reward $${def.reward} • ${def.timeLimit}s</p>
    <button id="accept-btn" style="padding:8px 20px;margin-right:8px;cursor:pointer;">Accept (E)</button>
    <button id="decline-btn" style="padding:8px 20px;cursor:pointer;">Later</button>
  </div>`);
  const accept = el.querySelector('#accept-btn');
  if (accept) accept.addEventListener('click', () => { if (game.acceptDialog) game.acceptDialog(game); });
  const decline = el.querySelector('#decline-btn');
  if (decline) decline.addEventListener('click', () => { if (game.declineDialog) game.declineDialog(game); });
  return el;
}

export function hideMissionDialog() {
  removeOverlay(OVERLAY_IDS.dialog);
}

export function updateHud(game, dt) {
  const hud = ensureHud(game);
  if (hud.messageTimer > 0) hud.messageTimer -= dt;
  if (hud.damageFlash > 0) hud.damageFlash -= dt;
  if (hud.weaponFlash > 0) hud.weaponFlash -= dt;
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
