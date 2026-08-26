// howto.js — İnteraktif oyun rehberi.
//
// Rehber, oyunun kendi parçalarını kullanır: tahta aynı GameRenderer ile çizilir,
// kurallar ai.js'ten, güçlendirme ikonları powerups.js'ten gelir. Böylece oyunda
// bir şey değiştiğinde rehber eskimez ve öğrettiği hareketler birebir tutar.

import { GameRenderer } from "./game-renderer.js";
import { getValidMoves, wallInvalidReason } from "./ai.js";
import { POWERUP_INFO, INVENTORY_TYPES, powerupIconClass, powerupCssColor, powerupRgba } from "./powerups.js";

const COLS = 7;
const ROWS = 9;

// Oyundaki sürükleme hissiyle birebir aynı olsun diye aynı sabitler
const DRAG_LIFT_CELLS = { vertical: 1.6, horizontal: 0.7, destroy: 1.0 };
const DRAG_MOVE_THRESHOLD = 6;

const WALL_ERRORS = {
    'overlap': 'Burada zaten duvar var!',
    'blocks-path': 'Yolu tamamen kapatamazsın!',
    'blocks-powerup': 'Özelliklerin önü tamamen kapatılamaz!',
    'out-of-board': 'Duvar tahtanın dışına konamaz!'
};

// --- Dersler ---------------------------------------------------------------
// setup: tahtanın başlangıç hâli. ui: hangi kontroller görünsün.
// goal: { text, total, accept(olay, bağlam) } — accept true dönerse ilerleme artar.

const LESSONS = [
    {
        id: 'amac',
        topics: ['goal'],
        title: 'Oyunun Amacı',
        text: 'Sen mavi taşsın. Amacın taşını karşı kenara — en üst sıraya — ulaştırmak; rakip (pembe) ise tam tersini yapmaya çalışıyor. Bu örnekte hedefe iki kare kaldı.',
        setup: { p1: { x: 3, y: 6 }, p2: { x: 3, y: 0 } },
        ui: {},
        goal: {
            text: 'Taşını en üst sıraya ulaştır',
            total: 1,
            accept: (ev, ctx) => ev.type === 'move' && ctx.state.players.p1.y === ROWS - 1
        },
        done: 'İşte bu! Karşı kenara ulaşan ilk oyuncu kazanır.'
    },
    {
        id: 'hareket',
        topics: ['movement'],
        title: 'Hareket',
        text: 'Sıra sendeyken taşını bir kare ileri, geri, sağa ya da sola oynatabilirsin. Çapraz gidemezsin. Gidebileceğin kareler tahtada işaretli görünür.',
        setup: { p1: { x: 3, y: 2 }, p2: { x: 3, y: 8 } },
        ui: {},
        goal: {
            text: 'İki hamle yap',
            total: 2,
            accept: (ev) => ev.type === 'move'
        },
        done: 'Hareket tamam. Şimdi rakibin üzerinden atlamayı görelim.'
    },
    {
        id: 'ziplama',
        topics: ['jump'],
        title: 'Rakibin Üzerinden Atlama',
        text: 'Rakip tam önünde duruyorsa onun üzerinden atlarsın: arkasındaki kareye geçersin. Arkası duvarla kapalıysa yandan dolanırsın.',
        setup: { p1: { x: 3, y: 3 }, p2: { x: 3, y: 4 } },
        ui: {},
        goal: {
            text: 'Rakibin üzerinden atla',
            total: 1,
            accept: (ev, ctx) => ev.type === 'move' && ctx.state.players.p1.y >= 5
        },
        done: 'Atladın! Rakip artık arkanda kaldı.'
    },
    {
        id: 'duvar',
        topics: ['wall'],
        title: 'Duvar Koyma',
        text: 'Duvarlar rakibi yavaşlatır. Alttaki "Dikey" veya "Yatay" düğmesine bas ve parmağını kaldırmadan tahtaya sürükle. Duvar, parmağının biraz yukarısında hayalet olarak görünür ve en yakın yuvaya oturur. Parmağını kaldırdığın an konur — onay yok.',
        setup: { p1: { x: 3, y: 2 }, p2: { x: 3, y: 6 }, walls: 8 },
        ui: { walls: true },
        goal: {
            text: 'Bir dikey ve bir yatay duvar koy',
            total: 2,
            accept: (ev, ctx) => {
                if (ev.type !== 'wall' || ctx.seen.has(ev.orientation)) return false;
                ctx.seen.add(ev.orientation);
                return true;
            }
        },
        done: 'Duvar koymayı öğrendin. Her oyuncunun 8 duvarı vardır.'
    },
    {
        id: 'duvar-kurali',
        topics: ['wall-rule'],
        title: 'Yolu Tamamen Kapatamazsın',
        text: 'Duvarla rakibi yavaşlatabilirsin ama yolunu tamamen kapatamazsın. Rakip köşeye sıkışmış: tek bir yatay duvar onu tamamen kapatır. Sürüklerken hayalet yeşilse konabilir, kırmızıysa konamaz — kırmızıyken bıraksan bile duvar hakkın ve sıran yanmaz.',
        // Rakip köşede: tek bir yatay duvar onu tamamen kapatır, oyun buna izin vermez.
        setup: {
            p1: { x: 3, y: 2 }, p2: { x: 0, y: 8 }, walls: 8,
            board: [{ x: 0, y: 7, type: 'vertical' }]
        },
        ui: { walls: true },
        goal: {
            text: 'Kırmızı hayaleti gör: rakibi tamamen kapatmayı dene',
            total: 1,
            accept: (ev) => ev.type === 'invalid-wall'
        },
        done: 'Gördün mü? Oyun bu hamleye izin vermiyor; rakibin her zaman bir yolu kalmalı.'
    },
    {
        id: 'duvar-kirici',
        topics: ['destroy'],
        title: 'Duvar Kırıcı',
        text: 'Önünü kapatan bir duvar mı var? Duvar Kırıcı güçlendirmesini de aynı şekilde sürüklersin: bombayı duvarın üstüne getir, ✖ işareti hangi duvardaysa o kırılır.',
        setup: {
            p1: { x: 3, y: 3 }, p2: { x: 3, y: 8 }, walls: 8,
            board: [{ x: 2, y: 3, type: 'horizontal' }],
            inventory: { destroy: 1 }
        },
        ui: { walls: true, powerups: ['destroy'] },
        goal: {
            text: 'Önündeki duvarı kır',
            total: 1,
            accept: (ev) => ev.type === 'destroy'
        },
        done: 'Duvar gitti, yolun açıldı.'
    },
    {
        id: 'guclendirme',
        topics: ['powerup', 'freeze'],
        title: 'Güçlendirme Toplama',
        text: 'Tahtada beliren güçlendirmelerin üzerine gelirsen onları toplarsın. Toplananlar alttaki envanterine düşer; kullanmak için envanterdeki simgeye dokunman yeterli.',
        setup: {
            p1: { x: 3, y: 3 }, p2: { x: 3, y: 8 },
            powerups: [{ x: 3, y: 4, type: 'freeze' }]
        },
        ui: { powerups: [] },
        goal: {
            text: 'Dondurucuyu topla ve kullan',
            total: 2,
            accept: (ev, ctx) => {
                if (ev.type === 'collect' && !ctx.seen.has('collect')) { ctx.seen.add('collect'); return true; }
                if (ev.type === 'use' && ctx.seen.has('collect') && !ctx.seen.has('use')) { ctx.seen.add('use'); return true; }
                return false;
            }
        },
        done: 'Dondurulan oyuncu bir tur duvar koyamaz — ama hareket edebilir.'
    },
    {
        id: 'ozet',
        topics: ['summary', 'chaos', 'double_turn', 'hourglass', 'return', 'ghost', 'wall_plus', 'time_bonus', 'star'],
        title: 'Tüm Güçlendirmeler',
        text: 'Oyun sırasında tahtada beliren güçlendirmeler bunlar. Süre de önemli: her oyuncunun toplam 90 saniyesi vardır, süresi biten kaybeder.',
        setup: { p1: { x: 3, y: 0 }, p2: { x: 3, y: 8 }, hideBoard: true },
        ui: { guide: true },
        goal: { text: 'Hazırsan oyuna başla', total: 0 },
        done: ''
    }
];

const POWERUP_DESC = {
    destroy: 'Seçtiğin bir duvarı yok eder.',
    ghost: 'Bir sonraki hamlende duvarların içinden geçersin.',
    freeze: 'Rakip bir tur duvar koyamaz.',
    wall: 'Duvar hakkını bir artırır.',
    return: 'Rakibi başlangıç noktasına geri gönderir.',
    chaos: 'Rakibin sonraki hamlesi rastgele bir yöne sapar.',
    double_turn: 'Sıra tekrar sende: arka arkaya iki hamle.',
    hourglass: 'Rakibin süresinden 10 saniye siler.',
    time_bonus: 'Alan oyuncuya 10 saniye ekler.',
    star: 'Çok nadir: diğer güçlendirmelerden birer adet verir.'
};

// --- Durum -----------------------------------------------------------------

let renderer = null;
let lessonIndex = 0;
let state = null;
let ctx = null;          // { state, seen:Set }
let progress = 0;
let completed = false;
let drag = null;

const el = {
    title: document.getElementById('lesson-title'),
    text: document.getElementById('lesson-text'),
    taskText: document.getElementById('task-text'),
    taskIcon: document.getElementById('task-icon'),
    task: document.getElementById('lesson-task'),
    dots: document.getElementById('progress-dots'),
    nextBtn: document.getElementById('next-btn'),
    nextLabel: document.getElementById('next-label'),
    wallControls: document.getElementById('wall-controls'),
    wallCountValue: document.getElementById('wall-count-value'),
    powerupControls: document.getElementById('powerup-controls'),
    guide: document.getElementById('powerup-guide'),
    boardWrap: document.getElementById('board-wrap'),
    wallV: document.getElementById('wall-drag-vertical'),
    wallH: document.getElementById('wall-drag-horizontal')
};

// --- Yardımcılar -----------------------------------------------------------

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${msg}</span> <i class="fa-solid fa-${type === 'error' ? 'circle-exclamation' : 'circle-check'}"></i>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2600);
}

function buzz(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
}

function boardState() {
    return { cols: COLS, rows: ROWS, walls: state.walls, powerups: state.powerups, players: state.players };
}

function render() {
    if (!renderer) return;
    const moves = getValidMoves(boardState(), 'p1');
    renderer.update(state, null, moves);
}

// --- Ders yükleme ----------------------------------------------------------

function loadLesson(index) {
    lessonIndex = Math.max(0, Math.min(LESSONS.length - 1, index));
    const lesson = LESSONS[lessonIndex];
    const s = lesson.setup;

    state = {
        walls: (s.board || []).map(w => ({ ...w })),
        powerups: (s.powerups || []).map(p => ({ ...p })),
        players: {
            p1: { ...s.p1, wallsLeft: s.walls || 0, inventory: { ...(s.inventory || {}) } },
            p2: { ...s.p2, wallsLeft: s.walls || 0, inventory: {} }
        }
    };
    ctx = { state, seen: new Set() };
    progress = 0;
    completed = lesson.goal.total === 0;
    cancelDrag();

    el.title.textContent = lesson.title;
    el.text.textContent = lesson.text;
    el.boardWrap.classList.toggle('hidden', !!s.hideBoard);
    el.wallControls.classList.toggle('hidden', !lesson.ui.walls);
    el.guide.classList.toggle('hidden', !lesson.ui.guide);
    if (lesson.ui.guide) renderGuide();

    renderPowerupBar(lesson);
    updateWallCount();
    updateTask();
    renderDots();
    if (!s.hideBoard) render();
}

function updateTask() {
    const lesson = LESSONS[lessonIndex];
    const total = lesson.goal.total;

    if (total === 0) {
        el.task.classList.add('hidden');
    } else {
        el.task.classList.remove('hidden');
        el.taskText.textContent = total > 1
            ? `${lesson.goal.text} (${progress}/${total})`
            : lesson.goal.text;
        el.task.classList.toggle('done', completed);
        el.taskIcon.className = completed ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle';
    }

    const last = lessonIndex === LESSONS.length - 1;
    el.nextBtn.disabled = !completed;
    el.nextLabel.textContent = !completed
        ? (total ? 'Görevi tamamla' : 'Devam')
        : (last ? 'Oyuna başla' : 'Sonraki');
}

function renderDots() {
    el.dots.innerHTML = '';
    LESSONS.forEach((_, i) => {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'progress-dot' + (i === lessonIndex ? ' current' : '') + (i < lessonIndex ? ' passed' : '');
        d.setAttribute('aria-label', `${i + 1}. bölüm: ${LESSONS[i].title}`);
        d.addEventListener('click', () => loadLesson(i));
        el.dots.appendChild(d);
    });
}

function renderGuide() {
    el.guide.innerHTML = '';
    [...INVENTORY_TYPES, 'time_bonus', 'star'].forEach(type => {
        const info = POWERUP_INFO[type];
        const row = document.createElement('div');
        row.className = 'guide-row';
        row.style.setProperty('--pu-color', powerupCssColor(type));
        row.innerHTML = `
            <span class="guide-icon"><i class="${powerupIconClass(type)}"></i></span>
            <span class="guide-body">
                <strong>${info.label}</strong>
                <small>${POWERUP_DESC[type] || ''}</small>
            </span>`;
        el.guide.appendChild(row);
    });
}

// --- Görev takibi ----------------------------------------------------------

function emit(event) {
    const lesson = LESSONS[lessonIndex];
    if (completed || !lesson.goal.total) return;
    if (!lesson.goal.accept(event, ctx)) return;

    progress++;
    if (progress >= lesson.goal.total) {
        completed = true;
        buzz([12, 40, 12]);
        if (lesson.done) showToast(lesson.done, 'success');
    }
    updateTask();
}

// --- Tahta etkileşimi ------------------------------------------------------

function handleTap(cx, cy) {
    if (!state || LESSONS[lessonIndex].setup.hideBoard) return;
    if (drag) return;

    const moves = getValidMoves(boardState(), 'p1');
    if (!moves.some(m => m.x === cx && m.y === cy)) return;

    state.players.p1.x = cx;
    state.players.p1.y = cy;

    const idx = state.powerups.findIndex(p => p.x === cx && p.y === cy);
    if (idx !== -1) {
        const type = state.powerups[idx].type;
        state.powerups.splice(idx, 1);
        const inv = state.players.p1.inventory;
        inv[type] = (inv[type] || 0) + 1;
        showToast(`${POWERUP_INFO[type].label} alındı!`, 'success');
        renderPowerupBar(LESSONS[lessonIndex]);
        emit({ type: 'collect', powerup: type });
    }

    render();
    emit({ type: 'move', to: { x: cx, y: cy } });
}

// --- Güçlendirme envanteri -------------------------------------------------

function renderPowerupBar(lesson) {
    const shown = lesson.ui.powerups;
    if (!shown) {
        el.powerupControls.classList.add('hidden');
        el.powerupControls.innerHTML = '';
        return;
    }

    const inv = state.players.p1.inventory || {};
    const types = [...new Set([...shown, ...Object.keys(inv).filter(t => inv[t] > 0)])];
    el.powerupControls.classList.toggle('hidden', types.length === 0);
    el.powerupControls.innerHTML = '';

    types.forEach(type => {
        const count = inv[type] || 0;
        const btn = document.createElement('button');
        btn.id = `btn-${type}`;
        btn.className = 'inventory-btn' + (count > 0 ? ' active' : '');
        btn.title = POWERUP_INFO[type].label;
        btn.style.setProperty('--pu-color', powerupCssColor(type));
        btn.style.setProperty('--pu-glow', powerupRgba(type, 0.45));
        btn.innerHTML = `<i class="pu-icon ${powerupIconClass(type)}"></i> <span class="badge">${count}</span>`;

        if (type === 'destroy') {
            bindDragSource(btn, 'destroy');
        } else {
            btn.addEventListener('click', () => usePowerup(type));
        }
        el.powerupControls.appendChild(btn);
    });
}

function usePowerup(type) {
    const inv = state.players.p1.inventory || {};
    if ((inv[type] || 0) <= 0) {
        showToast('Bu güçlendirmeye sahip değilsin.', 'error');
        return;
    }
    inv[type] = inv[type] - 1;
    showToast(`${POWERUP_INFO[type].label} kullanıldı!`, 'success');
    renderPowerupBar(LESSONS[lessonIndex]);
    emit({ type: 'use', powerup: type });
}

// --- Sürükle-bırak (oyundaki ile aynı davranış) ----------------------------

function cancelDrag() {
    const d = drag;
    drag = null;
    if (d && d.el) d.el.classList.remove('dragging');
    if (renderer) renderer.setDragGhost(null);
}

function bindDragSource(source, kind) {
    if (!source) return;
    const isDestroy = kind === 'destroy';

    source.addEventListener('pointerdown', (e) => {
        if (drag || !state) return;
        if (isDestroy) {
            if ((state.players.p1.inventory.destroy || 0) <= 0) { showToast('Duvar kırıcın yok!', 'error'); return; }
            if (state.walls.length === 0) { showToast('Tahtada kırılacak duvar yok!', 'error'); return; }
        } else if ((state.players.p1.wallsLeft || 0) <= 0) {
            showToast('Duvar hakkın bitti!', 'error');
            return;
        }
        e.preventDefault();
        try { source.setPointerCapture(e.pointerId); } catch (_) { /* yoksay */ }
        drag = { kind, el: source, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, target: null };
        source.classList.add('dragging');
        buzz(8);
    }, { passive: false });

    source.addEventListener('pointermove', (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        e.preventDefault();
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_MOVE_THRESHOLD) {
            drag.moved = true;
        }
        if (drag.moved) updateGhost(e.clientX, e.clientY);
    }, { passive: false });

    const finish = (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        e.preventDefault();
        endDrag(e.type === 'pointercancel');
    };
    source.addEventListener('pointerup', finish);
    source.addEventListener('pointercancel', finish);
    source.addEventListener('lostpointercapture', () => { if (drag) cancelDrag(); });
}

function updateGhost(clientX, clientY) {
    if (!renderer) return;
    const lift = renderer.cellScreenSize * (DRAG_LIFT_CELLS[drag.kind] || 0.7);
    const p = renderer.clientToCanvas(clientX, clientY - lift);
    const pad = renderer.cs * 0.75;

    if (p.x < -pad || p.y < -pad || p.x > renderer.cw + pad || p.y > renderer.ch + pad) {
        drag.target = null;
        renderer.setDragGhost(null);
        return;
    }

    if (drag.kind === 'destroy') {
        const wall = renderer.nearestWall(p.x, p.y, state.walls);
        drag.target = wall || null;
        renderer.setDragGhost({ kind: 'destroy', wall });
        return;
    }

    const slot = renderer.slotAt(p.x, p.y, drag.kind);
    const reason = wallInvalidReason(boardState(), slot.x, slot.y, drag.kind);
    drag.target = { x: slot.x, y: slot.y, orientation: drag.kind, valid: !reason, reason };
    renderer.setDragGhost({ kind: 'wall', ...drag.target });
}

function endDrag(cancelled) {
    const d = drag;
    cancelDrag();
    if (cancelled || !d) return;

    if (!d.moved) {
        showToast(d.kind === 'destroy'
            ? 'Bombayı kırmak istediğin duvarın üzerine sürükle.'
            : 'Duvarı tahtada istediğin yere sürükleyip bırak.');
        return;
    }
    if (!d.target) return;

    if (d.kind === 'destroy') {
        state.walls = state.walls.filter(w => !(w.x === d.target.x && w.y === d.target.y && w.type === d.target.type));
        state.players.p1.inventory.destroy = Math.max(0, (state.players.p1.inventory.destroy || 0) - 1);
        renderPowerupBar(LESSONS[lessonIndex]);
        render();
        buzz(20);
        emit({ type: 'destroy' });
        return;
    }

    if (!d.target.valid) {
        showToast(WALL_ERRORS[d.target.reason] || 'Buraya duvar koyamazsın!', 'error');
        buzz([40, 60, 40]);
        emit({ type: 'invalid-wall', reason: d.target.reason });
        return;
    }

    state.walls.push({ x: d.target.x, y: d.target.y, type: d.target.orientation, owner: 'p1' });
    state.players.p1.wallsLeft = Math.max(0, (state.players.p1.wallsLeft || 0) - 1);
    updateWallCount();
    render();
    buzz(18);
    emit({ type: 'wall', orientation: d.target.orientation });
}

function updateWallCount() {
    const left = state ? (state.players.p1.wallsLeft || 0) : 0;
    el.wallCountValue.textContent = left;
    document.getElementById('wall-count').classList.toggle('empty', left <= 0);
    [el.wallV, el.wallH].forEach(b => b && b.classList.toggle('disabled', left <= 0));
}

// --- Başlangıç -------------------------------------------------------------

function init() {
    const container = document.getElementById('board-canvas-container');
    renderer = new GameRenderer(container);
    renderer.onCellClick = handleTap;
    renderer.setFlipped(true); // oyundaki gibi: sen alttasın

    bindDragSource(el.wallV, 'vertical');
    bindDragSource(el.wallH, 'horizontal');

    // Emniyet ağı: olay kaynağa ulaşmazsa sürükleme yine de kapansın
    ['pointerup', 'pointercancel'].forEach(type => {
        window.addEventListener(type, (e) => {
            if (!drag) return;
            if (drag.pointerId !== undefined && e.pointerId !== undefined && drag.pointerId !== e.pointerId) return;
            endDrag(type === 'pointercancel');
        });
    });

    el.nextBtn.addEventListener('click', () => {
        if (!completed) return;
        if (lessonIndex === LESSONS.length - 1) window.location.href = 'index.html';
        else loadLesson(lessonIndex + 1);
    });
    document.getElementById('back-btn').addEventListener('click', () => {
        if (lessonIndex > 0) loadLesson(lessonIndex - 1);
        else window.location.href = 'index.html';
    });
    document.getElementById('skip-btn').addEventListener('click', () => { window.location.href = 'index.html'; });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (renderer) { renderer._onResize(); render(); } }, 200);
    });

    // Oyundaki rehber kartlarından gelen ?topic=... bağlantısı ilgili bölümü açar
    const topic = new URLSearchParams(window.location.search).get('topic');
    const found = topic ? LESSONS.findIndex(l => l.id === topic || (l.topics || []).includes(topic)) : -1;
    loadLesson(found >= 0 ? found : 0);
}

init();
