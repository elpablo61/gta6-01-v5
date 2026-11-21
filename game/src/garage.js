// garage.js — Fixer Garage upgrades for Crescent Bay (gta6-01 v5).
// First declaration: the upgrade table is the contract missions.js
// (m11 requires a purchase) and autopilot.js (buy cheapest) read.
// Behaviour (spec §3.3): drive into the garage zone (CONFIG.garage,
// 1000,1000, radius 130) and press E (or a menu button) to open the
// upgrade menu — a DOM overlay that pauses the world. Spend cash on:
// Engine (3 levels, +top speed each), Armor (3 levels, damage
// resistance), Tires (2 levels, better handling/turning), Brakes
// (2 levels, shorter stopping distance). Prices rise per level.
// Upgrades live ON the car: car.upgrades {engine, armor, tires,
// brakes} and car.paint — the same shape vehicles.js reads
// (carTopSpeed adds +45 per engine level, damageCar cuts 15% per
// armor level, carTurnRate adds +0.35 per tires level), so they
// survive entering/exiting and apply to the player's CURRENT car.
// Also paint: 6 colours for a small fee (visual only — separate from
// the Spray Shop, which still only clears heat). The menu shows
// current levels and cash. m11 requires a purchase. Autopilot: drive
// in, open the menu (without pausing), buy the cheapest available
// upgrade, close, continue — all in one frame, so it can never stall
// behind a paused world.

import { CONFIG } from './config.js';

export const GARAGE_DEFS = {
  zone: { x: 1000, y: 1000, radius: 130 }, // CONFIG.garage
  upgrades: {
    engine: {
      name: 'Engine', maxLevel: 3,
      prices: [800, 1500, 2500],
      desc: '+45 top speed each level',
      topSpeedBonus: 45, // matches carTopSpeed in vehicles.js
    },
    armor: {
      name: 'Armor', maxLevel: 3,
      prices: [500, 900, 1400],
      desc: 'damage resistance',
      damageReduction: 0.15, // per level, matches damageCar
    },
    tires: {
      name: 'Tires', maxLevel: 2,
      prices: [400, 800],
      desc: 'better handling / turning',
      turnBonus: 0.35, // per level, matches carTurnRate
    },
    brakes: {
      name: 'Brakes', maxLevel: 2,
      prices: [350, 700],
      desc: 'shorter stopping distance',
      brakeBonus: 0.25, // per level, applied to car.brake
    },
  },
  paint: {
    name: 'Paint', price: 150,
    colours: ['#d92638', '#f2b705', '#3e7cb1', '#2fae4e', '#7b4fd0', '#e8ecf2'],
    colourNames: ['Crimson', 'Taxi Gold', 'Ocean Blue', 'Palm Green', 'Violet', 'Pearl'],
  },
};

function now(game) {
  if (typeof game.time === 'number') return game.time;
  if (game.time && typeof game.time.now === 'number') return game.time.now;
  return 0;
}

// Cash lives on game.cash in the base loop (player.cash is the fallback).
function getCash(game) {
  if (typeof game.cash === 'number') return game.cash;
  return (game.player && game.player.cash) || 0;
}
function setCash(game, v) {
  game.cash = v;
  if (game.player) game.player.cash = v;
}

export function createGarageState() {
  return {
    open: false,
    lastPurchaseAt: -99,
    purchaseCount: 0, // purchases this mission (m11 reads this)
  };
}

export function ensureGarage(game) {
  if (!game.garage) game.garage = createGarageState();
  return game.garage;
}

// Upgrades live on the car itself (vehicles.js shape).
export function carUpgrades(game, car) {
  if (!car) return { engine: 0, armor: 0, tires: 0, brakes: 0, paint: null };
  if (!car.upgrades) car.upgrades = { engine: 0, armor: 0, tires: 0, brakes: 0 };
  return car.upgrades;
}

export function upgradePrice(kind, level) {
  const def = GARAGE_DEFS.upgrades[kind];
  if (!def || level >= def.maxLevel) return null;
  return def.prices[level];
}

// Cheapest available upgrade for the current car (autopilot's m11 step).
export function cheapestUpgrade(game, car) {
  const up = carUpgrades(game, car);
  let best = null;
  for (const kind of Object.keys(GARAGE_DEFS.upgrades)) {
    const price = upgradePrice(kind, up[kind]);
    if (price == null) continue;
    if (!best || price < best.price) best = { kind, price, level: up[kind] };
  }
  return best;
}

export function playerInGarageZone(game) {
  const p = game.player;
  if (!p) return false;
  const x = p.inCar && p.car ? p.car.x : p.x;
  const y = p.inCar && p.car ? p.car.y : p.y;
  const dx = x - GARAGE_DEFS.zone.x, dy = y - GARAGE_DEFS.zone.y;
  return dx * dx + dy * dy < GARAGE_DEFS.zone.radius * GARAGE_DEFS.zone.radius;
}

// Apply stored per-car upgrades to a car object (called on buy and when
// the player enters a car that already has upgrades).
export function applyUpgradesToCar(car, up) {
  if (!car) return car;
  const u = up || car.upgrades || { engine: 0, armor: 0, tires: 0, brakes: 0 };
  car.upgrades = { engine: u.engine || 0, armor: u.armor || 0, tires: u.tires || 0, brakes: u.brakes || 0 };
  if (u.paint) { car.paint = u.paint; car.color = u.paint; }
  else if (car.paint) { car.color = car.paint; }
  if (car.upgrades.brakes > 0) {
    if (car.baseBrake == null) car.baseBrake = car.brake || 520;
    car.brake = car.baseBrake * (1 + GARAGE_DEFS.upgrades.brakes.brakeBonus * car.upgrades.brakes);
  }
  return car;
}

// Buy an upgrade for the player's current car. Returns the purchase or null.
export function buyUpgrade(game, kind) {
  const g = ensureGarage(game);
  const p = game.player;
  if (!p || !p.car) return null;
  const up = carUpgrades(game, p.car);
  const price = upgradePrice(kind, up[kind]);
  if (price == null) return null;
  if (getCash(game) < price) return null;
  setCash(game, getCash(game) - price);
  up[kind] += 1;
  g.lastPurchaseAt = now(game);
  g.purchaseCount += 1;
  applyUpgradesToCar(p.car, up);
  if (game.audio && game.audio.cash) game.audio.cash();
  if (game.showToast) game.showToast(`${GARAGE_DEFS.upgrades[kind].name} level ${up[kind]} installed!`);
  return { kind, level: up[kind], price };
}

export function buyPaint(game, colourIndex) {
  const g = ensureGarage(game);
  const p = game.player;
  if (!p || !p.car) return null;
  const paint = GARAGE_DEFS.paint;
  if (colourIndex < 0 || colourIndex >= paint.colours.length) return null;
  if (getCash(game) < paint.price) return null;
  setCash(game, getCash(game) - paint.price);
  const up = carUpgrades(game, p.car);
  up.paint = paint.colours[colourIndex];
  p.car.paint = paint.colours[colourIndex];
  p.car.color = paint.colours[colourIndex];
  g.lastPurchaseAt = now(game);
  g.purchaseCount += 1;
  if (game.audio && game.audio.cash) game.audio.cash();
  return { kind: 'paint', colour: paint.colours[colourIndex], price: paint.price };
}

// Open the menu. opts.pause (default true) pauses the world by setting
// game.state to 'paused'; the autopilot passes {pause:false} and buys +
// closes in the same frame instead, so it can never stall behind a
// paused world.
export function openGarageMenu(game, opts) {
  const g = ensureGarage(game);
  if (g.open) return false;
  if (!playerInGarageZone(game)) return false;
  g.open = true;
  const pause = !opts || opts.pause !== false;
  if (pause && game.state === 'playing') {
    game.state = 'paused';
    game._garagePaused = true;
  }
  renderGarageMenu(game);
  return true;
}

export function tryOpen(game) {
  return openGarageMenu(game);
}

export function closeGarageMenu(game) {
  const g = ensureGarage(game);
  if (!g.open) return false;
  g.open = false;
  if (game._garagePaused) {
    game.state = 'playing';
    game._garagePaused = false;
  }
  if (typeof document !== 'undefined') {
    const el = document.getElementById('garage-menu');
    if (el) el.remove();
  }
  return true;
}

// DOM overlay (id="garage-menu"). Buttons call buyUpgrade/buyPaint and
// re-render so levels + cash stay visible.
export function renderGarageMenu(game) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('garage-menu');
  if (el) el.remove();
  el = document.createElement('div');
  el.id = 'garage-menu';
  el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(8,10,20,0.72);z-index:40;font-family:sans-serif;color:#fff;';
  const p = game.player || {};
  const up = carUpgrades(game, p.car);
  const cash = getCash(game);
  const rows = Object.keys(GARAGE_DEFS.upgrades).map((kind) => {
    const def = GARAGE_DEFS.upgrades[kind];
    const level = up[kind];
    const price = upgradePrice(kind, level);
    const label = price == null ? 'MAX' : `$${price} — Buy`;
    const disabled = price == null || cash < price ? 'disabled' : '';
    return `<div style="display:flex;justify-content:space-between;gap:16px;margin:8px 0;">
      <span><b>${def.name}</b> — Lv ${level}/${def.maxLevel} <i style="color:#aaa">${def.desc}</i></span>
      <button data-upgrade="${kind}" ${disabled} style="padding:6px 14px;cursor:pointer;">${label}</button>
    </div>`;
  }).join('');
  const paints = GARAGE_DEFS.paint.colours.map((c, i) => (
    `<button data-paint="${i}" title="${GARAGE_DEFS.paint.colourNames[i]}" style="width:34px;height:34px;background:${c};border:2px solid #fff;margin:2px;cursor:pointer;"></button>`
  )).join('');
  el.innerHTML = `<div style="background:#141828;color:#fff;padding:24px 28px;border:2px solid #ffd94d;max-width:520px;width:90%;">
    <h2 style="margin:0 0 4px;">Fixer Garage</h2>
    <p style="margin:0 0 12px;color:#ffd94d;">Cash: $${cash} &nbsp;•&nbsp; Upgrades stay on this car</p>
    ${rows}
    <div style="margin-top:14px;"><b>Paint</b> — $${GARAGE_DEFS.paint.price} each (visual only)</div>
    <div>${paints}</div>
    <button id="garage-close" style="margin-top:16px;padding:8px 20px;cursor:pointer;">Close (E)</button>
  </div>`;
  const host = document.getElementById('wrap') || document.body;
  host.appendChild(el);
  el.querySelectorAll('[data-upgrade]').forEach((b) => {
    b.addEventListener('click', () => { buyUpgrade(game, b.dataset.upgrade); renderGarageMenu(game); });
  });
  el.querySelectorAll('[data-paint]').forEach((b) => {
    b.addEventListener('click', () => { buyPaint(game, Number(b.dataset.paint)); renderGarageMenu(game); });
  });
  const close = el.querySelector('#garage-close');
  if (close) close.addEventListener('click', () => closeGarageMenu(game));
}

// main.js calls update(game, dt); keys come from game.input.
export function updateGarage(game, dt) {
  void dt;
  ensureGarage(game);
  const input = game.input;
  if (game.garage.open) {
    if (input && typeof input.pressed === 'function' && (input.pressed('e') || input.pressed('Escape'))) {
      closeGarageMenu(game);
    }
    return;
  }
  if (input && typeof input.pressed === 'function' && input.pressed('e')) {
    if (playerInGarageZone(game)) openGarageMenu(game);
  }
}

export function update(game, dt) {
  updateGarage(game, dt);
}

export function init(game) {
  ensureGarage(game);
}

export function drawGarageZone(ctx, camera, game) {
  const camX = camera ? camera.x : 0, camY = camera ? camera.y : 0;
  const sx = GARAGE_DEFS.zone.x - camX, sy = GARAGE_DEFS.zone.y - camY;
  if (sx < -200 || sy < -200 || sx > 1480 || sy > 1000) return;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.strokeStyle = '#ffd94d';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.arc(0, 0, GARAGE_DEFS.zone.radius, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffd94d';
  ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('FIXER GARAGE', 0, -GARAGE_DEFS.zone.radius - 12);
  if (playerInGarageZone(game) && game.player && game.player.car && !game.garage.open) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('Press E — Upgrades', 0, GARAGE_DEFS.zone.radius + 24);
  }
  ctx.restore();
}
