/* Run: node test/unit-tests/documenteditor/compact-windows-shared.cjs [CompactWindows.js [compact-windows.less]]
 * Windows of the document editor compact shell stand on the shared window layer: the mechanics come from
 * Common.UI.Compact.Windows (common/main/lib/view/compact/Windows.js), the template from
 * common/main/resources/less/compact/windows.less. The documents keep their own four windows (page size,
 * columns, delete cells, new style) and the «Apply» caption of the primary button; the shared windows of the
 * common layer (symbol, table, language and others) are not in their registry and stay stock: no stock
 * window recipe, no windows-stock.less, no rules under the stock window labels in the compiled layer.
 * The module runs in node through vm over a small world: a stock window sends modal:show before its first
 * render, as Window.js does. The optional arguments are copies of the module and of the styles for a
 * negative control. Styles are compiled with the less package of build/node_modules (NODE_PATH).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const ARGS = process.argv.slice(2).map(a => path.resolve(a));
const FILE = ARGS[0] || path.join(ROOT, 'apps/documenteditor/main/app/view/CompactWindows.js');
const LESS = ARGS[1] || path.join(ROOT, 'apps/documenteditor/main/resources/less/compact-windows.less');
const DE_LESS = path.join(ROOT, 'apps/documenteditor/main/resources/less');
const SHARED = path.join(ROOT, 'apps/common/main/lib/view/compact/Windows.js');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

const OWN = ['pagesize', 'columns', 'cells', 'style'];

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

let handlers, compact, warnings;
const NC = {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    trigger: (ev, ...a) => (handlers[ev] || []).slice().forEach(f => f(...a))
};

class Window {
    constructor(cfg) { this.initConfig = Object.assign({cls: 'modal-dlg', width: 300}, cfg || {}); }
    render() {
        const cfg = this.initConfig;
        this.$window = $of({className: 'asc-window modal ' + (cfg.cls || ''), style: {width: cfg.width + 'px'}});
        const n = {className: 'btn normal dlg-btn primary', text: 'OK', disabled: false};
        this.footer = [{cmpEl: $of(n), setCaption(c) { n.text = c; }}];
        if (typeof this.afterRender === 'function') this.afterRender();
        return this;
    }
    getFooterButtons() { return this.footer || []; }
    show() { NC.trigger('modal:show', this); if (!this.$window) this.render(); NC.trigger('window:show', this); return this; }
    cls() { return classes(this.$window[0].className); }
    caption() { return this.footer[0].cmpEl.html(); }
}
class PageSizeDialog extends Window {}
class SymbolTableDialog extends Window {}
class InsertTableDialog extends Window {}
class LanguageDialog extends Window {}

const context = {
    _, URL,
    console: {warn: (...a) => warnings.push(a.map(String).join(' ')), log: console.log},
    $: x => $of(x),
    DE: {Views: {PageSizeDialog}},
    Common: {NotificationCenter: NC, UI: {Keys: {RETURN: 13}, Window},
        Views: {SymbolTableDialog, InsertTableDialog, LanguageDialog}},
    document: {
        baseURI: 'http://stand.test/web-apps/apps/documenteditor/main/index.html',
        body: {classList: {contains: c => c === 'vo-compact' && compact}},
        documentElement: {style: {props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; }}},
        getElementById: () => null
    }
};
context.window = context;
vm.createContext(context);
context.define = (deps, factory) => factory();
if (fs.existsSync(SHARED)) vm.runInContext(fs.readFileSync(SHARED, 'utf8'), context, {filename: SHARED});
vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, {filename: FILE});
const M = context.DE.Views.CompactWindows;

const shell = {advanced: false, guarded: (label, fn) => function () {
    try { return fn.apply(this, arguments); } catch (e) { warnings.push('guarded ' + label + ': ' + e.message); }
}};
function fresh() {
    handlers = {}; compact = true; warnings = [];
    M.shell = null; M.bound = false;
    M.bind(shell);
}

/* --- checks ---------------------------------------------------------------------------------- */

const checks = [];
const check = (name, fn) => checks.push({name, fn});

check('windows_stand_on_the_shared_mechanics', () => {
    const src = fs.readFileSync(FILE, 'utf8');
    assert.ok(/'common\/main\/lib\/view\/compact\/Windows'/.test(src), 'CompactWindows does not require the shared windows module');
    for (const own of ['guardEnter', 'edgeError', 'setActive', 'primary'])
        assert.ok(!new RegExp('\\b' + own + '\\s*:\\s*function').test(src), 'CompactWindows keeps its own ' + own);
    assert.ok(context.Common.UI.Compact && context.Common.UI.Compact.Windows, 'no Common.UI.Compact.Windows');
});

check('the_documents_keep_their_four_windows_and_no_stock_one', () => {
    const W = context.Common.UI.Compact.Windows;
    assert.deepEqual(Array.from(M.RECIPES, r => r.id), OWN, 'recipes of the documents');
    const stock = Array.from(W && W.STOCK_IDS || []);
    assert.ok(stock.length >= 15, 'stock recipes are listed: ' + stock.length);
    assert.deepEqual(Array.from(M.RECIPES, r => r.id).filter(id => stock.includes(id)), [], 'stock window recipes in the documents');
});

check('own_window_is_dressed_with_the_apply_caption', () => {
    fresh();
    const w = new PageSizeDialog({width: 300}).show();
    assert.ok(w.cls().includes('vo-win') && w.cls().includes('vo-win--pagesize'), 'labels: ' + w.cls().join(' '));
    assert.equal(w.$window[0].style.width, '420px', 'template width');
    assert.equal(w.caption(), 'Apply', 'the primary button says Apply');
    compact = false;
    const stockOne = new PageSizeDialog({width: 300}).show();
    assert.ok(!stockOne.cls().includes('vo-win'), 'outside the compact shell the window stays stock');
    assert.equal(stockOne.caption(), 'OK');
});

check('shared_windows_stay_stock_in_the_documents', () => {
    fresh();
    for (const W of [SymbolTableDialog, InsertTableDialog, LanguageDialog]) {
        const w = new W().show();
        assert.ok(!w.cls().includes('vo-win'), W.name + ' got the template: ' + w.cls().join(' '));
        assert.equal(w.caption(), 'OK', W.name + ' caption');
    }
    const alert = new Window({cls: 'alert', role: 'alertdialog'}).show();
    assert.ok(!alert.cls().includes('vo-win'), 'a message window got the template');
});

check('failed_recipe_gives_the_caption_back', () => {
    fresh();
    const recipe = M.RECIPES[0], apply = recipe.apply;
    recipe.apply = () => { throw new Error('boom'); };
    try {
        const w = new PageSizeDialog({width: 300}).show();
        assert.ok(!w.cls().includes('vo-win'), 'labels stay: ' + w.cls().join(' '));
        assert.equal(w.caption(), 'OK', 'the caption is given back');
        assert.equal(w.$window[0].style.width, '300px', 'the width is given back');
    } finally {
        if (apply) recipe.apply = apply; else delete recipe.apply;
    }
});

check('styles_take_the_shared_template_only', async () => {
    const less = fs.readFileSync(LESS, 'utf8');
    const imports = Array.from(less.matchAll(/^@import\s+"([^"]+)";/gm), m => m[1]);
    assert.deepEqual(imports, ['../../../../common/main/resources/less/compact/windows.less'], 'compact-windows.less imports');
    assert.ok(!/^@vo-win-pad-x\s*:|^\.vo-win-field\(\)\s*\{/m.test(less), 'compact-windows.less keeps its own template');
    const lessc = require('less');
    const shellSrc = fs.readFileSync(path.join(DE_LESS, 'compact-shell.less'), 'utf8');
    /* The layer the way app.less imports it — the shared tokens first, then compact-shell.less — with this
       copy of compact-windows.less. */
    const shared = ['tokens', 'menu', 'about'].map(n => '@import "../../../../common/main/resources/less/compact/' + n + '.less";');
    const src = ['@app-image-const-path: "../img";', '@common-image-const-path: "../../../../common/main/resources/img";']
        .concat(shared, shellSrc.replace(/@import\s+"compact-windows\.less";/, '@import ' + JSON.stringify(LESS) + ';')).join('\n');
    const css = (await lessc.render(src, {filename: path.join(DE_LESS, 'compact-shell.less'), javascriptEnabled: true}))
        .css.replace(/\/\*[\s\S]*?\*\//g, '');
    const W = context.Common.UI.Compact.Windows;
    const stock = Array.from(W && W.STOCK_IDS || []).filter(id => css.includes('.vo-win--' + id));
    assert.deepEqual(stock, [], 'rules under stock window labels');
    assert.ok(!/\.asc-window\.vo-win[^{]*\.(grouped-buttons|info-box|menu-panel)/.test(css), 'stock window kit rules in the documents');
    for (const id of OWN) assert.ok(css.includes('.vo-win.vo-win--' + id), 'no rules of ' + id);
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
