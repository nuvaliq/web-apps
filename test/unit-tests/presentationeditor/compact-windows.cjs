/* Run: node test/unit-tests/presentationeditor/compact-windows.cjs [path to CompactWindows.js [path to compact-windows.less]]
 * Presentation windows on the Air template (the CompactWindows zone): the recipe is put on a window
 * instance on modal:show only under body.vo-compact and not in the "Stock interface"; a window without
 * a recipe and a window already rendered earlier stay stock; a recipe failure rolls back
 * the marks, the width and the key handler; button captions do not change; Enter does not press
 * a disabled primary button; a field error is text on the edge; the dimming and icons are on the
 * document root, turned on by installing the zone and removed by the rollback and the "Stock
 * interface". A window whose size stock drives (vo-win-sized: "Symbol", the chart
 * editor) gets a lower size bound, but does not shrink and is rolled back entirely;
 * after every show the chart editor is centered in the workspace, below the header.
 * Styles: every window rule starts with body.vo-compact .asc-window.vo-win
 * (the only exception is the dimming under the window, .modals-mask), every recipe has
 * rules under its mark, the "fit to content" height does not touch windows with their own size.
 *
 * The module is loaded in node via vm on top of a small world: the window repeats the stock order
 * (show → modal:show → render → place → window:show, Window.js:805–897), the window classes are
 * empty subclasses.
 * The optional arguments are copies of the module and the styles for a negative control.
 * The styles are compiled by the less package from build/node_modules (of the tree or the main web-apps copy).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/presentationeditor/main/app/view');
const PE_LESS = path.join(ROOT, 'apps/presentationeditor/main/resources/less');
const ARGS = process.argv.slice(2).map(a => path.resolve(a));
const FILE = ARGS[0] || path.join(VIEW, 'CompactWindows.js');
const LESS = ARGS[1] || path.join(PE_LESS, 'compact-windows.less');
const SHELL_LESS = path.join(PE_LESS, 'compact-shell.less');
const SHARED_ICONS = path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js');
const SHARED_ABOUT = path.join(ROOT, 'apps/common/main/lib/view/compact/AboutWindow.js');
const SHARED_WINDOWS = path.join(ROOT, 'apps/common/main/lib/view/compact/Windows.js');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

const LABEL_PREFIX = 'body.vo-compact .asc-window.vo-win';
const MASK = 'body.vo-compact .modals-mask';
const BASE = 'http://stand.test/web-apps/apps/presentationeditor/main/index.html';

/* --- a small world ------------------------------------------------------- */

const classes = s => String(s || '').split(/\s+/).filter(Boolean);

/* A node with classes and an inline style; the wrapper is the subset of jQuery that the module touches. */
function node(cls) {
    return {className: cls || '', style: {width: '', height: ''}, attrs: {}, text: '', disabled: false};
}
function $of(n, kids) {
    const q = {
        0: n, length: n ? 1 : 0,
        hasClass: c => !!n && classes(n.className).includes(c),
        addClass(c) { n.className = _.uniq(classes(n.className).concat(classes(c))).join(' '); return q; },
        removeClass(c) { const out = classes(c); n.className = classes(n.className).filter(x => !out.includes(x)).join(' '); return q; },
        is: sel => sel === ':disabled' ? !!n.disabled : false,
        css(k, v) {
            if (k && typeof k === 'object') { Object.keys(k).forEach(x => q.css(x, k[x])); return q; }
            if (v === undefined) return n.style[k];
            n.style[k] = typeof v === 'number' ? v + 'px' : v;
            return q;
        },
        outerWidth: () => parseFloat(n.style.width) || 0,
        outerHeight: () => parseFloat(n.style.height) || 0,
        attr(k, v) { if (v === undefined) return n.attrs[k]; n.attrs[k] = String(v); return q; },
        text(v) { if (v === undefined) return n.text; n.text = String(v); return q; },
        html(v) { if (v === undefined) return n ? n.text : ''; if (n) n.text = String(v); return q; },
        find: sel => (kids && kids[sel]) || $of(null),
        first() { return q; }
    };
    return q;
}

let doc, handlers, warnings, captions, shown;

/* Workspace: the slide field #id_main_parent below the shell header (132), as in the live editor. */
let areas;
const rect = (x, y, w, h) => ({left: x, top: y, width: w, height: h, right: x + w, bottom: y + h});

function makeDoc(compact) {
    const props = {};
    return {
        baseURI: BASE,
        getElementById: id => areas[id] ? {getBoundingClientRect: () => areas[id]} : null,
        body: {classList: {contains: c => c === 'vo-compact' ? compact : false}},
        documentElement: {style: {
            props,
            setProperty: (k, v) => { props[k] = v; },
            removeProperty: k => { delete props[k]; }
        }}
    };
}

function button(value, caption, primary) {
    const n = node('btn normal dlg-btn' + (primary ? ' primary' : ''));
    n.text = caption;
    n.attrs.result = value;
    return {cmpEl: $of(n), value,
        setCaption(c) { captions.push(c); n.text = c; },
        setDisabled(v) { n.disabled = !!v; v ? $of(n).addClass('disabled') : $of(n).removeClass('disabled'); }};
}

/* Stock window: initConfig is the instance's own (Window.js:684), render builds the markup from
   it, show sends modal:show before the first render. */
class Window {
    /* A stock window class is built via extend (Backbone): the constructor calls initialize. */
    static extend(proto) {
        const Child = class extends this {};
        Object.assign(Child.prototype, proto);
        return Child;
    }
    constructor(cfg) { this.initialize(cfg); }
    initialize(cfg) {
        this.initConfig = Object.assign({cls: 'modal-dlg', width: 350, header: true}, cfg || {});
        this.$window = undefined;
    }
    render() {
        const cfg = this.initConfig;
        const n = node('asc-window modal' + (cfg.cls ? ' ' + cfg.cls : ''));
        n.style.width = cfg.width + 'px';
        if (typeof cfg.height === 'number') n.style.height = cfg.height + 'px';
        /* Window body: the .box node where the window can move a foreign node; the header cross is .tool.close. */
        const box = this.box = {kids: []};
        box.append = x => { if (x.parentNode && x.parentNode.remove) x.parentNode.remove(x); x.parentNode = box; box.kids.push(x); return box; };
        box.remove = x => { box.kids = box.kids.filter(k => k !== x); };
        const kids = {'> .body > .box': box};
        if (cfg.closable) kids['.tool.close'] = $of(node('tool close'));
        this.$window = $of(n, kids);
        this.footer = [button('ok', 'OK', true), button('cancel', 'Cancel')];
        if (typeof this.afterRender === 'function') this.afterRender();
        return this;
    }
    getFooterButtons() { return this.footer || []; }
    close() { this.closed = true; this.closedWith = this.box ? this.box.kids.slice() : []; }
    show(x, y) {
        shown.push(this);
        context.Common.NotificationCenter.trigger('modal:show', this);
        if (!this.$window) this.render();
        if (typeof x === 'number' && typeof y === 'number') this.$window.css({left: x, top: y});
        else this.$window.css({left: 10, top: 10});
        context.Common.NotificationCenter.trigger('window:show', this);
        return this;
    }
    cls() { return classes(this.$window[0].className); }
    width() { return this.$window[0].style.width; }
}

/* A field with validation: the subset of InputField that edgeError wraps. */
function field(cid) {
    const err = node('input-error');
    const input = node('form-control');
    const root = node('input-field');
    return {
        cid, err, input,
        cmpEl: $of(root, {'.input-error': $of(err), 'input': $of(input)}),
        _input: $of(input),
        result: true,
        checkValidate() { return this.result; },
        showError() {}
    };
}

class HyperlinkSettingsDialog extends Window {
    afterRender() { if (!this.noField) this.inputUrl = field('url'); }
}
class DateTimeDialog extends Window {}
class TextInputDialog extends Window {
    afterRender() { this.inputLabel = field('label'); }
}
class ImageFromUrlDialog extends TextInputDialog {}
class InsertTableDialog extends Window {}
class CopyWarningDialog extends Window {}
class OptionsDialog extends Window {}
class SymbolTableDialog extends Window {}
class AdvancedSettingsWindow extends Window {}
class HeaderFooterDialog extends AdvancedSettingsWindow {}
class ParagraphSettingsAdvanced extends AdvancedSettingsWindow {}
class ShapeSettingsAdvanced extends AdvancedSettingsWindow {}
class ImageSettingsAdvanced extends AdvancedSettingsWindow {}
class TableSettingsAdvanced extends AdvancedSettingsWindow {}
class ChartSettingsAdvanced extends AdvancedSettingsWindow {}
class ExternalEditor extends Window {}
class ExternalDiagramEditor extends ExternalEditor {}
class ExternalOleEditor extends ExternalEditor {}
class ExtendedColorDialog extends Window {}
class ListSettingsDialog extends Window {}
class SlideSizeSettings extends Window {}
class LanguageDialog extends Window {}
class SlideshowSettings extends Window {}
class GridSettings extends Window {}
class ShapeShadowDialog extends AdvancedSettingsWindow {}
class FormatSettingsDialog extends AdvancedSettingsWindow {}
class AutoCorrectDialog extends AdvancedSettingsWindow {}
class ShortcutsDialog extends AdvancedSettingsWindow {}
class MacrosDialog extends Window {}
class DocumentPropertyDialog extends Window {
    afterRender() { this.inputTitle = field('name'); this.inputTextOrNumber = field('value'); }
}

/* The "About" panel: contentHtml works without an instance, from the prototype strings. */
class About {}
About.prototype.txtProductName = 'Product';
About.prototype.contentHtml = function () { return '<div class="about-content">' + this.txtProductName + '</div>'; };
class LeftMenu {}
LeftMenu.prototype.tipAbout = 'About';
/* The File screen info panel: the node is in its place among its neighbors. */
class DocumentInfo {}
DocumentInfo.prototype.txtPresentationInfo = 'Presentation Info';
function fileScreen() {
    const parent = {kids: []};
    parent.remove = x => { parent.kids = parent.kids.filter(k => k !== x); };
    parent.insertBefore = (x, ref) => {
        if (x.parentNode && x.parentNode.remove) x.parentNode.remove(x);
        x.parentNode = parent;
        const i = ref ? parent.kids.indexOf(ref) : -1;
        if (i < 0) parent.kids.push(x); else parent.kids.splice(i, 0, x);
    };
    const el = {style: {display: 'none'}, parentNode: parent}, next = {parentNode: parent};
    el.nextSibling = next;
    parent.kids.push(el, next);
    const panel = {$el: [el], hidden: true, shows: 0, show() { this.shows++; this.hidden = false; el.style.display = ''; }};
    return {parent, el, next, panel, menu: {panels: {info: panel}}};
}

const context = {
    PE: {Views: {LeftMenu, FileMenuPanels: {DocumentInfo}, HyperlinkSettingsDialog, DateTimeDialog, HeaderFooterDialog, ParagraphSettingsAdvanced,
        ShapeSettingsAdvanced, ImageSettingsAdvanced, TableSettingsAdvanced, ChartSettingsAdvanced, SlideSizeSettings, SlideshowSettings, GridSettings}},
    _,
    URL,
    console: {warn: (...a) => warnings.push(a.map(String).join(' ')), log: console.log},
    $: target => $of(target),
    Common: {
        NotificationCenter: {
            on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
            trigger: (ev, ...a) => (handlers[ev] || []).slice().forEach(f => f(...a))
        },
        UI: {Keys: {RETURN: 13, ESC: 27}, Window, ExtendedColorDialog},
        Views: {TextInputDialog, ImageFromUrlDialog, InsertTableDialog, CopyWarningDialog, OptionsDialog,
            SymbolTableDialog, AdvancedSettingsWindow, ExternalEditor, ExternalDiagramEditor, ExternalOleEditor, ListSettingsDialog, LanguageDialog, About, ShapeShadowDialog, DocumentPropertyDialog, FormatSettingsDialog, AutoCorrectDialog, ShortcutsDialog, MacrosDialog}
    }
};
context.window = context;
context.innerWidth = 1440;
Object.defineProperty(context, 'document', {get: () => doc});
vm.createContext(context);
context.define = (deps, factory) => factory();
/* The window mechanics are shared (Common.UI.Compact.Windows): the presentation module depends on them. */
if (fs.existsSync(SHARED_WINDOWS)) vm.runInContext(fs.readFileSync(SHARED_WINDOWS, 'utf8'), context, {filename: SHARED_WINDOWS});
vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, {filename: FILE});
/* "About" is the shared compact window of the editors together with the shared icon set. */
for (const file of [SHARED_ICONS, SHARED_ABOUT, path.join(VIEW, 'DocInfoWindow.js')])
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
const M = context.PE.Views.CompactWindows;
const pristine = Object.assign({}, M);

/* Shell: guarded swallows a failure, like CompactShell.guarded. */
let shell;
function fresh(compact = true, advanced = false) {
    Object.keys(M).forEach(k => { if (!(k in pristine)) delete M[k]; });
    Object.assign(M, pristine, {shell: null, bound: false});
    doc = makeDoc(compact);
    areas = {id_main_parent: rect(259, 132, 1180, 689), editor_sdk: rect(0, 132, 1440, 689)};
    handlers = {}; warnings = []; captions = []; shown = [];
    const commands = {};
    shell = {
        advanced,
        commands,
        guarded: (label, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { warnings.push('guarded ' + label + ': ' + e.message); }
        },
        command(name, fn) {
            if (typeof fn === 'function') { commands[name] = fn; return fn; }
            return function () { return commands[name] ? commands[name].apply(this, arguments) : undefined; };
        }
    };
    M.install(shell);
}

const alert = () => new Window({cls: 'alert', role: 'alertdialog', width: 'auto', header: true});
/* Sizes are as in stock: "Symbol" 448 × 420 and +38 for the tabs (SymbolTableDialog.js:370–412),
   the chart editor 730 × 275 (ExternalDiagramEditor.js:52–55). */
const symbol = (w, h) => new SymbolTableDialog({width: w || 448, height: h || 458, minwidth: 448, minheight: 458,
    resizable: true, cls: 'modal-dlg invisible-borders'});
const diagram = () => new ExternalDiagramEditor({width: 730, height: 275, initwidth: 730, initheight: 275,
    minwidth: 730, minheight: 275, resizable: true, cls: 'advanced-settings-dlg no-footer', id: 'id-external-diagram-editor'});
const KINDS = [
    ['msg', alert],
    ['link', () => new HyperlinkSettingsDialog({width: 350})],
    ['imgurl', () => new ImageFromUrlDialog({width: 330, header: false})],
    ['table', () => new InsertTableDialog({width: 230})],
    ['table', () => new InsertTableDialog({width: 230, split: true})],
    ['copywarn', () => new CopyWarningDialog({width: 500, cls: 'modal-dlg copy-warning', buttons: ['ok']})],
    ['datetime', () => new DateTimeDialog({width: 350})],
    ['symbol', () => symbol()],
    ['hf', () => new HeaderFooterDialog({cls: 'advanced-settings-dlg', height: 'auto'})],
    ...[ParagraphSettingsAdvanced, ShapeSettingsAdvanced, ImageSettingsAdvanced, TableSettingsAdvanced, ChartSettingsAdvanced]
        .map(V => ['adv', () => new V({cls: 'advanced-settings-dlg', height: 'auto'})]),
    ['chartdata', () => diagram()],
    ['color', () => new ExtendedColorDialog({width: 356, cls: 'extended-color-dlg modal-dlg', header: false})],
    ['listsettings', () => new ListSettingsDialog({width: 285, height: 261, id: 'window-list-settings'})],
    ['slidesize', () => new SlideSizeSettings({width: 250, id: 'window-slide-size-settings'})],
    ['lang', () => new LanguageDialog({width: 350, header: false})],
    ['docinfo', () => new Window({cls: 'vo-docinfo-dlg', width: 560, header: true, closable: true, modal: true})],
    ['showsettings', () => new SlideshowSettings({width: 315, id: 'window-slideshow-settings'})],
    ['grid', () => new GridSettings({width: 214, id: 'window-grid-settings'})],
    ['shadow', () => new ShapeShadowDialog({cls: 'advanced-settings-dlg', height: 'auto'})],
    ['docprop', () => new DocumentPropertyDialog({width: 320})],
    ['axisformat', () => new FormatSettingsDialog({cls: 'advanced-settings-dlg', height: 'auto'})],
    ['autocorrect', () => new AutoCorrectDialog({cls: 'advanced-settings-dlg', height: 'auto'})],
    ['shortcuts', () => new ShortcutsDialog({cls: 'advanced-settings-dlg', height: 'auto', id: 'shortcuts-gialog'})],
    ['macros', () => new MacrosDialog({width: 810, height: 512, minwidth: 750, minheight: 350, resizable: true, cls: 'modal-dlg invisible-borders', id: 'macros-dialog'})]
];
const STOCK = [
    () => new Window(),
    () => new TextInputDialog({width: 330}),
    () => new OptionsDialog({width: 300}),
    () => new Window({cls: 'alert', width: 'auto'}),
    () => new Window({cls: 'modal-dlg', role: 'alertdialog'}),
    () => new AdvancedSettingsWindow({cls: 'advanced-settings-dlg', height: 'auto'}),
    () => new ExternalOleEditor({width: 900, height: 700, cls: 'advanced-settings-dlg'})
];

/* --- checks -------------------------------------------------------------- */

const checks = [];
const check = (name, fn) => checks.push({name, fn});

check('install_turns_on_mask_and_icons_on_the_root', () => {
    fresh();
    const p = doc.documentElement.style.props;
    assert.equal(p['--modal-window-mask-opacity'], '0.5');
    for (const name of M.ICONS) assert.equal(p['--vo-win-ico-' + name], 'url(' + new URL('../../common/main/resources/img/air/' + name + '.svg', BASE).href + ')', name);
    assert.ok(M.ICONS.includes('close') && M.ICONS.includes('info'), 'the close and message icons are in the set');
    assert.equal((handlers['modal:show'] || []).length, 1, 'one modal:show subscription');
    assert.equal((handlers['shell:advanced'] || []).length, 1, 'one shell:advanced subscription');
    M.install(shell);
    assert.equal((handlers['modal:show'] || []).length, 1, 'a second install does not subscribe twice');
});

check('stock_interface_and_rollback_take_the_root_back', () => {
    fresh();
    const p = doc.documentElement.style.props;
    context.Common.NotificationCenter.trigger('shell:advanced', true);
    assert.deepEqual(Object.keys(p), [], 'the stock interface gets its own mask and no template icons');
    context.Common.NotificationCenter.trigger('shell:advanced', false);
    assert.equal(p['--modal-window-mask-opacity'], '0.5', 'back to compact');
    M.unbind();
    assert.deepEqual(Object.keys(p), [], 'rollback takes everything back');
    context.Common.NotificationCenter.trigger('shell:advanced', false);
    assert.deepEqual(Object.keys(p), [], 'after rollback the zone stays off');
    const w = new DateTimeDialog().show();
    assert.ok(!w.cls().includes('vo-win'), 'after rollback windows stay stock');

    fresh(true, true);
    assert.deepEqual(Object.keys(doc.documentElement.style.props), [], 'installed in the stock interface — off');
});

check('recipes_match_their_windows_only', () => {
    fresh();
    for (const [id, make] of KINDS) {
        const w = make().show();
        assert.ok(w.cls().includes('vo-win') && w.cls().includes('vo-win--' + id), id + ': ' + w.cls().join(' '));
    }
    for (const make of STOCK) {
        const w = make().show();
        assert.ok(!w.cls().some(c => c.startsWith('vo-win')), 'stock window got labels: ' + w.cls().join(' '));
    }
    const ids = Array.from(M.RECIPES, r => r.id);
    assert.deepEqual(ids.slice().sort(), ['adv', 'autocorrect', 'axisformat', 'chartdata', 'color', 'copywarn', 'datetime', 'docinfo', 'docprop', 'grid', 'hf', 'imgurl', 'lang', 'link', 'listsettings', 'macros', 'msg',
        'shadow', 'shortcuts', 'showsettings', 'slidesize', 'symbol', 'table'], 'recipes: ' + ids);
    assert.equal(new Set(ids).size, ids.length, 'recipe ids are unique');
});

check('recipe_only_in_compact_and_not_in_stock_interface', () => {
    fresh(false);
    for (const [id, make] of KINDS) {
        const w = make().show();
        assert.ok(!w.cls().includes('vo-win'), id + ' got labels without body.vo-compact');
        assert.equal(w._voWin, undefined);
    }
    fresh(true, true);
    for (const [id, make] of KINDS) {
        const w = make().show();
        assert.ok(!w.cls().includes('vo-win'), id + ' got labels in the stock interface');
    }
    fresh();
    shell.advanced = true;
    const w = new DateTimeDialog().show();
    assert.ok(!w.cls().includes('vo-win'), 'switched to the stock interface after install');
    shell.advanced = false;
    const w2 = new DateTimeDialog().show();
    assert.ok(w2.cls().includes('vo-win--datetime'), 'back in compact the recipe applies again');
});

check('recipe_writes_only_the_instance', () => {
    fresh();
    const w = new DateTimeDialog({width: 350}).show();
    assert.equal(w.width(), '420px', 'template width');
    assert.equal(w.initConfig.width, 420);
    assert.ok(!('initConfig' in DateTimeDialog.prototype), 'the prototype is untouched');
    assert.ok(Object.prototype.hasOwnProperty.call(w, 'render'), 'render is wrapped on the instance');
    assert.ok(!Object.prototype.hasOwnProperty.call(DateTimeDialog.prototype, '_voWin'));
    const other = new DateTimeDialog({width: 350});
    assert.equal(other.render, DateTimeDialog.prototype.render, 'other instances keep the stock render');
});

check('window_without_recipe_and_rendered_window_stay_stock', () => {
    fresh();
    const plain = new Window({width: 300, keydowncallback: null}).show();
    assert.equal(plain.width(), '300px');
    assert.equal(plain.initConfig.keydowncallback, null, 'no Enter guard on a stock window');
    assert.ok(!Object.prototype.hasOwnProperty.call(plain, 'render'));

    /* A window first rendered earlier (in the "Stock interface") is not recolored
       when shown in compact. */
    const early = new DateTimeDialog({width: 350});
    early.render();
    early.show();
    assert.ok(!early.cls().includes('vo-win'), 'a rendered window got labels');
    assert.equal(early.width(), '350px');
    assert.equal(early._voWin, undefined);
});

check('failed_recipe_rolls_the_window_back_to_stock', () => {
    fresh();
    const keys = function () { return false; };
    const make = () => { const w = new HyperlinkSettingsDialog({width: 350, keydowncallback: keys}); w.noField = true; return w; };
    const w = make().show();
    assert.ok(!w.cls().some(c => c.startsWith('vo-win')), 'labels stay after a failure: ' + w.cls().join(' '));
    assert.equal(w.width(), '350px', 'the stock width is back');
    assert.equal(w.initConfig.width, 350);
    assert.equal(w.initConfig.cls, 'modal-dlg');
    assert.equal(w.initConfig.keydowncallback, keys, 'the stock key handler is back');
    assert.equal(warnings.length, 1, 'the failure is reported');
    assert.ok(/windows: link/.test(warnings[0]), warnings[0]);
    make().show();
    assert.equal(warnings.length, 1, 'the same failure is reported once');

    /* A width the window set itself from its content is not touched by the rollback. */
    const own = make();
    const render = own.render;
    own.render = function () { const r = render.apply(this, arguments); this.$window[0].style.width = '512px'; return r; };
    own.show();
    assert.equal(own.width(), '512px', 'a width set by the window itself is kept');
});

check('captions_stay_stock', () => {
    fresh();
    for (const [id, make] of KINDS) {
        const w = make().show();
        assert.deepEqual(w.getFooterButtons().map(b => b.cmpEl.html()), ['OK', 'Cancel'], id);
    }
    assert.deepEqual(captions, [], 'setCaption is never called');
    assert.ok(!('textApply' in M), 'no Apply text in the module');
});

check('enter_does_not_press_a_disabled_primary', () => {
    fresh();
    const w = new DateTimeDialog().show();
    const guard = w.initConfig.keydowncallback;
    assert.equal(typeof guard, 'function');
    const ok = w.getFooterButtons()[0], cancel = w.getFooterButtons()[1];
    const enter = target => guard.call(w, {keyCode: 13, target: target || node('')});
    assert.equal(enter(), false, 'Enter goes to the stock while OK is on');
    ok.setDisabled(true);
    assert.equal(enter(), true, 'Enter is swallowed while OK is off');
    assert.equal(enter(cancel.cmpEl[0]), false, 'Enter on Cancel goes on');
    assert.equal(guard.call(w, {keyCode: 27, target: node('')}), false, 'Esc goes on');
    ok.setDisabled(false);
    assert.equal(enter(), false);

    /* The window's own handler goes first. */
    const seen = [];
    const own = new DateTimeDialog({keydowncallback: e => { seen.push(e.keyCode); return e.keyCode === 65; }}).show();
    assert.equal(own.initConfig.keydowncallback.call(own, {keyCode: 65, target: node('')}), true);
    assert.deepEqual(seen, [65]);
});

check('field_error_is_written_on_the_edge', () => {
    fresh();
    for (const make of [() => new HyperlinkSettingsDialog(), () => new ImageFromUrlDialog({header: false}), () => new DocumentPropertyDialog()]) {
        const w = make().show();
        const f = w.inputUrl || w.inputLabel || w.inputTitle;
        f.result = ['This field is required'];
        assert.deepEqual(f.checkValidate(), ['This field is required'], 'the stock result goes through');
        assert.equal(f.err.text, 'This field is required', 'the error text is on the edge');
        assert.equal(f.err.attrs.id, 'vo-err-' + f.cid);
        assert.equal(f.input.attrs['aria-describedby'], 'vo-err-' + f.cid, 'the field is described by the error');
        f.result = true;
        f.checkValidate();
        assert.equal(f.err.text, '', 'a valid value clears the text');
        f.showError(['Too long']);
        assert.equal(f.err.text, 'Too long');
        f.showError();
        assert.equal(f.err.text, '');
        assert.equal(f.input.attrs['aria-describedby'], 'vo-err-' + f.cid, 'described once');
    }
});

check('sized_windows_get_a_floor_but_never_shrink', () => {
    fresh();
    const w = symbol().show();
    assert.ok(w.cls().includes('vo-win--symbol') && w.cls().includes('vo-win-sized'), w.cls().join(' '));
    assert.equal(w.initConfig.width, 480, 'template width floor');
    assert.equal(w.initConfig.height, 543, 'template height floor');
    assert.equal(w.initConfig.minwidth, 480, 'the drag limit is raised too');
    assert.equal(w.initConfig.minheight, 543);
    assert.equal(w.width(), '480px');

    /* A size stretched by the user (stock remembers it) stays. */
    const big = symbol(620, 700).show();
    assert.equal(big.initConfig.width, 620);
    assert.equal(big.initConfig.height, 700);
    assert.equal(big.width(), '620px');

    /* Chart editor: the "initial" height to which stock returns the window before every
       show is raised together with the height. */
    const d = diagram().show();
    assert.equal(d.initConfig.height, 300);
    assert.equal(d.initConfig.initheight, 300);
    assert.equal(d.initConfig.minheight, 300);
    assert.equal(d.initConfig.initwidth, 730, 'width is not touched');

    /* "Macros": the stock size, without the template's lower bound. */
    const mac = new MacrosDialog({width: 810, height: 512, minwidth: 750, minheight: 350, resizable: true, cls: 'modal-dlg invisible-borders'}).show();
    assert.ok(mac.cls().includes('vo-win--macros') && mac.cls().includes('vo-win-sized'), mac.cls().join(' '));
    assert.deepEqual([mac.initConfig.width, mac.initConfig.height, mac.initConfig.minwidth, mac.initConfig.minheight], [810, 512, 750, 350]);

    /* Windows without their own size have no vo-win-sized mark. */
    for (const [id, make] of KINDS) {
        if (id === 'symbol' || id === 'chartdata' || id === 'macros') continue;
        assert.ok(!make().show().cls().includes('vo-win-sized'), id);
    }
});

check('failed_sized_recipe_rolls_the_sizes_back', () => {
    fresh();
    const keep = M.RECIPES.slice();
    M.RECIPES.unshift({id: 'boom', sized: true, minWidth: 600, minHeight: 600,
        match: win => win instanceof SymbolTableDialog, apply() { throw new Error('boom'); }});
    try {
        const w = symbol().show();
        assert.ok(!w.cls().some(c => c.startsWith('vo-win')), w.cls().join(' '));
        assert.equal(w.initConfig.width, 448);
        assert.equal(w.initConfig.height, 458);
        assert.equal(w.initConfig.minwidth, 448);
        assert.equal(w.initConfig.minheight, 458);
        assert.ok(!('initheight' in w.initConfig), 'no size key the stock did not have');
        assert.equal(w.width(), '448px', 'the stock width is back in the markup');
        assert.equal(w.$window[0].style.height, '458px', 'the stock height is back in the markup');
        assert.equal(warnings.length, 1, warnings.join('; '));
    } finally {
        M.RECIPES.length = 0;
        keep.forEach(r => M.RECIPES.push(r));
    }
});

check('chart_data_editor_is_centred_over_the_work_area_after_every_show', () => {
    fresh();
    const d = diagram();
    /* Stock places the window next to the chart; in compact, under the shell header. */
    d.show(710, 20);
    const at = () => [parseFloat(d.$window.css('left')), parseFloat(d.$window.css('top'))];
    const main = areas.id_main_parent;
    assert.deepEqual(at(), [Math.round(main.left + (main.width - 730) / 2), Math.round(main.top + (main.height - 300) / 2)]);
    assert.ok(at()[1] >= main.top, 'not on the shell header');

    /* Showing the same window again (stock hides it rather than closes it): centered again. */
    d.show(5, 5);
    assert.deepEqual(at(), [Math.round(main.left + (main.width - 730) / 2), Math.round(main.top + (main.height - 300) / 2)]);

    /* A window taller than the area starts at its top; an area narrower than the window keeps the window within the screen. */
    areas.id_main_parent = rect(259, 132, 600, 200);
    d.show(5, 5);
    assert.equal(at()[1], 132);
    assert.equal(at()[0], Math.round(259 + (600 - 730) / 2));
    delete areas.id_main_parent;
    d.show(5, 5);
    assert.deepEqual(at(), [Math.round((1440 - 730) / 2), Math.round(132 + (689 - 300) / 2)], 'without the slide field — the editor area');

    /* A silent chart refresh keeps the window beyond the screen edge, so we do not touch it. */
    d.show(-10000, -10000);
    assert.deepEqual(at(), [-10000, -10000]);

    /* The "Stock interface" is the stock place. */
    shell.advanced = true;
    d.show(710, 20);
    assert.deepEqual(at(), [710, 20]);
    shell.advanced = false;

    /* Without the shell and after the rollback, too. */
    M.unbind();
    d.show(710, 20);
    assert.deepEqual(at(), [710, 20]);

    /* Windows without shown do not move. */
    fresh();
    const s = symbol().show(33, 44);
    assert.deepEqual([s.$window.css('left'), s.$window.css('top')], ['33px', '44px']);
});

check('about_command_opens_the_shared_about_window', () => {
    fresh();
    assert.equal(typeof shell.commands.about, 'function', 'the zone registers the about command');
    const before = shown.length;
    shell.command('about')();
    assert.equal(shown.length, before + 1, 'one window');
    const w = shown[shown.length - 1];
    assert.ok(w instanceof context.Common.UI.Compact.AboutWindow, 'the About window of the shared compact layer');
    assert.ok(w instanceof Window, 'a stock window');
    assert.equal(w.initConfig.title, 'About', 'title — the stock About tip');
    assert.equal(w.initConfig.width, 520);
    assert.equal(w.initConfig.modal, true);
    assert.equal(w.initConfig.closable, true);
    assert.equal(w.initConfig.buttons, undefined, 'no footer buttons');
    assert.equal(w.initConfig.tpl, '<div class="about-content">Product</div>', 'the content of the stock About panel');
    assert.ok(w.cls().includes('vo-about-dlg'), 'the class of the shared window: ' + w.cls().join(' '));
    assert.ok(!w.cls().some(c => c.startsWith('vo-win')), 'the window template dressed the shared window: ' + w.cls().join(' '));
    assert.ok(w.$window.find('.tool.close').html().indexOf('/common/main/resources/img/air/close.svg)') > 0,
        'the close button of the shared window draws the shared AIR icon');

    /* After the rollback there is no window: the zone no longer opens its windows. */
    M.unbind();
    shell.command('about')();
    assert.equal(shown.length, before + 1, 'no window after rollback');
});

check('doc_info_command_shows_the_stock_info_panel_in_a_window_and_gives_it_back', () => {
    fresh();
    assert.equal(typeof shell.commands.docInfo, 'function', 'the zone registers the docInfo command');
    const fs1 = fileScreen();
    context.PE.Views.StockBridge = {ROOTS: {FileMenu: () => fs1.menu}};
    try {
        const before = shown.length;
        shell.command('docInfo')();
        assert.equal(shown.length, before + 1, 'one window');
        const w = shown[shown.length - 1];
        assert.equal(w.initConfig.title, 'Presentation Info', 'title — the heading of the stock panel');
        assert.equal(w.initConfig.buttons, undefined, 'no footer buttons');
        assert.ok(w.cls().includes('vo-win--docinfo'), 'on the window template: ' + w.cls().join(' '));
        assert.equal(fs1.el.parentNode, w.box, 'the stock panel node is in the window');
        assert.equal(fs1.panel.shows, 1, 'the panel is shown — it reads the document properties again');
        assert.ok(!fs1.parent.kids.includes(fs1.el), 'one panel, not a copy');

        /* Closing: the node is in its place until the window markup is removed, visibility is as it was. */
        w.close();
        assert.equal(w.closed, true, 'the stock close runs');
        assert.deepEqual(w.closedWith, [], 'the panel left the window before its markup went away');
        assert.equal(fs1.el.parentNode, fs1.parent);
        assert.deepEqual(fs1.parent.kids, [fs1.el, fs1.next], 'the panel is back before its neighbour');
        assert.equal(fs1.el.style.display, 'none');
        assert.equal(fs1.panel.hidden, true);
        w.close();
        assert.deepEqual(fs1.parent.kids, [fs1.el, fs1.next], 'a second close does not move the panel');

        /* Without the stock panel there is no window. */
        context.PE.Views.StockBridge = {ROOTS: {FileMenu: () => null}};
        const n = shown.length;
        assert.equal(shell.command('docInfo')(), null);
        assert.equal(shown.length, n, 'no window without the stock panel');
    } finally {
        delete context.PE.Views.StockBridge;
    }
});

/* --- styles -------------------------------------------------------------- */

function lessCompiler() {
    const roots = [path.join(ROOT, 'build')];
    try {
        const common = cp.execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
        roots.push(path.join(path.dirname(common), 'build'));
    } catch (e) { /* without git, only the tree */ }
    for (const r of roots) {
        try { return require(require.resolve('less', {paths: [r]})); } catch (e) { /* next */ }
    }
    throw new Error('the less compiler is not found (npm install in build/ of the web-apps copy)');
}

/* The selector list is split by top-level commas: a comma inside :has(…) and :not(…) is part of
   one selector. */
function splitList(prelude) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of prelude) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && !depth) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    out.push(cur);
    return out;
}

/* Window styles on the shell tokens (its blocks before "Shell"): rules only from the windows file. */
let rulesCache = null;
async function windowRules() {
    if (rulesCache) return rulesCache;
    const shellSrc = fs.readFileSync(SHELL_LESS, 'utf8');
    const cut = shellSrc.indexOf('/* --- Shell');
    assert.ok(cut > 0, 'compact-shell.less: no "Shell" section');
    const src = shellSrc.slice(0, cut) + '\n@import ' + JSON.stringify(LESS) + ';\n';
    const out = await lessCompiler().render(src, {filename: SHELL_LESS, javascriptEnabled: true});
    const css = out.css.replace(/\/\*[\s\S]*?\*\//g, '');
    const list = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        const prelude = m[1].trim();
        if (prelude.startsWith('@')) continue;
        const sels = splitList(prelude).map(s => s.trim().replace(/\s+/g, ' '));
        /* Shell token value blocks are not window rules. */
        if (sels.every(s => /^body\.vo-(compact|boot)(\.theme-type-dark)?$/.test(s))) continue;
        list.push({sels, decls: m[2]});
    }
    rulesCache = list;
    return list;
}

check('shell_imports_window_styles', async () => {
    const src = fs.readFileSync(SHELL_LESS, 'utf8');
    assert.equal((src.match(/@import\s+"compact-windows\.less";/g) || []).length, 1, 'compact-shell.less imports compact-windows.less once');
});

check('every_window_rule_is_under_the_template_label', async () => {
    const rules = await windowRules();
    assert.ok(rules.length > 100, 'too few rules: ' + rules.length);
    const sels = [].concat(...rules.map(r => r.sels));
    const bad = sels.filter(s => !s.startsWith(LABEL_PREFIX) && s !== MASK);
    assert.deepEqual(bad, [], 'rules outside body.vo-compact .asc-window.vo-win');
    assert.equal(sels.filter(s => s === MASK).length, 1, 'one dimming rule, only under body.vo-compact');
});

check('every_recipe_has_its_rules', async () => {
    const rules = await windowRules();
    fresh();
    for (const r of M.RECIPES) {
        const own = rules.filter(x => x.sels.some(s => s.startsWith(LABEL_PREFIX + '.vo-win--' + r.id + ' ') ||
            s === LABEL_PREFIX + '.vo-win--' + r.id || s.startsWith(LABEL_PREFIX + '.vo-win--' + r.id + ':') ||
            s.startsWith(LABEL_PREFIX + '.vo-win--' + r.id + ' >')) && x.decls.trim());
        assert.ok(own.length, 'no rules under .vo-win--' + r.id);
    }
});

check('sized_windows_keep_their_height', async () => {
    const rules = await windowRules();
    const auto = rules.filter(r => /height:\s*auto\s*!important/.test(r.decls) &&
        r.sels.some(s => s === LABEL_PREFIX || s === LABEL_PREFIX + ':not(.vo-win-sized)'));
    assert.deepEqual([].concat(...auto.map(r => r.sels)), [LABEL_PREFIX + ':not(.vo-win-sized)'],
        'the window height follows the content only for windows without their own size');
    /* No window rule with its own size sets a height on the window box and body. */
    const own = rules.filter(r => r.sels.some(s => /\.vo-win--(symbol|chartdata|macros)( > \.body)?$/.test(s)) && /(^|;)\s*height\s*:/.test(r.decls));
    assert.deepEqual(own.map(r => r.sels.join(', ')), [], 'a sized window rule sets a height');
    /* The "tabs on the left" template is not for them either. */
    const adv = rules.filter(r => r.sels.some(s => s.startsWith(LABEL_PREFIX + '.advanced-settings-dlg')));
    assert.ok(adv.length, 'left tabs rules');
    for (const r of adv) for (const s of r.sels) {
        if (s.startsWith(LABEL_PREFIX + '.advanced-settings-dlg'))
            assert.ok(s.startsWith(LABEL_PREFIX + '.advanced-settings-dlg:not(.vo-win-sized)'), s);
    }
});

check('advanced_settings_share_one_content_width', async () => {
    const rules = await windowRules();
    const widthOf = re => rules.filter(r => r.sels.some(s => s.includes('.vo-win--adv') && re.test(s)) && /(^|;)\s*width\s*:/.test(r.decls))
        .map(r => (r.decls.match(/(?:^|;)\s*width\s*:\s*([^;!]+)/) || [])[1].trim());
    const widths = widthOf(/\.content-panel$/);
    assert.equal(widths.length, 1, 'one content width rule: ' + widths);
    assert.equal(widths[0], '464px', 'content 420 and its paddings');
    /* The chart is wider: axis tabs in three columns, otherwise the window is taller than 600. */
    const chart = widthOf(/\.content-panel:has\(> #id-chart-settings-dlg-layout\)$/);
    assert.deepEqual(chart, ['644px'], 'chart content 600 and its paddings');
    /* Dense form: the m (34) size field in the advanced settings windows. */
    const dense = rules.filter(r => r.sels.some(s => /\.vo-win--adv \.combobox > \.form-control$/.test(s)) && /(^|;)\s*height\s*:\s*34px/.test(r.decls));
    assert.ok(dense.length, 'the advanced settings fields are 34 high');
    /* A hidden section is neither visible nor in focus, even with checkboxes that set visible on themselves. */
    const sels = [].concat(...rules.map(r => r.sels));
    assert.ok(sels.some(s => /\.vo-win--adv .*\.settings-panel:not\(\.active\) \*$/.test(s)), 'hidden panel descendants');
});

check('set_styles_cover_tabs_lists_and_messages', async () => {
    const rules = await windowRules();
    const sels = [].concat(...rules.map(r => r.sels));
    const has = re => sels.some(s => re.test(s));
    assert.ok(has(/\.grouped-buttons > \.btn\.active$/), 'top tabs: the pressed tab');
    assert.ok(has(/\.menu-panel:first-child .*\.btn-category\.active$/), 'left tabs: the active category');
    assert.ok(has(/\.listview:not\(\.disabled\) > \.item\.selected/), 'list: the selected row');
    assert.ok(has(/\.treeview > \.item\.selected$/), 'tree list: the selected row');
    assert.ok(has(/\.info-box > \.icon\.warn$/) && has(/\.info-box > \.icon\.error$/), 'message: warning and error icons');
    assert.ok(has(/\.info-box > \.icon\.confirm::before$/), 'message: confirm icon');
});

/* The template and the mechanics come from the shared layer: the module takes Common.UI.Compact.Windows, shared windows
   are its recipes, not own copies; its own styles hold only its own windows, the template and the set for stock
   windows are imported from common/main/resources/less/compact. */
const SHARED_LESS_DIR = path.join(ROOT, 'apps/common/main/resources/less/compact');
check('template_and_stock_windows_come_from_the_shared_layer', () => {
    const src = fs.readFileSync(FILE, 'utf8');
    assert.ok(/'common\/main\/lib\/view\/compact\/Windows'/.test(src), 'CompactWindows does not require the shared windows module');
    for (const own of ['guardEnter', 'edgeError', 'setActive', 'centreOverWork', 'primary', 'unbind'])
        assert.ok(!new RegExp('\\b' + own + '\\s*:\\s*function').test(src), 'CompactWindows keeps its own ' + own);
    const W = context.Common.UI && context.Common.UI.Compact && context.Common.UI.Compact.Windows;
    assert.ok(W && typeof W.stock === 'function', 'no Common.UI.Compact.Windows.stock');
    fresh();
    const ids = M.RECIPES.map(r => r.id);
    assert.ok(W.STOCK_IDS.length >= 15, 'stock recipes: ' + W.STOCK_IDS.length);
    for (const id of W.STOCK_IDS) {
        const own = M.RECIPES.filter(r => r.id === id);
        assert.equal(own.length, 1, 'one recipe ' + id);
        assert.equal(own[0], W.stock([id])[0], id + ' is not the shared recipe');
    }
    assert.deepEqual(ids.filter(id => !W.STOCK_IDS.includes(id)).sort(),
        ['adv', 'datetime', 'docinfo', 'grid', 'hf', 'link', 'showsettings', 'slidesize'], 'own presentation windows');
    const less = fs.readFileSync(LESS, 'utf8');
    const imports = Array.from(less.matchAll(/^@import\s+"([^"]+)";/gm), m => m[1]);
    assert.deepEqual(imports, ['../../../../common/main/resources/less/compact/windows.less',
        '../../../../common/main/resources/less/compact/windows-stock.less'], 'compact-windows.less imports');
    assert.ok(!/^@vo-win-pad-x\s*:|^\.vo-win-field\(\)\s*\{/m.test(less), 'compact-windows.less keeps its own template');
    for (const id of W.STOCK_IDS)
        assert.ok(!less.includes('.vo-win--' + id + ' ') && !less.includes('.vo-win--' + id + '\n') && !less.includes('.vo-win--' + id + ' {'),
            'compact-windows.less keeps the rules of the shared window ' + id);
    const tpl = fs.readFileSync(path.join(SHARED_LESS_DIR, 'windows.less'), 'utf8');
    const stock = fs.readFileSync(path.join(SHARED_LESS_DIR, 'windows-stock.less'), 'utf8');
    assert.ok(/^@vo-win-pad-x\s*:/m.test(tpl) && /^\.vo-win-field\(\)\s*\{/m.test(tpl), 'the shared template');
    for (const id of W.STOCK_IDS) assert.ok(stock.includes('.vo-win.vo-win--' + id), 'windows-stock.less: no rules of ' + id);
});

/* --- "About" is the shared compact window ------------------------------ */

/* The compact style layer as the editor's app.less includes it: stock image paths
   (variables.less) and @import lines from the first file of the shared layer to its own compact-shell.less. */
const STOCK_VARS = path.join(ROOT, 'apps/common/main/resources/less/variables.less');
const SHARED_LAYER_IMPORT = /^@import\s+"[^"]*common\/main\/resources\/less\/compact\/([\w-]+)\.less";$/;
function appLayer(appLess) {
    const lines = fs.readFileSync(appLess, 'utf8').split('\n').map(l => l.trim());
    const own = lines.indexOf('@import "compact-shell.less";');
    assert.ok(own > 0, path.relative(ROOT, appLess) + ' does not import compact-shell.less');
    let first = own;
    while (first > 0 && SHARED_LAYER_IMPORT.test(lines[first - 1])) first--;
    const vars = fs.readFileSync(STOCK_VARS, 'utf8');
    const paths = ['app-image-const-path', 'common-image-const-path'].map(name => {
        const m = new RegExp('^@' + name + ':[^;\\n]*;', 'm').exec(vars);
        assert.ok(m, 'variables.less: @' + name + ' is not found');
        return m[0];
    });
    return {shared: lines.slice(first, own).map(l => SHARED_LAYER_IMPORT.exec(l)[1]), source: paths.concat(lines.slice(first, own + 1)).join('\n')};
}

/* The "About" window rules of the assembled layer: selector → declarations. */
async function aboutRules(appLess) {
    const out = await lessCompiler().render(appLayer(appLess).source, {filename: appLess, javascriptEnabled: true});
    const css = out.css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = {};
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const decls = m[2].split(';').map(d => d.trim().replace(/\s+/g, ' ')).filter(Boolean);
        for (const sel of splitList(m[1].trim()).map(x => x.trim().replace(/\s+/g, ' ')))
            if (sel.includes('.vo-about-dlg')) rules[sel] = (rules[sel] || []).concat(decls);
    }
    return rules;
}

check('about_window_is_the_shared_one', () => {
    assert.ok(!fs.existsSync(path.join(VIEW, 'AboutWindow.js')), 'the presentation editor keeps its own AboutWindow.js');
    assert.ok(/'common\/main\/lib\/view\/compact\/AboutWindow'/.test(fs.readFileSync(FILE, 'utf8')), 'CompactWindows does not require the shared AboutWindow');
    const less = fs.readFileSync(LESS, 'utf8');
    assert.ok(!/vo-win--about|\.about-(?:content|head|name|version|lines|line|cc)\b/.test(less), 'compact-windows.less still styles the About window');
    /* The shared layer (tokens, the menu bar and the "About" window) comes before its own file: for a LESS variable
       the last definition wins, and the window rules get the presentation values. */
    assert.deepEqual(appLayer(path.join(PE_LESS, 'app.less')).shared, ['tokens', 'menu', 'about'], 'shared layer files in app.less');
});

/* The window is the same as in documents: the shared about.less rules on each editor's values match. */
check('about_window_looks_as_in_the_documents', async () => {
    const own = await aboutRules(path.join(PE_LESS, 'app.less'));
    const docs = await aboutRules(path.join(ROOT, 'apps/documenteditor/main/resources/less/app.less'));
    assert.ok(Object.keys(docs).length >= 10, 'About window rules of the documents: ' + Object.keys(docs).length);
    assert.deepEqual(own, docs, 'About window rules: presentations against documents');
    const box = own['body.vo-compact .asc-window.vo-about-dlg'] || [];
    assert.ok(box.includes('border-radius: 12px'), 'the window takes the popup radius of the shell: ' + box.join('; '));
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
