/* Shared helper for the acceptance checks of the workspace, the right panel and the comments
 * of the presentation editor shell. By itself it checks nothing: when run directly
 * it exits with code 0.
 *
 * What is here:
 *  - running the file's tests: `ok <name>` / `FAIL <name>: <reason>`, code 1 on failure,
 *    `--only <name>` runs one test, `--app <dir>` is another
 *    apps/presentationeditor/main directory (by default, from this tree);
 *  - parsing the shell LESS into a flat list of rules;
 *  - the ru.json locale;
 *  - the vm environment: a small DOM, a subset of jQuery, stubs of the stock editor
 *    objects (controllers, views, buttons, menus, api) with spies on the stock
 *    handlers, loading the shell modules and starting it the stock way.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../../../..');

function argValue(flag) {
    const argv = process.argv.slice(2);
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
}

const APP = path.resolve(argValue('--app') || path.join(ROOT, 'apps/presentationeditor/main'));
const VIEW_DIR = path.join(APP, 'app/view');
const LESS_DIR = path.join(APP, 'resources/less');
const LOCALE_DIR = path.join(APP, 'locale');

const SHELL_MODULES = ['CompactShell', 'StockBridge', 'SlideActions', 'SlideSelection',
    'CompactToolbar', 'SlideSections', 'CompactLeft', 'CompactStatus', 'CompactModes', 'CompactWindows', 'DocInfoWindow'];
/* Shared compact layer modules that the shell takes instead of its own: name → file; the module is Common.UI.Compact.<name>. */
const SHARED_MODULES = {Icons: path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js')};
const SHELL_LESS = ['compact-shell.less', 'compact-menu.less', 'compact-toolbar.less',
    'compact-panel.less', 'compact-areas.less', 'compact-galleries.less', 'compact-windows.less'];

function rel(file) {
    return path.relative(APP, file).split(path.sep).join('/');
}

/* --- Running the file's tests --------------------------------------------- */

function run(tests) {
    const only = argValue('--only');
    let failed = 0, ran = 0;
    const names = new Set();
    for (const t of tests) {
        if (names.has(t.name)) throw new Error('повтор имени теста ' + t.name);
        names.add(t.name);
        if (only && t.name !== only) continue;
        ran++;
        try {
            t.run();
            console.log('ok ' + t.name);
        } catch (e) {
            failed++;
            const msg = String((e && e.message) || e).replace(/\s*\n\s*/g, ' ');
            console.log('FAIL ' + t.name + ': ' + msg);
        }
    }
    if (only && !ran) {
        console.log('FAIL ' + only + ': в файле нет такого теста');
        failed++;
    }
    process.exitCode = failed ? 1 : 0;
}

/* --- Sources, locale -------------------------------------------------------- */

function shellSource(name) {
    const file = path.join(VIEW_DIR, name + '.js');
    if (!fs.existsSync(file)) throw new Error('нет модуля оболочки ' + rel(file));
    return fs.readFileSync(file, 'utf8');
}

function existingShellSources() {
    return SHELL_MODULES
        .map(name => path.join(VIEW_DIR, name + '.js'))
        .filter(file => fs.existsSync(file))
        .map(file => ({file: rel(file), text: fs.readFileSync(file, 'utf8')}));
}

let ruCache = null;
function ru() {
    if (!ruCache) ruCache = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, 'ru.json'), 'utf8'));
    return ruCache;
}

/* A caption without service marks: case, yo/ye spelling, ellipsis, submenu arrows,
   a key combination in brackets. */
function norm(s) {
    return String(s == null ? '' : s)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\([^)]*(ctrl|alt|shift|del|f\d|⌘|⌥|⇧)[^)]*\)/gi, ' ')
        .replace(/[▸▾►▼…]/g, ' ')
        .replace(/\.\.\./g, ' ')
        .replace(/ё/g, 'е').replace(/Ё/g, 'Е')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/* --- LESS: a flat list of rules -------------------------------------------- */

function stripComments(src) {
    let out = '', i = 0, q = null;
    const n = src.length;
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (q) {
            out += c;
            if (c === '\\') { out += d || ''; i += 2; continue; }
            if (c === q) q = null;
            i++;
            continue;
        }
        if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
        if (c === '/' && d === '*') {
            const e = src.indexOf('*/', i + 2);
            i = e < 0 ? n : e + 2;
            continue;
        }
        if (c === '/' && d === '/') {
            const prev = out.replace(/\s+$/, '').slice(-1);
            if (prev !== ':' && prev !== '(') {
                const e = src.indexOf('\n', i);
                i = e < 0 ? n : e;
                continue;
            }
        }
        out += c;
        i++;
    }
    return out;
}

function splitTop(s, sep) {
    const parts = [];
    let depth = 0, cur = '', q = null;
    for (const c of s) {
        if (q) { cur += c; if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; cur += c; continue; }
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') depth--;
        if (c === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += c;
    }
    parts.push(cur);
    return parts.map(p => p.trim()).filter(Boolean);
}

function combine(parents, header) {
    const own = splitTop(header, ',');
    if (!parents || !parents.length) return own;
    const out = [];
    for (const p of parents) {
        for (const s of own) out.push(s.indexOf('&') >= 0 ? s.replace(/&/g, p) : p + ' ' + s);
    }
    return out;
}

/* [{selector, decls: [{prop, value, important}], file}], one element per selector. */
function lessRules(text, file) {
    const src = stripComments(text);
    const rules = [];
    let i = 0;
    function block(parents) {
        let buf = '', depth = 0, q = null;
        const decls = [];
        const flush = () => {
            const s = buf.trim();
            buf = '';
            if (!s || s[0] === '@') return;
            const m = /^(--[-\w]+|[*_]?[-\w]+)\s*:\s*([\s\S]*)$/.exec(s);
            if (!m) return;
            let v = m[2].trim();
            const important = /!\s*important\s*$/i.test(v);
            v = v.replace(/\s*!\s*important\s*$/i, '');
            decls.push({prop: m[1].toLowerCase(), value: v, important});
        };
        while (i < src.length) {
            const c = src[i];
            if (q) { buf += c; if (c === q) q = null; i++; continue; }
            if (c === '"' || c === "'") { q = c; buf += c; i++; continue; }
            if (c === '(') depth++;
            if (c === ')') depth--;
            if (c === '{' && depth <= 0) {
                const header = buf.trim();
                buf = '';
                i++;
                let next = parents, skip = false;
                if (header[0] === '@') {
                    if (/^@(-\w+-)?(keyframes|font-face)/.test(header)) skip = true;
                } else if (/^[.#][\w-]+\s*\(.*\)\s*(when\b.*)?$/s.test(header)) {
                    skip = true;
                } else {
                    next = combine(parents, header);
                }
                block(skip ? null : next);
                continue;
            }
            if (c === '}' && depth <= 0) {
                flush();
                i++;
                if (parents) for (const sel of parents) rules.push({selector: sel.replace(/\s+/g, ' '), decls, file});
                return;
            }
            if (c === ';' && depth <= 0) { flush(); i++; continue; }
            buf += c;
            i++;
        }
        flush();
        if (parents) for (const sel of parents) rules.push({selector: sel.replace(/\s+/g, ' '), decls, file});
    }
    while (i < src.length) block(null);
    return rules;
}

function lessFile(name) {
    const file = path.join(LESS_DIR, name);
    if (!fs.existsSync(file)) throw new Error('нет файла стилей ' + rel(file));
    return fs.readFileSync(file, 'utf8');
}

/* All shell style files; if any is missing, an error with its name. */
function shellLessRules() {
    const out = [];
    for (const name of SHELL_LESS) out.push(...lessRules(lessFile(name), name));
    return out;
}

function decl(rule, prop) {
    return rule.decls.filter(d => d.prop === prop);
}

function hides(rule) {
    return rule.decls.some(d =>
        (d.prop === 'display' && /^none\b/i.test(d.value)) ||
        (d.prop === 'visibility' && /^hidden\b/i.test(d.value)) ||
        (d.prop === 'pointer-events' && /^none\b/i.test(d.value)));
}

/* --- A small DOM -------------------------------------------------------------- */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', '#39': "'"};

function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENT[e] !== undefined ? ENT[e] : m;
    });
}

function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class FakeEvent {
    constructor(type, init) {
        init = init || {};
        Object.assign(this, init);
        this.type = type;
        this.bubbles = !!init.bubbles;
        this.cancelable = init.cancelable !== false;
        this.defaultPrevented = false;
        this.target = null;
        this.currentTarget = null;
        this.timeStamp = Date.now();
        this._stop = false;
        this._stopNow = false;
        if (this.which === undefined) this.which = init.keyCode || (init.button !== undefined ? init.button + 1 : 1);
    }
    get originalEvent() { return this; }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    stopPropagation() { this._stop = true; }
    stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
    isDefaultPrevented() { return this.defaultPrevented; }
    isPropagationStopped() { return this._stop; }
    initEvent(type, bubbles, cancelable) { this.type = type; this.bubbles = !!bubbles; this.cancelable = !!cancelable; }
}

class FakeNode {
    constructor(doc) {
        this.ownerDocument = doc;
        this.parentNode = null;
        this.childNodes = [];
        this._listeners = {};
    }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get nextSibling() {
        const p = this.parentNode;
        return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null;
    }
    get previousSibling() {
        const p = this.parentNode;
        return p ? p.childNodes[p.childNodes.indexOf(this) - 1] || null : null;
    }
    get isConnected() {
        let n = this;
        while (n.parentNode) n = n.parentNode;
        return n.nodeType === 9;
    }
    get textContent() {
        if (this.nodeType === 3) return this.data;
        if (this.nodeType === 8) return '';
        return this.childNodes.map(n => n.textContent).join('');
    }
    set textContent(v) {
        if (this.nodeType === 3) { this.data = String(v); return; }
        this.childNodes.slice().forEach(n => this.removeChild(n));
        if (v !== '' && v != null) this.appendChild(this.ownerDocument.createTextNode(String(v)));
    }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, ref) {
        if (child.nodeType === 11) {
            child.childNodes.slice().forEach(n => this.insertBefore(n, ref));
            return child;
        }
        if (child.parentNode) child.parentNode.removeChild(child);
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        if (i < 0) this.childNodes.push(child);
        else this.childNodes.splice(i, 0, child);
        child.parentNode = this;
        return child;
    }
    removeChild(child) {
        const i = this.childNodes.indexOf(child);
        if (i >= 0) this.childNodes.splice(i, 1);
        child.parentNode = null;
        return child;
    }
    replaceChild(next, old) {
        this.insertBefore(next, old);
        return this.removeChild(old);
    }
    contains(n) {
        while (n) { if (n === this) return true; n = n.parentNode; }
        return false;
    }
    addEventListener(type, fn, opts) {
        if (!fn) return;
        const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
        const once = !!(opts && typeof opts === 'object' && opts.once);
        (this._listeners[type] = this._listeners[type] || []).push({fn, capture, once});
    }
    removeEventListener(type, fn, opts) {
        const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
        const list = this._listeners[type];
        if (!list) return;
        const i = list.findIndex(l => l.fn === fn && l.capture === capture);
        if (i >= 0) list.splice(i, 1);
    }
    dispatchEvent(ev) {
        ev.target = this;
        const pathUp = [];
        for (let n = this; n; n = n.parentNode) pathUp.push(n);
        const doc = this.ownerDocument || this;
        if (doc && doc.defaultView && pathUp[pathUp.length - 1] === doc) pathUp.push(doc.defaultView);
        const call = (node, capturePhase) => {
            const list = (node._listeners && node._listeners[ev.type]) || [];
            for (const l of list.slice()) {
                if (capturePhase !== null && l.capture !== capturePhase) continue;
                ev.currentTarget = node;
                if (l.once) node.removeEventListener(ev.type, l.fn, l.capture);
                if (typeof l.fn === 'function') l.fn.call(node, ev);
                else if (l.fn && typeof l.fn.handleEvent === 'function') l.fn.handleEvent(ev);
                if (ev._stopNow) return;
            }
        };
        for (let k = pathUp.length - 1; k > 0 && !ev._stop; k--) call(pathUp[k], true);
        if (!ev._stop) call(this, null);
        if (ev.bubbles) for (let k = 1; k < pathUp.length && !ev._stop; k++) call(pathUp[k], false);
        return !ev.defaultPrevented;
    }
}

class FakeText extends FakeNode {
    constructor(doc, data, type) {
        super(doc);
        this.nodeType = type || 3;
        this.nodeName = this.nodeType === 8 ? '#comment' : '#text';
        this.data = String(data);
    }
    get nodeValue() { return this.data; }
    cloneNode() { return new FakeText(this.ownerDocument, this.data, this.nodeType); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

function kebab(name) {
    if (name.startsWith('--')) return name;
    if (name === 'cssFloat') return 'float';
    return name.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

function makeStyle() {
    const map = new Map(), prio = new Map();
    const api = {
        setProperty(name, value, priority) {
            name = kebab(name);
            if (value === null || value === '' || value === undefined) { map.delete(name); prio.delete(name); return; }
            map.set(name, String(value));
            prio.set(name, priority || '');
        },
        getPropertyValue(name) { return map.has(kebab(name)) ? map.get(kebab(name)) : ''; },
        getPropertyPriority(name) { return prio.get(kebab(name)) || ''; },
        removeProperty(name) { const v = api.getPropertyValue(name); map.delete(kebab(name)); return v; },
        item(i) { return Array.from(map.keys())[i]; },
        get length() { return map.size; },
        get cssText() { return Array.from(map.entries()).map(([k, v]) => k + ': ' + v + (prio.get(k) ? ' !' + prio.get(k) : '') + ';').join(' '); },
        set cssText(text) {
            map.clear();
            prio.clear();
            String(text || '').split(';').forEach(part => {
                const m = /^\s*([-\w]+)\s*:\s*(.*?)\s*(!important)?\s*$/i.exec(part);
                if (m) api.setProperty(m[1], m[2], m[3] ? 'important' : '');
            });
        }
    };
    return new Proxy(api, {
        get(t, k) {
            if (k in t) return t[k];
            if (typeof k !== 'string') return undefined;
            return map.has(kebab(k)) ? map.get(kebab(k)) : '';
        },
        set(t, k, v) {
            if (k === 'cssText') { t.cssText = v; return true; }
            api.setProperty(k, v === '' ? null : v);
            return true;
        }
    });
}

class FakeElement extends FakeNode {
    constructor(doc, tag, nodeType) {
        super(doc);
        this.nodeType = nodeType || 1;
        this.localName = String(tag).toLowerCase();
        this.tagName = this.nodeType === 11 ? '#document-fragment' : String(tag).toUpperCase();
        this.nodeName = this.tagName;
        this._attrs = new Map();
        this.style = makeStyle();
        this.scrollTop = 0;
        this.scrollLeft = 0;
        this._props = {};
    }
    getAttribute(n) { n = String(n).toLowerCase(); return this._attrs.has(n) ? this._attrs.get(n) : null; }
    setAttribute(n, v) {
        n = String(n).toLowerCase();
        if (n === 'style') { this.style.cssText = v; }
        this._attrs.set(n, String(v));
    }
    removeAttribute(n) { n = String(n).toLowerCase(); this._attrs.delete(n); if (n === 'style') this.style.cssText = ''; }
    hasAttribute(n) { return this._attrs.has(String(n).toLowerCase()); }
    get attributes() { return Array.from(this._attrs.entries()).map(([name, value]) => ({name, value})); }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get classList() {
        const el = this;
        const list = () => el.className.split(/\s+/).filter(Boolean);
        const write = arr => el.setAttribute('class', arr.join(' '));
        return {
            add(...c) { const a = list(); c.forEach(x => { if (a.indexOf(x) < 0) a.push(x); }); write(a); },
            remove(...c) { write(list().filter(x => c.indexOf(x) < 0)); },
            contains(c) { return list().indexOf(c) >= 0; },
            toggle(c, on) {
                const has = list().indexOf(c) >= 0;
                const want = on === undefined ? !has : !!on;
                if (want && !has) this.add(c);
                if (!want && has) this.remove(c);
                return want;
            },
            replace(a, b) { if (this.contains(a)) { this.remove(a); this.add(b); } },
            item(i) { return list()[i] || null; },
            get length() { return list().length; },
            toString() { return el.className; },
            forEach(fn) { list().forEach(fn); }
        };
    }
    get dataset() {
        const el = this;
        return new Proxy({}, {
            get(t, k) { return typeof k === 'string' ? (el.getAttribute('data-' + kebab(k)) === null ? undefined : el.getAttribute('data-' + kebab(k))) : undefined; },
            set(t, k, v) { el.setAttribute('data-' + kebab(k), v); return true; },
            deleteProperty(t, k) { el.removeAttribute('data-' + kebab(k)); return true; }
        });
    }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get checked() { return '_checked' in this._props ? this._props._checked : this.hasAttribute('checked'); }
    set checked(v) { this._props._checked = !!v; }
    get value() { return '_value' in this._props ? this._props._value : (this.getAttribute('value') || ''); }
    set value(v) { this._props._value = String(v); }
    get title() { return this.getAttribute('title') || ''; }
    set title(v) { this.setAttribute('title', v); }
    get type() { return this.getAttribute('type') || ''; }
    set type(v) { this.setAttribute('type', v); }
    get tabIndex() { const v = this.getAttribute('tabindex'); return v === null ? -1 : +v; }
    set tabIndex(v) { this.setAttribute('tabindex', v); }
    get href() { return this.getAttribute('href') || ''; }
    set href(v) { this.setAttribute('href', v); }
    get name() { return this.getAttribute('name') || ''; }
    set name(v) { this.setAttribute('name', v); }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
    get nextElementSibling() {
        for (let n = this.nextSibling; n; n = n.nextSibling) if (n.nodeType === 1) return n;
        return null;
    }
    get previousElementSibling() {
        for (let n = this.previousSibling; n; n = n.previousSibling) if (n.nodeType === 1) return n;
        return null;
    }
    get innerHTML() { return this.childNodes.map(serialize).join(''); }
    set innerHTML(html) {
        this.childNodes.slice().forEach(n => this.removeChild(n));
        parseHTML(this.ownerDocument, String(html == null ? '' : html)).forEach(n => this.appendChild(n));
    }
    get outerHTML() { return serialize(this); }
    get innerText() { return this.textContent; }
    set innerText(v) { this.textContent = v; }
    insertAdjacentHTML(pos, html) {
        parseHTML(this.ownerDocument, html).forEach(n => this.insertAdjacentElement(pos, n));
    }
    insertAdjacentElement(pos, el) {
        pos = String(pos).toLowerCase();
        if (pos === 'beforebegin') this.parentNode && this.parentNode.insertBefore(el, this);
        else if (pos === 'afterbegin') this.insertBefore(el, this.firstChild);
        else if (pos === 'beforeend') this.appendChild(el);
        else if (pos === 'afterend') this.parentNode && this.parentNode.insertBefore(el, this.nextSibling);
        return el;
    }
    insertAdjacentText(pos, text) { this.insertAdjacentElement(pos, this.ownerDocument.createTextNode(text)); }
    toNode(x) { return typeof x === 'string' ? this.ownerDocument.createTextNode(x) : x; }
    append(...nodes) { nodes.forEach(n => this.appendChild(this.toNode(n))); }
    prepend(...nodes) { const first = this.firstChild; nodes.forEach(n => this.insertBefore(this.toNode(n), first)); }
    before(...nodes) { const p = this.parentNode; if (p) nodes.forEach(n => p.insertBefore(this.toNode(n), this)); }
    after(...nodes) { const p = this.parentNode, next = this.nextSibling; if (p) nodes.forEach(n => p.insertBefore(this.toNode(n), next)); }
    replaceWith(...nodes) { const p = this.parentNode; if (!p) return; this.before(...nodes); p.removeChild(this); }
    replaceChildren(...nodes) { this.childNodes.slice().forEach(n => this.removeChild(n)); this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    descendants() {
        const out = [];
        const walk = n => n.childNodes.forEach(c => { if (c.nodeType === 1) { out.push(c); walk(c); } });
        walk(this);
        return out;
    }
    querySelectorAll(sel) { const list = parseSelector(sel); return this.descendants().filter(el => list.some(c => matchComplex(el, c))); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getElementsByTagName(tag) { tag = tag.toLowerCase(); return this.descendants().filter(el => tag === '*' || el.localName === tag); }
    getElementsByClassName(cls) { const want = cls.split(/\s+/).filter(Boolean); return this.descendants().filter(el => want.every(c => el.classList.contains(c))); }
    matches(sel) { return parseSelector(sel).some(c => matchComplex(this, c)); }
    closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
    click() { if (this.disabled) return; this.dispatchEvent(new FakeEvent('click', {bubbles: true, button: 0})); }
    focus() {
        const doc = this.ownerDocument;
        if (doc.activeElement === this) return;
        const prev = doc.activeElement;
        doc.activeElement = this;
        if (prev && prev !== doc.body) prev.dispatchEvent(new FakeEvent('blur'));
        this.dispatchEvent(new FakeEvent('focus'));
        this.dispatchEvent(new FakeEvent('focusin', {bubbles: true}));
    }
    blur() {
        const doc = this.ownerDocument;
        if (doc.activeElement !== this) return;
        doc.activeElement = doc.body;
        this.dispatchEvent(new FakeEvent('blur'));
        this.dispatchEvent(new FakeEvent('focusout', {bubbles: true}));
    }
    getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0}; }
    getClientRects() { return []; }
    get offsetWidth() { return 0; }
    get offsetHeight() { return 0; }
    get offsetLeft() { return 0; }
    get offsetTop() { return 0; }
    get clientWidth() { return 0; }
    get clientHeight() { return 0; }
    get scrollWidth() { return 0; }
    get scrollHeight() { return 0; }
    get offsetParent() { return this.parentElement; }
    scrollIntoView() {}
    scrollTo() {}
    setPointerCapture() {}
    releasePointerCapture() {}
    hasPointerCapture() { return false; }
    animate() { return {finished: Promise.resolve(), cancel() {}, onfinish: null}; }
    cloneNode(deep) {
        const c = new FakeElement(this.ownerDocument, this.localName, this.nodeType);
        this._attrs.forEach((v, k) => c.setAttribute(k, v));
        if (deep) this.childNodes.forEach(n => c.appendChild(n.cloneNode(true)));
        return c;
    }
}

function serialize(n) {
    if (n.nodeType === 3) return escapeText(n.data);
    if (n.nodeType === 8) return '<!--' + n.data + '-->';
    const attrs = Array.from(n._attrs.entries()).map(([k, v]) => ' ' + k + '="' + String(v).replace(/"/g, '&quot;') + '"').join('');
    if (VOID.has(n.localName)) return '<' + n.localName + attrs + '>';
    return '<' + n.localName + attrs + '>' + n.childNodes.map(serialize).join('') + '</' + n.localName + '>';
}

function parseHTML(doc, html) {
    const root = new FakeElement(doc, '#fragment', 11);
    const stack = [root];
    const re = /<!--([\s\S]*?)-->|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
    let m;
    while ((m = re.exec(html))) {
        const top = stack[stack.length - 1];
        if (m[1] !== undefined) top.appendChild(new FakeText(doc, m[1], 8));
        else if (m[2]) {
            const tag = m[2].toLowerCase();
            for (let k = stack.length - 1; k > 0; k--) {
                if (stack[k].localName === tag) { stack.length = k; break; }
            }
        } else if (m[3]) {
            const el = new FakeElement(doc, m[3]);
            const attrRe = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
            let a;
            while ((a = attrRe.exec(m[4] || ''))) {
                const v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
                el.setAttribute(a[1], decode(v));
            }
            top.appendChild(el);
            if (!m[5] && !VOID.has(el.localName)) stack.push(el);
        } else if (m[6] !== undefined) top.appendChild(new FakeText(doc, decode(m[6])));
        else if (m[7]) top.appendChild(new FakeText(doc, '<'));
    }
    return root.childNodes.slice();
}

/* Selectors: compound parts, the combinators " ", ">", "+", "~", attributes and several pseudo-classes. */
const selectorCache = new Map();
function parseSelector(sel) {
    sel = String(sel).trim();
    if (selectorCache.has(sel)) return selectorCache.get(sel);
    const list = splitTop(sel, ',').map(parseComplex);
    selectorCache.set(sel, list);
    return list;
}

function parseComplex(s) {
    const parts = [];
    let i = 0, comb = null;
    s = s.trim();
    while (i < s.length) {
        const ws = /^\s*([>+~])?\s*/.exec(s.slice(i));
        if (parts.length) {
            if (ws[1]) comb = ws[1];
            else if (ws[0].length) comb = ' ';
        }
        i += ws[0].length;
        if (i >= s.length) break;
        const comp = {tag: null, id: null, classes: [], attrs: [], pseudos: []};
        let any = false;
        while (i < s.length) {
            const rest = s.slice(i);
            let m;
            if ((m = /^\*/.exec(rest))) { any = true; }
            else if ((m = /^[a-zA-Z][\w-]*/.exec(rest)) && !any && !comp.tag && !comp.id && !comp.classes.length) { comp.tag = m[0].toLowerCase(); }
            else if ((m = /^#([\w-]+)/.exec(rest))) { comp.id = m[1]; }
            else if ((m = /^\.([\w-]+)/.exec(rest))) { comp.classes.push(m[1]); }
            else if ((m = /^\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/.exec(rest))) {
                comp.attrs.push({name: m[1].toLowerCase(), op: m[2] || null, value: m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5]});
            } else if ((m = /^::?([\w-]+)(?:\(((?:[^()]|\([^()]*\))*)\))?/.exec(rest))) {
                comp.pseudos.push({name: m[1].toLowerCase(), arg: m[2]});
            } else break;
            i += m[0].length;
        }
        parts.push({comb: parts.length ? comb || ' ' : null, comp});
        comb = null;
    }
    return parts;
}

function visibleEl(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
        if (n.hidden || n.style.getPropertyValue('display') === 'none') return false;
    }
    return el.isConnected;
}

function matchCompound(el, c) {
    if (!el || el.nodeType !== 1) return false;
    if (c.tag && el.localName !== c.tag) return false;
    if (c.id && el.id !== c.id) return false;
    for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
    for (const a of c.attrs) {
        const v = el.getAttribute(a.name);
        if (v === null) return false;
        if (!a.op) continue;
        const want = a.value || '';
        if (a.op === '=' && v !== want) return false;
        if (a.op === '~=' && v.split(/\s+/).indexOf(want) < 0) return false;
        if (a.op === '^=' && !v.startsWith(want)) return false;
        if (a.op === '$=' && !v.endsWith(want)) return false;
        if (a.op === '*=' && v.indexOf(want) < 0) return false;
        if (a.op === '|=' && v !== want && !v.startsWith(want + '-')) return false;
    }
    for (const p of c.pseudos) {
        const parent = el.parentNode;
        const sibs = parent ? parent.childNodes.filter(n => n.nodeType === 1) : [el];
        switch (p.name) {
        case 'not': if (el.matches(p.arg)) return false; break;
        case 'has': if (!el.querySelector(p.arg)) return false; break;
        case 'first-child': if (sibs[0] !== el) return false; break;
        case 'last-child': if (sibs[sibs.length - 1] !== el) return false; break;
        case 'checked': if (!el.checked) return false; break;
        case 'disabled': if (!el.disabled) return false; break;
        case 'enabled': if (el.disabled) return false; break;
        case 'visible': if (!visibleEl(el)) return false; break;
        case 'hidden': if (visibleEl(el)) return false; break;
        case 'focus': if (el.ownerDocument.activeElement !== el) return false; break;
        case 'scope': break;
        default: return false;
        }
    }
    return true;
}

function matchComplex(el, parts, k) {
    k = k === undefined ? parts.length - 1 : k;
    if (!matchCompound(el, parts[k].comp)) return false;
    if (k === 0) return true;
    const comb = parts[k].comb;
    if (comb === '>') return matchComplex(el.parentNode, parts, k - 1);
    if (comb === '+') return matchComplex(el.previousElementSibling, parts, k - 1);
    if (comb === '~') {
        for (let n = el.previousElementSibling; n; n = n.previousElementSibling) if (matchComplex(n, parts, k - 1)) return true;
        return false;
    }
    for (let n = el.parentNode; n && n.nodeType === 1; n = n.parentNode) if (matchComplex(n, parts, k - 1)) return true;
    return false;
}

class FakeDocument extends FakeNode {
    constructor() {
        super(null);
        this.ownerDocument = this;
        this.nodeType = 9;
        this.nodeName = '#document';
        this.documentElement = new FakeElement(this, 'html');
        this.head = new FakeElement(this, 'head');
        this.body = new FakeElement(this, 'body');
        this.appendChild(this.documentElement);
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        this.activeElement = this.body;
        this.readyState = 'complete';
        this.defaultView = null;
        this.hidden = false;
        this.visibilityState = 'visible';
    }
    createElement(tag) { return new FakeElement(this, tag); }
    createElementNS(ns, tag) { return new FakeElement(this, tag); }
    createTextNode(t) { return new FakeText(this, t); }
    createComment(t) { return new FakeText(this, t, 8); }
    createDocumentFragment() { return new FakeElement(this, '#fragment', 11); }
    createEvent() { return new FakeEvent(''); }
    createRange() { return {selectNodeContents() {}, setStart() {}, setEnd() {}, collapse() {}, getBoundingClientRect() { return {left: 0, top: 0, width: 0, height: 0}; }}; }
    getElementById(id) {
        if (!id) return null;
        const all = this.documentElement.descendants();
        return all.find(el => el.id === String(id)) || null;
    }
    querySelectorAll(sel) {
        const list = parseSelector(sel);
        return [this.documentElement].concat(this.documentElement.descendants()).filter(el => list.some(c => matchComplex(el, c)));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getElementsByTagName(tag) { return this.documentElement.getElementsByTagName(tag); }
    getElementsByClassName(cls) { return this.documentElement.getElementsByClassName(cls); }
    elementFromPoint() { return null; }
    hasFocus() { return true; }
    execCommand() { return false; }
    getSelection() { return {removeAllRanges() {}, addRange() {}, rangeCount: 0, toString() { return ''; }}; }
}

/* --- A jQuery subset -------------------------------------------------------- */

function makeJQuery(doc, win) {
    const store = new WeakMap();
    const dataOf = el => { if (!store.has(el)) store.set(el, {}); return store.get(el); };

    function wrap(list) {
        const jq = new JQ(list);
        return new Proxy(jq, {
            get(t, k, recv) {
                if (k in t || typeof k === 'symbol') return Reflect.get(t, k, recv);
                if (/^\d+$/.test(k)) return t.els[+k];
                return function () { return recv; };
            }
        });
    }

    function toNodes(content) {
        if (content == null || content === false) return [];
        if (typeof content === 'string') return parseHTML(doc, content);
        if (typeof content === 'number') return [doc.createTextNode(String(content))];
        if (content instanceof JQ || (content && content.__jq)) return content.els.slice();
        if (Array.isArray(content)) return content.reduce((a, c) => a.concat(toNodes(c)), []);
        if (content.nodeType) return [content];
        return [];
    }

    function $(sel, ctx) {
        if (sel == null || sel === '') return wrap([]);
        if (sel && sel.__jq) return sel;
        if (typeof sel === 'function') { win.setTimeout(() => sel($), 0); return wrap([doc]); }
        if (typeof sel === 'string') {
            const s = sel.trim();
            if (s[0] === '<') {
                const nodes = parseHTML(doc, s).filter(n => n.nodeType === 1);
                const out = wrap(nodes);
                if (ctx && typeof ctx === 'object' && !ctx.nodeType && !ctx.__jq) {
                    for (const k of Object.keys(ctx)) {
                        if (typeof out[k] === 'function' && k !== 'length') out[k](ctx[k]);
                        else out.attr(k, ctx[k]);
                    }
                }
                return out;
            }
            const base = ctx ? $(ctx) : wrap([doc]);
            return base.find(s);
        }
        if (sel === win || sel.nodeType) return wrap([sel]);
        if (Array.isArray(sel)) return wrap(sel.filter(Boolean));
        if (typeof sel.length === 'number') return wrap(Array.from(sel));
        return wrap([sel]);
    }

    function matchesSel(el, sel) {
        if (typeof sel === 'function') return !!sel.call(el, 0, el);
        if (sel && sel.nodeType) return el === sel;
        if (sel && sel.__jq) return sel.els.indexOf(el) >= 0;
        return el && el.nodeType === 1 && el.matches(sel);
    }

    class JQ {
        constructor(list) {
            this.els = [];
            (list || []).forEach(e => { if (e && this.els.indexOf(e) < 0) this.els.push(e); });
            this.__jq = true;
        }
        get length() { return this.els.length; }
        [Symbol.iterator]() { return this.els[Symbol.iterator](); }
        each(fn) { this.els.forEach((e, i) => fn.call(e, i, e)); return wrap(this.els); }
        map(fn) { const out = []; this.els.forEach((e, i) => { const r = fn.call(e, i, e); if (r != null) out.push(...(Array.isArray(r) ? r : [r])); }); const w = wrap(out); w.get = i => (i === undefined ? out.slice() : out[i < 0 ? out.length + i : i]); return w; }
        get(i) { return i === undefined ? this.els.slice() : this.els[i < 0 ? this.els.length + i : i]; }
        toArray() { return this.els.slice(); }
        eq(i) { return wrap([this.els[i < 0 ? this.els.length + i : i]]); }
        first() { return wrap(this.els.slice(0, 1)); }
        last() { return wrap(this.els.slice(-1)); }
        slice(a, b) { return wrap(this.els.slice(a, b)); }
        end() { return wrap(this.els); }
        add(sel) { return wrap(this.els.concat($(sel).els)); }
        find(sel) {
            if (sel && (sel.nodeType || sel.__jq)) {
                const cand = $(sel).els;
                return wrap(cand.filter(c => this.els.some(e => e !== c && e.contains(c))));
            }
            const out = [];
            this.els.forEach(e => { if (e.querySelectorAll) out.push(...e.querySelectorAll(sel)); });
            return wrap(out);
        }
        children(sel) { const out = []; this.els.forEach(e => (e.children || []).forEach(c => { if (!sel || c.matches(sel)) out.push(c); })); return wrap(out); }
        contents() { const out = []; this.els.forEach(e => out.push(...e.childNodes)); return wrap(out); }
        parent(sel) { return wrap(this.els.map(e => e.parentNode).filter(p => p && p.nodeType === 1 && (!sel || p.matches(sel)))); }
        parents(sel) {
            const out = [];
            this.els.forEach(e => { for (let p = e.parentNode; p && p.nodeType === 1; p = p.parentNode) if (!sel || p.matches(sel)) out.push(p); });
            return wrap(out);
        }
        closest(sel) { return wrap(this.els.map(e => (e.closest ? (typeof sel === 'string' ? e.closest(sel) : (function () { for (let n = e; n; n = n.parentNode) if (matchesSel(n, sel)) return n; return null; })()) : null)).filter(Boolean)); }
        siblings(sel) { const out = []; this.els.forEach(e => e.parentNode && e.parentNode.children.forEach(c => { if (c !== e && (!sel || c.matches(sel))) out.push(c); })); return wrap(out); }
        next(sel) { return wrap(this.els.map(e => e.nextElementSibling).filter(n => n && (!sel || n.matches(sel)))); }
        prev(sel) { return wrap(this.els.map(e => e.previousElementSibling).filter(n => n && (!sel || n.matches(sel)))); }
        nextAll(sel) { const out = []; this.els.forEach(e => { for (let n = e.nextElementSibling; n; n = n.nextElementSibling) if (!sel || n.matches(sel)) out.push(n); }); return wrap(out); }
        prevAll(sel) { const out = []; this.els.forEach(e => { for (let n = e.previousElementSibling; n; n = n.previousElementSibling) if (!sel || n.matches(sel)) out.push(n); }); return wrap(out); }
        filter(sel) { return wrap(this.els.filter((e, i) => (typeof sel === 'function' ? sel.call(e, i, e) : matchesSel(e, sel)))); }
        not(sel) { return wrap(this.els.filter((e, i) => !(typeof sel === 'function' ? sel.call(e, i, e) : matchesSel(e, sel)))); }
        is(sel) { return this.els.some(e => matchesSel(e, sel)); }
        has(sel) { return wrap(this.els.filter(e => e.querySelector && e.querySelector(sel))); }
        index(x) {
            if (x === undefined) { const e = this.els[0]; return e && e.parentNode ? e.parentNode.children.indexOf(e) : -1; }
            const el = x.__jq ? x.els[0] : x;
            return this.els.indexOf(el);
        }
        on(types, sel, data, fn) {
            if (types && typeof types === 'object') { Object.keys(types).forEach(t => this.on(t, sel, data, types[t])); return wrap(this.els); }
            if (fn === undefined && data === undefined) { fn = sel; sel = null; }
            else if (fn === undefined) {
                if (typeof sel === 'string') { fn = data; data = undefined; } else { fn = data; data = sel; sel = null; }
            }
            if (typeof fn !== 'function') return wrap(this.els);
            String(types).split(/\s+/).filter(Boolean).forEach(full => {
                const [type, ...ns] = full.split('.');
                this.els.forEach(el => {
                    const handler = function (e) {
                        let ctxEl = el;
                        if (sel) {
                            ctxEl = null;
                            for (let n = e.target; n && n !== el; n = n.parentNode) if (n.nodeType === 1 && n.matches(sel)) { ctxEl = n; break; }
                            if (!ctxEl) return;
                        }
                        if (data !== undefined) e.data = data;
                        const r = fn.apply(ctxEl, [e].concat(e._jqArgs || []));
                        if (r === false) { e.preventDefault(); e.stopPropagation(); }
                    };
                    const d = dataOf(el);
                    (d.__events = d.__events || []).push({type, ns, sel, fn, handler});
                    if (el.addEventListener) el.addEventListener(type, handler);
                });
            });
            return wrap(this.els);
        }
        one(types, sel, fn) {
            if (fn === undefined) { fn = sel; sel = null; }
            const me = this;
            const once = function (e) { me.off(types, sel, once); return fn.apply(this, arguments); };
            return this.on(types, sel, once);
        }
        off(types, sel, fn) {
            if (typeof sel === 'function') { fn = sel; sel = null; }
            const specs = types ? String(types).split(/\s+/).filter(Boolean).map(f => { const [type, ...ns] = f.split('.'); return {type, ns}; }) : [{type: '', ns: []}];
            this.els.forEach(el => {
                const d = dataOf(el);
                d.__events = (d.__events || []).filter(h => {
                    const hit = specs.some(s => (!s.type || s.type === h.type) && s.ns.every(n => h.ns.indexOf(n) >= 0)) &&
                        (!fn || h.fn === fn) && (!sel || h.sel === sel);
                    if (hit && el.removeEventListener) el.removeEventListener(h.type, h.handler);
                    return !hit;
                });
            });
            return wrap(this.els);
        }
        trigger(type, args) {
            const ev = typeof type === 'string' ? new FakeEvent(type.split('.')[0], {bubbles: true}) : type;
            ev._jqArgs = args === undefined ? [] : Array.isArray(args) ? args : [args];
            this.els.forEach(el => {
                if (!el.dispatchEvent) return;
                el.dispatchEvent(ev);
                if (!ev.defaultPrevented && (ev.type === 'focus' || ev.type === 'blur') && typeof el[ev.type] === 'function') el[ev.type]();
            });
            return wrap(this.els);
        }
        triggerHandler(type, args) {
            const el = this.els[0];
            if (!el) return undefined;
            const ev = new FakeEvent(type);
            ev.target = el;
            ev._jqArgs = args === undefined ? [] : Array.isArray(args) ? args : [args];
            let r;
            (dataOf(el).__events || []).filter(h => h.type === type).forEach(h => { r = h.handler.call(el, ev); });
            return r;
        }
        attr(name, val) {
            if (name && typeof name === 'object') { Object.keys(name).forEach(k => this.attr(k, name[k])); return wrap(this.els); }
            if (val === undefined) { const e = this.els[0]; if (!e || !e.getAttribute) return undefined; const v = e.getAttribute(name); return v === null ? undefined : v; }
            this.els.forEach((e, i) => {
                if (!e.setAttribute) return;
                const v = typeof val === 'function' ? val.call(e, i, e.getAttribute(name)) : val;
                if (v === null || v === false && !/^aria-|^data-/.test(name)) e.removeAttribute(name);
                else e.setAttribute(name, v === true ? name : v);
            });
            return wrap(this.els);
        }
        removeAttr(names) { String(names).split(/\s+/).forEach(n => this.els.forEach(e => e.removeAttribute && e.removeAttribute(n))); return wrap(this.els); }
        prop(name, val) {
            if (name && typeof name === 'object') { Object.keys(name).forEach(k => this.prop(k, name[k])); return wrap(this.els); }
            if (val === undefined) { const e = this.els[0]; return e ? e[name] : undefined; }
            this.els.forEach(e => { e[name] = val; });
            return wrap(this.els);
        }
        removeProp(name) { this.els.forEach(e => { delete e[name]; }); return wrap(this.els); }
        data(key, val) {
            const e = this.els[0];
            if (key === undefined) return e ? dataOf(e) : undefined;
            if (key && typeof key === 'object') { this.els.forEach(el => Object.assign(dataOf(el), key)); return wrap(this.els); }
            if (val === undefined) {
                if (!e) return undefined;
                const d = dataOf(e);
                if (key in d) return d[key];
                const raw = e.getAttribute && e.getAttribute('data-' + kebab(key));
                if (raw === null || raw === undefined) return undefined;
                if (raw === 'true') return true;
                if (raw === 'false') return false;
                if (raw !== '' && !isNaN(+raw)) return +raw;
                return raw;
            }
            this.els.forEach(el => { dataOf(el)[key] = val; });
            return wrap(this.els);
        }
        removeData(key) { this.els.forEach(el => { if (key === undefined) store.delete(el); else delete dataOf(el)[key]; }); return wrap(this.els); }
        addClass(c) {
            this.els.forEach((e, i) => { if (!e.classList) return; const v = typeof c === 'function' ? c.call(e, i, e.className) : c; String(v || '').split(/\s+/).filter(Boolean).forEach(x => e.classList.add(x)); });
            return wrap(this.els);
        }
        removeClass(c) {
            this.els.forEach((e, i) => {
                if (!e.classList) return;
                if (c === undefined) { e.className = ''; return; }
                const v = typeof c === 'function' ? c.call(e, i, e.className) : c;
                String(v || '').split(/\s+/).filter(Boolean).forEach(x => e.classList.remove(x));
            });
            return wrap(this.els);
        }
        toggleClass(c, state) {
            this.els.forEach(e => { if (!e.classList) return; String(c || '').split(/\s+/).filter(Boolean).forEach(x => e.classList.toggle(x, state === undefined ? undefined : !!state)); });
            return wrap(this.els);
        }
        hasClass(c) { return this.els.some(e => e.classList && e.classList.contains(c)); }
        css(name, val) {
            if (name && typeof name === 'object') { Object.keys(name).forEach(k => this.css(k, name[k])); return wrap(this.els); }
            if (val === undefined) {
                const e = this.els[0];
                if (!e || !e.style) return undefined;
                const v = e.style.getPropertyValue(kebab(name));
                return v !== '' ? v : win.getComputedStyle(e).getPropertyValue(kebab(name));
            }
            this.els.forEach(e => {
                if (!e.style) return;
                const v = typeof val === 'number' && !/^(opacity|z-index|zIndex|flex|order|font-weight|fontWeight|line-height|lineHeight)$/.test(name) ? val + 'px' : val;
                e.style.setProperty(kebab(name), v === '' || v === null ? null : String(v));
            });
            return wrap(this.els);
        }
        show() { this.els.forEach(e => { if (e.style) { e.style.removeProperty('display'); } }); return wrap(this.els); }
        hide() { this.els.forEach(e => { if (e.style) e.style.setProperty('display', 'none'); }); return wrap(this.els); }
        toggle(state) {
            if (typeof state === 'function') return wrap(this.els);
            this.els.forEach(e => { const show = state === undefined ? e.style.getPropertyValue('display') === 'none' : !!state; if (show) e.style.removeProperty('display'); else e.style.setProperty('display', 'none'); });
            return wrap(this.els);
        }
        dim(name, val) {
            if (val === undefined) { const e = this.els[0]; if (!e || !e.style) return 0; return parseFloat(e.style.getPropertyValue(name)) || 0; }
            return this.css(name, typeof val === 'number' ? val + 'px' : val);
        }
        width(v) { return this.dim('width', v); }
        height(v) { return this.dim('height', v); }
        innerWidth(v) { return this.dim('width', v); }
        innerHeight(v) { return this.dim('height', v); }
        outerWidth(v) { return typeof v === 'boolean' || v === undefined ? this.dim('width') : this.dim('width', v); }
        outerHeight(v) { return typeof v === 'boolean' || v === undefined ? this.dim('height') : this.dim('height', v); }
        offset() { return {top: 0, left: 0}; }
        position() { return {top: 0, left: 0}; }
        scrollTop(v) { if (v === undefined) return this.els[0] ? this.els[0].scrollTop || 0 : 0; this.els.forEach(e => { e.scrollTop = v; }); return wrap(this.els); }
        scrollLeft(v) { if (v === undefined) return this.els[0] ? this.els[0].scrollLeft || 0 : 0; this.els.forEach(e => { e.scrollLeft = v; }); return wrap(this.els); }
        html(v) {
            if (v === undefined) return this.els[0] ? this.els[0].innerHTML : undefined;
            this.els.forEach((e, i) => {
                const val = typeof v === 'function' ? v.call(e, i, e.innerHTML) : v;
                if (val && (val.nodeType || val.__jq)) { e.innerHTML = ''; toNodes(val).forEach(n => e.appendChild(n)); }
                else e.innerHTML = val == null ? '' : String(val);
            });
            return wrap(this.els);
        }
        text(v) {
            if (v === undefined) return this.els.map(e => e.textContent).join('');
            this.els.forEach((e, i) => { e.textContent = typeof v === 'function' ? v.call(e, i, e.textContent) : (v == null ? '' : String(v)); });
            return wrap(this.els);
        }
        val(v) {
            if (v === undefined) return this.els[0] ? this.els[0].value : undefined;
            this.els.forEach(e => { e.value = v; });
            return wrap(this.els);
        }
        empty() { this.els.forEach(e => { e.childNodes.slice().forEach(n => e.removeChild(n)); }); return wrap(this.els); }
        remove() { this.els.forEach(e => { if (e.parentNode) e.parentNode.removeChild(e); store.delete(e); }); return wrap(this.els); }
        detach() { this.els.forEach(e => { if (e.parentNode) e.parentNode.removeChild(e); }); return wrap(this.els); }
        insertInto(target, ref, args) {
            const nodes = [];
            args.forEach(a => nodes.push(...toNodes(typeof a === 'function' ? a.call(target, 0) : a)));
            nodes.forEach(n => target.insertBefore(n, ref));
        }
        append(...args) { this.els.forEach((e, i) => this.insertInto(e, null, i ? args.map(cloneContent) : args)); return wrap(this.els); }
        prepend(...args) { this.els.forEach((e, i) => this.insertInto(e, e.firstChild, i ? args.map(cloneContent) : args)); return wrap(this.els); }
        after(...args) { this.els.forEach(e => e.parentNode && this.insertInto(e.parentNode, e.nextSibling, args)); return wrap(this.els); }
        before(...args) { this.els.forEach(e => e.parentNode && this.insertInto(e.parentNode, e, args)); return wrap(this.els); }
        appendTo(t) { const target = $(t).els[0]; if (target) this.els.forEach(e => target.appendChild(e)); return wrap(this.els); }
        prependTo(t) { const target = $(t).els[0]; if (target) { const first = target.firstChild; this.els.forEach(e => target.insertBefore(e, first)); } return wrap(this.els); }
        insertAfter(t) { const target = $(t).els[0]; if (target && target.parentNode) { const next = target.nextSibling; this.els.forEach(e => target.parentNode.insertBefore(e, next)); } return wrap(this.els); }
        insertBefore(t) { const target = $(t).els[0]; if (target && target.parentNode) this.els.forEach(e => target.parentNode.insertBefore(e, target)); return wrap(this.els); }
        replaceWith(content) { this.els.forEach(e => { if (!e.parentNode) return; this.insertInto(e.parentNode, e, [content]); e.parentNode.removeChild(e); }); return wrap(this.els); }
        clone() { return wrap(this.els.map(e => e.cloneNode(true))); }
        wrapInner() { return wrap(this.els); }
        focus(fn) { if (typeof fn === 'function') return this.on('focus', fn); this.els.forEach(e => e.focus && e.focus()); return wrap(this.els); }
        blur(fn) { if (typeof fn === 'function') return this.on('blur', fn); this.els.forEach(e => e.blur && e.blur()); return wrap(this.els); }
        hover(a, b) { return this.on('mouseenter', a).on('mouseleave', b || a); }
        promise() { return {done(fn) { fn && fn(); return this; }, then(fn) { fn && fn(); return this; }}; }
        stop() { return wrap(this.els); }
        animate(props, a, b, c) { this.css(props || {}); const cb = [a, b, c].find(x => typeof x === 'function'); cb && cb(); return wrap(this.els); }
        fadeIn(a, b) { this.show(); const cb = [a, b].find(x => typeof x === 'function'); cb && cb(); return wrap(this.els); }
        fadeOut(a, b) { this.hide(); const cb = [a, b].find(x => typeof x === 'function'); cb && cb(); return wrap(this.els); }
    }
    function cloneContent(a) { return a && (a.nodeType || a.__jq) ? toNodes(a).map(n => n.cloneNode(true)) : a; }

    ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
        'keydown', 'keyup', 'keypress', 'change', 'input', 'submit', 'scroll', 'resize', 'contextmenu', 'wheel',
        'focusin', 'focusout', 'select'].forEach(type => {
        JQ.prototype[type] = function (fn) {
            if (typeof fn === 'function') return this.on(type, fn);
            if (type === 'click') { this.els.forEach(e => e.click && e.click()); return wrap(this.els); }
            return this.trigger(type);
        };
    });

    $.fn = JQ.prototype;
    $.extend = function () {
        const args = Array.from(arguments);
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
    $.each = (obj, fn) => {
        if (Array.isArray(obj) || (obj && typeof obj.length === 'number' && typeof obj !== 'function')) { for (let i = 0; i < obj.length; i++) if (fn.call(obj[i], i, obj[i]) === false) break; }
        else if (obj) for (const k of Object.keys(obj)) if (fn.call(obj[k], k, obj[k]) === false) break;
        return obj;
    };
    $.map = (arr, fn) => { const out = []; $.each(arr, (i, v) => { const r = fn(v, i); if (r != null) out.push(...(Array.isArray(r) ? r : [r])); }); return out; };
    $.grep = (arr, fn, inv) => Array.from(arr).filter((v, i) => !!fn(v, i) !== !!inv);
    $.inArray = (v, arr) => (arr ? Array.from(arr).indexOf(v) : -1);
    $.isArray = Array.isArray;
    $.isFunction = f => typeof f === 'function';
    $.isPlainObject = o => !!o && typeof o === 'object' && (Object.getPrototypeOf(o) === null || Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o).constructor.name === 'Object');
    $.isEmptyObject = o => !o || Object.keys(o).length === 0;
    $.isNumeric = v => !isNaN(parseFloat(v)) && isFinite(v);
    $.type = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    $.trim = s => String(s == null ? '' : s).trim();
    $.noop = () => {};
    $.now = () => Date.now();
    $.proxy = (fn, ctx) => (typeof ctx === 'string' ? fn[ctx].bind(fn) : fn.bind(ctx));
    $.contains = (a, b) => a !== b && a.contains(b);
    $.merge = (a, b) => { Array.prototype.push.apply(a, Array.from(b)); return a; };
    $.makeArray = a => Array.from(a || []);
    $.Event = (type, props) => Object.assign(new FakeEvent(type, {bubbles: true}), props || {});
    $.Deferred = function () {
        let state = 'pending', value;
        const cbs = {done: [], fail: [], always: []};
        const d = {
            resolve(...v) { if (state === 'pending') { state = 'resolved'; value = v; cbs.done.concat(cbs.always).forEach(f => f(...v)); } return d; },
            reject(...v) { if (state === 'pending') { state = 'rejected'; value = v; cbs.fail.concat(cbs.always).forEach(f => f(...v)); } return d; },
            done(f) { if (state === 'resolved') f(...value); else cbs.done.push(f); return d; },
            fail(f) { if (state === 'rejected') f(...value); else cbs.fail.push(f); return d; },
            always(f) { if (state !== 'pending') f(...value); else cbs.always.push(f); return d; },
            then(a, b) { if (a) d.done(a); if (b) d.fail(b); return d; },
            state() { return state; },
            promise() { return d; }
        };
        return d;
    };
    $.when = (...a) => $.Deferred().resolve(...a);
    $.ajax = () => $.Deferred();
    $.browser = {};
    $.support = {};
    $.cssHooks = {};
    $.expr = {pseudos: {}, ':': {}};
    return $;
}

/* --- Stock editor stubs --------------------------------------------------------- */

const SELECT = {Paragraph: 0, Table: 1, Image: 2, Header: 3, Hyperlink: 4, SpellCheck: 5, Shape: 6, Slide: 7, Chart: 8, Math: 9, MailMerge: 10, ContentControl: 11, Animation: 12};
const PANE = {Paragraph: 0, Table: 1, Header: 2, TextArt: 3, Shape: 4, Image: 5, Slide: 6, Chart: 7, MailMerge: 8, Signature: 9};
const PANE_NAME = Object.fromEntries(Object.entries(PANE).map(([k, v]) => [v, k]));

/* A selection object value: everything not in the description is a getter that returns null. */
function props(own) {
    const base = Object.assign({
        get_Locked: () => false, get_LockDelete: () => false, get_LockRemove: () => false, get_LockLayout: () => false,
        get_LockBackground: () => false, get_LockTransition: () => false, get_IsMasterSelected: () => false,
        get_LayoutIndex: () => 0, asc_getIsMotionPath: () => false, asc_getTextArtProperties: () => null,
        get_FromChart: () => false, get_FromImage: () => false, get_FromGroup: () => false, get_FromSmartArt: () => false,
        get_ChartProperties: () => null, get_ShapeProperties: () => null, get_Type: () => null, get_CanFill: () => true,
        get_Width: () => 100, get_Height: () => 100, get_ImageUrl: () => null, get_ShapeProperties_: () => null
    }, own || {});
    return new Proxy(base, {
        get(t, k) {
            if (k in t) return t[k];
            if (typeof k !== 'string' || k === 'then' || k === 'toJSON') return undefined;
            return () => null;
        }
    });
}

function element(type, own) {
    const value = props(own);
    return {get_ObjectType: () => type, get_ObjectValue: () => value};
}

const SELECTIONS = {
    none: () => [element(SELECT.Slide)],
    text: () => [element(SELECT.Slide), element(SELECT.Shape, {asc_getTextArtProperties: () => null}), element(SELECT.Paragraph)],
    /* A shape with text: its properties have Text Art properties (the stock panel opens the Text Art tab). */
    textart: () => [element(SELECT.Slide), element(SELECT.Shape, {asc_getTextArtProperties: () => ({asc_getForm: () => 'textNoShape'})}),
        element(SELECT.Paragraph)],
    shape: () => [element(SELECT.Slide), element(SELECT.Shape)],
    image: () => [element(SELECT.Slide), element(SELECT.Image)],
    table: () => [element(SELECT.Slide), element(SELECT.Table), element(SELECT.Paragraph)],
    chart: () => {
        const chart = {getSeries: () => [1, 2], getType: () => 0};
        return [element(SELECT.Slide), element(SELECT.Chart, {get_ChartProperties: () => chart}),
            element(SELECT.Shape, {get_FromChart: () => true, get_ChartProperties: () => chart})];
    },
    line: () => [element(SELECT.Slide), element(SELECT.Shape, {get_Type: () => 'line', get_CanFill: () => false})]
};

const STOCK_DOM = `
<div id="loading-mask"></div>
<div id="viewport" role="main"><div class="layout-region">
  <div id="pe-preview" style="display:none"></div>
  <section class="layout-ct"><div id="file-menu-panel" style="display:none"></div></section>
  <div id="viewport-vbox-layout" class="layout-ct vbox">
    <section id="app-title" class="layout-item"></section>
    <div id="toolbar" class="layout-item" data-layout-name="toolbar" role="toolbar"><div class="toolbar"></div></div>
    <div class="layout-item middle">
      <div id="viewport-hbox-layout" class="layout-ct hbox">
        <div id="left-menu" class="layout-item" data-layout-name="leftMenu" style="width: 40px;">
          <div class="tool-menu-btns">
            <button id="left-btn-searchbar" class="btn btn-category"></button>
            <button id="left-btn-thumbs" class="btn btn-category"></button>
            <button id="left-btn-comments" class="btn btn-category"></button>
            <button id="left-btn-chat" class="btn btn-category"></button>
          </div>
          <div class="left-panel side-panel">
            <div id="left-panel-search" class="content-box" style="display: none;"></div>
            <div id="left-panel-comments" class="content-box" style="display: none;"></div>
            <div id="left-panel-chat" class="content-box" style="display: none;"></div>
          </div>
        </div>
        <div id="about-menu-panel" style="display:none"></div>
        <div id="editor-container" class="layout-item"><div id="editor_sdk">
          <div id="id_panel_thumbnails"><div id="id_thumbnails_background"></div><div id="id_thumbnails"></div></div>
          <div id="id_panel_thumbnails_split"></div>
          <div id="id_main_parent"><div id="id_main"><div id="id_main_view"><canvas id="id_viewer"></canvas></div></div>
            <div id="id_panel_notes"><canvas id="id_notes"></canvas><canvas id="id_notes_overlay"></canvas></div>
          </div>
        </div></div>
        <div id="right-menu" class="layout-item" data-layout-name="rightMenu">
          <div id="view-right-menu" class="tool-menu right">
            <div class="right-panel side-panel">
              <div class="content-box">
                <div id="id-slide-settings" class="settings-panel"></div>
                <div id="id-shape-settings" class="settings-panel"></div>
                <div id="id-image-settings" class="settings-panel"></div>
                <div id="id-table-settings" class="settings-panel"></div>
                <div id="id-paragraph-settings" class="settings-panel"></div>
                <div id="id-textart-settings" class="settings-panel"></div>
              </div>
            </div>
            <div class="tool-menu-btns"></div>
          </div>
        </div>
        <div id="left-panel-history" class="layout-item"></div>
      </div>
    </div>
    <div id="statusbar" class="layout-item" data-layout-name="statusBar"><div class="statusbar"></div></div>
  </div>
</div></div>`;

const THEME_COLORS = {
    type: 'light', name: 'theme-light',
    'background-normal': '#ffffff', 'background-toolbar': '#f7f7f7', 'background-toolbar-additional': '#efefef',
    'border-preview-select': '#888888', 'border-preview-hover': '#cccccc', 'text-normal': '#444444',
    'border-toolbar': '#cbcbcb', 'canvas-background': '#eeeeee', 'canvas-content-background': '#ffffff',
    'canvas-page-border': '#cccccc', 'highlight-button-hover': '#e0e0e0'
};

/* Values that the canvas sees on #editor_sdk under the shell (the shell's own colors). */
const SHELL_CANVAS = {
    '--background-toolbar': '#ffffff', '--border-preview-select': '#3a83db', '--border-preview-hover': '#c9d6e8',
    '--text-normal': '#1f2329', '--canvas-background': '#f1f2f4', '--canvas-content-background': '#ffffff',
    '--canvas-page-border': '#f1f2f4'
};

function createEnv(opts) {
    opts = opts || {};
    const env = {
        apiCalls: [], stockCalls: [], notes: [], callbacks: {}, logs: [], timers: [], panes: [], touches: [],
        opened: [], inStock: 0, loaded: {}, ctls: {}
    };
    const options = env.options = Object.assign({
        isEdit: true, canEdit: true, canCoAuthoring: true, canComments: true, canViewComments: true,
        canPrint: true, canDownload: true, canChat: true, canUseHistory: false, canRename: false,
        canRequestSharingSettings: false, canBrandingExt: false, isLightVersion: false, isOffline: false,
        user: {id: 'u1', fullname: 'Тест'}, customization: {}
    }, opts.options || {});

    const doc = new FakeDocument();
    const sandbox = {
        console: {
            log: (...a) => env.logs.push(a.map(String).join(' ')),
            info: (...a) => env.logs.push(a.map(String).join(' ')),
            warn: (...a) => env.logs.push(a.map(x => (x && x.stack) || String(x)).join(' ')),
            error: (...a) => env.logs.push(a.map(x => (x && x.stack) || String(x)).join(' ')),
            debug: () => {}, trace: () => {}, assert: () => {}, group: () => {}, groupEnd: () => {}, time: () => {}, timeEnd: () => {}
        },
        setTimeout: (fn, ms, ...a) => { if (typeof fn === 'function') env.timers.push(() => fn(...a)); return env.timers.length; },
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {},
        requestAnimationFrame: fn => { env.timers.push(() => fn(0)); return env.timers.length; },
        cancelAnimationFrame: () => {},
        queueMicrotask: fn => env.timers.push(fn),
        document: doc,
        navigator: {userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120', platform: 'MacIntel', language: 'ru', languages: ['ru']},
        location: {href: 'http://localhost/', search: '', hash: '', protocol: 'http:', host: 'localhost', origin: 'http://localhost', pathname: '/'},
        devicePixelRatio: 1, innerWidth: 1440, innerHeight: 900, outerWidth: 1440, outerHeight: 900,
        screen: {width: 1440, height: 900},
        matchMedia: () => ({matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}}),
        getComputedStyle: el => {
            const vars = el && el.id === 'editor_sdk' && doc.body.classList.contains('vo-compact') ? SHELL_CANVAS : {};
            return {
                getPropertyValue: name => {
                    const own = el && el.style ? el.style.getPropertyValue(name) : '';
                    if (own) return own;
                    return vars[name] !== undefined ? ' ' + vars[name] : '';
                },
                display: el && el.style && el.style.getPropertyValue('display') || 'block'
            };
        },
        Event: FakeEvent, CustomEvent: FakeEvent, MouseEvent: FakeEvent, KeyboardEvent: FakeEvent, WheelEvent: FakeEvent, FocusEvent: FakeEvent, PointerEvent: FakeEvent,
        MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
        Node: {ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9},
        HTMLElement: FakeElement, Element: FakeElement,
        Promise, Map, Set, WeakMap, WeakSet, Symbol, JSON, Math, Date, RegExp, Error, TypeError, Array, Object, String, Number, Boolean, Proxy, Reflect,
        parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
        Intl, structuredClone: globalThis.structuredClone
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.top = sandbox;
    sandbox.parent = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.addEventListener = (t, fn, o) => FakeNode.prototype.addEventListener.call(sandbox, t, fn, o);
    sandbox.removeEventListener = (t, fn, o) => FakeNode.prototype.removeEventListener.call(sandbox, t, fn, o);
    sandbox.dispatchEvent = ev => { const list = (sandbox._listeners[ev.type] || []).slice(); list.forEach(l => l.fn.call(sandbox, ev)); return !ev.defaultPrevented; };
    sandbox._listeners = {};
    doc.defaultView = sandbox;

    const ctx = vm.createContext(sandbox);
    env.context = sandbox;
    env.document = doc;

    const $ = makeJQuery(doc, sandbox);
    sandbox.$ = sandbox.jQuery = $;
    env.$ = $;

    const AMD = {};
    sandbox.define = function (a, b, c) {
        let deps = [], factory;
        if (typeof a === 'string') { deps = Array.isArray(b) ? b : []; factory = Array.isArray(b) ? c : b; }
        else if (typeof a === 'function') factory = a;
        else { deps = a || []; factory = b; }
        const args = deps.map(resolveDep);
        return typeof factory === 'function' ? factory.apply(sandbox, args) : factory;
    };
    sandbox.require = sandbox.requirejs = function (deps, cb) { if (Array.isArray(deps) && typeof cb === 'function') cb.apply(sandbox, deps.map(resolveDep)); };

    vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/underscore/underscore-umd.js'), 'utf8'), ctx, {filename: 'underscore-umd.js'});

    /* A surface accessed by name without a description here: a no-op function.
       It has no plugin item flag (isCustomItem exists only on Common.UI.MenuItemCustom). */
    const lenient = new Proxy(function () {}, {
        get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || k === 'isCustomItem' || typeof k === 'symbol' ? undefined : lenient),
        apply: () => undefined,
        construct: () => lenient
    });
    const soft = obj => new Proxy(obj, {
        get: (t, k) => (k in t || typeof k === 'symbol' || k === 'then' || k === 'toJSON' || k === 'isCustomItem' ? t[k] : lenient)
    });

    /* --- Spy and api ------------------------------------------------------- */
    const spy = env.spy = (name, fn) => function () {
        env.stockCalls.push({name, args: Array.from(arguments)});
        env.inStock++;
        try { return fn ? fn.apply(this, arguments) : undefined; } finally { env.inStock--; }
    };
    const NC = {
        _h: {},
        on(name, fn) {
            if (name && typeof name === 'object') { Object.keys(name).forEach(k => NC.on(k, name[k])); return; }
            String(name).split(/\s+/).forEach(n => (NC._h[n] = NC._h[n] || []).push(fn));
        },
        off(name, fn) { if (!NC._h[name]) return; NC._h[name] = fn ? NC._h[name].filter(f => f !== fn) : []; },
        trigger(name, ...args) {
            env.notes.push({name, args, stock: env.inStock > 0});
            (NC._h[name] || []).slice().forEach(f => f(...args));
        }
    };
    env.nc = NC;

    const apiReturns = {
        asc_IsLastSlideSelected: () => false, asc_IsFirstSlideSelected: () => false, asc_IsMasterMode: () => false,
        getCountPages: () => 3, getCurrentPage: () => 0, asc_getCountPages: () => 3, asc_getCurrentPage: () => 0,
        canEdit: () => options.isEdit, asc_canClearGuides: () => false, asc_getShowGuides: () => false,
        asc_getShowGridlines: () => false, asc_getSnapToGrid: () => false, asc_getGridSpacing: () => 360000,
        asc_GetSelectedText: () => '', getSelectedElements: () => env.selection, asc_getCurrentFocusObject: () => env.selection,
        asc_getZoom: () => 100, asc_isRestrictionAllowed: () => true, IsActionRestrictionPrev: () => false,
        isRestrictionComments: () => false, isRestrictionView: () => !options.isEdit, can_AddQuotedComment: () => true,
        asc_IsThumbnailsShow: () => true, asc_getNotesShow: () => true
    };
    /* Cursor in text (SlideSelection.typing): the text target of the slide controller is env.typing. */
    env.typing = false;
    const apiTarget = {
        WordControl: {m_oLogicDocument: {GetCurrentController: () => ({getTargetDocContent: () => (env.typing ? {} : null)})}},
        asc_registerCallback(name, fn) { (env.callbacks[name] = env.callbacks[name] || []).push(fn); },
        asc_unregisterCallback(name, fn) { if (env.callbacks[name]) env.callbacks[name] = env.callbacks[name].filter(f => f !== fn); }
    };
    const api = env.api = new Proxy(apiTarget, {
        get(t, k) {
            if (k in t) return t[k];
            if (typeof k !== 'string' || k === 'then' || k === 'toJSON') return undefined;
            return function () {
                const args = Array.from(arguments);
                env.apiCalls.push({name: k, args, stock: env.inStock > 0});
                return apiReturns[k] ? apiReturns[k](...args) : undefined;
            };
        }
    });
    env.fire = (name, ...args) => (env.callbacks[name] || []).slice().forEach(f => f(...args));
    env.selection = SELECTIONS.none();
    env.select = kind => {
        if (!SELECTIONS[kind]) throw new Error('нет выделения ' + kind);
        env.selection = SELECTIONS[kind]();
        env.fire('asc_onFocusObject', env.selection);
        env.drain();
    };

    /* --- Stock controls ------------------------------------------------------ */
    function emitter(obj) {
        obj._ev = {};
        obj.on = function (ev, fn, c) {
            if (ev && typeof ev === 'object') { Object.keys(ev).forEach(k => this.on(k, ev[k], fn)); return this; }
            String(ev).split(/\s+/).forEach(n => (this._ev[n] = this._ev[n] || []).push(c ? fn.bind(c) : fn));
            return this;
        };
        obj.off = function (ev, fn) {
            if (!ev) { this._ev = {}; return this; }
            if (this._ev[ev]) this._ev[ev] = fn ? this._ev[ev].filter(f => f !== fn) : [];
            return this;
        };
        obj.listenTo = function (o, ev, fn) { if (o && o.on) o.on(ev, fn, this); return this; };
        obj.stopListening = function () { return this; };
        obj.trigger = function (ev, ...args) { (this._ev[ev] || []).slice().forEach(f => f.apply(this, args)); return this; };
        obj.fireEvent = function (ev, args) { return this.trigger(ev, ...(Array.isArray(args) ? args : args === undefined ? [] : [args])); };
        return obj;
    }

    function control(tag, o) {
        o = o || {};
        const el = doc.createElement(o.tagName || 'button');
        if (o.id) el.id = o.id;
        const c = emitter({
            _tag: tag, options: Object.assign({caption: o.caption || '', value: o.value}, o.options || {}),
            caption: o.caption || '', disabled: !!o.disabled, visible: o.visible !== false,
            pressed: !!o.pressed, enableToggle: !!o.toggle, checkable: !!o.checkable, checked: !!o.checked,
            value: o.value, menu: o.menu || null, el, cmpEl: $(el), $el: $(el), rendered: true, id: o.id || tag,
            isDisabled() { return this.disabled; },
            setDisabled(v) {
                v = !!v;
                env.touches.push({tag, op: 'setDisabled', v, stock: env.inStock > 0});
                if (v === this.disabled) return;
                this.disabled = v;
                this.trigger('disabled', this, v);
            },
            isVisible() { return this.visible; },
            setVisible(v) { env.touches.push({tag, op: 'setVisible', v: !!v, stock: env.inStock > 0}); this.visible = !!v; },
            show() { this.setVisible(true); }, hide() { this.setVisible(false); },
            isActive() { return this.pressed; },
            toggle(state, suppress) {
                const s = state === undefined ? !this.pressed : !!state;
                if (s === this.pressed) return;
                this.pressed = s;
                if (!suppress) this.trigger('toggle', this, s);
            },
            click(e) {
                if (this.disabled) return;
                if (this.enableToggle) this.toggle();
                if (this.checkable) this.setChecked(!this.checked);
                this.trigger('click', this, e || new FakeEvent('click'));
                if (this.parentMenu) this.parentMenu.trigger('item:click', this.parentMenu, this, e || new FakeEvent('click'));
            },
            isChecked() { return this.checked; },
            setChecked(v, suppress) { const was = this.checked; this.checked = !!v; if (!suppress && was !== this.checked) this.trigger('toggle', this, this.checked); },
            getValue() { return this.value; },
            setValue(v, suppress) { const old = this.value; this.value = v; if (!suppress) this.trigger('change', this, v === true ? 'checked' : v === false ? 'unchecked' : v, old); },
            setCaption(t) { this.caption = t; this.options.caption = t; },
            updateHint() {}, render() { return this; }, focus() {}, setIconCls() {}, setMenu(m) { this.menu = m; }
        });
        if (o.checkbox) {
            Object.defineProperty(c, 'pressed', {get() { return !!c.value; }, set(v) { c.value = !!v; }});
            Object.defineProperty(c, 'checked', {get() { return !!c.value; }, set(v) { c.value = !!v; }});
            c.click = function () { if (!this.disabled) this.setValue(!this.value); };
            c.isChecked = function () { return !!this.value; };
        }
        if (o.menu) o.menu.parentButton = c;
        return c;
    }

    function menu(tag, items) {
        const el = doc.createElement('ul');
        el.className = 'dropdown-menu';
        const m = emitter({
            _tag: tag, items: [], visible: false, el, cmpEl: $(el), $el: $(el), options: {}, rendered: true,
            show() { this.trigger('show:before', this); this.visible = true; env.opened.push(tag); this.trigger('show:after', this); },
            hide() { this.trigger('hide:before', this); this.visible = false; this.trigger('hide:after', this); },
            isVisible() { return this.visible; },
            getItem(v) { return this.items.find(i => i.value === v || i.options.value === v) || null; },
            addItem(it) { it.parentMenu = this; this.items.push(it); return it; },
            insertItem(i, it) { it.parentMenu = this; this.items.splice(i, 0, it); return it; },
            removeItem(it) { const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1); },
            removeAll() { this.items.length = 0; },
            setInnerMenu() {}, alignPosition() {}, render() { return this; }
        });
        (items || []).forEach(it => m.addItem(it.on ? it : control(tag + '.' + (it.value != null ? it.value : m.items.length), it)));
        return m;
    }

    function collection(records) {
        const models = records.map((r, i) => {
            const attrs = Object.assign({id: 'rec' + i}, r);
            return {id: attrs.id, attributes: attrs, get: k => attrs[k], set(k, v) { attrs[k] = v; }, toJSON: () => attrs};
        });
        const col = emitter({
            reads: 0,
            get models() { col.reads++; return models; },
            get length() { col.reads++; return models.length; },
            at(i) { col.reads++; return models[i]; },
            each(fn, c) { col.reads++; models.forEach(fn, c); },
            map(fn, c) { col.reads++; return models.map(fn, c); },
            filter(fn, c) { col.reads++; return models.filter(fn, c); },
            find(fn) { col.reads++; return models.find(typeof fn === 'function' ? fn : m => Object.keys(fn).every(k => m.get(k) === fn[k])); },
            findWhere(q) { col.reads++; return models.find(m => Object.keys(q).every(k => m.get(k) === q[k])) || null; },
            where(q) { col.reads++; return models.filter(m => Object.keys(q).every(k => m.get(k) === q[k])); },
            toJSON() { col.reads++; return models.map(m => m.toJSON()); },
            indexOf(m) { return models.indexOf(m); },
            reset() {}, add() {}, remove() {}
        });
        return col;
    }

    function dataView(tag, records, onClick) {
        const store = collection(records);
        const dv = control(tag, {tagName: 'div'});
        dv.store = store;
        dv.menuPicker = {store, on() {}, selectRecord() {}, getSelectedRec: () => null};
        dv.fieldPicker = {store, on() {}, selectRecord() {}};
        dv.selectRecord = function () {};
        dv.getSelectedRec = () => null;
        dv.openMenu = function () { env.opened.push(tag); };
        if (onClick) dv.on('click', onClick);
        return dv;
    }

    /* Localized captions of the stock view: PE.Views.<View> properties from ru.json. */
    const caption = (view, key) => {
        const v = ru()['PE.Views.' + view + '.' + key];
        return v === undefined ? key : v;
    };

    /* --- Namespaces --------------------------------------------------------------- */
    const PE = {Views: {}, Controllers: {}, Collections: {}, Models: {}};
    for (const [k, v] of Object.entries(ru())) {
        const p = k.split('.');
        if (p[0] !== 'PE' || p.length < 4) continue;
        const ns = PE[p[1]] = PE[p[1]] || {};
        const holder = ns[p[2]] = ns[p[2]] || (p[1] === 'Views' && SHELL_MODULES.indexOf(p[2]) < 0 ? function () {} : {});
        holder[p.slice(3).join('.')] = v;
        if (typeof holder === 'function') holder.prototype[p.slice(3).join('.')] = v;
    }
    sandbox.PE = PE;
    sandbox.Asc = soft({
        c_oAscTypeSelectElement: SELECT,
        c_oAscRestrictionType: {None: 0, OnlyForms: 1, OnlyComments: 2, OnlySignatures: 4, View: 128},
        c_oAscFileType: {PPTX: 1, PDF: 2, ODP: 3, PNG: 4, JPG: 5, POTX: 6, OTP: 7, PPSX: 8, PDFA: 9},
        c_oAscAsyncAction: {}, c_oAscAsyncActionType: {}, c_oAscError: {ID: {}}, c_oAscSlideTransitionTypes: {}
    });
    sandbox.AscCommon = soft({GlobalSkin: {}, UserInfoParser: {getCurrentName: () => 'Тест', getParsedName: n => n}});

    const Common = {
        NotificationCenter: NC,
        Gateway: soft({on() {}, off() {}, appReady() {}, requestEditRights() {}, requestHistory() {}, requestSharingSettings() {}, requestRename() {}}),
        localStorage: soft({_s: {}, getItem(k) { return this._s[k] === undefined ? null : this._s[k]; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; }, getBool(k, d) { return this._s[k] === undefined ? !!d : this._s[k] === 'true' || this._s[k] === '1'; }, itemExists(k) { return this._s[k] !== undefined; }, setBool(k, v) { this._s[k] = v ? 'true' : 'false'; }}),
        UI: soft({
            Themes: soft({getThemeColors: () => Object.assign({}, THEME_COLORS), isDarkTheme: () => false, currentThemeId: () => 'theme-light', available: () => true, isContentThemeDark: () => false}),
            LayoutManager: soft({isElementVisible: () => true, addControls() {}, getInitValue: () => undefined}),
            FeaturesManager: soft({canChange: () => true, isFeatureEnabled: () => true}),
            Menu: soft({Manager: soft({hideAll() {}, isMenuVisible: () => false})}),
            HintManager: soft({clearHints() {}, isHintVisible: () => false}),
            TooltipManager: soft({showTip() {}, closeTip() {}}),
            Window: soft({}),
            Compact: {},
            ExternalUsers: soft({getImage: () => null, getColor: () => '#000'}),
            Keys: {ESC: 27, RETURN: 13, TAB: 9, SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, DELETE: 46, BACKSPACE: 8, HOME: 36, END: 35, F5: 116}
        }),
        Utils: soft({
            String: soft({format: (s, ...a) => String(s).replace(/\{(\d+)\}/g, (m, i) => (a[i] === undefined ? m : a[i])), htmlEncode: s => escapeText(s), htmlDecode: s => decode(s)}),
            isMac: false, isIE: false, isChrome: true, isSafari: false, isGecko: false, isOpera: false, isWindows: false, isLinux: false, isIOS: false,
            documentSettingsType: PANE,
            InternalSettings: soft({_s: {}, get(k) { return this._s[k]; }, set(k, v) { this._s[k] = v; }}),
            getUserInitials: () => 'Т',
            Metric: soft({fnRecalcFromMM: v => v, getCurrentMetric: () => 0, getCurrentMetricName: () => 'см'}),
            lockControls() {}, injectButtons: () => []
        }),
        util: soft({Shortcuts: soft({suspendEvents() {}, resumeEvents() {}, delegateShortcuts() {}, removeShortcuts() {}})}),
        Views: soft({Comments: spy('Common.Views.Comments:new', function () { return lenient; })}),
        Controllers: soft({LaunchController: soft({isScriptLoaded: () => true})}),
        component: soft({Analytics: soft({trackEvent() {}})}),
        enumLock: soft({}),
        define: soft({}),
        Locale: soft({getCurrentLanguage: () => 'ru', get: (k, s) => (s && s[k]) || k}),
        Models: soft({})
    };
    sandbox.Common = soft(Common);
    sandbox.Backbone = soft({View: {extend: o => o}, Model: {extend: o => o}, Collection: {extend: o => o}});

    /* --- Left menu ------------------------------------------------------------- */
    const lmProto = {
        showMenu: function (name) {
            const v = this;
            const btn = name === 'comments' ? v.btnComments : name === 'chat' ? v.btnChat : name === 'advancedsearch' ? v.btnSearchBar : null;
            if (!btn) return;
            if ((btn.isVisible() || v.isButtonInMoreMenu(btn)) && !btn.isDisabled() && !btn.pressed) {
                btn.toggle(true);
                v.onBtnMenuClick(btn);
            }
        },
        isButtonInMoreMenu: () => false,
        getMenu: () => null
    };
    const leftView = Object.create(lmProto);
    emitter(leftView);
    leftView.btnThumbs = control('LeftMenu:btnThumbs', {toggle: true, pressed: true, id: 'left-btn-thumbs'});
    /* The icon column is not visible in the shell: the stock showMenu will not open the panel by itself. */
    leftView.btnComments = control('LeftMenu:btnComments', {toggle: true, id: 'left-btn-comments'});
    leftView.btnComments.isVisible = function () { return false; };
    leftView.btnSearchBar = control('LeftMenu:btnSearchBar', {toggle: true, id: 'left-btn-searchbar'});
    leftView.btnChat = control('LeftMenu:btnChat', {toggle: true, id: 'left-btn-chat'});
    leftView.mode = options;
    leftView.panelComments = {
        open: false,
        show: spy('LeftMenu.panelComments.show', function () { this.open = true; doc.getElementById('left-panel-comments').style.removeProperty('display'); }),
        hide: spy('LeftMenu.panelComments.hide', function () { this.open = false; doc.getElementById('left-panel-comments').style.setProperty('display', 'none'); }),
        isVisible() { return this.open; }
    };
    leftView.panelSearch = soft({focus() {}});
    leftView.panelChat = soft({focus() {}});
    leftView.menuFile = soft({});
    leftView.onBtnMenuClick = spy('LeftMenu.onBtnMenuClick', function (btn) {
        if (btn === leftView.btnComments) {
            leftView.panelComments[btn.pressed ? 'show' : 'hide']();
            leftView.fireEvent(btn.pressed ? 'comments:show' : 'comments:hide', leftView);
        }
        NC.trigger('layout:changed', 'leftmenu');
    });
    leftView.SetDisabled = function () {};
    leftView.setOptionsPanel = function () {};
    leftView.markCoauthOptions = function () {};
    const leftCtl = {
        leftMenu: leftView, api, mode: options,
        onShowTumbnails: spy('LeftMenu.onShowTumbnails', function (obj, show) { api.ShowThumbnails(show); }),
        onThumbnailsShow: function (show) { leftView.btnThumbs.toggle(!!show, true); },
        clickMenuFileItem: spy('LeftMenu.clickMenuFileItem'),
        clickSaveAsFormat: spy('LeftMenu.clickSaveAsFormat'),
        SetDisabled: function () {}
    };
    leftView.btnThumbs.on('click', b => leftView.onBtnMenuClick(b));
    leftView.btnThumbs.on('toggle', (b, show) => leftCtl.onShowTumbnails(b, show));
    leftView.btnComments.on('click', b => leftView.onBtnMenuClick(b));
    api.asc_registerCallback('asc_onThumbnailsShow', show => leftCtl.onThumbnailsShow(show));

    /* --- Ribbon: tabs and controller ------------------------------------------- */
    const toolbarCtl = {api, mode: options};
    toolbarCtl.onAddSlide = spy('Toolbar.onAddSlide', function () { api.AddSlide(); });
    toolbarCtl.onDuplicateSlide = spy('Toolbar.onDuplicateSlide', function () { api.DublicateSlide(); });
    toolbarCtl.onChangeSlide = spy('Toolbar.onChangeSlide');
    toolbarCtl.onColorSchemaClick = spy('Toolbar.onColorSchemaClick', function () { api.asc_ChangeColorSchemeByIdx(1); });
    toolbarCtl.onSlideSize = spy('Toolbar.onSlideSize', function () { api.changeSlideSize(1, 1); });
    toolbarCtl.onListThemeSelect = spy('Toolbar.onListThemeSelect', function () { api.ChangeTheme(1); });
    toolbarCtl.onPreview = spy('Toolbar.onPreview');

    const tb = emitter({api, mode: options});
    tb.btnAddSlide = control('Toolbar:btnAddSlide', {caption: caption('Toolbar', 'capAddSlide'),
        menu: menu('Toolbar:btnAddSlide.menu', [{caption: caption('DocumentHolder', 'txtDuplicateSlide'), value: 'duplicate'}])});
    tb.btnAddSlide.on('click', () => toolbarCtl.onAddSlide());
    tb.btnAddSlide.menu.on('item:click', (m, item) => { if (item.value === 'duplicate') toolbarCtl.onDuplicateSlide(); });
    tb.btnChangeSlide = control('Toolbar:btnChangeSlide', {menu: menu('Toolbar:btnChangeSlide.menu', [])});
    tb.btnChangeSlide.on('click', () => tb.btnChangeSlide.menu.show());
    tb.btnColorSchemas = control('Toolbar:btnColorSchemas', {menu: menu('Toolbar:btnColorSchemas.menu', [
        {caption: 'Office', value: 0, checkable: true}, {caption: 'Grayscale', value: 1, checkable: true}])});
    tb.btnColorSchemas.menu.on('item:click', (m, item) => toolbarCtl.onColorSchemaClick(m, item));
    tb.btnSlideSize = control('Toolbar:btnSlideSize', {menu: menu('Toolbar:btnSlideSize.menu', [
        {caption: caption('Toolbar', 'txtSlideStandard') === 'txtSlideStandard' ? 'Стандартный (4:3)' : caption('Toolbar', 'txtSlideStandard'), value: 0, checkable: true},
        {caption: caption('Toolbar', 'txtSlideWide') === 'txtSlideWide' ? 'Широкоэкранный (16:9)' : caption('Toolbar', 'txtSlideWide'), value: 1, checkable: true},
        {caption: '--'},
        {caption: 'Дополнительные параметры', value: 'advanced'}])});
    tb.btnSlideSize.menu.on('item:click', (m, item) => toolbarCtl.onSlideSize(m, item));
    tb.listTheme = dataView('Toolbar:listTheme', [{themeId: 0, title: 'Blank'}, {themeId: 1, title: 'Basic'}, {themeId: 2, title: 'Classic'}],
        (combo, record) => toolbarCtl.onListThemeSelect(combo, record));
    tb.btnPreview = control('Toolbar:btnPreview', {menu: menu('Toolbar:btnPreview.menu', [])});
    tb.btnPreview.on('click', () => toolbarCtl.onPreview());
    tb.lockToolbar = function () {};
    tb.lockControls = [];
    toolbarCtl.toolbar = tb;
    toolbarCtl.btnsComment = [];
    if (options.canCoAuthoring && options.canComments) {
        const b = control('ToolbarCtl:btnsComment.0', {caption: 'Комментарий'});
        b.on('click', () => NC.trigger('app:comment:add', 'toolbar'));
        toolbarCtl.btnsComment.push(b);
    }

    const viewTab = emitter({});
    viewTab.chNotes = control('ViewTab:chNotes', {checkbox: true, value: true});
    viewTab.chRulers = control('ViewTab:chRulers', {checkbox: true, value: false});
    const viewTabCtl = {view: viewTab, api,
        onNotesChange: spy('ViewTab.onNotesChange', function (chk, checked) { api.asc_ShowNotes(checked); })};
    viewTab.chNotes.on('change', (chk, state) => viewTabCtl.onNotesChange(chk, state === 'checked'));

    const transitions = emitter({});
    transitions.listEffects = dataView('Transitions:listEffects', [{value: 0, group: 'none'}, {value: 1, group: 'fade'}, {value: 2, group: 'push'}]);
    transitions.btnParameters = control('Transitions:btnParameters', {menu: menu('Transitions:btnParameters.menu', [])});
    transitions.btnPreview = control('Transitions:btnPreview');
    transitions.btnApplyToAll = control('Transitions:btnApplyToAll');
    transitions.numDuration = control('Transitions:numDuration', {value: 2});
    transitions.numDelay = control('Transitions:numDelay', {value: 0});
    transitions.chDelay = control('Transitions:chDelay', {checkbox: true, value: false});
    transitions.chStartOnClick = control('Transitions:chStartOnClick', {checkbox: true, value: true});
    const transitionsCtl = {view: transitions, api};

    const animation = emitter({});
    animation.listEffects = dataView('Animation:listEffects', [{value: 1, group: 'menu-effect-group-entrance'}, {value: 2, group: 'menu-effect-group-emphasis'}, {value: 3, group: 'menu-effect-group-exit'}, {value: 4, group: 'menu-effect-group-path'}]);
    animation.btnAnimationPane = control('Animation:btnAnimationPane', {toggle: true});
    animation.btnParameters = control('Animation:btnParameters', {menu: menu('Animation:btnParameters.menu', [])});
    animation.btnPreview = control('Animation:btnPreview');
    const animationCtl = {view: animation, api};

    /* --- Right panel -------------------------------------------------------------- */
    const rm = emitter({minimizedMode: true, defaultHideRightMenu: true, active: null});
    const paneView = name => ({
        ChangeSettings: spy('RightMenu.' + name + '.ChangeSettings'),
        setLocked() {}, setMode() {}, updateMetricUnit() {}, render() { return this; }, on() { return this; }
    });
    rm.slideSettings = paneView('slideSettings');
    rm.shapeSettings = paneView('shapeSettings');
    rm.imageSettings = paneView('imageSettings');
    rm.tableSettings = paneView('tableSettings');
    rm.paragraphSettings = paneView('paragraphSettings');
    rm.textartSettings = paneView('textartSettings');
    rm.btnSlide = control('RightMenu:btnSlide', {toggle: true, options: {asctype: PANE.Slide}});
    rm.btnShape = control('RightMenu:btnShape', {toggle: true, options: {asctype: PANE.Shape}});
    rm.btnImage = control('RightMenu:btnImage', {toggle: true, options: {asctype: PANE.Image}});
    rm.btnTable = control('RightMenu:btnTable', {toggle: true, options: {asctype: PANE.Table}});
    rm.btnText = control('RightMenu:btnText', {toggle: true, options: {asctype: PANE.Paragraph}});
    rm.btnTextArt = control('RightMenu:btnTextArt', {toggle: true, options: {asctype: PANE.TextArt}});
    rm._settings = [];
    const paneOf = {};
    [['Paragraph', rm.btnText, 'id-paragraph-settings', rm.paragraphSettings], ['Table', rm.btnTable, 'id-table-settings', rm.tableSettings],
        ['Image', rm.btnImage, 'id-image-settings', rm.imageSettings], ['Slide', rm.btnSlide, 'id-slide-settings', rm.slideSettings],
        ['Shape', rm.btnShape, 'id-shape-settings', rm.shapeSettings], ['TextArt', rm.btnTextArt, 'id-textart-settings', rm.textartSettings]]
        .forEach(([name, btn, panel, view]) => { rm._settings[PANE[name]] = {panel, btn}; paneOf[PANE[name]] = view; });
    rm.onBtnMenuClick = function (btn, e) {
        const type = btn.options.asctype;
        rm.minimizedMode = !btn.pressed;
        if (btn.pressed) {
            rm.active = type;
            env.panes.push({via: 'button', type, stock: true});
        }
        rm.fireEvent('rightmenuclick', [rm, type, rm.minimizedMode, e]);
        NC.trigger('layout:changed', 'rightmenu');
    };
    Object.values(rm._settings).forEach(s => s && s.btn.on('click', (b, e) => rm.onBtnMenuClick(b, e)));
    rm.SetActivePane = spy('RightMenu.SetActivePane', function (type, open) {
        if (rm.minimizedMode && open !== true || rm._settings[type] === undefined) return;
        env.panes.push({via: 'SetActivePane', type, stock: env.inStock > 1});
        if (rm.minimizedMode) {
            rm._settings[type].btn.toggle(true, false);
            rm._settings[type].btn.trigger('click', rm._settings[type].btn);
        } else {
            rm.active = type;
            if (!rm._settings[type].btn.isActive()) rm._settings[type].btn.toggle(true, false);
        }
    });
    rm.GetActivePane = () => (rm.minimizedMode || rm.active === null ? null : rm._settings[rm.active].panel);
    rm.updateScroller = function () {};
    rm.setDisabledMoreMenuItem = function () {};
    rm.clearSelection = function () {};
    rm.SetDisabled = function () {};
    const rightCtl = {rightmenu: rm, editMode: !!options.isEdit, api, _settings: [], _priorityArr: [],
        getDocumentSettingsType(t) {
            return {[SELECT.Paragraph]: PANE.Paragraph, [SELECT.Table]: PANE.Table, [SELECT.Image]: PANE.Image,
                [SELECT.Slide]: PANE.Slide, [SELECT.Shape]: PANE.Shape, [SELECT.Chart]: PANE.Chart}[t];
        }};
    Object.keys(paneOf).forEach(t => { rightCtl._settings[t] = {panel: paneOf[t], btn: rm._settings[t].btn, panelId: rm._settings[t].panel, hidden: 1, props: null}; });
    rightCtl.onFocusObject = spy('RightMenu.onFocusObject', function (sel) {
        if (!rightCtl.editMode) return;
        rightCtl._settings.forEach(s => { if (s) { s.hidden = 1; s.props = null; } });
        (sel || []).forEach(el => {
            const t = rightCtl.getDocumentSettingsType(el.get_ObjectType());
            const s = rightCtl._settings[t];
            if (!s) return;
            s.hidden = 0;
            s.props = el.get_ObjectValue();
            /* A shape with Text Art properties opens the Text Art tab too, like the stock onFocusObject. */
            if (t === PANE.Shape && s.props.asc_getTextArtProperties()) {
                rightCtl._settings[PANE.TextArt].hidden = 0;
                rightCtl._settings[PANE.TextArt].props = s.props;
            }
        });
        rightCtl._settings.forEach(s => { if (s) s.btn.setDisabled(!!s.hidden); });
    });
    /* Inserting an object raises its tab in the stock priority (controller/RightMenu.js onInsert*). */
    const prefer = type => {
        const i = rightCtl._priorityArr.indexOf(type);
        if (i >= 0) rightCtl._priorityArr.splice(i, 1);
        rightCtl._priorityArr.unshift(type);
    };
    rightCtl.onInsertShape = spy('RightMenu.onInsertShape', () => prefer(PANE.Shape));
    rightCtl.onInsertTextArt = spy('RightMenu.onInsertTextArt', () => prefer(PANE.TextArt));
    rightCtl.onRightMenuClick = spy('RightMenu.onRightMenuClick', function (menuView, type, minimized) {
        env.panes.push({via: 'rightmenuclick', type, stock: env.inStock > 1});
        if (!minimized && rightCtl.editMode) {
            const s = rightCtl._settings[type];
            if (s && s.props && s.panel) s.panel.ChangeSettings(s.props);
        }
    });
    rm.on('rightmenuclick', (v, type, minimized, e) => rightCtl.onRightMenuClick(v, type, minimized, e));
    rightCtl.onDoubleClickOnObject = spy('RightMenu.onDoubleClickOnObject', function (obj) {
        if (!rightCtl.editMode || !obj) return;
        const t = rightCtl.getDocumentSettingsType(obj.get_ObjectType());
        if (t === undefined || !rightCtl._settings[t]) return;
        if (t !== PANE.Paragraph) {
            rm.SetActivePane(t, true);
            rightCtl._settings[t].panel.ChangeSettings(rightCtl._settings[t].props);
        }
    });
    api.asc_registerCallback('asc_onFocusObject', sel => rightCtl.onFocusObject(sel));

    /* --- Comments -------------------------------------------------------------------- */
    const commentsView = emitter({buttonAddNew: null});
    const commentsCtl = {view: commentsView, api, getView: () => commentsView,
        onAppAddComment: spy('Comments.onAppAddComment', function (sender, toDoc) { if (!toDoc) commentsCtl.addDummyComment(); }),
        addDummyComment: spy('Comments.addDummyComment'),
        onApiShowComment: spy('Comments.onApiShowComment'),
        onShowComment: spy('Comments.onShowComment', function (id) { api.asc_selectComment(id); api.asc_showComment(id, false); })};
    NC.on('app:comment:add', (...a) => commentsCtl.onAppAddComment(...a));
    api.asc_registerCallback('asc_onShowComment', (...a) => commentsCtl.onApiShowComment(...a));
    commentsView.on('comment:show', (...a) => commentsCtl.onShowComment(...a));

    /* --- Context menus --------------------------------------------------------------- */
    const dh = emitter({mode: options, _state: {}, api, slidesCount: 3});
    const dhCtl = {documentHolder: dh, api, mode: options};
    const dhItem = (name, key, o) => control('DocumentHolder:' + name, Object.assign({caption: caption('DocumentHolder', key)}, o || {}));
    dh.mnuNewSlide = dhItem('mnuNewSlide', 'txtNewSlide');
    dh.mnuDuplicateSlide = dhItem('mnuDuplicateSlide', 'txtDuplicateSlide');
    dh.mnuDeleteSlide = dhItem('mnuDeleteSlide', 'txtDeleteSlide');
    dh.mnuSlideHide = dhItem('mnuSlideHide', 'txtSlideHide', {checkable: true});
    dh.mnuChangeSlide = dhItem('mnuChangeSlide', 'txtChangeLayout', {menu: menu('DocumentHolder:mnuChangeSlide.menu', [])});
    dh.mnuResetSlide = dhItem('mnuResetSlide', 'txtResetLayout');
    dh.mnuChangeTheme = dhItem('mnuChangeTheme', 'txtChangeTheme', {menu: menu('DocumentHolder:mnuChangeTheme.menu', [])});
    dh.menuSlideSettings = dhItem('menuSlideSettings', 'textSlideSettings');
    dh.mnuSelectAll = dhItem('mnuSelectAll', 'txtSelectAll');
    dh.mnuPrintSelection = dhItem('mnuPrintSelection', 'txtPrintSelection');
    dh.mnuMoveSlideToStart = dhItem('mnuMoveSlideToStart', 'txtMoveSlidesToStart');
    dh.mnuMoveSlideToEnd = dhItem('mnuMoveSlideToEnd', 'txtMoveSlidesToEnd');
    dh.mnuPreview = dhItem('mnuPreview', 'txtPreview');
    dh.menuSlidePaste = dhItem('menuSlidePaste', 'textPaste');
    dh.menuAddCommentPara = dhItem('menuAddCommentPara', 'addCommentText');
    dh.menuAddCommentTable = dhItem('menuAddCommentTable', 'addCommentText');
    dh.menuAddCommentImg = dhItem('menuAddCommentImg', 'addCommentText');
    dh.menuViewAddComment = dhItem('menuViewAddComment', 'addCommentText');
    dh.menuViewCopy = dhItem('menuViewCopy', 'textCopy');
    dh.menuViewUndo = dhItem('menuViewUndo', 'textUndo');
    dh.menuShapeAdvanced = dhItem('menuShapeAdvanced', 'advancedShapeText');
    dh.menuImageAdvanced = dhItem('menuImageAdvanced', 'advancedImageText');
    dh.menuTableAdvanced = dhItem('menuTableAdvanced', 'advancedTableText');
    dh.menuChartAdvanced = dhItem('menuChartAdvanced', 'advancedChartText');
    dh.menuParagraphAdvanced = dhItem('menuParagraphAdvanced', 'advancedParagraphText');
    const sep = tag => control(tag, {caption: '--'});
    dh.slideMenu = menu('DocumentHolder:slideMenu', [dh.menuSlidePaste, dh.mnuNewSlide, dh.mnuDuplicateSlide, dh.mnuDeleteSlide, dh.mnuSlideHide,
        sep('s1'), dh.mnuChangeSlide, dh.mnuResetSlide, dh.mnuChangeTheme, dh.menuSlideSettings, sep('s2'),
        dh.mnuSelectAll, dh.mnuPrintSelection, sep('s3'), dh.mnuMoveSlideToStart, dh.mnuMoveSlideToEnd, sep('s4'), dh.mnuPreview]);
    dh.textMenu = menu('DocumentHolder:textMenu', [dh.menuAddCommentPara, sep('t1'), dh.menuParagraphAdvanced]);
    dh.pictureMenu = menu('DocumentHolder:pictureMenu', [dh.menuAddCommentImg, sep('p1'), dh.menuImageAdvanced, dh.menuShapeAdvanced, dh.menuChartAdvanced]);
    dh.tableMenu = menu('DocumentHolder:tableMenu', [dh.menuAddCommentTable, sep('b1'), dh.menuTableAdvanced]);
    dh.viewModeMenu = menu('DocumentHolder:viewModeMenu', [dh.menuViewCopy, dh.menuViewUndo, sep('v1'), dh.menuViewAddComment]);
    dh.viewModeMenuSlide = menu('DocumentHolder:viewModeMenuSlide', [dh.mnuSelectAll, dh.mnuPrintSelection, sep('v2'), dh.mnuPreview]);
    const dialog = name => spy('DocumentHolder.' + name, function () { env.opened.push('dialog:' + name); });
    Object.assign(dhCtl, {
        onNewSlide: spy('DocumentHolder.onNewSlide', function () { api.AddSlide(); }),
        onDuplicateSlide: spy('DocumentHolder.onDuplicateSlide', function () { api.DublicateSlide(); }),
        onDeleteSlide: spy('DocumentHolder.onDeleteSlide', function () { api.DeleteSlide(); }),
        onSlideHide: spy('DocumentHolder.onSlideHide', function (item) { api.asc_HideSlides(item.checked); }),
        onResetSlide: spy('DocumentHolder.onResetSlide', function () { api.ResetSlide(); }),
        onMoveSlideToStart: spy('DocumentHolder.onMoveSlideToStart', function () { api.asc_moveSelectedSlidesToStart(); }),
        onMoveSlideToEnd: spy('DocumentHolder.onMoveSlideToEnd', function () { api.asc_moveSelectedSlidesToEnd(); }),
        onPreview: spy('DocumentHolder.onPreview'),
        onSelectAll: spy('DocumentHolder.onSelectAll'),
        onPrintSelection: spy('DocumentHolder.onPrintSelection'),
        onSlideSettings: spy('DocumentHolder.onSlideSettings', function (item) { rightCtl.onDoubleClickOnObject(item.options.value); }),
        addComment: spy('DocumentHolder.addComment', function () { if (options.canCoAuthoring && options.canComments) commentsCtl.addDummyComment(); }),
        onShapeAdvanced: dialog('onShapeAdvanced'),
        onImageAdvanced: dialog('onImageAdvanced'),
        onTableAdvanced: dialog('onTableAdvanced'),
        onChartAdvanced: dialog('onChartAdvanced'),
        onParagraphAdvanced: dialog('onParagraphAdvanced'),
        onContextMenu: spy('DocumentHolder.onContextMenu', function (event) {
            const m = event && event.menu ? dh[event.menu] : dh.slideMenu;
            m && m.show();
        })
    });
    const wire = (item, handler) => item.on('click', (...a) => dhCtl[handler](...a));
    wire(dh.mnuNewSlide, 'onNewSlide');
    wire(dh.mnuDuplicateSlide, 'onDuplicateSlide');
    wire(dh.mnuDeleteSlide, 'onDeleteSlide');
    wire(dh.mnuSlideHide, 'onSlideHide');
    wire(dh.mnuResetSlide, 'onResetSlide');
    wire(dh.mnuMoveSlideToStart, 'onMoveSlideToStart');
    wire(dh.mnuMoveSlideToEnd, 'onMoveSlideToEnd');
    wire(dh.mnuPreview, 'onPreview');
    wire(dh.mnuSelectAll, 'onSelectAll');
    wire(dh.mnuPrintSelection, 'onPrintSelection');
    wire(dh.menuSlideSettings, 'onSlideSettings');
    ['menuAddCommentPara', 'menuAddCommentTable', 'menuAddCommentImg', 'menuViewAddComment'].forEach(n => wire(dh[n], 'addComment'));
    wire(dh.menuShapeAdvanced, 'onShapeAdvanced');
    wire(dh.menuImageAdvanced, 'onImageAdvanced');
    wire(dh.menuTableAdvanced, 'onTableAdvanced');
    wire(dh.menuChartAdvanced, 'onChartAdvanced');
    wire(dh.menuParagraphAdvanced, 'onParagraphAdvanced');
    api.asc_registerCallback('asc_onContextMenu', e => dhCtl.onContextMenu(e));
    env.stockMenus = ['slideMenu', 'textMenu', 'pictureMenu', 'tableMenu', 'viewModeMenu', 'viewModeMenuSlide'].map(n => ({name: n, menu: dh[n], items: dh[n].items.slice()}));

    /* --- Other controllers ------------------------------------------------------------ */
    const statusbar = emitter({});
    statusbar.btnPreview = control('Statusbar:btnPreview', {menu: menu('Statusbar:btnPreview.menu', [])});
    statusbar.btnZoomToPage = control('Statusbar:btnZoomToPage', {toggle: true});
    statusbar.btnZoomToWidth = control('Statusbar:btnZoomToWidth', {toggle: true});
    statusbar.btnLanguage = options.isEdit ? control('Statusbar:btnLanguage') : undefined;
    statusbar.btnSpelling = options.isEdit ? control('Statusbar:btnSpelling', {toggle: true}) : undefined;
    statusbar.pages = soft({});
    const statusCtl = {statusbar, api};
    const reviewCtl = {view: soft(emitter({}))};
    const vlayoutItems = {};
    const layoutItem = (name, h) => (vlayoutItems[name] = vlayoutItems[name] || {height: h, el: $(doc.getElementById(name === 'statusbar' ? 'statusbar' : 'toolbar')), rely: true});
    const viewportCtl = {api, viewport: {
        vlayout: soft({getItem: n => layoutItem(n, n === 'statusbar' ? 25 : 120), doLayout() {}, items: []}),
        hlayout: soft({getItem: n => ({width: 40, el: $(doc.getElementById(n === 'left' ? 'left-menu' : 'right-menu'))}), doLayout() {}, items: []})
    }};
    const mainCtl = {api, appOptions: options, editorConfig: {ui: {shell: 'modern'}, customization: {}, lang: 'ru', canCoAuthoring: true},
        _state: {isDisconnected: false, isDocModified: false}, isAppDisabled: false, onEditComplete: spy('Main.onEditComplete')};

    env.ctls = {
        Main: mainCtl, Viewport: viewportCtl, LeftMenu: leftCtl, Toolbar: toolbarCtl, ViewTab: viewTabCtl,
        Transitions: transitionsCtl, Animation: animationCtl, RightMenu: rightCtl, Statusbar: statusCtl,
        DocumentHolder: dhCtl, 'Common.Controllers.Comments': commentsCtl, 'Common.Controllers.ReviewChanges': reviewCtl
    };
    PE.getController = name => {
        const n = String(name).replace(/^PE\.Controllers\./, '');
        return env.ctls[n] || null;
    };
    PE.getCollection = name => (name === 'SlideThemes' ? tb.listTheme.store : collection([]));
    PE.getApplication = () => ({getController: PE.getController, getCollection: PE.getCollection});
    PE.ApplicationController = soft({});
    Object.assign(env, {PE, leftView, leftCtl, tb, toolbarCtl, viewTab, viewTabCtl, transitions, animation, rm, rightCtl,
        commentsCtl, commentsView, dh, dhCtl, statusbar});

    /* The stock editor DOM. */
    parseHTML(doc, STOCK_DOM).forEach(n => doc.body.appendChild(n));
    tb.$el = $(doc.getElementById('toolbar'));
    leftView.$el = $(doc.getElementById('left-menu'));
    rm.$el = $(doc.getElementById('right-menu'));

    /* --- Loading the shell modules -------------------------------------------------------- */
    function resolveDep(dep) {
        if (typeof dep !== 'string') return {};
        const m = /presentationeditor\/main\/app\/view\/(\w+)$/.exec(dep);
        if (m) {
            if (SHELL_MODULES.indexOf(m[1]) >= 0) return env.load(m[1]);
            return PE.Views[m[1]] || {};
        }
        if (/^text!/.test(dep)) return '';
        const c = /^common\/main\/lib\/view\/compact\/(\w+)$/.exec(dep);
        if (c && SHARED_MODULES[c[1]]) return env.loadShared(c[1]);
        return AMD[dep] || {};
    }
    env.loadShared = function (name) {
        if (env.loaded[name] === true) return sandbox.Common.UI.Compact[name];
        const file = SHARED_MODULES[name];
        env.loaded[name] = 'loading';
        vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file});
        env.loaded[name] = true;
        if (!sandbox.Common.UI.Compact[name]) throw new Error('модуль ' + path.relative(ROOT, file) + ' не определил Common.UI.Compact.' + name);
        return sandbox.Common.UI.Compact[name];
    };
    env.load = function (name) {
        if (env.loaded[name] === true) return PE.Views[name];
        if (env.loaded[name] === 'loading') return PE.Views[name] || {};
        const file = path.join(VIEW_DIR, name + '.js');
        if (!fs.existsSync(file)) throw new Error('нет модуля оболочки ' + rel(file));
        env.loaded[name] = 'loading';
        vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file});
        env.loaded[name] = true;
        if (!PE.Views[name]) throw new Error('модуль ' + rel(file) + ' не определил PE.Views.' + name);
        return PE.Views[name];
    };

    env.drain = function (limit) {
        let n = 0;
        limit = limit || 3000;
        while (env.timers.length && n < limit) {
            const fn = env.timers.shift();
            n++;
            try { fn(); } catch (e) { env.logs.push('timer: ' + ((e && e.stack) || e)); }
        }
    };

    /* The shell starts the stock way: announce on init, the scaffold on app:face, start(). */
    env.start = function () {
        const shell = env.load('CompactShell');
        env.shell = shell;
        if (typeof shell.start !== 'function') throw new Error('нет CompactShell.start()');
        const config = mainCtl.editorConfig;
        if (typeof shell.announce === 'function') shell.announce(config);
        NC.trigger('app:face', {isEdit: !!options.isEdit, canEdit: !!options.canEdit});
        shell.start();
        env.drain();
        if (!doc.getElementById('vo-shell')) {
            const why = env.logs.filter(l => /error|fail|сбой|ошиб/i.test(l))[0] || env.logs[0] || 'без сообщений';
            throw new Error('оболочка не построилась: нет #vo-shell после CompactShell.start() (' + why.split('\n')[0] + ')');
        }
        env.select('none');
        env.boot = {apiCalls: env.apiCalls.slice(), stockCalls: env.stockCalls.slice(), notes: env.notes.slice()};
        env.stockCalls.length = 0;
        env.apiCalls.length = 0;
        env.notes.length = 0;
        env.panes.length = 0;
        env.opened.length = 0;
        return shell;
    };

    env.module = function (name) {
        const m = env.load(name);
        return m;
    };

    /* --- Menu bar catalog ------------------------------------------------------------- */
    env.groups = function () {
        const SA = env.load('SlideActions');
        if (typeof SA.groups !== 'function') throw new Error('нет SlideActions.groups()');
        const g = SA.groups();
        if (!Array.isArray(g)) throw new Error('SlideActions.groups() вернул не список разделов');
        return g;
    };
    const textOf = it => (it && (it.t !== undefined ? it.t : it.caption !== undefined ? it.caption : it.text)) || '';
    const kids = it => (Array.isArray(it.sub) ? it.sub : Array.isArray(it.items) ? it.items : []);
    env.section = function (label) {
        const g = env.groups().find(s => norm(s.label !== undefined ? s.label : s.t) === norm(label));
        if (!g) throw new Error('в строке меню нет раздела «' + label + '»');
        return g;
    };
    env.findItem = function (label, captions, opts) {
        captions = [].concat(captions);
        const want = captions.map(norm);
        const g = env.section(label);
        const found = [];
        const walk = list => (list || []).forEach(it => {
            if (!it || it.sep) return;
            if (want.indexOf(norm(textOf(it))) >= 0) found.push(it);
            walk(kids(it));
        });
        walk(g.items);
        if (!found.length) {
            if (opts && opts.optional) return null;
            throw new Error('в разделе «' + label + '» нет пункта «' + captions[0] + '»');
        }
        return found[0];
    };
    env.itemState = function (it) {
        const SA = env.load('SlideActions');
        if (typeof SA.itemState !== 'function') throw new Error('нет SlideActions.itemState()');
        return SA.itemState(it, env.shell) || {};
    };
    env.checked = function (it) {
        const st = env.itemState(it);
        if (st && 'checked' in st) return !!st.checked;
        if (typeof it.check === 'function') return !!it.check(env.shell);
        throw new Error('у пункта «' + textOf(it) + '» нет отметки состояния');
    };
    /* Choosing an item is the menu bar path: SlideActions.exec, otherwise the twin or the item command. */
    env.runItem = function (it) {
        const SA = env.load('SlideActions');
        const shell = env.shell;
        let r;
        if (typeof SA.exec === 'function') r = SA.exec(it, shell);
        else if (typeof SA.run === 'function') r = SA.run(it, shell);
        else if (it.twin) r = env.load('StockBridge').run(it.twin);
        else if (it.cmd && shell && typeof shell.command === 'function') {
            const fn = shell.command(it.cmd);
            r = typeof fn === 'function' ? fn(it) : fn;
        } else throw new Error('пункт «' + textOf(it) + '» нечем выполнить: нет SlideActions.exec, двойника и команды');
        env.drain();
        return r;
    };

    /* --- Right panel -------------------------------------------------------------------- */
    env.canon = function (name) {
        if (name && typeof name === 'object') name = name.name || name.id || name.key || name.type || name.section;
        if (name == null || name === false || name === '') return null;
        const s = String(name).toLowerCase();
        if (/anim/.test(s)) return 'animation';
        if (/transit|переход/.test(s)) return 'transition';
        if (/theme|тем/.test(s)) return 'theme';
        if (/object|объект|shape|image|table|chart|paragraph|textart/.test(s)) return 'object';
        if (/slide|слайд|background|фон/.test(s)) return 'slide';
        return s;
    };
    env.current = function () {
        const SS = env.load('SlideSections');
        if (typeof SS.current !== 'function') throw new Error('нет SlideSections.current(): открытый раздел правой панели не прочитать');
        return env.canon(SS.current());
    };
    env.sections = function () {
        const SS = env.load('SlideSections');
        if (typeof SS.sections !== 'function') throw new Error('нет SlideSections.sections(): полосу значков правой панели не прочитать');
        const list = SS.sections();
        if (!Array.isArray(list)) throw new Error('SlideSections.sections() вернул не список');
        return Array.from(list, x => env.canon(x));
    };
    /* The stock tab that the right panel showed last (the documentSettingsType type). */
    env.lastPane = function () {
        const p = env.panes[env.panes.length - 1];
        return p ? PANE_NAME[p.type] : null;
    };

    /* --- Shell DOM ------------------------------------------------------------------- */
    env.byLabel = function (re) {
        return doc.documentElement.descendants().filter(el => {
            const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-tip') || '';
            return label && re.test(norm(label));
        });
    };
    env.pageText = () => doc.body.textContent.replace(/\s+/g, ' ');
    env.listenersOn = function (id) {
        const el = doc.getElementById(id);
        if (!el) return 0;
        return Object.keys(el._listeners).reduce((n, k) => n + el._listeners[k].length, 0);
    };

    env.count = name => env.stockCalls.filter(c => c.name === name).length;
    env.ownApi = re => env.apiCalls.filter(c => !c.stock && re.test(c.name));
    env.SELECT = SELECT;
    env.PANE = PANE;
    return env;
}

module.exports = {
    ROOT, APP, VIEW_DIR, LESS_DIR, SHELL_MODULES, SHARED_MODULES, SHELL_LESS,
    run, norm, rel, ru, shellSource, existingShellSources,
    lessRules, lessFile, shellLessRules, decl, hides,
    createEnv, parseHTML, FakeDocument
};

if (require.main === module) process.exitCode = 0;
