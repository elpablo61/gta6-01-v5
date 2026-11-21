// Crescent Bay — saves: 3 versioned slots in localStorage. A corrupt slot
// shows as corrupt and can be overwritten; it never crashes the title
// screen. Autosave runs when a mission completes.

import { SAVE_VERSION } from './config.js';

export function saveGame(game) {
  return Save.save(game, game.activeSlot || 0);
}

export function loadGame(slot) {
  return Save.load(slot);
}

export function autosave(game) {
  return Save.save(game, game.activeSlot || 0);
}

function slotKey(slot) {
  return `crescent-bay-save-v${SAVE_VERSION}-slot-${slot}`;
}

export const Save = {
  slotCount: 3,

  save(game, slot) {
    const data = {
      version: SAVE_VERSION,
      date: new Date().toISOString(),
      cash: Math.floor(game.cash),
      missionIndex: game.missionIndex || 0,
      completedMissions: game.completedMissions || [],
      player: {
        x: game.player.x,
        y: game.player.y,
        hp: game.player.hp,
        ammo: game.player.ammo,
      },
      heat: game.heat || 0,
      timeOfDay: game.timeOfDay || 0.3,
      radioStation: game.radioStation || 'Bay FM',
      weapons: game.weapons ? { owned: game.weapons.owned, ammo: game.weapons.ammo } : null,
    };
    try {
      localStorage.setItem(slotKey(slot), JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },

  load(slot) {
    let raw = null;
    try {
      raw = localStorage.getItem(slotKey(slot));
    } catch {
      return { ok: false, corrupt: false, empty: true };
    }
    if (raw === null || raw === '') return { ok: false, corrupt: false, empty: true };
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, corrupt: true, empty: false };
    }
    if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION) {
      return { ok: false, corrupt: true, empty: false };
    }
    return { ok: true, data };
  },

  // Slot summaries for the title screen: mission progress, cash, date —
  // or "Empty" / "Corrupt" (never a crash).
  listSlots() {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const r = this.load(i);
      if (r.ok) {
        out.push({
          slot: i, empty: false, corrupt: false,
          missionIndex: r.data.missionIndex || 0,
          cash: r.data.cash || 0,
          date: r.data.date || '',
        });
      } else if (r.corrupt) {
        out.push({ slot: i, empty: false, corrupt: true, missionIndex: 0, cash: 0, date: '' });
      } else {
        out.push({ slot: i, empty: true, corrupt: false, missionIndex: 0, cash: 0, date: '' });
      }
    }
    return out;
  },

  applyToGame(game, data) {
    game.cash = data.cash || 0;
    game.missionIndex = data.missionIndex || 0;
    game.completedMissions = data.completedMissions || [];
    game.heat = data.heat || 0;
    game.timeOfDay = data.timeOfDay || 0.3;
    game.radioStation = data.radioStation || 'Bay FM';
    if (data.player) {
      game.player.x = data.player.x;
      game.player.y = data.player.y;
      game.player.hp = data.player.hp || game.player.maxHp;
      game.player.ammo = data.player.ammo || 0;
    }
    if (data.weapons && game.weapons) {
      game.weapons.owned = data.weapons.owned || ['pistol'];
      game.weapons.ammo = data.weapons.ammo || { pistol: 48 };
    }
  },
};
