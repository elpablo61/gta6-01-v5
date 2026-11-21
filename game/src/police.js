// police.js — wanted heat + police response for Crescent Bay (gta6-01 v5).
// First declaration: the wanted thresholds are the contract every system
// reads (helicopter spawns at 3, roadblocks at 4–5, escape at 0).
// Behaviour (spec §1 + §9.2): heat 0–100, stars at [0,12,30,52,74,92];
// heat decays while hiding (no police within 450 for 3s) — EXCEPT under
// the helicopter spotlight (helicopter.js), where decay is blocked.
// Foot cops at 1 star, patrol cars from 2 stars, roadblocks at 4–5.
// Arrest only when a foot cop stays within 30 units of a slow on-foot
// player for 1.2s in a row (running away breaks it). Spray Shop radius
// 150, heat drain 50/s; patrol cars brake and reverse within 130 of it;
// collision damage 3/s per car.

export const WANTED_STAR_THRESHOLDS = [0, 12, 30, 52, 74, 92];

export const POLICE_DEFS = {
  hideRadius: 450,        // no police within this = hiding
  hideSeconds: 3,         // hiding this long starts decay
  decayPerSecond: 9,      // heat lost per second while hiding
  sprayShopRadius: 150,
  sprayDrainPerSecond: 50,
  sprayKeepOutRadius: 130, // patrol cars brake + reverse inside this
  arrestRadius: 30,
  arrestSeconds: 1.2,
  collisionDamagePerSecond: 3,
  maxFootCops: 6,
  maxPatrolCars: 5,
};

export const SPRAY_SHOP = { x: 1000, y: 2200, radius: POLICE_DEFS.sprayShopRadius };

export function starsForHeat(heat) {
  let stars = 0;
  for (let i = 0; i < WANTED_STAR_THRESHOLDS.length; i++) {
    if (heat >= WANTED_STAR_THRESHOLDS[i]) stars = i;
  }
  return stars;
}

export function createPoliceState() {
  return {
    heat: 0,
    stars: 0,
    hideTimer: 0,
    footCops: [],    // {x,y,arrestTimer}
    patrolCars: [],  // vehicles flagged police, driven by traffic/pursuit
    roadblocks: [],  // {x,y,angle}
    inSprayShop: false,
  };
}

export function ensurePolice(game) {
  if (!game.police) game.police = createPoliceState();
  if (game.heat == null) game.heat = game.police.heat;
  if (game.wantedStars == null) game.wantedStars = game.police.stars;
  return game.police;
}

export function addHeat(game, amount) {
  const pol = ensurePolice(game);
  pol.heat = Math.max(0, Math.min(100, pol.heat + amount));
  pol.stars = starsForHeat(pol.heat);
  game.heat = pol.heat;
  game.wantedStars = pol.stars;
  return pol.stars;
}

export function setHeat(game, value) {
  const pol = ensurePolice(game);
  pol.heat = Math.max(0, Math.min(100, value));
  pol.stars = starsForHeat(pol.heat);
  game.heat = pol.heat;
  game.wantedStars = pol.stars;
  return pol.stars;
}

// Distance from the player to the nearest police unit (foot cop or
// patrol car). Used for the hiding rule.
export function nearestPoliceDistance(game) {
  const pol = ensurePolice(game);
  const p = game.player;
  if (!p) return Infinity;
  let best = Infinity;
  for (const c of pol.footCops) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < best) best = d;
  }
  for (const v of pol.patrolCars) {
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d < best) best = d;
  }
  return best;
}

export function updateWantedHeat(game, dt) {
  const pol = ensurePolice(game);
  const p = game.player;
  if (!p) return;

  // Spray Shop: fast heat drain while inside radius 150.
  const ds = Math.hypot(p.x - SPRAY_SHOP.x, p.y - SPRAY_SHOP.y);
  pol.inSprayShop = ds < POLICE_DEFS.sprayShopRadius;
  if (pol.inSprayShop) {
    pol.heat = Math.max(0, pol.heat - POLICE_DEFS.sprayDrainPerSecond * dt);
    pol.stars = starsForHeat(pol.heat);
    game.heat = pol.heat; game.wantedStars = pol.stars;
    pol.hideTimer = 0;
    return;
  }

  if (pol.heat <= 0) { pol.stars = 0; game.heat = 0; game.wantedStars = 0; return; }

  // Spotlight blocks decay: hiding is impossible under the helicopter.
  const underSpotlight = game.spotlightOnPlayer ? game.spotlightOnPlayer(game) : false;
  if (underSpotlight) { pol.hideTimer = 0; return; }

  const near = nearestPoliceDistance(game);
  if (near > POLICE_DEFS.hideRadius) {
    pol.hideTimer += dt;
    if (pol.hideTimer >= POLICE_DEFS.hideSeconds) {
      pol.heat = Math.max(0, pol.heat - POLICE_DEFS.decayPerSecond * dt);
      pol.stars = starsForHeat(pol.heat);
      game.heat = pol.heat; game.wantedStars = pol.stars;
    }
  } else {
    pol.hideTimer = 0;
  }
}

// Spawn budget by stars; the main loop / traffic system calls this and
// places units ahead of the player. Kept small and deterministic.
export function policeBudget(stars) {
  return {
    footCops: stars >= 1 ? Math.min(POLICE_DEFS.maxFootCops, stars + 1) : 0,
    patrolCars: stars >= 2 ? Math.min(POLICE_DEFS.maxPatrolCars, stars - 1) : 0,
    roadblocks: stars >= 4 ? stars - 3 : 0,
  };
}

// Arrest rule: a foot cop must stay within 30 of a SLOW on-foot player
// for 1.2s in a row. Running away (speed > 140) breaks the timer.
export function updateArrest(game, dt) {
  const pol = ensurePolice(game);
  const p = game.player;
  if (!p || !p.onFoot) return false;
  const speed = Math.hypot(p.vx || 0, p.vy || 0);
  const running = speed > 140;
  for (const c of pol.footCops) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < POLICE_DEFS.arrestRadius && !running) {
      c.arrestTimer = (c.arrestTimer || 0) + dt;
      if (c.arrestTimer >= POLICE_DEFS.arrestSeconds) {
        if (game.onPlayerCaught) game.onPlayerCaught();
        return true;
      }
    } else {
      c.arrestTimer = 0;
    }
  }
  return false;
}

// Patrol-car behaviour near the Spray Shop: brake and reverse within
// 130 of it so the player can actually escape there.
export function patrolNearSprayShop(game, car) {
  const d = Math.hypot(car.x - SPRAY_SHOP.x, car.y - SPRAY_SHOP.y);
  return d < POLICE_DEFS.sprayKeepOutRadius;
}

export function updatePolice(game, dt) {
  ensurePolice(game);
  updateWantedHeat(game, dt);
  updateArrest(game, dt);
  // Foot cops walk toward the player when wanted; otherwise hold still.
  const p = game.player;
  const pol = game.police;
  if (p && pol.stars >= 1) {
    for (const c of pol.footCops) {
      const dx = p.x - c.x, dy = p.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d > 60 && d < 900) {
        const sp = p.onFoot ? 150 : 110;
        c.x += (dx / d) * sp * dt;
        c.y += (dy / d) * sp * dt;
      }
    }
  }
}

export function drawPolice(ctx, camera, game) {
  const pol = ensurePolice(game);
  const camX = camera ? camera.x : 0, camY = camera ? camera.y : 0;
  for (const c of pol.footCops) {
    const sx = c.x - camX, sy = c.y - camY;
    if (sx < -40 || sy < -40 || sx > 1320 || sy > 840) continue;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = '#1d3f8f';
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('P', 0, 0);
    ctx.restore();
  }
  // Spray Shop marker on the ground.
  const sx = SPRAY_SHOP.x - camX, sy = SPRAY_SHOP.y - camY;
  if (sx > -200 && sy > -200 && sx < 1480 && sy < 1000) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.strokeStyle = game.police.inSprayShop ? '#7dff9a' : '#ffd94d';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(0, 0, SPRAY_SHOP.radius, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd94d';
    ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('SPRAY SHOP', 0, -SPRAY_SHOP.radius - 12);
    ctx.restore();
  }
}
