/* Run: node test/unit-tests/spreadsheeteditor/compact-about.cjs
 * "About" in the spreadsheet editor compact. The "Help → About" item opens the shared compact layer window
 * Common.UI.Compact.AboutWindow (test/unit-tests/common/compact/about-window.cjs: options, body, close button and styles
 * of the window in Documents and Spreadsheets) titled with the item, not the stock #about-menu-panel panel (in the compact it
 * could be closed only with the Esc key); the close button and Esc close the window, and focus returns to the sheet with the stock
 * edit:complete request. The spreadsheet editor has no copy of their own for the window or its styles: the window rule is in the shared about.less, the spreadsheet editor
 * keep only the variable values.
 *
 * Window.js, About.js, the shared Icons.js and AboutWindow.js, StockBridge.js and SheetActions.js
 * run in vm for real, only jQuery and Backbone are stubbed: the window markup is built by the stock template.
 * The locale overrides the module strings the same way as Common.Locale. less is not loaded in vm - it is read as text.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));
const file = rel => path.join(ROOT, rel);
const WINDOW = file('apps/common/main/lib/component/Window.js');
const ABOUT = file('apps/common/main/lib/view/About.js');
const SHARED_ICONS = file('apps/common/main/lib/view/compact/Icons.js');
const ABOUT_WINDOW = file('apps/common/main/lib/view/compact/AboutWindow.js');
const OWN_ABOUT_WINDOW = file('apps/spreadsheeteditor/main/app/view/AboutWindow.js');
const BRIDGE = file('apps/spreadsheeteditor/main/app/view/StockBridge.js');
const ACTIONS = file('apps/spreadsheeteditor/main/app/view/SheetActions.js');
const VIEWPORT_CTL = file('apps/spreadsheeteditor/main/app/controller/Viewport.js');
const LESS = file('apps/spreadsheeteditor/main/resources/less/compact-shell.less');
const APP_LESS = file('apps/spreadsheeteditor/main/resources/less/app.less');
const LOCALE_DIR = file('apps/spreadsheeteditor/main/locale');
const MODULE = {
    [WINDOW]: 'common/main/lib/component/Window',
    [ABOUT]: 'common/main/lib/view/About',
    [SHARED_ICONS]: 'common/main/lib/view/compact/Icons',
    [ABOUT_WINDOW]: 'common/main/lib/view/compact/AboutWindow',
    [BRIDGE]: 'spreadsheeteditor/main/app/view/StockBridge',
    [ACTIONS]: 'spreadsheeteditor/main/app/view/SheetActions'
};

const locale = lang => JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, lang + '.json'), 'utf8'));

let passed = 0, failed = 0;
function test(name, body) {
    try {
        body();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error && error.message);
        failed++;
    }
}

/* --- Editor context ---------------------------------------------------------- */

/* A jQuery stub node: find() returns a child node by selector (the same one for
   one selector), on() remembers the handler, html() the content, append() the inserted
   markup. Other methods do nothing and return the same node. */
function node(name) {
    const self = {
        name, length: 1, content: undefined, handlers: {}, children: {}, appended: [],
        find: selector => self.children[selector] || (self.children[selector] = node(name + ' ' + selector)),
        html(value) { if (value === undefined) return self.content; self.content = value; return proxy; },
        append(html) { self.appended.push(html); return proxy; },
        on(event, handler) { self.handlers[String(event).split('.')[0]] = handler; return proxy; },
        css: (key, value) => (typeof key === 'string' && value === undefined ? '0px' : proxy),
        attr: (key, value) => (value === undefined ? '0' : proxy),
        is: () => true,
        hasClass: () => false
    };
    const proxy = new Proxy(self, {
        get: (target, key) => (key in target ? target[key] : typeof key === 'symbol' ? undefined : () => proxy)
    });
    return proxy;
}

/* Like Common.Locale.apply (common/locale.js): the key "A.B.C.name" puts the string on window.A.B.C before
   the modules load, and the module overrides its English defaults with it. */
function applyLocale(context, json) {
    for (const key of Object.keys(json)) {
        const p = key.split('.');
        if (p.length <= 2) continue;
        let obj = context;
        for (let i = 0; i < p.length - 1; i++) {
            if (obj[p[i]] === undefined) obj[p[i]] = {};
            obj = obj[p[i]];
        }
        obj[p[p.length - 1]] = json[key];
    }
}

/* The window, the "About" content, the icons and the menu row catalog are in one context, as in the editor;
   lang is the interface language. Returns the context, the body node (the stock render inserts the window
   markup into it), the define dependencies of each file and the NotificationCenter notifications in order. */
function stack(lang, files = [WINDOW, ABOUT, SHARED_ICONS, ABOUT_WINDOW, BRIDGE, ACTIONS]) {
    let cid = 0;
    /* Backbone.View.extend to the extent the window needs it: inheritance, initialize and events
       (the view fireEvent is trigger, as in core/application.js). */
    function extend(proto) {
        const Parent = this;
        function View() { this.cid = 'view' + (++cid); this.initialize.apply(this, arguments); }
        View.prototype = Object.assign(Object.create(Parent.prototype), proto, {constructor: View});
        View.extend = extend;
        return View;
    }
    function BaseView() {}
    BaseView.prototype = {
        initialize(options) { this.options = this.options ? _({}).extend(this.options, options) : options; },
        on(event, handler) { ((this._events = this._events || {})[event] = this._events[event] || []).push(handler); return this; },
        trigger(event, ...args) { ((this._events || {})[event] || []).slice().forEach(h => h.apply(this, args)); return this; },
        fireEvent(...args) { return this.trigger(...args); }
    };
    BaseView.extend = extend;

    const nodes = new Map();
    const $ = arg => {
        if (arg === '.asc-loadmask') return Object.assign(node(arg), {length: 0});
        if (!nodes.has(arg)) nodes.set(arg, node(String(arg)));
        return nodes.get(arg);
    };
    const defines = {};
    const modules = {};
    const triggered = [];
    const context = vm.createContext({
        _, $, jQuery: $, URL, console,
        innerHeight: 800,
        setTimeout: () => 0,
        clearTimeout() {},
        document: {
            body: {classList: {contains: () => false}}, getElementById: () => null,
            baseURI: 'http://stand.test/web-apps/apps/spreadsheeteditor/main/index.html'
        },
        SSE: {Views: {}, getController: () => null},
        Common: {
            UI: {BaseView, Keys: {ESC: 27, RETURN: 13}},
            Views: {},
            Utils: {
                String: {htmlEncode: value => _.escape(value)},
                innerWidth: () => 1280,
                innerHeight: () => 800,
                InternalSettings: {get: () => 0},
                zoom: () => 1
            },
            Locale: {getCurrentLanguage: () => lang},
            NotificationCenter: {on() {}, off() {}, trigger: (...args) => triggered.push(args)},
            Gateway: {on() {}}
        }
    });
    context.window = context;
    applyLocale(context, locale(lang));
    let current = null;
    context.define = (deps, factory) => {
        defines[path.relative(ROOT, current)] = Array.from(deps);
        modules[MODULE[current]] = factory(...Array.from(deps, d => modules[d]));
    };
    for (const f of files) {
        current = f;
        vm.runInContext(fs.readFileSync(f, 'utf8'), context, {filename: f});
    }
    return {
        context, $, body: $(context.document.body), defines, triggered, Common: context.Common, SSE: context.SSE,
        /* The notification names in order - as strings: a notification carries the window, which we do not put into the comparison. */
        names: () => triggered.map(t => String(t[0]))
    };
}

/* The markup of the stock window template (Window.js, template): the box, the header with tools and
   the title, the body; the footer is drawn by the template inside the body. */
function parseWindow(html) {
    const box = /^<div class="([^"]*)" id="[^"]*" style="([^"]*)" role="([^"]*)" aria-modal="([^"]*)">(.*)<\/div>$/s.exec(html);
    assert.ok(box, 'window markup: ' + String(html).slice(0, 200));
    const head = /^<div class="header"><div class="tools">(.*?)<\/div><div class="title">(.*?)<\/div>\s*<\/div>(.*)$/s.exec(box[5]);
    assert.ok(head, 'header markup: ' + box[5].slice(0, 200));
    const body = /^<div class="body">(.*)<\/div>$/s.exec(head[3]);
    assert.ok(body, 'body markup: ' + head[3].slice(0, 200));
    return {
        classes: box[1].split(' ').join(' '), style: box[2], role: box[3], modal: box[4],
        tools: [...head[1].matchAll(/<div class="tool ([^"]*)">/g)].map(m => m[1]).join(' '),
        title: head[2], body: body[1]
    };
}

/* --- less as text -------------------------------------------------------------- */

const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');

/* The body of the first `selector { ... }` rule in text, braces matched in pairs. */
function rule(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp('(^|[\\s;{},])' + escaped + '\\s*\\{').exec(text);
    assert.ok(m, 'rule ' + selector + ' exists');
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    for (; i < text.length && depth; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
    }
    return text.slice(start, i - 1);
}

/* The rule's own declaration (without nested rules). */
function prop(body, name) {
    let f = body, prev;
    do { prev = f; f = f.replace(/[^;{}]*\{[^{}]*\}/g, ''); } while (f !== prev);
    const d = f.split(';').map(s => s.trim().replace(/\s+/g, ' ')).find(s => s.startsWith(name + ':'));
    return d === undefined ? 'none' : d.slice(name.length + 1).trim();
}

/* --- The "Help" menu ----------------------------------------------------------- */

function aboutItem(A) {
    const help = A.catalog().find(g => g.label === A.textHelp);
    assert.ok(help, 'Help section exists');
    const it = help.items.find(i => i && i.k === 'about');
    assert.ok(it, 'About item exists');
    return it;
}

/* "About" is a catalog command without a twin: a window, not the stock "About" button of the left menu.
   Its panel in the compact covered the whole editor, and there was no visible way to return to the sheet. */
test('about_item_is_a_command_not_the_stock_panel', () => {
    const {SSE} = stack('en');
    const A = SSE.Views.SheetActions;
    const it = aboutItem(A);
    assert.equal(it.t, A.textAbout);
    assert.equal(it.i, 'info');
    assert.equal(typeof it.twin, 'undefined', 'About has a stock twin');
    assert.equal(typeof it.run, 'function', 'About runs its own command');
    assert.equal(typeof A.about, 'function', 'SheetActions.about');
    const hits = fs.readFileSync(ACTIONS, 'utf8').split('\n')
        .map((line, i) => (/btnAbout/.test(line) ? (i + 1) + ': ' + line.trim() : null)).filter(Boolean);
    assert.deepEqual(hits, [], 'SheetActions.js still reaches the stock About button');
});

test('about_opens_the_shared_window_titled_by_the_item', () => {
    for (const [lang, title] of [['en', 'About'], ['ru', 'О программе']]) {
        const s = stack(lang);
        const A = s.SSE.Views.SheetActions;
        assert.equal(A.textAbout, title, lang + ': textAbout');
        const Ctor = s.Common.UI.Compact.AboutWindow;
        assert.equal(typeof Ctor, 'function', 'Common.UI.Compact.AboutWindow');
        const inits = [];
        const init = Ctor.prototype.initialize;
        Ctor.prototype.initialize = function (options) {
            inits.push(JSON.stringify(options));
            return init.apply(this, arguments);
        };
        aboutItem(A).run();
        assert.equal(inits.join('\n'), JSON.stringify({title}), lang + ': about() builds the shared window titled by textAbout');

        /* The real window: shown modal, the title is the menu item, the body is the "About" content. */
        assert.equal(s.body.appended.length, 1, lang + ': one window');
        const w = parseWindow(s.body.appended[0]);
        assert.equal(w.classes, 'asc-window modal vo-about-dlg');
        assert.equal(w.title, title, lang + ': window title');
        assert.equal(w.tools, 'close', lang + ': the cross');
        assert.equal(w.body, s.Common.Views.About.prototype.contentHtml(), lang + ': window body');
        assert.ok(s.triggered.some(t => t[0] === 'modal:show' && t[1] instanceof Ctor), lang + ': shown as a modal window');
        assert.ok(!s.names().includes('edit:complete'), lang + ': the sheet does not take the focus while the window is open');
    }
});

/* Esc and the close button close the window with the stock handlers (Window.js: _keydown, doclose), after closing
   focus goes to the sheet: edit:complete - the same request as in the other catalog commands (Main.onEditComplete →
   DocumentHolder.focus). */
test('about_esc_and_cross_close_and_return_focus_to_the_sheet', () => {
    const s = stack('en');
    const A = s.SSE.Views.SheetActions;

    aboutItem(A).run();
    s.triggered.length = 0;
    s.$(s.context.document).handlers.keydown({keyCode: 27, preventDefault() {}, stopPropagation() {}});
    assert.deepEqual(s.names(), ['modal:close', 'edit:complete'], 'Esc closes the window, then the sheet takes the focus');

    aboutItem(A).run();
    assert.equal(s.body.appended.length, 2, 'the item opens the window again');
    const win = s.triggered.filter(t => t[0] === 'modal:show').map(t => t[1]).pop();
    s.triggered.length = 0;
    win.$window.find('.tool.close').handlers.click();
    assert.deepEqual(s.names(), ['modal:close', 'edit:complete'], 'the cross closes the window, then the sheet takes the focus');
});

/* The window is our module and is not in the stock preload lists: it is pulled in by the define of the
   Viewport controller, which includes the shell. Without this the build has no window. */
test('about_window_is_required_with_the_shell', () => {
    const m = /define\(\[([\s\S]*?)\]\s*,\s*function/.exec(fs.readFileSync(VIEWPORT_CTL, 'utf8'));
    assert.ok(m, 'controller/Viewport.js define');
    const deps = [...stripComments(m[1]).matchAll(/'([^']+)'/g)].map(x => x[1]);
    assert.ok(deps.includes('spreadsheeteditor/main/app/view/CompactShell'), 'the shell is required: ' + deps.join(', '));
    assert.ok(deps.includes('common/main/lib/view/compact/AboutWindow'), 'the shared AboutWindow is required: ' + deps.join(', '));
    assert.equal(deps.some(d => /^spreadsheeteditor\/.*AboutWindow$/.test(d)), false, 'no own AboutWindow: ' + deps.join(', '));
    /* SheetActions does not pull in the window with its define: seven tests without Backbone load it. */
    const own = /define\(\[([\s\S]*?)\]\s*,\s*function/.exec(fs.readFileSync(ACTIONS, 'utf8'));
    assert.equal(/AboutWindow/.test(own ? own[1] : ''), false, 'SheetActions.js define stays without the window');
});

/* --- No copy of its own --------------------------------------------------------- */

/* The window and its rule are in the shared layer; the spreadsheet editor keeps the values of the variables the rule stands on. */
test('spreadsheets_keep_no_copy_of_the_window_or_its_styles', () => {
    assert.equal(fs.existsSync(OWN_ABOUT_WINDOW), false, 'apps/spreadsheeteditor/main/app/view/AboutWindow.js is gone');
    const dirs = ['apps/spreadsheeteditor/main/app/view', 'apps/spreadsheeteditor/main/app/controller'];
    const hits = [];
    for (const dir of dirs)
        for (const name of fs.readdirSync(file(dir)).filter(n => n.endsWith('.js')))
            if (/Views\.AboutWindow/.test(fs.readFileSync(file(dir + '/' + name), 'utf8'))) hits.push(dir + '/' + name);
    assert.equal(hits.join(' '), '', 'own AboutWindow is read');

    const less = stripComments(fs.readFileSync(LESS, 'utf8'));
    assert.equal(/vo-about-dlg/.test(less), false, 'compact-shell.less has no window rule');
    assert.equal(/\.about-(content|head|name|version|lines|line|cc)\b/.test(less), false, 'compact-shell.less styles no About content');
    const imports = Array.from(stripComments(fs.readFileSync(APP_LESS, 'utf8')).matchAll(/@import\s+"([^"]+)"/g), m => m[1]);
    const about = imports.indexOf('../../../../common/main/resources/less/compact/about.less');
    assert.equal(about >= 0, true, 'app.less imports the shared about.less: ' + imports.join(' '));
    assert.equal(about < imports.indexOf('compact-shell.less'), true, 'about.less comes before compact-shell.less');

    /* The window variable values for the spreadsheet editor: colors in the token blocks, including those for the host dark theme, their LESS names and the popup radius. */
    for (const theme of ['body.vo-boot', 'body.vo-boot.theme-type-dark']) {
        const tokens = rule(less, theme);
        assert.equal(prop(tokens, '--vo-text-3'), '#828b95', theme + ' --vo-text-3');
        assert.equal(prop(tokens, '--vo-link'), '#0154c8', theme + ' --vo-link');
        assert.equal(prop(tokens, '--vo-link-underline'), 'rgba(1, 84, 200, .3)', theme + ' --vo-link-underline');
    }
    for (const name of ['text-3', 'link', 'link-underline'])
        assert.equal(new RegExp('^@vo-' + name + ':\\s*var\\(--vo-' + name + '\\);', 'm').test(less), true, '@vo-' + name);
    const radius = Array.from(less.matchAll(/^@vo-r-pop:\s*([^;]+);/gm), m => m[1].trim()).pop();
    assert.equal(radius, '18px', 'the popup radius of the spreadsheets');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
