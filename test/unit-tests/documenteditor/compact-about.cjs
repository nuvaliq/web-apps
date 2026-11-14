/* Run: node test/unit-tests/documenteditor/compact-about.cjs
 * "About" in the documents compact. The "Help" menu has three items: "Editor help", "Keyboard
 * shortcuts" and "About"; the last one opens the shared compact layer window Common.UI.Compact.AboutWindow
 * (test/unit-tests/common/compact/about-window.cjs: options, body, cross and window styles) with the item
 * title. Documents have no copy of the window or its styles of their own. The key DE.Views.DocumentActions.textHelpOnlyoffice
 * was removed from the locales.
 *
 * Window.js, About.js, Icons.js (the shared set and the documents module), the shared AboutWindow.js and DocumentActions.js
 * are executed in vm, the real ones, with stubs only for jQuery and Backbone: the window markup is built by the stock template.
 * The locale overlays the module strings the same way as Common.Locale. less is not loaded in vm: it is read as text.
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
const ICONS = file('apps/documenteditor/main/app/view/Icons.js');
const ABOUT_WINDOW = file('apps/common/main/lib/view/compact/AboutWindow.js');
const OWN_ABOUT_WINDOW = file('apps/documenteditor/main/app/view/AboutWindow.js');
const LESS = file('apps/documenteditor/main/resources/less/compact-shell.less');
const APP_LESS = file('apps/documenteditor/main/resources/less/app.less');
const LOCALE_DIR = file('apps/documenteditor/main/locale');
const BRAND = /onlyoffice/i;

const locale = lang => JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, lang + '.json'), 'utf8'));

let passed = 0, failed = 0;
function test(name, body) {
    try {
        body();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
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

/* Like Common.Locale.apply (common/locale.js): the key "A.B.C.name" puts the string on window.A.B.C before loading
   the modules, and the module overlays its English defaults with it. */
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

/* The window, the "About" content and the icons are in one context, as in the editor; lang is the interface
   language. Returns the context, the body node (the stock render inserts the window markup into it),
   the define dependencies of each file and NotificationCenter notifications. */
function stack(lang, files = [WINDOW, ABOUT, SHARED_ICONS, ICONS, ABOUT_WINDOW]) {
    let cid = 0;
    /* Backbone.View.extend to the extent the window needs it: inheritance and initialize. */
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
        fireEvent() {}
    };
    BaseView.extend = extend;

    const nodes = new Map();
    const $ = arg => {
        if (arg === '.asc-loadmask') return Object.assign(node(arg), {length: 0});
        if (!nodes.has(arg)) nodes.set(arg, node(String(arg)));
        return nodes.get(arg);
    };
    const defines = {};
    const triggered = [];
    const context = vm.createContext({
        _, $, jQuery: $, URL,
        innerHeight: 800,
        setTimeout: () => 0,
        document: {body: {}, baseURI: 'http://stand.test/web-apps/apps/documenteditor/main/index.html'},
        DE: {Views: {}, getController: name => (name === 'Main' ? {appOptions: {}} : null)},
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
        return factory();
    };
    for (const f of files) {
        current = f;
        vm.runInContext(fs.readFileSync(f, 'utf8'), context, {filename: f});
    }
    return {context, $, body: $(context.document.body), defines, triggered, Common: context.Common, DE: context.DE};
}

/* The markup of the stock window template (Window.js, template): a box, a header with tools and
   a title, a body; the template draws the footer inside the body. */
function parseWindow(html) {
    const box = /^<div class="([^"]*)" id="[^"]*" style="([^"]*)" role="([^"]*)" aria-modal="([^"]*)">(.*)<\/div>$/s.exec(html);
    assert.ok(box, 'window markup: ' + String(html).slice(0, 200));
    const head = /^<div class="header"><div class="tools">(.*?)<\/div><div class="title">(.*?)<\/div>\s*<\/div>(.*)$/s.exec(box[5]);
    assert.ok(head, 'header markup: ' + box[5].slice(0, 200));
    const body = /^<div class="body">(.*)<\/div>$/s.exec(head[3]);
    assert.ok(body, 'body markup: ' + head[3].slice(0, 200));
    return {
        classes: box[1].split(' '), style: box[2], role: box[3], modal: box[4],
        tools: [...head[1].matchAll(/<div class="tool ([^"]*)">/g)].map(m => m[1]),
        title: head[2], body: body[1]
    };
}

/* --- "Help" menu ---------------------------------------------------------------- */
/* The compact "Help" menu: "Editor help", "Keyboard shortcuts" and "About". The action catalog
   is loaded into the same context as the window, so the menu item reaches the real window. */

const ACTIONS = file('apps/documenteditor/main/app/view/DocumentActions.js');
const ACTIONS_PREFIX = 'DE.Views.DocumentActions.';

function actions(lang) {
    const s = stack(lang, [WINDOW, ABOUT, SHARED_ICONS, ICONS, ABOUT_WINDOW, ACTIONS]);
    s.da = s.DE.Views.DocumentActions;
    /* The engine api is empty and the shell reports nothing, so only the unconditional items stay in the catalog. */
    s.da.api = {};
    s.da.shell = new Proxy({}, {get: () => () => false});
    return s;
}

function helpGroup(da) {
    const group = da.sections().find(g => g.k === 'help');
    assert.ok(group, 'Help group exists');
    assert.equal(group.t, da.textHelp);
    return group;
}

/* The "About" item is by key: other help items precede it in the section. */
function aboutItem(da) {
    const about = helpGroup(da).items.find(it => it && it.k === 'help.about');
    assert.ok(about, 'About item exists');
    return about;
}

test('test_compact_help_menu_has_help_and_about', () => {
    for (const [lang, help, keys, about] of [['en', 'Editor help', 'Keyboard shortcuts', 'About'],
        ['ru', 'Справка по редактору', 'Сочетания клавиш', 'О программе']]) {
        const {da, DE} = actions(lang);
        const items = helpGroup(da).items;
        /* The array of items is from the vm context: Array.from builds a comparable copy. */
        assert.deepEqual(Array.from(items, it => [it.t, it.i]), [[help, 'help'], [keys, 'keyboard'], [about, 'info']],
            lang + ': Help menu');
        assert.equal(aboutItem(da).t, da.textAbout);
        assert.equal(aboutItem(da).disabled, undefined, lang + ': About has no reason to be greyed');
        assert.equal(typeof aboutItem(da).run, 'function');
        assert.ok(DE.Views.Icons.has('info') && DE.Views.Icons.svg('info', 16), 'the info icon is in the set');
    }

    /* The editing ban does not disable the window: it has nothing to do with the document. The control is an edit item
       in the same state, which does get disabled. */
    const {da} = actions('en');
    const about = aboutItem(da);
    const MODEL = require('../common/compact/lib/documents-editor.cjs').host().Common.UI.Compact.MenuModel;
    const locked = {has: () => true, options: () => ({}), canEdit: () => true, on: () => true,
        edit: () => ['limit', 'offline', 'view', 'final', 'form', 'protected'], net: () => 'offline'};
    assert.equal(MODEL.state(about, locked).disabled, false, 'About is never locked');
    const save = da.sections().find(g => g.k === 'file').items.find(it => it && it.k === 'file.save');
    assert.equal(MODEL.state(save, locked).disabled, true, 'control: an editing item is locked in the same state');
});

test('test_about_opens_the_shared_window_titled_by_the_item', () => {
    for (const [lang, title] of [['en', 'About'], ['ru', 'О программе']]) {
        const s = actions(lang);
        const {da, Common} = s;
        const deps = Array.from(s.defines['apps/documenteditor/main/app/view/DocumentActions.js']);
        assert.equal(deps.includes('common/main/lib/view/compact/AboutWindow'), true,
            'the catalogue requires the shared AboutWindow in its define: ' + deps.join(' '));
        assert.equal(deps.some(d => /^documenteditor\/.*AboutWindow$/.test(d)), false, 'no own AboutWindow in the define');
        assert.equal(typeof da.about, 'function', 'DocumentActions.about');

        /* The window is built by about() itself: DocumentActions.dialog looks only in DE.Views and Common.Views. */
        const inits = [];
        const Ctor = Common.UI.Compact.AboutWindow;
        const init = Ctor.prototype.initialize;
        Ctor.prototype.initialize = function (options) {
            inits.push(JSON.stringify(options));
            return init.apply(this, arguments);
        };
        const dialogs = [];
        const dialog = da.dialog;
        da.dialog = function (name) { dialogs.push(name); return dialog.apply(this, arguments); };
        aboutItem(da).run();
        assert.equal(inits.join('\n'), JSON.stringify({title}), lang + ': about() builds the shared window titled by textAbout');
        assert.equal(dialogs.join(' '), '', lang + ': not through dialog()');

        /* The real window: shown modal, the title is the menu item, the body is the "About" content. */
        assert.equal(s.body.appended.length, 1, lang + ': one window');
        const w = parseWindow(s.body.appended[0]);
        assert.equal(w.classes.join(' '), 'asc-window modal vo-about-dlg', lang + ': classes');
        assert.equal(w.title, title, lang + ': window title');
        assert.equal(w.body, Common.Views.About.prototype.contentHtml(), lang + ': window body');
        assert.equal(s.triggered.some(t => t[0] === 'modal:show' && t[1] instanceof Ctor), true, lang + ': shown as a modal window');
    }
});

test('test_document_editor_keeps_no_copy_of_the_window_or_its_styles', () => {
    assert.equal(fs.existsSync(OWN_ABOUT_WINDOW), false, 'apps/documenteditor/main/app/view/AboutWindow.js is gone');
    const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');
    const less = strip(fs.readFileSync(LESS, 'utf8'));
    assert.equal(/vo-about-dlg/.test(less), false, 'compact-shell.less has no window rule');
    assert.equal(/\.about-(content|head|name|version|lines|line|cc)\b/.test(less), false, 'compact-shell.less styles no About content');
    const imports = Array.from(strip(fs.readFileSync(APP_LESS, 'utf8')).matchAll(/@import\s+"([^"]+)"/g), m => m[1]);
    assert.equal(imports.filter(p => /compact\/about\.less$/.test(p)).join(' '),
        '../../../../common/main/resources/less/compact/about.less', 'app.less imports the shared about.less');
    const views = fs.readdirSync(file('apps/documenteditor/main/app/view'));
    assert.equal(views.filter(f => /about/i.test(f)).join(' '), '', 'no About view of its own');
    for (const f of [ACTIONS].concat(views.filter(n => n.endsWith('.js')).map(n => file('apps/documenteditor/main/app/view/' + n)))) {
        assert.equal(/Views\.AboutWindow/.test(fs.readFileSync(f, 'utf8')), false, path.relative(ROOT, f) + ' reads no own AboutWindow');
    }
});

test('test_document_actions_have_no_brand_word', () => {
    const hits = fs.readFileSync(ACTIONS, 'utf8').split('\n')
        .map((line, i) => (BRAND.test(line) ? (i + 1) + ': ' + line.trim() : null)).filter(Boolean);
    assert.deepEqual(hits, [], 'DocumentActions.js');
    for (const lang of ['en', 'ru', 'de']) {
        const {da} = actions(lang);
        for (const group of da.sections())
            for (const it of group.items)
                for (const one of [it].concat((it && it.items) || []))
                    assert.ok(!BRAND.test((one && one.t) || ''), lang + ': menu item ' + (one && one.t));
    }
});

test('test_locales_drop_help_onlyoffice', () => {
    for (const name of fs.readdirSync(LOCALE_DIR).filter(f => f.endsWith('.json'))) {
        const text = fs.readFileSync(path.join(LOCALE_DIR, name), 'utf8');
        assert.ok(!text.includes('textHelpOnlyoffice'), name + ' still has ' + ACTIONS_PREFIX + 'textHelpOnlyoffice');
    }
    assert.equal(locale('en')[ACTIONS_PREFIX + 'textAbout'], 'About');
    assert.equal(locale('ru')[ACTIONS_PREFIX + 'textAbout'], 'О программе');
    for (const lang of ['en', 'ru', 'de']) {
        const json = locale(lang);
        const branded = Object.keys(json).filter(k => k.startsWith(ACTIONS_PREFIX) && BRAND.test(json[k]));
        assert.deepEqual(branded, [], lang + ': catalogue strings name no brand');
    }

    /* The locales are not reformatted: en.json is CRLF, de.json and ru.json are LF, as in the base. */
    const raw = lang => fs.readFileSync(path.join(LOCALE_DIR, lang + '.json'), 'utf8');
    const en = raw('en');
    assert.equal((en.match(/\r\n/g) || []).length, (en.match(/\n/g) || []).length, 'en.json keeps CRLF');
    for (const lang of ['de', 'ru'])
        assert.ok(!raw(lang).includes('\r'), lang + '.json keeps LF');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
