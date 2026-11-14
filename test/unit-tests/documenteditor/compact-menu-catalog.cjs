/* Run: node test/unit-tests/documenteditor/compact-menu-catalog.cjs
 * The compact menu catalog of the document editor (DocumentActions.sections) on the shared menu
 * model: sections and their order, items against the list written out by hand
 * (fixtures/menu-items.cjs) — keys, Russian and English labels, types and who sees them —,
 * removed items, no chat anywhere in the shell, no item that opens the file menu screen, model
 * validation, own keys of renamed items, no item reason for undo, redo and save, and the disabled
 * reasons the adapter declares: their order, their texts in the locale of the editor, every reason
 * of the catalog among them, the same text in the slash commands (SlashMenu.js) as in the menu bar.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs; Russian
 * labels come from a second load of the catalog with locale/ru.json applied before it, as
 * Common.Locale.apply does in the editor.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const ACTIONS = path.join(ROOT, 'apps/documenteditor/main/app/view/DocumentActions.js');
const SHELL = path.join(ROOT, 'apps/documenteditor/main/app/view/CompactShell.js');
const LOCALE = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/documenteditor/main/locale', name + '.json'), 'utf8'));
const PREFIX = 'DE.Views.DocumentActions.';
const docs = require('../common/compact/lib/documents-editor.cjs');
const {SECTIONS, ITEMS, REMOVED} = require('./fixtures/menu-items.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const plain = value => JSON.parse(JSON.stringify(value));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* Every item of the catalog with its section, submenu items included. */
function walk(sections) {
    const out = [];
    for (const s of sections) (function go(items, parent) {
        for (const it of items || []) {
            if (!it || it.sep) continue;
            out.push({it, section: s.k, parent});
            if (it.items) go(it.items, it);
        }
    })(s.items, null);
    return out;
}

/* Visible rows of every section for the editor state, submenu rows included. */
function visible(ctx) {
    const keys = new Set();
    for (const s of docs.sections()) {
        (function go(rows) {
            for (const r of rows) {
                if (r.kind === 'sep' || r.kind === 'group') continue;
                keys.add(r.k);
                if (r.rows) go(r.rows);
            }
        })(Model.section(s.items, ctx).rows);
    }
    return keys;
}

/* The catalog loaded with a locale applied before it, as the editor applies its locale. */
function catalogIn(lang) {
    const locale = LOCALE(lang);
    const own = {};
    for (const [key, value] of Object.entries(locale))
        if (key.startsWith(PREFIX)) own[key.slice(PREFIX.length)] = value;
    const ctx = {_: {extend: Object.assign}, define: (deps, factory) => factory()};
    ctx.window = ctx;
    ctx.DE = {Views: {DocumentActions: own}};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(ACTIONS, 'utf8'), ctx, {filename: ACTIONS});
    return ctx.DE.Views.DocumentActions;
}

/* The catalog labels by key: each label names the text key it comes from. A text with a value in
 * it ("{0}%") keeps the placeholder after its name, so the label shows the value put in. */
function labelKeys() {
    const ctx = {_: {extend: Object.assign}, define: (deps, factory) => factory()};
    ctx.window = ctx;
    ctx.DE = {Views: {}};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(ACTIONS, 'utf8'), ctx, {filename: ACTIONS});
    const da = ctx.DE.Views.DocumentActions;
    for (const key of Object.keys(da))
        if (/^text/.test(key)) da[key] = '@' + key + (/\{0\}/.test(da[key]) ? '|{0}' : '');
    const out = {};
    for (const s of da.sections()) {
        out[s.k] = s.t;
        for (const {it} of walk([s])) out[it.k] = it.t;
    }
    return out;
}

const KIND = {action: 'action', window: 'action', check: 'check', radio: 'radio', submenu: 'submenu'};
const EDITOR = {};
const VIEWER = {rights: 'view'};
const HOST_VIEW = {editMode: false, editRight: true, requestEdit: true};

check('sections follow the menu bar order', () => {
    const sections = docs.sections();
    assert.deepEqual(plain(sections.map(s => s.k)), SECTIONS.map(s => s.k));
    assert.deepEqual(plain(sections.map(s => s.t)), SECTIONS.map(s => s.en));
    const ru = catalogIn('ru');
    assert.deepEqual(plain(ru.sections().map(s => s.t)), SECTIONS.map(s => s.ru));
    const ctx = docs.context(EDITOR);
    for (const s of sections) assert.equal(Model.section(s.items, ctx).visible, true, s.k + ' is shown to the editor');
});

check('catalog matches the written-out items for keys, ru and en labels, types and visibility', () => {
    const en = new Map(walk(docs.sections()).map(r => [r.it.k, r]));
    const ru = new Map(walk(catalogIn('ru').sections()).map(r => [r.it.k, r]));
    const states = {
        editor: visible(docs.context(EDITOR)),
        viewer: visible(docs.context(VIEWER)),
        hostView: visible(docs.context(HOST_VIEW)),
        noDownload: visible(docs.context({download: false})),
        noRename: visible(docs.context({rename: false})),
        noShare: visible(docs.context({share: false})),
        noHistory: visible(docs.context({history: false}))
    };
    for (const rec of ITEMS) {
        const item = en.get(rec.k);
        assert.ok(item, rec.k + ' is in the catalog');
        assert.equal(item.it.t, rec.en, rec.k + ' English label');
        assert.equal(ru.get(rec.k).it.t, rec.ru, rec.k + ' Russian label');
        assert.equal(Model.kindOf(item.it), KIND[rec.type], rec.k + ' type');
        assert.equal(item.section, rec.k.split('.')[0], rec.k + ' section');
        const seen = state => states[state].has(rec.k);
        if (rec.view) {
            assert.equal(seen('hostView'), true, rec.k + ': shown in a view session of the editor');
            assert.equal(seen('editor'), false, rec.k + ': not shown while editing');
            assert.equal(seen('viewer'), false, rec.k + ': not shown to a viewer');
            continue;
        }
        assert.equal(seen('editor'), true, rec.k + ': shown to the editor');
        if (rec.who === 'all') assert.equal(seen('viewer'), true, rec.k + ': shown to a viewer');
        if (rec.who === 'editor') assert.equal(seen('viewer'), false, rec.k + ': not shown to a viewer');
        if (rec.who === 'download') assert.equal(seen('noDownload'), false, rec.k + ': the download ban removes it');
        if (rec.who === 'rename') assert.equal(seen('noRename'), false, rec.k + ': only with the rename right');
        if (rec.who === 'share') assert.equal(seen('noShare'), false, rec.k + ': only with the sharing button');
        if (rec.who === 'history') assert.equal(seen('noHistory'), false, rec.k + ': only with the version history');
    }
});

check('view-only user gets no Insert and no Format', () => {
    const ctx = docs.context(VIEWER);
    const shown = docs.sections().filter(s => Model.section(s.items, ctx).visible).map(s => s.k);
    assert.deepEqual(plain(shown), ['file', 'edit', 'view', 'collab', 'help']);
    const editor = docs.context(EDITOR);
    assert.equal(Model.section(docs.sections().find(s => s.k === 'insert').items, editor).visible, true);
    assert.equal(Model.section(docs.sections().find(s => s.k === 'format').items, editor).visible, true);
});

check('rename and share items follow their own rights', () => {
    for (const rights of ['edit', 'view']) {
        assert.equal(visible(docs.context({rights, rename: true})).has('file.rename'), true, rights + ': rename right');
        assert.equal(visible(docs.context({rights, rename: false})).has('file.rename'), false, rights + ': no rename right');
        assert.equal(visible(docs.context({rights, share: true})).has('collab.share'), true, rights + ': sharing button');
        assert.equal(visible(docs.context({rights, share: false})).has('collab.share'), false, rights + ': no sharing button');
    }
    /* The rights of the document do not grey them: they need only the connection. */
    const ctx = docs.context({reasons: ['view', 'protected', 'form']});
    for (const k of ['file.rename', 'collab.share'])
        assert.equal(Model.state(G.DE.Views.DocumentActions.command(k), ctx).disabled, false, k);
    const offline = docs.context({reasons: ['offline']});
    for (const k of ['file.rename', 'collab.share'])
        assert.equal(Model.state(G.DE.Views.DocumentActions.command(k), offline).reason, 'offline', k);
});

check('removed items are absent', () => {
    /* Every right and integration on: what is not in the list stays out anyway. */
    const ctx = docs.context();
    ctx.options = () => new Proxy({}, {get: (t, k) => (k === 'isReviewOnly' || k === 'isOffline' ? false : true)});
    const rows = docs.sections().flatMap(s => walk([s]));
    const labels = rows.map(r => r.it.t);
    for (const label of REMOVED) assert.ok(!labels.includes(label), label + ' is not in the catalog');
    const icons = rows.map(r => r.it.i);
    for (const icon of ['rights', 'protect', 'settings', 'layers', 'chat', 'crossRef', 'caption', 'numbered', 'panel'])
        assert.ok(!icons.includes(icon), 'no item with the ' + icon + ' icon');
    for (const fn of ['groups', 'fileItem', 'crossReference', 'caption', 'canAccess', 'canProtectDoc'])
        assert.equal(G.DE.Views.DocumentActions[fn], undefined, fn);
    assert.deepEqual(plain(rows.filter(r => !r.it.k).map(r => r.it.t)), [], 'every item has a key');
});

check('no chat surface with chat enabled in the config', () => {
    /* The catalog: no item with chat in any state. */
    const ctx = docs.context();
    const run = [];
    ctx.shell.toggleLeftPanel = name => run.push(name);
    for (const {it} of walk(docs.sections())) {
        assert.ok(!/chat/i.test(it.k) && !/chat/i.test(it.t || '') && it.i !== 'chat', 'no chat item: ' + it.k);
    }
    /* The shell: no left panel button and no area for the chat panel, whatever the config says. */
    const shellContext = {
        window: null, setTimeout() {}, clearTimeout() {}, console: {warn() {}, log() {}},
        _: {extend: Object.assign},
        document: {body: {classList: (() => {
            const set = new Set();
            return {add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
                toggle: (c, on) => ((on === undefined ? !set.has(c) : on) ? set.add(c) : set.delete(c))};
        })()}, getElementById: () => null},
        $: () => new Proxy({length: 0}, {get: (t, k) => (k in t ? t[k] : () => t)}),
        Common: {NotificationCenter: {on() {}, trigger() {}}, localStorage: {itemExists: () => false, getBool: () => false}},
        define: (deps, factory) => factory({})
    };
    const clicks = [];
    const button = name => ({pressed: name === 'chat', isDisabled: () => false, click: () => clicks.push(name)});
    const leftMenu = {btnChat: button('chat'), btnComments: button('comments'), btnNavigation: button('navigation'),
        btnSearchBar: button('search')};
    shellContext.DE = {Views: {}, getController: name => {
        if (name === 'Main') return {appOptions: {canCoAuthoring: true, canChat: true, canViewComments: true}};
        if (name === 'LeftMenu') return {leftMenu};
        return null;
    }};
    shellContext.window = {DE: shellContext.DE};
    vm.createContext(shellContext);
    vm.runInContext(fs.readFileSync(SHELL, 'utf8'), shellContext, {filename: SHELL});
    const shell = shellContext.DE.Views.CompactShell;
    shell.resync = () => {};
    assert.equal(shell.canUse('chat'), false, 'the chat panel is not offered');
    assert.equal(shell.stockLeftBtn('chat'), null, 'the shell knows no chat button');
    shell.toggleLeftPanel('chat');
    assert.deepEqual(clicks, [], 'nothing opens the chat panel');
    shell.syncLeftState();
    assert.equal(shellContext.document.body.classList.contains('vo-left-open'), false,
        'a chat panel opened by the stock does not get the left area');
    assert.equal(shell.canUse('comments'), true, 'control: the comments panel is offered');
});

check('no catalog command opens the file menu screen', () => {
    const ctx = docs.context({requestEdit: true, editMode: false, editRight: true});
    const screens = [];
    const getController = G.DE.getController;
    G.DE.getController = name => (name === 'LeftMenu' ? {
        leftMenu: {showMenu: section => screens.push(section)},
        clickMenuFileItem: (menu, name) => screens.push('item:' + name),
        onFindReplace: () => {}
    } : getController(name));
    const failures = [];
    /* Windows the stand-in editor lacks report their fallback; the report is not checked here. */
    const warn = console.warn;
    console.warn = () => {};
    try {
        for (const {it} of walk(docs.sections())) {
            if (typeof it.run !== 'function') continue;
            try { it.run(); } catch (e) { failures.push(it.k + ': ' + e.message); }
        }
    } finally {
        G.DE.getController = getController;
        console.warn = warn;
    }
    assert.deepEqual(screens.filter(s => /^file:/.test(s)), [], 'no screen of the file menu');
    assert.deepEqual(screens.filter(s => /^item:/.test(s)).sort(), ['item:edit', 'item:rename'],
        'only the rename window and the edit request go through the file menu handler');
    assert.ok(ctx.log.length > 0);
    assert.deepEqual(failures.filter(f => /showMenu|fileItem/.test(f)), []);
});

check('every record passes model validation', () => {
    const sections = docs.sections();
    assert.deepEqual(plain(Model.validate(sections)), []);
    const ctx = docs.context();
    for (const {it, parent} of walk(sections)) {
        assert.ok(Model.KINDS.includes(Model.kindOf(it)), it.k + ' kind');
        /* A label that follows the state (MenuModel: t(ctx)) is read as the snapshot reads it. */
        const label = typeof it.t === 'function' ? it.t(ctx) : it.t;
        assert.ok(typeof label === 'string' && label, it.k + ' label');
        if (Model.kindOf(it) === 'submenu') assert.ok(!parent, it.k + ' is not nested in a submenu');
        /* A group heading is never run (MenuModel); every other row is. */
        else if (Model.kindOf(it) === 'group') assert.equal(it.run, undefined, it.k + ' heading does not run');
        else assert.equal(typeof it.run, 'function', it.k + ' runs');
        assert.ok(['undefined', 'function'].includes(typeof it.when), it.k + ' when');
        assert.ok(['undefined', 'function'].includes(typeof it.disabled), it.k + ' disabled');
        if (it.sc !== undefined) assert.match(it.sc, /^[A-Z][A-Za-z]+$/, it.k + ' shortcut name');
    }
    assert.equal(G.DE.Views.DocumentActions.command('help.about').k, 'help.about');
    assert.equal(G.DE.Views.DocumentActions.command('file.download.pdf').k, 'file.download.pdf');
    assert.equal(G.DE.Views.DocumentActions.command('nothing'), null);
});

check('renamed items use keys absent from the German locale', () => {
    const keys = labelKeys();
    const en = LOCALE('en'), ru = LOCALE('ru'), de = LOCALE('de');
    for (const rec of ITEMS.concat(SECTIONS)) {
        const label = keys[rec.k];
        if (!/^@/.test(label || '')) continue;
        const [name, value] = label.slice(1).split('|');
        const key = PREFIX + name;
        const put = text => (value === undefined || text === undefined ? text : text.replace('{0}', value));
        assert.equal(put(en[key]), rec.en, key + ' in en.json');
        assert.equal(put(ru[key]), rec.ru, key + ' in ru.json');
        if (!rec.renamed) continue;
        assert.match(label, /^@textMenu/, rec.k + ' has a key of its own');
        assert.equal(de[key], undefined, key + ' has no German translation, the code default shows instead');
    }
    assert.ok(ITEMS.filter(r => r.renamed).length >= 10);
    for (const code of ['NoSelection', 'NotInTable', 'NoObject', 'NotInList', 'NoToc', 'NotInField', 'NoChanges', 'ControlLocked']) {
        const key = PREFIX + 'textReason' + code;
        assert.ok(en[key] && ru[key], key + ' in en.json and ru.json');
        assert.equal(docs.reasonText(code[0].toLowerCase() + code.slice(1)), en[key], code);
    }
});

/* Reasons of the editor state, in the order the documents adapter declares them. */
const DECLARED = ['limit', 'offline', 'view', 'final', 'original', 'form', 'protected', 'forAll'];
/* Editor states that put every declared reason but «for everyone» in force, alone and together. */
const LOCKS = [{}, {reasons: ['offline']}, {reasons: ['view']}, {reasons: ['protected']}, {reasons: ['final']},
    {reasons: ['original']}, {reasons: ['form']}, {reasons: ['limit']}, {rights: 'view'},
    {reasons: ['final', 'form', 'protected']}, {reasons: ['original', 'protected']}, {selection: false},
    {protection: {isCommentsOnly: true}}, {reasons: ['view'], selection: false}];

check('undo, redo and save have no item reason', () => {
    const reasons = plain(docs.context().real.reasons);
    for (const k of ['edit.undo', 'edit.redo', 'file.save']) {
        const it = G.DE.Views.DocumentActions.command(k);
        for (const state of LOCKS) {
            const ctx = docs.context(state);
            const codes = [].concat(it.disabled(ctx) || []);
            for (const code of codes)
                assert.ok(code === true || reasons.includes(code), k + ': ' + code + ' is a reason of the editor state');
        }
        assert.equal(Model.state(it, docs.context()).disabled, false, k + ' is enabled without a common reason');
        assert.equal(Model.state(it, docs.context({reasons: ['view']})).reason, 'view', k);
    }
});

check('documents adapter declares the review, form and for-all reasons', () => {
    const adapter = docs.context().real;
    assert.deepEqual(plain(adapter.reasons), DECLARED);
    const en = LOCALE('en'), ru = LOCALE('ru');
    const texts = {
        Final: ['Showing the final version', 'Показан итоговый вариант'],
        Original: ['Showing the original version', 'Показан исходный вариант'],
        Form: ['The document is open for filling in forms', 'Документ открыт для заполнения формы'],
        ForAll: ['Turned on for everyone', 'Включено для всех']
    };
    for (const [code, [enText, ruText]] of Object.entries(texts)) {
        const key = 'textReason' + code;
        assert.equal(en[PREFIX + key], enText, key + ' in en.json');
        assert.equal(ru[PREFIX + key], ruText, key + ' in ru.json');
        assert.equal(typeof en['Common.UI.Compact.MenuBar.' + key], 'undefined', key + ' left the shared keys of en.json');
        assert.equal(typeof ru['Common.UI.Compact.MenuBar.' + key], 'undefined', key + ' left the shared keys of ru.json');
        assert.equal(G.DE.Views.DocumentActions[key], enText, key + ' default of the catalog');
        assert.equal(catalogIn('ru')[key], ruText, key + ' with the Russian locale applied');
        assert.equal(adapter.reasonText(code[0].toLowerCase() + code.slice(1)), enText, code + ' text from the adapter');
    }
    /* The adapter ranks by its order: the review shown outranks the form and the protection. */
    const undo = G.DE.Views.DocumentActions.command('edit.undo');
    assert.equal(docs.context({reasons: ['final', 'form', 'protected']}).real.itemState(undo).reason, 'final');
    assert.equal(docs.context({reasons: ['form', 'protected']}).real.itemState(undo).reason, 'form');
    assert.equal(docs.context({reasons: ['view', 'original']}).real.itemState(undo).reason, 'view');
});

check('every catalog reason is a declared reason', () => {
    const adapter = docs.context().real;
    const reasons = plain(adapter.reasons);
    const seen = new Set();
    for (const state of LOCKS) {
        const ctx = docs.context(state);
        for (const {it} of walk(docs.sections())) {
            if (typeof it.disabled !== 'function') continue;
            for (const code of [].concat(it.disabled(ctx) || [])) {
                if (typeof code !== 'string' || !code) continue;
                seen.add(code);
                /* A reason of the editor state ranks by the declared order; a reason of the item itself
                   (no selection, not in a table…) ranks after them and has its own text. */
                const own = typeof adapter.reasonText(code) === 'string';
                assert.ok(reasons.includes(code) || own, it.k + ': ' + code + ' is declared');
                assert.ok(Model.COMMON_REASONS.includes(code) || own, it.k + ': ' + code + ' has a text of the editor');
            }
        }
    }
    for (const code of ['limit', 'offline', 'view', 'final', 'original', 'form', 'protected', 'noSelection'])
        assert.ok(seen.has(code), code + ' is reached by the states of the check');
});

check('slash menu shows the same reason text as the menu bar', () => {
    for (const file of ['apps/common/main/lib/view/compact/MenuBar.js', 'apps/documenteditor/main/app/view/SlashMenu.js'])
        if (!(file.endsWith('MenuBar.js') ? G.Common.UI.Compact.MenuBar : G.DE.Views.SlashMenu))
            vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), G, {filename: path.join(ROOT, file)});
    const bar = G.Common.UI.Compact.MenuBar, slash = G.DE.Views.SlashMenu;
    const world = docs.context({reasons: ['final', 'form', 'protected']});
    slash._adapter = world.real;
    const codes = DECLARED.concat(['noSelection', 'notInTable', 'controlLocked']);
    for (const code of codes) {
        const text = bar.reasonText(world.real, code);
        assert.equal(typeof text, 'string', code + ' has a text in the menu bar');
        assert.equal(slash.reasonText(code), text, code);
    }
    /* A command the review shown greys: the senior reason of the adapter order, in the menu bar text. */
    const items = slash.buildItems().filter(item => item.disabled);
    assert.ok(items.length, 'the review shown greys slash commands');
    for (const item of items) assert.equal(item.reason, 'Showing the final version', item.k);
    delete slash._adapter;
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
