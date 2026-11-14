/* Run: node test/unit-tests/documenteditor/editor-frame-permissions.cjs
 * The iframe of the editor that DocsAPI.DocEditor (apps/api/documents/api.js) puts into the host page
 * delegates reading of the clipboard (clipboard-read): "Paste without formatting" reads the clipboard
 * with navigator.clipboard.readText(), which the permissions policy of a cross-origin frame blocks unless
 * the frame allows it. The permissions the frame had before stay. The real api.js runs in vm over a stub
 * of the host DOM, for every editor and every type of the editor.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const API = 'apps/api/documents/api.js';
const SOURCE = fs.readFileSync(path.join(ROOT, API), 'utf8');
const EDITOR_ORIGIN = 'https://editor.example.test';
const FRAME_ID = 'editor';

/* The permissions of the frame as they were before clipboard-read. */
const BEFORE = ['autoplay', 'camera', 'microphone', 'display-capture', 'clipboard-write'];

/* The frame that DocsAPI.DocEditor creates for the config: its attributes and properties. */
function frame(config) {
    const frames = [];
    const placeholder = {parentNode: {replaceChild(created, previous) {
        assert.equal(previous, placeholder);
        frames.push(created);
    }}};
    const document = {
        body: {style: {}},
        getElementById(id) { assert.equal(id, FRAME_ID); return placeholder; },
        getElementsByTagName(tag) {
            assert.equal(tag, 'script');
            return [{src: EDITOR_ORIGIN + '/web-apps/apps/api/documents/api.js'}];
        },
        createElement(tag) {
            assert.equal(tag, 'iframe');
            const attrs = {};
            return {style: {}, attrs, setAttribute(name, value) { attrs[name] = String(value); },
                contentWindow: {postMessage() {}}};
        }
    };
    const window = {
        JSON,
        location: {origin: 'https://host.example.test', search: ''},
        addEventListener() {},
        removeEventListener() {},
        alert(message) { assert.fail(message); }
    };
    window.parent = window;
    vm.runInNewContext(SOURCE, {window, document, console}, {filename: API});
    new window.DocsAPI.DocEditor(FRAME_ID, config);
    assert.equal(frames.length, 1, 'DocEditor puts its iframe in place of the placeholder');
    return frames[0];
}

/* Feature names of an allow attribute ("a; b;"), in order. */
const features = allow => allow.split(';').map(s => s.trim()).filter(Boolean);

let passed = 0, failed = 0;
function check(name, run) {
    try { run(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

check('editor frame allows reading the clipboard', () => {
    const f = frame({documentType: 'word'});
    assert.equal(typeof f.attrs.allow, 'string', 'the frame has an allow attribute');
    assert.ok(features(f.attrs.allow).includes('clipboard-read'), 'clipboard-read in: ' + f.attrs.allow);
});

check('editor frame keeps the permissions it had', () => {
    const list = features(frame({documentType: 'word'}).attrs.allow);
    for (const name of BEFORE) assert.ok(list.includes(name), name + ' stays');
    assert.deepEqual(list, BEFORE.concat('clipboard-read'), 'nothing else is delegated');
    assert.equal(new Set(list).size, list.length, 'no feature twice');
});

check('every editor and every type of the editor gets the same permissions', () => {
    const expected = BEFORE.concat('clipboard-read');
    for (const documentType of ['word', 'cell', 'slide', 'pdf'])
        for (const type of ['desktop', 'mobile', 'embedded']) {
            const f = frame({documentType, type});
            assert.deepEqual(features(f.attrs.allow), expected, documentType + '/' + type);
            assert.equal(f.allowFullscreen, true, 'full screen stays allowed: ' + documentType + '/' + type);
        }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
