// game-renderer.js — WebGL Board Renderer (PixiJS)
// Requires window.PIXI from PixiJS CDN

const POWERUP_EMOJI = {
    destroy: '💣', ghost: '👻', freeze: '❄', wall: '🧱',
    return: '↩', chaos: '🔀', double_turn: '🔁', hourglass: '⏳',
    time_bonus: '⏱', star: '⭐'
};

const POWERUP_COLOR = {
    destroy: 0xef4444, ghost: 0xa855f7, freeze: 0x0ea5e9, wall: 0xf97316,
    return: 0x10b981, chaos: 0xd946ef, double_turn: 0xeab308, hourglass: 0xb45309,
    time_bonus: 0x3b82f6, star: 0xffd700
};

export class GameRenderer {
    constructor(container) {
        this.COLS = 7;
        this.ROWS = 9;
        this.gap = 4;
        this.isFlipped = false;
        this._t = 0;
        this._state = null;
        this._pending = null;
        this._validMoves = null;
        this._hoverWall = null;
        this._container = container;

        this.onCellClick = null;
        this.onCellHover = null;
        this.onCellLeave = null;

        this._calcSize();
        this._initApp(container);
        this._initLayers();
        this._drawGrid();
        this._initEvents();
        this._startTicker();

        // Resize on orientation/window change
        const ro = new ResizeObserver(() => this._onResize());
        ro.observe(container);
        this._ro = ro;
    }

    // ─── Size & Layout ───────────────────────────────────────────────────────

    _calcSize() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const cont = this._container;
        let availH, availW;
        if (cont && cont.clientHeight > 60 && cont.clientWidth > 60) {
            availH = cont.clientHeight - 12;
            availW = cont.clientWidth - 12;
        } else {
            availH = vh - 256;
            availW = Math.min(vw - 16, 420);
        }
        const byH = Math.floor((availH - (this.ROWS - 1) * this.gap) / this.ROWS);
        const byW = Math.floor((availW - (this.COLS - 1) * this.gap) / this.COLS);
        this.cs = Math.max(24, Math.min(byH, byW, 62));
        this.cw = this.COLS * this.cs + (this.COLS - 1) * this.gap;
        this.ch = this.ROWS * this.cs + (this.ROWS - 1) * this.gap;
    }

    _initApp(container) {
        this._container = container;
        this.app = new PIXI.Application({
            width: this.cw,
            height: this.ch,
            backgroundColor: 0x141824,
            antialias: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoDensity: true,
            powerPreference: 'high-performance',
        });
        const cv = this.app.view;
        cv.style.cssText = [
            'display:block',
            'touch-action:none',
            'user-select:none',
            '-webkit-user-select:none',
            'max-width:100%',
            'max-height:100%',
            'border-radius:8px',
        ].join(';');
        container.innerHTML = '';
        container.appendChild(cv);
    }

    _initLayers() {
        this.bgG = new PIXI.Graphics();
        this.hlG = new PIXI.Graphics();
        this.wallG = new PIXI.Graphics();
        this.hoverG = new PIXI.Graphics();
        this.powerupC = new PIXI.Container();
        this.playerG = new PIXI.Graphics();
        [this.bgG, this.hlG, this.wallG, this.hoverG, this.powerupC, this.playerG]
            .forEach(l => this.app.stage.addChild(l));
    }

    // ─── Coordinate helpers ───────────────────────────────────────────────────

    // Data cell (cx,cy) → canvas pixel top-left
    _cp(cx, cy) {
        const vx = this.isFlipped ? this.COLS - 1 - cx : cx;
        const vy = this.isFlipped ? this.ROWS - 1 - cy : cy;
        return { x: vx * (this.cs + this.gap), y: vy * (this.cs + this.gap) };
    }

    // Canvas pixel → data cell
    _pc(px, py) {
        const vx = Math.max(0, Math.min(this.COLS - 1, Math.floor(px / (this.cs + this.gap))));
        const vy = Math.max(0, Math.min(this.ROWS - 1, Math.floor(py / (this.cs + this.gap))));
        return this.isFlipped
            ? { x: this.COLS - 1 - vx, y: this.ROWS - 1 - vy }
            : { x: vx, y: vy };
    }

    // Data gap (gx,gy,type) → canvas pixel rect {x,y,w,h}
    _wp(gx, gy, type) {
        const cs = this.cs, g = this.gap;
        const thick = Math.max(5, Math.round(cs * 0.1));
        if (!this.isFlipped) {
            if (type === 'vertical')
                return { x: (gx + 1) * (cs + g) - g / 2 - thick / 2, y: gy * (cs + g), w: thick, h: 2 * cs + g };
            return { x: gx * (cs + g), y: (gy + 1) * (cs + g) - g / 2 - thick / 2, w: 2 * cs + g, h: thick };
        }
        if (type === 'vertical')
            return { x: (this.COLS - 1 - gx) * (cs + g) - g / 2 - thick / 2, y: (this.ROWS - 2 - gy) * (cs + g), w: thick, h: 2 * cs + g };
        return { x: (this.COLS - 2 - gx) * (cs + g), y: (this.ROWS - 1 - gy) * (cs + g) - g / 2 - thick / 2, w: 2 * cs + g, h: thick };
    }

    // ─── Grid background ──────────────────────────────────────────────────────

    _drawGrid() {
        const g = this.bgG;
        g.clear();
        for (let cy = 0; cy < this.ROWS; cy++) {
            for (let cx = 0; cx < this.COLS; cx++) {
                const { x, y } = this._cp(cx, cy);
                const isGoal = cy === 0 || cy === this.ROWS - 1;
                g.beginFill(isGoal ? 0x162038 : 0x1e2640)
                    .drawRoundedRect(x, y, this.cs, this.cs, 5)
                    .endFill();
                // Subtle border
                g.lineStyle(1, 0xffffff, 0.05)
                    .drawRoundedRect(x, y, this.cs, this.cs, 5)
                    .lineStyle(0);
            }
        }
        // Goal row accent lines
        for (let cx = 0; cx < this.COLS; cx++) {
            for (const cy of [0, this.ROWS - 1]) {
                const { x, y } = this._cp(cx, cy);
                const accentColor = cy === 0 ? 0xff6b9d : 0x5b7cff;
                const accentY = cy === 0 ? y : y + this.cs - 2;
                if (!this.isFlipped || cy !== 0) { // avoid double drawing
                    g.beginFill(accentColor, 0.4)
                        .drawRect(x, accentY, this.cs, 2)
                        .endFill();
                }
            }
        }
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    _initEvents() {
        const cv = this.app.view;

        cv.addEventListener('pointerdown', e => {
            e.preventDefault();
            const p = this._evPos(e);
            const { x: cx, y: cy } = this._pc(p.x, p.y);
            const vx = this.isFlipped ? this.COLS - 1 - cx : cx;
            const vy = this.isFlipped ? this.ROWS - 1 - cy : cy;
            const ox = p.x - vx * (this.cs + this.gap);
            const oy = p.y - vy * (this.cs + this.gap);
            if (this.onCellClick) this.onCellClick(cx, cy, ox, oy, this.cs, this.isFlipped);
            if (navigator.vibrate) navigator.vibrate(8);
        }, { passive: false });

        cv.addEventListener('pointermove', e => {
            const p = this._evPos(e);
            const { x: cx, y: cy } = this._pc(p.x, p.y);
            const vx = this.isFlipped ? this.COLS - 1 - cx : cx;
            const vy = this.isFlipped ? this.ROWS - 1 - cy : cy;
            const ox = p.x - vx * (this.cs + this.gap);
            const oy = p.y - vy * (this.cs + this.gap);
            if (this.onCellHover) this.onCellHover(cx, cy, ox, oy, this.cs, this.isFlipped);
        }, { passive: true });

        cv.addEventListener('pointerleave', () => { this.clearHover(); if (this.onCellLeave) this.onCellLeave(); });
        cv.addEventListener('pointercancel', () => { this.clearHover(); if (this.onCellLeave) this.onCellLeave(); });
        cv.addEventListener('contextmenu', e => e.preventDefault());
    }

    _evPos(e) {
        const r = this.app.view.getBoundingClientRect();
        const sx = this.cw / r.width, sy = this.ch / r.height;
        return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    }

    // ─── Ticker / Animations ─────────────────────────────────────────────────

    _startTicker() {
        this.app.ticker.add(dt => {
            this._t += dt * 0.03;
            this._animHighlights();
            this._animPlayers();
        });
    }

    _animHighlights() {
        const g = this.hlG;
        g.clear();

        // Valid move cells
        if (this._validMoves?.length) {
            const pulse = 0.22 + 0.13 * Math.sin(this._t * 2.2);
            const borderAlpha = 0.55 + 0.45 * Math.sin(this._t * 2.2);
            this._validMoves.forEach(m => {
                const { x, y } = this._cp(m.x, m.y);
                g.beginFill(0x5b7cff, pulse).drawRoundedRect(x, y, this.cs, this.cs, 5).endFill();
                g.lineStyle(2, 0x5b7cff, borderAlpha).drawRoundedRect(x + 1, y + 1, this.cs - 2, this.cs - 2, 5).lineStyle(0);
            });
        }

        // Pending wall (flashing amber)
        if (this._pending?.type === 'wall') {
            const r = this._wp(this._pending.x, this._pending.y, this._pending.orientation);
            const fl = 0.5 + 0.5 * Math.abs(Math.sin(this._t * 4.5));
            g.beginFill(0xf59e0b, fl).drawRoundedRect(r.x, r.y, r.w, r.h, 2).endFill();
            g.lineStyle(1, 0xffd700, fl * 0.7).drawRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2).lineStyle(0);
        }
    }

    _animPlayers() {
        if (!this._state) return;
        const g = this.playerG;
        g.clear();

        ['p1', 'p2'].forEach((pid, i) => {
            const p = this._state.players[pid];
            if (!p) return;
            const { x: px, y: py } = this._cp(p.x, p.y);
            const cx = px + this.cs / 2, cy = py + this.cs / 2;
            const r = this.cs * 0.36;
            const color = pid === 'p1' ? 0x5b7cff : 0xff6b9d;
            const glowR = r + 2 + 2 * Math.sin(this._t * 1.8 + i * Math.PI);

            // Outer glow
            g.beginFill(color, 0.15).drawCircle(cx, cy, glowR).endFill();
            // Shadow ellipse
            g.beginFill(0x000000, 0.28).drawEllipse(cx, py + this.cs - 3, r * 0.55, r * 0.18).endFill();
            // Body
            g.beginFill(color).drawCircle(cx, cy, r).endFill();
            // Highlight
            g.beginFill(0xffffff, 0.28).drawCircle(cx - r * 0.27, cy - r * 0.28, r * 0.36).endFill();
        });
    }

    // ─── State-driven redraws ─────────────────────────────────────────────────

    update(state, pendingAction, validMoves) {
        this._state = state;
        this._pending = pendingAction;
        this._validMoves = validMoves;
        this._drawWalls(state.walls, pendingAction);
        this._drawPowerups(state.powerups);
    }

    _drawWalls(walls) {
        const g = this.wallG;
        g.clear();
        (walls || []).forEach(w => {
            const r = this._wp(w.x, w.y, w.type);
            const c = w.owner === 'p1' ? 0x5b7cff : w.owner === 'p2' ? 0xff6b9d : 0xffffff;
            g.beginFill(c).drawRoundedRect(r.x, r.y, r.w, r.h, 2).endFill();
            g.lineStyle(1, 0xffffff, 0.15).drawRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2).lineStyle(0);
        });
    }

    _drawPowerups(powerups) {
        this.powerupC.removeChildren();
        if (!powerups?.length) return;
        const fs = Math.max(10, Math.round(this.cs * 0.36));

        powerups.forEach(p => {
            const { x: px, y: py } = this._cp(p.x, p.y);
            const cx = px + this.cs / 2, cy = py + this.cs / 2;
            const color = POWERUP_COLOR[p.type] || 0xffffff;
            const emoji = POWERUP_EMOJI[p.type] || '?';

            const bg = new PIXI.Graphics();
            const r2 = this.cs * 0.3;
            bg.beginFill(color, 0.2).drawCircle(cx, cy, r2).endFill();
            bg.lineStyle(1.5, color, 0.5).drawCircle(cx, cy, r2).lineStyle(0);
            this.powerupC.addChild(bg);

            const txt = new PIXI.Text(emoji, { fontSize: fs, align: 'center' });
            txt.anchor.set(0.5);
            txt.x = cx; txt.y = cy;
            // Star legendary gets scale pulse via ticker
            if (p.type === 'star') {
                this.app.ticker.addOnce(() => {
                    this.app.ticker.add(() => {
                        if (txt.destroyed) return;
                        txt.scale.set(1 + 0.08 * Math.sin(this._t * 3));
                    });
                });
            }
            this.powerupC.addChild(txt);
        });
    }

    // ─── Hover ────────────────────────────────────────────────────────────────

    setHover(wallInfo) {
        this._hoverWall = wallInfo;
        const g = this.hoverG;
        g.clear();
        if (!wallInfo) return;
        const r = this._wp(wallInfo.x, wallInfo.y, wallInfo.orientation);
        g.beginFill(0x5b7cff, 0.42).drawRoundedRect(r.x, r.y, r.w, r.h, 2).endFill();
        g.lineStyle(1, 0x8fa4ff, 0.6).drawRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2).lineStyle(0);
    }

    clearHover() {
        if (this._hoverWall) {
            this._hoverWall = null;
            this.hoverG.clear();
        }
    }

    // ─── Config ───────────────────────────────────────────────────────────────

    setFlipped(f) {
        this.isFlipped = f;
        this._drawGrid();
        if (this._state) this.update(this._state, this._pending, this._validMoves);
    }

    _onResize() {
        this._calcSize();
        this.app.renderer.resize(this.cw, this.ch);
        this._drawGrid();
        this.clearHover();
        if (this._state) this.update(this._state, this._pending, this._validMoves);
    }

    destroy() {
        this._ro.disconnect();
        this.app.destroy(true, { children: true });
    }
}
