// Crescent Bay — rendering. The whole 3200x3200 city is pre-rendered once
// onto a 1600x1600 offscreen canvas (the static layer); every frame draws
// only the visible slice of that layer plus the dynamic entities (player,
// cars, pedestrians, bullets, particles). Never repaint the whole city per
// frame. Buildings are drawn 2.5D: roof plus darker south and east sides,
// with blue-purple shadows falling to the south-east (sun from the
// north-west).

import { CONFIG, districtAt } from './config.js';

export function render(game, ctx) {
  const world = game.world;
  const cam = game.camera;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);

  // ---- static layer (built once) ----
  if (!game._staticLayer) game._staticLayer = buildStaticLayer(world);
  const scale = 0.5; // static layer is half-scale
  const sx = (cam.x - W / 2) / 1;
  const sy = (cam.y - H / 2) / 1;
  ctx.drawImage(
    game._staticLayer,
    (cam.x - W / 2) * scale, (cam.y - H / 2) * scale, W * scale, H * scale,
    0, 0, W, H,
  );
  void sx; void sy;

  const toScreen = (x, y) => ({ x: x - (cam.x - W / 2), y: y - (cam.y - H / 2) });

  // ---- mission marker / objective target ----
  if (game.objectiveTarget) {
    const p = toScreen(game.objectiveTarget.x, game.objectiveTarget.y);
    const pulse = 6 + Math.sin(game.time * 4) * 3;
    ctx.save();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 26 - pulse);
    ctx.lineTo(p.x - 14, p.y - 44 - pulse);
    ctx.lineTo(p.x + 14, p.y - 44 - pulse);
    ctx.closePath();
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.restore();
  }

  // ---- spray shop + garage zones ----
  drawZone(ctx, toScreen, CONFIG.sprayShop, '#ff7ab8', 'SPRAY SHOP');
  drawZone(ctx, toScreen, CONFIG.garage, '#7ab8ff', 'GARAGE');

  // ---- pickups ----
  for (const pk of game.pickups || []) {
    const p = toScreen(pk.x, pk.y);
    ctx.save();
    ctx.fillStyle = pk.kind === 'health' ? '#3ddc5f' : pk.kind === 'ammo' ? '#ffd23f' : '#c77dff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pk.kind === 'health' ? '+' : pk.kind === 'ammo' ? 'A' : 'W', p.x, p.y + 1);
    ctx.restore();
  }

  // ---- parked / traffic / player cars ----
  for (const car of game.cars || []) drawCar(ctx, toScreen, car, game);
  // ---- pedestrians ----
  for (const ped of game.peds || []) {
    const p = toScreen(ped.x, ped.y);
    ctx.save();
    ctx.fillStyle = ped.fleeing ? '#ff5d5d' : ped.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // ---- enemies (shootout) ----
  for (const e of game.enemies || []) {
    const p = toScreen(e.x, e.y);
    ctx.save();
    ctx.fillStyle = '#8a1f2d';
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.x - 12, p.y - 22, 24, 4);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(p.x - 12, p.y - 22, 24 * Math.max(0, e.hp / e.maxHp), 4);
    ctx.restore();
  }
  // ---- police ----
  for (const cop of game.police || []) {
    const p = toScreen(cop.x, cop.y);
    ctx.save();
    if (cop.car) {
      drawCar(ctx, toScreen, cop.car, game);
    } else {
      ctx.fillStyle = '#1c2733';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#4da3ff';
      ctx.fillRect(p.x - 6, p.y - 16, 12, 4);
    }
    ctx.restore();
  }
  // ---- helicopter (systems module draws it if present) ----
  if (game.helicopter && game.helicopter.active) {
    const h = game.helicopter;
    const p = toScreen(h.x, h.y);
    ctx.save();
    // Ground shadow + spotlight pool.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(p.x + 18, p.y + 24, 34, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,200,0.13)';
    ctx.beginPath();
    ctx.arc(p.x, p.y + 10, 90, 0, Math.PI * 2);
    ctx.fill();
    // Body + rotor blur.
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(game.time * 2) * 0.1);
    ctx.fillStyle = '#222';
    ctx.fillRect(-34, -4, 68, 8);
    ctx.fillStyle = '#3a4a5a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8d6e5';
    ctx.beginPath();
    ctx.ellipse(10, 0, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // ---- bullets ----
  for (const b of game.bullets || []) {
    const p = toScreen(b.x, b.y);
    ctx.save();
    ctx.strokeStyle = '#fff3a0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(b.angle) * 10, p.y - Math.sin(b.angle) * 10);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
  }
  // ---- particles ----
  for (const pt of game.particles || []) {
    const p = toScreen(pt.x, pt.y);
    ctx.save();
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.fillRect(p.x - pt.size / 2, p.y - pt.size / 2, pt.size, pt.size);
    ctx.restore();
  }
  // ---- player ----
  drawPlayer(ctx, toScreen, game);

  // ---- night overlay + headlights / lamp pools ----
  const night = game.nightFactor || 0;
  if (night > 0.02) {
    ctx.save();
    ctx.fillStyle = `rgba(8,10,38,${(night * 0.45).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    // Light pools around the player and cars.
    ctx.globalCompositeOperation = 'lighter';
    const pool = (wx, wy, r) => {
      const p = toScreen(wx, wy);
      const g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, r);
      g.addColorStop(0, 'rgba(255,220,140,0.20)');
      g.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    pool(game.player.x, game.player.y, 150);
    for (const car of game.cars || []) {
      if (car.moving) pool(car.x + Math.cos(car.angle) * 40, car.y + Math.sin(car.angle) * 40, 110);
    }
    ctx.restore();
  }

  drawHud(game, ctx, W, H);
}

function drawZone(ctx, toScreen, zone, color, label) {
  const p = toScreen(zone.x, zone.y);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, zone.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, p.x, p.y - zone.radius - 8);
  ctx.restore();
}

function drawCar(ctx, toScreen, car, game) {
  const p = toScreen(car.x, car.y);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(car.angle);
  const L = car.length || 46;
  const Wd = car.width || 22;
  // Ground ring for the player's car.
  if (car.isPlayer) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, L / 2 + 8, Wd / 2 + 8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Shadow to the south-east.
  ctx.fillStyle = 'rgba(60,40,120,0.25)';
  ctx.fillRect(-L / 2 + 4, -Wd / 2 + 5, L, Wd);
  // Body.
  ctx.fillStyle = car.color || '#888';
  ctx.beginPath();
  ctx.roundRect(-L / 2, -Wd / 2, L, Wd, 7);
  ctx.fill();
  // Roof / cabin.
  ctx.fillStyle = 'rgba(20,30,45,0.85)';
  ctx.beginPath();
  ctx.roundRect(-L / 6, -Wd / 2 + 4, L / 3, Wd - 8, 4);
  ctx.fill();
  // Windshield highlight.
  ctx.fillStyle = 'rgba(180,220,255,0.5)';
  ctx.fillRect(L / 6, -Wd / 2 + 5, 4, Wd - 10);
  // Headlights.
  if ((game.nightFactor || 0) > 0.25) {
    ctx.fillStyle = '#fff6b0';
    ctx.fillRect(L / 2 - 2, -Wd / 2 + 2, 4, 5);
    ctx.fillRect(L / 2 - 2, Wd / 2 - 7, 4, 5);
  }
  // Police light bar — only police use red/blue.
  if (car.type === 'police') {
    const on = Math.floor(game.time * 6) % 2 === 0;
    ctx.fillStyle = on ? '#ff2d2d' : '#2d6bff';
    ctx.fillRect(-4, -Wd / 2 + 1, 9, 6);
    ctx.fillStyle = on ? '#2d6bff' : '#ff2d2d';
    ctx.fillRect(-4, Wd / 2 - 7, 9, 6);
  }
  // Smoke when damaged.
  if (car.hp !== undefined && car.hp < 40) {
    ctx.fillStyle = 'rgba(120,120,120,0.6)';
    ctx.beginPath();
    ctx.arc(-L / 2 + 4, 0, 7 + Math.sin(game.time * 9) * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlayer(ctx, toScreen, game) {
  const pl = game.player;
  const p = toScreen(pl.x, pl.y);
  ctx.save();
  if (pl.inCar) return; // driver is inside the car
  // White outline so the player is always findable.
  ctx.fillStyle = '#f4f6f8';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8b13c';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  ctx.fill();
  // Aim direction tick.
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(pl.aim) * 22, p.y + Math.sin(pl.aim) * 22);
  ctx.stroke();
  ctx.restore();
}

// ---- static layer ----

export function buildStaticLayer(world) {
  const S = 1600; // half scale of 3200
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const k = 0.5;
  // Ground.
  g.fillStyle = '#b8a67e';
  g.fillRect(0, 0, S, S);
  // Water + sand on the east edge.
  g.fillStyle = '#e8d5a8';
  g.fillRect(world.beachX * k, 0, (world.size - world.beachX) * k, S);
  g.fillStyle = '#3fa7d6';
  g.fillRect((world.beachX + 40) * k, 0, (world.size - world.beachX - 40) * k, S);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (let y = 0; y < S; y += 46) g.fillRect((world.beachX + 44) * k, y, 5, 18);
  // Parks.
  for (const pk of world.parks) {
    g.fillStyle = '#6fae5e';
    g.fillRect(pk.x * k, pk.y * k, pk.w * k, pk.h * k);
  }
  // Blocks (sidewalk-coloured ground between roads).
  g.fillStyle = '#cbb98f';
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      const x0 = world.roads[bx] + world.roadWidth / 2;
      const y0 = world.roads[by] + world.roadWidth / 2;
      const x1 = bx + 1 < 8 ? world.roads[bx + 1] - world.roadWidth / 2 : world.size;
      const y1 = by + 1 < 8 ? world.roads[by + 1] - world.roadWidth / 2 : world.size;
      g.fillRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    }
  }
  // Roads.
  g.fillStyle = '#6e6a63';
  for (const r of world.roads) {
    g.fillRect(0, (r - world.roadWidth / 2) * k, S, world.roadWidth * k);
    g.fillRect((r - world.roadWidth / 2) * k, 0, world.roadWidth * k, S);
  }
  // Centre dashes.
  g.fillStyle = '#e8e2c8';
  for (const r of world.roads) {
    for (let d = 0; d < world.size; d += 80) {
      g.fillRect(d * k, (r - 2) * k, 34 * k, 4 * k);
      g.fillRect((r - 2) * k, d * k, 4 * k, 34 * k);
    }
  }
  // Marina pier.
  g.fillStyle = '#8a6f4d';
  g.fillRect(world.pier.x * k, world.pier.y * k, world.pier.w * k, world.pier.h * k);
  // Buildings, 2.5D: shadow, south+east sides, roof.
  for (const b of world.buildings) {
    const sh = b.height * 0.55;
    g.fillStyle = 'rgba(70,50,140,0.30)';
    g.beginPath();
    g.moveTo((b.x + 6) * k, (b.y + b.h) * k);
    g.lineTo((b.x + b.w + sh) * k, (b.y + b.h + sh * 0.6) * k);
    g.lineTo((b.x + b.w + sh) * k, (b.y + sh * 0.6) * k);
    g.lineTo((b.x + 6 + b.w) * k, (b.y) * k);
    g.closePath();
    g.fill();
    // South + east sides (darker).
    g.fillStyle = shade(b.color, -28);
    g.fillRect(b.x * k, (b.y + b.h - 8) * k, b.w * k, 8 * k);
    g.fillRect((b.x + b.w - 8) * k, b.y * k, 8 * k, b.h * k);
    // Roof.
    g.fillStyle = b.roof;
    g.fillRect(b.x * k, b.y * k, b.w * k, b.h * k);
    // Windows on the roof edge (glass towers get a grid).
    if (b.district === 'glass') {
      g.fillStyle = 'rgba(200,230,255,0.75)';
      for (let wx = b.x + 10; wx < b.x + b.w - 10; wx += 18) {
        for (let wy = b.y + 10; wy < b.y + b.h - 10; wy += 18) {
          g.fillRect(wx * k, wy * k, 8 * k, 8 * k);
        }
      }
    } else {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect((b.x + 8) * k, (b.y + 8) * k, 10 * k, 10 * k);
      g.fillRect((b.x + b.w - 18) * k, (b.y + b.h - 18) * k, 10 * k, 10 * k);
    }
  }
  // Trees.
  for (const t of world.trees) {
    g.fillStyle = '#3f7d3a';
    g.beginPath();
    g.arc(t.x * k, t.y * k, t.r * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5da24f';
    g.beginPath();
    g.arc((t.x - 2) * k, (t.y - 2) * k, (t.r - 3) * k, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

// ---- HUD (canvas) ----

export function drawHud(game, ctx, W, H) {
  const pl = game.player;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  // Wanted stars, >=36px, top-left, gold/red glow.
  const stars = game.stars || 0;
  ctx.font = '40px sans-serif';
  ctx.textAlign = 'left';
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < stars ? '#ffd23f' : 'rgba(255,255,255,0.25)';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    const x = 22 + i * 44;
    ctx.strokeText('★', x, 52);
    ctx.fillText('★', x, 52);
  }
  // Health bar, thick, under the stars.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(20, 64, 220, 18);
  ctx.fillStyle = pl.hp > 30 ? '#3ddc5f' : '#ff3b30';
  ctx.fillRect(22, 66, 216 * Math.max(0, pl.hp / pl.maxHp), 14);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 64, 220, 18);
  // Cash, big, top-right above the minimap.
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 4;
  ctx.strokeText(`$${Math.floor(game.cash)}`, W - 24, 40);
  ctx.fillText(`$${Math.floor(game.cash)}`, W - 24, 40);
  // Minimap, >=180px, upper-right.
  drawMinimap(game, ctx, W - 204, 52, 180);
  // Radio station + equalizer, under the minimap.
  const station = game.radioStation || 'Bay FM';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.strokeText(`♪ ${station}`, W - 24, 258);
  ctx.fillText(`♪ ${station}`, W - 24, 258);
  for (let i = 0; i < 5; i++) {
    const h = 6 + Math.abs(Math.sin(game.time * 5 + i * 1.3)) * 10;
    ctx.fillStyle = '#7ab8ff';
    ctx.fillRect(W - 24 - (5 - i) * 10, 268 - h, 6, h);
  }
  // Objective banner, >=28px bold over a dark scrim, lower-left.
  if (game.objective) {
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'left';
    const tw = ctx.measureText(game.objective).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(16, H - 66, tw + 28, 44);
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 4;
    ctx.strokeText(game.objective, 30, H - 34);
    ctx.fillText(game.objective, 30, H - 34);
  }
  // Speed / ammo, big, bottom-right.
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'right';
  const speed = pl.inCar && pl.car ? Math.round(Math.abs(pl.car.speed) * 0.12) : 0;
  const weapon = game.weapons ? game.weapons.current : 'pistol';
  const ammo = game.weapons ? game.weapons.ammo[weapon] : pl.ammo;
  const wname = (CONFIG.weapons[weapon] || {}).name || 'Pistol';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 4;
  if (pl.inCar) {
    ctx.strokeText(`${speed} mph`, W - 24, H - 24);
    ctx.fillText(`${speed} mph`, W - 24, H - 24);
  } else {
    ctx.strokeText(`${wname}  ${ammo}`, W - 24, H - 24);
    ctx.fillText(`${wname}  ${ammo}`, W - 24, H - 24);
  }
  // Clock / day-night indicator, top-centre.
  const tod = game.timeOfDay || 0.3;
  const hour = Math.floor(((tod * 24) + 6) % 24);
  const label = hour >= 6 && hour < 18 ? 'DAY' : 'NIGHT';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeText(`${String(hour).padStart(2, '0')}:00  ${label}`, W / 2, 36);
  ctx.fillText(`${String(hour).padStart(2, '0')}:00  ${label}`, W / 2, 36);
  ctx.restore();
}

export function drawMinimap(game, ctx, x, y, size) {
  const world = game.world;
  const s = size / world.size;
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,24,0.78)';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);
  // Water.
  ctx.fillStyle = '#3fa7d6';
  ctx.fillRect(x + world.beachX * s, y, size - world.beachX * s, size);
  // Roads.
  ctx.strokeStyle = '#c9c2ae';
  ctx.lineWidth = 3;
  for (const r of world.roads) {
    ctx.beginPath();
    ctx.moveTo(x, y + r * s);
    ctx.lineTo(x + size, y + r * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + r * s, y);
    ctx.lineTo(x + r * s, y + size);
    ctx.stroke();
  }
  // Objective diamond.
  if (game.objectiveTarget) {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(x + game.objectiveTarget.x * s, y + game.objectiveTarget.y * s - 7);
    ctx.lineTo(x + game.objectiveTarget.x * s + 7, y + game.objectiveTarget.y * s);
    ctx.lineTo(x + game.objectiveTarget.x * s, y + game.objectiveTarget.y * s + 7);
    ctx.lineTo(x + game.objectiveTarget.x * s - 7, y + game.objectiveTarget.y * s);
    ctx.closePath();
    ctx.fill();
  }
  // Police dots (red, blinking).
  if (Math.floor(game.time * 3) % 2 === 0) {
    ctx.fillStyle = '#ff3b30';
    for (const cop of game.police || []) {
      ctx.beginPath();
      ctx.arc(x + cop.x * s, y + cop.y * s, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Player arrow (white).
  const pl = game.player;
  ctx.fillStyle = '#fff';
  ctx.save();
  ctx.translate(x + pl.x * s, y + pl.y * s);
  ctx.rotate(pl.inCar && pl.car ? pl.car.angle : pl.aim);
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-6, -5);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();
}
