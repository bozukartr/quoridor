// game-renderer.js — WebGL Board Renderer (PixiJS)
// Requires window.PIXI from PixiJS CDN

import { powerupGlyph, powerupColor } from "./powerups.js";

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
        // #board-canvas-container is sized by CSS (100% of the board card), so its
        // box is the real available space and not a shrink-wrap of the canvas.
        if (cont && cont.clientHeight > 40 && cont.clientWidth > 40) {
            const st = getComputedStyle(cont);
            availW = cont.clientWidth - (parseFloat(st.paddingLeft) || 0) - (parseFloat(st.paddingRight) || 0);
            availH = cont.clientHeight - (parseFloat(st.paddingTop) || 0) - (parseFloat(st.paddingBottom) || 0);
        } else {
            availH = vh - 240;
            availW = Math.min(vw - 20, 548);
        }
        this.gap = availW < 300 ? 3 : 4;
        const byH = Math.floor((availH - (this.ROWS - 1) * this.gap) / this.ROWS);
        const byW = Math.floor((availW - (this.COLS - 1) * this.gap) / this.COLS);
        this.cs = Math.max(20, Math.min(byH, byW, 96));
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

    // Canvas pikseli → verilen yöndeki EN YAKIN duvar yuvası (data koordinatı).
    // _wp'nin tersidir: yuva merkezine olan gerçek mesafeye göre snap eder.
    slotAt(px, py, type) {
        const step = this.cs + this.gap;
        let gx, gy;
        if (type === 'vertical') {
            // Dikey yuva (gx,gy): merkez = ((gx+1)*step - gap/2, gy*step + cs + gap/2)
            gx = Math.round((px + this.gap / 2) / step) - 1;
            gy = Math.round((py - this.cs - this.gap / 2) / step);
        } else {
            gx = Math.round((px - this.cs - this.gap / 2) / step);
            gy = Math.round((py + this.gap / 2) / step) - 1;
        }
        const vx = Math.max(0, Math.min(this.COLS - 2, gx));
        const vy = Math.max(0, Math.min(this.ROWS - 2, gy));
        // Görüntü koordinatı → data koordinatı (tahta çevrilmişse aynala).
        // _wp iki yönde de aynı aynalamayı kullanıyor.
        return this.isFlipped
            ? { x: this.COLS - 2 - vx, y: this.ROWS - 2 - vy }
            : { x: vx, y: vy };
    }

    // Ekran (client) koordinatı → canvas içi piksel. Sürükleme canvas dışında
    // başladığı için pointer olayları buraya gelmiyor, dönüşümü dışarıya açıyoruz.
    clientToCanvas(clientX, clientY) {
        const r = this.app.view.getBoundingClientRect();
        return {
            x: (clientX - r.left) * (this.cw / r.width),
            y: (clientY - r.top) * (this.ch / r.height),
            inside: clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom,
            rect: r
        };
    }

    // Bir karenin ekran üzerindeki yüksekliği — sürükleme ofsetini buna göre ayarlarız.
    get cellScreenSize() {
        const r = this.app.view.getBoundingClientRect();
        return (this.cs + this.gap) * (r.height / this.ch);
    }

    // Canvas pikseline en yakın duvarı bulur (duvar kırıcı sürüklemesi için).
    nearestWall(px, py, walls, maxDist) {
        let best = null, bestD = Infinity;
        for (const w of (walls || [])) {
            const r = this._wp(w.x, w.y, w.type);
            const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
            // Dikdörtgene olan mesafe (uzun kenar boyunca tolerans daha yüksek)
            const dx = Math.max(0, Math.abs(px - cx) - r.w / 2);
            const dy = Math.max(0, Math.abs(py - cy) - r.h / 2);
            const d = Math.hypot(dx, dy);
            if (d < bestD) { bestD = d; best = w; }
        }
        return bestD <= (maxDist ?? this.cs * 0.8) ? best : null;
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

        // Not: hayaleti burada temizlemiyoruz — sürükleme oturumu canvas dışında
        // (düğme üzerinde) yaşıyor ve hayaletin sahibi o.
        cv.addEventListener('pointerleave', () => { if (this.onCellLeave) this.onCellLeave(); });
        cv.addEventListener('pointercancel', () => { if (this.onCellLeave) this.onCellLeave(); });
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
            const color = powerupColor(p.type);
            const glyph = powerupGlyph(p.type);

            const bg = new PIXI.Graphics();
            const r2 = this.cs * 0.3;
            bg.beginFill(color, 0.2).drawCircle(cx, cy, r2).endFill();
            bg.lineStyle(1.5, color, 0.5).drawCircle(cx, cy, r2).lineStyle(0);
            this.powerupC.addChild(bg);

            // Envanterdeki ikonun aynısı: aynı glif, aynı renk
            const txt = new PIXI.Text(glyph.text, {
                fontSize: fs,
                fontFamily: glyph.fontFamily,
                fontWeight: glyph.fontWeight,
                align: 'center',
                fill: color
            });
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

    // ─── Sürükleme hayaleti ───────────────────────────────────────────────────

    /**
     * Sürükleme sırasında gösterilen hayalet.
     *  { kind: 'wall', x, y, orientation, valid }  → yuvaya oturmuş duvar (yeşil/kırmızı)
     *  { kind: 'destroy', wall }                   → hedeflenen duvar (yoksa wall: null)
     *  null                                        → temizle
     */
    setDragGhost(ghost) {
        this._hoverWall = ghost;
        const g = this.hoverG;
        g.clear();
        if (!ghost) return;

        if (ghost.kind === 'destroy') {
            if (!ghost.wall) return;
            const r = this._wp(ghost.wall.x, ghost.wall.y, ghost.wall.type);
            g.beginFill(0xef4444, 0.55).drawRoundedRect(r.x, r.y, r.w, r.h, 2).endFill();
            // Duvarın ortasına çarpı
            const cx = r.x + r.w / 2, cy = r.y + r.h / 2, s = Math.max(8, this.cs * 0.26);
            g.lineStyle(Math.max(3, this.cs * 0.07), 0xff6b6b, 0.95);
            g.moveTo(cx - s, cy - s).lineTo(cx + s, cy + s);
            g.moveTo(cx + s, cy - s).lineTo(cx - s, cy + s);
            g.lineStyle(0);
            return;
        }

        const r = this._wp(ghost.x, ghost.y, ghost.orientation);
        const fill = ghost.valid ? 0x22c55e : 0xef4444;
        const line = ghost.valid ? 0x86efac : 0xfca5a5;
        g.beginFill(fill, 0.5).drawRoundedRect(r.x, r.y, r.w, r.h, 2).endFill();
        g.lineStyle(1.5, line, 0.85).drawRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2).lineStyle(0);
        // Yuvanın iki ucuna küçük işaret: hangi boşluğa oturduğu net görünsün
        const capR = Math.max(2, this.cs * 0.06);
        g.beginFill(line, 0.9);
        if (ghost.orientation === 'vertical') {
            g.drawCircle(r.x + r.w / 2, r.y + capR, capR).drawCircle(r.x + r.w / 2, r.y + r.h - capR, capR);
        } else {
            g.drawCircle(r.x + capR, r.y + r.h / 2, capR).drawCircle(r.x + r.w - capR, r.y + r.h / 2, capR);
        }
        g.endFill();
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
        const pw = this.cw, ph = this.ch;
        this._calcSize();
        // Only touch the renderer when the size really changed, so a ResizeObserver
        // tick can never feed back into another resize.
        if (this.cw !== pw || this.ch !== ph) this.app.renderer.resize(this.cw, this.ch);
        this._drawGrid();
        this.clearHover();
        if (this._state) this.update(this._state, this._pending, this._validMoves);
    }

    destroy() {
        this._ro.disconnect();
        this.app.destroy(true, { children: true });
    }
}
