// Crescent Bay — game-wide constants. The first declarations here are the
// ones the outline shows, so they name the game, its seed and its world.
export const GAME_TITLE = 'Crescent Bay';
export const WORLD_SEED = 20261118;
export const SAVE_VERSION = 1;

export const CONFIG = {
  title: GAME_TITLE,
  seed: WORLD_SEED,
  saveVersion: SAVE_VERSION,
  // World: 3200x3200, an 8x8 road grid, roads at 200 + i*400, width 64.
  worldSize: 3200,
  roadCount: 8,
  roadStart: 200,
  roadGap: 400,
  roadWidth: 64,
  // Canvas the player sees.
  viewWidth: 1280,
  viewHeight: 800,
  // Player on foot.
  playerRadius: 14,
  walkSpeed: 170,
  sprintSpeed: 260,
  playerMaxHp: 100,
  startCash: 250,
  startAmmo: 48,
  // Wanted heat 0-100; stars at these thresholds.
  wantedThresholds: [0, 12, 30, 52, 74, 92],
  heatHideDistance: 450,
  heatHideTime: 3,
  heatDecayPerSec: 6,
  // Spray Shop (repaint garage) clears heat fast.
  sprayShop: { x: 600, y: 2600, radius: 150, drainPerSec: 50 },
  // Fixer Garage (upgrade garage / mission giver location).
  garage: { x: 1000, y: 1000, radius: 130 },
  hideout: { x: 600, y: 800 },
  // Landmarks.
  market: { x: 1400, y: 1400 },
  downtown: { x: 2200, y: 1400 },
  marina: { x: 2900, y: 2200 },
  club: { x: 1800, y: 600 },
  airport: { x: 600, y: 300 },
  docks: { x: 2600, y: 2800 },
  bank: { x: 2200, y: 1800 },
  // Day/night: a full cycle lasts 240 seconds of play.
  dayLengthSec: 240,
  // Traffic / pedestrians.
  maxTraffic: 18,
  maxPedestrians: 28,
  // Districts, by region of the map.
  districts: [
    { name: 'Northside', x0: 0, y0: 0, x1: 3200, y1: 1000, style: 'houses' },
    { name: 'Old Town', x0: 0, y0: 1000, x1: 1400, y1: 2200, style: 'brick' },
    { name: 'Downtown', x0: 1400, y0: 1000, x1: 2600, y1: 2200, style: 'glass' },
    { name: 'Waterfront', x0: 2600, y0: 1000, x1: 3200, y1: 2200, style: 'sand' },
    { name: 'South Docks', x0: 0, y0: 2200, x1: 3200, y1: 3200, style: 'industrial' },
  ],
  // Car types: top speed (units/s) and acceleration (units/s^2).
  carTypes: {
    sedan: { topSpeed: 380, accel: 260, brake: 520, color: '#3e7cb1', length: 46, width: 22 },
    taxi: { topSpeed: 360, accel: 250, brake: 520, color: '#f2b705', length: 46, width: 22 },
    truck: { topSpeed: 300, accel: 170, brake: 420, color: '#8a8f98', length: 58, width: 26 },
    sports: { topSpeed: 520, accel: 380, brake: 640, color: '#d92638', length: 46, width: 22 },
    police: { topSpeed: 460, accel: 340, brake: 620, color: '#1c2733', length: 48, width: 23 },
  },
  // Weapons.
  weapons: {
    pistol: { name: 'Pistol', damage: 18, rate: 0.28, range: 420, pellets: 1, spread: 0.02, auto: false },
    smg: { name: 'SMG', damage: 10, rate: 0.09, range: 360, pellets: 1, spread: 0.06, auto: true },
    shotgun: { name: 'Shotgun', damage: 8, rate: 0.7, range: 240, pellets: 5, spread: 0.16, auto: false },
  },
  // Radio stations (the radio system cycles these).
  radioStations: ['Bay FM', 'Harbor Jazz', 'Crescent Rock'],
};

export function roadPositions() {
  const out = [];
  for (let i = 0; i < CONFIG.roadCount; i++) out.push(CONFIG.roadStart + i * CONFIG.roadGap);
  return out;
}

export function districtAt(x, y) {
  for (const d of CONFIG.districts) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  }
  return CONFIG.districts[0];
}
