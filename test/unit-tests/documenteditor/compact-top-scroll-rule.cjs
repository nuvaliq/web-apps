/* Run: node test/unit-tests/documenteditor/compact-top-scroll-rule.cjs
 * The rule that hides the header and the menu bar of the compact shell while the document scrolls down and
 * returns them on the way up (view/CompactTopScroll.js). The module is loaded in a bare vm context: no DOM,
 * no jQuery and no shell; positions are fed as the shell feeds them on each frame.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const FILE = path.join(ROOT, 'apps/documenteditor/main/app/view/CompactTopScroll.js');
const ROWS = 83;    // header 50 + menu bar 33
const LONG = 5000;  // scroll range of a long document

function load() {
    const G = {};
    G.window = G;
    G.define = (deps, factory) => factory();
    vm.createContext(G);
    vm.runInContext(fs.readFileSync(FILE, 'utf8'), G, {filename: FILE});
    return G;
}

/* Answers come from the vm realm: compared as plain data. */
const plain = value => (value == null ? value : JSON.parse(JSON.stringify(value)));

/* A rule that has taken its reference at `start`. */
function rule(start = 400) {
    const made = load().DE.Views.CompactTopScroll.create({threshold: ROWS});
    const r = {
        feed: (pos, max, blocked) => plain(made.feed(pos, max, blocked)),
        skip: () => made.skip(),
        state: () => plain(made.state())
    };
    assert.equal(r.feed(start, LONG, false), null, 'the first position is only the reference');
    return r;
}

/* Feeds positions one by one and returns the answers that are not null. */
function run(r, positions, max = LONG, blocked = false) {
    return positions.map(p => r.feed(p, max, blocked)).filter(Boolean);
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

check('module loads without the shell and jQuery', () => {
    const G = load();
    assert.equal(typeof G.DE.Views.CompactTopScroll.create, 'function');
    assert.equal(G.DE.Views.CompactShell, undefined);
    assert.equal(G.$, undefined);
    assert.equal(G.jQuery, undefined);
});

check('small scroll keeps the top', () => {
    const r = rule();
    assert.deepEqual(run(r, [410, 430, 460, 482]), []);
    assert.deepEqual(r.state(), {path: 82, dir: 1, skipping: false});
});

check('scroll down past the threshold hides the top', () => {
    const r = rule();
    assert.deepEqual(run(r, [440, 470]), []);
    assert.deepEqual(r.feed(483, LONG, false), {act: 'hide', why: 'path'});
});

check('scroll up past the threshold shows the top', () => {
    const r = rule(1000);
    assert.deepEqual(run(r, [960, 930]), []);
    assert.deepEqual(r.feed(917, LONG, false), {act: 'show', why: 'path'});
});

check('change of direction resets the path', () => {
    const r = rule();
    assert.deepEqual(run(r, [460, 480]), []);
    assert.deepEqual(run(r, [470]), [], 'up by 10');
    assert.deepEqual(r.state(), {path: 10, dir: -1, skipping: false});
    assert.deepEqual(run(r, [540]), [], 'down again by 70: the earlier 80 do not count');
    assert.deepEqual(r.state(), {path: 70, dir: 1, skipping: false});
    assert.deepEqual(run(r, [553]), [{act: 'hide', why: 'path'}]);
});

check('position near the start shows the top', () => {
    const r = rule(300);
    assert.deepEqual(r.feed(82, LONG, false), {act: 'show', why: 'start'});
    assert.deepEqual(r.feed(0, LONG, false), {act: 'show', why: 'start'});
});

check('top never hides near the start', () => {
    const r = rule(0);
    /* Down by more than the threshold, yet still above it. */
    assert.deepEqual(run(r, [40, 82]).map(a => a.act), ['show', 'show']);
    assert.deepEqual(run(r, [82, 82]).map(a => a.act), ['show', 'show']);
    /* The path is not kept near the start: once past it, the whole threshold counts again. */
    assert.deepEqual(run(r, [90, 150]), []);
    assert.deepEqual(r.feed(173, LONG, false), {act: 'hide', why: 'path'});
});

check('short document never hides the top', () => {
    /* After the rows leave, the range shrinks by their height; a range below twice the rows would end under
       the threshold, the engine would clamp the position there and the start rule would bring the top back.
       From the start of such a document one jump (Page Down, End) reaches its end. */
    for (const max of [ROWS, ROWS + 40, 2 * ROWS - 1]) {
        const r = rule(0);
        assert.deepEqual(run(r, [max, max], max), [], 'range ' + max);
    }
    const r = rule(0);
    assert.deepEqual(run(r, [2 * ROWS], 2 * ROWS), [{act: 'hide', why: 'path'}], 'range of twice the rows');
});

check('first position after skip only sets the reference', () => {
    const r = rule();
    assert.deepEqual(run(r, [460]), []);
    r.skip();
    assert.equal(r.state().skipping, true);
    /* The layout moved the document by the rows: no path, no answer. */
    assert.equal(r.feed(1460, LONG, false), null);
    assert.deepEqual(r.state(), {path: 0, dir: 0, skipping: false});
    assert.deepEqual(run(r, [1500]), []);
    assert.deepEqual(run(r, [1543]), [{act: 'hide', why: 'path'}]);
});

check('clamp at the end after skip does not show the top', () => {
    /* At the end of a long document the rows leave: the area grows by them, the range shrinks by them and the
       engine clamps the position from the old end to the new one, 83 px up in one frame. */
    const r = rule(LONG - 120);
    assert.deepEqual(run(r, [LONG - 60, LONG]), [{act: 'hide', why: 'path'}]);
    r.skip();
    assert.equal(r.feed(LONG - ROWS, LONG - ROWS, false), null);
    assert.deepEqual(run(r, [LONG - ROWS, LONG - ROWS], LONG - ROWS), []);
    /* The same at the end of a document just long enough to hide the top. */
    const max = 2 * ROWS;
    const s = rule(ROWS);
    assert.deepEqual(run(s, [max], max), [{act: 'hide', why: 'path'}]);
    s.skip();
    assert.equal(s.feed(max - ROWS, max - ROWS, false), null);
    assert.deepEqual(run(s, [max - ROWS], max - ROWS), [], 'the start rule needs a position below the threshold');
});

check('blocked state counts no path', () => {
    const r = rule();
    assert.deepEqual(run(r, [460, 600, 800], LONG, true), []);
    assert.deepEqual(r.state(), {path: 0, dir: 0, skipping: false});
    assert.deepEqual(run(r, [40], LONG, true), [], 'not even near the start');
    assert.deepEqual(run(r, [800], LONG, true), []);
    assert.deepEqual(run(r, [820]), [], 'the path starts after the block');
    assert.deepEqual(run(r, [903]), [{act: 'hide', why: 'path'}]);
});

check('start and path report different reasons', () => {
    const r = rule(1000);
    assert.deepEqual(r.feed(900, LONG, false), {act: 'show', why: 'path'});
    assert.deepEqual(r.feed(50, LONG, false), {act: 'show', why: 'start'});
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed || !passed ? 1 : 0;
