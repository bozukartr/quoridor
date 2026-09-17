// Ordered back handling shared by Android hardware/gesture back and Escape.
export function handleBack({ blocked, intro, dialog, modal, game, home, exit }) {
    if (blocked()) return;
    const opening = intro();
    if (opening) { opening.click(); return; }
    const sheet = dialog();
    if (sheet) { sheet.close(); return; }
    const overlay = modal();
    if (overlay) {
        const close = overlay.querySelector('#modal-cancel, #close-tutorial-btn, .close-modal');
        if (close) close.click();
        else overlay.classList.add('hidden');
        return;
    }
    if (game()) return;
    if (home()) return;
    exit();
}
