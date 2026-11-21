// missions.js — the 12-mission linear arc for Crescent Bay (gta6-01 v5).
// First declaration: the mission arc is the contract autopilot.js and
// hud.js read (order, rewards, time limits, objectives as conditions).
// Behaviour (spec §2): linear arc, same order. Objectives are
// conditions ("reach the marker", "escape the police"), never kill
// counts. A failed mission restarts from its checkpoint (stage 0).
// Each mission has a fixer, a spoken hook, a cash reward, and a
// generous time limit. All 12 must be completable by the autopilot.
// m7 note: wanted cover starts at 3 stars (heat 58) — set the cover
// AFTER the mission starts, because the mission itself adds heat.
// Dialog-accept runs BEFORE the autopilot's car search (spec §9.1):
// the autopilot can press E to accept; see acceptDialog().

import { CONFIG } from './config.js';

export const MISSION_ARC = [
  { id: 'm1', name: 'First Job', fixer: 'Mara', hook: 'Rook, easy money. Grab the package at the market, drop it downtown.', reward: 400, timeLimit: 300, type: 'drive', stages: ['pickup', 'deliver'] },
  { id: 'm2', name: 'Tail Chase', fixer: 'Mara', hook: 'A courier is running my goods across town. Ram him till he slows down.', reward: 700, timeLimit: 300, type: 'chase', stages: ['chase'] },
  { id: 'm3', name: 'Hot Wheels', fixer: 'Dex', hook: 'Three checkpoints. Club, marina, airport. Fast car, faster feet.', reward: 900, timeLimit: 240, type: 'checkpoints', stages: ['checkpoint'] },
  { id: 'm4', name: 'Dockside', fixer: 'Mara', hook: 'Crate at the marina, hideout delivery. The docks are hot — keep moving.', reward: 1100, timeLimit: 360, type: 'drive', stages: ['pickup', 'deliver'] },
  { id: 'm5', name: 'Midnight Run', fixer: 'Dex', hook: 'Night run. Pick up at the club, drop at the docks. Headlights on.', reward: 1400, timeLimit: 300, type: 'drive', night: true, stages: ['pickup', 'deliver'] },
  { id: 'm6', name: 'Collector', fixer: 'Mara', hook: 'Five money drops around the city. Grab them all, then come home.', reward: 1800, timeLimit: 420, type: 'collect', stages: ['collect', 'return'] },
  { id: 'm7', name: 'Highway Heat', fixer: 'Dex', hook: 'Airport run, then lose the law. They will be all over you.', reward: 4600, timeLimit: 420, type: 'escape', stages: ['drive', 'escape'] },
  { id: 'm8', name: 'Crescent Job', fixer: 'Mara', hook: 'Three of them guarding the stash. Clear the way, then get out.', reward: 6200, timeLimit: 600, type: 'shootout', stages: ['shootout', 'escape'] },
  { id: 'm9', name: 'Sky Watch', fixer: 'Dex', hook: 'The eye in the sky is up. Reach the hideout — hiding does not work under that light.', reward: 2000, timeLimit: 420, type: 'escape', stages: ['escape'] },
  { id: 'm10', name: 'Full Auto', fixer: 'Mara', hook: 'Five of them at the docks. There are better guns in the crates — use them.', reward: 2500, timeLimit: 420, type: 'shootout', stages: ['shootout', 'exit'] },
  { id: 'm11', name: 'Tune-Up', fixer: 'Dex', hook: 'Get the car tuned at the Fixer Garage, then run three drops in the upgraded car.', reward: 3000, timeLimit: 420, type: 'garage', stages: ['garage', 'delivery'] },
  { id: 'm12', name: 'Bay Finale', fixer: 'Mara', hook: 'The bank. Four guards, the eye in the sky, then the plane. Biggest score of your life.', reward: 8000, timeLimit: 600, type: 'finale', stages: ['shootout', 'loot', 'escape', 'plane'] },
];

// Landmark shortcuts from CONFIG (single source of truth for positions).
export const LANDMARKS = {
  market: () => CONFIG.market,
  downtown: () => CONFIG.downtown,
  marina: () => CONFIG.marina,
  club: () => CONFIG.club,
  airport: () => CONFIG.airport,
  docks: () => CONFIG.docks,
  bank: () => CONFIG.bank,
  hideout: () => CONFIG.hideout,
  garage: () => CONFIG.garage,
  sprayShop: () => CONFIG.sprayShop,
};

export const COLLECTOR_DROPS = [
  { x: 1000, y: 600 }, { x: 2200, y: 1000 }, { x: 2600, y: 1800 },
  { x: 1400, y: 2600 }, { x: 600, y: 1800 },
];

export function createMissionState() {
  return {
    index: 0,            // position in MISSION_ARC
    id: null,            // current mission id
    stage: 0,            // stage within the mission
    stageName: null,
    timer: 0,            // seconds left
    active: false,
    dialogOpen: false,   // fixer dialog waiting for E/accept
    dialogMission: null,
    completed: [],       // ids completed this session
    checkpoint: 0,       // stage to restart from on fail (always 0)
    data: {},            // per-mission runtime (courier, hits, drops...)
    objective: '',
    objectiveTarget: null,
  };
}

export function ensureMissions(game) {
  if (!game.mission) game.mission = createMissionState();
  return game.mission;
}

export function currentMissionDef(game) {
  const m = ensureMissions(game);
  return MISSION_ARC[m.index] || null;
}

export function nextMissionDef(game) {
  const m = ensureMissions(game);
  return MISSION_ARC[m.index] || null;
}

// Offer the next mission as a dialog (fixer hook). The dialog must be
// accepted with E — and the autopilot's accept path runs before its car
// search, so it can never freeze waiting for a dialog (spec §9.1a).
export function offerMission(game) {
  const m = ensureMissions(game);
  const def = MISSION_ARC[m.index];
  if (!def || m.active) return false;
  m.dialogOpen = true;
  m.dialogMission = def.id;
  game.dialog = { open: true, kind: 'mission', mission: def.id, text: `${def.fixer}: ${def.hook}` };
  if (game.hud) game.hud.message = `${def.fixer}: ${def.name} — $${def.reward}`;
  return true;
}

export function acceptDialog(game) {
  const m = ensureMissions(game);
  if (!m.dialogOpen) return false;
  const def = MISSION_ARC.find((d) => d.id === m.dialogMission);
  m.dialogOpen = false;
  m.dialogMission = null;
  if (game.dialog) game.dialog.open = false;
  if (def) startMission(game, def.id);
  return true;
}

export function declineDialog(game) {
  const m = ensureMissions(game);
  m.dialogOpen = false;
  m.dialogMission = null;
  if (game.dialog) game.dialog.open = false;
  return true;
}

export function startMission(game, id) {
  const m = ensureMissions(game);
  const def = MISSION_ARC.find((d) => d.id === id);
  if (!def) return false;
  m.id = id;
  m.index = MISSION_ARC.indexOf(def);
  m.stage = 0;
  m.stageName = def.stages[0];
  m.timer = def.timeLimit;
  m.active = true;
  m.checkpoint = 0;
  m.data = { hits: 0, checkpointsHit: 0, dropsCollected: 0, purchased: false };
  game.objective = missionObjectiveText(game);
  game.objectiveTarget = missionTarget(game);
  if (game.audio && game.audio.click) game.audio.click();
  // Per-mission setup. NOTE m7: the mission adds heat on start, so the
  // wanted cover level is set AFTER startMission's own heat (here, at
  // the end of setup) — never before.
  if (id === 'm2') setupCourier(game);
  if (id === 'm5' && game.setNight) game.setNight(true);
  if (id === 'm6') {
    m.data.drops = COLLECTOR_DROPS.map((d) => ({ ...d, taken: false }));
    game.pickups = (game.pickups || []).concat(
      m.data.drops.map((d) => ({ x: d.x, y: d.y, kind: 'cash', mission: 'm6' })),
    );
  }
  if (id === 'm7') { if (game.addHeat) game.addHeat(20); setHeatAfterStart(game, 58); }
  if (id === 'm8' && game.startShootout) game.startShootout(game, 'm8');
  if (id === 'm9') {
    setHeatAfterStart(game, 58);
    if (game.forceHelicopter) game.forceHelicopter(game, true);
  }
  if (id === 'm10') {
    if (game.startShootout) game.startShootout(game, 'm10');
    if (game.spawnArenaCrates) game.spawnArenaCrates(game, 'm10');
  }
  if (id === 'm11') { if (game.garage) game.garage.purchaseCount = 0; }
  if (id === 'm12') {
    setHeatAfterStart(game, 74); // 4 stars
    if (game.startShootout) game.startShootout(game, 'm12');
    if (game.spawnArenaCrates) game.spawnArenaCrates(game, 'm12');
    if (game.forceHelicopter) game.forceHelicopter(game, true);
  }
  return true;
}

// Wanted cover: set AFTER the mission-start heat, so the final level is
// exactly the intended one (m7: 58 = 3 stars; m9: 58; m12: 74 = 4 stars).
function setHeatAfterStart(game, value) {
  if (game.setHeat) game.setHeat(game, value);
  else { game.heat = value; game.wantedStars = value >= 74 ? 4 : value >= 52 ? 3 : 0; }
}

// --- m2 courier -------------------------------------------------------
function setupCourier(game) {
  const m = ensureMissions(game);
  const start = { x: 1800, y: 1400 };
  m.data.courier = {
    x: start.x, y: start.y, angle: 0, speed: 0,
    cruise: 380, hits: 0, route: null, routeDest: null, routeIndex: 0,
    target: { x: 2600, y: 2200 },
  };
  game.courier = m.data.courier;
}

// The courier rebuilds its route only when its target moves >100 from
// the route's recorded destination (spec §9.1c — never every frame).
export function updateCourier(game, dt) {
  const m = ensureMissions(game);
  const c = m.data.courier;
  if (!c || m.id !== 'm2' || !m.active) return;
  const world = game.world;
  if (!world) return;
  const dest = c.target;
  const destMoved = !c.routeDest
    || Math.hypot(dest.x - c.routeDest.x, dest.y - c.routeDest.y) > 100;
  if (!c.route || destMoved) {
    c.route = world.findRoute(c.x, c.y, dest.x, dest.y);
    c.routeDest = { ...dest };
    c.routeIndex = 0;
  }
  const wp = c.route[Math.min(c.routeIndex, c.route.length - 1)];
  const dx = wp.x - c.x, dy = wp.y - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 70) {
    c.routeIndex += 1;
    // Route complete: pick a new far target and let the next update
    // rebuild (the target moved >100 from the recorded destination).
    // Never reverse at a junction — the route is a loop of junctions.
    if (c.routeIndex >= c.route.length) {
      const junctions = world.junctions;
      c.target = junctions[Math.floor(Math.random() * junctions.length)];
      c.route = null;
    }
    return;
  }
  const want = Math.atan2(dy, dx);
  let diff = want - c.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.angle += Math.max(-2.2 * dt, Math.min(2.2 * dt, diff));
  c.speed = Math.min(c.cruise, c.speed + 200 * dt);
  c.x += Math.cos(c.angle) * c.speed * dt;
  c.y += Math.sin(c.angle) * c.speed * dt;
  world.clampToWorld(c, 20);
}

// A ram hit counts within 70 units while player speed >120; each hit
// cuts the courier's cruise speed to 55%.
export function checkCourierRam(game) {
  const m = ensureMissions(game);
  const c = m.data.courier;
  const p = game.player;
  if (!c || !p || !p.car) return false;
  const d = Math.hypot(p.car.x - c.x, p.car.y - c.y);
  const speed = Math.abs(p.car.speed || 0);
  if (d < 70 && speed > 120) {
    const now = typeof game.time === 'number' ? game.time : 0;
    if (now - (c.lastHitAt || -99) < 1.0) return false; // one hit per second max
    c.lastHitAt = now;
    c.hits += 1;
    m.data.hits = c.hits;
    c.cruise = Math.max(120, c.cruise * 0.55);
    if (game.audio && game.audio.crash) game.audio.crash();
    if (game.hud) game.hud.message = `Ram hit ${c.hits}/4 — courier slowing!`;
    if (c.hits >= 4) completeMission(game);
    return true;
  }
  return false;
}

// --- objectives / targets --------------------------------------------
export function missionTarget(game) {
  const m = ensureMissions(game);
  const def = MISSION_ARC[m.index];
  if (!def) return null;
  const L = LANDMARKS;
  switch (m.id) {
    case 'm1': return m.stage === 0 ? L.market() : L.downtown();
    case 'm2': return m.data.courier ? { x: m.data.courier.x, y: m.data.courier.y } : L.marina();
    case 'm3': {
      const spots = [L.club(), L.marina(), L.airport()];
      return spots[Math.min(m.data.checkpointsHit || 0, 2)];
    }
    case 'm4': return m.stage === 0 ? L.marina() : L.hideout();
    case 'm5': return m.stage === 0 ? L.club() : L.docks();
    case 'm6': {
      if (m.stage === 0) {
        const next = (m.data.drops || []).find((d) => !d.taken);
        return next ? { x: next.x, y: next.y } : L.hideout();
      }
      return L.hideout();
    }
    case 'm7': return m.stage === 0 ? L.airport() : L.sprayShop();
    case 'm8': return m.stage === 0 ? { x: 1800, y: 1800 } : L.sprayShop();
    case 'm9': return L.hideout();
    case 'm10': return m.stage === 0 ? { x: 2600, y: 2600 } : { x: 2600, y: 3000 };
    case 'm11': {
      if (m.stage === 0) return L.garage();
      const spots = [L.club(), L.airport(), L.downtown()];
      return spots[Math.min(m.data.checkpointsHit || 0, 2)];
    }
    case 'm12': {
      if (m.stage === 0) return L.bank();
      if (m.stage === 1) return L.bank();
      if (m.stage === 2) return L.airport();
      return { x: 1000, y: 300 }; // plane marker at the airport
    }
    default: return null;
  }
}

export function missionObjectiveText(game) {
  const m = ensureMissions(game);
  const def = MISSION_ARC[m.index];
  if (!def) return '';
  switch (m.id) {
    case 'm1': return m.stage === 0 ? 'Pick up the package at the market' : 'Deliver the package downtown';
    case 'm2': return `Ram the courier ${m.data.hits || 0}/4`;
    case 'm3': return `Hit the checkpoints ${m.data.checkpointsHit || 0}/3`;
    case 'm4': return m.stage === 0 ? 'Pick up the crate at the marina' : 'Deliver the crate to the hideout';
    case 'm5': return m.stage === 0 ? 'Pick up at the club (night run)' : 'Drop at the docks';
    case 'm6': return m.stage === 0 ? `Collect the money drops ${m.data.dropsCollected || 0}/5` : 'Return to the hideout';
    case 'm7': return m.stage === 0 ? 'Drive to the airport' : 'ESCAPE THE POLICE — Lose the cops';
    case 'm8': return m.stage === 0 ? 'Clear the shootout' : 'ESCAPE THE POLICE — Lose the cops';
    case 'm9': return 'Reach the hideout — keep moving under the spotlight';
    case 'm10': return m.stage === 0 ? 'Clear the dockside shootout' : 'Reach the exit marker';
    case 'm11': return m.stage === 0 ? 'Buy an upgrade at the Fixer Garage' : `Deliveries ${m.data.checkpointsHit || 0}/3 in the upgraded car`;
    case 'm12': {
      if (m.stage === 0) return 'Clear the bank shootout';
      if (m.stage === 1) return 'Grab the loot at the bank';
      if (m.stage === 2) return 'Escape to the airport';
      return 'Reach the plane';
    }
    default: return def.name;
  }
}

function near(game, target, radius) {
  const p = game.player;
  if (!p || !target) return false;
  const x = p.inCar && p.car ? p.car.x : p.x;
  const y = p.inCar && p.car ? p.car.y : p.y;
  const dx = x - target.x, dy = y - target.y;
  return dx * dx + dy * dy < radius * radius;
}

function advanceStage(game) {
  const m = ensureMissions(game);
  const def = MISSION_ARC[m.index];
  m.stage += 1;
  if (m.stage >= def.stages.length) { completeMission(game); return; }
  m.stageName = def.stages[m.stage];
  game.objective = missionObjectiveText(game);
  game.objectiveTarget = missionTarget(game);
}

export function completeMission(game) {
  const m = ensureMissions(game);
  const def = MISSION_ARC[m.index];
  if (!def) return false;
  const reward = def.reward;
  if (typeof game.cash === 'number') game.cash += reward;
  if (game.player) game.player.cash = game.cash; // mirror, never double-add
  m.completed.push(def.id);
  m.active = false;
  m.id = null;
  m.index += 1;
  m.stage = 0;
  game.objective = '';
  game.objectiveTarget = null;
  if (game.forceHelicopter && (def.id === 'm9' || def.id === 'm12')) {
    game.forceHelicopter(game, false);
  }
  if (game.audio && game.audio.cash) game.audio.cash();
  if (game.hud) game.hud.message = `${def.name} complete! +$${reward}`;
  // Autosave after each mission writes to the active slot (save.js).
  if (game.autosave) game.autosave(game);
  else if (game.save && game.save.autosave) game.save.autosave(game);
  return true;
}

// A failed mission restarts from its checkpoint (stage 0).
export function failMission(game, reason) {
  const m = ensureMissions(game);
  const def = MISSION_ARC[m.index];
  if (!def) return false;
  if (game.hud) game.hud.message = `${def.name} failed (${reason || 'try again'}) — restarting`;
  m.stage = m.checkpoint; // 0
  m.stageName = def.stages[0];
  m.timer = def.timeLimit;
  m.data = { hits: 0, checkpointsHit: 0, dropsCollected: 0, purchased: false };
  if (game.player) game.player.hp = game.player.maxHp || 100;
  if (def.id === 'm12' || def.id === 'm8' || def.id === 'm10') {
    if (game.startShootout) game.startShootout(game, def.id);
  }
  game.objective = missionObjectiveText(game);
  game.objectiveTarget = missionTarget(game);
  return true;
}

export function updateMissions(game, dt) {
  const m = ensureMissions(game);
  if (!m.active) return;
  m.timer -= dt;
  if (m.timer <= 0) { failMission(game, 'time up'); return; }
  const p = game.player;
  if (!p) return;

  if (m.id === 'm2') {
    updateCourier(game, dt);
    checkCourierRam(game);
    game.objectiveTarget = missionTarget(game);
    game.objective = missionObjectiveText(game);
    return;
  }

  // Shootout stages complete when no enemies are alive.
  if ((m.id === 'm8' || m.id === 'm10' || m.id === 'm12') && m.stage === 0) {
    const alive = game.enemiesAlive ? game.enemiesAlive(game)
      : (game.combat ? game.combat.enemies.filter((e) => e.alive).length : 0);
    if (alive === 0) {
      if (m.id === 'm12') { advanceStage(game); }
      else advanceStage(game);
    }
    return;
  }

  switch (m.id) {
    case 'm1': case 'm4': case 'm5':
      if (near(game, missionTarget(game), 70)) advanceStage(game);
      break;
    case 'm3': case 'm11': {
      if (m.stage === 1 || m.id === 'm3') {
        if (near(game, missionTarget(game), 70)) {
          m.data.checkpointsHit = (m.data.checkpointsHit || 0) + 1;
          if (m.data.checkpointsHit >= 3) completeMission(game);
          else { game.objective = missionObjectiveText(game); game.objectiveTarget = missionTarget(game); }
        }
      } else if (m.id === 'm11' && m.stage === 0) {
        // Garage stage: completes on purchase (buyUpgrade sets the flag
        // via game.garage.purchaseCount — checked here each frame).
        const bought = game.garage && game.garage.purchaseCount > 0;
        if (bought) { m.data.purchased = true; advanceStage(game); }
      }
      break;
    }
    case 'm6': {
      if (m.stage === 0) {
        for (const d of m.data.drops || []) {
          if (!d.taken && near(game, d, 60)) {
            d.taken = true;
            m.data.dropsCollected = (m.data.dropsCollected || 0) + 1;
            if (game.audio && game.audio.cash) game.audio.cash();
          }
        }
        if ((m.data.dropsCollected || 0) >= 5) advanceStage(game);
        else { game.objective = missionObjectiveText(game); game.objectiveTarget = missionTarget(game); }
      } else if (near(game, LANDMARKS.hideout(), 70)) completeMission(game);
      break;
    }
    case 'm7': case 'm8': {
      if (m.stage === 0 && near(game, missionTarget(game), 70)) advanceStage(game);
      else if (m.stage === 1) {
        // Escape: complete when wanted drops to 0 (heat fully decayed).
        const stars = game.wantedStars != null ? game.wantedStars : 0;
        if (stars === 0) completeMission(game);
      }
      break;
    }
    case 'm9': {
      if (near(game, LANDMARKS.hideout(), 70)) completeMission(game);
      break;
    }
    case 'm10': {
      if (m.stage === 1 && near(game, missionTarget(game), 70)) completeMission(game);
      break;
    }
    case 'm12': {
      if (m.stage === 1 && near(game, LANDMARKS.bank(), 60)) advanceStage(game);
      else if (m.stage === 2) {
        // Escape leg: reach the airport while pursued.
        if (near(game, LANDMARKS.airport(), 80)) advanceStage(game);
      } else if (m.stage === 3 && near(game, { x: 1000, y: 300 }, 70)) completeMission(game);
      break;
    }
    default: break;
  }
}
