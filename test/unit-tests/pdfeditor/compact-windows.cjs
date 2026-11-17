/* Run: node test/unit-tests/pdfeditor/compact-windows.cjs [copies of modules or styles…]
 * Windows of the PDF viewer compact shell stand on the shared window layer: the mechanics come from
 * Common.UI.Compact.Windows (common/main/lib/view/compact/Windows.js), the template, the set for the
 * stock windows and the Document Info window from common/main/resources/less/compact/windows.less,
 * windows-stock.less and docinfo.less. The registry of the viewer (PDFE.Views.CompactWindows) holds,
 * in this order, the shared recipes of the message window, the copy warning and the keyboard
 * shortcuts, the recipe of the shared Document Info window and the three File panel windows (print,
 * advanced settings, Download as); the viewer keeps no window mechanics of its own and no template
 * of its own, and the window palette is the viewer's (compact-shell.less), not the shared tokens'.
 * The modules run in node through vm over a small world: a stock window sends modal:show before its
 * first render and window:show after it, as Window.js does. Styles are compiled with the less
 * package of build/node_modules (NODE_PATH) in the order app.less of the viewer imports them.
 * Optional arguments: copies of modules (by file name: CompactWindows.js, FileWindows.js,
 * DocInfoWindow.js) or styles (compact-windows.less, compact-shell.less) for a negative control.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const COPIES = {};
process.argv.slice(2).forEach(a => { COPIES[path.basename(a)] = path.resolve(a); });

const COMPACT_JS = path.join(ROOT, 'apps/common/main/lib/view/compact');
const COMPACT_LESS = path.join(ROOT, 'apps/common/main/resources/less/compact');
const VIEW = path.join(ROOT, 'apps/pdfeditor/main/app/view');
const PDF_LESS = path.join(ROOT, 'apps/pdfeditor/main/resources/less');
const real = {
    Windows: path.join(COMPACT_JS, 'Windows.js'),
    DocInfoWindow: path.join(COMPACT_JS, 'DocInfoWindow.js'),
    FileWindows: path.join(VIEW, 'FileWindows.js'),
    CompactWindows: path.join(VIEW, 'CompactWindows.js')
};
const file = p => COPIES[path.basename(p)] || p;
const read = p => fs.readFileSync(file(p), 'utf8');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

const SHARED_IDS = ['msg', 'copywarn', 'shortcuts'];
const IDS = SHARED_IDS.concat('docinfo', 'print', 'settings', 'saveas');
const IMPORTS = ['windows', 'windows-stock', 'docinfo'].map(n => '../../../../common/main/resources/less/compact/' + n + '.less');

/* --- small world ----------------------------------------------------------------------------- */

const classes = s => String(s || '').split(/\s+/).filter(Boolean);
function $of(n) {
    const q = {
        0: n, length: n ? 1 : 0,
        hasClass: c => !!n && classes(n.className).includes(c),
        addClass(c) { n.className = _.uniq(classes(n.className).concat(classes(c))).join(' '); return q; },
        removeClass(c) { const out = classes(c); n.className = classes(n.className).filter(x => !out.includes(x)).join(' '); return q; },
        is: sel => sel === ':disabled' ? !!n.disabled : false,
        css(k, v) { if (v === undefined) return n.style[k]; n.style[k] = v; return q; },
        html(v) { if (v === undefined) return n.text; n.text = String(v); return q; }
    };
    return q;
}

let handlers = {}, compact = true, warnings = [];
const NC = {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    trigger: (ev, ...a) => (handlers[ev] || []).slice().forEach(f => f(...a))
};

class Window {
    constructor(cfg) { this.initConfig = Object.assign({width: 300}, cfg || {}); }
    render() {
        const cfg = this.initConfig;
        this.$window = $of({className: 'asc-window modal ' + (cfg.cls || ''), style: {width: cfg.width + 'px'}});
        return this;
    }
    getFooterButtons() { return []; }
    show() { NC.trigger('modal:show', this); if (!this.$window) this.render(); NC.trigger('window:show', this); return this; }
    cls() { return classes(this.$window[0].className); }
}
class CopyWarningDialog extends Window {}
class ShortcutsDialog extends Window {}
class SymbolTableDialog extends Window {}

const rootStyle = {props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; }};
const context = {
    _, URL,
    console: {warn: (...a) => warnings.push(a.map(String).join(' ')), log: console.log},
    $: x => $of(x),
    PDFE: {Views: {}},
    Common: {NotificationCenter: NC, UI: {Keys: {RETURN: 13}, Window},
        Views: {CopyWarningDialog, ShortcutsDialog, SymbolTableDialog}},
    document: {
        baseURI: 'http://stand.test/web-apps/apps/pdfeditor/main/index.html',
        body: {classList: {contains: c => c === 'vo-compact' && compact}},
        documentElement: {style: rootStyle},
        getElementById: () => null
    }
};
context.window = context;
vm.createContext(context);
context.define = (deps, factory) => factory();
for (const name of ['Windows', 'DocInfoWindow', 'FileWindows', 'CompactWindows'])
    vm.runInContext(read(real[name]), context, {filename: file(real[name])});
const W = context.Common.UI.Compact.Windows;
const D = context.Common.UI.Compact.DocInfoWindow;
const F = context.PDFE.Views.FileWindows;
const M = context.PDFE.Views.CompactWindows;

const shell = {advanced: false, guarded: (label, fn) => function () {
    try { return fn.apply(this, arguments); } catch (e) { warnings.push('guarded ' + label + ': ' + e.message); }
}};
function fresh() {
    handlers = {}; compact = true; warnings = []; rootStyle.props = {};
    shell.advanced = false;
    M.shell = null; M.bound = false;
    M.install(shell);
}
const dressed = w => w.cls().filter(c => /^vo-win/.test(c)).join(' ');

/* --- checks ---------------------------------------------------------------------------------- */

const checks = [];
const check = (name, fn) => checks.push({name, fn});

check('the_viewer_windows_stand_on_the_shared_mechanics', () => {
    const src = read(real.CompactWindows);
    for (const dep of ['common/main/lib/view/compact/Windows', 'common/main/lib/view/compact/DocInfoWindow',
        'pdfeditor/main/app/view/FileWindows'])
        assert.ok(src.includes("'" + dep + "'"), 'CompactWindows does not require ' + dep);
    for (const own of ['guardEnter', 'edgeError', 'setActive', 'primary', 'unbind', 'centreOverWork'])
        assert.ok(!new RegExp('\\b' + own + '\\s*:\\s*function').test(src), 'CompactWindows keeps its own ' + own);
    assert.ok(W && typeof W.create === 'function', 'no Common.UI.Compact.Windows');
    for (const k of ['bind', 'unbind', 'setActive', 'guardEnter', 'hasCls'])
        assert.equal(M[k], W.create({})[k], k + ' is not the one of the shared mechanics');
});

check('the_registry_is_three_shared_windows_document_info_and_the_file_panels', () => {
    assert.deepEqual(Array.from(M.RECIPES, r => r.id), IDS, 'recipes of the viewer');
    SHARED_IDS.forEach((id, i) => assert.equal(M.RECIPES[i], W.stock([id])[0], id + ' is not the shared recipe'));
    assert.equal(M.RECIPES[3], D.recipe, 'docinfo is not the recipe of the shared Document Info window');
    assert.equal(F.RECIPES.length, 3, 'File panel windows');
    F.RECIPES.forEach((r, i) => assert.equal(M.RECIPES[4 + i], r, r.id + ' is not the File panel recipe'));
    assert.equal(M.primaryCaption, null, 'the button captions stay stock');
});

check('windows_of_the_registry_get_the_template_in_compact_only', () => {
    fresh();
    const make = {
        msg: () => new Window({cls: 'alert', role: 'alertdialog'}),
        copywarn: () => new CopyWarningDialog(),
        shortcuts: () => new ShortcutsDialog(),
        docinfo: () => new Window({cls: 'vo-docinfo-dlg', width: 560}),
        print: () => new Window({cls: 'vo-print-dlg', width: 400}),
        settings: () => new Window({cls: 'vo-settings-dlg', width: 560}),
        saveas: () => new Window({cls: 'vo-saveas-dlg', width: 560})
    };
    for (const id of IDS) {
        const w = make[id]().show();
        assert.equal(dressed(w), 'vo-win vo-win--' + id, id + ': ' + w.cls().join(' '));
    }
    assert.equal(dressed(new SymbolTableDialog().show()), '', 'a shared window outside the registry got the template');
    assert.equal(dressed(new Window({cls: 'modal-dlg'}).show()), '', 'a window outside the registry got the template');
    compact = false;
    assert.equal(dressed(make.msg().show()), '', 'outside the compact shell a message window got the template');
    assert.equal(dressed(make.docinfo().show()), '', 'outside the compact shell Document Info got the template');
    compact = true;
    shell.advanced = true;
    assert.equal(dressed(make.docinfo().show()), '', 'with the shell flag advanced Document Info got the template');
    shell.advanced = false;
    M.unbind();
    assert.equal(dressed(make.msg().show()), '', 'after unbind a message window got the template');
    assert.equal(dressed(make.docinfo().show()), '', 'after unbind Document Info got the template');
    assert.deepEqual(warnings, [], 'warnings');
});

check('a_failed_recipe_leaves_the_window_stock', () => {
    fresh();
    const recipe = D.recipe, apply = recipe.apply;
    recipe.apply = () => { throw new Error('boom'); };
    try {
        const w = new Window({cls: 'vo-docinfo-dlg', width: 560}).show();
        assert.equal(dressed(w), '', 'labels stay: ' + w.cls().join(' '));
        assert.equal(w.initConfig.cls, 'vo-docinfo-dlg', 'the class of the config is given back');
        assert.equal(w.$window[0].style.width, '560px', 'the width stays');
        assert.equal(warnings.length, 1, 'one warning: ' + warnings.join(' | '));
    } finally {
        if (apply) recipe.apply = apply; else delete recipe.apply;
    }
});

check('install_twice_subscribes_once_to_modal_show_and_not_to_a_mode_switch', () => {
    fresh();
    M.install(shell);
    assert.equal((handlers['shell:advanced'] || []).length, 0, 'shell:advanced subscriptions');
    assert.equal((handlers['modal:show'] || []).length, 1, 'modal:show subscriptions');
    const keys = () => Object.keys(rootStyle.props).sort();
    const on = ['--modal-window-mask-opacity'].concat(W.ICONS.map(n => '--vo-win-ico-' + n)).sort();
    assert.deepEqual(keys(), on, 'variables on :root after install');
    M.unbind();
    assert.deepEqual(keys(), [], 'variables on :root after unbind');
    M.install(shell);
    assert.deepEqual(keys(), on, 'variables on :root after a repeated install');
    assert.equal(M.bound, true, 'install after a rollback turns the layer on again');
    assert.equal((handlers['shell:advanced'] || []).length, 0, 'shell:advanced subscriptions after a repeated install');
    assert.equal((handlers['modal:show'] || []).length, 1, 'modal:show subscriptions after a repeated install');
});

check('styles_take_the_shared_template_set_and_document_info', async () => {
    const less = read(path.join(PDF_LESS, 'compact-windows.less'));
    const imports = Array.from(less.matchAll(/^@import\s+"([^"]+)";/gm), m => m[1]);
    assert.deepEqual(imports, IMPORTS, 'compact-windows.less imports');
    assert.ok(!/^@vo-win-pad-x\s*:/m.test(less), 'compact-windows.less declares its own template tokens');
    assert.ok(!/^\.vo-win-field\(\)\s*\{/m.test(less), 'compact-windows.less keeps its own template bricks');
    assert.ok(!/^@vo-win-label\s*:/m.test(fs.readFileSync(path.join(COMPACT_LESS, 'tokens.less'), 'utf8')),
        'tokens.less declares the window palette: it is the editor\'s');

    /* The layer the way app.less of the viewer imports it: tokens, menu, about, compact-shell.less, then
       compact-windows.less, whose imports resolve from its place in the tree. */
    const at = p => JSON.stringify(p);
    const windows = less.replace(/^@import\s+"([^"]+)";/gm, (line, rel) => '@import ' + at(path.resolve(PDF_LESS, rel)) + ';');
    const src = ['@app-image-const-path: "../img";', '@common-image-const-path: "../../../../common/main/resources/img";']
        .concat(['tokens', 'menu', 'about'].map(n => '@import ' + at(path.join(COMPACT_LESS, n + '.less')) + ';'),
            '@import ' + at(file(path.join(PDF_LESS, 'compact-shell.less'))) + ';', windows).join('\n');
    const lessc = require('less');
    const css = (await lessc.render(src, {filename: path.join(PDF_LESS, 'app.less'), javascriptEnabled: true}))
        .css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const id of IDS) assert.ok(css.includes('.vo-win.vo-win--' + id), 'no rules of ' + id);
    assert.ok(/body\.vo-compact \.asc-window\.vo-win\s*\{/.test(css), 'the template box rule');
});

(async () => {
    let passed = 0, failed = 0;
    for (const c of checks) {
        try { await c.fn(); console.log('ok ' + c.name); passed++; }
        catch (e) { console.log('FAIL ' + c.name + ': ' + e.message); failed++; }
    }
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
})();
