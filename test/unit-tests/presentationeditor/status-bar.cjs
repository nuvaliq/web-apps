/* Run: node test/unit-tests/presentationeditor/status-bar.cjs [path to CompactStatus.js]
 * The presentation shell status bar (#vo-status): on the left "Slide N of M" and the language, on the right
 * "Spell check", "Fit to width", "Fit to slide" and the edge icons are twins of the stock
 * status bar; captions come from the stock objects; without the edit right there is no language or
 * spelling; there is no zoom or slide show; the counter follows the engine events.
 *
 * The module is loaded in node via vm on top of a fake stock code; the buttons have the real
 * Button methods (toggle, click, doToggle, isDisabled); the bridge is the real StockBridge.js.
 * The optional argument is a corrupted copy of the module for a negative control:
 * a copy that shows the language without the edit right must fail
 * reader_no_language_no_spelling.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const PE_APP = path.join(ROOT, 'apps/presentationeditor/main/app');
const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.join(PE_APP, 'view/CompactStatus.js');
const BRIDGE = path.join(PE_APP, 'view/StockBridge.js');
const COMPONENTS = path.join(ROOT, 'apps/common/main/lib/component');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

/* The text of the method `name: function (…) {…}` from the source (first occurrence after anchor). */
function source(file, name, anchor) {
    const src = fs.readFileSync(file, 'utf8');
    const from = anchor ? src.indexOf(anchor) : 0;
    const head = new RegExp('\\b' + name + '\\s*:\\s*function\\s*\\(').exec(src.slice(from));
    assert.ok(head, path.basename(file) + ': ' + name + ' not found');
    const start = from + head.index + head[0].lastIndexOf('function');
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
        if (c === '"' || c === "'") { const q = c; i++; while (src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1);
}

/* --- A small DOM ------------------------------------------------------------------------ */

class El {
    constructor(tag, doc) {
        this.localName = tag; this.nodeType = 1; this.ownerDocument = doc;
        this.children = []; this.parentNode = null; this.attrs = {}; this.style = {}; this.listeners = {}; this._text = '';
        const set = new Set();
        this.classList = {
            add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)),
            contains: c => set.has(c),
            toggle: (c, on) => { const v = on === undefined ? !set.has(c) : !!on; v ? set.add(c) : set.delete(c); return v; }
        };
    }
    get firstChild() { return this.children[0] || null; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
    set innerHTML(v) { this._html = String(v); }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.body; }
    setAttribute(k, v) {
        if (k === 'class') { String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); return; }
        this.attrs[k] = String(v);
    }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); this.children.push(c); c.parentNode = this; return c; }
    removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
    descendants() { return this.children.reduce((a, c) => a.concat([c], c.descendants()), []); }
    matches(sel) {
        let m = /^\.([\w-]+)$/.exec(sel);
        if (m) return this.classList.contains(m[1]);
        m = /^\[id="([^"]+)"\]$/.exec(sel);
        if (m) return this.attrs.id === m[1];
        return this.localName === sel;
    }
    querySelector(sel) { return this.descendants().find(e => e.matches(sel)) || null; }
    closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
    getBoundingClientRect() { return {left: 100, top: 870, width: 60, height: 18, right: 160, bottom: 888}; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
    dispatchEvent(e) {
        e.target = e.target || this;
        const path = [];
        for (let n = this; n; n = n.parentNode) path.push(n);
        path.push(this.ownerDocument);
        for (const n of path) (n.listeners[e.type] || []).slice().forEach(f => f.call(n, e));
        return true;
    }
    click() { this.dispatchEvent({type: 'click', which: 1, preventDefault() {}}); }
}

function makeDoc() {
    const doc = {listeners: {}};
    doc.createElement = tag => new El(tag, doc);
    doc.body = new El('body', doc);
    doc.getElementById = id => doc.body.descendants().find(e => e.attrs.id === id) || null;
    doc.addEventListener = (t, f) => { (doc.listeners[t] = doc.listeners[t] || []).push(f); };
    doc.removeEventListener = (t, f) => { doc.listeners[t] = (doc.listeners[t] || []).filter(x => x !== f); };
    doc.dispatchEvent = e => { (doc.listeners[e.type] || []).slice().forEach(f => f(e)); };
    return doc;
}

/* --- Environment -------------------------------------------------------------------- */

function makeEnv(opts) {
    opts = Object.assign({edit: true, count: 5, current: 1, start: 1}, opts || {});
    const calls = [];
    const log = (who, what, args) => calls.push({who, what, args: Array.from(args || [])});
    const document = makeDoc();

    function events(target) {
        const handlers = {};
        target.on = function (names, fn, ctx) {
            String(names).split(/\s+/).forEach(n => (handlers[n] = handlers[n] || []).push([fn, ctx]));
            return target;
        };
        target.off = function (names, fn) {
            String(names).split(/\s+/).forEach(n => { handlers[n] = (handlers[n] || []).filter(h => fn && h[0] !== fn); });
            return target;
        };
        target.trigger = function (name, ...args) {
            (handlers[name] || []).slice().forEach(([fn, ctx]) => fn.apply(ctx || target, args));
            return target;
        };
        return target;
    }

    const NC = events({});
    const Common = {
        NotificationCenter: NC,
        Utils: {String: {format: (s, ...a) => String(s).replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m))}},
        UI: {}, Views: {}
    };
    const ctx = {_, Common, document, console, window: null};
    ctx.window = ctx;
    ctx.innerHeight = 900;
    vm.createContext(ctx);

    const BTN = path.join(COMPONENTS, 'Button.js');
    const compile = name => vm.runInContext('(' + source(BTN, name, name === 'toggle' || name === 'click' ? 'doToggle: function' : null) + ')', ctx);
    const btnProto = {toggle: compile('toggle'), click: compile('click'), doToggle: compile('doToggle'), isDisabled: compile('isDisabled')};
    function button(who, o) {
        const el = {attr() { return this; }, trigger() { return this; }};
        const b = events(Object.assign(Object.create(btnProto), {disabled: false, pressed: false, enableToggle: false,
            allowDepress: true, visible: true, options: {}, cmpEl: el, caption: ''}, o || {}));
        b.on('click', () => log(who, 'click', [b.pressed]));
        return b;
    }

    /* The stock bar language menu is Common.UI.MenuSimple: items are plain objects,
       the rendered menu catches a click on the row (li) and sends 'item:click'. */
    const langItems = [
        {id: 'lang-1', caption: 'English (United States)', value: 'en-US', code: 1033, checked: true},
        {id: 'lang-2', caption: 'Русский', value: 'ru-RU', code: 1049, checked: false}
    ];
    const ul = document.createElement('ul');
    langItems.forEach(it => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.setAttribute('id', it.id);
        a.textContent = it.caption;
        li.appendChild(a);
        ul.appendChild(li);
    });
    const langMenu = events({items: langItems, rendered: true, cmpEl: [ul]});
    ul.addEventListener('click', e => {
        const li = e.target.closest('li');
        const item = li ? langItems[ul.children.indexOf(li)] : null;
        if (!item) return;
        log('Statusbar.langMenu', 'item:click', [item.code]);
        langMenu.trigger('item:click', langMenu, item, e);
    });
    langMenu.on('show:before', () => log('Statusbar.langMenu', 'show:before'));

    const pages = {current: opts.current, count: opts.count, start: opts.start};
    const statusbar = {
        pageIndexText: 'Slide {0} of {1}', tipFitWidth: 'Fit to width', tipFitPage: 'Fit to slide', tipSetLang: 'Set text language',
        pages: {get: k => pages[k]},
        btnZoomToWidth: button('Statusbar.btnZoomToWidth', {enableToggle: true}),
        btnZoomToPage: button('Statusbar.btnZoomToPage', {enableToggle: true}),
        btnZoomUp: button('Statusbar.btnZoomUp'),
        btnZoomDown: button('Statusbar.btnZoomDown'),
        btnPreview: button('Statusbar.btnPreview'),
        btnLanguage: button('Statusbar.btnLanguage', {caption: 'English (United States)', menu: langMenu, disabled: !opts.edit})
    };
    /* Stock language choice (view/Statusbar.js _clickLanguage). */
    langMenu.on('item:click', (m, item) => { statusbar.btnLanguage.caption = item.caption; log('Statusbar', 'langchanged', [item.code]); });

    const statusCtl = {statusbar};
    if (opts.edit) statusCtl.btnSpelling = button('Statusbar.btnSpelling', {enableToggle: true, pressed: true});
    const controllers = {
        Statusbar: statusCtl,
        'Common.Controllers.ReviewChanges': {view: {txtSpelling: 'Spell checking'}}
    };
    ctx.PE = {Views: {}, getController: n => controllers[n] || null};

    const api = {
        callbacks: {},
        asc_registerCallback(name, fn) { (this.callbacks[name] = this.callbacks[name] || []).push(fn); }
    };
    ['zoom', 'zoomIn', 'zoomOut', 'zoomFitToWidth', 'zoomFitToPage', 'StartDemonstration', 'asc_setSpellCheck', 'put_TextPrLang']
        .forEach(m => { api[m] = function () { log('api', m, arguments); }; });
    const fire = (name, ...args) => (api.callbacks[name] || []).slice().forEach(fn => fn(...args));

    const status = document.createElement('div');
    status.setAttribute('id', 'vo-status');
    document.body.appendChild(status);
    const errors = [];
    const shell = {
        advanced: false, startupFailed: false,
        guarded: (label, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { errors.push(label + ': ' + (e && e.stack || e)); }
        },
        rowEl: name => (name === 'status' ? status : null),
        editRight: () => !!opts.edit,
        onApi(name, fn) { api.asc_registerCallback(name, this.guarded('api: ' + name, fn)); },
        command() { return function () {}; }
    };
    ctx.PE.Views.CompactShell = shell;

    vm.runInContext(fs.readFileSync(BRIDGE, 'utf8').replace(/^define\(\[[^\]]*\],\s*/m, '(').replace(/\);\s*$/, ')()'), ctx, {filename: BRIDGE});
    vm.runInContext(fs.readFileSync(FILE, 'utf8').replace(/^define\(\[[^\]]*\],\s*/m, '(').replace(/\);\s*$/, ')()'), ctx, {filename: FILE});
    const Status = ctx.PE.Views.CompactStatus;
    assert.ok(Status && typeof Status.install === 'function', 'нет PE.Views.CompactStatus.install');
    Status.install(shell);

    const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
    const isControl = e => e.localName === 'button' || e.getAttribute('role') === 'button' || (e.listeners.click || []).length > 0;
    return {
        calls, errors, status, statusbar, statusCtl, langMenu, document, fire, Status,
        reset() { calls.length = 0; },
        text: () => norm(status.textContent),
        controls: () => status.descendants().filter(e => isControl(e) && !e.hasAttribute('hidden')),
        byText: t => status.descendants().find(e => norm(e.textContent) === t && e.children.length === 0 || (isControl(e) && norm(e.textContent) === t)) || null,
        leaf: t => status.descendants().filter(e => norm(e.textContent).includes(t) && !e.hasAttribute('hidden')).pop() || null,
        did: (who, what) => calls.some(c => c.who === who && (!what || c.what === what))
    };
}

/* --- Tests ----------------------------------------------------------------------------- */

const tests = [
    {
        name: 'status_items_with_edit_right',
        run() {
            const env = makeEnv();
            const counter = env.leaf('Slide 2 of 5');
            assert.ok(counter, 'нет «Slide 2 of 5» (строка: ' + env.text() + ')');
            const lang = env.byText('English (United States)');
            const spell = env.byText('Spell checking');
            const fitW = env.byText('Fit to width');
            const fitS = env.byText('Fit to slide');
            assert.ok(lang, 'нет языка текста');
            assert.ok(spell && fitW && fitS, 'нет переключателей: ' + env.text());
            /* Order: counter, language, spelling, fit to width, fit to slide, edge icons. */
            const order = env.status.descendants();
            const seq = [counter, lang, spell, fitW, fitS, env.status.querySelector('.vo-st-tools')];
            for (let i = 1; i < seq.length; i++) assert.ok(order.indexOf(seq[i - 1]) < order.indexOf(seq[i]), 'порядок строки нарушен на ' + i);
            assert.equal(env.status.querySelector('.vo-st-tools').descendants().some(e => (e.listeners.click || []).length), false, 'значки края с действием');

            /* Twins: a click is the stock click, the state comes from the stock button. */
            env.reset();
            spell.click();
            assert.ok(env.did('Statusbar.btnSpelling', 'click'), 'орфография мимо штатной кнопки');
            assert.equal(env.statusCtl.btnSpelling.pressed, false, 'штатная кнопка орфографии не переключилась');
            assert.equal(spell.getAttribute('aria-pressed'), 'false', 'нажатость орфографии не со штатной кнопки');
            fitW.click();
            assert.ok(env.did('Statusbar.btnZoomToWidth', 'click'), '«По ширине» мимо штатной кнопки');
            fitS.click();
            assert.ok(env.did('Statusbar.btnZoomToPage', 'click'), '«По размеру слайда» мимо штатной кнопки');
            assert.equal(env.calls.filter(c => c.who === 'api').length, 0, 'строка зовёт движок напрямую');
            env.statusbar.btnZoomToPage.disabled = true;
            env.Status.refresh();
            assert.ok(fitS.classList.contains('vo-locked'), 'погашенный двойник не погашен в строке');
            env.reset();
            fitS.click();
            assert.equal(env.did('Statusbar.btnZoomToPage', 'click'), false, 'погашенный двойник сработал');

            /* Language: the list is the stock menu at the moment of opening, choosing is a click on the stock item. */
            env.reset();
            lang.click();
            assert.ok(env.did('Statusbar.langMenu', 'show:before'), 'меню языков не подготовлено штатно (show:before)');
            const pop = env.document.getElementById('vo-st-lang-pop');
            assert.ok(pop, 'список языков не открыт');
            const rows = pop.children;
            assert.deepEqual(rows.map(r => r.textContent), ['English (United States)', 'Русский'], 'список языков не штатный');
            assert.ok(rows[0].classList.contains('on'), 'текущий язык не отмечен');
            rows[1].click();
            assert.ok(env.did('Statusbar.langMenu', 'item:click'), 'выбор языка мимо штатного меню');
            assert.ok(env.did('Statusbar', 'langchanged'), 'штатная строка не получила язык');
            assert.ok(!env.document.getElementById('vo-st-lang-pop'), 'список не закрылся после выбора');
            assert.ok(env.byText('Русский'), 'подпись языка не следует штатной кнопке: ' + env.text());
            /* Esc closes the list. */
            env.byText('Русский').click();
            assert.ok(env.document.getElementById('vo-st-lang-pop'));
            env.document.dispatchEvent({type: 'keydown', key: 'Escape', keyCode: 27});
            assert.ok(!env.document.getElementById('vo-st-lang-pop'), 'Esc не закрыл список языков');
            assert.deepEqual(env.errors, []);
        }
    },
    {
        name: 'reader_no_language_no_spelling',
        run() {
            const env = makeEnv({edit: false});
            assert.ok(env.leaf('Slide 2 of 5'), 'без права правки нет счётчика');
            assert.ok(env.byText('Fit to width') && env.byText('Fit to slide'), 'без права правки нет подгонки: ' + env.text());
            assert.ok(!env.byText('Spell checking'), 'орфография без права правки');
            assert.ok(!env.byText('English (United States)'), 'язык без права правки');
            assert.ok(!env.status.querySelector('.vo-st-lang'), 'место языка без права правки');
            assert.deepEqual(env.errors, []);
        }
    },
    {
        name: 'no_zoom_no_preview',
        run() {
            const env = makeEnv();
            assert.ok(!/\d+\s?%/.test(env.text()), 'в строке значение масштаба: ' + env.text());
            env.reset();
            for (const c of env.controls()) {
                c.click();
                env.document.dispatchEvent({type: 'keydown', key: 'Escape', keyCode: 27});
            }
            const stray = env.calls.filter(c => /btnZoom(Up|Down)|btnPreview/.test(c.who) || c.who === 'api');
            assert.deepEqual(stray.map(c => c.who + ' ' + c.what), [], 'строка достаёт до масштаба или показа');
            assert.ok(!/preview|show/i.test(env.status.descendants().map(e => e.getAttribute('class') || '').join(' ')), 'в строке место показа');
            assert.deepEqual(env.errors, []);
        }
    },
    {
        name: 'slide_counter_follows_engine',
        run() {
            const env = makeEnv({count: -1, current: 1});
            const page = env.status.querySelector('.vo-st-page');
            assert.ok(page, 'нет счётчика слайдов');
            assert.ok(page.hasAttribute('hidden'), 'счётчик виден до числа слайдов (штатно — скрыт)');
            env.fire('asc_onCountPages', 5);
            env.fire('asc_onCurrentPage', 1);
            assert.equal(page.textContent, 'Slide 2 of 5');
            assert.equal(page.hasAttribute('hidden'), false);
            env.fire('asc_onCurrentPage', 3);
            assert.equal(page.textContent, 'Slide 4 of 5', 'счётчик не следует движку');
            env.fire('asc_onCountPages', 7);
            assert.equal(page.textContent, 'Slide 4 of 7');
            /* Numbering from another slide: the stock bar format. */
            env.fire('asc_onPresentationSize', 960, 540, 0, 3);
            assert.equal(page.textContent, 'Slide 6 of 3 .. 9', 'нумерация с другого слайда не штатная');
            assert.deepEqual(env.errors, []);
        }
    }
];

let failed = 0;
const only = process.argv.indexOf('--only') >= 0 ? process.argv[process.argv.indexOf('--only') + 1] : null;
for (const t of tests) {
    if (only && t.name !== only) continue;
    try {
        t.run();
        console.log('ok ' + t.name);
    } catch (e) {
        failed++;
        console.log('FAIL ' + t.name + ': ' + (e && e.message || e));
    }
}
console.log((tests.length - failed) + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
