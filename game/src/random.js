// Crescent Bay — deterministic random numbers (mulberry32).
// Every random choice in the city, traffic and pedestrians comes from a
// seeded generator, so the same seed always builds the same city.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    // Integer in [min, max).
    int(min, max) {
      return min + Math.floor(next() * (max - min));
    },
    // Float in [min, max).
    range(min, max) {
      return min + next() * (max - min);
    },
    // Pick one element of an array.
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    // True with probability p.
    chance(p) {
      return next() < p;
    },
  };
}
