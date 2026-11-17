/* Run: node test/unit-tests/documenteditor/compact-loading-skeleton.cjs
 * The shell loading skeleton is written twice: in index.html (development) and in
 * index.html.deploy (the build). The build takes deploy, a development checkout
 * takes index.html, so a difference between them shows up in only one of them.
 * The check: both draw the same skeleton — styles, frame markup and the class
 * switches by mode. The page scripts around the switches differ from the start
 * (deploy has its own neutral stock skeleton), so the switches are compared,
 * not the script text.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const DIR = path.resolve(__dirname, '../../../apps/documenteditor/main');
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\r\n/g, '\n');
const pages = {dev: read('index.html'), deploy: read('index.html.deploy')};

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
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

check('loading skeleton: both pages hand PDF forms the stock skeleton and view mode its own', () => {
    for (const [name, html] of Object.entries(pages)) {
        assert.match(html, /getElementById\('loading-mask'\)\.classList\.remove\('sk-shell'\)/, name + ': forms');
        assert.match(html, /getElementById\('loading-mask'\)\.classList\.add\('sk-view'\)/, name + ': view');
    }
});

check('loading skeleton: the comparison sees a difference', () => {
    const changed = pages.deploy.replace('class="skc-title"', 'class="skc-title skc-x"');
    assert.notEqual(frame(changed), frame(pages.dev));
    const restyled = pages.deploy.replace('@keyframes skc-flow', '@keyframes skc-flow2');
    assert.notEqual(styles(restyled), styles(pages.dev));
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
