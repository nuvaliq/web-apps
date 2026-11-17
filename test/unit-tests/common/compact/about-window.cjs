/* Run after the editor LESS build:
 *   COMPACT_CSS_DOCUMENTEDITOR=<deploy>/apps/documenteditor/main/resources/css/app.css \
 *   COMPACT_CSS_SPREADSHEETEDITOR=<deploy>/apps/spreadsheeteditor/main/resources/css/app.css \
 *   COMPACT_CSS_PDFEDITOR=<deploy>/apps/pdfeditor/main/resources/css/app.css \
 *     node test/unit-tests/common/compact/about-window.cjs
 * The compact About window of the shared layer (lib/view/compact/AboutWindow.js): a stock
 * Common.UI.Window 520 wide without a footer; its body is Common.Views.About.prototype.contentHtml(),
 * the content the About panel of the extended interface shows, and its cross holds the AIR close icon
 * of size 24. Its look is one rule under the compact class on body in the shared about.less; colour,
 * font, surface, shadow and radius are the variables of the editor, so each editor gets its own popup
 * radius in its built css.
 * Checked for every editor of EDITORS below. Window.js, About.js, the shared Icons.js and AboutWindow.js
 * run in vm for real, with no editor namespace; only jQuery and Backbone are stand-ins, so the window
 * markup comes from the stock template. The editor locale covers the module strings as Common.Locale
 * does. LESS is read as text; the built app.css of an editor comes from its cssEnv variable (no
 * variable — the run fails and names it).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../../..');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));
const file = rel => path.join(ROOT, rel);
const WINDOW = file('apps/common/main/lib/component/Window.js');
const ABOUT = file('apps/common/main/lib/view/About.js');
const ICONS = file('apps/common/main/lib/view/compact/Icons.js');
const ABOUT_WINDOW = file('apps/common/main/lib/view/compact/AboutWindow.js');
const SHARED_LESS = file('apps/common/main/resources/less/compact');
const ABOUT_LESS = path.join(SHARED_LESS, 'about.less');
const TOKENS = path.join(SHARED_LESS, 'tokens.less');
const SCOPE = 'body.vo-compact .asc-window.vo-about-dlg';
const BRAND = /onlyoffice/i;

/* Editors on the shared window:
 *  - app    — application folder from the repository root;
 *  - cssEnv — environment variable with the path to the built app.css of the editor;
 *  - radius — the popup radius of the editor (@vo-r-pop of its compact-shell.less). */
const EDITORS = [
    {name: 'documenteditor', app: 'apps/documenteditor/main', cssEnv: 'COMPACT_CSS_DOCUMENTEDITOR', radius: '12px'},
    {name: 'spreadsheeteditor', app: 'apps/spreadsheeteditor/main', cssEnv: 'COMPACT_CSS_SPREADSHEETEDITOR', radius: '18px'},
    {name: 'pdfeditor', app: 'apps/pdfeditor/main', cssEnv: 'COMPACT_CSS_PDFEDITOR', radius: '12px'}
];

const read = f => fs.readFileSync(f, 'utf8');
const locale = (editor, lang) => JSON.parse(read(file(editor.app + '/locale/' + lang + '.json')));

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

/* --- The window in vm ------------------------------------------------------------------- */

/* A jQuery stand-in node: find() gives the child node of a selector (the same one per selector),
   on() keeps the handler, html() the content, append() the inserted markup. Other methods do
   nothing and return the same node. */
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

/* As Common.Locale.apply (common/locale.js): the key «A.B.C.name» puts the string on window.A.B.C
   before the modules load, and the module covers its English defaults with it. */
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

/* The window, the About content and the icons in one context, as in the editor; lang is the
   interface language. Gives the context, the body node (the stock render inserts the window markup
   into it), the define dependencies of every file and the NotificationCenter triggers. */
function stack(editor, lang) {
    let cid = 0;
    /* Backbone.View.extend as far as the window needs it: inheritance and initialize. */
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
        document: {body: {}, baseURI: 'http://stand.test/web-apps/' + editor.app + '/index.html'},
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
    applyLocale(context, locale(editor, lang));
    let current = null;
    context.define = (deps, factory) => {
        defines[path.relative(ROOT, current)] = JSON.stringify(Array.from(deps));
        return factory();
    };
    for (const f of [WINDOW, ABOUT, ICONS, ABOUT_WINDOW]) {
        current = f;
        vm.runInContext(read(f), context, {filename: f});
    }
    return {context, $, body: $(context.document.body), defines, triggered, Common: context.Common};
}

/* Markup of the stock window template (Window.js, template): box, header with the tools and the
   title, body; the template draws a footer inside the body. */
function parseWindow(html) {
    const box = /^<div class="([^"]*)" id="[^"]*" style="([^"]*)" role="([^"]*)" aria-modal="([^"]*)">(.*)<\/div>$/s.exec(html);
    assert.ok(box, 'window markup: ' + String(html).slice(0, 200));
    const head = /^<div class="header"><div class="tools">(.*?)<\/div><div class="title">(.*?)<\/div>\s*<\/div>(.*)$/s.exec(box[5]);
    assert.ok(head, 'header markup: ' + box[5].slice(0, 200));
    const body = /^<div class="body">(.*)<\/div>$/s.exec(head[3]);
    assert.ok(body, 'body markup: ' + head[3].slice(0, 200));
    return {
        classes: box[1], style: box[2], role: box[3], modal: box[4],
        tools: [...head[1].matchAll(/<div class="tool ([^"]*)">/g)].map(m => m[1]).join(' '),
        title: head[2], body: body[1]
    };
}

/* --- LESS as text ------------------------------------------------------------------------- */

const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');

/* Body of the first rule `selector { ... }` in text, braces in pairs. */
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

/* Own declarations of a rule, without nested rules: property → value, and mixin calls. */
function own(body) {
    let flat = body, prev;
    do { prev = flat; flat = flat.replace(/[^;{}]*\{[^{}]*\}/g, ''); } while (flat !== prev);
    const props = {}, mixins = [];
    flat.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean).forEach(d => {
        if (/^\.[\w-]+\(.*\)$/.test(d)) { mixins.push(d); return; }
        const i = d.indexOf(':');
        if (i > 0) props[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    });
    return {props, mixins};
}

/* Paddings by side from the shorthand: top, right, bottom, left. */
const sides = value => {
    const v = String(value).split(' ');
    return [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]].join(' ');
};

function declares(body, selector, expected) {
    const {props} = own(body);
    for (const [prop, value] of Object.entries(expected))
        assert.equal(props[prop], value, selector + ' { ' + prop + ' }');
}

/* Top-level LESS variables, the last declaration wins as in LESS. */
function lessVars(text) {
    const vars = {};
    for (const m of stripComments(text).matchAll(/^@(vo-[\w-]+)\s*:\s*([^;]+);/gm)) vars[m[1]] = m[2].replace(/\s+/g, ' ').trim();
    return vars;
}

const shellLess = editor => file(editor.app + '/resources/less/compact-shell.less');
const appLess = editor => file(editor.app + '/resources/less/app.less');

/* --- Built css ----------------------------------------------------------------------------- */

function builtCss(editor) {
    const f = process.env[editor.cssEnv];
    if (!f) {
        throw new Error('set ' + editor.cssEnv + ' to the built app.css of ' + editor.name +
            ' (cd build && npm install && grunt, then deploy/web-apps/' + editor.app + '/resources/css/app.css)');
    }
    if (!fs.existsSync(f)) throw new Error(editor.cssEnv + ' points to a missing file: ' + f);
    return read(f);
}

/* Rules of the css whose selector list has the given selector: their declarations as
   [property, value] strings, media rules included. */
function cssRules(css, selector) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    for (const m of css.matchAll(re)) {
        const head = m[1].slice(m[1].lastIndexOf(';') + 1).trim();
        const selectors = head.split(',').map(s => s.trim().replace(/\s+/g, ' '));
        if (!selectors.includes(selector)) continue;
        out.push(m[2].split(';').map(d => d.trim()).filter(Boolean).map(d => {
            const k = d.indexOf(':');
            return [d.slice(0, k).trim(), d.slice(k + 1).trim()];
        }));
    }
    return out;
}

/* --- The window ---------------------------------------------------------------------------- */

test('the window is a stock modal window 520 wide without a footer', () => {
    for (const editor of EDITORS) {
        const where = editor.name + ': ';
        const s = stack(editor, 'en');
        const {Common} = s;
        assert.equal(typeof Common.UI.Compact.AboutWindow, 'function', where + 'Common.UI.Compact.AboutWindow');
        assert.equal(Common.UI.Compact.AboutWindow.prototype instanceof Common.UI.Window, true, where + 'extends Common.UI.Window');
        assert.equal(s.defines['apps/common/main/lib/view/compact/AboutWindow.js'], JSON.stringify(
            ['common/main/lib/component/Window', 'common/main/lib/view/About', 'common/main/lib/view/compact/Icons']), where + 'define');
        assert.equal(s.body.appended.length, 0, where + 'nothing is rendered on load');
        assert.equal(s.triggered.length, 0, where + 'no notifications on load');

        /* The options are exactly these: the title from the caller, the rest is the look of the window.
           No buttons: without them the stock template draws no footer. */
        const inits = [];
        const init = Common.UI.Window.prototype.initialize;
        Common.UI.Window.prototype.initialize = function (options) {
            inits.push(JSON.stringify(Object.assign({}, options)));
            return init.apply(this, arguments);
        };
        const win = new Common.UI.Compact.AboutWindow({title: 'About', buttons: ['ok'], width: 300, cls: 'other'});
        assert.equal(inits.join('\n'), JSON.stringify({
            title: 'About', width: 520, header: true, closable: true, modal: true, cls: 'vo-about-dlg',
            tpl: Common.Views.About.prototype.contentHtml()
        }), where + 'window options');

        /* Stock show: a modal window over the stock mask, a header with the cross and the title, no footer. */
        win.show();
        assert.equal(s.body.appended.length, 1, where + 'one window rendered');
        const html = s.body.appended[0];
        const w = parseWindow(html);
        assert.equal(w.classes, 'asc-window modal vo-about-dlg', where + 'classes');
        assert.equal(w.style, 'width:520px;', where + 'width');
        assert.equal(w.role, 'dialog', where + 'role');
        assert.equal(w.modal, 'true', where + 'aria-modal');
        assert.equal(w.title, 'About', where + 'title');
        assert.equal(w.tools, 'close', where + 'only the close tool');
        assert.equal(/class="footer"|dlg-btn/.test(html), false, where + 'no footer and no buttons');
        assert.equal(s.triggered.some(t => t[0] === 'modal:show' && t[1] === win), true, where + 'shown as a modal window');
    }
    assert.equal(BRAND.test(read(ABOUT_WINDOW)), false, 'AboutWindow.js has no brand word');
});

test('the body is the About content of the editor locale and nothing else', () => {
    const KEY = 'Common.Views.About.txtProductName';
    for (const editor of EDITORS) {
        /* The product name is the one of the editor locale, the module default where the locale has none. */
        const fallback = stack(editor, 'en').Common.Views.About.prototype.txtProductName;
        const names = {};
        for (const lang of ['en', 'ru']) names[lang] = locale(editor, lang)[KEY] || fallback;
        assert.equal(/[А-Яа-яЁё]/.test(names.ru), true, editor.name + ': the ru locale names the product in Russian: ' + names.ru);
        assert.notEqual(names.ru, names.en, editor.name + ': the product names differ by locale');
        for (const [lang, title] of [['en', 'About'], ['ru', 'О программе']]) {
            const product = names[lang];
            const where = editor.name + ' ' + lang + ': ';
            const s = stack(editor, lang);
            const content = s.Common.Views.About.prototype.contentHtml();
            assert.equal(content.startsWith('<div class="about-content"><div class="about-head"><h2 class="about-name">' + product + '</h2>'),
                true, where + 'About content of the locale: ' + content.slice(0, 120));

            new s.Common.UI.Compact.AboutWindow({title}).show();
            const w = parseWindow(s.body.appended[0]);
            assert.equal(w.title, title, where + 'title');
            assert.equal(w.body, content, where + 'the body is Common.Views.About.prototype.contentHtml() and nothing else');

            /* The license and the CC address open in a new tab; there are no other links. */
            const links = [...w.body.matchAll(/<a ([^>]*)>/g)].map(m => m[1]).join('\n');
            assert.equal(links, [
                'href="../../common/LICENSE.txt" target="_blank" rel="noopener"',
                'href="https://creativecommons.org/licenses/by-sa/4.0/legalcode" target="_blank" rel="noopener"'
            ].join('\n'), where + 'links');
            assert.equal(/<img|logo/i.test(w.body), false, where + 'no logo');
        }
    }
});

test('the cross is the AIR close icon of size 24 and closes the window as Esc does', () => {
    for (const editor of EDITORS) {
        const where = editor.name + ': ';
        const s = stack(editor, 'en');
        const win = new s.Common.UI.Compact.AboutWindow({title: 'About'});
        win.show();
        const close = win.$window.find('.tool.close');
        const icon = String(close.html());
        assert.equal(icon, s.Common.UI.Compact.Icons.svg('close', 24), where + 'the cross holds the shared close icon');
        assert.equal(/--vo-air-size:24px;/.test(icon), true, where + 'icon of size 24: ' + icon);
        assert.equal(/\/web-apps\/apps\/common\/main\/resources\/img\/air\/close\.svg\)/.test(icon), true,
            where + 'AIR close icon of the shared set: ' + icon);

        /* Esc and the cross close the window with the stock handlers (Window.js: _keydown, doclose). */
        const closed = [];
        win.close = () => closed.push('close');
        s.$(s.context.document).handlers.keydown({keyCode: 27, preventDefault() {}, stopPropagation() {}});
        assert.equal(closed.join(' '), 'close', where + 'Esc closes');
        close.handlers.click();
        assert.equal(closed.join(' '), 'close close', where + 'the cross closes as Esc does');
    }
});

/* --- The look ------------------------------------------------------------------------------ */

test('the window rule lives only in the shared about styles and reads editor variables for colour, font, surface, shadow and radius', () => {
    const less = stripComments(read(ABOUT_LESS));

    /* The whole window is one rule under the compact class: other windows and the About panel of the
       extended interface keep their look, the mask stays stock. */
    const block = rule(less, SCOPE);
    const start = less.indexOf(SCOPE), open = less.indexOf('{', start);
    const outside = less.slice(0, start) + less.slice(open + 1 + block.length + 1);
    assert.equal(outside.trim(), '', 'about.less holds only the window rule');
    assert.equal(/modals-mask/.test(less), false, 'the mask stays stock');

    /* The box: the surface of the editor popups, written out — the shared layer knows no editor mixin. */
    const box = own(block);
    assert.equal(box.mixins.join(' '), '', 'no mixin calls: ' + box.mixins.join(' '));
    assert.equal(/\.[\w-]+\([^)]*\)\s*;/.test(block), false, 'no mixin calls at any depth');
    declares(block, SCOPE, {
        background: '@vo-surface', border: 'none', 'border-radius': '@vo-r-pop', 'box-shadow': '@vo-shadow',
        'font-family': '@vo-font', color: '@vo-text', 'text-align': 'left'
    });

    /* Colours are editor variables only: no literal colour in the shared rule. */
    const literals = block.split('\n').filter(l => /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i.test(l)).map(l => l.trim());
    assert.equal(literals.join('\n'), '', 'no literal colours');
    for (const m of block.matchAll(/(^|[\s{;])(color|background|text-decoration-color|box-shadow|font-family)\s*:\s*([^;]+);/g))
        assert.equal(/@vo-[\w-]+|^none$|^transparent$|^currentColor$|^inherit$/.test(m[3].trim()), true, m[2] + ': ' + m[3]);

    /* Header ui-system-dialog__header: 14 on top, 24 at the sides; the title is Headline md. */
    const header = rule(block, '> .header');
    assert.equal(sides(own(header).props.padding), '14px 24px 0 24px', 'header padding');
    declares(header, '> .header', {position: 'static', height: 'auto', 'text-align': 'left', background: 'transparent', border: 'none'});
    declares(rule(block, '> .header .title'), '.title', {
        padding: '0 !important', color: '@vo-text', 'font-size': '19px', 'line-height': '26px',
        'letter-spacing': '-.01em', 'font-weight': '500'
    });

    /* The cross 24: base-4, base-2 under hover; the stock cross of pseudo elements is off. */
    const close = rule(block, '.tool.close');
    declares(close, '.tool.close', {width: '24px', height: '26px', opacity: '1', color: '@vo-text-off'});
    declares(rule(close, '&:hover'), '.tool.close:hover', {color: '@vo-text-2'});
    declares(rule(close, '&:before, &:after'), '.tool.close:before', {display: 'none'});

    /* Body ui-system-dialog__content: no footer, so 24 on every side. */
    const body = rule(block, '> .body');
    assert.equal(sides(own(body).props.padding), '24px 24px 24px 24px', 'body padding');
    declares(body, '> .body', {position: 'static', background: 'transparent'});

    /* The content, aligned to the left. */
    const content = rule(block, '.about-content');
    declares(content, '.about-content', {
        display: 'flex', 'flex-direction': 'column', gap: '16px', color: '@vo-text',
        'font-size': '14px', 'line-height': '1.4', 'text-align': 'left'
    });
    assert.equal(own(content).props['align-items'], undefined, 'content is not centered');
    declares(rule(block, '.about-head'), '.about-head', {display: 'flex', 'flex-direction': 'column', gap: '2px'});
    declares(rule(block, '.about-name'), '.about-name', {
        margin: '0', color: '@vo-text', 'font-size': '16px', 'line-height': '1.35', 'font-weight': '600'
    });
    declares(rule(block, '.about-version'), '.about-version', {color: '@vo-text-3', 'font-size': '13px'});
    declares(rule(block, '.about-lines'), '.about-lines', {display: 'flex', 'flex-direction': 'column', gap: '2px'});
    declares(rule(block, '.about-line'), '.about-line', {margin: '0'});
    declares(rule(block, '.about-cc'), '.about-cc', {
        margin: '0', color: '@vo-text-2', 'font-size': '13px', 'line-height': '1.4', 'font-weight': '400'
    });
    const link = rule(block, '.about-content a');
    declares(link, 'a', {
        color: '@vo-link', 'text-decoration': 'underline', 'text-decoration-color': '@vo-link-underline',
        'text-underline-offset': '2px'
    });
    declares(rule(link, '&:hover'), 'a:hover', {'text-decoration-color': 'currentColor'});
    declares(rule(link, '&:focus-visible'), 'a:focus-visible', {'box-shadow': '0 0 0 @vo-focus-w @vo-focus'});

    /* Every variable the rule reads has a shared default; colours default to the runtime palette
       of the editor. */
    const tokens = lessVars(read(TOKENS));
    const used = [...new Set(Array.from(block.matchAll(/@(vo-[\w-]+)/g), m => m[1]))].sort();
    const missing = used.filter(name => !(name in tokens));
    assert.equal(missing.join(' '), '', 'variables of the window rule without a shared default');
    for (const name of ['text-2', 'text-3', 'link', 'link-underline'])
        assert.equal(tokens['vo-' + name], 'var(--vo-' + name + ')', '@vo-' + name + ' defaults to the editor palette');
    assert.equal(tokens['vo-focus-w'], '2px', 'focus ring is 2px');

    for (const editor of EDITORS) {
        const where = editor.name + ': ';
        const shell = stripComments(read(shellLess(editor)));
        /* The editor keeps the runtime values: the new colours in both theme blocks, as literals. */
        for (const theme of ['body.vo-boot', 'body.vo-boot.theme-type-dark']) {
            declares(rule(shell, theme), where + theme, {
                '--vo-text-3': '#828b95', '--vo-link': '#0154c8', '--vo-link-underline': 'rgba(1, 84, 200, .3)'
            });
        }
        /* The shared rules come before the shell file of the editor: its values win. The shared tokens
           and menu, where the editor imports them, come before about.less. */
        const imports = Array.from(stripComments(read(appLess(editor))).matchAll(/@import\s+"([^"]+)"/g), m => m[1]);
        const at = name => imports.findIndex(p => p === name || p.endsWith('/' + name));
        assert.equal(at('compact/about.less') >= 0 && at('compact-shell.less') >= 0, true, where + 'app.less imports about.less and compact-shell.less');
        const order = ['compact/tokens.less', 'compact/menu.less', 'compact/about.less', 'compact-shell.less'].map(at).filter(i => i >= 0);
        assert.equal(order.join(' '), order.slice().sort((a, b) => a - b).join(' '), where + 'app.less imports about.less after the shared tokens and menu, before compact-shell.less');
        assert.equal(imports[at('compact/about.less')], '../../../../common/main/resources/less/compact/about.less', where + 'the shared about.less');
    }
});

test('the window takes the popup radius of the editor in the built css', () => {
    for (const editor of EDITORS) {
        const where = editor.name + ': ';
        const radius = lessVars(read(shellLess(editor)))['vo-r-pop'];
        assert.equal(radius, editor.radius, where + 'the popup radius of the editor shell');

        const css = builtCss(editor);
        const boxes = cssRules(css, SCOPE);
        assert.equal(boxes.length, 1, where + 'one box rule');
        const value = prop => {
            const d = boxes[0].filter(x => x[0] === prop).pop();
            return d ? d[1] : 'none declared';
        };
        assert.equal(value('border-radius'), editor.radius, where + 'border-radius');
        assert.equal(value('background'), 'var(--vo-surface)', where + 'background');
        assert.equal(value('box-shadow'), 'var(--vo-shadow)', where + 'box-shadow');
        assert.equal(value('border'), 'none', where + 'border');
        assert.equal(value('color'), 'var(--vo-text)', where + 'color');
        assert.equal(value('font-family').split(',')[0].trim(), 'system-ui', where + 'font-family');
        assert.equal(cssRules(css, SCOPE + ' .about-content a').length, 1, where + 'the content rules are built');
    }
});

test('missing built css fails with a message naming the variable', () => {
    const editor = EDITORS[0];
    const saved = process.env[editor.cssEnv];
    delete process.env[editor.cssEnv];
    try {
        assert.throws(() => builtCss(editor), new RegExp(editor.cssEnv));
    } finally {
        if (saved !== undefined) process.env[editor.cssEnv] = saved;
    }
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
