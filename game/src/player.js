// Crescent Bay — Rook on foot: movement, health, cash, aiming and shooting.
// The player object is plain state; this module updates it each frame.

import { CONFIG } from './config.js';

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.angle = 0; // facing
    this.aim = 0; // mouse aim angle
    this.hp = CONFIG.playerMaxHp;
    this.maxHp = CONFIG.playerMaxHp;
    this.cash = CONFIG.startCash;
    this.ammo = CONFIG.startAmmo;
    this.inCar = false;
    this.car = null;
    this.speed = 0;
    this.sprinting = false;
    this.fireCooldown = 0;
    this.hurtCooldown = 0;
    this.alive = true;
    this.nearCar = null;
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.hp = this.maxHp;
    this.alive = true;
    this.inCar = false;
    this.car = null;
  }

  takeDamage(amount, game) {
    if (!this.alive || this.hurtCooldown > 0) return;
    this.hp -= amount;
    this.hurtCooldown = 0.25;
    if (game && game.audio) game.audio.crash();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  update(dt, game) {
    if (!this.alive || this.inCar) return;
    const input = game.input;
    const world = game.world;
    let mx = 0;
    let my = 0;
    if (input.down('w') || input.down('ArrowUp')) my -= 1;
    if (input.down('s') || input.down('ArrowDown')) my += 1;
    if (input.down('a') || input.down('ArrowLeft')) mx -= 1;
    if (input.down('d') || input.down('ArrowRight')) mx += 1;
    this.sprinting = input.down('Shift');
    const speed = this.sprinting ? CONFIG.sprintSpeed : CONFIG.walkSpeed;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
      this.angle = Math.atan2(my, mx);
      const nx = this.x + mx * speed * dt;
      const ny = this.y + my * speed * dt;
      // Move axis by axis so the player slides along walls instead of sticking.
      if (!world.collideCircle(nx, this.y, CONFIG.playerRadius)) this.x = nx;
      if (!world.collideCircle(this.x, ny, CONFIG.playerRadius)) this.y = ny;
      world.clampToWorld(this, CONFIG.playerRadius + 4);
      this.speed = speed;
    } else {
      this.speed = 0;
    }
    // Aim at the mouse (screen -> world).
    const cam = game.camera;
    const wx = input.mouseX + (cam.x - game.canvas.width / 2);
    const wy = input.mouseY + (cam.y - game.canvas.height / 2);
    this.aim = Math.atan2(wy - this.y, wx - this.x);
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.hurtCooldown > 0) this.hurtCooldown -= dt;
    // Shooting: mouse held OR the edge flag (a very quick click still fires).
    if ((input.mouseDown || input.mouseJustPressed) && this.fireCooldown <= 0) {
      this.shoot(game);
    }
    // Nearest car for the E prompt.
    this.nearCar = null;
    let best = 70;
    for (const car of game.cars) {
      if (car.isPlayer) continue;
      const d = Math.hypot(car.x - this.x, car.y - this.y);
      if (d < best) { best = d; this.nearCar = car; }
    }
  }

  shoot(game) {
    // The weapons system (systems builder) owns fire logic when loaded;
    // this base path fires the pistol so the base game shoots standalone.
    if (game.weapons && game.weapons.fire) {
      game.weapons.fire(game);
      return;
    }
    if (this.ammo <= 0) return;
    this.ammo -= 1;
    this.fireCooldown = CONFIG.weapons.pistol.rate;
    const spread = (Math.random() - 0.5) * CONFIG.weapons.pistol.spread * 2;
    game.bullets.push({
      x: this.x + Math.cos(this.aim) * 20,
      y: this.y + Math.sin(this.aim) * 20,
      angle: this.aim + spread,
      speed: 900,
      damage: CONFIG.weapons.pistol.damage,
      range: CONFIG.weapons.pistol.range,
      travelled: 0,
      fromPlayer: true,
    });
    game.audio.gunshot();
    game.addHeat(0.6);
    game.spawnParticles(this.x + Math.cos(this.aim) * 22, this.y + Math.sin(this.aim) * 22, 4, '#ffd23f');
  }
}
