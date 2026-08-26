// powerups.js — Güçlendirmelerin tek kaynağı.
// Tahtadaki sembol, envanterdeki simge ve rehberdeki ikon buradan gelir; böylece
// oyuncunun tahtada gördüğü şey ile envanterinde gördüğü şey aynı olur.
//
// Emojilerde varyasyon seçici (U+FE0F) bilinçli: onsuz ❄ / ↩ / ⏱ gibi karakterler
// renkli emoji yerine tek renk metin glifi olarak çizilip koyu tahtada kayboluyor.

export const POWERUP_INFO = {
    destroy: { icon: 'fa-solid fa-bomb', emoji: '💣', color: 0xef4444, label: 'Duvar Kırıcı' },
    ghost: { icon: 'fa-solid fa-ghost', emoji: '👻', color: 0xa855f7, label: 'Hayalet Modu' },
    freeze: { icon: 'fa-solid fa-snowflake', emoji: '❄️', color: 0x0ea5e9, label: 'Dondurucu' },
    wall: { icon: 'fa-solid fa-plus-square', emoji: '🧱', color: 0xf97316, label: '+1 Duvar' },
    return: { icon: 'fa-solid fa-undo', emoji: '↩️', color: 0x10b981, label: 'Geri Sar' },
    chaos: { icon: 'fa-solid fa-shuffle', emoji: '🔀', color: 0xd946ef, label: 'Şaşırtma' },
    double_turn: { icon: 'fa-solid fa-repeat', emoji: '🔁', color: 0xeab308, label: 'Dejavu' },
    hourglass: { icon: 'fa-solid fa-hourglass-half', emoji: '⏳', color: 0xb45309, label: 'Kum Saati' },
    time_bonus: { icon: 'fa-solid fa-stopwatch', emoji: '⏱️', color: 0x3b82f6, label: '+10 Saniye' },
    star: { icon: 'fa-solid fa-star', emoji: '⭐', color: 0xffd700, label: 'Efsanevi Yıldız' }
};

// Envanterde görünen güçlendirmeler (yıldız ve süre bonusu anında etki eder)
export const INVENTORY_TYPES = ['destroy', 'ghost', 'freeze', 'wall', 'return', 'chaos', 'double_turn', 'hourglass'];

export function powerupEmoji(type) {
    return POWERUP_INFO[type]?.emoji || '❔';
}

export function powerupIconClass(type) {
    return POWERUP_INFO[type]?.icon || 'fa-solid fa-question';
}

// --- Tahtada Font Awesome ikonu çizmek için glif çözümü ---
// Kod noktalarını elle yazmak yerine, sayfaya yüklü Font Awesome sürümünün
// kendi CSS'inden okuyoruz: gizli bir <i> öğesinin ::before içeriği ve font
// ailesi, envanterdeki ikonun birebir aynısını verir. Font yüklenmemişse
// (çevrimdışı, CDN engelli) emojiye düşülür, tahtada kutu görünmez.
let _glyphCache = null;

function probeGlyph(iconClass) {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('i');
    el.className = iconClass;
    el.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
    document.body.appendChild(el);

    const before = getComputedStyle(el, '::before');
    const base = getComputedStyle(el);
    const raw = before.content;
    const fontFamily = before.fontFamily || base.fontFamily;
    const fontWeight = before.fontWeight || base.fontWeight || '900';
    document.body.removeChild(el);

    if (!raw || raw === 'none' || raw === 'normal') return null;
    const text = raw.replace(/^["']|["']$/g, '');
    if (!text) return null;

    // Font gerçekten yüklendi mi? Yüklenmediyse kutu çizmektense emojiye düş.
    if (document.fonts && !document.fonts.check(`${fontWeight} 16px ${fontFamily}`)) return null;
    return { text, fontFamily, fontWeight };
}

/** Tahtaya çizilecek glif: Font Awesome varsa o, yoksa emoji. */
export function powerupGlyph(type) {
    if (!_glyphCache) _glyphCache = {};
    if (_glyphCache[type] === undefined) {
        _glyphCache[type] = probeGlyph(powerupIconClass(type));
    }
    return _glyphCache[type] || { text: powerupEmoji(type), fontFamily: 'sans-serif', fontWeight: 'normal' };
}

/** Font sonradan yüklendiğinde önbelleği tazelemek için. */
export function refreshPowerupGlyphs() {
    _glyphCache = null;
}

/** Font Awesome gerçekten kullanılabilir mi? (çevrimdışı/CDN engelli durumlar) */
export function fontAwesomeAvailable() {
    return probeGlyph('fa-solid fa-bomb') !== null;
}

export function powerupLabel(type) {
    return POWERUP_INFO[type]?.label || 'Güçlendirme';
}

/** Pixi için sayısal renk (0xRRGGBB) */
export function powerupColor(type) {
    return POWERUP_INFO[type]?.color ?? 0xffffff;
}

/** CSS için '#rrggbb' */
export function powerupCssColor(type) {
    return '#' + powerupColor(type).toString(16).padStart(6, '0');
}

/** CSS için 'rgba(r, g, b, a)' — parıltı/arka plan tonları */
export function powerupRgba(type, alpha = 1) {
    const c = powerupColor(type);
    return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${alpha})`;
}
