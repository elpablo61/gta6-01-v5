// weapons.js — pistol / SMG / shotgun for Crescent Bay (gta6-01 v5).
// First declaration: the weapon table is the contract every other system
// (combat, missions, autopilot, HUD) reads. No Rockstar/GTA terms here.
// Owns: weapon definitions, per-weapon ammo, instant switching (keys 1/2/3,
// Q cycles owned), world weapon crates + ammo pickups, firing (bullets are
// plain objects pushed onto game.bullets so combat.js / render.js can draw
// and resolve them without this file knowing about enemies).
//
// Shared state it reads/writes (all on the single `game` object):
//   game.player {x,y,angle,aimAngle,onFoot,inCar}
//   game.weapons {owned:{pistol,smg,shotgun}, current:'pistol', ammo:{...}}
//   game.crates []  {x,y,weapon,ammo,taken}
//   game.ammoPickups [] {x,y,amount,taken}
//   game.bullets [] {x,y,vx,vy,damage,range,from,life}
//   game.time.now (seconds, for fire-rate gating)

// game.time is a plain seconds number in the base main loop.
function now(game) {
  if (typeof game.time === 'number') return game.time;
  if (game.time && typeof game.time.now === 'number') return game.time.now;
  return 0;
}

export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol', name: 'Pistol', key: '1', damage: 18, fireInterval: 0.28,
    pellets: 1, spread: 0.02, range: 420, bulletSpeed: 900,
    startAmmo: 48, crateAmmo: 48, maxAmmo: 240, color: '#ffe9a8',
  },
  smg: {
    id: 'smg', name: 'SMG', key: '2', damage: 10, fireInterval: 0.09,
    pellets: 1, spread: 0.06, range: 360, bulletSpeed: 1000,
    startAmmo: 0, crateAmmo: 120, maxAmmo: 480, color: '#9fd8ff',
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', key: '3', damage: 8, fireInterval: 0.7,
    pellets: 5, spread: 0.16, range: 240, bulletSpeed: 780,
    startAmmo: 0, crateAmmo: 24, maxAmmo: 120, color: '#ffb37a',
  },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun'];

// Fixed world crate spots (spec §3.2): gun store, docks, hideout.
// Coordinates match CONFIG landmarks: hideout (600,800), docks (2600,2800).
export const WORLD_CRATE_SPOTS = [
  { x: 1000, y: 1400, weapon: 'smg' },     // gun store, Old Town
  { x: 2600, y: 2800, weapon: 'shotgun' }, // docks, South Docks
  { x: 600, y: 800, weapon: 'smg' },       // hideout
  { x: 1800, y: 600, weapon: 'shotgun' },  // club area
];

// Arena crate spots used by m10 (dockside) and m12 (bank).
export const ARENA_CRATE_SPOTS = {
  m10: [
    { x: 2500, y: 2600, weapon: 'smg' },
    { x: 2660, y: 2600, weapon: 'shotgun' },
  ],
  m12: [
    { x: 2100, y: 1800, weapon: 'smg' },
    { x: 2300, y: 1800, weapon: 'shotgun' },
  ],
};

export function createWeaponsState() {
  return {
    // owned is an ARRAY — the base game.weapons shape (main.js calls
    // .includes/.indexOf on it, and Save stores it as an array).
    owned: ['pistol'],
    current: 'pistol',
    ammo: { pistol: WEAPON_DEFS.pistol.startAmmo, smg: 0, shotgun: 0 },
    lastShotAt: -99,
    lastSwitchAt: -99,
  };
}

export function ensureWeapons(game) {
  if (!game.weapons) game.weapons = createWeaponsState();
  // Normalize: newWorld() resets game.weapons to the base shape; an
  // older object-shaped owned (never written by this file) is converted.
  if (game.weapons.owned && !Array.isArray(game.weapons.owned)) {
    game.weapons.owned = Object.keys(game.weapons.owned).filter((k) => game.weapons.owned[k]);
  }
  if (!game.weapons.ammo) game.weapons.ammo = { pistol: 48, smg: 0, shotgun: 0 };
  if (game.weapons.lastShotAt == null) game.weapons.lastShotAt = -99;
  if (!game.crates) game.crates = WORLD_CRATE_SPOTS.map((s) => ({ ...s, taken: false }));
  if (!game.ammoPickups) game.ammoPickups = [];
  if (!game.bullets) game.bullets = [];
  return game.weapons;
}

export function ownsWeapon(game, id) {
  ensureWeapons(game);
  const owned = game.weapons.owned;
  return Array.isArray(owned) ? owned.includes(id) : !!owned[id];
}

export function currentWeapon(game) {
  ensureWeapons(game);
  return WEAPON_DEFS[game.weapons.current] || WEAPON_DEFS.pistol;
}

export function currentAmmo(game) {
  ensureWeapons(game);
  return game.weapons.ammo[game.weapons.current] || 0;
}

// Instant switch, no animation lock (spec §3.2). Works on foot; in a car
// the weapon is simply held for later — switching itself never blocks.
export function switchWeapon(game, id) {
  ensureWeapons(game);
  if (!ownsWeapon(game, id)) return false;
  if (game.weapons.current === id) return false;
  game.weapons.current = id;
  game.weapons.lastSwitchAt = now(game);
  if (game.hud) game.hud.weaponFlash = 0.6;
  return true;
}

export function cycleWeapon(game) {
  ensureWeapons(game);
  const owned = WEAPON_ORDER.filter((id) => ownsWeapon(game, id));
  if (owned.length < 2) return false;
  const i = owned.indexOf(game.weapons.current);
  return switchWeapon(game, owned[(i + 1) % owned.length]);
}

export function giveWeapon(game, id, ammo) {
  ensureWeapons(game);
  const def = WEAPON_DEFS[id];
  if (!def) return false;
  const had = ownsWeapon(game, id);
  if (!had) game.weapons.owned.push(id);
  game.weapons.ammo[id] = Math.min(
    def.maxAmmo,
    (game.weapons.ammo[id] || 0) + (ammo == null ? def.crateAmmo : ammo),
  );
  if (!had) game.weapons.current = id; // new weapon becomes active at once
  return true;
}

export function addAmmo(game, id, amount) {
  ensureWeapons(game);
  const def = WEAPON_DEFS[id];
  if (!def) return;
  game.weapons.ammo[id] = Math.min(def.maxAmmo, (game.weapons.ammo[id] || 0) + amount);
}

// Fire one trigger pull. Returns true if a shot left the barrel.
// `aimAngle` overrides the player's facing (autopilot aims at a target).
// Enemies never call this — they use the pistol only via combat.js.
export function tryFire(game, aimAngle) {
  ensureWeapons(game);
  const p = game.player;
  if (!p || p.inCar) return false; // shooting is on foot only
  const t = now(game);
  const def = currentWeapon(game);
  if (t - game.weapons.lastShotAt < def.fireInterval) return false;
  if (currentAmmo(game) <= 0) {
    game.weapons.lastShotAt = t; // dry-fire click still gates the rate
    if (game.audio && game.audio.click) game.audio.click();
    return false;
  }
  game.weapons.ammo[def.id] -= 1;
  game.weapons.lastShotAt = t;
  const angle = aimAngle == null ? (p.aim != null ? p.aim : p.angle || 0) : aimAngle;
  const mx = p.x + Math.cos(angle) * 26;
  const my = p.y + Math.sin(angle) * 26;
  for (let i = 0; i < def.pellets; i++) {
    const spread = (Math.random() - 0.5) * 2 * def.spread;
    const a = angle + spread;
    // Main-loop bullet shape (main.js updateBullets moves + resolves
    // these): angle/speed/travelled/range/fromPlayer.
    game.bullets.push({
      x: mx, y: my, angle: a, speed: def.bulletSpeed,
      damage: def.damage, range: def.range, travelled: 0,
      fromPlayer: true,
    });
  }
  if (game.audio && game.audio.gunshot) game.audio.gunshot();
  if (game.effects) game.effects.muzzle = { x: mx, y: my, t: 0.08, angle };
  if (game.addHeat) game.addHeat(2); // a gunshot is a crime, small heat
  return true;
}

export function spawnArenaCrates(game, missionId) {
  ensureWeapons(game);
  const spots = ARENA_CRATE_SPOTS[missionId] || [];
  for (const s of spots) game.crates.push({ ...s, taken: false, arena: missionId });
}

export function spawnAmmoPickup(game, x, y, amount) {
  ensureWeapons(game);
  game.ammoPickups.push({ x, y, amount: amount || 24, taken: false });
}

// Walking over a crate picks the weapon up (+ ammo). Ammo pickups top up
// the current weapon. Called every frame; radius 34.
export function updateWeaponPickups(game) {
  ensureWeapons(game);
  const p = game.player;
  if (!p || p.inCar) return;
  for (const c of game.crates) {
    if (c.taken) continue;
    const dx = p.x - c.x, dy = p.y - c.y;
    if (dx * dx + dy * dy < 34 * 34) {
      c.taken = true;
      giveWeapon(game, c.weapon);
      if (game.hud) game.hud.message = `Picked up ${WEAPON_DEFS[c.weapon].name}!`;
      if (game.audio && game.audio.pickup) game.audio.pickup();
    }
  }
  for (const a of game.ammoPickups) {
    if (a.taken) continue;
    const dx = p.x - a.x, dy = p.y - a.y;
    if (dx * dx + dy * dy < 30 * 30) {
      a.taken = true;
      addAmmo(game, game.weapons.current, a.amount);
      if (game.audio && game.audio.pickup) game.audio.pickup();
    }
  }
  game.crates = game.crates.filter((c) => !c.taken || c.arena);
  game.ammoPickups = game.ammoPickups.filter((a) => !a.taken);
}

// Advance bullets; combat.js resolves hits against enemies/cops/helicopter.
// Standalone bullet motion (main.js moves bullets itself each frame,
// so update() below does NOT call this — it is for tests / reuse).
export function updateBullets(game, dt) {
  ensureWeapons(game);
  const list = game.bullets;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    const sp = b.speed || 0;
    b.x += Math.cos(b.angle) * sp * dt;
    b.y += Math.sin(b.angle) * sp * dt;
    b.travelled = (b.travelled || 0) + sp * dt;
    if (b.travelled >= b.range || b.x < 0 || b.y < 0 || b.x > 3200 || b.y > 3200) {
      list.splice(i, 1);
    }
  }
}

// Player.shoot calls systems.weapons.fire(game): fire the current
// weapon at the player's aim, honouring the fire rate. Uses
// game.weapons ammo (the source of truth) and mirrors it onto
// player.ammo so the base HUD/pickup code stays in sync.
export function fire(game, aimAngle) {
  const ok = tryFire(game, aimAngle);
  const p = game.player;
  if (p) {
    p.fireCooldown = currentWeapon(game).fireInterval;
    p.ammo = currentAmmo(game);
  }
  return ok;
}

export function updateWeapons(game, dt) {
  ensureWeapons(game);
  // main.js owns the 1/2/3/Q keys and the bullet motion — this system
  // only handles world pickups (crates + ammo) each frame.
  updateWeaponPickups(game);
}

// main.js calls update(game, dt) on every loaded system.
export function update(game, dt) {
  updateWeapons(game, dt);
}

export function init(game) {
  ensureWeapons(game);
}

export function drawWeaponCrates(ctx, camera, game) {
  ensureWeapons(game);
  for (const c of game.crates) {
    if (c.taken) continue;
    const sx = c.x - (camera ? camera.x : 0), sy = c.y - (camera ? camera.y : 0);
    if (sx < -40 || sy < -40 || sx > 1320 || sy > 840) continue;
    const def = WEAPON_DEFS[c.weapon];
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = '#3a2f1d';
    ctx.fillRect(-14, -11, 28, 22);
    ctx.strokeStyle = def.color; ctx.lineWidth = 2;
    ctx.strokeRect(-14, -11, 28, 22);
    ctx.fillStyle = def.color;
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.name.toUpperCase(), 0, 0);
    ctx.restore();
  }
  for (const a of game.ammoPickups) {
    if (a.taken) continue;
    const sx = a.x - (camera ? camera.x : 0), sy = a.y - (camera ? camera.y : 0);
    if (sx < -40 || sy < -40 || sx > 1320 || sy > 840) continue;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('AMMO', 0, 0);
    ctx.restore();
  }
}
