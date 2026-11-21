// Crescent Bay v5 — screenshot driver (written fresh in-session).
// Reads shots.json, plays each pose live in headless Chromium (cached
// chromium_headless_shell-1255, explicit executablePath), and saves
// 1280x800 JPEGs (quality 80) into screenshots/. Every shot is a real
// render of the game's own code in a browser — nothing composited.
// Usage: node tools/screenshots.mjs [--port 8932] [--only 1-cover]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const EXE = join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const PORT = Number(opt('--port', 8932));
const ONLY = opt('--only', null);

const spec = JSON.parse(readFileSync(join(ROOT, 'shots.json'), 'utf8'));
const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const errors = [];

async function waitUp() {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/index.html`); if (r.ok) return; } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error('server did not come up');
}

function snapState(page) {
  return page.evaluate(() => {
    const g = window.game;
    const m = g.mission || {};
    return {
      state: g.state, mission: m.id || null, stage: m.stage, stageName: m.stageName,
      done: (g.completedMissions || []).slice(),
      px: Math.round(g.player.x), py: Math.round(g.player.y),
      inCar: !!g.player.inCar, heat: Math.round(g.heat), stars: g.stars,
      heli: !!(g.helicopter && g.helicopter.active),
      enemies: (g.enemies || []).length, police: (g.police || []).length,
      patrolCars: (g.policeState && g.policeState.patrolCars ? g.policeState.patrolCars.length : 0),
      roadblocks: (g.cars || []).filter((c) => c.isRoadblock).length,
      nearestRoadblock: (() => {
        const bs = (g.cars || []).filter((c) => c.isRoadblock);
        if (!bs.length) return null;
        return Math.round(Math.min(...bs.map((c) => Math.hypot(c.x - g.player.x, c.y - g.player.y))));
      })(),
      carSpeed: g.player && g.player.car ? Math.round(g.player.car.speed || 0) : 0,
      nearestEnemy: (() => {
        const es = (g.enemies || []).filter((e) => e.alive !== false);
        if (!es.length) return null;
        let best = null;
        for (const e of es) {
          const dx = e.x - g.player.x, dy = e.y - g.player.y;
          const d = Math.hypot(dx, dy);
          if (!best || d < best.dist) best = { dx: Math.round(dx), dy: Math.round(dy), dist: Math.round(d) };
        }
        return best;
      })(),
      timeOfDay: Math.round(g.timeOfDay * 100) / 100, night: Math.round(g.nightFactor * 100) / 100,
      objective: g.objective,
    };
  });
}

async function waitFor(page, fn, timeoutS, label, pollMs = 1000) {
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < timeoutS) {
    const s = await snapState(page);
    if (fn(s)) return s;
    await sleep(pollMs);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function shoot(browser, shot) {
  const page = await browser.newPage({ viewport: { width: spec.viewport.width, height: spec.viewport.height } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${shot.id}: ` + m.text()); });
  page.on('pageerror', (e) => errors.push(`${shot.id}: pageerror: ` + e.message));
  const setup = shot.setup;
  // No ?shot= param: with it, loadSystems HEAD-probes the (absent)
  // shots.js and Chromium logs the 404 as a console error. The driver
  // sets every pose up itself via evaluate below, so the param buys
  // nothing; plain ?seed=7 boots to the title screen either way.
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${spec.seed}`, { waitUntil: 'load' });
  await sleep(2000);

  if (setup.titleOnly) {
    await sleep(setup.settleSeconds * 1000);
  } else {
    await page.click('#btn-new-game');
    await sleep(1200);
    await page.evaluate((s) => {
      const g = window.game;
      g.autopilot.enabled = !!s.autopilot;
      if (s.timeOfDay !== undefined) g.timeOfDay = s.timeOfDay;
      if (s.mission) g.startMission(s.mission);
      // No heat here: the mission sets its own cover level at start.
    }, setup);
    if (setup.waitForStage) {
      await waitFor(page, (st) => st.stageName === setup.waitForStage, 180, `stage ${setup.waitForStage} (now ${JSON.stringify(await snapState(page))})`);
    }
    if (setup.dialogWhen) {
      // Show the fixer dialog the moment an enemy is near the player but
      // outside the dialog box (which covers the centre of the frame, so
      // the enemy must be clearly left/right/above/below it). The dialog
      // freezes the world, so the fight stays visible behind it. Poll
      // fast: the autopilot-free player stands still while enemies close
      // in, and the window is short. Waiting a fixed delay overshoots:
      // the autopilot can clear the arena first.
      await waitFor(page, (st) => {
        if (st.mission !== setup.mission || st.stageName !== setup.dialogWhen.stage) return false;
        if (st.enemies < (setup.dialogWhen.minEnemies || 1)) return false;
        const ne = st.nearestEnemy;
        if (!ne) return false;
        return ne.dist >= 150 && ne.dist <= 500 && (Math.abs(ne.dx) > 320 || Math.abs(ne.dy) > 280);
      }, 60, 'shootout with a near enemy', 400);
    } else if (setup.dialogAfterSeconds) await sleep(setup.dialogAfterSeconds * 1000);
    // Pose tweaks. Heat is SET exactly (police.setHeat keeps both heat
    // copies in sync) — never added: the mission already set its own
    // cover level, and driving adds heat on top, so adding would overshoot.
    const setHeatExact = async () => page.evaluate((s) => {
      const g = window.game;
      if (s.heat === undefined) return;
      if (g.systems.police && g.systems.police.setHeat) g.systems.police.setHeat(g, s.heat);
      else { g.heat = s.heat; if (g._updateStars) g._updateStars(); }
    }, setup);
    const teleport = async () => page.evaluate((s) => {
      const g = window.game;
      if (!s.teleport) return;
      g.player.x = s.teleport.x; g.player.y = s.teleport.y;
      if (g.player.car) { g.player.car.x = s.teleport.x; g.player.car.y = s.teleport.y; }
      // A teleport invalidates the autopilot's memoized route — without
      // a reset it keeps following stale waypoints and wedges the car
      // inside a block. Clear it so the route rebuilds from the new spot.
      if (g.autopilot) {
        g.autopilot.route = null; g.autopilot.routeDest = null;
        g.autopilot.routeIndex = 0; g.autopilot.walkTarget = null;
        g.autopilot.walkTargetFor = null;
      }
      if (s.timeOfDay !== undefined) g.timeOfDay = s.timeOfDay;
      if (s.dialog) g.showDialog(s.dialog.title, s.dialog.text, null);
    }, setup);
    if (setup.waitForSpeed) {
      // Chase flow, in order: (1) set the wanted level so police spawn;
      // (2) wait for pursuers; (3) teleport to the pose spot — AFTER the
      // police exist, so the car is still near the spot when the shot is
      // taken (it drives away from it within seconds); (4) wait for the
      // car to be moving; (5) re-set heat (driving may have added heat).
      await setHeatExact();
      await waitFor(page, (st) => (st.police + st.patrolCars) >= 1, 20, 'police in pursuit');
      await teleport();
      await waitFor(page, (st) => st.carSpeed > 120, 15, 'car moving', 400);
      if (setup.waitForRoadblock) {
        await waitFor(page, (st) => st.roadblocks >= 1 && st.nearestRoadblock !== null && st.nearestRoadblock < 800, 20, 'roadblock ahead');
      }
      await setHeatExact();
    } else {
      await teleport();
      await setHeatExact();
    }
    await sleep((setup.settleSeconds || 3) * 1000);
  }

  const state = await snapState(page);
  const out = join(ROOT, 'screenshots', shot.file);
  await page.screenshot({ path: out, type: 'jpeg', quality: 80 });
  const size = statSync(out).size;
  console.log(`${shot.id}: ${shot.file} ${size} bytes — ${JSON.stringify(state)}`);
  await page.close();
  return size;
}

let code = 0;
try {
  await waitUp();
  mkdirSync(join(ROOT, 'screenshots'), { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  try {
    for (const shot of spec.shots) {
      if (ONLY && shot.id !== ONLY) continue;
      const size = await shoot(browser, shot);
      if (size > 200 * 1024) { console.error(`${shot.id} OVER 200 KiB!`); code = 1; }
    }
  } finally {
    await browser.close();
  }
  console.log('console errors:', errors.length, errors.slice(0, 5).join(' | '));
  if (errors.length) code = 1;
} catch (e) {
  console.error('SCREENSHOT ERROR:', e.message);
  code = 2;
} finally {
  server.kill();
}
process.exit(code);
