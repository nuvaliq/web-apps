/* Run: node test/unit-tests/documenteditor/compact-menu-view.cjs
 * File and View sections of the compact menu of the document editor (DocumentActions.sections):
 * the download submenu with its two groups of formats, what the download ban and the view session
 * leave in File, and the toggles and choices of View — each one shows the state the editor reports
 * at the moment the menu reads it, and the zoom choice follows the zoom events of the engine.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs.
 */
const assert = require('node:assert/strict');

const docs = require('../common/compact/lib/documents-editor.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;
const command = k => actions.command(k);
const plain = value => JSON.parse(JSON.stringify(value));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* Rows of a section or a submenu as the menu bar gets them: keys, separators as '—'. */
function rows(items, ctx) {
    return plain(Model.section(items, ctx).rows.map(r => (r.kind === 'sep' ? '—' : r.k)));
}
function section(k) {
    return docs.sections().find(s => s.k === k);
}
function shown(ctx) {
    const keys = new Set();
    for (const s of docs.sections()) (function go(list) {
        for (const r of list) {
            if (r.kind === 'sep' || r.kind === 'group') continue;
            keys.add(r.k);
            if (r.rows) go(r.rows);
        }
    })(Model.section(s.items, ctx).rows);
    return keys;
}
const checked = (k, ctx) => Model.state(command(k), ctx).checked;
const calls = (ctx, name) => ctx.log.filter(e => e.api === name).map(e => e.args);

/* Common.Utils.InternalSettings and Common.localStorage that keep what is written to them. */
function storage() {
    const settings = new Map(), local = new Map();
    const saved = {settings: G.Common.Utils.InternalSettings, local: G.Common.localStorage};
    G.Common.Utils.InternalSettings = {set: (k, v) => settings.set(k, v), get: k => settings.get(k)};
    G.Common.localStorage = Object.assign({}, saved.local, {
        setItem: (k, v) => local.set(k, String(v)),
        getItem: k => (local.has(k) ? local.get(k) : null),
        setBool: (k, v) => local.set(k, v ? '1' : '0'),
        getBool: (k, d) => (local.has(k) ? local.get(k) === '1' || local.get(k) === 'true' : !!d)
    });
    return {settings, local, restore() {
        G.Common.Utils.InternalSettings = saved.settings;
        G.Common.localStorage = saved.local;
    }};
}

check('download submenu lists eight formats in two groups', () => {
    const ctx = docs.context();
    const download = command('file.download');
    assert.equal(Model.kindOf(download), 'submenu');
    assert.deepEqual(rows(download.items, ctx), ['file.download.docx', 'file.download.pdf', 'file.download.odt', '—',
        'file.download.rtf', 'file.download.txt', 'file.download.md', 'file.download.epub', 'file.download.html']);
    /* Each format downloads the file in its own type, through the engine download. */
    const types = {docx: 'DOCX', pdf: 'PDF', odt: 'ODT', rtf: 'RTF', txt: 'TXT', md: 'MD', epub: 'EPUB',
        html: 'HTML_IN_CONTAINER'};
    for (const [k, type] of Object.entries(types)) {
        const item = command('file.download.' + k);
        assert.equal(Model.state(item, ctx).disabled, false, k + ' is available');
        item.run();
        assert.equal(calls(ctx, 'asc_DownloadAs').pop()[0].type, G.Asc.c_oAscFileType[type], k + ' file type');
    }
    /* The submenu row of the File section and its place: after Save, before Print. */
    assert.deepEqual(rows(section('file').items, ctx),
        ['file.save', 'file.download', 'file.print', '—', 'file.rename']);
});

check('download ban hides download and print', () => {
    const ctx = docs.context({download: false});
    const keys = shown(ctx);
    for (const k of ['file.download', 'file.download.docx', 'file.download.html', 'file.print'])
        assert.equal(keys.has(k), false, k + ' is not shown');
    assert.equal(keys.has('file.save'), true, 'control: save stays');
    /* Print without download: the ban on download removes it as well. */
    assert.equal(shown(docs.context({print: true, download: false})).has('file.print'), false);
    assert.equal(shown(docs.context({print: false, download: true})).has('file.print'), false, 'no print right');
    assert.equal(shown(docs.context()).has('file.print'), true, 'control: print with both rights');
});

check('document info is hidden', () => {
    const all = new Set();
    for (const s of docs.sections()) (function go(items) {
        for (const it of items || []) { if (!it || it.sep) continue; all.add(it.k); all.add(it.t); go(it.items); }
    })(s.items);
    for (const k of ['file.info', 'file.docInfo']) assert.equal(all.has(k), false, k);
    assert.equal(all.has('Document info'), false, 'no item labelled Document info');
    assert.equal(all.has(actions.textDocInfo), false, 'no item with the former text of the info screen');
});

check('edit document appears only in view', () => {
    const view = docs.context({editMode: false, editRight: true, requestEdit: true});
    assert.equal(shown(view).has('file.edit'), true, 'a view session of a user with the edit right');
    assert.equal(rows(section('file').items, view)[0], 'file.edit', 'first in File');
    assert.equal(shown(docs.context({requestEdit: true})).has('file.edit'), false, 'not while editing');
    assert.equal(shown(docs.context({rights: 'view', requestEdit: true})).has('file.edit'), false,
        'not without the edit right');
    assert.equal(shown(docs.context({editMode: false, editRight: true, requestEdit: false})).has('file.edit'), false,
        'not without a host that takes the request');
    /* Only the connection greys it: the view itself is the reason it is there. */
    const again = docs.context({editMode: false, editRight: true, requestEdit: true, reasons: ['view']});
    assert.equal(Model.state(command('file.edit'), again).disabled, false);
    const offline = docs.context({editMode: false, editRight: true, requestEdit: true, reasons: ['offline']});
    assert.equal(Model.state(command('file.edit'), offline).reason, 'offline');
});

check('every view toggle reads its state from the editor', () => {
    const toggles = {
        'view.outline': 'outline', 'view.rulers': 'rulers', 'view.marks': 'marks', 'view.tableGrid': 'tableGrid',
        'view.multipage': 'multipage', 'view.focus': 'focusMode'
    };
    for (const [k, flag] of Object.entries(toggles)) {
        assert.equal(Model.kindOf(command(k)), 'check', k + ' is a toggle');
        assert.equal(checked(k, docs.context({[flag]: true})), true, k + ' on');
        assert.equal(checked(k, docs.context({[flag]: false})), false, k + ' off');
    }
    /* The toolbar row is checked while the toolbar is shown. */
    assert.equal(Model.kindOf(command('view.toolbar')), 'check');
    assert.equal(checked('view.toolbar', docs.context({toolbarHidden: false})), true);
    assert.equal(checked('view.toolbar', docs.context({toolbarHidden: true})), false);
    /* State is read at every snapshot: a change made elsewhere shows on the next read. */
    const ctx = docs.context({marks: false});
    assert.equal(checked('view.marks', ctx), false);
    ctx.marks = true;
    assert.equal(checked('view.marks', ctx), true, 'formatting marks turned on by the toolbar button');
    /* Toggling asks the engine for the current value and sets the opposite one. */
    const run = docs.context({marks: true, tableGrid: false});
    command('view.marks').run();
    command('view.tableGrid').run();
    assert.deepEqual(plain(calls(run, 'put_ShowParaMarks')), [[false]]);
    assert.deepEqual(plain(calls(run, 'put_ShowTableEmptyLine')), [[true]]);
    /* View rows need only the connection, the shell rows nothing. */
    const offline = docs.context({reasons: ['offline']});
    for (const k of ['view.outline', 'view.rulers', 'view.marks', 'view.tableGrid'])
        assert.equal(Model.state(command(k), offline).reason, 'offline', k);
    for (const k of ['view.zoom', 'view.toolbar', 'view.focus', 'view.screenReader'])
        assert.equal(Model.state(command(k), offline).disabled, false, k);
    const viewer = docs.context({rights: 'view', reasons: ['view']});
    for (const k of Object.keys(toggles).concat(['view.toolbar', 'view.screenReader', 'view.zoom']))
        assert.equal(Model.state(command(k), viewer).disabled, false, k + ' for a viewer');
});

check('screen reader choice is remembered', () => {
    const store = storage();
    try {
        const ctx = docs.context();
        assert.equal(checked('view.screenReader', ctx), false, 'off by default');
        command('view.screenReader').run();
        assert.deepEqual(plain(calls(ctx, 'setSpeechEnabled')), [[true]]);
        assert.equal(store.local.get('app-settings-screen-reader'), '1', 'the choice is kept in the browser');
        assert.equal(store.settings.get('app-settings-screen-reader'), true);
        assert.equal(checked('view.screenReader', ctx), true);
        /* The start of the editor reads the same key (controller/Main.js) and gets the choice back. */
        assert.equal(G.Common.localStorage.getBool('app-settings-screen-reader'), true);
        command('view.screenReader').run();
        assert.deepEqual(plain(calls(ctx, 'setSpeechEnabled')), [[true], [false]]);
        assert.equal(store.local.get('app-settings-screen-reader'), '0');
        assert.equal(checked('view.screenReader', ctx), false);
    } finally {
        store.restore();
    }
});

check('zoom marks fit-to-width while it is active', () => {
    const ctx = docs.context({zoom: {percent: 100, type: 0}});
    const zoom = command('view.zoom');
    const marked = () => Model.section(zoom.items, ctx).rows.filter(r => r.kind === 'radio' && r.checked).map(r => r.k);
    assert.deepEqual(plain(marked()), ['view.zoom.100']);
    ctx.fire('asc_onZoomChange', 87, 1);
    assert.deepEqual(plain(marked()), ['view.zoom.fitWidth'], 'fit to width, whatever the percent');
    /* The window gets narrower: the engine keeps fitting and reports the new percent. */
    ctx.fire('asc_onZoomChange', 64, 1);
    assert.deepEqual(plain(marked()), ['view.zoom.fitWidth']);
    ctx.fire('asc_onZoomChange', 52, 2);
    assert.deepEqual(plain(marked()), ['view.zoom.fitPage']);
    /* A percent between the fixed values marks nothing. */
    ctx.fire('asc_onZoomChange', 110, 0);
    assert.deepEqual(plain(marked()), []);
    /* Choosing fit to width asks the engine for the mode. */
    command('view.zoom.fitWidth').run();
    assert.deepEqual(plain(calls(ctx, 'zoomFitToWidth')), [[]]);
    /* Before the first event after the menu was built: what the stock status bar shows. */
    const early = docs.context();
    const getController = G.DE.getController;
    const stock = {
        Statusbar: {statusbar: {btnZoomToWidth: {pressed: true}, btnZoomToPage: {pressed: false}}},
        ViewTab: {_state: {zoomValue: 93}}
    };
    G.DE.getController = name => stock[name] || getController(name);
    try {
        assert.equal(checked('view.zoom.fitWidth', early), true);
        assert.equal(checked('view.zoom.100', early), false);
    } finally {
        G.DE.getController = getController;
    }
});

check('choosing a fixed zoom leaves the fit mode', () => {
    const ctx = docs.context({zoom: {percent: 87, type: 1}});
    assert.equal(checked('view.zoom.fitWidth', ctx), true);
    command('view.zoom.150').run();
    assert.deepEqual(plain(calls(ctx, 'zoom')), [[150]], 'the fixed value goes to the engine');
    /* The engine leaves the fit mode on a fixed value and reports it (sdkjs word/api.js, zoom). */
    ctx.fire('asc_onZoomChange', 150, 0);
    assert.equal(checked('view.zoom.fitWidth', ctx), false);
    assert.equal(checked('view.zoom.150', ctx), true);
    /* Every value of the table is there, in its order. */
    assert.deepEqual(rows(command('view.zoom').items, ctx), ['view.zoom.50', 'view.zoom.75', 'view.zoom.100',
        'view.zoom.125', 'view.zoom.150', 'view.zoom.200', 'view.zoom.fitWidth', 'view.zoom.fitPage', '—',
        'view.multipage']);
});

check('multipage toggle stays in the zoom submenu', () => {
    const ctx = docs.context();
    const top = rows(section('view').items, ctx);
    assert.equal(top.includes('view.multipage'), false, 'not a row of View itself');
    assert.deepEqual(top, ['view.outline', 'view.zoom', '—', 'view.rulers', 'view.marks', 'view.tableGrid', '—',
        'view.toolbar', 'view.focus', '—', 'view.screenReader']);
    const zoom = command('view.zoom');
    assert.ok(zoom.items.some(it => it && it.k === 'view.multipage'), 'inside Zoom');
    assert.equal(Model.kindOf(command('view.multipage')), 'check');
    /* The toggle turns the engine mode the other way and keeps the choice, as the stock button. */
    const store = storage();
    try {
        const run = docs.context({multipage: false});
        command('view.multipage').run();
        assert.deepEqual(plain(calls(run, 'SetMultipageViewMode')), [[true]]);
        assert.equal(store.local.get('de-zoom-multipage'), '1');
    } finally {
        store.restore();
    }
    for (const k of ['view.zoom100', 'view.fitWidth', 'view.fitPage'])
        assert.equal(command(k), null, k + ' is no longer a row of View');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
