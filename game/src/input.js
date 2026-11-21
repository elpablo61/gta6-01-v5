// Crescent Bay — keyboard + mouse input. The game reads `keys` and the
// mouse every frame; edge flags (just pressed) are cleared at the END of
// the frame update, after all gameplay code has read them, so a very quick
// click is never lost.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.mouseJustPressed = false;
    this.mouseJustReleased = false;
    this.canvas = canvas;
    this._onKeyDown = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!this.keys.has(k)) this.justPressed.add(k);
      this.keys.add(k);
    };
    this._onKeyUp = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k);
    };
    this._onMouseMove = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    };
    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      this._onMouseMove(e);
      if (!this.mouseDown) this.mouseJustPressed = true;
      this.mouseDown = true;
    };
    this._onMouseUp = (e) => {
      if (e.button !== 0) return;
      this.mouseDown = false;
      this.mouseJustReleased = true;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(key) {
    return this.keys.has(key);
  }

  pressed(key) {
    return this.justPressed.has(key);
  }

  // Call at the very end of each frame, after gameplay has read the flags.
  endFrame() {
    this.justPressed.clear();
    this.mouseJustPressed = false;
    this.mouseJustReleased = false;
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
  }
}
