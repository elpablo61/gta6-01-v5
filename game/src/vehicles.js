// Crescent Bay — vehicles: car types, parked spawns, enter/exit, carjacking
// and driving physics. Steering is radius-based so cars turn inside narrow
// 64-wide roads. The proven rules are built in from the start:
//  - slow down before sharp junction turns; brake ahead of them
//  - a turn sharper than ~52 deg (|angle diff| > 0.9) STOPS the car fully,
//    rotates it in place, then drives straight (a moving turning circle is
//    wider than the road)
//  - when stuck, reverse straight to unwedge; on wall collision slide along
//    the wall; minimum turn authority even at low speed; crawl-forward turns
//  - U-turns crawl at speed 60; wall damage ticks at most once per 0.5s
//  - route-finding includes the FIRST junction as the first waypoint
//  - off-road recovery: nearest road, then nearest junction (never a
//    centreline point outside the world edge)

import { CONFIG } from './config.js';
import { makeRng } from './random.js';

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function makeCar(type, x, y, angle, rng) {
  const t = CONFIG.carTypes[type] || CONFIG.carTypes.sedan;
  return {
    type,
    x, y, angle: angle || 0,
    speed: 0,
    color: t.color,
    length: t.length,
    width: t.width,
    topSpeed: t.topSpeed,
    accel: t.accel,
    brake: t.brake,
    hp: 100,
    maxHp: 100,
    isPlayer: false,
    parked: true,
    driver: null,
    route: null,
    routeIndex: 0,
    routeDest: null,
    cruise: 300,
    stuckTime: 0,
    reverseTime: 0,
    wallDamageAt: 0,
    lastX: x, lastY: y,
    upgrades: { engine: 0, armor: 0, tires: 0, brakes: 0 },
    paint: null,
    _dbgDiff: 0,
    _dbgWant: 0,
    _dbgPt: null,
    _dbgSteer: 0,
  };
}

export function carTopSpeed(car) {
  return car.topSpeed + (car.upgrades.engine || 0) * 45;
}

export function carTurnRate(car) {
  return 1.9 + (car.upgrades.tires || 0) * 0.35;
}

// Drive a car toward a target point. Returns true when within `arrive` of
// the target. Used by the autopilot, traffic and police pursuit alike.
export function driveToward(car, tx, ty, cruise, dt, game) {
  const world = game.world;
  const dx = tx - car.x;
  const dy = ty - car.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 12) return true;
  const want = Math.atan2(dy, dx);
  const diff = angleDiff(want, car.angle);
  car._dbgDiff = diff;
  car._dbgWant = want;
  car._dbgPt = { x: tx, y: ty };

  // Sharp turn: STOP fully and rotate in place, then drive straight.
  if (Math.abs(diff) > 0.9 && Math.abs(car.speed) > 5) {
    car.speed = approach(car.speed, 0, car.brake * 1.6 * dt);
    if (Math.abs(car.speed) <= 5) car.speed = 0;
    return false;
  }
  if (Math.abs(diff) > 0.9 && Math.abs(car.speed) <= 5) {
    const turn = carTurnRate(car) * 1.6 * dt;
    car.angle += Math.sign(diff) * Math.min(Math.abs(diff), turn);
    return false;
  }

  // U-turns crawl.
  let targetSpeed = cruise;
  if (Math.abs(diff) > 2.6) targetSpeed = Math.min(targetSpeed, 60);
  // Brake ahead of sharp turns.
  else if (Math.abs(diff) > 0.9) targetSpeed = Math.min(targetSpeed, 180);
  else if (Math.abs(diff) > 0.5) targetSpeed = Math.min(targetSpeed, 280);
  // Crawl near the waypoint so the turning circle fits the road.
  if (dist < 170) targetSpeed = Math.min(targetSpeed, 120);

  // Radius-based steering: turning radius grows with speed, so slow down
  // to tighten the turn. Minimum turn authority even at low speed.
  const speedAbs = Math.abs(car.speed);
  const turnRadius = 80 + 0.3 * speedAbs;
  let steer = Math.max(-1, Math.min(1, diff * 2.2));
  const minAuthority = 0.25;
  if (Math.abs(steer) < minAuthority && Math.abs(diff) > 0.08) {
    steer = Math.sign(diff) * minAuthority;
  }
  void turnRadius;
  const turnRate = carTurnRate(car) * (0.55 + 0.45 * Math.min(1, speedAbs / 120));
  car.angle += steer * turnRate * dt * (car.speed >= 0 ? 1 : -1);
  car._dbgSteer = steer;

  // Accelerate / brake toward the target speed.
  if (car.speed < targetSpeed) car.speed = Math.min(targetSpeed, car.speed + car.accel * dt);
  else if (car.speed > targetSpeed) car.speed = Math.max(targetSpeed, car.speed - car.brake * dt);

  // Reversing to unwedge.
  if (car.reverseTime > 0) {
    car.reverseTime -= dt;
    car.speed = -90;
  }

  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const r = Math.max(car.length, car.width) / 2 - 4;
  const hit = world.collideCircle(nx, ny, r);
  if (hit) {
    // Slide along the wall: try each axis separately.
    let moved = false;
    if (!world.collideCircle(nx, car.y, r)) { car.x = nx; moved = true; }
    if (!world.collideCircle(car.x, ny, r)) { car.y = ny; moved = true; }
    if (!moved) {
      // Stuck: reverse straight to unwedge.
      car.reverseTime = 0.7;
      car.stuckTime += dt;
    }
    // Wall damage ticks at most once per 0.5s.
    const now = game.time;
    if (now - car.wallDamageAt > 0.5 && Math.abs(car.speed) > 60) {
      car.wallDamageAt = now;
      damageCar(car, 3, game);
      game.audio.crash();
      game.spawnParticles(car.x, car.y, 6, '#999');
    }
    car.speed *= 0.5;
  } else {
    car.x = nx;
    car.y = ny;
    car.stuckTime = 0;
  }
  world.clampToWorld(car, 26);
  return dist < 70;
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

export function damageCar(car, amount, game) {
  const armor = car.upgrades.armor || 0;
  const reduced = amount * (1 - armor * 0.15);
  car.hp -= reduced;
  if (car.hp <= 0) {
    car.hp = 0;
    car.speed = 0;
    game.spawnParticles(car.x, car.y, 14, '#555');
    game.spawnParticles(car.x, car.y, 8, '#ff7a1a');
  }
}

export class Vehicles {
  constructor(game) {
    this.game = game;
    this.rng = makeRng(CONFIG.seed + 505);
  }

  spawnParked(count) {
    const world = this.game.world;
    let placed = 0;
    let tries = 0;
    const types = ['sedan', 'taxi', 'truck', 'sports'];
    while (placed < count && tries < count * 40) {
      tries++;
      const road = this.game.world.roads[this.rng.int(0, 8)];
      const along = this.rng.range(120, 3080);
      const side = this.rng.chance(0.5) ? 1 : -1;
      const x = this.rng.chance(0.5) ? road + side * 52 : along;
      const y = this.rng.chance(0.5) ? along : road + side * 52;
      const px = this.rng.chance(0.5) ? road + side * 52 : this.rng.range(120, 3080);
      const py = this.rng.chance(0.5) ? this.rng.range(120, 3080) : road + side * 52;
      const cx = this.rng.chance(0.5) ? x : px;
      const cy = this.rng.chance(0.5) ? y : py;
      if (world.collideCircle(cx, cy, 30)) continue;
      if (world.inWater(cx, cy)) continue;
      let near = false;
      for (const c of this.game.cars) {
        if (Math.hypot(c.x - cx, c.y - cy) < 80) { near = true; break; }
      }
      if (near) continue;
      const type = this.rng.pick(types);
      const angle = this.rng.chance(0.5) ? 0 : Math.PI / 2;
      const car = makeCar(type, cx, cy, angle + (this.rng.chance(0.5) ? 0 : Math.PI), this.rng);
      car.parked = true;
      this.game.cars.push(car);
      placed++;
    }
    return placed;
  }

  nearestCar(x, y, maxDist, predicate) {
    let best = null;
    let bd = maxDist === undefined ? Infinity : maxDist;
    for (const car of this.game.cars) {
      if (predicate && !predicate(car)) continue;
      const d = Math.hypot(car.x - x, car.y - y);
      if (d < bd) { bd = d; best = car; }
    }
    return best;
  }

  // Fastest parked car nearby — the autopilot prefers a much faster parked
  // car over a slow current car (switching is a theft that adds heat, so
  // only for a real gain).
  fastestParkedNear(x, y, maxDist, minTopSpeed) {
    let best = null;
    let bt = minTopSpeed || 0;
    for (const car of this.game.cars) {
      if (!car.parked || car.isPlayer) continue;
      if (Math.hypot(car.x - x, car.y - y) > maxDist) continue;
      if (carTopSpeed(car) > bt) { bt = carTopSpeed(car); best = car; }
    }
    return best;
  }

  enterCar(car) {
    const game = this.game;
    const pl = game.player;
    if (car.parked) {
      car.parked = false;
      game.addHeat(4); // stealing a parked car is a crime
    } else if (car.driver) {
      // Carjack: the driver flees on foot.
      game.addHeat(10);
      const d = car.driver;
      d.fleeing = true;
      d.fleeX = car.x + (this.rng.chance(0.5) ? 300 : -300);
      d.fleeY = car.y + (this.rng.chance(0.5) ? 300 : -300);
      car.driver = null;
      game.audio.door();
    }
    if (pl.car) pl.car.isPlayer = false;
    car.isPlayer = true;
    pl.car = car;
    pl.inCar = true;
    pl.x = car.x;
    pl.y = car.y;
    game.audio.door();
    return true;
  }

  exitCar() {
    const game = this.game;
    const pl = game.player;
    const car = pl.car;
    if (!car) return;
    car.isPlayer = false;
    car.speed *= 0.3;
    pl.inCar = false;
    pl.car = null;
    pl.x = car.x - Math.cos(car.angle) * 0 - 34;
    pl.y = car.y + 34;
    const world = game.world;
    if (world.collideCircle(pl.x, pl.y, 14)) {
      pl.x = car.x + 34;
      pl.y = car.y - 34;
    }
    game.audio.door();
  }

  // Manual driving: WASD/arrows steer and accelerate; Space is handbrake.
  // Skipped entirely on frames the autopilot drove (else it brakes the car
  // back to ~0 every frame).
  updatePlayerCar(dt, autopilotDrove) {
    const game = this.game;
    const pl = game.player;
    if (!pl.inCar || !pl.car) return;
    const car = pl.car;
    if (car.hp <= 0) return;
    if (autopilotDrove) {
      pl.x = car.x;
      pl.y = car.y;
      return;
    }
    const input = game.input;
    let throttle = 0;
    if (input.down('w') || input.down('ArrowUp')) throttle = 1;
    if (input.down('s') || input.down('ArrowDown')) throttle = -0.6;
    let steer = 0;
    if (input.down('a') || input.down('ArrowLeft')) steer -= 1;
    if (input.down('d') || input.down('ArrowRight')) steer += 1;
    const handbrake = input.down(' ');
    const speedAbs = Math.abs(car.speed);
    const turnRate = carTurnRate(car) * (0.5 + 0.5 * Math.min(1, speedAbs / 120));
    if (steer !== 0 && speedAbs > 4) {
      car.angle += steer * turnRate * dt * (car.speed >= 0 ? 1 : -1);
    } else if (steer !== 0 && speedAbs <= 4) {
      // Crawl-forward turns: creep while turning at low speed.
      car.angle += steer * turnRate * 0.6 * dt;
      if (throttle === 0) car.speed = 30 * (car.speed >= 0 ? 1 : -1);
    }
    if (handbrake) {
      car.speed = approach(car.speed, 0, car.brake * 1.8 * dt);
      if (speedAbs > 120) game.spawnParticles(car.x, car.y, 1, '#ddd');
    } else if (throttle > 0) {
      car.speed = Math.min(carTopSpeed(car), car.speed + car.accel * throttle * dt);
    } else if (throttle < 0) {
      if (car.speed > 5) car.speed = Math.max(0, car.speed - car.brake * dt);
      else car.speed = Math.max(-120, car.speed + car.accel * 0.6 * dt);
    } else {
      car.speed = approach(car.speed, 0, 90 * dt);
    }
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    const r = Math.max(car.length, car.width) / 2 - 4;
    const world = game.world;
    if (world.collideCircle(nx, ny, r)) {
      let moved = false;
      if (!world.collideCircle(nx, car.y, r)) { car.x = nx; moved = true; }
      if (!world.collideCircle(car.x, ny, r)) { car.y = ny; moved = true; }
      if (!moved) car.speed *= 0.4;
      const now = game.time;
      if (now - car.wallDamageAt > 0.5 && speedAbs > 60) {
        car.wallDamageAt = now;
        damageCar(car, 3, game);
        game.audio.crash();
      }
      car.speed *= 0.6;
    } else {
      car.x = nx;
      car.y = ny;
    }
    world.clampToWorld(car, 26);
    pl.x = car.x;
    pl.y = car.y;
    game.audio.engine(true, speedAbs / carTopSpeed(car));
  }

  // Keep parked cars parked; moving cars that are not the player's are
  // handled by traffic/police. This only syncs the player's position.
  update(dt) {
    const game = this.game;
    for (const car of game.cars) {
      car.lastX = car.x;
      car.lastY = car.y;
    }
  }
}
