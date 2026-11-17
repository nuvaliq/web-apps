/* Shared helper for the mode-*.cjs checks of the presentation compact shell.
 * Running it directly does nothing and exits with code 0.
 *
 * What it gives the checks:
 *  - a small DOM and a small jQuery over it (selectors, events with bubbling and
 *    delegation, visibility by inline display/hidden), enough to drive the shell
 *    the way a person does: clicks, Escape, keyboard;
 *  - the stock environment of the presentation editor as stubs: controllers, ribbon
 *    controls (twins), menus with the stock items, the stock locale (ru.json) applied
 *    the stock way before the views load, and a few stock handlers taken verbatim
 *    from the stock controllers (preview start, editing lock, left menu lock);
 *  - spies that tell who made a call: shell code, stock code or the test itself;
 *  - loading of the shell modules from apps/presentationeditor/main/app/view
 *    (or from --view-dir <dir>, used for a negative control).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../../../..');
const PE_APP = path.join(ROOT, 'apps/presentationeditor/main/app');
const LOCALE_RU = path.join(ROOT, 'apps/presentationeditor/main/locale/ru.json');
const SELF = __filename;
/* Modules the shell takes from the shared compact layer: name → file. The module is Common.UI.Compact.<name>,
   not PE.Views.<name>. */
const SHARED_COMPACT = path.join(ROOT, 'apps/common/main/lib/view/compact');
const SHARED_MODULES = {Icons: path.join(SHARED_COMPACT, 'Icons.js'), MenuModel: path.join(SHARED_COMPACT, 'MenuModel.js'),
    AdapterKit: path.join(SHARED_COMPACT, 'AdapterKit.js'), MenuBar: path.join(SHARED_COMPACT, 'MenuBar.js'),
    Windows: path.join(SHARED_COMPACT, 'Windows.js')};
const TEST_DIR = __dirname;

/* Shell modules in load order: a module comes after the ones it may take as an AMD dependency. */
const SHELL_MODULES = ['Icons', 'MenuModel', 'AdapterKit', 'MenuBar', 'DocInfoWindow', 'Windows', 'CompactWindows', 'StockBridge', 'SlideSelection',
    'CompactModes', 'SlideActions', 'CompactMenuAdapter', 'CompactToolbar', 'SlideSections', 'CompactLeft', 'CompactStatus', 'CompactShell'];

/* ------------------------------------------------------------------------ */
/* Command line and runner                                                   */

function cli() {
    const args = process.argv.slice(2);
    const out = {only: null, viewDir: path.join(PE_APP, 'view')};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--only') out.only = args[++i];
        else if (args[i] === '--view-dir') out.viewDir = path.resolve(args[++i]);
    }
    return out;
}

async function run(tests) {
    const opts = cli();
    const names = new Set();
    for (const t of tests) {
        if (names.has(t.name)) throw new Error('duplicate test name ' + t.name);
        names.add(t.name);
    }
    if (opts.only && !names.has(opts.only)) {
        console.log('FAIL ' + opts.only + ': no such test in this file');
        process.exitCode = 1;
        return;
    }
    let failed = 0, passed = 0;
    for (const t of tests) {
        if (opts.only && t.name !== opts.only) continue;
        try {
            await t.fn(opts);
            console.log('ok ' + t.name);
            passed++;
        } catch (e) {
            const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, ' ').trim();
            console.log('FAIL ' + t.name + ': ' + msg);
            failed++;
        }
    }
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
}

/* ------------------------------------------------------------------------ */
/* Call origin: first frame that is neither this helper, a test file nor vendor */

Error.stackTraceLimit = 200;

function originOf(stack) {
    const lines = String(stack || '').split('\n').slice(1);
    for (const line of lines) {
        const m = line.match(/\(?((?:stock:|shell:|vendor:|\/)[^():]*(?::[^():]*)*?):\d+:\d+\)?\s*$/);
        if (!m) continue;
        const file = m[1];
        if (file === SELF || file.startsWith(TEST_DIR)) continue;
        if (file.startsWith('vendor:')) continue;
        if (file.startsWith('node:')) continue;
        if (file.startsWith('shell:')) return 'shell';
        if (file.startsWith('stock:')) return 'stock';
        return 'other';
    }
    return 'test';
}
function origin() { return originOf(new Error().stack); }

/* ------------------------------------------------------------------------ */
/* Small DOM                                                                  */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', times: '×', middot: '·'};
function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
    });
}
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function camel(n) { return n.startsWith('--') ? n : n.replace(/-([a-z])/g, (m, c) => c.toUpperCase()); }
function kebab(n) { return n.startsWith('--') ? n : n.replace(/[A-Z]/g, c => '-' + c.toLowerCase()); }

function makeStyle() {
    const st = {};
    Object.defineProperties(st, {
        setProperty: {value(n, v) { st[camel(n)] = v == null ? '' : String(v); }},
        getPropertyValue: {value(n) { const v = st[camel(n)]; return v == null ? '' : String(v); }},
        getPropertyPriority: {value() { return ''; }},
        removeProperty: {value(n) { delete st[camel(n)]; }},
        cssText: {
            get() { return Object.keys(st).filter(k => st[k] !== '' && st[k] != null).map(k => kebab(k) + ': ' + st[k]).join('; '); },
            set(v) { for (const k of Object.keys(st)) delete st[k]; parseStyle(st, v); }
        }
    });
    return st;
}
function parseStyle(st, text) {
    String(text || '').split(';').forEach(part => {
        const i = part.indexOf(':');
        if (i < 0) return;
        const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
        if (k) st[camel(k)] = v;
    });
}

class FTarget {
    constructor() { this._ls = []; }
    addEventListener(type, fn, opt) {
        if (!fn) return;
        const capture = typeof opt === 'boolean' ? opt : !!(opt && opt.capture);
        if (this._ls.some(l => l.type === type && l.fn === fn && l.capture === capture)) return;
        this._ls.push({type, fn, capture, once: !!(opt && opt.once), origin: origin()});
    }
    removeEventListener(type, fn, opt) {
        const capture = typeof opt === 'boolean' ? opt : !!(opt && opt.capture);
        this._ls = this._ls.filter(l => !(l.type === type && l.fn === fn && l.capture === capture));
    }
}

class FText {
    constructor(doc, text) { this.nodeType = 3; this.nodeName = '#text'; this.ownerDocument = doc; this.parentNode = null; this.data = String(text); this._ls = []; }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
    get nodeValue() { return this.data; }
    set nodeValue(v) { this.data = String(v); }
    get childNodes() { return []; }
    get nextSibling() { return sib(this, 1, false); }
    get previousSibling() { return sib(this, -1, false); }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    cloneNode() { return new FText(this.ownerDocument, this.data); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { return n === this; }
    addEventListener() {}
    removeEventListener() {}
}

function sib(node, dir, elementsOnly) {
    const p = node.parentNode;
    if (!p) return null;
    const list = elementsOnly ? p.childNodes.filter(n => n.nodeType === 1) : p.childNodes;
    const i = list.indexOf(node);
    return i < 0 ? null : (list[i + dir] || null);
}

class FParent extends FTarget {
    constructor(doc) { super(); this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    get childElementCount() { return this.children.length; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
    hasChildNodes() { return this.childNodes.length > 0; }
    appendChild(n) { return this.insertBefore(n, null); }
    insertBefore(n, ref) {
        if (!n) return n;
        if (n.nodeType === 11) { for (const c of n.childNodes.slice()) this.insertBefore(c, ref); return n; }
        if (n.parentNode) n.parentNode.removeChild(n);
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
        n.parentNode = this;
        return n;
    }
    removeChild(n) {
        const i = this.childNodes.indexOf(n);
        if (i >= 0) this.childNodes.splice(i, 1);
        n.parentNode = null;
        return n;
    }
    replaceChild(n, old) { this.insertBefore(n, old); this.removeChild(old); return old; }
    append(...nodes) { nodes.forEach(n => this.appendChild(typeof n === 'string' ? new FText(this.ownerDocument, n) : n)); }
    prepend(...nodes) { const first = this.firstChild; nodes.forEach(n => this.insertBefore(typeof n === 'string' ? new FText(this.ownerDocument, n) : n, first)); }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    get textContent() { return this.childNodes.map(c => c.textContent).join(''); }
    set textContent(v) {
        this.childNodes.forEach(c => { c.parentNode = null; });
        this.childNodes = [];
        if (v !== '' && v != null) this.appendChild(new FText(this.ownerDocument, v));
    }
    querySelectorAll(sel) { return queryAll(this, sel); }
    querySelector(sel) { return queryAll(this, sel)[0] || null; }
    getElementsByTagName(tag) { return queryAll(this, tag); }
    getElementsByClassName(c) { return queryAll(this, c.trim().split(/\s+/).map(x => '.' + x).join('')); }
}

class FFragment extends FParent {
    constructor(doc) { super(doc); this.nodeType = 11; this.nodeName = '#document-fragment'; }
}

class FElement extends FParent {
    constructor(doc, tag) {
        super(doc);
        this.nodeType = 1;
        this.tagName = String(tag).toUpperCase();
        this.nodeName = this.tagName;
        this.localName = String(tag).toLowerCase();
        this.attrs = new Map();
        this.style = makeStyle();
        this.__data = new Map();
        this.__w = 0;
        this.__h = 0;
        this._value = undefined;
        this.checked = false;
        this.tabIndex = -1;
        this.scrollTop = 0;
        this.scrollLeft = 0;
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get classList() {
        const el = this;
        const list = () => el.className.split(/\s+/).filter(Boolean);
        const put = arr => el.setAttribute('class', Array.from(new Set(arr)).join(' '));
        const cl = {
            add: (...c) => put(list().concat(c)),
            remove: (...c) => put(list().filter(x => c.indexOf(x) < 0)),
            contains: c => list().indexOf(c) >= 0,
            toggle: (c, on) => {
                const has = list().indexOf(c) >= 0;
                const want = on === undefined ? !has : !!on;
                if (want && !has) put(list().concat([c]));
                if (!want && has) put(list().filter(x => x !== c));
                return want;
            },
            get length() { return list().length; },
            item: i => list()[i] || null,
            forEach: fn => list().forEach(fn),
            [Symbol.iterator]: () => list()[Symbol.iterator](),
            toString: () => el.className
        };
        /* indexed like a DOMTokenList snapshot, for Array.prototype helpers */
        const idx = p => typeof p === 'string' && /^\d+$/.test(p);
        return new Proxy(cl, {
            get: (t, p) => (idx(p) ? list()[+p] : t[p]),
            has: (t, p) => (idx(p) ? +p < list().length : p in t)
        });
    }
    get value() { return this._value !== undefined ? this._value : (this.getAttribute('value') || ''); }
    set value(v) { this._value = v == null ? '' : String(v); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get title() { return this.getAttribute('title') || ''; }
    set title(v) { this.setAttribute('title', v); }
    get type() { return this.getAttribute('type') || (this.localName === 'button' ? 'submit' : 'text'); }
    get dataset() {
        const el = this;
        return new Proxy({}, {
            get: (t, k) => typeof k === 'string' ? (el.getAttribute('data-' + kebab(k)) ?? undefined) : undefined,
            set: (t, k, v) => { el.setAttribute('data-' + kebab(k), v); return true; },
            deleteProperty: (t, k) => { el.removeAttribute('data-' + kebab(k)); return true; }
        });
    }
    getAttribute(n) {
        n = String(n).toLowerCase();
        if (n === 'style') return this.style.cssText || null;
        return this.attrs.has(n) ? this.attrs.get(n) : null;
    }
    setAttribute(n, v) {
        n = String(n).toLowerCase();
        if (n === 'style') { this.style.cssText = String(v); return; }
        this.attrs.set(n, String(v));
    }
    removeAttribute(n) { n = String(n).toLowerCase(); if (n === 'style') this.style.cssText = ''; this.attrs.delete(n); }
    hasAttribute(n) { n = String(n).toLowerCase(); return n === 'style' ? !!this.style.cssText : this.attrs.has(n); }
    toggleAttribute(n, on) { const want = on === undefined ? !this.hasAttribute(n) : !!on; if (want) this.setAttribute(n, ''); else this.removeAttribute(n); return want; }
    get attributes() { return Array.from(this.attrs, ([name, value]) => ({name, value})); }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get nextSibling() { return sib(this, 1, false); }
    get previousSibling() { return sib(this, -1, false); }
    get nextElementSibling() { return sib(this, 1, true); }
    get previousElementSibling() { return sib(this, -1, true); }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument; }
    get innerText() { return this.textContent; }
    set innerText(v) { this.textContent = v; }
    get innerHTML() { return this.childNodes.map(serialize).join(''); }
    set innerHTML(v) {
        this.childNodes.forEach(c => { c.parentNode = null; });
        this.childNodes = [];
        parseHTML(this.ownerDocument, String(v == null ? '' : v)).forEach(n => this.appendChild(n));
    }
    get outerHTML() { return serialize(this); }
    insertAdjacentHTML(pos, html) {
        const nodes = parseHTML(this.ownerDocument, html);
        const p = String(pos).toLowerCase();
        if (p === 'beforeend') nodes.forEach(n => this.appendChild(n));
        else if (p === 'afterbegin') { const f = this.firstChild; nodes.forEach(n => this.insertBefore(n, f)); }
        else if (p === 'beforebegin' && this.parentNode) nodes.forEach(n => this.parentNode.insertBefore(n, this));
        else if (p === 'afterend' && this.parentNode) { const nx = this.nextSibling; nodes.forEach(n => this.parentNode.insertBefore(n, nx)); }
    }
    insertAdjacentElement(pos, el) { const tmp = new FFragment(this.ownerDocument); tmp.appendChild(el); this.insertAdjacentHTML(pos, ''); return el; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    matches(sel) { return matches(this, sel); }
    closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; }
    cloneNode(deep) {
        const c = new FElement(this.ownerDocument, this.localName);
        this.attrs.forEach((v, k) => c.attrs.set(k, v));
        c.style.cssText = this.style.cssText;
        if (deep) this.childNodes.forEach(ch => c.appendChild(ch.cloneNode(true)));
        return c;
    }
    dispatchEvent(ev) { return dispatch(this, ev); }
    click() { dispatch(this, makeEvent(this.ownerDocument, 'click')); }
    focus() {
        const doc = this.ownerDocument;
        const prev = doc.activeElement;
        if (prev === this) return;
        doc.activeElement = this;
        if (prev && prev !== doc.body && prev.nodeType === 1) dispatch(prev, makeEvent(doc, 'focusout', {relatedTarget: this}));
        dispatch(this, makeEvent(doc, 'focusin', {relatedTarget: prev}));
    }
    blur() { const doc = this.ownerDocument; if (doc.activeElement === this) { doc.activeElement = doc.body; dispatch(this, makeEvent(doc, 'focusout')); } }
    select() {}
    setSelectionRange() {}
    scrollIntoView() {}
    scrollTo() {}
    setPointerCapture() {}
    releasePointerCapture() {}
    hasPointerCapture() { return false; }
    getClientRects() { return []; }
    getBoundingClientRect() { return {left: 0, top: 0, right: this.__w, bottom: this.__h, width: this.__w, height: this.__h, x: 0, y: 0}; }
    get offsetWidth() { return this.__w; }
    get offsetHeight() { return this.__h; }
    get clientWidth() { return this.__w; }
    get clientHeight() { return this.__h; }
    get scrollWidth() { return this.__w; }
    get scrollHeight() { return this.__h; }
    get offsetParent() { return this.parentElement; }
    get offsetLeft() { return 0; }
    get offsetTop() { return 0; }
    animate() { return {finished: Promise.resolve(), cancel() {}, onfinish: null}; }
    attachShadow() { return new FFragment(this.ownerDocument); }
}

function serialize(n) {
    if (n.nodeType === 3) return escHtml(n.data);
    if (n.nodeType !== 1) return '';
    const attrs = [];
    n.attrs.forEach((v, k) => attrs.push(' ' + k + '="' + String(v).replace(/"/g, '&quot;') + '"'));
    const st = n.style.cssText;
    if (st) attrs.push(' style="' + st.replace(/"/g, '&quot;') + '"');
    if (VOID.has(n.localName)) return '<' + n.localName + attrs.join('') + '>';
    return '<' + n.localName + attrs.join('') + '>' + n.childNodes.map(serialize).join('') + '</' + n.localName + '>';
}

function parseHTML(doc, html) {
    const top = [];
    const stack = [];
    const add = node => { if (stack.length) stack[stack.length - 1].appendChild(node); else top.push(node); };
    let i = 0;
    const s = String(html);
    while (i < s.length) {
        if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue; }
        if (s.startsWith('<!', i)) { const e = s.indexOf('>', i); i = e < 0 ? s.length : e + 1; continue; }
        if (s[i] === '<' && s[i + 1] === '/') {
            const e = s.indexOf('>', i);
            const tag = s.slice(i + 2, e < 0 ? s.length : e).trim().toLowerCase();
            for (let k = stack.length - 1; k >= 0; k--) {
                if (stack[k].localName === tag) { stack.length = k; break; }
            }
            i = e < 0 ? s.length : e + 1;
            continue;
        }
        if (s[i] === '<' && /[a-zA-Z]/.test(s[i + 1] || '')) {
            let j = i + 1;
            while (j < s.length && /[^\s/>]/.test(s[j])) j++;
            const tag = s.slice(i + 1, j).toLowerCase();
            const el = doc.createElement(tag);
            let selfClose = false;
            while (j < s.length) {
                while (j < s.length && /\s/.test(s[j])) j++;
                if (s[j] === '>') { j++; break; }
                if (s[j] === '/' && s[j + 1] === '>') { selfClose = true; j += 2; break; }
                if (s[j] === '/') { j++; continue; }
                let k = j;
                while (k < s.length && /[^\s=/>]/.test(s[k])) k++;
                const name = s.slice(j, k);
                j = k;
                while (j < s.length && /\s/.test(s[j])) j++;
                let value = '';
                if (s[j] === '=') {
                    j++;
                    while (j < s.length && /\s/.test(s[j])) j++;
                    if (s[j] === '"' || s[j] === "'") {
                        const q = s[j];
                        const e = s.indexOf(q, j + 1);
                        value = s.slice(j + 1, e < 0 ? s.length : e);
                        j = e < 0 ? s.length : e + 1;
                    } else {
                        let e = j;
                        while (e < s.length && /[^\s>]/.test(s[e])) e++;
                        value = s.slice(j, e);
                        j = e;
                    }
                }
                if (name) el.setAttribute(name, decode(value));
            }
            add(el);
            if (tag === 'script' || tag === 'style' || tag === 'textarea') {
                const end = s.toLowerCase().indexOf('</' + tag, j);
                const raw = s.slice(j, end < 0 ? s.length : end);
                if (raw) el.appendChild(new FText(doc, tag === 'textarea' ? decode(raw) : raw));
                const close = end < 0 ? s.length : s.indexOf('>', end);
                i = close < 0 ? s.length : close + 1;
                continue;
            }
            if (!selfClose && !VOID.has(tag)) stack.push(el);
            i = j;
            continue;
        }
        let e = s.indexOf('<', i + 1);
        if (e < 0) e = s.length;
        if (s[i] === '<' && e === i) e = i + 1;
        const text = decode(s.slice(i, e));
        if (text) add(new FText(doc, text));
        i = e;
    }
    return top;
}

class FDocument extends FParent {
    constructor() {
        super(null);
        this.ownerDocument = this;
        this.nodeType = 9;
        this.nodeName = '#document';
        this.documentElement = new FElement(this, 'html');
        this.head = new FElement(this, 'head');
        this.body = new FElement(this, 'body');
        this.appendChild(this.documentElement);
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        this.activeElement = this.body;
        this.readyState = 'complete';
        this.baseURI = 'http://localhost/web-apps/apps/presentationeditor/main/index.html';
        this.URL = this.baseURI;
        this.location = {href: this.baseURI, search: '', hash: '', hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', pathname: '/web-apps/apps/presentationeditor/main/index.html'};
        this.cookie = '';
        this.title = '';
        this.hidden = false;
        this.visibilityState = 'visible';
        const doc = this;
        this.fonts = {
            ready: {then(f) { doc.__later(f); return this; }, catch() { return this; }, finally(f) { doc.__later(f); return this; }},
            check: () => true, load: () => Promise.resolve([])
        };
        this.__later = f => f && f();
    }
    createElement(tag) { return new FElement(this, tag); }
    createElementNS(ns, tag) { return new FElement(this, tag); }
    createTextNode(t) { return new FText(this, t); }
    createDocumentFragment() { return new FFragment(this); }
    createComment() { return new FText(this, ''); }
    createEvent() { return makeEvent(this, ''); }
    getElementById(id) { return walk(this.documentElement).find(n => n.getAttribute('id') === String(id)) || null; }
    hasFocus() { return true; }
    execCommand() { return false; }
    getSelection() { return {removeAllRanges() {}, addRange() {}, rangeCount: 0, toString: () => ''}; }
    elementFromPoint() { return this.body; }
    dispatchEvent(ev) { return dispatch(this, ev); }
}

function walk(root) {
    const out = [];
    const rec = n => { for (const c of n.childNodes) if (c.nodeType === 1) { out.push(c); rec(c); } };
    if (root.nodeType === 1) { out.push(root); }
    rec(root);
    return out;
}

/* ---- selectors ---------------------------------------------------------- */

const SEL_CACHE = new Map();
function splitTop(sel, ch) {
    const out = [];
    let depth = 0, quote = null, cur = '';
    for (const c of sel) {
        if (quote) { cur += c; if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; cur += c; continue; }
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') depth--;
        if (c === ch && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += c;
    }
    out.push(cur);
    return out;
}
function parseSelector(sel) {
    if (SEL_CACHE.has(sel)) return SEL_CACHE.get(sel);
    const groups = splitTop(sel, ',').map(g => g.trim()).filter(Boolean).map(parseSequence);
    SEL_CACHE.set(sel, groups);
    return groups;
}
function parseSequence(text) {
    const seq = [];
    let i = 0, comb = null;
    const s = text.trim();
    while (i < s.length) {
        let ws = false;
        while (i < s.length && /\s/.test(s[i])) { i++; ws = true; }
        if ('>+~'.includes(s[i])) { comb = s[i]; i++; while (i < s.length && /\s/.test(s[i])) i++; }
        else if (ws && seq.length) comb = ' ';
        const start = i;
        let depth = 0, quote = null;
        while (i < s.length) {
            const c = s[i];
            if (quote) { if (c === quote) quote = null; i++; continue; }
            if (c === '"' || c === "'") { quote = c; i++; continue; }
            if (c === '(' || c === '[') depth++;
            if (c === ')' || c === ']') depth--;
            if (depth === 0 && (/\s/.test(c) || '>+~'.includes(c))) break;
            i++;
        }
        const part = s.slice(start, i);
        if (part) { seq.push({comb: seq.length ? (comb || ' ') : null, c: parseCompound(part)}); comb = null; }
    }
    return seq;
}
function parseCompound(p) {
    const c = {tag: null, id: null, classes: [], attrs: [], pseudos: []};
    let i = 0;
    const ident = () => { const st = i; while (i < p.length && /[\w\- -￿\\]/.test(p[i])) i++; return p.slice(st, i); };
    if (p[0] === '*') i = 1;
    else if (/[a-zA-Z]/.test(p[0])) c.tag = ident().toLowerCase();
    while (i < p.length) {
        const ch = p[i];
        if (ch === '#') { i++; c.id = ident(); }
        else if (ch === '.') { i++; c.classes.push(ident()); }
        else if (ch === '[') {
            const e = p.indexOf(']', i);
            const body = p.slice(i + 1, e);
            i = e + 1;
            const m = body.match(/^\s*([^~|^$*!=\s]+)\s*(?:([~|^$*!]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*$/);
            if (m) c.attrs.push({name: m[1].toLowerCase(), op: m[2] || null, value: m[3] ?? m[4] ?? m[5] ?? null});
        } else if (ch === ':') {
            i++;
            if (p[i] === ':') i++;
            const name = ident().toLowerCase();
            let arg = null;
            if (p[i] === '(') {
                let depth = 0, st = i + 1;
                for (; i < p.length; i++) {
                    if (p[i] === '(') depth++;
                    else if (p[i] === ')') { depth--; if (!depth) break; }
                }
                arg = p.slice(st, i);
                i++;
            }
            c.pseudos.push({name, arg});
        } else i++;
    }
    return c;
}
function isVisibleNode(el) {
    if (!el || el.nodeType !== 1) return false;
    let n = el;
    while (n && n.nodeType === 1) {
        if (n.style.display === 'none' || n.hasAttribute('hidden')) return false;
        n = n.parentNode;
    }
    return !!n && n.nodeType === 9;
}
function matchCompound(el, c) {
    if (!el || el.nodeType !== 1) return false;
    if (c.tag && el.localName !== c.tag) return false;
    if (c.id && el.getAttribute('id') !== c.id) return false;
    if (c.classes.length) {
        const cl = el.className.split(/\s+/);
        for (const k of c.classes) if (cl.indexOf(k) < 0) return false;
    }
    for (const a of c.attrs) {
        const v = el.getAttribute(a.name);
        if (v === null) { if (a.op === '!=') continue; return false; }
        if (!a.op) continue;
        const want = a.value;
        if (a.op === '=' && v !== want) return false;
        if (a.op === '!=' && v === want) return false;
        if (a.op === '~=' && v.split(/\s+/).indexOf(want) < 0) return false;
        if (a.op === '^=' && !v.startsWith(want)) return false;
        if (a.op === '$=' && !v.endsWith(want)) return false;
        if (a.op === '*=' && v.indexOf(want) < 0) return false;
        if (a.op === '|=' && !(v === want || v.startsWith(want + '-'))) return false;
    }
    for (const ps of c.pseudos) {
        switch (ps.name) {
            case 'visible': if (!isVisibleNode(el)) return false; break;
            case 'hidden': if (isVisibleNode(el)) return false; break;
            case 'not': if (matches(el, ps.arg)) return false; break;
            case 'has': if (!queryAll(el, ps.arg).length) return false; break;
            case 'first-child': if (el.previousElementSibling) return false; break;
            case 'last-child': if (el.nextElementSibling) return false; break;
            case 'only-child': if (el.previousElementSibling || el.nextElementSibling) return false; break;
            case 'disabled': if (!el.hasAttribute('disabled')) return false; break;
            case 'enabled': if (el.hasAttribute('disabled')) return false; break;
            case 'checked': if (!el.checked && !el.hasAttribute('checked')) return false; break;
            case 'focus': if (el.ownerDocument.activeElement !== el) return false; break;
            case 'empty': if (el.childNodes.length) return false; break;
            case 'contains': if (el.textContent.indexOf(String(ps.arg).replace(/^["']|["']$/g, '')) < 0) return false; break;
            default: break;
        }
    }
    return true;
}
function matchSeq(el, seq, idx) {
    if (!matchCompound(el, seq[idx].c)) return false;
    if (idx === 0) return true;
    const comb = seq[idx].comb;
    if (comb === '>') return matchSeq(el.parentNode, seq, idx - 1);
    if (comb === '+') return matchSeq(el.previousElementSibling, seq, idx - 1);
    if (comb === '~') { for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (matchSeq(s, seq, idx - 1)) return true; return false; }
    for (let a = el.parentNode; a && a.nodeType === 1; a = a.parentNode) if (matchSeq(a, seq, idx - 1)) return true;
    return false;
}
function matches(el, sel) {
    if (!el || el.nodeType !== 1 || !sel) return false;
    return parseSelector(String(sel)).some(seq => seq.length && matchSeq(el, seq, seq.length - 1));
}
function queryAll(root, sel) {
    const groups = parseSelector(String(sel));
    const all = root.nodeType === 9 ? walk(root.documentElement) : walk(root).slice(1);
    return all.filter(el => groups.some(seq => seq.length && matchSeq(el, seq, seq.length - 1)));
}

/* ---- events --------------------------------------------------------------- */

function makeEvent(doc, type, props) {
    const ev = Object.assign({
        type, bubbles: !/^(focus|blur|mouseenter|mouseleave|load|scroll)$/.test(type), cancelable: true,
        defaultPrevented: false, target: null, currentTarget: null, relatedTarget: null,
        key: undefined, keyCode: 0, which: 0, code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
        button: 0, buttons: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, detail: 1, timeStamp: Date.now(),
        _stop: false, _stopNow: false, isTrusted: true
    }, props || {});
    ev.preventDefault = function () { if (ev.cancelable) { ev.defaultPrevented = true; ev.returnValue = false; } };
    ev.stopPropagation = function () { ev._stop = true; ev.cancelBubble = true; };
    ev.stopImmediatePropagation = function () { ev._stop = true; ev._stopNow = true; };
    ev.composedPath = () => ev._path || [];
    ev.getModifierState = () => false;
    return ev;
}
function eventPath(target) {
    const p = [];
    for (let n = target; n; n = n.parentNode) p.push(n);
    const doc = target.ownerDocument;
    if (p[p.length - 1] === doc && doc.__win) p.push(doc.__win);
    return p;
}
function invoke(node, ev, phase) {
    if (ev._stop) return;
    const ls = (node._ls || []).filter(l => l.type === ev.type && (phase === 'target' || (phase === 'capture' ? l.capture : !l.capture)));
    for (const l of ls) {
        if (ev._stopNow) break;
        ev.currentTarget = node;
        try {
            if (typeof l.fn === 'function') l.fn.call(node, ev); else if (l.fn && l.fn.handleEvent) l.fn.handleEvent(ev);
        } catch (e) {
            (node.ownerDocument || node.__doc).__errors.push(e);
        }
        if (l.once) node.removeEventListener(l.type, l.fn, l.capture);
    }
}
function dispatch(target, ev) {
    ev.target = target;
    const path = eventPath(target);
    ev._path = path;
    for (let i = path.length - 1; i > 0; i--) invoke(path[i], ev, 'capture');
    invoke(target, ev, 'target');
    if (ev.bubbles) for (let i = 1; i < path.length; i++) invoke(path[i], ev, 'bubble');
    ev.currentTarget = null;
    return !ev.defaultPrevented;
}

/* ------------------------------------------------------------------------ */
/* Small jQuery                                                              */

function makeJQ(env) {
    const {doc, win, winTarget} = env;
    const fn = {};
    const unknown = new Set();

    function toNode(x) { return x === win ? winTarget : x; }
    function resolve(sel, context) {
        if (sel == null || sel === '' || sel === false) return [];
        if (sel.__jq) return sel.__els.slice();
        if (typeof sel === 'function') { sel(); return [doc]; }
        if (sel === win || sel === winTarget) return [winTarget];
        if (sel.nodeType) return [sel];
        if (typeof sel === 'string') {
            const s = sel.trim();
            if (s[0] === '<') {
                const nodes = parseHTML(doc, s);
                if (context && typeof context === 'object' && !context.nodeType && !context.__jq) {
                    nodes.forEach(n => { if (n.nodeType === 1) wrap([n]).attr(context); });
                }
                return nodes;
            }
            const roots = context ? resolve(context) : [doc];
            const out = [];
            roots.forEach(r => { if (r.nodeType === 1 || r.nodeType === 9 || r.nodeType === 11) queryAll(r, s).forEach(n => { if (out.indexOf(n) < 0) out.push(n); }); });
            return out;
        }
        if (Array.isArray(sel) || (typeof sel === 'object' && typeof sel.length === 'number')) return Array.from(sel).filter(Boolean).map(toNode);
        return [sel];
    }
    function nodesOf(arg) {
        if (arg == null) return [];
        if (typeof arg === 'string') return arg.indexOf('<') >= 0 ? parseHTML(doc, arg) : [doc.createTextNode(decode(arg))];
        if (typeof arg === 'number') return [doc.createTextNode(String(arg))];
        if (arg.__jq) return arg.__els.slice();
        if (arg.nodeType) return [arg];
        if (Array.isArray(arg)) return arg.flatMap(nodesOf);
        return [];
    }
    function dataOf(el) { if (!el.__data) el.__data = new Map(); return el.__data; }
    function evStore(el) { if (!el.__jqev) el.__jqev = {}; return el.__jqev; }
    const MAP = {mouseenter: 'mouseover', mouseleave: 'mouseout', focus: 'focusin', blur: 'focusout'};

    function jqDispatcher(el, natType) {
        return function (nat) {
            const store = evStore(el)[natType] || [];
            if (!store.length) return;
            const make = (cur, h) => {
                const e = Object.create(nat);
                Object.assign(e, {
                    originalEvent: nat, type: h.type, target: nat.target, currentTarget: cur, delegateTarget: el,
                    relatedTarget: nat.relatedTarget, data: h.data, key: nat.key, keyCode: nat.keyCode, which: nat.which || nat.keyCode,
                    ctrlKey: nat.ctrlKey, shiftKey: nat.shiftKey, altKey: nat.altKey, metaKey: nat.metaKey, button: nat.button,
                    pageX: nat.pageX, pageY: nat.pageY, clientX: nat.clientX, clientY: nat.clientY, namespace: h.ns.join('.'),
                    isTrigger: nat.isTrigger
                });
                e.preventDefault = () => { nat.preventDefault(); e.isDefaultPrevented = () => true; };
                e.stopPropagation = () => { nat.stopPropagation(); e.isPropagationStopped = () => true; };
                e.stopImmediatePropagation = () => { nat.stopImmediatePropagation(); e.isImmediatePropagationStopped = () => true; e.isPropagationStopped = () => true; };
                e.isDefaultPrevented = () => !!nat.defaultPrevented;
                e.isPropagationStopped = () => !!nat._stop;
                e.isImmediatePropagationStopped = () => !!nat._stopNow;
                return e;
            };
            const call = (cur, h) => {
                const e = make(cur, h);
                let r;
                try {
                    r = h.handler.apply(cur, [e].concat(nat.__extra || []));
                } catch (err) {
                    doc.__errors.push(err);
                }
                if (r === false) { e.preventDefault(); e.stopPropagation(); }
                if (h.one) off(el, h.type, h.selector, h.handler);
            };
            /* delegated handlers first, from the target up to the element */
            const delegated = store.filter(h => h.selector);
            if (delegated.length && nat.target && nat.target.nodeType) {
                for (let cur = nat.target.nodeType === 3 ? nat.target.parentNode : nat.target; cur && cur !== el; cur = cur.parentNode) {
                    if (nat._stop) break;
                    for (const h of delegated) {
                        if (nat._stopNow) break;
                        if (h.enter && cur.contains && nat.relatedTarget && cur.contains(nat.relatedTarget)) continue;
                        if (matches(cur, h.selector)) call(cur, h);
                    }
                }
            }
            if (nat._stop && delegated.length) return;
            for (const h of store.filter(x => !x.selector)) {
                if (nat._stopNow) break;
                if (h.enter && el.contains && nat.relatedTarget && el.contains(nat.relatedTarget)) continue;
                call(el, h);
            }
        };
    }
    function on(el, types, selector, data, handler, one) {
        String(types).split(/\s+/).filter(Boolean).forEach(full => {
            const [type, ...ns] = full.split('.');
            const nat = MAP[type] || type;
            const store = evStore(el);
            if (!store[nat]) {
                store[nat] = [];
                const d = jqDispatcher(el, nat);
                el.__jqd = el.__jqd || {};
                el.__jqd[nat] = d;
                (el.addEventListener ? el : winTarget).addEventListener.call(el, nat, d, false);
            }
            store[nat].push({type, ns, selector: selector || null, data, handler, one, enter: type === 'mouseenter' || type === 'mouseleave', origin: origin()});
        });
    }
    function off(el, types, selector, handler) {
        const store = evStore(el);
        const list = types ? String(types).split(/\s+/).filter(Boolean) : Object.keys(store);
        list.forEach(full => {
            const [type, ...ns] = full.split('.');
            const nats = type ? [MAP[type] || type] : Object.keys(store);
            nats.forEach(nat => {
                if (!store[nat]) return;
                store[nat] = store[nat].filter(h => {
                    if (type && h.type !== type && (MAP[h.type] || h.type) !== nat) return true;
                    if (ns.length && !ns.every(x => h.ns.indexOf(x) >= 0)) return true;
                    if (selector && selector !== '**' && h.selector !== selector) return true;
                    if (handler && h.handler !== handler) return true;
                    return false;
                });
            });
        });
    }
    function trigger(el, type, extra) {
        let evType = type, props = {};
        if (type && typeof type === 'object') { evType = type.type; props = type; }
        const [t] = String(evType).split('.');
        const nat = MAP[t] || t;
        const target = el === win ? winTarget : el;
        const ev = makeEvent(doc, nat, Object.assign({}, props, {isTrigger: true}));
        ev.bubbles = true;
        ev.__extra = extra == null ? [] : (Array.isArray(extra) ? extra : [extra]);
        if (target === winTarget) { invoke(winTarget, Object.assign(ev, {target: winTarget}), 'target'); return ev; }
        dispatch(target, ev);
        if (t === 'focus' && target.nodeType === 1 && doc.activeElement !== target) doc.activeElement = target;
        return ev;
    }

    function wrap(arr, prev) {
        const inst = Object.create(JQ);
        inst.__jq = true;
        inst.__els = arr.filter((x, i) => x && arr.indexOf(x) === i);
        inst.__prev = prev || null;
        return new Proxy(inst, {
            get(t, p) {
                if (p in t) return t[p];
                if (typeof p === 'string') {
                    if (/^\d+$/.test(p)) return t.__els[+p];
                    if (p === 'length') return t.__els.length;
                    if (fn[p]) return fn[p];
                    if (p === 'then' || p === 'toJSON' || p === 'constructor') return undefined;
                    unknown.add(p);
                    return function () { return this; };
                }
                if (p === Symbol.iterator) return t.__els[Symbol.iterator].bind(t.__els);
                return undefined;
            },
            has(t, p) { return p in t || (typeof p === 'string' && /^\d+$/.test(p) && +p < t.__els.length); }
        });
    }
    const each = (self, f) => { self.__els.forEach((el, i) => f(el, i)); return self; };
    const first = self => self.__els[0];
    const elOnly = arr => arr.filter(n => n && n.nodeType === 1);
    const filterSel = (arr, sel) => !sel ? arr : arr.filter(n => typeof sel === 'function' ? sel.call(n, arr.indexOf(n), n) : matches(n, sel));

    const JQ = {
        get length() { return this.__els.length; },
        jquery: '3.7.1-test',
        toArray() { return this.__els.slice(); },
        get(i) { return i === undefined ? this.__els.slice() : this.__els[i < 0 ? this.__els.length + i : i]; },
        eq(i) { return wrap([this.__els[i < 0 ? this.__els.length + i : i]].filter(Boolean), this); },
        first() { return this.eq(0); },
        last() { return this.eq(-1); },
        each(f) { this.__els.forEach((el, i) => f.call(el, i, el)); return this; },
        map(f) { const out = []; this.__els.forEach((el, i) => { const r = f.call(el, i, el); if (r != null) Array.isArray(r) ? out.push(...r) : out.push(r); }); return wrap(out, this); },
        filter(sel) { return wrap(filterSel(this.__els, sel), this); },
        not(sel) { const keep = typeof sel === 'string' || typeof sel === 'function' ? filterSel(this.__els, sel) : resolve(sel); return wrap(this.__els.filter(n => keep.indexOf(n) < 0), this); },
        is(sel) {
            if (!sel) return false;
            if (typeof sel === 'string') return this.__els.some(n => matches(n, sel));
            if (typeof sel === 'function') return this.__els.some((n, i) => sel.call(n, i, n));
            const others = resolve(sel);
            return this.__els.some(n => others.indexOf(n) >= 0);
        },
        has(sel) { return wrap(this.__els.filter(n => (typeof sel === 'string' ? queryAll(n, sel).length : resolve(sel).some(x => n !== x && n.contains(x)))), this); },
        index(sel) {
            const el = first(this);
            if (sel === undefined) return el && el.parentNode ? el.parentNode.children.indexOf(el) : -1;
            const node = sel && sel.__jq ? sel.__els[0] : sel;
            if (typeof sel === 'string') return resolve(sel).indexOf(el);
            return this.__els.indexOf(node);
        },
        add(sel, ctx) { return wrap(this.__els.concat(resolve(sel, ctx)), this); },
        addBack() { return wrap(this.__els.concat(this.__prev ? this.__prev.__els : []), this); },
        end() { return this.__prev || wrap([]); },
        find(sel) {
            const out = [];
            const res = typeof sel === 'string' ? null : resolve(sel);
            this.__els.forEach(n => {
                if (!n || !n.childNodes) return;
                const found = res ? res.filter(x => x !== n && n.contains(x)) : queryAll(n, sel);
                found.forEach(x => { if (out.indexOf(x) < 0) out.push(x); });
            });
            return wrap(out, this);
        },
        children(sel) { return wrap(filterSel(this.__els.flatMap(n => n.children || []), sel), this); },
        contents() { return wrap(this.__els.flatMap(n => n.childNodes || []), this); },
        parent(sel) { return wrap(filterSel(this.__els.map(n => n.parentNode).filter(n => n && n.nodeType === 1), sel), this); },
        parents(sel) { const out = []; this.__els.forEach(n => { for (let a = n.parentNode; a && a.nodeType === 1; a = a.parentNode) if (out.indexOf(a) < 0) out.push(a); }); return wrap(filterSel(out, sel), this); },
        parentsUntil(stop) { const out = []; this.__els.forEach(n => { for (let a = n.parentNode; a && a.nodeType === 1 && !matches(a, stop); a = a.parentNode) out.push(a); }); return wrap(out, this); },
        closest(sel) {
            const out = [];
            const nodes = typeof sel === 'string' ? null : resolve(sel);
            this.__els.forEach(n => { for (let a = n; a && a.nodeType === 1; a = a.parentNode) if (nodes ? nodes.indexOf(a) >= 0 : matches(a, sel)) { if (out.indexOf(a) < 0) out.push(a); break; } });
            return wrap(out, this);
        },
        siblings(sel) { return wrap(filterSel(this.__els.flatMap(n => n.parentNode ? n.parentNode.children.filter(x => x !== n) : []), sel), this); },
        next(sel) { return wrap(filterSel(this.__els.map(n => n.nextElementSibling).filter(Boolean), sel), this); },
        prev(sel) { return wrap(filterSel(this.__els.map(n => n.previousElementSibling).filter(Boolean), sel), this); },
        nextAll(sel) { const out = []; this.__els.forEach(n => { for (let s = n.nextElementSibling; s; s = s.nextElementSibling) out.push(s); }); return wrap(filterSel(out, sel), this); },
        prevAll(sel) { const out = []; this.__els.forEach(n => { for (let s = n.previousElementSibling; s; s = s.previousElementSibling) out.push(s); }); return wrap(filterSel(out, sel), this); },
        offsetParent() { return this.parent(); },

        append(...args) {
            this.__els.forEach((el, i) => args.forEach(a => {
                const src = typeof a === 'function' ? a.call(el, i, el.innerHTML) : a;
                nodesOf(src).forEach(n => el.appendChild(i === 0 || !n.cloneNode ? n : n.cloneNode(true)));
            }));
            return this;
        },
        prepend(...args) {
            this.__els.forEach((el, i) => {
                const firstChild = el.firstChild;
                args.forEach(a => nodesOf(a).forEach(n => el.insertBefore(i === 0 ? n : n.cloneNode(true), firstChild)));
            });
            return this;
        },
        appendTo(t) { const target = resolve(typeof t === 'string' && t.trim()[0] !== '<' ? t : t)[0]; if (target) this.__els.forEach(n => target.appendChild(n)); return this; },
        prependTo(t) { const target = resolve(t)[0]; if (target) { const f = target.firstChild; this.__els.forEach(n => target.insertBefore(n, f)); } return this; },
        before(...args) { this.__els.forEach(el => { if (el.parentNode) args.forEach(a => nodesOf(a).forEach(n => el.parentNode.insertBefore(n, el))); }); return this; },
        after(...args) { this.__els.forEach(el => { if (el.parentNode) { let ref = el.nextSibling; args.forEach(a => nodesOf(a).forEach(n => el.parentNode.insertBefore(n, ref))); } }); return this; },
        insertBefore(t) { const target = resolve(t)[0]; if (target && target.parentNode) this.__els.forEach(n => target.parentNode.insertBefore(n, target)); return this; },
        insertAfter(t) { const target = resolve(t)[0]; if (target && target.parentNode) { const ref = target.nextSibling; this.__els.forEach(n => target.parentNode.insertBefore(n, ref)); } return this; },
        replaceWith(x) { this.__els.forEach(el => { if (el.parentNode) { nodesOf(x).forEach(n => el.parentNode.insertBefore(n, el)); el.parentNode.removeChild(el); } }); return this; },
        wrap(w) { this.__els.forEach(el => { const box = nodesOf(w)[0].cloneNode(true); if (el.parentNode) el.parentNode.insertBefore(box, el); box.appendChild(el); }); return this; },
        wrapInner(w) { this.__els.forEach(el => { const box = nodesOf(w)[0].cloneNode(true); el.childNodes.slice().forEach(c => box.appendChild(c)); el.appendChild(box); }); return this; },
        remove(sel) { filterSel(this.__els, sel).forEach(n => { if (n.parentNode) n.parentNode.removeChild(n); }); return this; },
        detach() { this.__els.forEach(n => { if (n.parentNode) n.parentNode.removeChild(n); }); return this; },
        empty() { this.__els.forEach(n => { if (n.childNodes) { n.childNodes.forEach(c => { c.parentNode = null; }); n.childNodes = []; } }); return this; },
        clone() { return wrap(this.__els.map(n => n.cloneNode(true)), this); },
        html(v) {
            if (v === undefined) { const el = first(this); return el && el.nodeType === 1 ? el.innerHTML : undefined; }
            this.__els.forEach((el, i) => { if (el.nodeType !== 1) return; const src = typeof v === 'function' ? v.call(el, i, el.innerHTML) : v; if (src && src.__jq) { el.innerHTML = ''; src.__els.forEach(n => el.appendChild(n)); } else if (src && src.nodeType) { el.innerHTML = ''; el.appendChild(src); } else el.innerHTML = src == null ? '' : String(src); });
            return this;
        },
        text(v) {
            if (v === undefined) return this.__els.map(n => n.textContent || '').join('');
            this.__els.forEach((el, i) => { el.textContent = typeof v === 'function' ? v.call(el, i, el.textContent) : v; });
            return this;
        },
        val(v) {
            if (v === undefined) { const el = first(this); return el ? el.value : undefined; }
            this.__els.forEach(el => { el.value = v; });
            return this;
        },
        attr(name, value) {
            if (name && typeof name === 'object') { Object.keys(name).forEach(k => this.attr(k, name[k])); return this; }
            if (value === undefined) { const el = first(this); if (!el || el.nodeType !== 1) return undefined; const r = el.getAttribute(name); return r === null ? undefined : r; }
            this.__els.forEach((el, i) => {
                if (el.nodeType !== 1) return;
                const v = typeof value === 'function' ? value.call(el, i, el.getAttribute(name)) : value;
                if (v === null || v === false && /^(disabled|checked|hidden|readonly|selected)$/.test(name)) el.removeAttribute(name);
                else el.setAttribute(name, v === true ? name : v);
            });
            return this;
        },
        removeAttr(name) { this.__els.forEach(el => String(name).split(/\s+/).forEach(n => el.removeAttribute && el.removeAttribute(n))); return this; },
        prop(name, value) {
            if (name && typeof name === 'object') { Object.keys(name).forEach(k => this.prop(k, name[k])); return this; }
            if (value === undefined) { const el = first(this); return el ? el[name] : undefined; }
            this.__els.forEach(el => { el[name] = value; });
            return this;
        },
        removeProp(name) { this.__els.forEach(el => { delete el[name]; }); return this; },
        data(key, value) {
            const el = first(this);
            if (key === undefined) {
                if (!el) return undefined;
                const out = {};
                if (el.attrs) el.attrs.forEach((v, k) => { if (k.startsWith('data-')) out[camel(k.slice(5))] = v; });
                dataOf(el).forEach((v, k) => { out[k] = v; });
                return out;
            }
            if (typeof key === 'object') { this.__els.forEach(n => Object.keys(key).forEach(k => dataOf(n).set(k, key[k]))); return this; }
            if (value === undefined) {
                if (!el) return undefined;
                const d = dataOf(el);
                if (d.has(key)) return d.get(key);
                const a = el.getAttribute && el.getAttribute('data-' + kebab(key));
                if (a === null || a === undefined) return undefined;
                if (a === 'true') return true;
                if (a === 'false') return false;
                if (a !== '' && !isNaN(+a)) return +a;
                return a;
            }
            this.__els.forEach(n => dataOf(n).set(key, value));
            return this;
        },
        removeData(key) { this.__els.forEach(n => { if (key) dataOf(n).delete(key); else dataOf(n).clear(); }); return this; },
        css(name, value) {
            if (name && typeof name === 'object' && !Array.isArray(name)) { Object.keys(name).forEach(k => this.css(k, name[k])); return this; }
            if (Array.isArray(name)) { const out = {}; name.forEach(n => { out[n] = this.css(n); }); return out; }
            if (value === undefined) {
                const el = first(this);
                if (!el || !el.style) return undefined;
                const v = el.style[camel(name)];
                if (v !== undefined && v !== '') return v;
                if (name === 'display') return isVisibleNode(el) || el.style.display !== 'none' ? 'block' : 'none';
                return '';
            }
            this.__els.forEach((el, i) => {
                if (!el.style) return;
                let v = typeof value === 'function' ? value.call(el, i, el.style[camel(name)]) : value;
                if (typeof v === 'number' && !/^(opacity|z-?index|flex|font-?weight|line-?height|order|zoom)$/i.test(name)) v = v + 'px';
                el.style[camel(name)] = v == null ? '' : String(v);
            });
            return this;
        },
        show() { this.__els.forEach(el => { if (el.style) el.style.display = ''; }); return this; },
        hide() { this.__els.forEach(el => { if (el.style) el.style.display = 'none'; }); return this; },
        toggle(state) {
            this.__els.forEach(el => {
                if (!el.style) return;
                const vis = state === undefined || typeof state !== 'boolean' ? el.style.display === 'none' : state;
                el.style.display = vis ? '' : 'none';
            });
            return this;
        },
        fadeIn() { return this.show(); },
        fadeOut() { return this.hide(); },
        slideDown() { return this.show(); },
        slideUp() { return this.hide(); },
        animate() { return this; },
        stop() { return this; },
        addClass(c) { this.__els.forEach((el, i) => { if (!el.classList) return; const v = typeof c === 'function' ? c.call(el, i, el.className) : c; String(v || '').split(/\s+/).filter(Boolean).forEach(x => el.classList.add(x)); }); return this; },
        removeClass(c) {
            this.__els.forEach((el, i) => {
                if (!el.classList) return;
                if (c === undefined) { el.setAttribute('class', ''); return; }
                const v = typeof c === 'function' ? c.call(el, i, el.className) : c;
                String(v || '').split(/\s+/).filter(Boolean).forEach(x => el.classList.remove(x));
            });
            return this;
        },
        toggleClass(c, state) {
            this.__els.forEach(el => { if (!el.classList) return; String(c || '').split(/\s+/).filter(Boolean).forEach(x => el.classList.toggle(x, typeof state === 'boolean' ? state : undefined)); });
            return this;
        },
        hasClass(c) { return this.__els.some(el => el.classList && el.classList.contains(c)); },
        on(types, selector, data, handler) {
            if (types && typeof types === 'object') { Object.keys(types).forEach(k => this.on(k, selector, data, types[k])); return this; }
            if (handler === undefined) {
                if (data === undefined) { handler = selector; selector = null; data = undefined; }
                else if (typeof selector === 'string') { handler = data; data = undefined; }
                else { handler = data; data = selector; selector = null; }
            }
            if (handler === false) handler = () => false;
            if (typeof handler !== 'function') return this;
            this.__els.forEach(el => on(el === win ? winTarget : el, types, selector, data, handler, false));
            return this;
        },
        one(types, selector, data, handler) {
            if (handler === undefined) {
                if (data === undefined) { handler = selector; selector = null; }
                else if (typeof selector === 'string') { handler = data; data = undefined; }
                else { handler = data; data = selector; selector = null; }
            }
            this.__els.forEach(el => on(el === win ? winTarget : el, types, selector, data, handler, true));
            return this;
        },
        off(types, selector, handler) {
            if (typeof selector === 'function') { handler = selector; selector = null; }
            this.__els.forEach(el => off(el === win ? winTarget : el, types, selector, handler));
            return this;
        },
        bind(t, d, h) { return this.on(t, null, d, h); },
        unbind(t, h) { return this.off(t, h); },
        trigger(type, extra) { this.__els.forEach(el => trigger(el, type, extra)); return this; },
        triggerHandler(type, extra) { const el = first(this); if (el) trigger(el, type, extra); return undefined; },
        hover(fin, fout) { return this.on('mouseenter', fin).on('mouseleave', fout || fin); },
        focus(h) { if (h) return this.on('focus', h); const el = first(this); if (el && el.focus) el.focus(); return this; },
        blur(h) { if (h) return this.on('blur', h); const el = first(this); if (el && el.blur) el.blur(); return this; },
        click(h) { return h ? this.on('click', h) : this.trigger('click'); },
        width(v) { if (v !== undefined) return this.css('width', v); const el = first(this); return el === winTarget ? 1440 : el === doc ? 1440 : (el ? el.__w || 0 : 0); },
        height(v) { if (v !== undefined) return this.css('height', v); const el = first(this); return el === winTarget ? 900 : el === doc ? 900 : (el ? el.__h || 0 : 0); },
        outerWidth() { return this.width(); },
        outerHeight() { return this.height(); },
        innerWidth() { return this.width(); },
        innerHeight() { return this.height(); },
        offset() { return {top: 0, left: 0}; },
        position() { return {top: 0, left: 0}; },
        scrollTop(v) { if (v === undefined) { const el = first(this); return el && el.scrollTop || 0; } this.__els.forEach(el => { el.scrollTop = v; }); return this; },
        scrollLeft(v) { if (v === undefined) return 0; return this; },
        serialize() { return ''; },
        promise() { return Promise.resolve(this); },
        ready(f) { f && f(); return this; }
    };
    ['mousedown', 'mouseup', 'mouseover', 'mouseout', 'mousemove', 'keydown', 'keyup', 'keypress', 'change', 'input', 'submit', 'scroll', 'resize', 'dblclick', 'contextmenu', 'focusin', 'focusout', 'mouseenter', 'mouseleave']
        .forEach(t => { JQ[t] = function (h) { return h ? this.on(t, h) : this.trigger(t); }; });

    function $(sel, ctx) { return wrap(resolve(sel, ctx)); }
    $.fn = fn;
    $.unknownMethods = unknown;
    $.extend = function (...args) {
        let deep = false;
        if (typeof args[0] === 'boolean') deep = args.shift();
        const target = args.shift() || {};
        args.forEach(src => {
            if (!src) return;
            Object.keys(src).forEach(k => {
                const v = src[k];
                if (deep && v && typeof v === 'object' && !Array.isArray(v) && !v.nodeType) target[k] = $.extend(true, target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
                else if (v !== undefined) target[k] = v;
            });
        });
        return target;
    };
    $.each = (obj, f) => {
        if (Array.isArray(obj) || (obj && typeof obj.length === 'number')) { for (let i = 0; i < obj.length; i++) if (f.call(obj[i], i, obj[i]) === false) break; }
        else if (obj) for (const k of Object.keys(obj)) if (f.call(obj[k], k, obj[k]) === false) break;
        return obj;
    };
    $.map = (arr, f) => { const out = []; $.each(arr, (i, v) => { const r = f(v, i); if (r != null) Array.isArray(r) ? out.push(...r) : out.push(r); }); return out; };
    $.grep = (arr, f, inv) => Array.from(arr).filter((v, i) => !!f(v, i) !== !!inv);
    $.inArray = (v, arr) => arr ? Array.from(arr).indexOf(v) : -1;
    $.isArray = Array.isArray;
    $.isFunction = f => typeof f === 'function';
    $.isPlainObject = o => !!o && Object.prototype.toString.call(o) === '[object Object]';
    $.isEmptyObject = o => !o || Object.keys(o).length === 0;
    $.isNumeric = v => !isNaN(parseFloat(v)) && isFinite(v);
    $.isWindow = o => o === win;
    $.type = o => o === null ? 'null' : Array.isArray(o) ? 'array' : typeof o;
    $.trim = s => String(s == null ? '' : s).trim();
    $.noop = () => {};
    $.now = () => Date.now();
    $.proxy = (f, c) => typeof f === 'function' ? f.bind(c) : c[f].bind(c);
    $.contains = (a, b) => a !== b && !!a && a.contains && a.contains(b);
    $.parseHTML = s => parseHTML(doc, s);
    $.data = (el, k, v) => v === undefined ? $(el).data(k) : ($(el).data(k, v), v);
    $.removeData = (el, k) => $(el).removeData(k);
    $.Event = (type, props) => Object.assign(makeEvent(doc, type), props || {});
    $.Deferred = function () {
        let res, rej;
        const p = new Promise((a, b) => { res = a; rej = b; });
        const d = {resolve: v => { res(v); return d; }, reject: v => { rej(v); return d; }, promise: () => d,
            done: f => { p.then(f); return d; }, fail: f => { p.catch(f); return d; }, always: f => { p.then(f, f); return d; }, then: (a, b) => p.then(a, b)};
        p.catch(() => {});
        return d;
    };
    $.when = (...a) => $.Deferred().resolve(...a);
    $.ajax = () => $.Deferred();
    $.get = $.ajax;
    $.getJSON = $.ajax;
    $.browser = {};
    $.support = {};
    $.expr = {pseudos: {}, ':': {}};
    $.event = {special: {}, fix: e => e};
    $.cssHooks = {};
    $.easing = {};
    $.fx = {off: true};
    return $;
}

/* ------------------------------------------------------------------------ */
/* Backbone-like events for stubs; activation log for stock controls          */

function addEvents(obj, world, label) {
    const ls = {};
    obj.on = function (name, fn, ctx) {
        if (name && typeof name === 'object') { Object.keys(name).forEach(k => obj.on(k, name[k], fn)); return obj; }
        String(name).split(/\s+/).forEach(n => { (ls[n] = ls[n] || []).push({fn, ctx}); });
        return obj;
    };
    obj.once = function (name, fn, ctx) {
        const w = function () { obj.off(name, w); return fn.apply(this, arguments); };
        return obj.on(name, w, ctx);
    };
    obj.off = function (name, fn) {
        if (!name) { Object.keys(ls).forEach(k => delete ls[k]); return obj; }
        String(name).split(/\s+/).forEach(n => { if (ls[n]) ls[n] = fn ? ls[n].filter(h => h.fn !== fn) : []; });
        return obj;
    };
    obj.listeners = n => (ls[n] || []).length;
    obj.trigger = function (name, ...args) {
        const outer = world.__triggerDepth === 0;
        if (outer && ACTIVATING.has(name)) world.activations.push({target: obj, label, event: name, args, origin: origin()});
        world.__triggerDepth++;
        try {
            (ls[name] || []).slice().forEach(h => h.fn.apply(h.ctx || obj, args));
            (ls.all || []).slice().forEach(h => h.fn.apply(h.ctx || obj, [name].concat(args)));
        } finally {
            world.__triggerDepth--;
        }
        return obj;
    };
    obj.fireEvent = function (name, args) { return obj.trigger.apply(obj, [name].concat(args || [])); };
    obj.listenTo = function (other, name, fn) { if (other && other.on) other.on(name, fn, obj); return obj; };
    obj.stopListening = function () { return obj; };
    return obj;
}
const ACTIVATING = new Set(['click', 'toggle', 'change', 'changed', 'item:click', 'item:custom-click', 'select', 'item:select', 'combo:blur', 'changed:after', 'selected']);

/* The flag of a plugin menu item: only Common.UI.MenuItemCustom has it (MenuItemCustom.initialize),
   Common.UI.Menu tells 'item:custom-click' from 'item:click' by it. No stand-in answers it. */
const PLUGIN_FLAG = 'isCustomItem';

/* "anything": answers every property and call, so unrelated stock surfaces never throw. */
function anything(label) {
    const cache = {};
    const target = function () {};
    return new Proxy(target, {
        get(t, p) {
            if (p === Symbol.toPrimitive) return hint => (hint === 'number' ? 0 : '');
            if (p === Symbol.iterator) return function* () {};
            if (typeof p === 'symbol') return undefined;
            if (p === 'then' || p === 'toJSON' || p === 'nodeType' || p === '__jq') return undefined;
            if (p === 'length') return 0;
            if (p === 'toString' || p === 'valueOf') return () => '';
            if (p === '__anything') return true;
            if (p === PLUGIN_FLAG && !(p in cache)) return undefined;
            if (!(p in cache)) cache[p] = anything(label + '.' + p);
            return cache[p];
        },
        set(t, p, v) { cache[p] = v; return true; },
        apply() { return anything(label + '()'); },
        construct() { return anything('new ' + label); },
        has() { return true; }
    });
}
/* An object with known members; any other member is "anything". Calls of methods are recorded.
   absent — names the object does not have unless it holds them itself; only — when given, the
   names the stock object has: any other name is absent. */
function permissive(obj, label, world, absent, only) {
    return new Proxy(obj, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p === 'symbol' || p === 'then' || p === 'toJSON' || p === 'nodeType' || p === '__jq' || p === PLUGIN_FLAG) return undefined;
            if ((absent && absent.has(p)) || (only && !only.has(p))) return undefined;
            const a = anything(label + '.' + String(p));
            const rec = function (...args) { if (world) world.calls.push({target: label, name: String(p), args, origin: origin()}); return a.apply(this, args); };
            t[p] = new Proxy(rec, {get: (r, q) => (q in r ? r[q] : a[q]), set: (r, q, v) => { a[q] = v; return true; }});
            return t[p];
        }
    });
}

/* ------------------------------------------------------------------------ */
/* Stock locale and stock source                                             */

let RU = null;
function ru() {
    if (!RU) RU = JSON.parse(fs.readFileSync(LOCALE_RU, 'utf8'));
    return RU;
}
function ruText(key) {
    const v = ru()[key];
    if (v === undefined) throw new Error('stock locale has no ' + key);
    return v;
}
function stockSource(rel) {
    return fs.readFileSync(path.join(PE_APP, rel), 'utf8');
}
/* Body of a method `name: function (...) {...}` of a stock controller or view, compiled in the world. */
function methodText(src, name, rel) {
    const re = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\s*:\\s*function\\s*\\(');
    const m = re.exec(src);
    if (!m) throw new Error('stock ' + rel + ' has no method ' + name);
    const start = src.indexOf('function', m.index);
    let i = src.indexOf('{', start), depth = 0, q = null;
    for (; i < src.length; i++) {
        const c = src[i], n = src[i + 1];
        if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
        if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
        if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; continue; }
        if (c === '"' || c === "'" || c === '`') { q = c; continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1);
}
function stockMethod(world, rel, name) {
    const text = methodText(stockSource(rel), name, rel);
    return vm.runInContext('(' + text + ')', world.ctx, {filename: 'stock:' + rel + '#' + name});
}

/* ------------------------------------------------------------------------ */
/* Stock controls ("twins")                                                  */

/* A method of a stock control class (Common.UI.Menu, Common.UI.MenuItem) for its twin, verbatim.
   It is part of the twin, like the twin's own methods: an activation it makes is attributed to the
   code that called the twin, so it is compiled under this directory (originOf skips it). */
const COMMON_LIB = path.join(ROOT, 'apps/common/main/lib/component');
function commonMethod(world, file, name) {
    const text = methodText(fs.readFileSync(path.join(COMMON_LIB, file), 'utf8'), name, file);
    return vm.runInContext('(' + text + ')', world.ctx, {filename: path.join(TEST_DIR, 'twin:' + file + '#' + name)});
}

/* Members of the stock Common.UI.MenuItem: its own methods and fields (Common.UI.MenuItemCustom
   and its isCustomItem excluded), Common.UI.BaseView, Backbone.View and Backbone.Events. A menu
   item twin answers only these names; any other name is absent, as on the stock item. */
let MENU_ITEM_MEMBERS = null;
function menuItemMembers() {
    if (MENU_ITEM_MEMBERS) return MENU_ITEM_MEMBERS;
    const slice = (file, from, to) => {
        const src = fs.readFileSync(file, 'utf8');
        const a = src.indexOf(from), b = src.indexOf(to, a + 1);
        if (a < 0 || b < 0) throw new Error('stock ' + path.relative(ROOT, file) + ' has no ' + from);
        return src.slice(a, b);
    };
    const names = new Set();
    const collect = (text, top) => {
        for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*function\b/g)) names.add(m[1]);
        for (const m of text.matchAll(/\b(?:this|me)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) names.add(m[1]);
        for (const m of text.matchAll(top)) names.add(m[1]);
    };
    collect(slice(path.join(COMMON_LIB, 'MenuItem.js'), 'Common.UI.MenuItem = ', 'Common.UI.MenuItemSeparator'), /^ {8}([A-Za-z_$][\w$]*)\s*:/gm);
    collect(slice(path.join(COMMON_LIB, 'BaseView.js'), 'BaseView: Backbone.View.extend', 'getId:'), /^ {12}([A-Za-z_$][\w$]*)\s*:/gm);
    const bb = fs.readFileSync(path.join(ROOT, 'vendor/backbone/backbone.js'), 'utf8');
    for (const m of bb.matchAll(/\bEvents\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
    collect(slice(path.join(ROOT, 'vendor/backbone/backbone.js'), '_.extend(View.prototype, Events, {', '\n  });'), /^ {4}([A-Za-z_$][\w$]*)\s*:/gm);
    ['cid', 'el', '$el', 'options', 'model', 'collection', 'id', 'attributes', 'className', 'tagName', 'events'].forEach(n => names.add(n));
    names.delete(PLUGIN_FLAG);
    MENU_ITEM_MEMBERS = names;
    return names;
}

/* onItemClick only Common.UI.Menu and Common.UI.MenuItem have: a twin of a button or another
   control does not answer it (a menu item twin has the stock one). */
const NOT_INVENTED = new Set(['onItemClick']);

function makeMenu(world, label, items) {
    const menu = addEvents({__stock: true, label, options: {}, rendered: true, visible: false}, world, label);
    menu.items = [];
    /* stock Menu.onItemClick: 'item:custom-click' for a plugin item, 'item:click' for the others */
    menu.onItemClick = commonMethod(world, 'Menu.js', 'onItemClick');
    menu.addItem = function (it) {
        const item = it && it.__stock ? it : makeTwin(world, label + '[' + menu.items.length + ']', it || {}, 'item');
        item.menu && (item.parentMenu = menu);
        /* stock Menu.addItem: item.on('click', _.bind(me.onItemClick, me)) */
        item.on('click', (i, e) => proxy.onItemClick(item, e));
        menu.items.push(item);
        return item;
    };
    menu.getItems = () => menu.items;
    menu.getItem = v => menu.items.find(i => i.value === v);
    menu.isVisible = () => menu.visible;
    menu.show = () => { menu.trigger('show:before', menu); menu.visible = true; menu.trigger('show:after', menu); };
    menu.hide = () => { menu.visible = false; menu.trigger('hide:after', menu); };
    menu.removeAll = () => { menu.items = []; };
    menu.setInnerMenu = () => {};
    menu.render = () => menu;
    const proxy = permissive(menu, label, world, NOT_INVENTED);
    (items || []).forEach(it => menu.addItem(it));
    return proxy;
}

let TWIN_ID = 0;
/* A stock control. kind 'item' — a Common.UI.MenuItem made by a menu from its options: the members
   of the stock item only (no click(), getValue() or pressed of a button), menu null without a
   submenu (MenuItem.initialize: options.menu || null), the stock onItemClick and toggle. */
function makeTwin(world, label, o, kind) {
    o = o || {};
    const item = kind === 'item';
    const t = addEvents({__stock: true, __twin: label, label}, world, label);
    t.disabled = !!o.disabled;
    t.visible = o.visible !== false;
    if (!item) t.pressed = !!o.pressed;
    t.checked = !!o.checked;
    t.caption = o.caption;
    t.value = o.value;
    t.options = Object.assign({caption: o.caption, value: o.value}, o.options || {}, item ? o : {});
    t.isSeparator = o.caption === '--';
    if (item) {
        t.id = o.id || 'asc-gen' + (++TWIN_ID);
        ['cls', 'style', 'checkable', 'allowDepress', 'toggleGroup', 'iconCls', 'iconImg', 'hint', 'header'].forEach(k => { t[k] = o[k]; });
    }
    const el = world.doc.createElement('div');
    t.cmpEl = world.$(el);
    t.$el = t.cmpEl;
    t.el = el;
    t.isDisabled = () => t.disabled;
    t.rendered = true;
    t.setDisabled = v => {
        v = !!v;
        if (t.disabled === v) return;
        t.disabled = v;
        el.classList.toggle('disabled', v);
        if (v) el.setAttribute('disabled', 'disabled'); else el.removeAttribute('disabled');
        t.trigger('disabled', t, v);
    };
    t.isVisible = () => t.visible;
    /* stock Button.setVisible: class "hidden" on the component and the flag */
    t.setVisible = v => { t.visible = !!v; el.classList.toggle('hidden', !t.visible); el.style.display = t.visible ? '' : 'none'; };
    t.isChecked = () => t.checked;
    t.setCaption = c => { t.caption = c; t.options.caption = c; };
    t.updateHint = h => { t.hint = h; };
    t.setMenu = m => { t.menu = m; };
    t.render = () => t;
    world.twins.push(t);
    if (item) {
        /* stock MenuItem.toggle: only a checkable item changes its mark; setChecked is toggle */
        let self = t;
        t.toggle = (state, silent) => {
            state = state === undefined ? !t.checked : !!state;
            if (!t.checkable) return;
            t.checked = state;
            el.classList.toggle('checked', state);
            if (!silent) t.trigger('toggle', self, state);
        };
        t.setChecked = (v, silent) => t.toggle(v, silent);
        t.menu = o.menu || null;
        const proxy = self = permissive(t, label, world, null, menuItemMembers());
        t.onItemClick = commonMethod(world, 'MenuItem.js', 'onItemClick').bind(proxy);
        return proxy;
    }
    t.isActive = () => t.pressed;
    t.toggle = (state, silent) => { t.pressed = state === undefined ? !t.pressed : !!state; if (!silent) t.trigger('toggle', t, t.pressed); };
    t.setChecked = (v, silent) => { t.checked = !!v; if (!silent) t.trigger('toggle', t, t.checked); };
    t.getValue = () => (t.value !== undefined ? t.value : t.checked);
    t.setValue = (v, silent) => { const old = t.value; t.value = v; t.checked = !!v; if (!silent) t.trigger('change', t, v, old); };
    t.click = opts => { if (t.disabled) return; t.trigger('click', t, opts); };
    if (o.menu) t.menu = o.menu;
    else t.menu = makeMenu(world, label + '.menu', []);
    t.changeIcon = () => {};
    return permissive(t, label, world, NOT_INVENTED);
}

const TWIN_NAME = /^(btn|btns|mi|mnu|menu|ch|chk|cmb|cmbs|list|num|spn|lbl|label|txtBtn|item|radio|rb|input|mnuItem)[A-Z0-9_]/;

/* How the stock view creates its member: `me.<member> = new Common.UI.MenuItem({...})` in the view
   source (view/<Name>*.js; ReviewChanges in common). A menu item gets a submenu only when its
   options name one (menu: ...). null — not a menu item created there. */
const STOCK_ITEMS = new Map();
function stockMenuItem(viewName, member) {
    const key = viewName + ':' + member;
    if (STOCK_ITEMS.has(key)) return STOCK_ITEMS.get(key);
    const files = viewName === 'ReviewChanges'
        ? [path.join(ROOT, 'apps/common/main/lib/view/ReviewChanges.js')]
        : fs.readdirSync(path.join(PE_APP, 'view')).filter(f => f.endsWith('.js') && f.startsWith(viewName)).map(f => path.join(PE_APP, 'view', f));
    const re = new RegExp('\\b(?:me|this)\\.' + member + '\\s*=\\s*new\\s+Common\\.UI\\.(\\w+)\\s*\\(');
    let found = null;
    for (const file of files) {
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, 'utf8');
        const m = re.exec(src);
        if (!m) continue;
        if (m[1] !== 'MenuItem') break;
        let depth = 0, q = null, submenu = false;
        for (let i = m.index + m[0].length - 1; i < src.length; i++) {
            const c = src[i], n = src[i + 1];
            if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
            if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
            if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; continue; }
            if (c === '"' || c === "'" || c === '`') { q = c; continue; }
            if (c === '(' || c === '{' || c === '[') depth++;
            else if (c === ')' || c === '}' || c === ']') { if (--depth === 0) break; }
            else if (depth === 2 && /^menu\s*:/.test(src.slice(i, i + 64)) && !/[\w$.]/.test(src[i - 1])) submenu = true;
        }
        found = {submenu};
        break;
    }
    STOCK_ITEMS.set(key, found);
    return found;
}

/* A stock view or controller: known members, stock locale strings, twins on demand
   (absent ones stay undefined, as when the stock code did not create them), anything else permissive. */
function stockObject(world, name, opt) {
    opt = opt || {};
    const base = addEvents(Object.assign({__stock: true, label: name}, opt.members || {}), world, name);
    const loc = opt.locale ? world.localeOf(opt.locale) : {};
    const absent = opt.absent || (() => false);
    return new Proxy(base, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p === 'symbol' || p === 'then' || p === 'toJSON' || p === 'nodeType' || p === '__jq') return undefined;
            if (p in loc) return loc[p];
            if (p === 'getApi') return () => world.api;
            if (p === PLUGIN_FLAG) return undefined;
            if (TWIN_NAME.test(p)) {
                if (absent(p)) return undefined;
                const mi = !/^(btns|cmbs)[A-Z]/.test(p) && stockMenuItem(name, p);
                t[p] = /^(btns|cmbs)[A-Z]/.test(p) ? [makeTwin(world, name + ':' + p + '[0]')]
                    : mi ? makeTwin(world, name + ':' + p, mi.submenu ? {menu: makeMenu(world, name + ':' + p + '.menu', [])} : {}, 'item')
                    : makeTwin(world, name + ':' + p);
                return t[p];
            }
            const a = anything(name + '.' + p);
            t[p] = new Proxy(function (...args) { world.calls.push({target: name, name: String(p), args, origin: origin()}); return a.apply(this, args); },
                {get: (r, q) => (q in r ? r[q] : a[q])});
            return t[p];
        },
        has(t, p) { return p in t || (typeof p === 'string' && (p in loc || (TWIN_NAME.test(p) && !absent(p)))); }
    });
}

/* ------------------------------------------------------------------------ */
/* The world                                                                 */

const DEFAULTS = {edit: true, comment: true, viewComments: true, download: true, print: true,
    history: true, sharing: true, rename: true, chat: true, slides: 5, current: 2};

const READER_ABSENT = {
    Toolbar: () => true,
    ViewTab: p => /^(btnNormal|btnSlideMaster|chRulers|btnGuides|btnGridlines|btnMacros|btnRecMacro|btnPauseMacro|btnAnimationPane|chLeftMenu|chRightMenu)$/.test(p),
    Statusbar: p => /^(btnLanguage|btnSpelling|langMenu|btnDocLang)/.test(p),
    ReviewChanges: p => /^(btnCoAuthMode|btnCommentResolve|btnCommentRemove|btnDocLang|btnSpelling|btnAccept|btnReject)/.test(p),
    FileMenu: p => /^(miSave|miProtect|miRename|miEdit)$/.test(p),
    Transitions: () => true,
    Animation: () => true,
    SlideMaster: () => true,
    DocumentHolder: p => !/^(menuView|mnuPreview|mnuSelectAll|mnuPrintSelection|viewModeMenu)/.test(p)
};

function createWorld(options, cliOpts) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const viewDir = (cliOpts && cliOpts.viewDir) || path.join(PE_APP, 'view');
    const world = {opts, calls: [], apiCalls: [], activations: [], twins: [], warnings: [], notices: [], timers: [], __triggerDepth: 0,
        callbacks: {}, shortcuts: {delegated: [], suspended: new Set(), log: []}, loadErrors: {}, dialogs: [], alerts: []};

    const ctx = {};
    vm.createContext(ctx);
    world.ctx = ctx;
    ctx.window = ctx;
    ctx.self = ctx;
    ctx.top = ctx;
    ctx.parent = ctx;

    /* DOM */
    const doc = new FDocument();
    doc.__errors = [];
    const winTarget = new FTarget();
    winTarget.__doc = doc;
    doc.__win = winTarget;
    doc.defaultView = ctx;
    world.doc = doc;
    world.winTarget = winTarget;
    doc.__later = f => { if (f) ctx.setTimeout(f, 0); };
    ctx.document = doc;
    ctx.addEventListener = (t, f, o) => winTarget.addEventListener(t, f, o);
    ctx.removeEventListener = (t, f, o) => winTarget.removeEventListener(t, f, o);
    ctx.dispatchEvent = ev => { invoke(winTarget, Object.assign(ev, {target: winTarget}), 'target'); return true; };
    ctx.getComputedStyle = el => {
        const st = el && el.style ? el.style : {};
        return new Proxy({}, {get: (t, p) => {
            if (p === 'getPropertyValue') return n => { const v = st[camel(n)]; return v == null ? '' : String(v); };
            if (p === 'display') return st.display || (el && isVisibleNode(el) ? 'block' : 'none');
            const v = st[p];
            return v == null ? '' : v;
        }});
    };
    ctx.setTimeout = (f, ms, ...a) => { world.timers.push({f, a, ms: ms || 0, id: world.timers.length + 1}); return world.timers.length; };
    ctx.clearTimeout = id => { const t = world.timers.find(x => x.id === id); if (t) t.cancelled = true; };
    ctx.setInterval = () => 0;
    ctx.clearInterval = () => {};
    ctx.requestAnimationFrame = f => ctx.setTimeout(() => f(Date.now()), 16);
    ctx.cancelAnimationFrame = id => ctx.clearTimeout(id);
    ctx.queueMicrotask = f => ctx.setTimeout(f, 0);
    ctx.Promise = Promise;
    ctx.console = {
        log: () => {}, info: () => {}, debug: () => {},
        warn: (...a) => world.warnings.push(a.map(x => (x && x.stack) ? x.stack.split('\n')[0] : String(x)).join(' ')),
        error: (...a) => world.warnings.push(a.map(x => (x && x.stack) ? x.stack.split('\n')[0] : String(x)).join(' '))
    };
    ctx.navigator = {userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120', platform: 'Linux x86_64', language: 'ru', languages: ['ru'], maxTouchPoints: 0};
    ctx.location = {href: 'http://localhost/', search: '', hash: '', hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', pathname: '/'};
    ctx.devicePixelRatio = 1;
    ctx.innerWidth = 1440;
    ctx.innerHeight = 900;
    ctx.matchMedia = () => ({matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}});
    class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    ctx.MutationObserver = Observer;
    ctx.ResizeObserver = Observer;
    ctx.IntersectionObserver = Observer;
    ctx.Node = {ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9, DOCUMENT_FRAGMENT_NODE: 11};
    ctx.HTMLElement = FElement;
    ctx.Element = FElement;
    ctx.SVGElement = FElement;
    ctx.Event = function (type, init) { return makeEvent(doc, type, init); };
    ctx.CustomEvent = function (type, init) { return makeEvent(doc, type, Object.assign({detail: init && init.detail}, init)); };
    ctx.KeyboardEvent = ctx.Event;
    ctx.MouseEvent = ctx.Event;
    ctx.localStorage = {getItem: () => null, setItem() {}, removeItem() {}};
    ctx.sessionStorage = ctx.localStorage;
    ctx.performance = {now: () => Date.now()};
    ctx.URL = URL;
    ctx.Image = function () { return doc.createElement('img'); };
    ctx.getSelection = () => doc.getSelection();
    ctx.scrollTo = () => {};
    ctx.open = () => null;
    ctx.postMessage = () => {};
    ctx.appHeader = null;

    /* stock page skeleton */
    doc.body.innerHTML =
        '<div id="viewport"><div id="app-title"></div>' +
        '<div id="toolbar" class="layout-item"><div class="toolbar"><div class="box-tabs"></div></div></div>' +
        '<div id="viewport-vbox-layout"><div id="viewport-hbox-layout">' +
        '<div id="left-menu" class="layout-item"><div id="left-panel-comments"></div><div id="left-panel-search"></div><div id="left-panel-chat"></div></div>' +
        '<div id="editor_sdk" class="layout-item"><div id="id_main"><div id="id_panel_thumbnails"></div>' +
        '<div id="id_main_parent"><div id="id_main_view"><canvas id="id_viewer"></canvas></div>' +
        '<div id="id_panel_notes"><div id="id_notes"></div></div></div></div><textarea id="area_id"></textarea></div>' +
        '<div id="right-menu" class="layout-item"></div></div></div>' +
        '<div id="statusbar" class="layout-item"><div id="slot-status-btn-preview"></div></div>' +
        '</div><div id="pe-preview" style="display:none"></div>';

    /* vendor */
    for (const rel of ['vendor/underscore/underscore.js', 'vendor/backbone/backbone.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, {filename: 'vendor:' + rel});
    }
    const $ = makeJQ({doc, win: ctx, winTarget});
    world.$ = $;
    ctx.$ = ctx.jQuery = $;
    if (ctx.Backbone) ctx.Backbone.$ = $;

    /* stock locale, applied the stock way: objects on window before the views load */
    const l10n = ru();
    for (const key of Object.keys(l10n)) {
        const parts = key.split('.');
        if (parts.length < 3) continue;
        let o = ctx;
        for (let i = 0; i < parts.length - 1; i++) {
            if (o[parts[i]] === undefined || o[parts[i]] === null || typeof o[parts[i]] !== 'object' && typeof o[parts[i]] !== 'function') o[parts[i]] = {};
            o = o[parts[i]];
        }
        o[parts[parts.length - 1]] = l10n[key];
    }
    world.localeOf = prefix => {
        const out = {};
        const p = prefix + '.';
        for (const k of Object.keys(l10n)) if (k.startsWith(p) && k.indexOf('.', p.length) < 0) out[k.slice(p.length)] = l10n[k];
        return out;
    };
    /* stock views expose locale strings on their prototypes as well */
    const PE = ctx.PE;
    Object.keys(PE.Views).forEach(k => {
        const v = PE.Views[k];
        if (SHELL_MODULES.indexOf(k) < 0 && v && typeof v === 'object' && !v.prototype) v.prototype = Object.assign({}, v);
    });

    /* Asc */
    ctx.Asc = permissive({
        c_oAscRestrictionType: {None: 0x00, OnlyForms: 0x01, OnlyComments: 0x02, OnlySignatures: 0x04, View: 0x80},
        c_oAscTypeSelectElement: {Paragraph: 0, Table: 1, Image: 2, Header: 3, Hyperlink: 4, SpellCheck: 5, Shape: 6, Slide: 7, Chart: 8, Math: 9, Animation: 12},
        CAscSlideProps: function () { return anything('CAscSlideProps'); },
        CAscSlideTransition: function () { return anything('CAscSlideTransition'); }
    }, 'Asc', world);
    ctx.AscCommon = permissive({GlobalSkin: {}}, 'AscCommon', world);

    /* engine */
    world.selection = [{type: 7, props: {}}];
    const sel = () => world.selection.map(s => ({
        get_ObjectType: () => s.type,
        get_ObjectValue: () => new Proxy(s.props, {get: (t, p) => (p in t ? t[p] : (typeof p === 'string' && /^(get_|put_|is|can|asc_)/.test(p) ? () => undefined : undefined))})
    }));
    const apiKnown = {
        asc_registerCallback: (name, f) => { (world.callbacks[name] = world.callbacks[name] || []).push({f, origin: origin()}); },
        asc_unregisterCallback: (name, f) => { if (world.callbacks[name]) world.callbacks[name] = world.callbacks[name].filter(x => x.f !== f); },
        getCurrentPage: () => opts.current,
        getCountPages: () => opts.slides,
        asc_getCanUndo: () => false,
        asc_getCanRedo: () => false,
        getSelectedElements: () => sel(),
        asc_getCurrentFocusObject: () => sel(),
        asc_getSelectedDrawingObjectsCount: () => world.selection.filter(s => [1, 2, 6, 8].indexOf(s.type) >= 0).length,
        can_CopyCut: () => world.selection.some(s => s.type !== 7),
        can_AddQuotedComment: () => true,
        canGroup: () => false,
        canUnGroup: () => false,
        asc_canMergeSelectedShapes: () => false,
        asc_getDocumentName: () => 'Deck.pptx',
        asc_GetViewRulers: () => false,
        asc_getZoom: () => 100,
        asc_IsShowNotes: () => true,
        asc_getSessionToken: () => 'token',
        IsActionRestrictionPrev: () => false,
        asc_getLocale: () => 1049,
        asc_getDefaultLanguage: () => 1049,
        isSlideMasterMode: () => false
    };
    const api = new Proxy({}, {
        get(t, p) {
            if (typeof p === 'symbol' || p === 'then' || p === 'toJSON' || p === 'nodeType' || p === '__jq') return undefined;
            if (!(p in t)) {
                const impl = apiKnown[p];
                t[p] = function (...args) {
                    world.apiCalls.push({name: String(p), args, origin: origin()});
                    return impl ? impl.apply(this, args) : undefined;
                };
            }
            return t[p];
        }
    });
    world.api = api;
    world.fire = (name, ...args) => { (world.callbacks[name] || []).slice().forEach(c => c.f.apply(null, args)); };

    /* Common */
    const NC = addEvents({}, world, 'NotificationCenter');
    const ncTrigger = NC.trigger;
    NC.trigger = function (name, ...args) { world.notices.push({name, args, origin: origin()}); return ncTrigger.apply(NC, [name].concat(args)); };
    const Shortcuts = {
        delegateShortcuts: o => { world.shortcuts.log.push({op: 'delegate', keys: Object.keys((o && o.shortcuts) || {}), origin: origin()}); world.shortcuts.delegated.push({map: (o && o.shortcuts) || {}, origin: origin()}); },
        undelegateShortcuts: () => {},
        suspendEvents: keys => {
            world.shortcuts.log.push({op: 'suspend', keys, origin: origin()});
            if (keys === undefined) world.shortcuts.suspended.add('*');
            else String(keys).split(',').map(k => k.trim()).filter(Boolean).forEach(k => world.shortcuts.suspended.add(k));
        },
        resumeEvents: keys => {
            world.shortcuts.log.push({op: 'resume', keys, origin: origin()});
            if (keys === undefined) world.shortcuts.suspended.clear();
            else String(keys).split(',').map(k => k.trim()).filter(Boolean).forEach(k => world.shortcuts.suspended.delete(k));
        }
    };
    world.shortcutActive = key => !world.shortcuts.suspended.has('*') && !world.shortcuts.suspended.has(key);
    const store = new Map();
    const settings = new Map();
    const spyDialog = kind => function (o) { world.alerts.push({kind, o, origin: origin()}); return anything(kind); };
    const commonLocale = ctx.Common || {};
    ctx.Common = permissive(Object.assign({}, commonLocale, {
        NotificationCenter: NC,
        Gateway: permissive(addEvents({}, world, 'Gateway'), 'Gateway', world),
        util: permissive({Shortcuts}, 'Common.util', world),
        Utils: permissive({
            isMac: false, isIE: false, isSafari: false, isChrome: true, isGecko: false, isOpera: false, isIE11: false,
            String: permissive({htmlEncode: s => escHtml(s == null ? '' : s).replace(/"/g, '&quot;'), format: (f, ...a) => String(f).replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m)), textCtrl: 'Ctrl', textShift: 'Shift', textAlt: 'Alt', platformKey: (k, f) => (f ? String(f).replace('{0}', k) : k)}, 'Common.Utils.String', world),
            InternalSettings: {get: k => settings.get(k), set: (k, v) => settings.set(k, v)},
            lockControls: (lock, disabled, o) => { ((o && o.array) || []).forEach(c => c && c.setDisabled && c.setDisabled(disabled)); },
            getOffset: () => ({left: 0, top: 0}),
            innerWidth: () => 1440,
            innerHeight: () => 900,
            getConfigObject: () => ({}),
            injectButtons: () => [],
            zoom: () => 1
        }, 'Common.Utils', world),
        localStorage: {itemExists: k => store.has(k), getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), getBool: (k, d) => (store.has(k) ? !!store.get(k) && store.get(k) !== '0' && store.get(k) !== 'false' : !!d), setBool: (k, v) => store.set(k, v ? 1 : 0), removeItem: k => store.delete(k), save() {}, setKeysFilter() {}, getKeysFilter: () => ''},
        UI: permissive({
            Keys: {BACKSPACE: 8, TAB: 9, RETURN: 13, SHIFT: 16, CTRL: 17, ALT: 18, ESC: 27, SPACE: 32, PAGEUP: 33, PAGEDOWN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, DELETE: 46, F1: 112, F5: 116},
            Themes: permissive({isDarkTheme: () => false, currentThemeId: () => 'theme-white', available: () => true, isContentThemeDark: () => false}, 'Themes', world),
            alert: spyDialog('alert'), warning: spyDialog('warning'), error: spyDialog('error'), info: spyDialog('info'), confirm: spyDialog('confirm'),
            Menu: permissive(Object.assign(function () { return anything('Common.UI.Menu()'); }, {Manager: permissive({hideAll: () => {}}, 'Menu.Manager', world)}), 'Common.UI.Menu', world),
            LayoutManager: permissive({isElementVisible: () => true, addControls: () => {}}, 'LayoutManager', world),
            /* the shared compact layer keeps the strings the locale put there (Common.UI.Compact.MenuBar…) */
            Compact: (commonLocale.UI && commonLocale.UI.Compact) || {},
            FeaturesManager: permissive({canChange: () => true, isFeatureEnabled: () => false}, 'FeaturesManager', world),
            isRTL: () => false
        }, 'Common.UI', world),
        Views: commonLocale.Views || {},
        Controllers: commonLocale.Controllers || {},
        enumLock: anything('Common.enumLock'),
        component: anything('Common.component'),
        IrregularStack: function () { return makeStack(); }
    }), 'Common', world);
    world.NC = NC;

    /* stock controllers and views */
    /* requestEdit: a reader with a rights request handler at the host: stock then
       sets canEdit while isEdit is false (controller/Main.js, onEditorPermissions). */
    const ao = {
        isEdit: opts.edit, canEdit: opts.edit || !!opts.requestEdit, canRequestEditRights: !!opts.requestEdit,
        isRestrictedEdit: false, canComments: opts.comment, canCoAuthoring: true,
        canViewComments: opts.viewComments, canDownload: opts.download, canPrint: opts.print, canRename: opts.rename,
        canUseHistory: opts.history, canHistoryRestore: false, canRequestSharingSettings: opts.sharing, canChat: opts.chat,
        canSwitchMode: opts.edit, isOffline: false, isDesktopApp: false, canBrandingExt: false, canPlugins: false,
        canLicense: true, canMacros: opts.edit, isEditDiagram: false, isEditMailMerge: false, isEditOle: false,
        canSaveToFile: false, canFeatureContentControl: false, customization: {}, user: {id: 'u1', fullname: 'User'}, lang: 'ru'
    };
    world.appOptions = ao;
    const absent = opts.edit ? {} : READER_ABSENT;
    const view = (name, extra, locale) => stockObject(world, name, {locale: locale || 'PE.Views.' + name, absent: absent[name],
        members: Object.assign({api, mode: ao, appConfig: ao}, extra)});

    const previewItems = (prefix, withSettings) => {
        const L = world.localeOf('PE.Views.' + prefix);
        const items = [
            {caption: L.textShowBegin, value: 0},
            {caption: L.textShowCurrent, value: 1},
            {caption: L.textShowPresenterView, value: 2}
        ];
        if (withSettings) items.push({caption: '--'}, {caption: L.textShowSettings, value: 3});
        return items;
    };
    const toolbarView = view('Toolbar', {});
    if (opts.edit) {
        toolbarView.btnPreview = makeTwin(world, 'Toolbar:btnPreview', {menu: makeMenu(world, 'Toolbar:btnPreview.menu', previewItems('Toolbar', true))});
        toolbarView.mnuShowSettings = toolbarView.btnPreview.menu.items[4];
        /* stock Toolbar: "Symbol" holds its own menu — the recent symbols picker, a separator and
           "More symbols", whose click opens the symbol dialog (controller: menu.items[2].on('click')) */
        toolbarView.btnInsertSymbol = makeTwin(world, 'Toolbar:btnInsertSymbol', {menu: makeMenu(world, 'Toolbar:btnInsertSymbol.menu',
            [{caption: ''}, {caption: '--'}, {caption: world.localeOf('PE.Views.Toolbar').textMoreSymbols}])});
    }
    toolbarView.$el = $('#toolbar');
    toolbarView.hideMoreBtns = () => {};
    toolbarView.lockToolbar = (lock, disabled, o) => { ((o && o.array) || []).forEach(c => c && c.setDisabled && c.setDisabled(disabled)); };
    const statusView = view('Statusbar', {});
    statusView.btnPreview = makeTwin(world, 'Statusbar:btnPreview', {menu: makeMenu(world, 'Statusbar:btnPreview.menu', previewItems('Statusbar', false))});
    statusView.SetDisabled = function () { world.calls.push({target: 'Statusbar', name: 'SetDisabled', args: [...arguments], origin: origin()}); };
    const fileMenu = view('FileMenu', {
        SetDisabled() { world.calls.push({target: 'FileMenu', name: 'SetDisabled', args: [...arguments], origin: origin()}); },
        applyMode() {}
    });
    if (!opts.download) fileMenu.miDownload = undefined;
    if (!opts.print) fileMenu.miPrint = undefined;
    const leftView = view('LeftMenu', {_state: {disabled: false}, close() {}, show() {}, hide() {}, setDisabledPluginButtons() {}, getMenu: n => (n === 'file' ? fileMenu : anything('menu'))});
    if (!opts.viewComments) leftView.btnComments = undefined;
    if (!opts.chat) leftView.btnChat = undefined;
    const viewTab = view('ViewTab', {});
    const dhView = view('DocumentHolder', {SetDisabled() {}});
    const rightView = view('RightMenu', {});
    const reviewView = view('ReviewChanges', {}, 'Common.Views.ReviewChanges');
    const transView = view('Transitions', {});
    const animView = view('Animation', {});

    const app = {getController: n => getController(n)};
    const ctl = (name, members) => stockObject(world, name + 'Ctl', {members: Object.assign({api, mode: ao, getApplication: () => app}, members)});

    const main = ctl('Main', {appOptions: ao, editorConfig: {ui: {shell: 'modern'}, mode: opts.edit ? 'edit' : 'view', lang: 'ru'},
        _state: {}, stackDisableActions: makeStack(), document: {key: 'k', title: 'Deck.pptx', fileType: 'pptx'}});
    const toolbarCtl = ctl('Toolbar', {toolbar: toolbarView, editMode: opts.edit, _state: {}, btnsComment: opts.comment ? [makeTwin(world, 'ToolbarCtl:btnsComment[0]')] : [],
        getView: () => toolbarView});
    const statusCtl = ctl('Statusbar', {statusbar: statusView, _state: {slideMasterMode: false}, getView: () => statusView});
    const leftCtl = ctl('LeftMenu', {leftMenu: leftView, setPreviewMode() {}, onShowTumbnails() { world.calls.push({target: 'LeftMenuCtl', name: 'onShowTumbnails', args: [...arguments], origin: origin()}); }, getView: () => leftView});
    const dhCtl = ctl('DocumentHolder', {documentHolder: dhView, _isDisabled: false, getView: () => dhView});
    dhCtl.SetDisabled = function (state) { this._isDisabled = state; world.calls.push({target: 'DocumentHolderCtl', name: 'SetDisabled', args: [state], origin: origin()}); };
    dhCtl.clearSelection = function () {};
    const rightCtl = ctl('RightMenu', {rightmenu: rightView, getView: () => rightView});
    const viewTabCtl = ctl('ViewTab', {view: viewTab, getView: () => viewTab});
    const reviewCtl = ctl('ReviewChanges', {view: reviewView, getView: () => reviewView});
    const transCtl = ctl('Transitions', {view: transView, getView: () => transView});
    const animCtl = ctl('Animation', {view: animView, getView: () => animView});
    const vbox = {height: 0, el: $('#toolbar')};
    const sbox = {height: 25, el: $('#statusbar')};
    const viewport = ctl('Viewport', {viewport: {
        vlayout: permissive({getItem: a => (a === 'toolbar' ? vbox : a === 'statusbar' ? sbox : null), doLayout() {}, panels: [vbox, sbox]}, 'vlayout', world),
        hlayout: permissive({doLayout() {}, panels: [], changeLayout() {}}, 'hlayout', world)
    }, previewPanel: permissive({isVisible: () => isVisibleNode(doc.getElementById('pe-preview'))}, 'DocumentPreview', world), getView: () => anything('ViewportView')});
    const commentsCtl = ctl('Comments', {setPreviewMode() {}});
    const controllers = {
        Main: main, Toolbar: toolbarCtl, Statusbar: statusCtl, LeftMenu: leftCtl, DocumentHolder: dhCtl, RightMenu: rightCtl,
        ViewTab: viewTabCtl, Viewport: viewport, Transitions: transCtl, Animation: animCtl,
        'Common.Controllers.ReviewChanges': reviewCtl, ReviewChanges: reviewCtl, 'Common.Controllers.Comments': commentsCtl
    };
    function getController(n) { return controllers[n] || ctl(String(n), {}); }
    world.controllers = controllers;
    world.views = {Toolbar: toolbarView, Statusbar: statusView, FileMenu: fileMenu, LeftMenu: leftView, ViewTab: viewTab,
        DocumentHolder: dhView, RightMenu: rightView, Review: reviewView, Transitions: transView, Animation: animView};
    PE.getController = getController;
    PE.getApplication = () => app;
    PE.Controllers = PE.Controllers || {};
    PE.Collections = PE.Collections || {};

    /* stock handlers, verbatim from the stock controllers */
    toolbarCtl.onPreview = stockMethod(world, 'controller/Toolbar.js', 'onPreview');
    toolbarCtl.onPreviewBtnClick = stockMethod(world, 'controller/Toolbar.js', 'onPreviewBtnClick');
    toolbarCtl.onPreviewItemClick = stockMethod(world, 'controller/Toolbar.js', 'onPreviewItemClick');
    toolbarCtl.DisableToolbar = stockMethod(world, 'controller/Toolbar.js', 'DisableToolbar');
    statusCtl.onPreview = stockMethod(world, 'controller/Statusbar.js', 'onPreview');
    statusCtl.onPreviewBtnClick = stockMethod(world, 'controller/Statusbar.js', 'onPreviewBtnClick');
    statusCtl.onPreviewItemClick = stockMethod(world, 'controller/Statusbar.js', 'onPreviewItemClick');
    leftCtl.SetDisabled = stockMethod(world, 'controller/LeftMenu.js', 'SetDisabled');
    main.onEditingDisable = stockMethod(world, 'controller/Main.js', 'onEditingDisable');
    main.onPreviewStart = stockMethod(world, 'controller/Main.js', 'onPreviewStart');
    main.onEndDemonstration = stockMethod(world, 'controller/Main.js', 'onEndDemonstration');
    /* edit request of the compact menu and the host answer to it: the methods of controller/Main.js
       with the texts the locale gives the controllers */
    for (const name of ['onProcessRightsChange', 'markEditRequest', 'isEditRequestWaiting', 'answerEditRequest',
        'cancelEditRequestWait', 'editRequestStatus']) main[name] = stockMethod(world, 'controller/Main.js', name);
    main.editRequest = null;
    const mainTexts = world.localeOf('PE.Controllers.Main');
    main.textEditRequestFailed = mainTexts.textEditRequestFailed;
    main.warnProcessRightsChange = mainTexts.warnProcessRightsChange;
    leftCtl.requestEditRightsText = world.localeOf('PE.Controllers.LeftMenu').requestEditRightsText;
    if (toolbarView.btnPreview) {
        toolbarView.btnPreview.on('click', (b, e) => toolbarCtl.onPreviewBtnClick(b, e));
        toolbarView.btnPreview.menu.on('item:click', (m, i) => toolbarCtl.onPreviewItemClick(m, i));
    }
    statusView.btnPreview.on('click', (b, e) => statusCtl.onPreviewBtnClick(b, e));
    statusView.btnPreview.menu.on('item:click', (m, i) => statusCtl.onPreviewItemClick(m, i));
    PE.Views.SlideshowSettings = function (o) {
        const dlg = {options: o, shown: false, show() { dlg.shown = true; }, setSettings(v) { dlg.loop = v; }, getSettings: () => dlg.loop, origin: origin()};
        world.dialogs.push(dlg);
        return dlg;
    };
    NC.on('editing:disable', (d, o, t) => main.onEditingDisable(d, o, t));
    NC.on('preview:start', (...a) => {
        main.onPreviewStart(...a);
        world.previewRuns = (world.previewRuns || 0) + 1;
        doc.getElementById('pe-preview').style.display = '';
        NC.trigger('preview:show');
    });
    world.endShow = () => {
        doc.getElementById('pe-preview').style.display = 'none';
        main.onEndDemonstration();
        world.fire('asc_onEndDemonstration');
        NC.trigger('preview:hide');
    };
    /* stock Ctrl+F5 of the stock DocumentHolder controller: show from the beginning */
    world.pressStockShortcut = key => {
        if (key === 'ctrl+f5' && world.shortcutActive('ctrl+f5') && opts.slides > 0) { NC.trigger('preview:start', 0); return true; }
        return false;
    };

    /* shell modules */
    world.modules = {};
    ctx.define = function (deps, factory) {
        if (typeof deps === 'function') { factory = deps; deps = []; }
        const args = (deps || []).map(d => {
            const m = String(d).match(/presentationeditor\/main\/app\/view\/(\w+)$/);
            if (m && PE.Views[m[1]]) return PE.Views[m[1]];
            if (/^text!/.test(d)) return '';
            return undefined;
        });
        const r = factory.apply(ctx, args);
        if (world.__loading && !SHARED_MODULES[world.__loading] && r && !PE.Views[world.__loading]) PE.Views[world.__loading] = r;
        return r;
    };
    ctx.require = ctx.define;
    for (const name of SHELL_MODULES) {
        const shared = SHARED_MODULES[name];
        const file = shared || path.join(viewDir, name + '.js');
        if (!fs.existsSync(file)) { world.loadErrors[name] = 'no file ' + path.relative(ROOT, file); continue; }
        const preset = shared ? undefined : PE.Views[name];
        try {
            world.__loading = name;
            vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: 'shell:' + file});
            const mod = shared ? ctx.Common.UI.Compact[name] : PE.Views[name];
            if (!mod || mod === preset && !Object.keys(mod).some(k => typeof mod[k] === 'function')) world.loadErrors[name] = (shared ? 'Common.UI.Compact.' : 'PE.Views.') + name + ' is not defined by its file';
            else world.modules[name] = mod;
        } catch (e) {
            world.loadErrors[name] = 'PE.Views.' + name + ' failed to load: ' + (e && e.message);
        } finally {
            world.__loading = null;
        }
    }
    world.flush = (max) => {
        let n = 0;
        while (n < (max || 400)) {
            const t = world.timers.shift();
            if (!t) break;
            n++;
            if (t.cancelled) continue;
            try { t.f.apply(null, t.a); } catch (e) { doc.__errors.push(e); }
        }
    };
    return world;
}

function makeStack() {
    const items = [];
    return {
        push: a => items.push(a),
        pop: q => { for (let i = items.length - 1; i >= 0; i--) if (!q || !q.type || items[i].type === q.type) return items.splice(i, 1)[0]; },
        get: q => (typeof q === 'number' ? items[q] : items.find(a => !q || !q.type || a.type === q.type)),
        length: () => items.length,
        exist: t => items.some(a => a.type === t)
    };
}

/* ------------------------------------------------------------------------ */
/* Using the world                                                           */

function need(world, ...names) {
    const missing = names.filter(n => !world.modules[n]);
    if (missing.length) {
        const noFile = missing.filter(n => /^no file/.test(world.loadErrors[n] || ''));
        const other = missing.filter(n => noFile.indexOf(n) < 0).map(n => world.loadErrors[n] || ('no module PE.Views.' + n));
        const parts = [];
        if (noFile.length) parts.push('no shell module ' + noFile.map(n => 'PE.Views.' + n).join(', ') + ' (apps/presentationeditor/main/app/view/<name>.js)');
        throw new Error(parts.concat(other).join('; '));
    }
    return names.length === 1 ? world.modules[names[0]] : names.map(n => world.modules[n]);
}

/* Start the shell as the stock Viewport does on app:ready. */
function boot(world) {
    need(world, ...SHELL_MODULES);
    const shell = world.modules.CompactShell;
    if (typeof shell.wanted !== 'function' || !shell.wanted()) throw new Error('CompactShell.wanted() is not true for ui.shell = modern');
    if (typeof shell.announce === 'function') shell.announce(world.controllers.Main.editorConfig);
    world.NC.trigger('app:face', world.appOptions);
    if (typeof shell.start === 'function') shell.start(); else shell.create();
    world.flush();
    if (!world.doc.getElementById('vo-shell')) {
        const why = world.warnings.concat(world.doc.__errors.map(e => e && e.message)).slice(0, 3).join(' | ');
        throw new Error('the shell did not build #vo-shell on start' + (why ? ' (' + why + ')' : ''));
    }
    world.shell = shell;
    return shell;
}

function byId(world, id) { return world.doc.getElementById(id); }
function norm(s) { return String(s == null ? '' : s).replace(/[ \s]+/g, ' ').trim(); }
function strip(s) { return norm(s).replace(/\s*[▸▾…]+$/, '').trim(); }
const LABEL_ATTRS = ['title', 'aria-label', 'data-tip', 'data-hint-title', 'data-title', 'data-tooltip', 'data-original-title'];
function labelOf(el) {
    for (const a of LABEL_ATTRS) { const v = el.getAttribute(a); if (v) return norm(v); }
    return '';
}
/* Innermost elements whose text equals the label, or whose tooltip attribute does. */
function findByLabel(root, label, opt) {
    opt = opt || {};
    const want = strip(label);
    const out = [];
    for (const el of walk(root.nodeType === 9 ? root.documentElement : root)) {
        const t = strip(el.textContent);
        const textHit = t === want && !el.children.some(c => strip(c.textContent) === want);
        const attrHit = !textHit && (opt.prefix ? labelOf(el).startsWith(want) : strip(labelOf(el)) === want);
        if (textHit || attrHit) out.push(el);
    }
    return opt.visible === false ? out : out.filter(isVisibleNode);
}
function textStartsWith(el, s) { return norm(el.textContent).startsWith(s) || labelOf(el).startsWith(s); }

/* A person's click: pointer over, press, release, click. */
function click(world, el) {
    if (!el) throw new Error('nothing to click');
    const doc = world.doc;
    dispatch(el, makeEvent(doc, 'mouseover'));
    dispatch(el, makeEvent(doc, 'mousedown'));
    dispatch(el, makeEvent(doc, 'pointerdown'));
    dispatch(el, makeEvent(doc, 'mouseup'));
    dispatch(el, makeEvent(doc, 'pointerup'));
    dispatch(el, makeEvent(doc, 'click'));
    world.flush();
}
function hover(world, el) {
    dispatch(el, makeEvent(world.doc, 'mouseover'));
    dispatch(el, makeEvent(world.doc, 'mousemove'));
    world.flush();
}
const KEYS = {Escape: 27, F1: 112, F5: 116, Delete: 46, ArrowUp: 38, ArrowDown: 40, Enter: 13};
/* A key press like "Escape", "ctrl+F5", "ctrl+m"; target defaults to the focused element. */
function press(world, combo, target) {
    const parts = combo.split('+');
    const key = parts.pop();
    const mods = new Set(parts.map(p => p.toLowerCase()));
    const k = key.length === 1 ? key.toLowerCase() : key;
    const keyCode = KEYS[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const props = {key: k, keyCode, which: keyCode, code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
        ctrlKey: mods.has('ctrl'), shiftKey: mods.has('shift'), altKey: mods.has('alt'), metaKey: mods.has('cmd') || mods.has('meta')};
    const t = target || world.doc.activeElement || world.doc.body;
    const down = makeEvent(world.doc, 'keydown', props);
    dispatch(t, down);
    dispatch(t, makeEvent(world.doc, 'keyup', props));
    world.flush();
    return down;
}

/* Shell command registry (command(name) runs it, or returns what runs it). */
function runCommand(world, name) {
    const shell = world.shell;
    if (typeof shell.command !== 'function') throw new Error('CompactShell.command is missing');
    const r = shell.command(name);
    if (typeof r === 'function') r();
    else if (r && typeof r.run === 'function') r.run();
    world.flush();
}

/* Whether a shell row (header, menubar, toolbar) is shown. Signals accepted, in order:
   a query method of the shell; hasToolbar() for the toolbar; the row element being hidden
   (inline display none, hidden attribute, a hiding class); a body class of the documents shell. */
function rowShown(world, name) {
    const s = world.shell;
    for (const m of ['rowVisible', 'isRowVisible', 'rowShown', 'isRowShown']) if (typeof s[m] === 'function') return !!s[m](name);
    if (name === 'toolbar' && typeof s.hasToolbar === 'function') return !!s.hasToolbar();
    const el = byId(world, 'vo-' + name);
    if (!el) throw new Error('row #vo-' + name + ' is not in the shell');
    if (!isVisibleNode(el) || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.className.split(/\s+/).some(c => /(^|-)(hidden|collapsed|off)$/.test(c))) return false;
    const body = world.doc.body.className;
    if ((name === 'header' || name === 'menubar') && /(^|\s)vo-focus(\s|$)/.test(body)) return false;
    if (new RegExp('(^|\\s)vo-(no|hide|hidden)-' + name + '(\\s|$)').test(body)) return false;
    if (new RegExp('(^|\\s)vo-' + name + '-(hidden|off)(\\s|$)').test(body)) return false;
    if (name === 'toolbar' && /(^|\s)vo-(tb-hidden|view)(\s|$)/.test(body)) return false;
    return true;
}

/* Catalog of the menu bar: [{label, items}], items may carry nested `sub` arrays. */
function catalog(world) {
    const acts = need(world, 'SlideActions');
    if (typeof acts.groups !== 'function') throw new Error('SlideActions.groups is missing');
    return acts.groups();
}
function allItems(groups) {
    const out = [];
    const rec = (items, section) => (items || []).forEach(it => {
        if (!it || it.sep) return;
        out.push({it, section});
        if (Array.isArray(it.sub)) rec(it.sub, section);
    });
    groups.forEach(g => rec(g.items, strip(g.label)));
    return out;
}
function findItem(world, section, label) {
    const groups = catalog(world);
    const g = groups.find(x => strip(x.label) === section);
    if (!g) throw new Error('menu has no section «' + section + '»');
    const hit = allItems([g]).find(x => strip(x.it.t) === strip(label));
    if (!hit) throw new Error('menu «' + section + '» has no item «' + label + '»');
    return hit.it;
}
function itemState(world, it) {
    const acts = need(world, 'SlideActions');
    if (typeof acts.itemState !== 'function') throw new Error('SlideActions.itemState is missing');
    return acts.itemState(it) || {};
}
function isHiddenItem(world, section, it) {
    const st = itemState(world, it);
    if (st.hidden === true || st.visible === false) return true;
    const g = catalog(world).find(x => strip(x.label) === section);
    return !allItems([g]).some(x => x.it === it || (strip(x.it.t) === strip(it.t) && x.it.twin === it.twin));
}
function twinOf(world, it) {
    const bridge = need(world, 'StockBridge');
    if (!it.twin) return null;
    return bridge.twin(it.twin);
}

/* Selection as the engine reports it. */
const SEL = {
    slide: () => ({type: 7, props: {get_LockDelete: () => false, get_LockLayout: () => false, get_LayoutIndex: () => 0, get_IsMasterSelected: () => false, get_IsHidden: () => false}}),
    paragraph: () => ({type: 0, props: {get_Locked: () => false}}),
    shape: () => ({type: 6, props: {get_Locked: () => false, get_FromImage: () => false, get_FromChart: () => false, get_FromSmartArt: () => false, get_FromSmartArtInternal: () => false, get_FromGroup: () => false, get_IsFromGroup: () => false, get_type: () => 'rect', get_ShapeProperties: () => null}}),
    image: () => ({type: 2, props: {get_Locked: () => false, get_FromGroup: () => false}})
};
function select(world, ...kinds) {
    world.selection = kinds.map(k => SEL[k]());
    world.fire('asc_onFocusObject', world.api.getSelectedElements());
    world.flush();
}

/* Snapshot of calls made by shell code. */
function mark(world) { return {api: world.apiCalls.length, act: world.activations.length, notices: world.notices.length, calls: world.calls.length, alerts: world.alerts.length, dialogs: world.dialogs.length}; }
function since(world, m) {
    return {
        api: world.apiCalls.slice(m.api), act: world.activations.slice(m.act), notices: world.notices.slice(m.notices),
        calls: world.calls.slice(m.calls), alerts: world.alerts.slice(m.alerts), dialogs: world.dialogs.slice(m.dialogs)
    };
}
const WRITE_API = /^(asc_)?(add|insert|delete|remove|put|change|apply|paste|cut|undo|redo|group|ungroup|merge|duplicate|move|hide|show|start|demonstration|setslide|setselected|shapeapply|imgapply|tblapply|paraapply|increase|decrease|clear|replace|selectall|select_|zoom|setzoom)/i;
const WRITE_API_ALLOWED = /^(asc_setSkin|asc_registerCallback|asc_unregisterCallback|asc_enableKeyEvents|Resize|asc_addRestriction|asc_removeRestriction|asc_setRestriction|asc_ShowNotes|ShowThumbnails|asc_SetViewRulers)$/;
function shellEdits(calls) { return calls.filter(c => c.origin === 'shell' && WRITE_API.test(c.name) && !WRITE_API_ALLOWED.test(c.name)); }

/* Shell header: the show control and the rest of the right cluster. */
const SHOW = 'Показ слайдов';
function showControl(world) {
    const roots = ['vo-tb-end', 'vo-hdr-show'].map(id => byId(world, id)).filter(Boolean);
    const scope = [byId(world, 'vo-header'), byId(world, 'vo-toolbar'), byId(world, 'vo-shell')].filter(Boolean);
    const seen = [];
    for (const s of scope) for (const el of findByLabel(s, SHOW, {visible: false})) if (seen.indexOf(el) < 0) seen.push(el);
    if (!seen.length) return null;
    const inRoot = seen.find(el => roots.some(r => r.contains(el)));
    const hit = inRoot || seen[0];
    let rootEl = hit;
    while (rootEl.parentNode && rootEl.parentNode.nodeType === 1 && roots.indexOf(rootEl.parentNode) < 0) rootEl = rootEl.parentNode;
    const container = roots.indexOf(rootEl.parentNode) >= 0 ? rootEl.parentNode : null;
    return {hit, root: container ? rootEl : hit, container: container ? container.id : null};
}
function clickables(root) {
    return walk(root).filter(el => el.localName === 'button' || el.getAttribute('role') === 'button' || el.hasAttribute('tabindex') ||
        Object.keys(el.__jqev || {}).some(k => /click|mousedown|pointerdown/.test(k)) || (el._ls || []).some(l => /click|mousedown|pointerdown/.test(l.type)));
}
function showParts(world) {
    const sc = showControl(world);
    if (!sc) throw new Error('no «' + SHOW + '» control in the header or the toolbar');
    const parts = clickables(sc.root);
    const isArrow = el => el.hasAttribute('aria-haspopup') || /(arrow|caret|drop|split|more|menu)/i.test(el.className);
    const arrow = parts.filter(isArrow).pop() || (parts.length > 1 ? parts[parts.length - 1] : null);
    const main = parts.find(el => el !== arrow && !isArrow(el)) || (parts.length ? parts[0] : sc.root);
    return {sc, main, arrow};
}

/* Popup items: prefer the ones inside `scope`, then the ones added since `before`, then any. */
function pickItem(world, label, scope, before) {
    const hits = findByLabel(world.doc, label).filter(el => !(byId(world, 'vo-menubar') && el === scope));
    const inScope = scope ? hits.filter(el => scope.contains(el) && el !== scope) : [];
    if (inScope.length) return inScope[inScope.length - 1];
    const fresh = before ? hits.filter(el => !before.has(el)) : [];
    if (fresh.length) return fresh[fresh.length - 1];
    const outside = hits.filter(el => !el.closest('#vo-toolbar') && !el.closest('#vo-header'));
    return (outside.length ? outside : hits).slice(-1)[0] || null;
}
function visibleItem(world, label) { return pickItem(world, label, null, null); }
function openSection(world, label) {
    const bar = byId(world, 'vo-menubar');
    if (!bar) throw new Error('no menu bar #vo-menubar');
    const top = findByLabel(bar, label, {visible: false}).find(el => !el.closest('[class*="drop"]')) || findByLabel(bar, label, {visible: false})[0];
    if (!top) throw new Error('menu bar has no section «' + label + '»');
    const before = new Set(walk(world.doc.documentElement));
    click(world, top);
    let wrap = top;
    while (wrap.parentNode && wrap.parentNode !== bar && wrap.parentNode.nodeType === 1 && wrap.parentNode.children.length === 1) wrap = wrap.parentNode;
    wrap = wrap.parentNode && wrap.parentNode !== bar ? wrap.parentNode : wrap;
    return {top, wrap, before};
}
function menuPath(world, labels) {
    const open = openSection(world, labels[0]);
    let scope = open.wrap, before = open.before, el = null;
    for (let i = 1; i < labels.length; i++) {
        el = pickItem(world, labels[i], scope, before);
        if (!el) throw new Error('menu path ' + labels.slice(0, i + 1).join(' → ') + ': item not shown');
        if (i < labels.length - 1) {
            const snap = new Set(walk(world.doc.documentElement));
            hover(world, el);
            if (!pickItem(world, labels[i + 1], null, snap)) click(world, el);
            before = snap;
            scope = el.parentNode;
        }
    }
    return el;
}
/* Open markers of a popup item: attachment, inline visibility, open-like classes and aria-expanded up the tree. */
const OPEN_CLASS = /^(open|opened|show|shown|active|visible|expanded|is-open|vo-open|in)$/;
function openState(el) {
    const marks = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
        n.className.split(/\s+/).filter(c => OPEN_CLASS.test(c)).forEach(c => marks.push([n, c]));
        if (n.getAttribute('aria-expanded') === 'true') marks.push([n, '@aria-expanded']);
    }
    return {el, marks};
}
function closedSince(st) {
    const el = st.el;
    if (!el.isConnected || !isVisibleNode(el)) return true;
    return st.marks.some(([n, c]) => (c === '@aria-expanded' ? n.getAttribute('aria-expanded') !== 'true' : !n.classList.contains(c)) || !n.isConnected);
}
function itemReasonShown(el, reason) {
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
        if (norm(n.textContent).indexOf(reason) >= 0) return true;
        for (const a of LABEL_ATTRS.concat(['aria-description', 'data-reason', 'data-hint'])) {
            const v = n.getAttribute(a);
            if (v && v.indexOf(reason) >= 0) return true;
        }
        if (/^(li|button|a)$/.test(n.localName) || n.getAttribute('role') === 'menuitem') {
            /* item boundary reached; reason may sit in a sibling hint element */
            return walk(n).some(x => LABEL_ATTRS.concat(['aria-description', 'data-reason']).some(a => (x.getAttribute(a) || '').indexOf(reason) >= 0));
        }
    }
    return false;
}

module.exports = {
    ROOT, PE_APP, SHELL_MODULES, SHARED_MODULES, run, createWorld, boot, need, byId, norm, strip, findByLabel, labelOf, click, hover, press,
    runCommand, rowShown, catalog, allItems, findItem, itemState, isHiddenItem, twinOf, select, mark, since, shellEdits,
    showControl, showParts, clickables, pickItem, openState, closedSince, visibleItem, openSection, menuPath, itemReasonShown, isVisibleNode, walk, ruText, stockSource,
    methodText, makeEvent, dispatch, textStartsWith, SHOW, origin, originOf, anything, permissive, addEvents, makeMenu, makeTwin
};

if (require.main === module) process.exitCode = 0;
