/* Run: node test/unit-tests/presentationeditor/shortcuts.cjs [shell modules directory]
 * Key combinations and bindings of the presentation shell.
 *
 * shell_registers_no_shortcuts_but_esc: the shell modules register no combinations: there are
 * no own Common.util.Shortcuts maps and the stock ones are not suspended; only the
 * stock slide show and comment combinations are resumed (their keys come from the stock DocumentHolder); the key
 * listeners on document and window are only Esc and the F10 entry of the shared menu bar: the stock combinations from
 * the "Keyboard shortcuts" list pass through them untouched, Esc closes an open menu and the language list.
 * catalog_twins_resolve_in_stock_tree: every item of the menu bar catalog and every toolbar button has
 * exactly one binding: a twin that is found in the sources of the stock ribbon and view, a marked
 * engine call (a stock controller method or an api call that the stock code makes) or
 * a command registered by a shell module; an unmarked call is rejected by the bridge.
 *
 * The world is a fake stock editor from the shared shell check fixtures
 * (acceptance/mode-harness.cjs). The optional argument is a directory with a copy of the shell
 * modules for a negative control (a corrupted twin address or an own
 * Ctrl+M listener on document must fail the check).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./acceptance/mode-harness.cjs');

const ARG = process.argv.slice(2).find(a => !a.startsWith('--'));
const DIR = ARG ? path.resolve(ARG) : path.join(h.PE_APP, 'view');
const CLI = {viewDir: DIR};
const APPS = path.join(h.ROOT, 'apps');
const PE_SRC = 'presentationeditor/main/app';
const COMMON_SRC = 'common/main/lib';

/* Stock combinations from the "Keyboard shortcuts" list of the presentation editor. */
const STOCK_KEYS = ['ctrl+F5', 'ctrl+m', 'ctrl+s', 'ctrl+p', 'ctrl+z', 'ctrl+y', 'ctrl+x', 'ctrl+c', 'ctrl+v', 'ctrl+a',
    'ctrl+f', 'ctrl+k', 'ctrl+b', 'ctrl+i', 'ctrl+u', 'cmd+shift+Enter', 'alt+h', 'Delete', 'F1', 'ArrowUp', 'ArrowDown',
    'Enter', 'Tab', 'PageDown', 'Home'];

const read = rel => fs.readFileSync(path.join(APPS, rel), 'utf8');
const shellSource = name => fs.readFileSync(h.SHARED_MODULES[name] || path.join(DIR, name + '.js'), 'utf8');

/* Code without comments: strings and regular expressions are not touched. */
function codeOnly(src) {
    let out = '', i = 0, q = null;
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (q) {
            out += c;
            if (c === '\\') { out += n || ''; i += 2; continue; }
            if (c === q) q = null;
            i++;
            continue;
        }
        if (c === '/' && n === '*') {
            const e = src.indexOf('*/', i + 2), end = e < 0 ? src.length : e + 2;
            out += ' ' + src.slice(i, end).replace(/[^\n]/g, '');   // strings keep the line numbers
            i = end;
            continue;
        }
        if (c === '/' && n === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
        if (c === '"' || c === "'" || c === '`') q = c;
        out += c;
        i++;
    }
    return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/* --- stock tree ---------------------------------------------------------- */

/* Bridge address roots are the files where the stock code creates their fields. */
const ROOT_FILES = {
    Toolbar: [PE_SRC + '/view/Toolbar.js'],
    ToolbarCtl: [PE_SRC + '/controller/Toolbar.js'],
    ViewTab: [PE_SRC + '/view/ViewTab.js'],
    Transitions: [PE_SRC + '/view/Transitions.js'],
    Animation: [PE_SRC + '/view/Animation.js'],
    LeftMenu: [PE_SRC + '/view/LeftMenu.js'],
    Statusbar: [PE_SRC + '/view/Statusbar.js'],
    RightMenu: [PE_SRC + '/view/RightMenu.js'],
    FileMenu: [PE_SRC + '/view/FileMenu.js'],
    Review: [COMMON_SRC + '/view/ReviewChanges.js'],
    ChartTab: [COMMON_SRC + '/view/ChartTab.js'],
    DocumentHolder: [PE_SRC + '/view/DocumentHolder.js', PE_SRC + '/view/DocumentHolderExt.js']
};

const srcCache = {};
const stockText = rel => (srcCache[rel] = srcCache[rel] || codeOnly(read(rel)));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* A stock object field: an assignment (this.x =, me.x =) or a literal key (x: …). */
function fieldIn(files, seg) {
    const re = new RegExp('(?:\\.' + esc(seg) + '\\s*=(?!=)|[{,\\s]' + esc(seg) + '\\s*:)');
    for (const rel of files) {
        const src = stockText(rel);
        const m = re.exec(src);
        if (!m) continue;
        const tail = src.slice(m.index, m.index + 3000);
        const cls = /^\.[\w$]+\s*=\s*new\s+(PE|Common)\.Views\.(\w+)\s*\(/.exec(tail);
        const next = cls ? [(cls[1] === 'PE' ? PE_SRC : COMMON_SRC) + '/view/' + cls[2] + '.js'] : null;
        return {rel, tail, next: next && fs.existsSync(path.join(APPS, next[0])) ? next : null};
    }
    return null;
}

/* An address '<root>:<path>' → where it is in the stock sources; null if not found. */
function resolveTwin(ref) {
    const m = /^(\w+):([\w$.]+)$/.exec(ref);
    if (!m || !ROOT_FILES[m[1]]) return {ok: false, why: 'unknown root'};
    const parts = m[2].split('.');
    let files = ROOT_FILES[m[1]], last = null;
    for (let i = 0; i < parts.length; i++) {
        const seg = parts[i];
        if (/^\d+$/.test(seg)) continue;                         // an index into the array of buttons or items
        if (seg === 'items' && parts[i - 1] === 'menu') continue;
        if (seg === 'menu') {
            if (!last) return {ok: false, why: 'menu without owner'};
            const owner = parts[i - 1];
            const own = /\bmenu\s*:/.test(last.tail) || new RegExp('\\.' + esc(owner) + '\\.(setMenu|menu)\\b').test(stockText(last.rel));
            if (!own) return {ok: false, why: owner + ' has no stock menu'};
            continue;
        }
        const f = fieldIn(files, seg);
        if (!f) return {ok: false, why: seg + ' not in ' + files.join(', ')};
        last = f;
        if (f.next) files = f.next;
    }
    return {ok: true, at: last && last.rel};
}

/* A marked call: a stock controller method or an api call that the stock code makes. */
function resolveEngine(name) {
    const at = name.indexOf('.');
    if (at > 0 && name.slice(0, at) !== 'api') {
        const rel = PE_SRC + '/controller/' + name.slice(0, at) + '.js';
        if (!fs.existsSync(path.join(APPS, rel))) return false;
        return new RegExp('[{,\\s]' + esc(name.slice(at + 1)) + '\\s*:\\s*function\\b').test(stockText(rel));
    }
    const method = at > 0 ? name.slice(at + 1) : name;
    const call = new RegExp('\\bapi\\.' + esc(method) + '\\s*\\(');
    return stockFiles().some(rel => call.test(stockText(rel)));
}

/* The stock code of the presentation editor: the main one (without the shell modules) and the mobile one. */
let stockList = null;
function stockFiles() {
    if (stockList) return stockList;
    const shell = new Set(h.SHELL_MODULES.map(n => PE_SRC + '/view/' + n + '.js'));
    const out = [];
    const walk = rel => fs.readdirSync(path.join(APPS, rel), {withFileTypes: true}).forEach(d => {
        const r = rel + '/' + d.name;
        if (d.isDirectory()) walk(r);
        else if (/\.jsx?$/.test(d.name) && !shell.has(r)) out.push(r);
    });
    [PE_SRC + '/controller', PE_SRC + '/view', 'presentationeditor/mobile/src'].forEach(d => {
        if (fs.existsSync(path.join(APPS, d))) walk(d);
    });
    return (stockList = out);
}

/* --- world ---------------------------------------------------------------- */

function started(opts, setup) {
    const w = h.createWorld(opts, CLI);
    if (setup) setup(w);
    h.boot(w);
    return w;
}

/* Shell key listeners on document, window, html and body. */
function globalKeyListeners(w) {
    const nodes = [w.doc, w.winTarget, w.doc.documentElement, w.doc.body].filter(Boolean);
    const out = [];
    nodes.forEach(n => (n._ls || []).forEach(l => {
        if (/^key(down|up|press)$/.test(l.type) && l.origin === 'shell') out.push(Object.assign({node: n}, l));
    }));
    return out;
}

function keyEvent(w, combo, target) {
    const parts = combo.split('+');
    const key = parts.pop();
    const mods = new Set(parts.map(p => p.toLowerCase()));
    const codes = {Enter: 13, Tab: 9, Delete: 46, Escape: 27, F1: 112, F5: 116, ArrowUp: 38, ArrowDown: 40, PageDown: 34, Home: 36};
    const keyCode = codes[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const ev = h.makeEvent(w.doc, 'keydown', {key: key.length === 1 ? key.toLowerCase() : key, keyCode, which: keyCode,
        code: key.length === 1 ? 'Key' + key.toUpperCase() : key, ctrlKey: mods.has('ctrl'), shiftKey: mods.has('shift'),
        altKey: mods.has('alt'), metaKey: mods.has('cmd')});
    ev.target = target;
    return ev;
}

/* Open a menu bar section and the status bar language list, if they exist. */
function openLayers(w) {
    const acts = w.modules.SlideActions, status = w.modules.CompactStatus;
    const btn = h.walk(h.byId(w, 'vo-menubar')).find(el => el.classList && el.classList.contains('vo-mn-item'));
    if (btn) h.click(w, btn);
    /* The language list exists only in a status bar with the edit right. */
    if (status && typeof status.openLanguages === 'function' && !status.pop && status.nodes && status.nodes.lang) {
        status.openLanguages({items: [{caption: 'Русский', checked: true}]}, [{id: '0', caption: 'Русский', checked: true}]);
        w.flush();
    }
    return {menu: !!(acts && acts.isMenuOpen && acts.isMenuOpen()), langs: !!(status && status.pop)};
}

const tests = [
    {name: 'shell_registers_no_shortcuts_but_esc', fn() {
        /* Sources: neither own shortcut maps nor suspension of the stock ones. */
        const staticGlobal = [];
        for (const name of h.SHELL_MODULES) {
            const src = codeOnly(shellSource(name));
            for (const re of [/\b(un)?delegateShortcuts\s*\(/, /\bsuspendEvents\s*\(/, /\bkeymaster\b|\bMousetrap\b/,
                /\$\(\s*(document|window)\s*\)\s*\.\s*(on|bind|keydown|keyup|keypress)\s*\(\s*['"]?key/, /\bon(keydown|keyup|keypress)\s*=/]) {
                const m = re.exec(src);
                assert.ok(!m, name + '.js:' + (m && lineOf(src, m.index)) + ' registers keys: ' + (m && m[0]));
            }
            const resume = /\bresumeEvents\s*\(/g;
            let r;
            while ((r = resume.exec(src))) {
                assert.equal(name, 'CompactModes', name + '.js:' + lineOf(src, r.index) + ' resumes stock shortcuts outside the view mode');
            }
            const glob = /\b(document|window)\s*\.\s*addEventListener\s*\(\s*['"](keydown|keyup|keypress)['"]/g;
            while ((r = glob.exec(src))) staticGlobal.push(name + '.js:' + lineOf(src, r.index));
            /* The shared menu bar sets its window listeners with the listen helper: Esc and the F10 entry. */
            const shared = /\blisten\s*\(\s*window\s*,\s*['"](keydown|keyup|keypress)['"]/g;
            while ((r = shared.exec(src))) staticGlobal.push(name + '.js:' + lineOf(src, r.index));
            assert.ok(!/\b(document\.body|document\.documentElement)\s*\.\s*addEventListener\s*\(\s*['"]key/.test(src),
                name + '.js listens for keys on body or html');
        }

        /* Only the stock slide show and comment combinations are resumed. */
        const stock = stockText(PE_SRC + '/controller/DocumentHolder.js');
        const hk = (v, mac) => {
            const m = new RegExp('me\\.' + v + '\\s*=\\s*Common\\.Utils\\.isMac\\s*\\?\\s*\'([^\']+)\'\\s*:\\s*\'([^\']+)\'').exec(stock);
            assert.ok(m, 'stock DocumentHolder has no ' + v);
            assert.ok(new RegExp('keymap\\[me\\.' + v + '\\]').test(stock), 'stock DocumentHolder does not delegate ' + v);
            return mac ? m[1] : m[2];
        };
        for (const mac of [false, true]) {
            const w = started({edit: true}, x => { if (x.ctx.Common && x.ctx.Common.Utils) x.ctx.Common.Utils.isMac = mac; });
            const keys = w.modules.CompactModes.hotkeys();
            assert.deepEqual({preview: keys.preview, comment: keys.comment}, {preview: hk('hkPreview', mac), comment: hk('hkComments', mac)},
                'the view mode must resume the stock preview and comment shortcuts only (mac ' + mac + ')');
        }

        /* Listeners on document and window are only Esc, in all modes. */
        for (const mode of ['edit', 'view', 'focus', 'reader']) {
            const w = started({edit: mode !== 'reader'});
            if (mode === 'view') { w.modules.CompactModes.setMode('view'); w.flush(); }
            if (mode === 'focus') { h.runCommand(w, 'focus'); w.flush(); }
            const layers = openLayers(w);
            const ls = globalKeyListeners(w);
            /* The language list listener is set only while the list is open. */
            const expected = staticGlobal.filter(x => layers.langs || !x.startsWith('CompactStatus.')).length;
            assert.equal(ls.length, expected, mode + ': global key listeners in the sources — ' + staticGlobal.join(', ') +
                '; installed ' + ls.length + ', expected ' + expected);
            const area = h.byId(w, 'area_id') || w.doc.body;
            const before = {header: h.rowShown(w, 'header'), menubar: h.rowShown(w, 'menubar'), toolbar: h.rowShown(w, 'toolbar')};
            for (const key of STOCK_KEYS) {
                const m = h.mark(w);
                const ev = keyEvent(w, key, area);
                ls.forEach(l => { ev.currentTarget = l.node; l.fn.call(l.node, ev); });
                w.flush();
                const s = h.since(w, m);
                assert.equal(ev.defaultPrevented, false, mode + ': ' + key + ' prevented by a shell key listener');
                assert.equal(!!ev._stop, false, mode + ': ' + key + ' stopped by a shell key listener');
                assert.deepEqual(s.act.filter(a => a.origin === 'shell').map(a => a.label), [], mode + ': ' + key + ' ran a shell command');
                assert.deepEqual(h.shellEdits(s.api).map(c => c.name), [], mode + ': ' + key + ' edited from shell code');
                assert.deepEqual(s.notices.filter(n => n.origin === 'shell').map(n => n.name), [], mode + ': ' + key + ' raised a shell notice');
            }
            const acts = w.modules.SlideActions, status = w.modules.CompactStatus;
            assert.equal(!!acts.isMenuOpen(), layers.menu, mode + ': a stock shortcut closed the menu');
            assert.equal(!!status.pop, layers.langs, mode + ': a stock shortcut closed the language list');
            assert.deepEqual({header: h.rowShown(w, 'header'), menubar: h.rowShown(w, 'menubar'), toolbar: h.rowShown(w, 'toolbar')}, before,
                mode + ': a stock shortcut changed the shell rows');

            /* Esc is the only shell key: it closes whatever is open. */
            const ev = keyEvent(w, 'Escape', area);
            ls.forEach(l => { ev.currentTarget = l.node; l.fn.call(l.node, ev); });
            w.flush();
            if (layers.menu) assert.equal(!!acts.isMenuOpen(), false, mode + ': Esc must close the open menu');
            if (layers.langs) assert.equal(!!status.pop, false, mode + ': Esc must close the language list');
            assert.ok(layers.menu || layers.langs, mode + ': nothing to close — the check would be empty');
        }
    }},

    {name: 'catalog_twins_resolve_in_stock_tree', fn() {
        const worlds = {
            edit: started({edit: true}),
            view: (() => { const w = started({edit: true}); w.modules.CompactModes.setMode('view'); w.flush(); return w; })(),
            reader: started({edit: false})
        };
        const twins = new Map(), engines = new Map(), cmds = new Map();
        const bad = [];
        const note = (map, k, where) => { if (!map.has(k)) map.set(k, where); };

        /* The menu bar catalog in three states: the twin depends on the right and the mode. */
        for (const [state, w] of Object.entries(worlds)) {
            const items = h.allItems(h.catalog(w));
            assert.ok(items.length >= 80, state + ': the menu catalog looks incomplete: ' + items.length);
            for (const {it, section} of items) {
                const where = state + ' ' + section + ' → ' + it.t;
                const ways = ['twin', 'cmd', 'engine'].filter(k => it[k]);
                const container = (Array.isArray(it.sub) && it.sub.length > 0);
                if (ways.length > 1) bad.push(where + ': more than one binding ' + ways.join('+'));
                if (!ways.length && !container) bad.push(where + ': no binding');
                if (it.twin) note(twins, it.twin, where);
                if (it.ref) note(twins, it.ref, where);
                if (it.engine) note(engines, typeof it.engine === 'string' ? it.engine : it.engine.name, {where, w});
                if (it.cmd) note(cmds, it.cmd, where);
            }
        }

        /* Toolbar buttons: each has a twin or a command; "⋯" is the container of the buttons that moved into it. */
        const tb = worlds.edit.modules.CompactToolbar;
        assert.ok(tb && tb.ITEMS, 'CompactToolbar.ITEMS is missing');
        for (const [key, item] of Object.entries(tb.ITEMS)) {
            if (key === 'more') continue;
            const ways = ['twin', 'cmd'].filter(k => item[k]);
            if (ways.length !== 1) bad.push('toolbar ' + key + ': ' + (ways.length ? 'two bindings' : 'no binding'));
            if (item.twin) note(twins, item.twin, 'toolbar ' + key);
            if (item.cmd) note(cmds, item.cmd, 'toolbar ' + key);
        }

        /* All twin addresses in the shell sources (panel rows, palettes, header, right panel). */
        const roots = Object.keys(ROOT_FILES).join('|');
        const lit = new RegExp("['\"]((?:" + roots + '):[\\w$.]+)[\'"]', 'g');
        const registered = new Set();
        for (const name of h.SHELL_MODULES) {
            const src = codeOnly(shellSource(name));
            let m;
            while ((m = lit.exec(src))) note(twins, m[1], name + '.js:' + lineOf(src, m.index));
            const reg = /\.command\(\s*'(\w+)'\s*,/g;
            while ((m = reg.exec(src))) registered.add(m[1]);
        }

        for (const [ref, where] of twins) {
            const r = resolveTwin(ref);
            if (!r.ok) bad.push(where + ': twin ' + ref + ' is not in the stock tree (' + r.why + ')');
        }
        for (const [name, {where, w}] of engines) {
            if (!w.modules.StockBridge.engineMarked(name)) bad.push(where + ': engine call ' + name + ' is not marked in the catalog');
            if (!resolveEngine(name)) bad.push(where + ': engine call ' + name + ' is not a stock controller method or a stock api call');
        }
        for (const [cmd, where] of cmds) {
            if (!registered.has(cmd)) bad.push(where + ': command ' + cmd + ' is registered by no shell module');
            if (!worlds.edit.shell.hasCommand(cmd)) bad.push(where + ': command ' + cmd + ' has no owner after start');
        }
        assert.deepEqual(bad, [], 'every catalog item and toolbar button must resolve in the stock tree');
        assert.ok(twins.size >= 120, 'too few twin addresses collected: ' + twins.size);

        /* The bridge rejects an unmarked engine call: it does not reach the engine. */
        const w = worlds.edit, B = w.modules.StockBridge;
        const m = h.mark(w);
        const gaps = B.gaps.length;
        assert.equal(B.engine('asc_Paste'), undefined, 'an unmarked engine call must be refused');
        assert.deepEqual(h.since(w, m).api.filter(c => c.origin === 'shell').map(c => c.name), [], 'an unmarked engine call reached the engine');
        assert.ok(B.gaps.length > gaps && B.gaps.some(g => g.kind === 'engine'), 'the refused call must be noted in the bridge gaps');
    }}
];

h.run(tests);
