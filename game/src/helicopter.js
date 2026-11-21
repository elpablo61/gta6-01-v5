// helicopter.js — police helicopter for Crescent Bay (gta6-01 v5).
// First declaration: the helicopter state machine is the contract
// missions.js (m9/m12 force it up) and police.js (heat decay) read.
// Behaviour (spec §3.1): spawns at 3 stars and above (and by mission
// script in m9/m12). It flies — no road constraint — shadows Rook from
// above at a fixed height, faster than any car. A visible spotlight
// cone/circle on the ground follows Rook while overhead. While the
// spotlight is on Rook, heat does NOT decay (hiding is impossible under
// it). It does not shoot. Rook can shoot it: after enough damage it
// smokes and retreats for 20 seconds, then returns if wanted is still
// 3+. When wanted drops below 3 stars, it leaves. Drawn with a shadow
// on the ground and a rotor blur. The autopilot ignores it except by
// keeping moving toward its objective (never stop under the spotlight).

export const HELICOPTER_DEFS = {
  speed: 620,            // faster than any car (top car speed ~560)
  height: 150,           // fixed visual height above the ground
  hp: 120,               // damage before it smokes and retreats
  retreatSeconds: 20,    // smoke + retreat time before it may return
  spotlightRadius: 130,  // ground circle that follows Rook
  shadowOffsetX: 26, shadowOffsetY: 34, // sun from the north-west
};

export const HELICOPTER_STATE = {
  GONE: 'gone',
  SHADOWING: 'shadowing',
  RETREATING: 'retreating',
};

export function createHelicopterState() {
  return {
    state: HELICOPTER_STATE.GONE,
    x: 0, y: 0,
    hp: HELICOPTER_DEFS.hp,
    retreatTimer: 0,
    rotorAngle: 0,
    forced: false, // true while a mission script (m9/m12) demands it up
    smokeTimer: 0,
  };
}

export function ensureHelicopter(game) {
  if (!game.helicopter) game.helicopter = createHelicopterState();
  return game.helicopter;
}

export function wantedStars(game) {
  if (game.wantedStars != null) return game.wantedStars;
  const heat = game.heat || 0;
  const t = [0, 12, 30, 52, 74, 92];
  let stars = 0;
  for (let i = 0; i < t.length; i++) if (heat >= t[i]) stars = i;
  return stars;
}

// True while the spotlight circle is on Rook — heat must not decay.
export function spotlightOnPlayer(game) {
  const h = ensureHelicopter(game);
  if (h.state !== HELICOPTER_STATE.SHADOWING) return false;
  const p = game.player;
  if (!p) return false;
  const dx = p.x - h.x, dy = p.y - h.y;
  return dx * dx + dy * dy < HELICOPTER_DEFS.spotlightRadius * HELICOPTER_DEFS.spotlightRadius;
}

export function helicopterActive(game) {
  return ensureHelicopter(game).state !== HELICOPTER_STATE.GONE;
}

// Mission scripts call this: m9/m12 force the helicopter up regardless
// of the current star count; clearing it lets the normal 3-star rule run.
export function forceHelicopter(game, on) {
  const h = ensureHelicopter(game);
  h.forced = !!on;
  if (on && h.state === HELICOPTER_STATE.GONE) {
    const p = game.player || { x: 1600, y: 1600 };
    h.x = p.x - 300; h.y = p.y - 300;
    h.hp = HELICOPTER_DEFS.hp;
    h.state = HELICOPTER_STATE.SHADOWING;
  }
  if (!on && h.state !== HELICOPTER_STATE.GONE && wantedStars(game) < 3) {
    h.state = HELICOPTER_STATE.GONE;
  }
}

// Damage from player bullets; combat.js calls this when a bullet hits
// the helicopter's ground position (within ~46 units of its shadow).
export function damageHelicopter(game, amount) {
  const h = ensureHelicopter(game);
  if (h.state !== HELICOPTER_STATE.SHADOWING) return false;
  h.hp -= amount;
  if (h.hp <= 0) {
    h.state = HELICOPTER_STATE.RETREATING;
    h.retreatTimer = HELICOPTER_DEFS.retreatSeconds;
    h.smokeTimer = HELICOPTER_DEFS.retreatSeconds;
    if (game.hud) game.hud.message = 'Helicopter smoking — it is pulling back!';
    return true;
  }
  return false;
}

export function updateHelicopter(game, dt) {
  const h = ensureHelicopter(game);
  const p = game.player;
  const stars = wantedStars(game);
  h.rotorAngle += dt * 22;

  if (h.state === HELICOPTER_STATE.GONE) {
    if ((stars >= 3 || h.forced) && p) {
      h.x = p.x - 320; h.y = p.y - 320;
      h.hp = HELICOPTER_DEFS.hp;
      h.state = HELICOPTER_STATE.SHADOWING;
    }
    return;
  }

  if (h.state === HELICOPTER_STATE.RETREATING) {
    h.retreatTimer -= dt;
    h.smokeTimer -= dt;
    // Fly away from the player while retreating.
    if (p) {
      const dx = h.x - p.x, dy = h.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      h.x += (dx / d) * HELICOPTER_DEFS.speed * dt;
      h.y += (dy / d) * HELICOPTER_DEFS.speed * dt;
    }
    if (h.retreatTimer <= 0) {
      if ((wantedStars(game) >= 3 || h.forced) && p) {
        h.hp = HELICOPTER_DEFS.hp;
        h.state = HELICOPTER_STATE.SHADOWING;
      } else {
        h.state = HELICOPTER_STATE.GONE;
      }
    }
    return;
  }

  // SHADOWING: fly straight at Rook, faster than any car, no roads.
  if (!h.forced && stars < 3) {
    h.state = HELICOPTER_STATE.GONE;
    return;
  }
  if (p) {
    const dx = p.x - h.x, dy = p.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      const step = Math.min(d, HELICOPTER_DEFS.speed * dt);
      h.x += (dx / d) * step;
      h.y += (dy / d) * step;
    }
    h.x = Math.max(40, Math.min(3160, h.x));
    h.y = Math.max(40, Math.min(3160, h.y));
  }
}

export function drawHelicopter(ctx, camera, game) {
  const h = ensureHelicopter(game);
  if (h.state === HELICOPTER_STATE.GONE) return;
  const camX = camera ? camera.x : 0, camY = camera ? camera.y : 0;
  const sx = h.x - camX, sy = h.y - camY;
  if (sx < -160 || sy < -160 || sx > 1440 || sy > 960) return;
  const t = game.time ? game.time.now : 0;

  // Spotlight cone/circle on the ground, following Rook.
  if (h.state === HELICOPTER_STATE.SHADOWING && game.player) {
    const px = game.player.x - camX, py = game.player.y - camY;
    const grad = ctx.createRadialGradient(px, py, 8, px, py, HELICOPTER_DEFS.spotlightRadius);
    grad.addColorStop(0, 'rgba(255, 246, 200, 0.42)');
    grad.addColorStop(1, 'rgba(255, 246, 200, 0)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py, HELICOPTER_DEFS.spotlightRadius, 0, Math.PI * 2); ctx.fill();
    // Faint cone from the helicopter to the lit circle.
    ctx.strokeStyle = 'rgba(255, 246, 200, 0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, py); ctx.stroke();
    ctx.restore();
  }

  // Ground shadow (offset south-east, sun from the north-west).
  ctx.save();
  ctx.fillStyle = 'rgba(20, 16, 60, 0.30)';
  ctx.beginPath();
  ctx.ellipse(
    sx + HELICOPTER_DEFS.shadowOffsetX, sy + HELICOPTER_DEFS.shadowOffsetY,
    34, 16, 0, 0, Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  // Body, drawn above the ground (fixed height = drawn slightly up).
  const by = sy - 18;
  ctx.save();
  ctx.translate(sx, by);
  // Rotor blur: two translucent arcs spinning.
  ctx.strokeStyle = 'rgba(220, 225, 240, 0.55)';
  ctx.lineWidth = 4;
  const r1 = h.rotorAngle % Math.PI;
  ctx.beginPath();
  ctx.ellipse(0, -6, 44, 7, r1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220, 225, 240, 0.30)';
  ctx.beginPath();
  ctx.ellipse(0, -6, 44, 7, r1 + Math.PI / 2, 0, Math.PI * 2);
  ctx.stroke();
  // Fuselage + tail + skids, police colours.
  ctx.fillStyle = '#1c2733';
  ctx.fillRect(-26, -8, 52, 16);
  ctx.fillStyle = '#e8ecf2';
  ctx.fillRect(-20, -6, 30, 12);
  ctx.fillStyle = '#d23b2e';
  ctx.fillRect(-26, -8, 52, 4);
  ctx.fillStyle = '#1c2733';
  ctx.fillRect(26, -3, 26, 5); // tail boom
  ctx.fillStyle = '#d23b2e';
  ctx.fillRect(46, -7, 8, 12); // tail fin
  // Searchlight housing.
  ctx.fillStyle = '#fff6c8';
  ctx.beginPath(); ctx.arc(-8, 8, 4, 0, Math.PI * 2); ctx.fill();
  // Smoke while retreating.
  if (h.state === HELICOPTER_STATE.RETREATING) {
    ctx.fillStyle = `rgba(80, 80, 80, ${0.35 + 0.2 * Math.sin(t * 9)})`;
    ctx.beginPath(); ctx.arc(14 + Math.sin(t * 5) * 4, 10, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(22, 16, 12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
