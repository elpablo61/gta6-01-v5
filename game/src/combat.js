// combat.js — on-foot combat for Crescent Bay (gta6-01 v5).
// First declaration: the shootout arena is the contract missions.js
// (m8/m10/m12) and autopilot.js (burst fire, ammo pickups) read.
// Enemies use the pistol only (spec §3.2). Player bullets come from
// weapons.js; enemy bullets are plain objects on game.enemyBullets.
// A shootout needs a cop perimeter: police hold a ring around the
// arena, never pile onto one spot (spec §9.2). Cover + health pickups
// sit in every arena so the finale is survivable.

export const ENEMY_DEFS = {
  grunt: { hp: 36, damage: 6, fireInterval: 1.1, range: 380, speed: 95, color: '#c94f3d' },
};

export const SHOOTOUT_ARENAS = {
  m8: {
    center: { x: 1800, y: 1800 }, radius: 320,
    enemies: [{ x: 1700, y: 1700 }, { x: 1900, y: 1700 }, { x: 1800, y: 1950 }],
    cover: [{ x: 1750, y: 1850 }, { x: 1860, y: 1750 }],
    health: [{ x: 1720, y: 1900 }, { x: 1880, y: 1900 }],
    ammo: [{ x: 1800, y: 1820 }],
  },
  m10: {
    center: { x: 2560, y: 2560 }, radius: 340,
    enemies: [
      { x: 2460, y: 2460 }, { x: 2660, y: 2460 }, { x: 2460, y: 2660 },
      { x: 2660, y: 2660 }, { x: 2560, y: 2400 },
    ],
    cover: [{ x: 2500, y: 2500 }, { x: 2620, y: 2620 }, { x: 2560, y: 2680 }],
    health: [{ x: 2440, y: 2560 }, { x: 2680, y: 2560 }],
    ammo: [{ x: 2520, y: 2520 }, { x: 2600, y: 2600 }],
  },
  m12: {
    center: { x: 1800, y: 1800 }, radius: 340,
    enemies: [
      { x: 1700, y: 1700 }, { x: 1900, y: 1700 },
      { x: 1700, y: 1900 }, { x: 1900, y: 1900 },
    ],
    cover: [{ x: 1750, y: 1850 }, { x: 1860, y: 1750 }, { x: 1800, y: 1700 }],
    health: [{ x: 1720, y: 1900 }, { x: 1880, y: 1900 }, { x: 1800, y: 2000 }],
    ammo: [{ x: 1800, y: 1820 }, { x: 1860, y: 1900 }],
  },
};

export function createCombatState() {
  return {
    enemies: [],       // {x,y,hp,alive,lastShotAt,angle}
    enemyBullets: [],  // {x,y,vx,vy,damage,life}
    healthPickups: [], // {x,y,taken}
    arena: null,       // active SHOOTOUT_ARENAS key or null
    perimeter: [],     // cop ring positions around the arena
  };
}

export function ensureCombat(game) {
  if (!game.combat) game.combat = createCombatState();
  if (!game.enemyBullets) game.enemyBullets = game.combat.enemyBullets;
  return game.combat;
}

export function startShootout(game, missionId) {
  const c = ensureCombat(game);
  const arena = SHOOTOUT_ARENAS[missionId];
  if (!arena) return false;
  c.arena = missionId;
  c.enemies = arena.enemies.map((e) => ({
    x: e.x, y: e.y, hp: ENEMY_DEFS.grunt.hp, alive: true,
    lastShotAt: -99, angle: 0,
  }));
  c.healthPickups = arena.health.map((h) => ({ ...h, taken: false }));
  // Cop perimeter: a ring around the arena, never piled on one spot.
  c.perimeter = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    c.perimeter.push({
      x: arena.center.x + Math.cos(a) * (arena.radius + 90),
      y: arena.center.y + Math.sin(a) * (arena.radius + 90),
      angle: a,
    });
  }
  // Ammo pickups go through weapons.js so the autopilot's ≤6 rule sees them.
  if (game.weapons && arena.ammo) {
    for (const a of arena.ammo) {
      if (game.spawnAmmoPickup) game.spawnAmmoPickup(game, a.x, a.y, 30);
      else (game.ammoPickups = game.ammoPickups || []).push({ x: a.x, y: a.y, amount: 30, taken: false });
    }
  }
  return true;
}

export function enemiesAlive(game) {
  return ensureCombat(game).enemies.filter((e) => e.alive).length;
}

export function nearestEnemy(game) {
  const c = ensureCombat(game);
  const p = game.player;
  if (!p) return null;
  let best = null, bestD = Infinity;
  for (const e of c.enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best ? { enemy: best, dist: bestD } : null;
}

export function damagePlayer(game, amount) {
  const p = game.player;
  if (!p) return;
  p.hp = Math.max(0, (p.hp == null ? 100 : p.hp) - amount);
  if (game.hud) game.hud.damageFlash = 0.35;
  if (p.hp <= 0 && game.onPlayerDown) game.onPlayerDown();
}

// Resolve player bullets against enemies, cops and the helicopter.
// Called from the main loop after weapons.updateBullets.
export function resolvePlayerBullets(game) {
  const c = ensureCombat(game);
  const bullets = game.bullets || [];
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (b.from !== 'player') continue;
    let hit = false;
    for (const e of c.enemies) {
      if (!e.alive) continue;
      const dx = b.x - e.x, dy = b.y - e.y;
      if (dx * dx + dy * dy < 26 * 26) {
        e.hp -= b.damage;
        if (e.hp <= 0) {
          e.alive = false;
          if (game.addCash) { /* no cash for a takedown; reward is the mission */ }
          if (game.audio && game.audio.playPickup) game.audio.playPickup();
        }
        hit = true;
        break;
      }
    }
    if (!hit && game.helicopter && game.helicopter.state === 'shadowing') {
      const h = game.helicopter;
      const dx = b.x - h.x, dy = b.y - h.y;
      if (dx * dx + dy * dy < 46 * 46) {
        if (game.damageHelicopter) game.damageHelicopter(game, b.damage);
        hit = true;
      }
    }
    if (hit) bullets.splice(i, 1);
  }
}

export function updateCombat(game, dt) {
  const c = ensureCombat(game);
  const p = game.player;
  const now = game.time ? game.time.now : 0;
  if (!p) return;

  // Enemies: pistol only, slow aimed fire, never all at once.
  for (const e of c.enemies) {
    if (!e.alive) continue;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    e.angle = Math.atan2(dy, dx);
    if (d > 300) {
      // Walk toward the player until in range (never teleport).
      e.x += (dx / d) * ENEMY_DEFS.grunt.speed * dt;
      e.y += (dy / d) * ENEMY_DEFS.grunt.speed * dt;
    } else if (d < 120) {
      e.x -= (dx / d) * ENEMY_DEFS.grunt.speed * 0.5 * dt;
      e.y -= (dy / d) * ENEMY_DEFS.grunt.speed * 0.5 * dt;
    }
    if (d < ENEMY_DEFS.grunt.range && p.onFoot && now - e.lastShotAt > ENEMY_DEFS.grunt.fireInterval) {
      e.lastShotAt = now;
      const a = e.angle + (Math.random() - 0.5) * 0.14;
      c.enemyBullets.push({
        x: e.x + Math.cos(a) * 20, y: e.y + Math.sin(a) * 20,
        vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
        damage: ENEMY_DEFS.grunt.damage, life: 1.2,
      });
      if (game.audio && game.audio.playGunshot) game.audio.playGunshot('pistol');
    }
  }

  // Enemy bullets move and can hit the player.
  for (let i = c.enemyBullets.length - 1; i >= 0; i--) {
    const b = c.enemyBullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    let dead = b.life <= 0;
    if (!dead && p.onFoot) {
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy < 18 * 18) { damagePlayer(game, b.damage); dead = true; }
    }
    if (dead) c.enemyBullets.splice(i, 1);
  }
  game.enemyBullets = c.enemyBullets;

  // Health pickups in the arena.
  if (p.onFoot) {
    for (const h of c.healthPickups) {
      if (h.taken) continue;
      const dx = p.x - h.x, dy = p.y - h.y;
      if (dx * dx + dy * dy < 30 * 30) {
        h.taken = true;
        p.hp = Math.min(p.maxHp || 100, (p.hp == null ? 100 : p.hp) + 40);
        if (game.audio && game.audio.playPickup) game.audio.playPickup();
      }
    }
  }
}

export function drawCombat(ctx, camera, game) {
  const c = ensureCombat(game);
  const camX = camera ? camera.x : 0, camY = camera ? camera.y : 0;
  for (const e of c.enemies) {
    if (!e.alive) continue;
    const sx = e.x - camX, sy = e.y - camY;
    if (sx < -40 || sy < -40 || sx > 1320 || sy > 840) continue;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = ENEMY_DEFS.grunt.color;
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
    // Gun direction.
    ctx.strokeStyle = '#222'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(e.angle) * 22, Math.sin(e.angle) * 22); ctx.stroke();
    // Tiny health bar.
    ctx.fillStyle = '#222'; ctx.fillRect(-14, -24, 28, 5);
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(-14, -24, 28 * Math.max(0, e.hp / ENEMY_DEFS.grunt.hp), 5);
    ctx.restore();
  }
  for (const h of c.healthPickups) {
    if (h.taken) continue;
    const sx = h.x - camX, sy = h.y - camY;
    if (sx < -40 || sy < -40 || sx > 1320 || sy > 840) continue;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-9, -9, 18, 18);
    ctx.fillStyle = '#2fae4e';
    ctx.fillRect(-2, -7, 4, 14);
    ctx.fillRect(-7, -2, 14, 4);
    ctx.restore();
  }
  for (const b of c.enemyBullets) {
    const sx = b.x - camX, sy = b.y - camY;
    ctx.fillStyle = '#ff5a4d';
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
  }
  // Arena cover blocks (drawn as low barriers).
  if (c.arena && SHOOTOUT_ARENAS[c.arena]) {
    for (const cov of SHOOTOUT_ARENAS[c.arena].cover) {
      const sx = cov.x - camX, sy = cov.y - camY;
      ctx.fillStyle = '#7a6a4f';
      ctx.fillRect(sx - 26, sy - 10, 52, 20);
      ctx.fillStyle = '#9a8a6a';
      ctx.fillRect(sx - 26, sy - 10, 52, 6);
    }
  }
}
