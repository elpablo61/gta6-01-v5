// autopilot.js — autopilot driver for Crescent Bay (gta6-01 v5).
// First declaration: the autopilot state is the contract main.js reads
// (game.autopilot.enabled) and the playtest harness drives.
// Behaviour (spec §4 + §9): the autopilot runs BEFORE the dialog branch
// so it can press E to accept a mission. On foot it follows the road
// graph to the nearest road point, then the last leg on foot; it
// memoizes its walk target (recompute only when the target moves >120).
// It leaves a slow car for a much faster parked car nearby (only if
// current top speed <350 for go-to / <430 for chase and a faster parked
// car is within 200/320 — switching cars is a theft that adds heat, so
// never switch for a marginal gain). Chase: cruise 520 vs courier 380,
// ram hit within 70 at speed >120, each hit cuts the courier's cruise
// to 55%. Escape: drive to the Spray Shop. Shootout: walk straight to
// the nearest enemy until in range, shoot in aimed bursts every 0.45s
// (never spray), pick up arena ammo at ammo ≤6, pick up a better weapon
// crate when one is in the arena (m10). Garage (m11): drive to the
// Fixer Garage, open the menu, buy the cheapest available upgrade,
// close, continue to the checkpoints. Helicopter (m9/m12): ignore it
// except by never stopping under the spotlight — keep driving toward
// the objective. Mission fail restarts from the mission's stage 0.
// Anti-freeze (spec §9.1): the on-foot car search falls back to
// walking to the courier's nearest road point if no car is found within
// range (never walk at a moving target forever).

import { CONFIG } from './config.js';

export const AUTOPILOT_DEFS = {
  walkSpeed: 170,
  sprintSpeed: 260,
  goToCruise: 420,
  chaseCruise: 520,
  slowCarTopSpeed: 350,   // go-to: switch only below this
  chaseSlowTopSpeed: 430, // chase: switch only below this
  fastCarNear: 200,       // go-to swap radius
  chaseFastCarNear: 320,  // chase swap radius
  waypointAccept: 70,
  shootRange: 300,        // walk to this distance, then shoot
  burstInterval: 0.45,    // aimed bursts, never spray
  lowAmmo: 6,             // grab arena ammo at or below this
  walkTargetRecalc: 120,  // memoize walk target until it moves >120
};

export function createAutopilotState() {
  return {
    enabled: false,
    route: null,          // current road-graph route (waypoints)
    routeDest: null,      // destination the route was built for
    routeIndex: 0,
    walkTarget: null,     // memoized on-foot target
    walkTargetFor: null,  // the goal the walk target was built for
    lastShotAt: -99,
    stuckTimer: 0,
    lastPos: null,
    reverseTimer: 0,
    mode: 'idle',         // idle | goto | chase | escape | shootout | garage
  };
}

export function ensureAutopilot(game) {
  if (!game.autopilot) game.autopilot = createAutopilotState();
  return game.autopilot;
}

function now(game) {
  if (typeof game.time === 'number') return game.time;
  if (game.time && typeof game.time.now === 'number') return game.time.now;
  return 0;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Route to a target, rebuilt only when the target moved >100 from the
// route's recorded destination (never every frame).
export function routeTo(game, tx, ty) {
  const auto = ensureAutopilot(game);
  const world = game.world;
  const p = game.player;
  if (!world || !p) return [{ x: tx, y: ty }];
  const fromX = p.inCar && p.car ? p.car.x : p.x;
  const fromY = p.inCar && p.car ? p.car.y : p.y;
  if (!auto.route || !auto.routeDest
    || Math.hypot(tx - auto.routeDest.x, ty - auto.routeDest.y) > 100) {
    auto.route = world.findRoute(fromX, fromY, tx, ty);
    auto.routeDest = { x: tx, y: ty };
    auto.routeIndex = 0;
  }
  return auto.route;
}

// Drive a car toward a target point. Steering is radius-based with the
// proven rules: stop fully and rotate in place for turns sharper than
// ~52° (|diff| > 0.9), slow before sharp turns, reverse straight to
// unwedge when stuck, slide along walls via world.resolveCircle.
export function driveCarToward(game, car, tx, ty, cruise, dt) {
  const world = game.world;
  const auto = ensureAutopilot(game);
  const route = routeTo(game, tx, ty);
  let target = { x: tx, y: ty };
  // Follow route waypoints; the final leg goes straight to the exact
  // target (static landmarks only — never for the moving courier).
  const isMovingTarget = game.mission && game.mission.id === 'm2'
    && game.courier && Math.hypot(tx - game.courier.x, ty - game.courier.y) < 5;
  if (route && route.length > 0) {
    const wp = route[Math.min(auto.routeIndex, route.length - 1)];
    const dWp = Math.hypot(wp.x - car.x, wp.y - car.y);
    if (dWp < AUTOPILOT_DEFS.waypointAccept) {
      auto.routeIndex += 1;
      if (auto.routeIndex >= route.length) {
        target = isMovingTarget ? { x: tx, y: ty } : { x: tx, y: ty };
      }
    } else {
      target = wp;
    }
    if (auto.routeIndex >= route.length && !isMovingTarget) target = { x: tx, y: ty };
  }
  const dx = target.x - car.x, dy = target.y - car.y;
  const dist = Math.hypot(dx, dy);
  const want = Math.atan2(dy, dx);
  const diff = angleDiff(want, car.angle);
  const speed = Math.abs(car.speed || 0);

  // Stuck detection: barely moving while trying to drive → reverse.
  if (auto.lastPos) {
    const moved = Math.hypot(car.x - auto.lastPos.x, car.y - auto.lastPos.y);
    auto.stuckTimer = moved < 6 * dt + 0.5 && speed < 30 ? auto.stuckTimer + dt : 0;
  }
  auto.lastPos = { x: car.x, y: car.y };
  if (auto.stuckTimer > 1.2) {
    auto.reverseTimer = 0.8;
    auto.stuckTimer = 0;
  }
  if (auto.reverseTimer > 0) {
    auto.reverseTimer -= dt;
    car.speed = -90;
    car.x -= Math.cos(car.angle) * 90 * dt;
    car.y -= Math.sin(car.angle) * 90 * dt;
    return dist;
  }

  if (Math.abs(diff) > 0.9) {
    // Sharp turn: stop fully, rotate in place, then drive straight.
    car.speed = 0;
    car.angle += Math.max(-2.6 * dt, Math.min(2.6 * dt, diff));
    return dist;
  }
  // Slow before sharp junction turns.
  const turnSlow = Math.abs(diff) > 0.5 ? 0.55 : 1;
  const targetSpeed = Math.min(cruise, (car.topSpeed || cruise)) * turnSlow;
  // Crawl-forward turns at low speed keep turn authority.
  const accel = car.accel || 300;
  if (speed < targetSpeed) car.speed = Math.min(targetSpeed, speed + accel * dt);
  else car.speed = Math.max(targetSpeed, speed - (car.brake || 500) * dt * (car.brakeBonus || 1));
  car.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff)) * (0.5 + 0.5 * Math.min(1, speed / 120 + 0.2));
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  if (world) {
    world.resolveCircle(car, 24);
    world.clampToWorld(car, 24);
  }
  return dist;
}

// Walk on foot toward a target: road graph to the nearest road point,
// then the last leg on foot. Walk target is memoized (recompute only
// when the target moves >120).
export function walkToward(game, tx, ty, dt) {
  const auto = ensureAutopilot(game);
  const world = game.world;
  const p = game.player;
  if (!p) return Infinity;
  const goalMoved = !auto.walkTargetFor
    || Math.hypot(tx - auto.walkTargetFor.x, ty - auto.walkTargetFor.y) > AUTOPILOT_DEFS.walkTargetRecalc;
  if (goalMoved || !auto.walkTarget) {
    auto.walkTargetFor = { x: tx, y: ty };
    if (world) {
      const rp = world.nearestRoadPoint(tx, ty);
      auto.walkTarget = rp;
    } else {
      auto.walkTarget = { x: tx, y: ty };
    }
  }
  let leg = auto.walkTarget;
  const dRoad = Math.hypot(leg.x - p.x, leg.y - p.y);
  if (dRoad < 30) leg = { x: tx, y: ty }; // final leg on foot
  const dx = leg.x - p.x, dy = leg.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 4) return Math.hypot(tx - p.x, ty - p.y);
  const speed = d > 200 ? AUTOPILOT_DEFS.sprintSpeed : AUTOPILOT_DEFS.walkSpeed;
  p.x += (dx / d) * speed * dt;
  p.y += (dy / d) * speed * dt;
  p.aim = Math.atan2(dy, dx);
  if (world) world.resolveCircle(p, 14);
  return Math.hypot(tx - p.x, ty - p.y);
}

// Find a much faster parked car nearby. Returns the car or null.
export function fasterParkedCarNearby(game, maxDist, minTopSpeed) {
  const p = game.player;
  const cars = game.cars || [];
  let best = null, bestD = Infinity;
  const px = p.inCar && p.car ? p.car.x : p.x;
  const py = p.inCar && p.car ? p.car.y : p.y;
  for (const c of cars) {
    if (c.isPlayer || c === p.car || c.type === 'police') continue;
    if (c.parked === false) continue; // only parked cars can be taken cleanly
    const top = c.topSpeed || 0;
    if (top < minTopSpeed) continue;
    const d = Math.hypot(c.x - px, c.y - py);
    if (d < maxDist && d < bestD) { bestD = d; best = c; }
  }
  return best ? { car: best, dist: bestD } : null;
}

export function enterCar(game, car) {
  const p = game.player;
  if (!p || !car) return false;
  p.inCar = true;
  p.car = car;
  car.isPlayer = true;
  car.parked = false;
  p.x = car.x; p.y = car.y;
  if (game.applyUpgradesToCar && game.garage) {
    const up = game.garage.cars ? game.garage.cars[car.id] : null;
    if (up) game.applyUpgradesToCar(car, up);
  }
  if (game.audio && game.audio.door) game.audio.door();
  return true;
}

export function exitCar(game) {
  const p = game.player;
  if (!p || !p.car) return false;
  const car = p.car;
  car.isPlayer = false;
  p.inCar = false;
  p.car = null;
  p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 30;
  p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 30;
  return true;
}

// On-foot car search with the §9.1b fallback: if no car is found within
// range, walk to the target's nearest road point (never walk at a moving
// target forever).
export function goToOnFoot(game, tx, ty, dt, chase) {
  const p = game.player;
  const auto = ensureAutopilot(game);
  const cars = game.cars || [];
  // Nearest parked car of any kind.
  let best = null, bestD = Infinity;
  for (const c of cars) {
    if (c.isPlayer || c.type === 'police' || c.parked === false) continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best && bestD < 40) { enterCar(game, best); return 'driving'; }
  if (best && bestD < 320) {
    walkToward(game, best.x, best.y, dt);
    return 'walking-to-car';
  }
  // Fallback: no car nearby — walk to the target's nearest road point.
  const world = game.world;
  const rp = world ? world.nearestRoadPoint(tx, ty) : { x: tx, y: ty };
  walkToward(game, rp.x, rp.y, dt);
  return 'walking-to-target';
}

// Shootout behaviour: walk straight to the nearest enemy until in
// range, shoot in aimed bursts every 0.45s, pick up arena ammo at ≤6,
// pick up a better weapon crate when one is in the arena (m10).
export function shootoutStep(game, dt) {
  const p = game.player;
  const auto = ensureAutopilot(game);
  const t = now(game);
  const nearest = game.nearestEnemy ? game.nearestEnemy(game) : null;
  // Low ammo: go to the nearest arena ammo pickup first.
  const ammo = game.weapons ? game.weapons.ammo[game.weapons.current] : 99;
  if (ammo <= AUTOPILOT_DEFS.lowAmmo) {
    const pickups = game.ammoPickups || [];
    let best = null, bestD = Infinity;
    for (const a of pickups) {
      if (a.taken) continue;
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) { walkToward(game, best.x, best.y, dt); return 'ammo'; }
  }
  // m10: pick up a better weapon crate in the arena before engaging.
  if (game.mission && game.mission.id === 'm10' && game.weapons && !game.weapons.owned.smg) {
    const crates = (game.crates || []).filter((c) => !c.taken);
    let best = null, bestD = Infinity;
    for (const c of crates) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) { walkToward(game, best.x, best.y, dt); return 'crate'; }
  }
  if (!nearest) return 'clear';
  const { enemy, dist } = nearest;
  const aim = Math.atan2(enemy.y - p.y, enemy.x - p.x);
  p.aim = aim;
  if (dist > AUTOPILOT_DEFS.shootRange) {
    walkToward(game, enemy.x, enemy.y, dt);
  }
  if (dist < 420 && t - auto.lastShotAt >= AUTOPILOT_DEFS.burstInterval) {
    auto.lastShotAt = t;
    if (game.tryFire) game.tryFire(game, aim);
  }
  return 'fighting';
}

// The main autopilot step. Call BEFORE the dialog branch each frame
// (so it can press E to accept), and skip manual driving on frames it
// drove. Returns a short status string for the playtest log.
export function updateAutopilot(game, dt) {
  const auto = ensureAutopilot(game);
  if (!auto.enabled) return 'off';
  const p = game.player;
  if (!p) return 'no-player';
  const m = game.mission || {};

  // 1. Dialog first: accept the mission before any car search (§9.1a).
  if (m.dialogOpen) {
    if (game.acceptDialog) game.acceptDialog(game);
    return 'accepted-dialog';
  }
  if (!m.active) {
    if (game.offerMission) game.offerMission(game);
    return 'offering';
  }

  const target = game.objectiveTarget || (game.missionTarget ? game.missionTarget(game) : null);
  const isChase = m.id === 'm2';
  const isShootout = (m.id === 'm8' || m.id === 'm10' || m.id === 'm12') && m.stage === 0;
  const isGarage = m.id === 'm11' && m.stage === 0;

  // 2. Garage menu open: buy the cheapest upgrade, close, continue.
  if (game.garage && game.garage.open) {
    const cheapest = game.cheapestUpgrade ? game.cheapestUpgrade(game, p.car) : null;
    if (cheapest && game.buyUpgrade) game.buyUpgrade(game, cheapest.kind);
    if (game.closeGarageMenu) game.closeGarageMenu(game);
    return 'garage-bought';
  }

  // 3. Shootout: on foot, fight.
  if (isShootout) {
    if (p.inCar) exitCar(game);
    return shootoutStep(game, dt);
  }

  // 4. Garage stage: drive there, open the menu.
  if (isGarage && target) {
    if (!p.inCar) {
      const r = goToOnFoot(game, target.x, target.y, dt, false);
      return r;
    }
    const d = driveCarToward(game, p.car, target.x, target.y, AUTOPILOT_DEFS.goToCruise, dt);
    if (d < CONFIG.garage.radius * 0.8) {
      if (game.openGarageMenu) game.openGarageMenu(game);
      return 'garage-open';
    }
    return 'driving-garage';
  }

  // 5. Driving / walking to the objective.
  if (!target) return 'no-target';
  if (!p.inCar) {
    return goToOnFoot(game, target.x, target.y, dt, isChase);
  }
  // In a car: swap for a much faster parked car nearby, only if the
  // current car is slow (theft adds heat — never for a marginal gain).
  const slowTop = isChase ? AUTOPILOT_DEFS.chaseSlowTopSpeed : AUTOPILOT_DEFS.slowCarTopSpeed;
  const nearDist = isChase ? AUTOPILOT_DEFS.chaseFastCarNear : AUTOPILOT_DEFS.fastCarNear;
  const currentTop = p.car.topSpeed || 0;
  if (currentTop < slowTop) {
    const faster = fasterParkedCarNearby(game, nearDist, currentTop + 60);
    if (faster) {
      exitCar(game);
      return 'swapping-car';
    }
  }
  const cruise = isChase ? AUTOPILOT_DEFS.chaseCruise : AUTOPILOT_DEFS.goToCruise;
  driveCarToward(game, p.car, target.x, target.y, cruise, dt);
  return isChase ? 'chasing' : 'driving';
}
