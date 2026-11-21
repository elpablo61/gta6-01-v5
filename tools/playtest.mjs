// Crescent Bay v5 — playtest harness (written fresh in-session).
// Modes: cold | edge | arc [--mission mX] | fps
// Serves game/ on its own port, drives headless Chromium (cached
// chromium_headless_shell-1255 via explicit executablePath), collects
// console/page errors, and reports PASS/FAIL per check.
// Long arc runs append one state line per poll to /tmp/arc-progress.txt.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const EXE = join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const mode = args[0] || 'cold';
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const PORT = Number(opt('--port', mode === 'cold' ? 8931 : 8931));
const SEED = Number(opt('--seed', 7));
const ONLY = opt('--mission', null);
const TIMEOUT_S = Number(opt('--timeout', 1200));
const PROGRESS = '/tmp/arc-progress.txt';

let server = null;
let browser = null;

async function startServer(port) {
  server = spawn('node', ['serve.ts', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/index.html`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`server did not come up on ${port}`);
}

async function openPage(extraQuery = '') {
  browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('reqfail: ' + r.url()));
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}${extraQuery}`, { waitUntil: 'load' });
  await sleep(2500);
  return { page, errors };
}

async function snap(page) {
  return page.evaluate(() => {
    const g = window.game;
    const m = g.mission || {};
    const heli = g.systems.helicopter;
    let spotlight = null;
    try { spotlight = heli && heli.spotlightOnPlayer ? heli.spotlightOnPlayer(g) : null; } catch { spotlight = 'err'; }
    const car = g.player && g.player.car;
    return {
      state: g.state,
      mission: m.id || null,
      stage: m.stage,
      active: !!m.active,
      dialogOpen: !!m.dialogOpen,
      completed: (g.completedMissions || []).slice(),
      px: Math.round(g.player.x), py: Math.round(g.player.y),
      hp: Math.round(g.player.hp),
      alive: !!g.player.alive,
      inCar: !!g.player.inCar,
      cash: g.cash,
      heat: Math.round(g.heat * 10) / 10,
      stars: g.stars,
      objective: g.objective,
      target: g.objectiveTarget,
      heliActive: !!(g.helicopter && g.helicopter.active),
      heliSpotlight: spotlight,
      weaponsOwned: (g.weapons.owned || []).slice(),
      weapon: g.weapons.current,
      ammo: { ...(g.weapons.ammo || {}) },
      garageOpen: !!(g.garage && g.garage.open),
      garagePurchases: g.garage ? (g.garage.purchaseCount || 0) : 0,
      carUpgrades: car && car.upgrades ? { ...car.upgrades } : null,
      radio: g.radioStation,
      enemies: (g.enemies || []).length,
      police: (g.police || []).length,
      systems: Object.keys(g.systems || {}).sort(),
      timeOfDay: Math.round(g.timeOfDay * 100) / 100,
    };
  });
}

async function newGame(page) {
  await page.click('#btn-new-game');
  await sleep(1500);
}

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  return ok ? 1 : 0;
}

async function cleanup(code = 0) {
  try { if (browser) await browser.close(); } catch { /* already closed */ }
  try { if (server) server.kill(); } catch { /* already dead */ }
  process.exit(code);
}

// ---------------------------------------------------------------- cold ---
async function runCold() {
  await startServer(PORT);
  const { page, errors } = await openPage();
  let pass = 0, total = 0;
  const t = (n, ok, d) => { total++; pass += check(n, ok, d); };

  let s = await snap(page);
  t('title screen visible on load', s.state === 'title');
  t('3 save slots rendered', await page.evaluate(() => document.querySelectorAll('#save-slots .slot').length) === 3);
  t('all 9 systems loaded', ['police', 'combat', 'missions', 'hud', 'autopilot', 'weapons', 'helicopter', 'garage', 'radio'].every((n) => s.systems.includes(n)), s.systems.join(','));
  t('weapons.update + hud.update wired', await page.evaluate(() => typeof window.game.systems.weapons?.update === 'function' && typeof window.game.systems.hud?.update === 'function'));
  t('helicopter spotlight fn wired', await page.evaluate(() => typeof window.game.systems.helicopter?.spotlightOnPlayer === 'function'));

  await newGame(page);
  s = await snap(page);
  t('New Game starts playing', s.state === 'playing');

  // Movement: hold W and confirm the player actually moves.
  const before = await snap(page);
  await page.keyboard.down('w');
  await sleep(1500);
  await page.keyboard.up('w');
  const after = await snap(page);
  t('player moves on WASD', Math.hypot(after.px - before.px, after.py - before.py) > 30, `moved ${Math.round(Math.hypot(after.px - before.px, after.py - before.py))}u`);

  // Radio: R cycles through all three stations, name changes each time.
  const stations = [await snap(page).then((x) => x.radio)];
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('r');
    await sleep(600);
    stations.push((await snap(page)).radio);
  }
  t('radio cycles 3 distinct stations', new Set(stations).size === 3, stations.join(' → '));

  // Save slots: write all 3 with distinct cash, load each back.
  const slotOk = await page.evaluate(async () => {
    const { Save } = await import('/src/save.js');
    const g = window.game;
    const out = [];
    for (let i = 0; i < 3; i++) {
      g.cash = 1000 + i * 111;
      const r = Save.save(g, i);
      const back = Save.load(i);
      out.push(r.ok && back.ok && back.data.cash === 1000 + i * 111);
    }
    return out;
  });
  t('save slots 1-3 write + load back', slotOk.every(Boolean), JSON.stringify(slotOk));

  await sleep(2000);
  s = await snap(page);
  t('0 console errors during cold run', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\nCOLD: ${pass}/${total} passed`);
  await cleanup(pass === total ? 0 : 1);
}

// ---------------------------------------------------------------- edge ---
async function runEdge() {
  await startServer(PORT);
  const { page, errors } = await openPage();
  let pass = 0, total = 0;
  const t = (n, ok, d) => { total++; pass += check(n, ok, d); };

  await newGame(page);

  // 1. Garage: open menu (pauses), Esc closes menu first — no resume-with-menu-open.
  let r = await page.evaluate(() => {
    const g = window.game;
    g.player.x = 1000; g.player.y = 1000;
    const opened = g.systems.garage.openGarageMenu(g);
    return { opened, state: g.state, open: g.garage.open, dom: !!document.getElementById('garage-menu') };
  });
  t('garage menu opens + pauses world', r.opened && r.state === 'paused' && r.dom, JSON.stringify(r));
  await page.keyboard.press('Escape');
  await sleep(600);
  r = await page.evaluate(() => ({ state: window.game.state, open: window.game.garage.open, dom: !!document.getElementById('garage-menu'), pauseMenu: !document.getElementById('pause-menu').classList.contains('hidden') }));
  t('Esc closes garage menu, world resumes, no pause menu', r.state === 'playing' && !r.open && !r.dom && !r.pauseMenu, JSON.stringify(r));

  // 2. Helicopter retreat: spotlight off + heat decays while it retreats.
  await page.evaluate(() => { const g = window.game; g.addHeat(58); });
  await sleep(2500);
  let heliUp = await page.evaluate(() => {
    const g = window.game;
    return { active: g.helicopter.active, spot: g.systems.helicopter.spotlightOnPlayer(g) };
  });
  t('helicopter up at 3 stars with spotlight', heliUp.active && heliUp.spot === true, JSON.stringify(heliUp));

  // 2b. Police dispatch: foot cops + patrol cars actually spawn at 3 stars.
  await sleep(4000);
  const dispatch = await page.evaluate(() => {
    const g = window.game;
    return {
      foot: g.police.length,
      patrol: (g.cars || []).filter((c) => c.isPolice && !c.isRoadblock).length,
      stars: g.stars,
    };
  });
  t('police dispatch spawns foot cops + patrol cars at 3 stars', dispatch.foot >= 2 && dispatch.patrol >= 1, JSON.stringify(dispatch));
  // Shoot it down: damage until the spotlight leaves the player.
  await page.evaluate(() => {
    const g = window.game;
    for (let i = 0; i < 30; i++) g.systems.helicopter.damageHelicopter(g, 50);
  });
  await sleep(1200);
  const retreat = await page.evaluate(() => {
    const g = window.game;
    return { active: g.helicopter.active, spot: g.systems.helicopter.spotlightOnPlayer(g), heat: g.heat };
  });
  t('shot-down heli retreats: spotlight off', retreat.spot === false, JSON.stringify(retreat));
  // Heat must decay during the retreat. Foot cops now spawn and chase,
  // so a plain "teleport away and wait" no longer stays cop-free: the
  // in-page probe hops between far corners (leaving every cop behind)
  // and clears the cop list each hop, so the hide timer can accumulate
  // and the decay gate — not the spotlight — is what is measured.
  const decay = await page.evaluate(async () => {
    const g = window.game;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (g.player.inCar) g.vehicles.exitCar();
    const h0 = g.heat;
    let maxHide = 0;
    const corners = [[200, 200], [3000, 3000], [200, 3000], [3000, 200]];
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      g.police = [];
      const c = corners[i % corners.length];
      g.player.x = c[0]; g.player.y = c[1];
      if (g.hideTimer > maxHide) maxHide = g.hideTimer;
    }
    return { h0, h1: g.heat, maxHide, spot: g.systems.helicopter.spotlightOnPlayer(g) };
  });
  t('heat decays during heli retreat', decay.h1 < decay.h0 - 5 && decay.maxHide >= 3 && decay.spot === false, JSON.stringify(decay));

  // 3. Weapon crate pickup FIRST (before any giveWeapon): stand on a
  // world crate spot for a weapon not yet owned, owned grows.
  const crateOk = await page.evaluate(async () => {
    const g = window.game;
    const { WORLD_CRATE_SPOTS } = await import('/src/weapons.js');
    const spot = WORLD_CRATE_SPOTS.find((c) => !g.weapons.owned.includes(c.weapon));
    if (!spot) return 'none-left';
    if (g.player.inCar) g.vehicles.exitCar();
    g.player.x = spot.x; g.player.y = spot.y;
    return spot.weapon;
  });
  await sleep(1500);
  const ownedAfter = (await snap(page)).weaponsOwned;
  t('walking over a weapon crate picks it up', typeof crateOk === 'string' && ownedAfter.includes(crateOk), `crate=${crateOk} owned=${ownedAfter.join(',')}`);

  // 4. Weapon switching: give SMG + shotgun, cycle with 1/2/3 and Q.
  await page.evaluate(() => {
    const g = window.game;
    g.systems.weapons.giveWeapon(g, 'smg', 60);
    g.systems.weapons.giveWeapon(g, 'shotgun', 12);
  });
  await page.keyboard.press('2'); await sleep(300);
  let w = (await snap(page)).weapon;
  const w2ok = w === 'smg';
  await page.keyboard.press('3'); await sleep(300);
  w = (await snap(page)).weapon;
  const w3ok = w === 'shotgun';
  await page.keyboard.press('q'); await sleep(300);
  w = (await snap(page)).weapon;
  const wqok = w === 'pistol';
  t('weapon keys 2/3/Q switch', w2ok && w3ok && wqok, `2→smg:${w2ok} 3→shotgun:${w3ok} Q→pistol:${wqok}`);

  // 5. Mission fail restarts from stage 0 with a fresh timer.
  await page.evaluate(() => { window.game.startMission('m8'); });
  await sleep(1200);
  const failOk = await page.evaluate(() => {
    const g = window.game;
    const before = g.mission.timer;
    g.systems.missions.failMission(g, 'probe');
    return { stage: g.mission.stage, timer: g.mission.timer, active: g.mission.active, timerWas: before };
  });
  t('failed mission restarts at stage 0', failOk.stage === 0 && failOk.active && failOk.timer > 500, JSON.stringify(failOk));

  // 6. Pause / resume with Esc.
  await page.keyboard.press('Escape'); await sleep(400);
  let paused = await page.evaluate(() => ({ state: window.game.state, menu: !document.getElementById('pause-menu').classList.contains('hidden') }));
  await page.keyboard.press('Escape'); await sleep(400);
  let resumed = await page.evaluate(() => window.game.state);
  t('Esc pauses and resumes', paused.state === 'paused' && paused.menu && resumed === 'playing', JSON.stringify(paused) + ' → ' + resumed);

  // 7. Game over (DOWN) then respawn. Death goes through takeDamage
  // (hp<=0 there flips alive=false); setting hp directly does not kill.
  await page.evaluate(() => { window.game.player.takeDamage(999); });
  await sleep(1500);
  let over = await page.evaluate(() => ({ state: window.game.state, shown: !document.getElementById('game-over-screen').classList.contains('hidden') }));
  if (over.state === 'gameover' && over.shown) {
    await page.click('#btn-respawn');
    await sleep(800);
  }
  const back = await snap(page);
  t('game over screen + respawn returns to play', over.state === 'gameover' && back.state === 'playing' && back.hp > 0, JSON.stringify(over) + ' → ' + back.state);

  // 8. Enter / exit a car via the vehicle system.
  const carOk = await page.evaluate(() => {
    const g = window.game;
    const car = (g.cars || []).find((c) => c && !c.isPolice) || (g.cars || [])[0];
    if (!car) return 'no-cars';
    g.player.x = car.x; g.player.y = car.y;
    g.vehicles.enterCar(car);
    const inCar = !!g.player.inCar;
    g.vehicles.exitCar();
    return { inCar, outCar: !g.player.inCar };
  });
  t('enter + exit car', carOk && carOk.inCar && carOk.outCar, JSON.stringify(carOk));

  // 9. Spray Shop drains heat fast.
  await page.evaluate(() => { const g = window.game; g.addHeat(80); g.player.x = 600; g.player.y = 2600; });
  await sleep(3000);
  const heatNow = (await snap(page)).heat;
  t('Spray Shop clears heat', heatNow < 40, `heat now ${heatNow}`);

  await sleep(1000);
  t('0 console errors during edge run', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\nEDGE: ${pass}/${total} passed`);
  await cleanup(pass === total ? 0 : 1);
}

// ----------------------------------------------------------------- arc ---
async function runArc() {
  await startServer(PORT);
  const { page, errors } = await openPage();
  writeFileSync(PROGRESS, `arc start ${new Date().toISOString()} mission=${ONLY || 'full'}\n`);
  const log = (line) => {
    console.log(line);
    appendFileSync(PROGRESS, line + '\n');
  };

  await newGame(page);
  await page.evaluate((only) => {
    const g = window.game;
    g.autopilot.enabled = true;
    if (only) g.startMission(only);
  }, ONLY);

  const want = ONLY ? [ONLY] : ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'];
  const evidence = { heli: false, weaponPickup: false, garageBuy: false };
  const t0 = Date.now();
  let done = [];
  let lastLine = '';
  while ((Date.now() - t0) / 1000 < TIMEOUT_S) {
    const s = await snap(page);
    done = s.completed || [];
    if (s.heliActive) evidence.heli = true;
    if ((s.mission === 'm10' || done.includes('m10')) && s.weaponsOwned.length > 1) evidence.weaponPickup = true;
    if (s.garagePurchases > 0 || (s.carUpgrades && Object.values(s.carUpgrades).some((v) => v > 0))) evidence.garageBuy = true;
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const line = `${elapsed}s mission=${s.mission || '-'} stage=${s.stage} done=[${done.join(',')}] pos=(${s.px},${s.py}) inCar=${s.inCar} hp=${s.hp} cash=$${s.cash} heat=${s.heat} stars=${s.stars} heli=${s.heliActive} spot=${s.heliSpotlight} weapon=${s.weapon} owned=[${s.weaponsOwned.join(',')}] garage=${s.garageOpen}/${s.garagePurchases} radio=${s.radio} obj=${s.objective}`;
    if (line !== lastLine) { log(line); lastLine = line; }
    if (want.every((m) => done.includes(m))) break;
    if (s.state === 'gameover') {
      log(`${elapsed}s GAME OVER — clicking respawn`);
      await page.click('#btn-respawn').catch(() => {});
      await sleep(1000);
    }
    await sleep(2000);
  }
  const missing = want.filter((m) => !done.includes(m));
  const ok = missing.length === 0;
  log(`ARC ${ok ? 'PASS' : 'FAIL'}: ${done.length}/${want.length} done=[${done.join(',')}] missing=[${missing.join(',')}] evidence=${JSON.stringify(evidence)} errors=${errors.length} ${errors.slice(0, 3).join(' | ')}`);
  console.log(`\nARC: ${done.length}/${want.length} — evidence heli=${evidence.heli} weaponPickup=${evidence.weaponPickup} garageBuy=${evidence.garageBuy} — console errors: ${errors.length}`);
  await cleanup(ok && errors.length === 0 ? 0 : 1);
}

// ----------------------------------------------------------------- fps ---
async function runFps() {
  await startServer(PORT);
  const { page, errors } = await openPage();
  await newGame(page);
  // Wanted chase: 3 stars + autopilot driving, so patrol cars pursue.
  await page.evaluate(() => {
    const g = window.game;
    g.addHeat(58);
    g.autopilot.enabled = true;
  });
  await page.evaluate(() => {
    window.__fps = { n: 0, t0: performance.now() };
    const tick = () => { window.__fps.n++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await sleep(12000);
  const fps = await page.evaluate(() => {
    const f = window.__fps;
    return f.n / ((performance.now() - f.t0) / 1000);
  });
  const s = await snap(page);
  console.log(`FPS: ${fps.toFixed(1)} (wanted chase, stars=${s.stars}, police=${s.police}, heli=${s.heliActive})`);
  console.log(`FPS ${fps >= 50 ? 'PASS' : 'FAIL'}: target ≥50 — console errors: ${errors.length} ${errors.slice(0, 3).join(' | ')}`);
  await cleanup(fps >= 50 && errors.length === 0 ? 0 : 1);
}

// ------------------------------------------------------------------ main -
try {
  if (mode === 'cold') await runCold();
  else if (mode === 'edge') await runEdge();
  else if (mode === 'arc') await runArc();
  else if (mode === 'fps') await runFps();
  else { console.error('unknown mode: ' + mode); process.exit(2); }
} catch (e) {
  console.error('HARNESS ERROR:', e.message);
  await cleanup(2);
}
