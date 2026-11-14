/* Run: node test/unit-tests/spreadsheeteditor/menu-completeness.cjs [path to CompactMenuAdapter.js]
 * Completeness of the spreadsheet editor menu behind the shared menu row: the reference (fixtures/menu-completeness.json) is the menu that
 * the shell's own menu row showed from the SheetActions catalog and the StockBridge bridge, captured before it was replaced by
 * the shared row, for each role and each roles environment mode (roles-locks.cjs): sections, items, stock
 * menu rows (mirrors) of both levels, galleries, counters, groups, the right-hand note and the description on the second
 * line, disabled state with the reason, and checkmarks. The snapshot of the shared model (Common.UI.Compact.MenuModel) through the spreadsheet editor
 * adapter is taken the way the shared menu row takes it: a submenu is opened if the item is not disabled
 * (the adapter's openRow, then its rows), the adapter's own surface for a row is a gallery.
 * The reason is compared as the code text from the catalog (SheetActions.reasonText). Separators are not compared: the model removes extra ones.
 *
 * The keyboard walk is on the shell shared menu row (Common.UI.Compact.MenuBar): enter with F10, in each
 * section ↓ over all items, → into each submenu of both levels and over all its items, into each gallery
 * (focus goes into it) and onto the buttons of each counter row (a step does not close the menu), Escape on each level removes
 * one layer and returns focus to whoever opened it; the engine keyboard stays with the shell all this time (does not
 * go to the sheet), after the last Escape it is with the sheet again. What was walked is compared with the reference.
 *
 * The environment is the fake stock and DOM of the roles tests (the part of roles-locks.cjs before the run); the doubles with menus
 * ("Format → Borders ▸" with a description, an example, a checkmark, a second level and a gallery, "File → Print
 * area ▸" with a counter, "View → Views ▸" with stock menu rows in place) are as in
 * compact-menu-adapter.cjs. The gallery show is fake per the bridge contract: a list node in the document,
 * visible while the gallery is shown.
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
const REFERENCE = path.join(__dirname, 'fixtures/menu-completeness.json');

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

/* --- Doubles with menus and the gallery show ---------------------------------------- */

/* A stock menu from items: a string is a caption, '--' is a separator, an object is {caption, menu, checked,
   disabled, options, el}; an item without a caption with a counter node is a counter, with one item without a caption in the
   submenu - a gallery. */
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

function stepperNode(env, value) {
    const doc = env.doc;
    const el = doc.createElement('div');
    const part = (tag, cls, text) => { const n = el.appendChild(doc.createElement(tag)); n.className = cls; if (text) n.textContent = text; return n; };
    part('label', 'title', 'Scale');
    const down = part('button', 'btn updown-picker-button-down');
    part('label', 'updown-picker-value', value);
    const up = part('button', 'btn updown-picker-button-up');
    up.addEventListener('click', () => env.log.push('step up'));
    down.addEventListener('click', () => env.log.push('step down'));
    return el;
}

function withStock(env) {
    const T = env.toolbarView;
    T.btnBorders = Object.assign(H.button('Toolbar:btnBorders', env.log), {menu: stockMenu(env, [
        'Bottom',
        {caption: 'Top', options: {description: 'Line along the top edge'}},
        {caption: 'Thick', options: {exampleval: '2.25 pt'}, checked: true},
        {caption: 'Diagonal', disabled: true},
        '--',
        {caption: 'Border style', menu: stockMenu(env, [{caption: undefined}])},
        {caption: 'More', menu: stockMenu(env, ['Inner', {caption: 'Outer', checked: true}])}
    ])});
    T.btnPrintArea = Object.assign(H.button('Toolbar:btnPrintArea', env.log), {menu: stockMenu(env, [
        'Set print area', {caption: undefined, el: stepperNode(env, '100%')}, 'Clear'
    ])});
    env.roots.ViewTab.btnSheetView = Object.assign(H.button('ViewTab:btnSheetView', env.log), {menu: stockMenu(env, [
        'Default', {caption: 'Sales', checked: true}, '--', 'Manager'
    ])});
    return env;
}

/* The gallery show per the bridge contract: the show succeeds, the gallery has no nodes of its own, closing reports
   itself. There is no stock gallery in the environment - the stock show is not checked here (stock-bridge.cjs). */
function stubGallery(env) {
    const B = env.SSE.Views.StockBridge, doc = env.doc;
    const node = doc.body.appendChild(doc.createElement('ul'));
    node.className = 'dropdown-menu';
    node.style.display = 'none';
    const cell = node.appendChild(doc.createElement('li')).appendChild(doc.createElement('a'));
    let shown = null;
    B.popup = (ref, anchor, o) => {
        if (shown) B.closePopup('replace');
        shown = {ref, o: o || {}};
        node.style.display = '';
        return true;
    };
    B.closePopup = how => {
        if (!shown) return false;
        const s = shown;
        shown = null;
        node.style.display = 'none';
        s.o.onClose && s.o.onClose(how || 'close');
        return true;
    };
    B.popupOpen = () => !!shown;
    B.popupOwns = n => !!shown && node.contains(n);
    B.popupEntry = () => (shown ? cell : null);
    B.dialog = () => false;
    env.gallery = {node, cell};
    return env;
}

/* The roles and modes of the roles environment: name → environment (created, doubles with menus in place). */
function base(opt) {
    return stubGallery(withStock(H.makeEnv(opt).create()));
}

const CASES = [
    ['editor', () => { const e = base(); e.roots.ViewTab.btnViewNormal.pressed = true; return e; }],
    ['editor in viewing', () => { const e = base(); e.choose('view'); return e; }],
    ['reader', () => base({reader: true})],
    ['reader who may ask for editing', () => base({reader: true, options: {isEdit: false, canEdit: true, canRequestEditRights: true}})],
    ['editor without connection', () => { const e = base(); e.main.disableEditing(true); return e; }],
    ['editor during a cell edit', () => {
        const e = base();
        e.api.isCellEdited = true;
        ['btnBold', 'btnMerge', 'btnInsertImage', 'btnClearStyle'].forEach(n => { e.toolbarView[n].disabled = true; e.toolbarView[n].keepState = ['cell-editing']; });
        return e;
    }],
    ['editor on a protected sheet', () => {
        const e = base();
        e.api.asc_isProtectedSheet = () => true;
        ['btnMerge', 'btnBorders', 'btnWrap'].forEach(n => { e.toolbarView[n].disabled = true; e.toolbarView[n].keepState = ['worksheet-lock']; });
        return e;
    }],
    ['editor without the copy right', () => {
        const e = base({options: {canCopy: false}});
        e.main.errorCopyDisabled = 'Copying is disabled';
        return e;
    }]
];

/* --- Menu rows --------------------------------------------------------------------- */
/* A reference and snapshot row: the item path (section and item keys joined with " > "), kind, caption, right side,
   description, whether disabled, reason as text, checkmark. A group header is the holder path and [name].
   The submenu's own surface (a gallery) is a "(gallery)" row under the item path. */
function line(at, kind, label, right, desc, off, reason, checked) {
    return [at, kind, label, right || '', desc || '', off ? 'off' : 'on', reason || '', checked ? 'checked' : ''].join('|');
}

/* The menu through the adapter, as the shared menu row takes and opens it (MenuBar: snapshot, openSub): sections
   are those visible in the model snapshot; a submenu is opened for a not disabled item; if the adapter's openRow took the submenu
   for itself - it is a gallery (closed by closeRow), otherwise - the submenu rows after openRow. */
function menuLines(env) {
    const a = env.adapter, M = env.Model, A = env.A, doc = env.doc;
    const ctx = () => (typeof a.context === 'function' ? a.context() : undefined);
    const out = {};
    const proxy = it => {
        const kind = M.kindOf(it);
        if (kind === 'sep') return {kind: 'sep', src: it};
        const st = a.itemState(it) || {};
        const p = {k: it.k, kind, src: it, t: st.label !== undefined ? st.label : it.t, hint: st.hint, desc: st.desc,
            when: () => st.visible !== false, disabled: () => (st.disabled ? (st.reason || true) : null), checked: () => !!st.checked};
        if (kind === 'submenu') p.items = M.itemsOf(it, ctx()).map(proxy);
        return p;
    };
    const snap = items => M.section((items || []).map(proxy), {});
    const right = r => r.hint || (r.kind === 'widget' ? '' : (a.shortcut(r.it.src) || ''));
    const reason = r => (r.disabled && typeof r.reason === 'string' ? (A.reasonText(r.reason) || '') : '');
    const walk = (rows, at, level, list) => rows.forEach(r => {
        if (r.kind === 'sep') return;
        if (r.kind === 'group') { list.push(line(at + ' > [' + r.label + ']', 'group', r.label)); return; }
        const key = at + ' > ' + r.k;
        list.push(line(key, r.kind, r.label, right(r), r.desc, r.disabled, reason(r), r.checked));
        if (r.kind !== 'submenu' || r.disabled) return;
        const src = r.it.src, row = doc.body.appendChild(doc.createElement('button'));
        row.setAttribute('aria-expanded', 'false');
        if (a.openRow(row, src, level)) {
            list.push(line(key + ' > (gallery)', 'gallery', ''));
            a.closeRow(row, src);
            row.remove();
            return;
        }
        const items = M.itemsOf(src, ctx());
        row.setAttribute('aria-expanded', 'true');
        walk(snap(items).rows, key, level + 1, list);
        row.setAttribute('aria-expanded', 'false');
        row.remove();
    });
    a.sections().forEach(s => {
        const list = out[s.k] = [];
        const snapshot = snap(a.groups(s.k));
        if (!snapshot.visible) return;
        list.push(line(s.k, 'section', s.t));
        walk(snapshot.rows, s.k, 0, list);
    });
    return out;
}


/* --- Keyboard walk ------------------------------------------------------------------ */
/* A keyboard walk of the shell menu row (env.press: keydown capture on the window, then the focused node and
   bubbling). The result is lists of items walked with arrows by the reference paths, opened galleries and
   counter steps; problems are violations (focus left the menu, the keyboard returned to the sheet, Escape removed
   more than one layer, focus did not return to whoever opened the layer). */
function keyboardWalk(env) {
    const doc = env.doc, bar = env.shell.menu.el;
    const keys = [];
    env.api.asc_enableKeyEvents = v => keys.push(v);
    const out = {lists: {}, galleries: [], steps: [], empty: [], problems: [], entered: false, left: false, blocked: false};
    const problem = text => { if (out.problems.length < 12) out.problems.push(text); };
    const active = () => doc.activeElement;
    const rowOf = el => {
        for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (n.getAttribute('data-k') !== null) return n;
        return null;
    };
    const keyOf = el => { const r = rowOf(el); return r ? r.getAttribute('data-k') : null; };
    const flies = () => bar.querySelectorAll('.vo-mn-fly');
    const held = at => { if (!out.blocked && keys.indexOf(true) >= 0) problem(at + ': the keyboard went back to the sheet'); };
    const inMenu = at => { if (!bar.contains(active())) problem(at + ': the focus left the menu (' + (active() ? active().tagName : 'none') + ')'); };
    const press = k => env.press(k);

    /* A list with focus: ↓ cycles to the first; items of submenus and galleries - by path, layer after layer. */
    const walkList = (at, level) => {
        const first = active(), seen = [];
        for (let guard = 0; guard < 200; guard++) {
            const el = active(), k = keyOf(el);
            inMenu(at + ' > ' + k);
            held(at + ' > ' + k);
            if (seen[seen.length - 1] !== k) seen.push(k);
            const row = rowOf(el);
            if (row && row.classList.contains('vo-mn-widget')) {
                const before = env.log.length;
                press('Enter');
                const stepped = env.log.slice(before).filter(x => /^step /.test(x));
                out.steps.push(at + ' > ' + k + ' ' + stepped.join(','));
                if (!env.shell.menu.isOpen()) problem(at + ' > ' + k + ': a step closed the menu');
                if (active() !== el) problem(at + ' > ' + k + ': a step moved the focus');
            } else if (row && row.classList.contains('vo-has-sub') && row.getAttribute('aria-disabled') !== 'true') {
                descend(at + ' > ' + k, row, level);
            }
            press('ArrowDown');
            if (active() === first) break;
        }
        out.lists[at] = seen;
    };
    const descend = (at, row, level) => {
        const depth = flies().length;
        press('ArrowRight');
        if (env.gallery && env.SSE.Views.StockBridge.popupOpen()) {
            out.galleries.push(at + (active() === env.gallery.cell ? ' focused' : ' NOT focused'));
            held(at);
            press('Escape');
            if (env.SSE.Views.StockBridge.popupOpen()) problem(at + ': Escape left the gallery open');
            if (active() !== row) problem(at + ': Escape did not return the focus to the gallery row');
            if (!env.shell.menu.isOpen()) problem(at + ': Escape in the gallery closed the menu');
            return;
        }
        /* The stock menu is empty - the submenu does not open, focus stays on the item. */
        if (flies().length === depth) {
            out.empty.push(at);
            if (active() !== row) problem(at + ': an empty submenu moved the focus');
            return;
        }
        if (flies().length !== depth + 1) { problem(at + ': ArrowRight opened more than one submenu'); return; }
        if (keyOf(active()) === keyOf(row)) { problem(at + ': ArrowRight left the focus on the item'); return; }
        walkList(at, level + 1);
        press('Escape');
        if (flies().length !== depth) problem(at + ': Escape closed ' + (depth + 1 - flies().length) + ' layers');
        if (active() !== row) problem(at + ': Escape did not return the focus to the submenu item');
    };

    const tops = () => bar.querySelectorAll('.vo-mn-item').filter(b => b.getAttribute('data-k') !== null && b.getClientRects().length > 0);
    const f10 = env.press('F10');
    out.entered = tops().indexOf(active()) === 0 && keys.join(' ') === 'false';
    /* A cell edit is in progress: F10 belongs to it (the key goes on, the engine keyboard is untouched); into the row - by click, then with keys. */
    if (!out.entered && !f10.defaultPrevented && !keys.length && !bar.contains(active())) {
        out.blocked = true;
        tops()[0].focus();
    }
    tops().forEach((btn, i) => {
        if (i) press('ArrowRight');
        if (active() !== btn) { problem(btn.getAttribute('data-k') + ': ArrowRight did not reach the section'); return; }
        press('ArrowDown');
        if (btn.getAttribute('aria-expanded') !== 'true') { problem(btn.getAttribute('data-k') + ': ArrowDown did not open the section'); return; }
        walkList(btn.getAttribute('data-k'), 0);
        press('Escape');
        if (env.shell.menu.isOpen()) problem(btn.getAttribute('data-k') + ': Escape left the section open');
        if (active() !== btn) problem(btn.getAttribute('data-k') + ': Escape did not return the focus to the section');
    });
    /* No layers: Escape goes back to the sheet. */
    press('Escape');
    out.left = !bar.contains(active()) && (out.blocked ? keys.length === 0 : keys[keys.length - 1] === true);
    return out;
}

/* Reference items by list paths: holder path → item keys in order (without group headers). */
function referenceLists(role) {
    const lists = {};
    Object.keys(role).forEach(sec => role[sec].forEach(s => {
        const f = s.split('|'), at = f[0];
        if (f[1] === 'section' || f[1] === 'group' || f[1] === 'gallery') return;
        const cut = at.lastIndexOf(' > ');
        (lists[at.slice(0, cut)] = lists[at.slice(0, cut)] || []).push(at.slice(cut + 3));
    }));
    return lists;
}

/* --- Run -------------------------------------------------------------------------- */

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

const reference = JSON.parse(fs.readFileSync(REFERENCE, 'utf8'));

function makeCase(name) {
    const c = CASES.find(x => x[0] === name);
    assert.ok(c, 'no case ' + name);
    return withAdapter(c[1]());
}

test('menu_snapshot_matches_the_reference_for_every_role', () => {
    assert.equal(Object.keys(reference.roles).join(' | '), CASES.map(c => c[0]).join(' | '), 'the reference covers every role');
    CASES.forEach(([who]) => {
        const got = menuLines(makeCase(who)), want = reference.roles[who];
        Object.keys(want).forEach(sec => {
            const a = got[sec] || [], b = want[sec];
            const bad = [];
            for (let i = 0; i < Math.max(a.length, b.length) && bad.length < 4; i++) {
                if (a[i] !== b[i]) bad.push('#' + i + ' got «' + (a[i] || '—') + '» want «' + (b[i] || '—') + '»');
            }
            assert.equal(bad.length, 0, who + ', ' + sec + ': ' + bad.join('; '));
        });
        assert.equal(Object.keys(got).join(' '), Object.keys(want).join(' '), who + ': sections');
    });
});

test('no_reference_item_is_lost_including_hints_and_descriptions', () => {
    let items = 0, mirrors = 0, galleries = 0, steppers = 0, groups = 0, hints = 0, descs = 0, checks = 0, reasons = 0;
    CASES.forEach(([who]) => {
        const got = menuLines(makeCase(who));
        const have = new Set([].concat(...Object.keys(got).map(k => got[k])));
        /* An item by path: kind and caption - otherwise it is a different item. */
        const ids = new Set([...have].map(s => s.split('|').slice(0, 3).join('|')));
        const lost = [], changed = [];
        Object.keys(reference.roles[who]).forEach(sec => reference.roles[who][sec].forEach(s => {
            const f = s.split('|');
            items++;
            if (f[1] === 'gallery') galleries++;
            if (f[1] === 'widget') steppers++;
            if (f[1] === 'group') groups++;
            if (/ > [^>]*\.[^>]*$/.test(f[0]) && f[1] !== 'gallery') mirrors++;
            if (f[3]) hints++;
            if (f[4]) descs++;
            if (f[7]) checks++;
            if (f[6]) reasons++;
            if (!ids.has(f.slice(0, 3).join('|'))) lost.push(f.slice(0, 3).join('|'));
            else if (!have.has(s)) changed.push(s);
        }));
        assert.equal(lost.length, 0, who + ': lost ' + lost.slice(0, 5).join('; '));
        assert.equal(changed.length, 0, who + ': hint, description, state or mark differ at ' + changed.slice(0, 5).join('; '));
    });
    /* The reference is not empty for each row kind. */
    const kinds = {items, mirrors, galleries, steppers, groups, hints, descs, checks, reasons};
    Object.keys(kinds).forEach(k => assert.ok(kinds[k] > 0, 'the reference has no ' + k));
});


/* The keyboard walk per role - once, its result is checked by the three cases below. */
const walks = {};
function walkOf(who) {
    if (!walks[who]) walks[who] = keyboardWalk(CASES.find(c => c[0] === who)[1]());
    return walks[who];
}

test('every_section_item_is_reachable_by_arrows', () => {
    CASES.forEach(([who]) => {
        const w = walkOf(who), want = referenceLists(reference.roles[who]);
        /* F10 during a cell edit stays with it (into the menu row - by click). */
        assert.equal(w.entered, who !== 'editor during a cell edit', who + ': F10 entry with the keyboard held');
        assert.equal(w.blocked, who === 'editor during a cell edit', who + ': F10 left to the cell edit');
        assert.equal(w.problems.length, 0, who + ': ' + w.problems.join('; '));
        Object.keys(reference.roles[who]).forEach(sec => {
            assert.equal((w.lists[sec] || []).join(' '), (want[sec] || []).join(' '), who + ', ' + sec + ': items reached by arrows');
        });
        assert.equal(w.left, true, who + ': Escape without layers did not give the keyboard back to the sheet');
    });
});

test('every_submenu_level_opens_and_closes_from_the_keyboard', () => {
    let second = 0;
    CASES.forEach(([who]) => {
        const w = walkOf(who), want = referenceLists(reference.roles[who]);
        assert.equal(w.problems.length, 0, who + ': ' + w.problems.join('; '));
        /* Every reference submenu with items (not disabled) was walked, and its items are the same. */
        const ref = reference.roles[who];
        Object.keys(want).filter(at => at.indexOf(' > ') > 0).forEach(at => {
            const off = [].concat(...Object.values(ref)).some(s => s.split('|')[0] === at && s.split('|')[5] === 'off');
            if (off) return;
            assert.equal((w.lists[at] || []).join(' '), want[at].join(' '), who + ', ' + at + ': submenu items reached from the keyboard');
            if (at.split(' > ').length > 2) second++;
        });
        /* A submenu that did not open from the keyboard is empty in the reference too. */
        const full = w.empty.filter(at => want[at]);
        assert.equal(full.length, 0, who + ': submenus with items did not open: ' + full.join('; '));
    });
    assert.ok(second > 0, 'no second-level submenu was walked');
});

test('every_gallery_and_stepper_takes_focus_from_the_keyboard', () => {
    let galleries = 0, steppers = 0;
    CASES.forEach(([who]) => {
        const w = walkOf(who), ref = reference.roles[who];
        assert.equal(w.problems.length, 0, who + ': ' + w.problems.join('; '));
        const wantG = [].concat(...Object.values(ref)).filter(s => s.split('|')[1] === 'gallery').map(s => s.split('|')[0].replace(/ > \(gallery\)$/, ''));
        assert.equal(w.galleries.join('; '), wantG.map(g => g + ' focused').join('; '), who + ': galleries entered from the keyboard');
        const wantS = [].concat(...Object.values(ref)).filter(s => s.split('|')[1] === 'widget' && s.split('|')[5] === 'on').map(s => s.split('|')[0]);
        /* Both counter buttons in the arrow walk, Enter is a step with the stock button. */
        assert.equal(w.steps.join('; '), [].concat(...wantS.map(k => [k + ' step down', k + ' step up'])).join('; '),
            who + ': steppers stepped from the keyboard');
        galleries += wantG.length;
        steppers += wantS.length;
    });
    assert.ok(galleries > 0 && steppers > 0, 'nothing to check: ' + galleries + ' galleries, ' + steppers + ' steppers');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
