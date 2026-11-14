/* Run: node test/unit-tests/spreadsheeteditor/compact-menu-adapter.cjs [path to CompactMenuAdapter.js]
 * The spreadsheet editor adapter behind the shared menu row (Common.UI.Compact.MenuBar): the sections and items of the
 * SheetActions catalog in the shape of the shared model (MenuModel) - in catalog order, with the row kind by the catalog
 * item (switch, group variant, submenu, group, separator); the item state is the same
 * as SheetActions has, for each role and restriction, the reason is a code, the code text is the same as the catalog's;
 * a cell edit does not let F10 into the menu row.
 * Standard menu submenus: mirror rows with keys <k>.<path>, unique in the whole menu; the standard menu
 * is read once per submenu opening (the snapshot holds while the submenu is open); a gallery row
 * shows the standard gallery at the row and answers for its nodes, a choice in it closes the menu; a counter row
 * steps through exec with the standard button and does not close the menu; the row note and description reach the
 * menu row snapshot. The gallery show is fake per the bridge contract (its mechanics are checked by stock-bridge.cjs).
 *
 * The environment is the fake stock and DOM of the roles tests (roles-locks.cjs, the part before the run): the same shell,
 * catalog and bridge as the shell menu row has. The shared layer modules and the adapter are loaded into the same context.
 * The optional argument is a broken copy of the adapter for the negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const ADAPTER = process.argv[2] ? path.resolve(process.argv[2])
    : path.join(ROOT, 'apps/spreadsheeteditor/main/app/view/CompactMenuAdapter.js');
const ROLES = path.join(__dirname, 'roles-locks.cjs');

/* The roles tests environment: their part before the run, without their own command line arguments. */
const H = (() => {
    const src = fs.readFileSync(ROLES, 'utf8');
    const at = src.indexOf('/* --- Run');
    assert.ok(at > 0, 'roles-locks.cjs: no run marker');
    const mod = {exports: {}};
    const body = src.slice(0, at) + '\nmodule.exports = {makeEnv, button, menuButton, events, El};\n';
    new Function('require', 'module', 'exports', '__dirname', '__filename', 'process', body)(
        require, mod, mod.exports, __dirname, ROLES, {argv: []});
    return mod.exports;
})();

/* The shared layer and the adapter in the environment context; the spreadsheet editor modules are those the environment already loaded. */
function withAdapter(env) {
    const known = {
        'spreadsheeteditor/main/app/view/SheetActions': env.A,
        'spreadsheeteditor/main/app/view/StockBridge': env.SSE.Views.StockBridge,
        'common/main/lib/view/compact/Icons': env.context.Common.UI.Compact.Icons
    };
    const modules = {};
    const load = (rel, abs) => {
        if (known[rel]) return known[rel];
        if (modules[rel]) return modules[rel];
        const src = fs.readFileSync(abs || path.join(ROOT, 'apps', rel + '.js'), 'utf8');
        let result;
        env.context.define = (deps, factory) => {
            const args = deps.map(d => load(d));
            result = factory(...args);
        };
        vm.runInContext(src, env.context, {filename: abs || rel});
        return (modules[rel] = result);
    };
    env.Model = load('common/main/lib/view/compact/MenuModel');
    env.Adapter = load('spreadsheeteditor/main/app/view/CompactMenuAdapter', ADAPTER);
    env.adapter = env.Adapter.create(env.shell, env.api);
    return env;
}

function makeEnv(opt) {
    return withAdapter(H.makeEnv(opt).create());
}

/* The spreadsheet editor locale and the key of the shared menu row reason text (Common.UI.Compact.MenuBar.textReason…). */
const locale = lang => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/spreadsheeteditor/main/locale', lang + '.json'), 'utf8'));
const sharedReasonKey = code => 'Common.UI.Compact.MenuBar.textReason' + code.charAt(0).toUpperCase() + code.slice(1);

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, '—', error && error.message);
        failed++;
    }
}

const isEntry = it => !!it && !it.sep && it.head == null;

/* The items of the shared section model and of the composite item submenus (without stock menu rows), with the source
   catalog item: [{x, src, path}]. */
function walk(env) {
    const out = [];
    const ctx = env.adapter.context ? env.adapter.context() : undefined;
    const visit = (items, at) => items.forEach(x => {
        if (!x || x.sep || x.kind === 'group' || x.pending) return;
        out.push({x, src: x.src, path: at + ' > ' + x.k});
        if (x.src && Array.isArray(x.src.items)) visit(env.Model.itemsOf(x, ctx), at + ' > ' + x.k);
    });
    env.adapter.sections().forEach(s => visit(env.adapter.groups(s.k), s.k));
    return out;
}

/* The roles and restrictions of the roles environment: name → a ready environment. */
const ROLE_CASES = [
    ['editor', () => makeEnv()],
    ['editor in viewing', () => { const e = makeEnv(); e.choose('view'); return e; }],
    ['reader', () => makeEnv({reader: true})],
    ['reader who may ask for editing', () => makeEnv({reader: true, options: {isEdit: false, canEdit: true, canRequestEditRights: true}})],
    ['editor without connection', () => { const e = makeEnv(); e.main.disableEditing(true); return e; }],
    ['editor during a cell edit', () => {
        const e = makeEnv();
        e.api.isCellEdited = true;
        ['btnBold', 'btnMerge', 'btnInsertImage', 'btnClearStyle'].forEach(n => { e.toolbarView[n].disabled = true; e.toolbarView[n].keepState = ['cell-editing']; });
        return e;
    }],
    ['editor on a protected sheet', () => {
        const e = makeEnv();
        e.api.asc_isProtectedSheet = () => true;
        ['btnMerge', 'btnBorders', 'btnWrap'].forEach(n => { e.toolbarView[n].disabled = true; e.toolbarView[n].keepState = ['worksheet-lock']; });
        return e;
    }],
    ['editor without the copy right', () => {
        const e = makeEnv({options: {canCopy: false}});
        e.main.errorCopyDisabled = 'Copying is disabled';
        return e;
    }]
];

/* --- The catalog behind the shared contract ---------------------------------------- */

test('adapter_sections_follow_the_catalog_order', () => {
    const env = makeEnv();
    const a = env.adapter;
    const secs = a.sections();
    assert.equal(secs.map(s => s.k).join(' '), 'file edit view insert format data collab help', 'section keys');
    assert.equal(secs.map(s => s.t).join('|'), env.A.sections().join('|'), 'section titles are the catalog ones');
    const groups = env.A.groups();
    secs.forEach((s, i) => {
        const items = a.groups(s.k);
        const want = groups[i].items.map(it => it.sep ? 'sep' : it.head != null ? 'group' : it.k).join(' ');
        const got = items.map(x => x.sep ? 'sep' : x.kind === 'group' ? 'group' : x.k).join(' ');
        assert.equal(got, want, s.k + ': items in the catalog order');
    });
    /* The children of a composite item are the catalog children now, a group header is a group with its text. */
    const formulas = a.groups('data').find(x => x.k === 'formulas');
    assert.equal(formulas.kind, 'submenu', '«Formulas ▸» is a submenu');
    const kids = env.Model.itemsOf(formulas, a.context());
    const want = env.A.children(formulas.src).map(it => it.sep ? 'sep' : it.head != null ? 'group:' + it.head : it.k).join(' ');
    assert.equal(kids.map(x => x.sep ? 'sep' : x.kind === 'group' ? 'group:' + x.t : x.k).join(' '), want, '«Formulas ▸» children');
    /* Stock menu rows in place in a composite submenu before it opens are one stub: the stock menu is not read. */
    const views = env.Model.itemsOf(a.groups('view').find(x => x.k === 'views'), a.context());
    assert.equal(views.filter(x => x.pending).length, 1, '«Views ▸»: one pending row for the stock rows');
    /* The menu row contract. */
    assert.equal(a.depth, 2, 'two submenu levels');
    assert.equal(a.reasons.filter(c => env.Model.COMMON_REASONS.indexOf(c) >= 0).join(' '),
        env.Model.COMMON_REASONS.join(' '), 'common reasons keep their order');
    ['openRow', 'itemState', 'exec', 'shortcut', 'reasonText', 'blocked'].forEach(n =>
        assert.equal(typeof a[n], 'function', n + ' is a function'));
    ['hold', 'release', 'beforeCommand'].forEach(n => assert.equal(typeof a.keys[n], 'function', 'keys.' + n));
    /* The menu description is fit for the model: keys are unique, nesting is no deeper than declared. */
    const desc = secs.map(s => ({k: s.k, items: a.groups(s.k)}));
    const problems = env.Model.validate(desc, {depth: a.depth, ctx: a.context()});
    assert.equal(problems.length, 0, problems.slice(0, 5).join('; '));
});

test('adapter_item_state_matches_sheet_actions_for_every_role', () => {
    ROLE_CASES.forEach(([who, make]) => {
        const env = make();
        const bad = [];
        let seen = 0, off = 0;
        walk(env).forEach(({x, src, path: at}) => {
            if (!src) return;
            const got = env.adapter.itemState(x);
            const want = env.A.itemState(src, env.shell);
            seen++;
            if (want.disabled) off++;
            if (got.visible !== true) bad.push(at + ': hidden');
            if (got.disabled !== !!want.disabled) bad.push(at + ': disabled ' + got.disabled + ' / ' + !!want.disabled);
            const kind = x.kind;
            if ((kind === 'check' || kind === 'radio') && got.checked !== !!want.checked) bad.push(at + ': checked ' + got.checked);
            if (got.label !== env.A.label(src)) bad.push(at + ': label ' + got.label);
        });
        assert.equal(bad.length, 0, who + ': ' + bad.slice(0, 6).join('; '));
        assert.ok(seen > 60, who + ': only ' + seen + ' items compared');
        if (who !== 'editor') assert.ok(off > 0, who + ': nothing is off');
    });
});

test('reason_codes_map_to_the_texts_of_the_catalog', () => {
    const EN = locale('en');
    const codes = {};
    ROLE_CASES.forEach(([who, make]) => {
        const env = make();
        const bad = [];
        walk(env).forEach(({x, src, path: at}) => {
            if (!src) return;
            const got = env.adapter.itemState(x);
            const want = env.A.itemState(src, env.shell);
            if (!got.disabled) return;
            const code = got.reason;
            if (code !== null && typeof code !== 'string') bad.push(at + ': reason is not a code');
            if (typeof code === 'string') {
                codes[code] = true;
                if (env.adapter.reasons.indexOf(code) < 0) bad.push(at + ': undeclared code ' + code);
            }
            /* The shared reason is named by the menu row in the words of the shared key in the spreadsheet editor locale, the adapter does not name it. */
            const common = typeof code === 'string' && env.Model.COMMON_REASONS.indexOf(code) >= 0;
            if (common && env.adapter.reasonText(code) !== null) bad.push(at + ': the adapter names the common code ' + code);
            const text = code === null ? null : common ? (EN[sharedReasonKey(code)] || null) : env.adapter.reasonText(code);
            if (text !== (want.reason || null)) bad.push(at + ': ' + code + ' → ' + text + ' / ' + want.reason);
        });
        assert.equal(bad.length, 0, who + ': ' + bad.slice(0, 6).join('; '));
    });
    /* Every catalog reason occurred at least once. */
    assert.equal(Object.keys(codes).sort().join(' '), 'cellEdit denied protected rights rightsRequest view', 'codes met');
    /* The code text is the former shell and catalog texts, and the shell names the edit restriction through it. */
    const env = makeEnv();
    const S = env.shell, A = env.A;
    assert.equal(A.reasonText('view'), S.textModeLockedView);
    assert.equal(A.reasonText('rights'), S.textModeLockedRights);
    assert.equal(A.reasonText('rightsRequest'), S.textModeLockedRequest);
    assert.equal(A.reasonText('protected'), A.textProtected);
    assert.equal(A.reasonText('cellEdit'), A.textEditing);
    assert.equal(A.reasonText('nothing') === null, true, 'unknown code has no text');
    assert.equal(S.modeCode({on: true, type: 'vo-view', options: {}}), 'view');
    assert.equal(A.reasonText(S.modeCode({on: true, type: 'vo-view', options: {}})), S.textModeLockedView);
    assert.equal(S.modeCode({on: true, type: 'disconnect', options: {}}) === null, true, 'lost connection is not named');
});

/* The shared reasons that the spreadsheet editor names are their own "Viewing" and the sheet protection: in the spreadsheet editor locale the shared keys have
   the same words as the shell and the catalog, in every language. */
test('common_reasons_speak_the_words_of_the_catalog_in_the_spreadsheet_locale', () => {
    const own = {view: 'SSE.Views.CompactShell.textModeLockedView', 'protected': 'SSE.Views.SheetActions.textProtected'};
    ['en', 'ru'].forEach(lang => {
        const l = locale(lang);
        Object.keys(own).forEach(code => {
            assert.equal(typeof l[own[code]], 'string', lang + ': ' + own[code]);
            assert.equal(l[sharedReasonKey(code)], l[own[code]], lang + ': ' + sharedReasonKey(code));
        });
    });
});

test('cell_edit_blocks_f10', () => {
    const env = makeEnv();
    assert.equal(env.adapter.blocked(), false, 'nothing covers the editor');
    env.api.isCellEdited = true;
    assert.equal(env.adapter.blocked(), true, 'a cell edit keeps F10');
    env.api.isCellEdited = false;
    assert.equal(env.adapter.blocked(), false, 'after the cell edit F10 enters the menu again');
    env.context.Common.Utils.ModalWindow = {isVisible: () => true};
    assert.equal(env.adapter.blocked(), true, 'a stock window keeps F10');
});

test('checks_and_radios_keep_their_kind', () => {
    const env = makeEnv();
    const a = env.adapter, ctx = a.context();
    const view = a.groups('view');
    const kind = k => { const x = view.find(i => i.k === k); return x ? x.kind : 'none'; };
    assert.equal(kind('viewNormal') + ' ' + kind('viewPageLayout'), 'radio radio', '«Normal · Page layout» are options of a group');
    assert.equal(kind('sheetDirection'), 'check', '«Sheet direction» is a toggle');
    assert.equal(kind('freeze'), 'submenu', '«Freeze panes ▸» is a submenu');
    const show = env.Model.itemsOf(view.find(i => i.k === 'show'), ctx);
    assert.equal(show.filter(x => !x.sep).map(x => x.kind).join(' '), 'check check check check', '«Show ▸» toggles');
    const align = env.Model.itemsOf(a.groups('format').find(i => i.k === 'align'), ctx).filter(x => !x.sep);
    assert.equal(align.every(x => x.kind === 'radio'), true, '«Alignment ▸» options');
    /* The checkmark comes from the double, as in the catalog; in a group of variants one is checked. */
    env.roots.ViewTab.btnViewNormal.pressed = true;
    const st = k => a.itemState(view.find(i => i.k === k));
    assert.equal(st('viewNormal').checked, true, 'the current option is checked');
    assert.equal(st('viewPageLayout').checked, false, 'the other option is not');
    const snap = env.Model.section(view.map(x => ({
        k: x.k, kind: x.kind, t: x.t, items: x.items,
        when: () => a.itemState(x).visible, checked: () => a.itemState(x).checked
    })), ctx);
    assert.equal(snap.rows.filter(r => r.kind === 'radio' && r.checked).length, 1, 'one checked option in the group');
    /* Submenus with a stock menu row are not executed, a variant and a switch are executed by the catalog path. */
    env.roots.ViewTab.btnViewNormal.pressed = false;
    env.log.length = 0;
    assert.equal(a.exec(view.find(i => i.k === 'viewPageLayout')), true, 'an option runs');
    assert.equal(env.log.join(' | '), 'click ViewTab:btnViewPageBreak', 'through its stock twin');
    assert.equal(a.exec(view.find(i => i.k === 'freeze')), false, 'a submenu does not run');
});

/* --- Mirrors, galleries, notes, counter -------------------------------------------- */

/* A stock menu from items: a string is a caption, '--' is a separator, an object is {caption, menu, checked,
   disabled, options, el}; an item without a caption with a counter node is a counter, with one item without a caption in the
   submenu - a gallery. Choosing an item is an entry in the environment journal. */
function stockMenu(env, specs) {
    const m = Object.assign(H.events(), {items: []});
    specs.forEach(spec => {
        if (spec === '--') { m.items.push({caption: '--', options: {caption: '--'}}); return; }
        spec = typeof spec === 'string' ? {caption: spec} : spec;
        m.items.push({
            caption: spec.caption, options: Object.assign({caption: spec.caption}, spec.options || {}),
            hidden: false, visible: true, rendered: true, disabled: !!spec.disabled,
            checkable: !!spec.checked, checked: !!spec.checked, keepState: [], menu: spec.menu || null,
            cmpEl: spec.el ? [spec.el] : undefined,
            isDisabled() { return this.disabled; },
            onItemClick() { if (!this.disabled) env.log.push('pick ' + spec.caption); }
        });
    });
    return m;
}

/* A stock gallery submenu: a shown item without a caption. */
function galleryMenu(env) {
    return stockMenu(env, [{caption: undefined}]);
}

/* The stock UpDownPicker counter in an item without a caption: caption, value, step buttons. */
function stepperNode(env, value) {
    const doc = env.doc;
    const el = doc.createElement('div');
    const part = (tag, cls, text) => { const n = el.appendChild(doc.createElement(tag)); n.className = cls; if (text) n.textContent = text; return n; };
    part('label', 'title', 'Scale');
    const down = part('button', 'btn updown-picker-button-down');
    const val = part('label', 'updown-picker-value', value);
    const up = part('button', 'btn updown-picker-button-up');
    up.addEventListener('click', () => { env.log.push('step up'); val.textContent = String(parseInt(val.textContent, 10) + 5) + '%'; });
    down.addEventListener('click', () => { env.log.push('step down'); val.textContent = String(parseInt(val.textContent, 10) - 5) + '%'; });
    return el;
}

/* The doubles with menus: "Format → Borders ▸" (rows with a description and an example, a submenu and a gallery), "File →
   Print area ▸" (a counter), "View → Views ▸" (stock menu rows in place). */
function withStock(env) {
    const T = env.toolbarView;
    T.btnBorders = Object.assign(H.button('Toolbar:btnBorders', env.log), {menu: stockMenu(env, [
        'Bottom',
        {caption: 'Top', options: {description: 'Line along the top edge'}},
        {caption: 'Thick', options: {exampleval: '2.25 pt'}, checked: true},
        '--',
        {caption: 'Border style', menu: galleryMenu(env)},
        {caption: 'More', menu: stockMenu(env, ['Inner', 'Outer'])}
    ])});
    T.btnPrintArea = Object.assign(H.button('Toolbar:btnPrintArea', env.log), {menu: stockMenu(env, [
        'Set print area', {caption: undefined, el: stepperNode(env, '100%')}, 'Clear'
    ])});
    env.roots.ViewTab.btnSheetView = Object.assign(H.button('ViewTab:btnSheetView', env.log), {menu: stockMenu(env, [
        'Default', {caption: 'Sales', checked: true}, '--', 'Manager'
    ])});
    return env;
}

/* A menu row as the shared row marks it up: in the document, expanded while the submenu is open. */
function rowNode(env, k) {
    const row = env.doc.body.appendChild(env.doc.createElement('button'));
    row.setAttribute('data-k', k);
    row.setAttribute('aria-expanded', 'false');
    return row;
}

/* Opening a submenu the way the shared menu row does it: openRow, then the item snapshot and expanding the row. */
function openSub(env, it) {
    const row = rowNode(env, it.k);
    const own = env.adapter.openRow(row, it, 0);
    const rows = own ? null : env.Model.itemsOf(it, env.adapter.context());
    if (!own) row.setAttribute('aria-expanded', 'true');
    return {row, own, rows};
}

/* A list snapshot the way the shared menu row takes it (MenuBar snapshot): the state of each item comes from the
   adapter, then the MenuModel.section rules. */
function snapshot(env, items) {
    const a = env.adapter, M = env.Model, ctx = a.context();
    const proxy = it => {
        const kind = M.kindOf(it);
        if (kind === 'sep') return {kind: 'sep'};
        const st = a.itemState(it) || {};
        const p = {k: it.k, kind, t: st.label, hint: st.hint, desc: st.desc, when: () => st.visible !== false,
                   disabled: () => (st.disabled ? (st.reason || true) : null), checked: () => !!st.checked};
        if (kind === 'submenu') p.items = M.itemsOf(it, ctx).map(proxy);
        return p;
    };
    return M.section(items.map(proxy), {}).rows;
}

/* The menu row the adapter is built into: the shell keeps it in menu. */
function fakeBar(env) {
    const calls = [];
    env.shell.menu = {ownClosed: how => { calls.push('ownClosed ' + how); return true; },
        refresh: () => { calls.push('refresh'); }, close: () => { calls.push('close'); }};
    return calls;
}

/* The gallery show per the bridge contract (StockBridge.popup / closePopup / popupOwns / dialog / popupEntry). */
function stubGallery(env, opt = {}) {
    const B = env.SSE.Views.StockBridge, calls = [];
    const node = env.doc.body.appendChild(env.doc.createElement('ul'));
    node.className = 'dropdown-menu';
    const cell = node.appendChild(env.doc.createElement('a'));
    cell.focus = () => { calls.push('focus cell'); };
    let shown = null;
    B.popup = (ref, anchor, o) => {
        calls.push('popup ' + ref + (anchor && anchor.getAttribute ? ' at ' + anchor.getAttribute('data-k') : '') + ' ' + (o && o.align));
        if (opt.refuse) return false;
        if (shown) B.closePopup('replace');
        shown = {ref, o: o || {}};
        return true;
    };
    B.closePopup = how => {
        if (!shown) return false;
        const s = shown;
        shown = null;
        calls.push('close ' + (how || 'close'));
        s.o.onClose && s.o.onClose(how || 'close');
        return true;
    };
    B.popupOpen = () => !!shown;
    B.popupOwns = n => !!shown && node.contains(n);
    B.popupEntry = () => (shown && !opt.lazy ? cell : null);
    B.dialog = ref => { calls.push('dialog ' + ref); return !!opt.dialog; };
    return {calls, node, cell};
}

const sub = (env, section, k) => env.adapter.groups(section).find(x => x.k === k);

test('mirror_rows_have_unique_keys', () => {
    const env = withStock(makeEnv());
    const borders = openSub(env, sub(env, 'format', 'borders'));
    assert.equal(borders.own, false, 'the menu bar draws the mirror list');
    const keys = [];
    const collect = list => list.forEach(x => {
        if (x.sep) return;
        keys.push(x.k);
        if (Array.isArray(x.items)) collect(x.items);
    });
    collect(borders.rows);
    assert.equal(keys.join(' '), 'borders.0 borders.1 borders.2 borders.4 borders.5 borders.5.0 borders.5.1',
        'keys are <item>.<path in the stock menu>');
    /* Stock menu rows in place in a composite submenu - the root key is <holder>>double. */
    const views = openSub(env, sub(env, 'view', 'views'));
    const vk = views.rows.filter(x => !x.sep && x.row).map(x => x.k);
    assert.equal(vk.join(' '), 'views>ViewTab:btnSheetView.0 views>ViewTab:btnSheetView.1 views>ViewTab:btnSheetView.3',
        'mirror rows inside «Views ▸»');
    const area = openSub(env, sub(env, 'file', 'printArea'));
    area.rows.filter(x => !x.sep).forEach(x => keys.push(x.k));
    vk.forEach(k => keys.push(k));
    env.adapter.sections().forEach(s => env.adapter.groups(s.k).forEach(x => { if (!x.sep && x.kind !== 'group') keys.push(x.k); }));
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.equal(dup.length, 0, 'repeated keys: ' + dup.slice(0, 5).join(' '));
    /* Open submenus are fit for the model: nesting is no deeper than two levels. */
    const desc = env.adapter.sections().map(s => ({k: s.k, items: env.adapter.groups(s.k)}));
    const problems = env.Model.validate(desc, {depth: env.adapter.depth, ctx: env.adapter.context()});
    assert.equal(problems.length, 0, problems.slice(0, 5).join('; '));
});

test('mirror_is_read_once_per_open_submenu', () => {
    const env = withStock(makeEnv());
    const B = env.SSE.Views.StockBridge, orig = B.mirror;
    const reads = [];
    B.mirror = function (ref, opts) { reads.push(ref); return orig.call(this, ref, opts); };
    const a = env.adapter, ctx = a.context();
    /* A section is snapshotted without reading the stock menus: a stub stands in place of the rows. */
    snapshot(env, a.groups('format'));
    snapshot(env, a.groups('view'));
    assert.equal(reads.length, 0, 'section snapshots read stock menus: ' + reads.join(' '));
    const it = sub(env, 'format', 'borders');
    const open = openSub(env, it);
    assert.equal(reads.join(' '), 'Toolbar:btnBorders', 'opening reads the stock menu once');
    /* The menu row refresh: the section and the open submenu are snapshotted again - without a new read. */
    for (let i = 0; i < 3; i++) {
        snapshot(env, a.groups('format'));
        const again = env.Model.itemsOf(it, ctx);
        assert.equal(again === open.rows, true, 'refresh keeps the snapshot of the open submenu');
    }
    assert.equal(reads.length, 1, 'refresh re-read the stock menu: ' + reads.length);
    /* Closed and opened again - a new read. */
    open.row.setAttribute('aria-expanded', 'false');
    assert.equal(env.Model.itemsOf(it, ctx).filter(x => x.pending).length, 1, 'a closed submenu is a pending row again');
    openSub(env, it);
    assert.equal(reads.length, 2, 'reopening reads the stock menu again');
    /* A composite submenu with stock menu rows in place - the same. */
    const views = sub(env, 'view', 'views');
    const before = reads.length;
    const v = openSub(env, views);
    snapshot(env, a.groups('view'));
    env.Model.itemsOf(views, ctx);
    assert.equal(reads.length - before, 1, '«Views ▸»: one read per opening');
    assert.equal(v.rows.filter(x => x.pending).length, 0, 'no pending rows in the open submenu');
    B.mirror = orig;
});

test('gallery_row_opens_the_stock_gallery_and_owns_it', () => {
    const env = withStock(makeEnv());
    const bar = fakeBar(env);
    const g = stubGallery(env);
    const a = env.adapter;
    /* A catalog gallery item is a submenu that opens the stock gallery at the row. */
    const chart = sub(env, 'insert', 'chart');
    assert.equal(chart.kind, 'submenu', '«Chart ▸» opens like a submenu');
    const opened = openSub(env, chart);
    assert.equal(opened.own, true, 'the gallery is an own surface');
    assert.equal(g.calls.join(' | '), 'popup Toolbar:btnInsertChart at chart tl-tr', 'stock gallery at the row');
    assert.equal(a.owns(g.cell), true, 'the gallery node belongs to the open surface');
    assert.equal(a.owns(opened.row), false, 'the row is not the gallery');
    /* From the keyboard focus goes into the gallery. */
    assert.equal(a.focusRow(opened.row, chart), true, 'focus goes into the gallery');
    assert.equal(g.calls.includes('focus cell'), true, 'on its first entry');
    /* The menu row closed the layer - the gallery is closed without a report to the row. */
    a.closeRow(opened.row, chart);
    assert.equal(a.owns(g.cell), false, 'a closed gallery owns nothing');
    assert.equal(bar.length, 0, 'closing by the menu bar is not reported back: ' + bar.join(' '));
    /* A mirror gallery row - by the address of the stock menu item. */
    const rows = openSub(env, sub(env, 'format', 'borders')).rows;
    const style = rows.find(x => x.k === 'borders.4');
    assert.equal(style.kind, 'submenu', 'the gallery row of the mirror opens like a submenu');
    assert.equal(openSub(env, style).own, true);
    assert.equal(g.calls[g.calls.length - 1], 'popup Toolbar:btnBorders.menu.items.4 at borders.4 tl-tr', 'stock submenu gallery by its address');
    assert.equal(a.owns(g.cell), true);
});

test('gallery_choice_closes_the_menu', () => {
    const env = withStock(makeEnv());
    const bar = fakeBar(env);
    stubGallery(env);
    const B = env.SSE.Views.StockBridge;
    openSub(env, sub(env, 'insert', 'chart'));
    B.closePopup('pick');
    assert.equal(bar.join(' | '), 'ownClosed chosen', 'a choice in the gallery closes the menu');
    /* The stock removed the gallery itself - the menu is alive, focus is on the item. */
    bar.length = 0;
    openSub(env, sub(env, 'insert', 'chart'));
    B.closePopup('hide');
    assert.equal(bar.join(' | '), 'ownClosed dismissed', 'the stock hid the gallery');
    /* It cannot be shown - the standard command dialog replaces the menu, on the next tick. */
    bar.length = 0;
    const refuse = stubGallery(env, {refuse: true, dialog: true});
    assert.equal(openSub(env, sub(env, 'insert', 'chart')).own, true, 'no list instead of the gallery');
    assert.equal(refuse.calls.join(' | '), 'popup Toolbar:btnInsertChart at chart tl-tr | dialog Toolbar:btnInsertChart');
    env.flush();
    assert.equal(bar.join(' | '), 'ownClosed chosen', 'the stock dialog replaces the menu');
});

test('stepper_row_steps_through_exec', () => {
    const env = withStock(makeEnv());
    const bar = fakeBar(env);
    const a = env.adapter;
    const rows = openSub(env, sub(env, 'file', 'printArea')).rows;
    const step = rows.find(x => x.kind === 'widget');
    assert.equal(step ? step.k : 'none', 'printArea.1', 'the stepper is an own row');
    assert.equal(a.itemState(step).label, 'Scale', 'its caption');
    assert.equal(a.itemState(step).disabled, false);
    /* Its own row: a caption, the stock value and two step buttons. */
    const row = env.doc.createElement('div');
    assert.equal(a.openRow(row, step, 1), true, 'the adapter draws the stepper row');
    const value = row.querySelector('.vo-mn-step-v');
    const buttons = row.querySelectorAll('.vo-mn-step-btn');
    assert.equal(value.textContent, '100%', 'stock value');
    assert.equal(buttons.length, 2);
    assert.equal(buttons.every(b => !!b.getAttribute('aria-label')), true, 'step buttons are named for the screen reader');
    /* A step is the adapter exec by the standard counter button. */
    env.log.length = 0;
    assert.equal(a.exec(step, {dir: 'up'}), true, 'exec steps up');
    assert.equal(env.log.join(' | '), 'step up', 'through the stock button');
    assert.equal(a.exec(step, {dir: 'sideways'}), false, 'an unknown direction does nothing');
    buttons[0].click();
    assert.equal(env.log.join(' | '), 'step up | step down', 'the minus button steps down');
    assert.equal(value.textContent, '100%', 'the value is read back from the stock');
    assert.equal(bar.includes('ownClosed chosen') || bar.includes('close'), false, 'stepping keeps the menu open');
    /* The root is disabled - the step does not go. */
    env.toolbarView.btnPrintArea.disabled = true;
    assert.equal(a.itemState(step).disabled, true, 'off with its root');
    assert.equal(a.exec(step, {dir: 'up'}), false, 'no step on an inactive row');
});

test('mirror_hint_and_description_reach_the_snapshot', () => {
    const env = withStock(makeEnv());
    const it = sub(env, 'format', 'borders');
    openSub(env, it);
    const rows = snapshot(env, env.adapter.groups('format'));
    const holder = rows.find(r => r.k === 'borders');
    const at = k => holder.rows.find(r => r.k === k) || {};
    assert.equal(at('borders.1').desc, 'Line along the top edge', 'the stock description is the second line');
    assert.equal(at('borders.1').hint === null, true, 'no hint without one');
    assert.equal(at('borders.2').hint, '2.25 pt', 'the example value is on the right');
    assert.equal(at('borders.2').kind + ' ' + at('borders.2').checked, 'check true', 'a checked stock row keeps its mark');
    assert.equal(at('borders.0').kind, 'action', 'an unchecked stock row is a plain item');
    /* The root is disabled - the mirror rows are disabled with its reason. */
    env.toolbarView.btnBorders.disabled = true;
    env.toolbarView.btnBorders.keepState = ['worksheet-lock'];
    env.api.asc_isProtectedSheet = () => true;
    const off = env.adapter.itemState(env.Model.itemsOf(it, env.adapter.context()).find(x => x.k === 'borders.0'));
    assert.equal(off.disabled + ' ' + off.reason, 'true protected', 'a row of an inactive root');
    /* Choosing a row is the standard click of the item. */
    env.toolbarView.btnBorders.disabled = false;
    env.log.length = 0;
    const bottom = env.Model.itemsOf(it, env.adapter.context()).find(x => x.k === 'borders.0');
    assert.equal(env.adapter.exec(bottom), true);
    assert.equal(env.log.join(' | '), 'pick Bottom', 'through the stock item');
});

/* "Format → Borders ▸" is the same mirror as the panel button list: rows with a standard icon class get the i glyph from the same
   table (SheetActions.stockGlyph) - actions, checkmarks, submenus and galleries; rows without a class or with a class that is not btn-* - without i (the place
   for the glyph is held by the menu row). Another mirror with a class not from the table gets no i. */
test('border_mirror_rows_get_stock_glyphs', () => {
    const env = withStock(makeEnv());
    const cls = c => ({iconCls: 'menu__icon ' + c});
    env.toolbarView.btnBorders.menu = stockMenu(env, [
        {caption: 'Bottom', options: cls('btn-border-bottom')},
        {caption: 'All', options: cls('btn-border-all'), checked: true},
        '--',
        {caption: 'Inside horizontal', options: cls('btn-border-insidehor')},
        {caption: 'Border style', options: cls('btn-border-style'), menu: galleryMenu(env)},
        {caption: 'Border color', options: {iconCls: 'mnu-icon-item mnu-border-color'}, menu: stockMenu(env, ['Automatic', 'Red'])},
        {caption: 'Outside', options: cls('btn-border-out'), menu: stockMenu(env, [{caption: 'Thin', options: cls('btn-border-inside')}, 'Thick'])},
        'More borders'
    ]);
    env.roots.ViewTab.btnSheetView.menu = stockMenu(env, [{caption: 'Default', options: cls('btn-sheet-view')}, 'Manager']);
    const borders = openSub(env, sub(env, 'format', 'borders'));
    assert.equal(borders.own, false, 'precondition: the menu bar draws the mirror list');
    /* The adapter lists are from the environment context (its own Array): the check is by a copy into the test array. */
    const look = list => [...list].filter(x => !x.sep).map(x => [x.t, x.kind, x.i === undefined ? null : x.i]);
    assert.deepEqual(look(borders.rows), [
        ['Bottom', 'action', 'borderBottom'],
        ['All', 'check', 'borderAll'],
        ['Inside horizontal', 'action', 'borderInnerH'],
        ['Border style', 'submenu', 'borderStyle'],
        ['Border color', 'submenu', null],
        ['Outside', 'submenu', 'borderOuter'],
        ['More borders', 'action', null]
    ], 'glyphs of the «Format → Borders ▸» rows: ' + JSON.stringify(look(borders.rows)));
    assert.equal(borders.rows.find(x => x.t === 'Border style').row.gallery, true, 'precondition: «Border style» is a gallery row');
    /* The second level of the mirror is the same table. */
    const outside = borders.rows.find(x => x.t === 'Outside');
    assert.deepEqual(look(outside.items), [['Thin', 'action', 'borderInner'], ['Thick', 'action', null]], 'glyphs of the second level');
    /* The glyph is drawn by the shared set - the same mask as for the catalog items. */
    const Icons = env.context.Common.UI.Compact.Icons;
    look(borders.rows).filter(r => r[2]).forEach(r => assert.ok(Icons.has(r[2]), r[2] + ' is not in the shared icon set'));
    /* Another mirror: a btn-* class not from the table - without a glyph. */
    const views = openSub(env, sub(env, 'view', 'views'));
    const vr = views.rows.filter(x => !x.sep && x.row);
    assert.ok(vr.length >= 2, 'precondition: the views mirror is read: ' + vr.length);
    assert.equal(vr[0].row.entry.icon, 'btn-sheet-view', 'precondition: the stock class reaches the mirror');
    assert.deepEqual([...vr].filter(x => x.i !== undefined).map(x => x.t + ' ' + x.i), [], 'another mirror got glyphs');
});

/* "Format → Borders ▸" - checkmarks by the active cell sides from the engine, the same data and the same rule as the panel button list
   (SheetActions.borderMarker): a checked row is a switch ('check') with checked in the snapshot, like a checked stock item; a side
   checks its own row, all four - also "All" and "Outside", none of the six - "No borders"; "Inside", "Style", "Color" and
   "More" are not checked; no data or the read failed - no checkmarks. Choosing a checked row is the same standard click. The engine
   is asked once per snapshot and only for a mirror with border items. */
test('border_mirror_rows_are_marked_by_the_cell_borders', () => {
    const env = withStock(makeEnv());
    const cls = c => ({iconCls: 'menu__icon ' + c});
    env.toolbarView.btnBorders.menu = stockMenu(env, [
        {caption: 'Bottom', options: cls('btn-border-bottom')}, {caption: 'Top', options: cls('btn-border-top')},
        {caption: 'Left', options: cls('btn-border-left')}, {caption: 'Right', options: cls('btn-border-right')},
        '--',
        {caption: 'No', options: cls('btn-border-no')}, {caption: 'All', options: cls('btn-border-all')},
        {caption: 'Outside', options: cls('btn-border-out')}, {caption: 'Inside', options: cls('btn-border-inside')},
        '--',
        {caption: 'Inside horizontal', options: cls('btn-border-insidehor')}, {caption: 'Inside vertical', options: cls('btn-border-insidevert')},
        '--',
        {caption: 'Border style', options: cls('btn-border-style'), menu: galleryMenu(env)},
        {caption: 'Border color', options: {iconCls: 'mnu-icon-item mnu-border-color'}, menu: stockMenu(env, ['Automatic', 'Red'])},
        'More borders'
    ]);
    env.roots.ViewTab.btnSheetView.menu = stockMenu(env, [{caption: 'Default', options: cls('btn-sheet-view')}, 'Manager']);
    /* sdkjs common/commonDefines.js: the line style None is 0, Thin is 7. The sides are asc_CBorder (asc_getStyle) or null. */
    env.context.Asc.c_oAscBorderStyles = {None: 0, Thin: 7};
    const T = 7, N = 0;
    /* one is the engine asc_getOneCell: one cell (or one merged area) is selected; undefined - the engine does not report it. */
    let sides = null, broken = false, reads = 0, one = true;
    const own = env.api.asc_getCellInfo;
    env.api.asc_getCellInfo = function () {
        const info = own.call(this);
        if (one !== undefined) info.asc_getOneCell = () => one;
        info.asc_getBorders = () => {
            reads++;
            if (broken) throw new Error('borders are not readable');
            if (!sides) return null;
            const side = n => sides[n] == null ? null : {asc_getStyle: () => sides[n]};
            return {asc_getLeft: () => side('left'), asc_getTop: () => side('top'), asc_getRight: () => side('right'),
                asc_getBottom: () => side('bottom'), asc_getDiagDown: () => side('diagDown'), asc_getDiagUp: () => side('diagUp')};
        };
        return info;
    };
    const look = () => [...openSub(env, sub(env, 'format', 'borders')).rows].filter(x => !x.sep)
        .map(x => ({t: x.t, kind: x.kind, checked: !!env.adapter.itemState(x).checked, x}));
    const FOUR = ['Bottom', 'Top', 'Left', 'Right', 'All', 'Outside'];
    const cases = [
        ['no sides (six null)', {}, ['No']],
        ['sides of style None', {left: N, top: N, right: N, bottom: N, diagDown: N, diagUp: N}, ['No']],
        ['four sides', {left: T, top: T, right: T, bottom: T}, FOUR],
        ['four sides and both diagonals', {left: T, top: T, right: T, bottom: T, diagDown: T, diagUp: T}, FOUR],
        ['only the bottom', {bottom: T}, ['Bottom']],
        ['three sides without the right', {left: T, top: T, bottom: T}, ['Bottom', 'Top', 'Left']],
        ['only the diagonal down', {diagDown: T}, []],
        ['only the diagonal up', {diagUp: T}, []],
        ['the engine reports no borders (null)', null, []]
    ];
    cases.forEach(([what, s, want]) => {
        sides = s;
        const rows = look();
        assert.equal(rows.length, 13, what + ': precondition — the stock rows: ' + rows.length);
        assert.deepEqual(rows.filter(r => r.checked).map(r => r.t), want, what + ': checked rows');
        assert.deepEqual(rows.filter(r => r.kind === 'check').map(r => r.t), want, what + ': rows of the check kind');
        assert.deepEqual(rows.filter(r => r.kind === 'submenu').map(r => r.t), ['Border style', 'Border color'], what + ': submenu rows');
    });
    /* Several cells are selected - no checkmarks: the active cell sides say nothing about the range borders. An engine that does not
       report it - the same. */
    sides = {left: T, top: T, right: T, bottom: T};
    [['a range', false], ['an engine without asc_getOneCell', undefined]].forEach(([what, o]) => {
        one = o;
        assert.deepEqual(look().filter(r => r.checked || r.kind === 'check').map(r => r.t), [], 'marks for ' + what);
    });
    one = true;
    assert.deepEqual(look().filter(r => r.checked).map(r => r.t), FOUR, 'precondition: one cell with four sides is marked');
    /* The read failed - no checkmarks. */
    sides = {bottom: T};
    broken = true;
    assert.deepEqual(look().filter(r => r.checked || r.kind === 'check').map(r => r.t), [], 'marks after a failed read');
    broken = false;
    /* A checked row is the same standard click of the item. */
    const bottom = look().find(r => r.t === 'Bottom');
    assert.equal(bottom.kind + ' ' + bottom.checked, 'check true', 'precondition: «Bottom» is marked');
    env.log.length = 0;
    assert.equal(env.adapter.exec(bottom.x), true, 'the marked row runs');
    assert.equal(env.log.join(' | '), 'pick Bottom', 'through the stock item');
    /* The engine is asked once per snapshot; another mirror does not ask it. */
    reads = 0;
    look();
    assert.equal(reads, 1, 'engine border reads per «Format → Borders ▸» snapshot');
    reads = 0;
    const views = openSub(env, sub(env, 'view', 'views'));
    assert.ok(views.rows.filter(x => !x.sep && x.row).length >= 2, 'precondition: the views mirror is read');
    assert.equal(reads, 0, 'another mirror asked the engine for borders');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
