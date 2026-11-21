// Crescent Bay — boot + game loop + the single `game` state object.
// Every system reads and writes this one object, so the whole game stays in
// sync: player, cars, traffic, pedestrians, police, heat, missions, save.
// Systems modules (police, combat, missions, hud, autopilot, shots,
// weapons, helicopter, garage, radio) are loaded dynamically when present:
// each may export init(game) and/or update(game, dt), called here with the
// same hooks. The base game runs fully without them.

import { CONFIG } from './config.js';
import { World } from './world.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { render } from './render.js';
import { Player } from './player.js';
import { Vehicles, driveToward, carTopSpeed, makeCar } from './vehicles.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Save } from './save.js';

const SYSTEM_MODULES = ['police', 'combat', 'missions', 'hud', 'autopilot', 'shots', 'weapons', 'helicopter', 'garage', 'radio'];

export const game = {
  // Core state — plain properties (never getters), so any module can assign.
  state: 'title', // title | playing | paused | gameover
  time: 0,
  timeOfDay: 0.3, // 0..1 across the day; starts mid-morning
  nightFactor: 0,
  cash: CONFIG.startCash,
  heat: 0,
  stars: 0,
  missionIndex: 0,
  completedMissions: [],
  objective: '',
  objectiveTarget: null,
  dialog: null,
  activeSlot: 0,
  radioStation: 'Bay FM',
  gameOverReason: null,
  hideTimer: 0,
  shot: null,
  seed: CONFIG.seed,
  // World + entities.
  world: null,
  player: null,
  cars: [],
  peds: [],
  police: [],
  enemies: [],
  bullets: [],
  particles: [],
  pickups: [],
  camera: { x: 600, y: 800 },
  canvas: null,
  ctx: null,
  input: null,
  audio: null,
  vehicles: null,
  traffic: null,
  pedestrians: null,
  systems: {},
  weapons: { current: 'pistol', owned: ['pistol'], ammo: { pistol: CONFIG.startAmmo, smg: 0, shotgun: 0 } },
  helicopter: { active: false, x: 0, y: 0, hp: 100, retreatUntil: 0 },
  _staticLayer: null,
  _autopilotDrove: false,
  _toastUntil: 0,

  addHeat(n) {
    this.heat = Math.max(0, Math.min(100, this.heat + n));
    this._updateStars();
  },

  _updateStars() {
    const t = CONFIG.wantedThresholds;
    let s = 0;
    for (let i = 0; i < t.length; i++) if (this.heat >= t[i]) s = i;
    this.stars = s;
    // Single heat authority: missions read game.wantedStars for the
    // escape check, and the police module's own heat copy is never
    // drained by main.js (its updateWantedHeat is not called per frame),
    // so wantedStars must track game.stars here — otherwise an escape
    // mission can never see heat reach 0 after the Spray Shop drain.
    this.wantedStars = s;
  },

  spawnParticles(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9,
        size: 3 + Math.random() * 5, color: color || '#ffd23f',
      });
    }
  },

  showToast(text, seconds) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    this._toastUntil = this.time + (seconds || 2.5);
  },

  showDialog(title, text, onAccept) {
    this.dialog = { title, text, onAccept };
    document.getElementById('mission-title').textContent = title;
    document.getElementById('mission-text').textContent = text;
    document.getElementById('mission-dialog').classList.remove('hidden');
  },

  closeDialog(accepted) {
    const d = this.dialog;
    this.dialog = null;
    document.getElementById('mission-dialog').classList.add('hidden');
    if (accepted && d && d.onAccept) d.onAccept();
  },

  // Bound helper the playtest harness and screenshot driver call.
  // Delegates to the missions system when it is loaded.
  startMission(id) {
    if (this.systems.missions && this.systems.missions.startMission) {
      this.systems.missions.startMission(this, id);
      return true;
    }
    this.showToast(`Mission ${id} — mission system loading`);
    return false;
  },

  setObjective(text, target) {
    this.objective = text || '';
    this.objectiveTarget = target || null;
  },

  gameOver(reason) {
    if (this.state !== 'playing') return;
    this.state = 'gameover';
    this.gameOverReason = reason;
    const title = reason === 'caught' ? 'CAUGHT' : 'DOWN';
    document.getElementById('game-over-title').textContent = title;
    document.getElementById('game-over-text').textContent =
      reason === 'caught'
        ? 'The police caught Rook on foot. You lose some cash — the crew bails you out.'
        : 'Rook is down. The crew pulls you out — you lose some cash, but the city is still yours.';
    document.getElementById('game-over-screen').classList.remove('hidden');
  },

  respawn() {
    const lost = Math.floor(this.cash * 0.1);
    this.cash = Math.max(0, this.cash - lost);
    this.heat = 0;
    this._updateStars();
    this.player.reset(CONFIG.hideout.x, CONFIG.hideout.y);
    this.player.hp = this.player.maxHp;
    this.police = [];
    this.enemies = [];
    this.bullets = [];
    document.getElementById('game-over-screen').classList.add('hidden');
    this.state = 'playing';
    this.setObjective('Free roam — visit the Fixer Garage to take a job', { x: CONFIG.garage.x, y: CONFIG.garage.y });
    this.showToast(`Back on your feet. Lost $${lost}.`);
  },
};

window.game = game;

async function loadSystems() {
  // The shots module only matters for ?shot= poses, so it is only probed
  // when a shot is requested — otherwise a not-yet-landed shots.js would
  // log one 404 in normal play.
  const wanted = game.shot ? SYSTEM_MODULES : SYSTEM_MODULES.filter((n) => n !== 'shots');
  for (const name of wanted) {
    try {
      // Probe with fetch first: a missing module then stays silent instead
      // of logging a 404 console error from a failed dynamic import.
      // NOTE: fetch resolves against the page URL, not this module — build
      // the URL from import.meta.url so it points at game/src/.
      const url = new URL(`./${name}.js`, import.meta.url);
      const probe = await fetch(url, { method: 'HEAD' });
      if (!probe.ok) continue;
      const mod = await import(url.href);
      game.systems[name] = mod;
      if (typeof mod.init === 'function') mod.init(game);
    } catch {
      // System not present yet (the systems builder lands it later) — the
      // base game keeps running without it.
    }
  }
}

function newWorld() {
  game.world = new World(CONFIG.seed);
  game.player = new Player(CONFIG.hideout.x, CONFIG.hideout.y);
  game.cars = [];
  game.peds = [];
  game.police = [];
  game.enemies = [];
  game.bullets = [];
  game.particles = [];
  game.pickups = [
    { x: 900, y: 900, kind: 'health' },
    { x: 1800, y: 1800, kind: 'ammo' },
    { x: 2600, y: 1000, kind: 'health' },
  ];
  game.vehicles = new Vehicles(game);
  game.traffic = new Traffic(game);
  game.pedestrians = new Pedestrians(game);
  game.vehicles.spawnParked(14);
  game.traffic.spawn(12);
  game.pedestrians.spawn(20);
  game.camera.x = game.player.x;
  game.camera.y = game.player.y;
  game._staticLayer = null;
  game.weapons = { current: 'pistol', owned: ['pistol'], ammo: { pistol: CONFIG.startAmmo, smg: 0, shotgun: 0 } };
}

function showTitle() {
  game.state = 'title';
  document.getElementById('title-screen').classList.remove('hidden');
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
  renderSaveSlots();
}

function renderSaveSlots() {
  const box = document.getElementById('save-slots');
  if (!box) return;
  box.innerHTML = '';
  for (const s of Save.listSlots()) {
    const el = document.createElement('div');
    el.className = 'slot' + (s.corrupt ? ' corrupt' : '');
    el.textContent = s.empty
      ? `Slot ${s.slot + 1}: Empty`
      : s.corrupt
        ? `Slot ${s.slot + 1}: Corrupt — can be overwritten`
        : `Slot ${s.slot + 1}: Mission ${s.missionIndex + 1} · $${s.cash} · ${s.date.slice(0, 10)}`;
    el.addEventListener('click', () => {
      game.activeSlot = s.slot;
      if (!s.empty && !s.corrupt) startGame(true, s.slot);
    });
    box.appendChild(el);
  }
}

function startGame(fromSave, slot) {
  if (fromSave) {
    const r = Save.load(slot === undefined ? game.activeSlot : slot);
    if (r.ok) Save.applyToGame(game, r.data);
  } else {
    game.cash = CONFIG.startCash;
    game.heat = 0;
    game._updateStars();
    game.missionIndex = 0;
    game.completedMissions = [];
  }
  document.getElementById('title-screen').classList.add('hidden');
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
  game.state = 'playing';
  game.audio.ensure();
  game.audio.startMusic();
  if (!game.objective) {
    game.setObjective('Free roam — visit the Fixer Garage to take a job', { x: CONFIG.garage.x, y: CONFIG.garage.y });
  }
  game.showToast('Welcome to Crescent Bay, Rook.');
}

function togglePause() {
  if (game.state === 'playing') {
    game.state = 'paused';
    document.getElementById('pause-menu').classList.remove('hidden');
  } else if (game.state === 'paused') {
    game.state = 'playing';
    document.getElementById('pause-menu').classList.add('hidden');
  }
}

// ---- wanted heat ----
function updateWanted(dt) {
  // Spray Shop clears heat fast while the player is inside its radius.
  const shop = CONFIG.sprayShop;
  const inShop = Math.hypot(game.player.x - shop.x, game.player.y - shop.y) < shop.radius;
  if (inShop && game.heat > 0) {
    game.addHeat(-shop.drainPerSec * dt);
  }
  // Heat decays while hiding: no police within 450 for 3 seconds — unless
  // the helicopter spotlight is on Rook. Precise check: decay is blocked
  // only while the spotlight is actually on Rook, not during the
  // helicopter's 20s retreat after being shot down (it is still `active`
  // then, but the spotlight is gone and hiding must work again).
  const heliSpot = game.systems.helicopter && game.systems.helicopter.spotlightOnPlayer
    ? game.systems.helicopter.spotlightOnPlayer(game)
    : (game.helicopter && game.helicopter.active);
  let nearestCop = Infinity;
  for (const cop of game.police) {
    const d = Math.hypot(cop.x - game.player.x, cop.y - game.player.y);
    if (d < nearestCop) nearestCop = d;
  }
  if (nearestCop > CONFIG.heatHideDistance && !heliSpot && game.heat > 0) {
    game.hideTimer += dt;
    if (game.hideTimer >= CONFIG.heatHideTime) game.addHeat(-CONFIG.heatDecayPerSec * dt);
  } else {
    game.hideTimer = 0;
  }
  game._updateStars();
}

// ---- minimal police fallback (the police system replaces this when loaded) ----
const fallbackPolice = {
  spawnTimer: 0,
  arrestTimer: 0,
  update(dt) {
    // No early return for the loaded police system: the system owns
    // heat/arrest but never spawns units, so standing down here would
    // leave the city with no foot cops at any wanted level. This
    // fallback owns foot-cop spawning, chasing, arrest and the siren;
    // the system runs its arrest check alongside (harmless — it only
    // fires through game.onPlayerCaught, which is never set).
    const stars = game.stars;
    if (stars === 0) {
      // Cops drift away and despawn when the heat is gone.
      game.police = game.police.filter((c) => {
        c.x += (c.vx || 0) * dt;
        c.y += (c.vy || 0) * dt;
        return Math.hypot(c.x - game.player.x, c.y - game.player.y) < 900;
      });
      return;
    }
    this.spawnTimer -= dt;
    const want = Math.min(2 + stars, 7);
    if (game.police.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = 1.2;
      const a = Math.random() * Math.PI * 2;
      const d = 500 + Math.random() * 200;
      game.police.push({
        x: game.player.x + Math.cos(a) * d,
        y: game.player.y + Math.sin(a) * d,
        vx: 0, vy: 0, car: null, speed: 150,
      });
    }
    const pl = game.player;
    for (const cop of game.police) {
      const dx = pl.x - cop.x;
      const dy = pl.y - cop.y;
      const dist = Math.hypot(dx, dy) || 1;
      const spd = 150 + stars * 12;
      cop.x += (dx / dist) * spd * dt;
      cop.y += (dy / dist) * spd * dt;
      // Arrest rule: a foot cop must stay within 30 of a slow on-foot
      // player for 1.2s in a row; running away breaks it.
      if (!pl.inCar && dist < 30 && pl.speed < 100) {
        this.arrestTimer += dt;
        if (this.arrestTimer >= 1.2) {
          this.arrestTimer = 0;
          game.gameOver('caught');
          return;
        }
      } else {
        this.arrestTimer = 0;
      }
    }
    game.audio.siren(stars > 0);
  },
};

// ---- police dispatch: patrol cars + roadblocks (NEW) ----
// The police system owns heat/arrest but never spawns units, and the
// fallback above only ever spawned foot cops — so a wanted chase had no
// pursuers at all: no patrol cars, no roadblocks. This dispatcher
// spawns them from policeBudget and drives them. Foot cops stay with
// the fallback (it also owns arrest + the siren).
const policeDispatch = {
  spawnTimer: 0,
  roadblockTimer: 0,
  roadblockAt: null,
  update(dt) {
    const stars = game.stars;
    const sys = game.systems.police;
    const budget = sys && sys.policeBudget ? sys.policeBudget(stars)
      : { footCops: 0, patrolCars: stars >= 2 ? Math.min(3, stars - 1) : 0, roadblocks: stars >= 4 ? stars - 3 : 0 };
    const cars = game.cars;
    const patrols = cars.filter((c) => c.isPolice && !c.isRoadblock);
    const blocks = cars.filter((c) => c.isRoadblock);
    // Heat gone: clear every pursuit unit.
    if (stars === 0) {
      for (const c of [...patrols, ...blocks]) cars.splice(cars.indexOf(c), 1);
      this.roadblockAt = null;
      return;
    }
    // Patrol cars: spawn until the budget is met, then chase the player
    // along the road graph (route rebuilt when the player moves on).
    this.spawnTimer -= dt;
    if (patrols.length < budget.patrolCars && this.spawnTimer <= 0) {
      this.spawnTimer = 1.5;
      const spot = spawnOnRoadNear(game, 550 + Math.random() * 200);
      if (spot) {
        const car = makeCar('police', spot.x, spot.y, Math.random() * Math.PI * 2);
        car.parked = false;
        car.isPolice = true;
        car.cruise = 460;
        cars.push(car);
      }
    }
    const pl = game.player;
    for (const car of [...patrols]) {
      if (!car.route || car.routeIndex >= car.route.length
        || (car.routeDest && Math.hypot(pl.x - car.routeDest.x, pl.y - car.routeDest.y) > 150)) {
        car.routeDest = { x: pl.x, y: pl.y };
        car.route = game.world.findRoute(car.x, car.y, pl.x, pl.y);
        car.routeIndex = 0;
      }
      const wp = car.route && car.route[car.routeIndex];
      if (wp) {
        // Brake and hold off near the Spray Shop so the player can escape.
        const nearShop = sys && sys.patrolNearSprayShop ? sys.patrolNearSprayShop(game, car) : false;
        const arrived = driveToward(car, wp.x, wp.y, nearShop ? 0 : 460, dt, game);
        if (arrived || Math.hypot(wp.x - car.x, wp.y - car.y) < 70) car.routeIndex++;
      }
      // Despawn patrol cars that fell far behind.
      if (Math.hypot(car.x - pl.x, car.y - pl.y) > 1500) {
        cars.splice(cars.indexOf(car), 1);
      }
    }
    // Roadblocks at 4-5 stars: parked police cars across the road ahead
    // of the player's heading, re-placed as the player moves on.
    this.roadblockTimer -= dt;
    if (blocks.length < budget.roadblocks && this.roadblockTimer <= 0) {
      this.roadblockTimer = 8;
      placeRoadblock(game);
    } else if (blocks.length > budget.roadblocks) {
      for (const c of blocks.slice(budget.roadblocks)) cars.splice(cars.indexOf(c), 1);
    }
    if (blocks.length > 0 && this.roadblockAt
      && Math.hypot(pl.x - this.roadblockAt.x, pl.y - this.roadblockAt.y) > 900) {
      for (const c of blocks) cars.splice(cars.indexOf(c), 1);
      this.roadblockAt = null;
    }
  },
};

// Nearest point on the road grid to (x, y): snap one axis to its nearest
// road line and keep the other, so spawns always land on a road.
// Returns vertical=true when the x axis was snapped (a north-south road).
function nearestRoadPoint(game, x, y) {
  const roads = game.world.roads;
  let bx = roads[0], bd = Infinity;
  for (const r of roads) { const d = Math.abs(r - x); if (d < bd) { bd = d; bx = r; } }
  let by = roads[0], bd2 = Infinity;
  for (const r of roads) { const d = Math.abs(r - y); if (d < bd2) { bd2 = d; by = r; } }
  return bd <= bd2 ? { x: bx, y, vertical: true } : { x, y: by, vertical: false };
}

// A spawn point on a road at roughly `dist` from the player, in a random
// direction (never inside a building block).
function spawnOnRoadNear(game, dist) {
  const p = game.player;
  const a = Math.random() * Math.PI * 2;
  const pt = nearestRoadPoint(game, p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist);
  if (game.world.collideCircle(pt.x, pt.y, 30)) return null;
  return pt;
}

// Two parked police cars across the road ahead of the player's heading.
function placeRoadblock(game) {
  const p = game.player;
  const heading = p.car ? p.car.angle : 0;
  const ahead = { x: p.x + Math.cos(heading) * 520, y: p.y + Math.sin(heading) * 520 };
  const pt = nearestRoadPoint(game, ahead.x, ahead.y);
  const angle = pt.vertical ? 0 : Math.PI / 2;
  for (const off of [-32, 32]) {
    const cx = pt.vertical ? pt.x : pt.x + off;
    const cy = pt.vertical ? pt.y + off : pt.y;
    if (game.world.collideCircle(cx, cy, 30)) continue;
    const car = makeCar('police', cx, cy, angle);
    car.parked = true;
    car.isPolice = true;
    car.isRoadblock = true;
    game.cars.push(car);
  }
  policeDispatch.roadblockAt = pt;
}

function updateBullets(dt) {
  for (const b of [...game.bullets]) {
    b.x += Math.cos(b.angle) * b.speed * dt;
    b.y += Math.sin(b.angle) * b.speed * dt;
    b.travelled += b.speed * dt;
    let dead = b.travelled > b.range;
    if (!dead && game.world.collideCircle(b.x, b.y, 3)) dead = true;
    if (!dead) {
      // Hit enemies.
      for (const e of [...game.enemies]) {
        if (b.fromPlayer && Math.hypot(e.x - b.x, e.y - b.y) < 16) {
          e.hp -= b.damage;
          game.spawnParticles(b.x, b.y, 5, '#ffd23f');
          if (e.hp <= 0) {
            game.enemies.splice(game.enemies.indexOf(e), 1);
            game.spawnParticles(e.x, e.y, 12, '#ff5d5d');
          }
          dead = true;
          break;
        }
      }
    }
    if (!dead && b.fromPlayer) {
      for (const cop of [...game.police]) {
        if (Math.hypot(cop.x - b.x, cop.y - b.y) < 14) {
          game.addHeat(3);
          game.spawnParticles(b.x, b.y, 5, '#4da3ff');
          dead = true;
          break;
        }
      }
    }
    if (!dead && !b.fromPlayer && Math.hypot(game.player.x - b.x, game.player.y - b.y) < 14) {
      game.player.takeDamage(b.damage, game);
      dead = true;
    }
    if (dead) game.bullets.splice(game.bullets.indexOf(b), 1);
  }
}

function updatePickups(dt) {
  void dt;
  const pl = game.player;
  if (pl.inCar) return;
  for (const pk of [...game.pickups]) {
    if (Math.hypot(pk.x - pl.x, pk.y - pl.y) < 26) {
      if (pk.kind === 'health') pl.heal(40);
      if (pk.kind === 'ammo') {
        game.weapons.ammo[game.weapons.current] = (game.weapons.ammo[game.weapons.current] || 0) + 24;
        pl.ammo += 24;
      }
      if (pk.kind === 'weapon' && game.systems.weapons && game.systems.weapons.pickup) {
        game.systems.weapons.pickup(game, pk);
      }
      game.audio.pickup();
      game.spawnParticles(pk.x, pk.y, 8, '#3ddc5f');
      game.pickups.splice(game.pickups.indexOf(pk), 1);
    }
  }
}

function updateCamera(dt) {
  const target = game.player;
  const k = 1 - Math.pow(0.001, dt);
  game.camera.x += (target.x - game.camera.x) * k;
  game.camera.y += (target.y - game.camera.y) * k;
  game.camera.x = Math.max(640, Math.min(game.world.size - 640, game.camera.x));
  game.camera.y = Math.max(400, Math.min(game.world.size - 400, game.camera.y));
}

function updatePlaying(dt) {
  const input = game.input;
  game.time += dt;
  // Day/night cycle. The clock runs 06:00 at timeOfDay 0; night is 18:00–06:00.
  game.timeOfDay = (game.timeOfDay + dt / CONFIG.dayLengthSec) % 1;
  const tod = game.timeOfDay;
  const hourF = (tod * 24 + 6) % 24;
  let nf = 0;
  if (hourF >= 19 || hourF < 5) nf = 1;
  else if (hourF >= 18) nf = hourF - 18;
  else if (hourF < 6) nf = 6 - hourF;
  game.nightFactor = Math.max(0, Math.min(1, nf));

  // Radio: R cycles stations. Delegate to the radio system when it is
  // loaded — it owns game.radio.station, and its per-frame update
  // re-syncs game.radioStation from that state, so setting the station
  // here directly would be overwritten again the same frame.
  if (input.pressed('r')) {
    if (game.systems.radio && game.systems.radio.cycleStation) {
      const name = game.systems.radio.cycleStation(game);
      game.showToast(`Radio: ${name}`);
    } else {
      const next = (CONFIG.radioStations.indexOf(game.radioStation) + 1) % CONFIG.radioStations.length;
      game.radioStation = CONFIG.radioStations[next];
      game.audio.setStation(next);
      game.showToast(`Radio: ${game.radioStation}`);
    }
  }
  // Weapons: Q cycles, 1/2/3 select.
  if (input.pressed('q')) {
    const owned = game.weapons.owned;
    const i = owned.indexOf(game.weapons.current);
    game.weapons.current = owned[(i + 1) % owned.length];
  }
  for (const [key, name] of [['1', 'pistol'], ['2', 'smg'], ['3', 'shotgun']]) {
    if (input.pressed(key) && game.weapons.owned.includes(name)) game.weapons.current = name;
  }

  // Autopilot runs BEFORE the dialog branch, so it can press E to accept.
  game._autopilotDrove = false;
  if (game.systems.autopilot && game.systems.autopilot.update) {
    game._autopilotDrove = !!game.systems.autopilot.update(game, dt);
  }

  // Mission dialog: E / Enter accepts, Esc declines.
  if (game.dialog) {
    if (input.pressed('e') || input.pressed('Enter')) game.closeDialog(true);
    else if (input.pressed('Escape')) game.closeDialog(false);
    input.endFrame();
    return;
  }

  // Enter / exit car.
  if (input.pressed('e')) {
    if (game.player.inCar) {
      game.vehicles.exitCar();
    } else if (game.player.nearCar) {
      game.vehicles.enterCar(game.player.nearCar);
    } else if (game.systems.garage && game.systems.garage.tryOpen) {
      game.systems.garage.tryOpen(game);
    }
  }

  // Player + car.
  game.player.update(dt, game);
  game.vehicles.updatePlayerCar(dt, game._autopilotDrove);
  game.vehicles.update(dt);
  game.traffic.update(dt);
  game.pedestrians.update(dt);
  fallbackPolice.update(dt);
  if (game.systems.police && game.systems.police.update) game.systems.police.update(game, dt);
  policeDispatch.update(dt);
  if (game.systems.combat && game.systems.combat.update) game.systems.combat.update(game, dt);
  if (game.systems.missions && game.systems.missions.update) game.systems.missions.update(game, dt);
  if (game.systems.helicopter && game.systems.helicopter.update) game.systems.helicopter.update(game, dt);
  if (game.systems.garage && game.systems.garage.update) game.systems.garage.update(game, dt);
  if (game.systems.radio && game.systems.radio.update) game.systems.radio.update(game, dt);
  if (game.systems.weapons && game.systems.weapons.update) game.systems.weapons.update(game, dt);
  if (game.systems.hud && game.systems.hud.update) game.systems.hud.update(game, dt);

  updateWanted(dt);
  updateBullets(dt);
  updatePickups(dt);

  // Particles.
  for (const pt of [...game.particles]) {
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    if (pt.life <= 0) game.particles.splice(game.particles.indexOf(pt), 1);
  }

  // Player death (health 0) — DOWN.
  if (!game.player.alive) {
    game.gameOver('down');
    return;
  }

  // Toast expiry.
  if (game._toastUntil && game.time > game._toastUntil) {
    document.getElementById('toast').classList.add('hidden');
    game._toastUntil = 0;
  }

  // Autosave hook: the missions system calls Save.save on completion.
  updateCamera(dt);
  input.endFrame();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - (loop._last || now)) / 1000 || 0.016);
  loop._last = now;
  // Pause toggle is checked BEFORE any early exit, so pause can always
  // be left again.
  if (game.input.pressed('Escape') || game.input.pressed('p')) {
    // Garage menu first: Esc closes the menu (and unpauses the world the
    // menu paused) instead of resuming play with the menu still open.
    if (game.garage && game.garage.open && game.systems.garage && game.systems.garage.closeGarageMenu) {
      game.systems.garage.closeGarageMenu(game);
    } else if (game.state === 'playing' || game.state === 'paused') togglePause();
  }
  if (game.state === 'playing') {
    updatePlaying(dt);
  } else {
    // Title / paused / game-over: the living city keeps moving behind the
    // overlay (traffic + pedestrians), but the player does not.
    if (game.state === 'title') {
      game.time += dt;
      game.traffic.update(dt);
      game.pedestrians.update(dt);
      updateCamera(dt);
    }
    game.input.endFrame();
  }
  render(game, game.ctx);
}

function boot() {
  const canvas = document.getElementById('game');
  game.canvas = canvas;
  game.ctx = canvas.getContext('2d');
  game.input = new Input(canvas);
  game.audio = new Audio();
  const params = new URLSearchParams(location.search);
  game.shot = params.get('shot');
  game.seed = Number(params.get('seed') || CONFIG.seed);
  newWorld();
  loadSystems();
  document.getElementById('btn-new-game').addEventListener('click', () => startGame(false));
  document.getElementById('btn-continue').addEventListener('click', () => startGame(true, game.activeSlot));
  document.getElementById('btn-resume').addEventListener('click', togglePause);
  document.getElementById('btn-save').addEventListener('click', () => {
    const r = Save.save(game, game.activeSlot);
    game.showToast(r.ok ? `Saved to slot ${game.activeSlot + 1}.` : 'Save failed.');
  });
  document.getElementById('btn-quit-title').addEventListener('click', () => {
    document.getElementById('pause-menu').classList.add('hidden');
    showTitle();
  });
  document.getElementById('btn-respawn').addEventListener('click', () => game.respawn());
  document.getElementById('btn-title-after-over').addEventListener('click', () => {
    document.getElementById('game-over-screen').classList.add('hidden');
    game.player.reset(CONFIG.hideout.x, CONFIG.hideout.y);
    showTitle();
  });
  document.getElementById('btn-accept-mission').addEventListener('click', () => game.closeDialog(true));
  document.getElementById('btn-decline-mission').addEventListener('click', () => game.closeDialog(false));
  // Shot poses: the shots system drives them when loaded; without it, a
  // start pose shows the title over the living city and other poses start
  // the game immediately.
  if (game.shot === 'start') {
    showTitle();
  } else if (game.shot) {
    startGame(false);
  } else {
    showTitle();
  }
  requestAnimationFrame(loop);
}

boot();
