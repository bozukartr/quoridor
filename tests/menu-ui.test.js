import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise menu controls without starting Firebase or altering the game engine.
const source = readFileSync(new URL('../menu-ui.js', import.meta.url), 'utf8').replace(/^import symbol.*\n/, 'const symbol = "";\n');
const menuSource = source.replace(/import \{ settings \}.*\n/, 'const settings = { get: () => ({ reducedMotion: false }) };\n');
function setup() {
    const nodes = new Map();
    const observations = [];
    function node(id, dataset = {}) {
        const listeners = new Map();
        const element = {
            dataset, value: '', hidden: false, open: false, active: true,
            attributes: {}, classList: { contains: () => element.active },
            addEventListener(type, fn, options) {
                const list = listeners.get(type) || [];
                options?.capture ? list.unshift(fn) : list.push(fn);
                listeners.set(type, list);
            },
            fire(type, props = {}) { for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, ...props }); },
            click() { element.fire('click'); },
            setAttribute(k, v) { element.attributes[k] = v; },
            showModal() { element.open = true; }, close() { element.open = false; },
        };
        nodes.set(id, element);
        return element;
    }
    ['start-screen', 'username-input', 'lobby-player-name', 'room-code-input', 'join-room-btn', 'room-sheet', 'name-sheet', 'solo-mode', 'friends-mode'].forEach(id => node(id));
    const modes = [node('solo', { mode: 'solo' }), node('friends', { mode: 'friends' })];
    const openers = [node('open-name', { openSheet: 'name-sheet' }), node('open-room', { openSheet: 'room-sheet' })];
    const sheets = [nodes.get('room-sheet'), nodes.get('name-sheet')];
    const document = {
        getElementById: id => nodes.get(id),
        querySelectorAll: selector => ({ '[data-mode]': modes, '[data-open-sheet]': openers, '.game-sheet': sheets, '.game-sheet[open]': sheets.filter(s => s.open) })[selector] || [],
    };
    vm.runInNewContext(menuSource, {
        document, window: { addEventListener() {} }, location: { search: '' }, URLSearchParams,
        sessionStorage: { getItem: () => '1', setItem() {} }, localStorage: { getItem: () => null },
        MutationObserver: class { constructor(callback) { this.callback = callback; } observe(target) { observations.push({ target, callback: this.callback }); } },
    });
    return { nodes, observations };
}
test('mode selection exposes the right actions and pressed state', () => {
    const { nodes } = setup();
    nodes.get('friends').click();
    assert.equal(nodes.get('solo-mode').hidden, true);
    assert.equal(nodes.get('friends-mode').hidden, false);
    assert.equal(nodes.get('friends').attributes['aria-pressed'], 'true');
    nodes.get('solo').click();
    assert.equal(nodes.get('friends-mode').hidden, true);
    assert.equal(nodes.get('solo-mode').hidden, false);
});
test('name sheet edits the existing username input without replacing it', () => {
    const { nodes } = setup();
    nodes.get('open-name').click();
    const input = nodes.get('username-input');
    input.value = 'Burak'; input.fire('input');
    assert.equal(nodes.get('lobby-player-name').textContent, 'Burak');
    input.fire('keydown', { key: 'Enter' });
    assert.equal(nodes.get('name-sheet').open, false);
    assert.equal(input.value, 'Burak');
});
test('keyboard join closes the top-layer sheet before game feedback', () => {
    const { nodes } = setup();
    nodes.get('open-room').click();
    nodes.get('room-code-input').value = 'ABC123';
    let called = false;
    nodes.get('join-room-btn').addEventListener('click', () => {
        called = true;
        assert.equal(nodes.get('room-sheet').open, false);
        assert.equal(nodes.get('room-code-input').value, 'ABC123');
    });
    nodes.get('room-code-input').fire('keydown', { key: 'Enter' });
    assert.equal(called, true);
});
test('restored/invited game transition dismisses an open menu sheet', () => {
    const { nodes, observations } = setup();
    nodes.get('open-name').click();
    nodes.get('start-screen').active = false;
    observations.find(o => o.target === nodes.get('start-screen')).callback();
    assert.equal(nodes.get('name-sheet').open, false);
});
