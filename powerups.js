// powerups.js — Güçlendirmelerin tek kaynağı.
// Tahtadaki sembol, envanterdeki simge ve rehberdeki ikon buradan gelir; böylece
// oyuncunun tahtada gördüğü şey ile envanterinde gördüğü şey aynı olur.
//
// Emojilerde varyasyon seçici (U+FE0F) bilinçli: onsuz ❄ / ↩ / ⏱ gibi karakterler
// renkli emoji yerine tek renk metin glifi olarak çizilip koyu tahtada kayboluyor.

export const POWERUP_INFO = {
    destroy: { emoji: '💣', color: 0xef4444, label: 'Duvar Kırıcı' },
    ghost: { emoji: '👻', color: 0xa855f7, label: 'Hayalet Modu' },
    freeze: { emoji: '❄️', color: 0x0ea5e9, label: 'Dondurucu' },
    wall: { emoji: '🧱', color: 0xf97316, label: '+1 Duvar' },
    return: { emoji: '↩️', color: 0x10b981, label: 'Geri Sar' },
    chaos: { emoji: '🔀', color: 0xd946ef, label: 'Şaşırtma' },
    double_turn: { emoji: '🔁', color: 0xeab308, label: 'Dejavu' },
    hourglass: { emoji: '⏳', color: 0xb45309, label: 'Kum Saati' },
    time_bonus: { emoji: '⏱️', color: 0x3b82f6, label: '+10 Saniye' },
    star: { emoji: '⭐', color: 0xffd700, label: 'Efsanevi Yıldız' }
};

// Envanterde görünen güçlendirmeler (yıldız ve süre bonusu anında etki eder)
export const INVENTORY_TYPES = ['destroy', 'ghost', 'freeze', 'wall', 'return', 'chaos', 'double_turn', 'hourglass'];

export function powerupEmoji(type) {
    return POWERUP_INFO[type]?.emoji || '❔';
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
