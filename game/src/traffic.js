// Crescent Bay — traffic: cars that follow the road graph, slow behind the
// car ahead, and turn at junctions. Traffic cars use the same radius-based
// driving as the player (stop-and-rotate for sharp turns) so they never
// strand themselves in the 64-wide roads.

import { CONFIG } from './config.js';
import { makeRng } from './random.js';
import { makeCar, driveToward, angleDiff } from './vehicles.js';

export class Traffic {
  constructor(game) {
    this.game = game;
    this.rng = makeRng(CONFIG.seed + 707);
    this.spawnTimer = 0;
  }

  spawn(count) {
    const world = this.game.world;
    const pl = this.game.player;
    let placed = 0;
    let tries = 0;
    const types = ['sedan', 'taxi', 'truck', 'sedan', 'taxi'];
    while (placed < count && tries < count * 30) {
      tries++;
      const road = world.roads[this.rng.int(0, 8)];
      const along = this.rng.range(150, 3050);
      const horizontal = this.rng.chance(0.5);
      const x = horizontal ? along : road;
      const y = horizontal ? road : along;
      if (Math.hypot(x - pl.x, y - pl.y) < 300) continue;
      if (world.collideCircle(x, y, 30)) continue;
      let near = false;
      for (const c of this.game.cars) {
        if (Math.hypot(c.x - x, c.y - y) < 90) { near = true; break; }
      }
      if (near) continue;
      const car = makeCar(this.rng.pick(types), x, y, horizontal ? (this.rng.chance(0.5) ? 0 : Math.PI) : (this.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2), this.rng);
      car.parked = false;
      car.cruise = this.rng.range(200, 300);
      car.driver = { fleeing: false };
      this._pickDestination(car);
      this.game.cars.push(car);
      placed++;
    }
    return placed;
  }

  _pickDestination(car) {
    const world = this.game.world;
    const dest = {
      x: world.roads[this.rng.int(0, 8)],
      y: world.roads[this.rng.int(0, 8)],
    };
    car.routeDest = dest;
    car.route = world.findRoute(car.x, car.y, dest.x, dest.y);
    car.routeIndex = 0;
  }

  _carAhead(car) {
    let best = null;
    let bd = 110;
    for (const other of this.game.cars) {
      if (other === car) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const along = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
      const side = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
      if (along > 0 && along < bd && side < 30) { bd = along; best = other; }
    }
    return best;
  }

  update(dt) {
    const game = this.game;
    const pl = game.player;
    this.spawnTimer -= dt;
    // Keep traffic near the player: spawn when thin, despawn when far.
    const trafficCars = game.cars.filter((c) => !c.parked && !c.isPlayer && !c.isPolice);
    if (trafficCars.length < CONFIG.maxTraffic - 4 && this.spawnTimer <= 0) {
      this.spawn(2);
      this.spawnTimer = 1.5;
    }
    for (const car of [...game.cars]) {
      if (car.parked || car.isPlayer || car.isPolice) continue;
      if (car.hp <= 0) continue;
      // Despawn far away, respawn near the player later.
      if (Math.hypot(car.x - pl.x, car.y - pl.y) > 1400) {
        const idx = game.cars.indexOf(car);
        if (idx >= 0) game.cars.splice(idx, 1);
        continue;
      }
      // Route finished or destination moved: pick a new destination.
      if (!car.route || car.routeIndex >= car.route.length) {
        this._pickDestination(car);
      }
      // Slow behind the car ahead.
      const ahead = this._carAhead(car);
      let cruise = car.cruise;
      if (ahead) {
        const gap = Math.hypot(ahead.x - car.x, ahead.y - car.y);
        cruise = Math.min(cruise, Math.max(0, (gap - 55) * 2.2));
        if (gap < 52) cruise = 0;
      }
      const wp = car.route[car.routeIndex];
      if (!wp) continue;
      const arrived = driveToward(car, wp.x, wp.y, cruise, dt, game);
      if (arrived || Math.hypot(wp.x - car.x, wp.y - car.y) < 70) car.routeIndex++;
      // Separation: never pile onto another car.
      for (const other of game.cars) {
        if (other === car || other.isPlayer) continue;
        const dx = car.x - other.x;
        const dy = car.y - other.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01 && d < 46) {
          const push = (46 - d) / 2;
          car.x += (dx / d) * push;
          car.y += (dy / d) * push;
        }
      }
    }
    void angleDiff;
  }
}
