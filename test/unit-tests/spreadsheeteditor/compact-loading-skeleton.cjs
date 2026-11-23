/* Run: node test/unit-tests/spreadsheeteditor/compact-loading-skeleton.cjs
 * The shell loading skeleton is written twice: in index.html (development) and in
 * index.html.deploy (the build). The build takes deploy, a development checkout
 * takes index.html, so a difference between them shows up in only one of them.
 * The check: both draw the same skeleton (styles and frame markup), both start with
 * the shell skeleton on the mask, and the page script switches it the same way by
 * the URL: nested editors (internal=true) keep the stock skeleton, view mode has no
 * toolbar row, a formula bar hidden in the stock interface is not drawn.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const DIR = path.resolve(__dirname, '../../../apps/spreadsheeteditor/main');
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\r\n/g, '\n');
const pages = {dev: read('index.html'), deploy: read('index.html.deploy')};

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (e) { console.error('FAIL', name, '—', e && e.message); failed++; }
}

/* The skeleton styles: from their opening comment to the end of <style>. */
function styles(html) {
    const start = html.indexOf('/* Compact shell skeleton.');
    assert.notEqual(start, -1, 'no skeleton styles');
    const end = html.indexOf('</style>', start);
    assert.notEqual(end, -1, 'skeleton styles are not closed');
    return html.slice(start, end);
}

/* The shell frame: the .skc subtree inside #loading-mask, by div balance. */
function frame(html) {
    const mask = html.indexOf('<div id="loading-mask"');
    assert.notEqual(mask, -1, 'no loading mask');
    const start = html.indexOf('<div class="skc">', mask);
    assert.notEqual(start, -1, 'no skeleton frame');
    const tags = /<(\/?)div\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 0, m;
    while ((m = tags.exec(html))) {
        depth += m[1] ? -1 : 1;
        if (!depth) return html.slice(start, tags.lastIndex);
    }
    throw new Error('skeleton frame is not closed');
}

/* The page script that lays out the loading mask, run as is on node stubs; returns the
   classes the mask ends with. */
function maskClasses(html, params, stored) {
    const found = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
        .filter(s => s.indexOf("document.querySelector('.placeholder').style.display = 'block'") >= 0);
    assert.equal(found.length, 1, 'mask script not found once');
    const classes = new Set(['loadmask', 'sk-shell']);
    const stub = () => ({style: {}, classList: {add() {}, remove() {}}, parentNode: {removeChild() {}}});
    const mask = {style: {}, classList: {add: c => classes.add(c), remove: c => classes.delete(c)}};
    const sandbox = {
        getUrlParams: () => Object.assign({}, params),
        checkLocalStorage: true,
        localStorage: {getItem: k => (stored && k in stored ? stored[k] : null)},
        stopLoading: false,
        document: {
            querySelector: () => stub(),
            querySelectorAll: () => [],
            getElementById: id => (id === 'loading-mask' ? mask : stub()),
            body: {classList: {contains: () => false, add() {}}, removeChild() {}}
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(found[0], sandbox);
    return [...classes].sort().join(' ');
}

check('loading skeleton: the same styles in index.html and index.html.deploy', () => {
    assert.equal(styles(pages.deploy), styles(pages.dev));
});

check('loading skeleton: the same frame markup in both pages', () => {
    assert.equal(frame(pages.deploy), frame(pages.dev));
});

check('loading skeleton: both pages start with the shell skeleton on the mask', () => {
    for (const [name, html] of Object.entries(pages))
        assert.match(html, /<div id="loading-mask" class="loadmask sk-shell">/, name);
});

check('loading skeleton: both pages switch it the same way by the URL', () => {
    const cases = [
        [{}, null, 'loadmask sk-shell'],
        [{mode: 'view'}, null, 'loadmask sk-shell sk-view'],
        [{}, {'sse-hidden-formula': '1'}, 'loadmask sk-nofx sk-shell'],
        [{}, {'sse-hidden-formula': '0'}, 'loadmask sk-shell'],
        [{mode: 'view'}, {'sse-hidden-formula': '1'}, 'loadmask sk-shell sk-view'],
        [{internal: 'true'}, null, 'loadmask'],
        [{compact: 'true'}, null, 'loadmask sk-shell'],
        [{toolbar: 'false'}, null, 'loadmask sk-shell']
    ];
    for (const [name, html] of Object.entries(pages))
        for (const [params, stored, want] of cases)
            assert.equal(maskClasses(html, params, stored), want, name + ' ' + JSON.stringify(params) + ' ' + JSON.stringify(stored));
});

check('loading skeleton: the stock silhouettes are hidden under the shell skeleton', () => {
    const css = styles(pages.dev);
    for (const sel of ['.brendpanel', '.sktoolbar', '.skformula', '.placeholder'])
        assert.ok(css.indexOf('.loadmask.sk-shell > ' + sel) >= 0, sel);
});

check('loading skeleton: the stock loading plate is hidden during the claim', () => {
    const less = fs.readFileSync(path.join(DIR, 'resources/less/compact-shell.less'), 'utf8');
    assert.ok(/body\.vo-boot \.asc-loadmask,\s*body\.vo-boot \.asc-loadmask-body \{\s*display: none !important;/.test(less),
        'compact-shell.less does not hide .asc-loadmask under body.vo-boot');
});

/* An interface in a right-to-left language mirrors the shell rows, but not the sheet: its
   direction is a setting of the sheet, and the stock sheet tabs row keeps the left-to-right
   order. The skeleton mirrors the frame and turns the grid and the tabs row back. */
check('loading skeleton: RTL mirrors the rows but not the grid and the sheet tabs row', () => {
    const css = styles(pages.dev);
    assert.ok(/\.rtl \.loadmask\.sk-shell > \.skc \{\s*transform: scaleX\(-1\);/.test(css), 'the frame is not mirrored');
    assert.ok(/\.rtl \.loadmask\.sk-shell \.skc-grid,\s*\.rtl \.loadmask\.sk-shell \.skc-status \{\s*transform: scaleX\(-1\);/.test(css),
        'the grid and the sheet tabs row are mirrored with the frame');
});

/* The pages keep the line ends they have in the base: CRLF on every line. */
function crlfOnly(raw) {
    return raw.indexOf('\r\n') >= 0 && raw.replace(/\r\n/g, '').indexOf('\n') < 0;
}
check('loading skeleton: both pages keep CRLF on every line', () => {
    for (const name of ['index.html', 'index.html.deploy'])
        assert.ok(crlfOnly(fs.readFileSync(path.join(DIR, name), 'utf8')), name + ' has LF-only lines');
    assert.equal(crlfOnly('a\r\nb\nc\r\n'), false, 'the check misses a bare LF');
});

check('loading skeleton: the comparison sees a difference', () => {
    const changed = pages.deploy.replace('class="skc-title"', 'class="skc-title skc-x"');
    assert.notEqual(frame(changed), frame(pages.dev));
    const restyled = pages.deploy.replace('@keyframes skc-flow', '@keyframes skc-flow2');
    assert.notEqual(styles(restyled), styles(pages.dev));
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
