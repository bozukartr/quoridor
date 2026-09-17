const menu = document.getElementById('start-screen');

// Existing game listeners remain the sole owners of game actions.
if (menu) {
    const difficulty = [...document.querySelectorAll('#ai-difficulty .diff-btn')];
    difficulty.forEach(button => button.addEventListener('click', () => {
        difficulty.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    }));
    let showIntro = !new URLSearchParams(location.search).has('room');
    try {
        showIntro &&= !sessionStorage.getItem('quoridor.intro.v1') && !localStorage.getItem('quoridor.match.v1');
        sessionStorage.setItem('quoridor.intro.v1', '1');
    } catch { /* Private/restricted storage must not block startup. */ }
    if (showIntro && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const intro = document.createElement('div');
        intro.className = 'launch-screen';
        intro.setAttribute('role', 'dialog');
        intro.setAttribute('aria-modal', 'true');
        intro.setAttribute('aria-label', 'Quoridor açılıyor');
        const logo = new URL('./logo.png', import.meta.url).href;
        intro.innerHTML = `<button class="launch-skip" type="button">Atla</button><div class="launch-stage" aria-hidden="true"><img class="launch-wall" src="${logo}" alt=""><img class="launch-person" src="${logo}" alt=""></div><h1>quoridor</h1><p>BİR HAMLE ÖNDE</p>`;
        const app = document.getElementById('app');
        const previousFocus = document.activeElement;
        app.inert = true;
        document.body.append(intro);
        intro.querySelector('button').focus({ preventScroll: true });
        let dismissed = false;
        let timer;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            clearTimeout(timer);
            app.inert = false;
            intro.classList.add('is-leaving');
            if (previousFocus && previousFocus !== document.body) previousFocus.focus({ preventScroll: true });
            else menu.querySelector('a').focus({ preventScroll: true });
            setTimeout(() => intro.remove(), 260);
        };
        intro.querySelector('button').addEventListener('click', dismiss);
        intro.addEventListener('keydown', event => {
            if (event.key === 'Escape') dismiss();
            if (event.key === 'Tab') { event.preventDefault(); intro.querySelector('button').focus(); }
        });
        // This is a short brand transition, not a simulated network progress bar.
        timer = setTimeout(dismiss, 3500); // Hard limit even if an image never loads.
        Promise.all([...intro.querySelectorAll('img')].map(image => image.decode())).then(() => {
            if (dismissed) return;
            intro.classList.add('is-ready');
            clearTimeout(timer);
            timer = setTimeout(dismiss, 1600);
        }).catch(dismiss);
    }
}

document.querySelectorAll('.profile-page .tab-btn').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.profile-page .tab-btn').forEach(item => {
            item.setAttribute('aria-selected', String(item === button));
        });
    });
});

const profileTabs = [...document.querySelectorAll('.profile-page .tab-btn')];
profileTabs.forEach((button, index) => button.addEventListener('keydown', event => {
    const offsets = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = profileTabs[(index + offsets[event.key] + profileTabs.length) % profileTabs.length];
    next.focus();
    next.click();
}));
