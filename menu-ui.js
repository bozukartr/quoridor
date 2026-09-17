import symbol from './quoridor-symbol.svg?raw';
import { settings } from './settings.js';

let markNumber = 0;
function brandMark() {
    const prefix = `quoridor-mark-${++markNumber}-`;
    return symbol.replace('<svg ', '<svg class="brand-mark" ')
        .replace(/id="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
        .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`)
        .replace('aria-labelledby="logo-title logo-desc"', `aria-labelledby="${prefix}logo-title ${prefix}logo-desc"`);
}
document.querySelectorAll('[data-brand-mark]').forEach(target => { target.innerHTML = brandMark(); });

const menu = document.getElementById('start-screen');
if (menu) {
    const username = document.getElementById('username-input');
    const nameLabel = document.getElementById('lobby-player-name');
    const updateName = () => { nameLabel.textContent = username.value.trim() || 'Sen'; };
    username.addEventListener('input', updateName);
    window.addEventListener('focus', updateName);
    menu.addEventListener('pointerdown', updateName, { passive: true });
    updateName();
    new MutationObserver(updateName).observe(username, { attributes: true, attributeFilter: ['disabled'] });

    document.querySelectorAll('[data-open-sheet]').forEach(button => {
        button.addEventListener('click', () => {
            const sheet = document.getElementById(button.dataset.openSheet);
            if (!sheet.open) sheet.showModal();
        });
    });
    document.querySelectorAll('[data-close-sheet]').forEach(button => {
        button.addEventListener('click', () => { button.closest('dialog').close(); updateName(); });
    });
    document.querySelectorAll('.game-sheet').forEach(sheet => {
        sheet.addEventListener('click', event => {
            const bounds = sheet.getBoundingClientRect();
            if (event.target === sheet && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) sheet.close();
        });
    });
    username.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); document.getElementById('name-sheet').close(); updateName(); }
    });
    document.getElementById('room-code-input').addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); document.getElementById('join-room-btn').click(); }
    });
    // Return to the lobby before the existing join handler shows any error toast.
    document.getElementById('join-room-btn').addEventListener('click', () => {
        document.getElementById('room-sheet').close();
    }, { capture: true });
    // Invitations and restored matches must never leave a top-layer sheet over the board.
    new MutationObserver(() => {
        if (!menu.classList.contains('active')) document.querySelectorAll('.game-sheet[open]').forEach(sheet => sheet.close());
        else updateName();
    }).observe(menu, { attributes: true, attributeFilter: ['class'] });

    document.querySelectorAll('[data-mode]').forEach(button => {
        button.addEventListener('click', () => {
            const solo = button.dataset.mode === 'solo';
            document.getElementById('solo-mode').hidden = !solo;
            document.getElementById('friends-mode').hidden = solo;
            document.querySelectorAll('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        });
    });
    const difficulty = [...document.querySelectorAll('#ai-difficulty .diff-btn')];
    difficulty.forEach(button => button.addEventListener('click', () => {
        difficulty.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    }));

    let showIntro = !new URLSearchParams(location.search).has('room');
    try {
        showIntro &&= !sessionStorage.getItem('quoridor.intro.v1') && !localStorage.getItem('quoridor.match.v1');
        sessionStorage.setItem('quoridor.intro.v1', '1');
    } catch { /* Storage restrictions must never block entry. */ }
    if (showIntro && !settings.get().reducedMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const intro = document.createElement('div');
        intro.className = 'launch-screen';
        intro.setAttribute('role', 'dialog');
        intro.setAttribute('aria-modal', 'true');
        intro.setAttribute('aria-label', 'Quoridor açılıyor');
        intro.innerHTML = `<button class="launch-skip" type="button">Atla</button><div class="launch-stage" aria-hidden="true">${brandMark()}</div>`;
        const app = document.getElementById('app');
        app.inert = true;
        document.body.append(intro);
        const skip = intro.querySelector('button');
        skip.focus({ preventScroll: true });
        let dismissed = false;
        let timer;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            clearTimeout(timer);
            app.inert = false;
            intro.classList.add('is-leaving');
            if (menu.classList.contains('active')) menu.querySelector('.player-chip').focus({ preventScroll: true });
            setTimeout(() => intro.remove(), 260);
        };
        skip.addEventListener('click', dismiss);
        intro.addEventListener('keydown', event => {
            if (event.key === 'Escape') dismiss();
            if (event.key === 'Tab') { event.preventDefault(); skip.focus(); }
        });
        // Inline SVG has no network dependency. The intro never waits on Firebase.
        timer = setTimeout(dismiss, 1600);
    }
}

const profileTabs = [...document.querySelectorAll('.profile-page .tab-btn')];
profileTabs.forEach((button, index) => {
    button.addEventListener('click', () => {
        profileTabs.forEach(item => item.setAttribute('aria-selected', String(item === button)));
    });
    button.addEventListener('keydown', event => {
        const offsets = { ArrowRight: 1, ArrowLeft: -1 };
        if (!(event.key in offsets)) return;
        event.preventDefault();
        const next = profileTabs[(index + offsets[event.key] + profileTabs.length) % profileTabs.length];
        next.focus();
        next.click();
    });
});
