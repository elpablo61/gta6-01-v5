// Crescent Bay — pedestrians: they walk the sidewalks beside the roads,
// sometimes in pairs, and flee when scared (a gunshot nearby, or a car
// speeding close past them).

import { CONFIG } from './config.js';
import { makeRng } from './random.js';

const PED_COLORS = ['#e07a5f', '#81b29a', '#f2cc8f', '#6d9dc5', '#c77dff', '#e8e8e8', '#f4845f', '#90be6d'];

export class Pedestrians {
  constructor(game) {
    this.game = game;
    this.rng = makeRng(CONFIG.seed + 909);
    this.spawnTimer = 0;
  }

  spawn(count) {
    const world = this.game.world;
    const pl = this.game.player;
    let placed = 0;
    let tries = 0;
    while (placed < count && tries < count * 30) {
      tries++;
      const road = world.roads[this.rng.int(0, 8)];
      const along = this.rng.range(120, 3080);
      const side = this.rng.chance(0.5) ? 44 : -44;
      const horizontal = this.rng.chance(0.5);
      const x = horizontal ? along : road + side;
      const y = horizontal ? road + side : along;
      if (Math.hypot(x - pl.x, y - pl.y) < 250) continue;
      if (world.collideCircle(x, y, 16)) continue;
      if (world.inWater(x, y)) continue;
      const ped = this._makePed(x, y);
      this.game.peds.push(ped);
      placed++;
      // Sometimes a pair walks together.
      if (this.rng.chance(0.25) && placed < count) {
        const mate = this._makePed(x + 16, y + 8);
        mate.pairWith = ped;
        ped.pairWith = mate;
        this.game.peds.push(mate);
        placed++;
      }
    }
    return placed;
  }

  _makePed(x, y) {
    return {
      x, y,
      angle: this.rng.range(0, Math.PI * 2),
      speed: this.rng.range(35, 75),
      color: this.rng.pick(PED_COLORS),
      fleeing: false,
      fleeX: 0, fleeY: 0,
      scaredAt: 0,
      targetX: x, targetY: y,
      pairWith: null,
      walkPhase: this.rng.range(0, Math.PI * 2),
    };
  }

  scare(x, y, radius) {
    for (const ped of this.game.peds) {
      const d = Math.hypot(ped.x - x, ped.y - y);
      if (d < radius) {
        ped.fleeing = true;
        ped.scaredAt = this.game.time;
        const away = Math.atan2(ped.y - y, ped.x - x);
        ped.fleeX = ped.x + Math.cos(away) * 320;
        ped.fleeY = ped.y + Math.sin(away) * 320;
      }
    }
  }

  update(dt) {
    const game = this.game;
    const pl = game.player;
    this.spawnTimer -= dt;
    if (game.peds.length < CONFIG.maxPedestrians && this.spawnTimer <= 0) {
      this.spawn(2);
      this.spawnTimer = 1.2;
    }
    for (const ped of [...game.peds]) {
      if (Math.hypot(ped.x - pl.x, ped.y - pl.y) > 1300) {
        game.peds.splice(game.peds.indexOf(ped), 1);
        continue;
      }
      // A speeding car nearby scares pedestrians.
      if (!ped.fleeing) {
        for (const car of game.cars) {
          if (Math.abs(car.speed) > 200 && Math.hypot(car.x - ped.x, car.y - ped.y) < 90) {
            this.scare(car.x, car.y, 120);
            break;
          }
        }
      }
      if (ped.fleeing) {
        if (game.time - ped.scaredAt > 4) ped.fleeing = false;
      }
      let tx;
      let ty;
      let spd;
      if (ped.fleeing) {
        tx = ped.fleeX;
        ty = ped.fleeY;
        spd = ped.speed * 2.6;
      } else {
        // Stroll along the sidewalk: pick a new nearby road point when the
        // current target is reached.
        if (Math.hypot(ped.targetX - ped.x, ped.targetY - ped.y) < 20) {
          const near = game.world.nearestRoadPoint(ped.x, ped.y);
          const dir = this.rng.chance(0.5) ? 1 : -1;
          const alongRoad = game.world._onRoad(ped.x, ped.y, 70);
          void alongRoad;
          ped.targetX = near.x + this.rng.range(-160, 160) * dir;
          ped.targetY = near.y + this.rng.range(-160, 160);
          const rp = game.world.nearestRoadPoint(ped.targetX, ped.targetY);
          ped.targetX = rp.x + (this.rng.chance(0.5) ? 44 : -44);
          ped.targetY = rp.y + (this.rng.chance(0.5) ? 44 : -44);
        }
        tx = ped.targetX;
        ty = ped.targetY;
        spd = ped.speed;
      }
      const dx = tx - ped.x;
      const dy = ty - ped.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) {
        const want = Math.atan2(dy, dx);
        let diff = want - ped.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        ped.angle += Math.max(-3 * dt, Math.min(3 * dt, diff));
        const nx = ped.x + Math.cos(ped.angle) * spd * dt;
        const ny = ped.y + Math.sin(ped.angle) * spd * dt;
        if (!game.world.collideCircle(nx, ped.y, 10)) ped.x = nx;
        if (!game.world.collideCircle(ped.x, ny, 10)) ped.y = ny;
        game.world.clampToWorld(ped, 14);
      }
    }
  }
}
