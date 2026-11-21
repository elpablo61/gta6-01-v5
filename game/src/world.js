// Crescent Bay — the city: road grid, junction graph, districts, buildings,
// beach and water. Deterministic from the world seed. Routes are found by
// BFS on the junction graph, and the route always includes the FIRST
// junction as its first waypoint (never cut diagonally across a block).

import { CONFIG, roadPositions, districtAt } from './config.js';
import { makeRng } from './random.js';

export class World {
  constructor(seed) {
    this.seed = seed === undefined ? CONFIG.seed : seed;
    this.size = CONFIG.worldSize;
    this.roads = roadPositions();
    this.roadWidth = CONFIG.roadWidth;
    this.rng = makeRng(this.seed);
    this.junctions = [];
    for (const y of this.roads) {
      for (const x of this.roads) this.junctions.push({ x, y });
    }
    this.buildings = this._genBuildings();
    this.trees = this._genTrees();
    this.parks = this._genParks();
    this.beachX = 3060;
    this.marina = { x: 2900, y: 2200 };
    this.pier = { x: 3060, y: 2200, w: 120, h: 26 };
  }

  _onRoad(x, y, margin) {
    const m = (margin === undefined ? this.roadWidth / 2 : margin);
    for (const r of this.roads) {
      if (Math.abs(x - r) <= m) return true;
      if (Math.abs(y - r) <= m) return true;
    }
    return false;
  }

  isOnRoad(x, y) {
    return this._onRoad(x, y, this.roadWidth / 2 + 10);
  }

  _genBuildings() {
    const out = [];
    const rng = makeRng(this.seed + 101);
    const gap = CONFIG.roadGap;
    const half = this.roadWidth / 2 + 18;
    for (let by = 0; by < 8; by++) {
      for (let bx = 0; bx < 8; bx++) {
        const x0 = this.roads[bx] + half;
        const y0 = this.roads[by] + half;
        const x1 = (bx + 1 < 8 ? this.roads[bx + 1] : this.size) - half;
        const y1 = (by + 1 < 8 ? this.roads[by + 1] : this.size) - half;
        if (x1 - x0 < 90 || y1 - y0 < 90) continue;
        // Beach strip: no buildings east of the beach line.
        if (x0 > this.beachX - 60) continue;
        const district = districtAt((x0 + x1) / 2, (y0 + y1) / 2);
        const count = district.style === 'glass' ? 1 : rng.int(1, 4);
        for (let i = 0; i < count; i++) {
          const w = district.style === 'glass' ? rng.range(90, 130) : rng.range(60, 110);
          const h = district.style === 'glass' ? rng.range(90, 130) : rng.range(60, 110);
          const px = rng.range(x0 + 8, Math.max(x0 + 9, x1 - w - 8));
          const py = rng.range(y0 + 8, Math.max(y0 + 9, y1 - h - 8));
          if (px + w > this.beachX - 10) continue;
          const height = district.style === 'glass' ? rng.range(46, 90)
            : district.style === 'industrial' ? rng.range(10, 22)
            : rng.range(12, 34);
          out.push({
            x: px, y: py, w, h, height, district: district.style,
            color: this._buildingColor(district.style, rng),
            roof: this._roofColor(district.style, rng),
          });
        }
      }
    }
    return out;
  }

  _buildingColor(style, rng) {
    if (style === 'glass') return rng.pick(['#7fa8c9', '#6b93b8', '#8fb4d4', '#5d84a8']);
    if (style === 'brick') return rng.pick(['#a85b42', '#96503a', '#b06a4e', '#8f4a38']);
    if (style === 'sand') return rng.pick(['#e0c9a0', '#d9bd8f', '#e8d5b0', '#cdb287']);
    if (style === 'industrial') return rng.pick(['#7d838c', '#6b7178', '#8a7f74', '#5f6a72']);
    return rng.pick(['#c9a184', '#b98f6e', '#d4b89a', '#a8b5c4', '#c2a878']);
  }

  _roofColor(style, rng) {
    if (style === 'glass') return rng.pick(['#4a6b8a', '#3f5f7d', '#557a99']);
    if (style === 'brick') return rng.pick(['#7a3f2c', '#6e3826', '#854832']);
    return rng.pick(['#8a7a5e', '#7d6e52', '#93795a', '#6b7d8a']);
  }

  _genTrees() {
    const out = [];
    const rng = makeRng(this.seed + 202);
    for (let i = 0; i < 160; i++) {
      const x = rng.range(80, this.size - 80);
      const y = rng.range(80, this.size - 80);
      if (this._onRoad(x, y, 60)) continue;
      if (x > this.beachX - 40) continue;
      if (this._insideBuilding(x, y)) continue;
      out.push({ x, y, r: rng.range(7, 12) });
    }
    return out;
  }

  _genParks() {
    const out = [];
    const rng = makeRng(this.seed + 303);
    for (let i = 0; i < 10; i++) {
      const bx = rng.int(0, 7);
      const by = rng.int(0, 7);
      const x0 = this.roads[bx] + this.roadWidth / 2 + 20;
      const y0 = this.roads[by] + this.roadWidth / 2 + 20;
      const w = rng.range(120, 200);
      const h = rng.range(120, 200);
      if (x0 + w > this.beachX - 20) continue;
      out.push({ x: x0, y: y0, w, h });
    }
    return out;
  }

  _insideBuilding(x, y) {
    for (const b of this.buildings) {
      if (x > b.x - 4 && x < b.x + b.w + 4 && y > b.y - 4 && y < b.y + b.h + 4) return b;
    }
    return null;
  }

  // Circle (player / car) vs buildings: returns the building hit, or null.
  // Cars slide along walls: callers push the circle out along the smallest
  // penetration axis instead of stopping dead.
  collideCircle(x, y, r) {
    for (const b of this.buildings) {
      const cx = Math.max(b.x, Math.min(x, b.x + b.w));
      const cy = Math.max(b.y, Math.min(y, b.y + b.h));
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < r * r) return b;
    }
    return null;
  }

  // Push a circle out of a building along the smallest axis; returns true
  // if a push happened. Used for sliding along walls.
  resolveCircle(pos, r) {
    const b = this.collideCircle(pos.x, pos.y, r);
    if (!b) return false;
    const left = pos.x - (b.x - r);
    const right = b.x + b.w + r - pos.x;
    const top = pos.y - (b.y - r);
    const bottom = b.y + b.h + r - pos.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) pos.x = b.x - r;
    else if (m === right) pos.x = b.x + b.w + r;
    else if (m === top) pos.y = b.y - r;
    else pos.y = b.y + b.h + r;
    return true;
  }

  nearestJunction(x, y) {
    let best = this.junctions[0];
    let bd = Infinity;
    for (const j of this.junctions) {
      const d = (j.x - x) * (j.x - x) + (j.y - y) * (j.y - y);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  nearestRoadPoint(x, y) {
    // Closest point on the road centrelines.
    let bestX = x;
    let bestY = y;
    let bd = Infinity;
    for (const r of this.roads) {
      const d1 = Math.abs(y - r);
      if (d1 < bd) { bd = d1; bestX = x; bestY = r; }
      const d2 = Math.abs(x - r);
      if (d2 < bd) { bd = d2; bestX = r; bestY = y; }
    }
    return { x: bestX, y: bestY };
  }

  // BFS on the junction graph. The returned route always starts with the
  // junction nearest the start point, so a car never cuts diagonally
  // across a block to the second junction.
  findRoute(fromX, fromY, toX, toY) {
    const start = this.nearestJunction(fromX, fromY);
    const goal = this.nearestJunction(toX, toY);
    const key = (j) => `${j.x},${j.y}`;
    if (key(start) === key(goal)) return [{ x: start.x, y: start.y }];
    const prev = new Map();
    const seen = new Set([key(start)]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift();
      // Neighbours: same row or same column, adjacent road index.
      const xi = this.roads.indexOf(cur.x);
      const yi = this.roads.indexOf(cur.y);
      const neighbours = [];
      if (xi > 0) neighbours.push({ x: this.roads[xi - 1], y: cur.y });
      if (xi < 7) neighbours.push({ x: this.roads[xi + 1], y: cur.y });
      if (yi > 0) neighbours.push({ x: cur.x, y: this.roads[yi - 1] });
      if (yi < 7) neighbours.push({ x: cur.x, y: this.roads[yi + 1] });
      for (const nb of neighbours) {
        const k = key(nb);
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, cur);
        if (k === key(goal)) {
          const path = [{ x: goal.x, y: goal.y }];
          let node = cur;
          while (node) {
            path.unshift({ x: node.x, y: node.y });
            node = prev.get(key(node));
          }
          return path;
        }
        queue.push(nb);
      }
    }
    return [{ x: start.x, y: start.y }, { x: goal.x, y: goal.y }];
  }

  inWater(x, y) {
    return x > this.beachX + 40;
  }

  onBeach(x, y) {
    return x > this.beachX - 60 && x <= this.beachX + 40;
  }

  clampToWorld(pos, margin) {
    const m = margin === undefined ? 20 : margin;
    pos.x = Math.max(m, Math.min(this.size - m, pos.x));
    pos.y = Math.max(m, Math.min(this.size - m, pos.y));
  }
}
