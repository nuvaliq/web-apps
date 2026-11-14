/* Common helper for the presentation shell acceptance tests.
 * Run directly it does nothing and exits with code 0.
 *
 * What it provides:
 *  - a small DOM with a jQuery subset, enough to run the shell views in node:vm;
 *  - a stub of the stock presentation editor around them: Main, Viewport, Toolbar,
 *    ViewTab, LeftMenu with FileMenu, Statusbar, Transitions, Animation, review,
 *    the engine api and the notification centre; every call the shell makes into
 *    a stock control or the engine is logged;
 *  - the stock ru locale applied before the shell modules load, as the editor does;
 *  - a CSS cascade over the compiled compact-shell.less of the presentation editor;
 *  - a runner: `ok <name>` / `FAIL <name>: <reason>`, exit code 1 on any failure,
 *    `--only <name>` runs one test.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../../..');
const APPS = path.join(ROOT, 'apps');
const PE_MAIN = path.join(APPS, 'presentationeditor/main');
const PE_VIEW = path.join(PE_MAIN, 'app/view');
const PE_LESS = path.join(PE_MAIN, 'resources/less');
const DE_VIEW = path.join(APPS, 'documenteditor/main/app/view');
const DE_LESS = path.join(APPS, 'documenteditor/main/resources/less');

const SHELL_NAMES = ['CompactShell', 'StockBridge', 'SlideActions', 'SlideSelection', 'CompactToolbar',
    'SlideSections', 'CompactLeft', 'CompactStatus', 'CompactModes', 'CompactWindows'];
/* Modules the shell takes from the shared compact layer (common/main/lib/view/compact/<name>): name → file. */
const SHARED_MODULES = {Icons: path.join(APPS, 'common/main/lib/view/compact/Icons.js')};

/* ------------------------------------------------------------------------ */
/* git                                                                       */

function git(args, cwd) {
    return cp.execFileSync('git', args, {cwd: cwd || ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

const FORK_BRANCH = 'b24/9.4.0';

/* Fork base of HEAD: --base <ref> when given, otherwise the merge base with
   the fork branch under any remote name or as a local branch. Clones name the
   remote differently, so no remote name is assumed; with several copies of
   the branch the newest merge base wins. null — no copy of the branch. */
function forkBase() {
    const given = argValue('--base');
    if (given) return git(['rev-parse', '--verify', given + '^{commit}']);
    let refs = [];
    try {
        refs = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/*/' + FORK_BRANCH, 'refs/heads/' + FORK_BRANCH])
            .split('\n').filter(Boolean);
    } catch (e) { refs = []; }
    let best = null, bestDepth = -1;
    for (const ref of refs) {
        let base;
        try { base = git(['merge-base', 'HEAD', ref]); } catch (e) { continue; }
        const depth = Number(git(['rev-list', '--count', base]));
        if (depth > bestDepth) { best = base; bestDepth = depth; }
    }
    return best;
}

let stockViewCache = null;
/* View files of the stock editor: the ones present at the fork base. Everything
   else in app/view is shell code. */
function stockViewNames() {
    if (stockViewCache) return stockViewCache;
    let names = null;
    try {
        const base = forkBase();
        if (base) names = git(['ls-tree', '--name-only', base, 'apps/presentationeditor/main/app/view/'])
            .split('\n').filter(Boolean).map(f => path.basename(f, '.js'));
    } catch (e) { names = null; }
    if (!names || !names.length) {
        names = ['Animation', 'AnimationDialog', 'ChartSettings', 'ChartSettingsAdvanced', 'DateTimeDialog',
            'DocumentHolder', 'DocumentHolderExt', 'DocumentPreview', 'FileMenu', 'FileMenuPanels', 'GridSettings',
            'HeaderFooterDialog', 'HyperlinkSettingsDialog', 'ImageSettings', 'ImageSettingsAdvanced', 'LeftMenu',
            'ParagraphSettings', 'ParagraphSettingsAdvanced', 'RightMenu', 'ShapeSettings', 'ShapeSettingsAdvanced',
            'SignatureSettings', 'SlideMasterTab', 'SlideSettings', 'SlideSizeSettings', 'SlideshowSettings',
            'Statusbar', 'TableSettings', 'TableSettingsAdvanced', 'TextArtSettings', 'Toolbar', 'Transitions',
            'ViewTab', 'Viewport', 'define'];
    }
    stockViewCache = new Set(names);
    return stockViewCache;
}

function shellViewNames() {
    const stock = stockViewNames();
    const found = fs.existsSync(PE_VIEW)
        ? fs.readdirSync(PE_VIEW).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).filter(n => !stock.has(n))
        : [];
    return Array.from(new Set(SHELL_NAMES.concat(found)));
}

/* ------------------------------------------------------------------------ */
/* small text helpers                                                        */

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }

let ruCache = null;
function ruLocale() { return ruCache || (ruCache = readJson(path.join(PE_MAIN, 'locale/ru.json'))); }

function norm(s) {
    return String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function normCaption(s) {
    return norm(s).toLowerCase().replace(/ё/g, 'е')
        .replace(/\s*\((?:ctrl|cmd|⌘|shift|alt|f\d)[^)]*\)\s*$/i, '')
        .replace(/[▸▾›…]+/g, '').replace(/\.\.\.$/, '').replace(/\s+/g, ' ').trim();
}

/* Removes comments from JS source and returns {code, strings}: code without
   comments, and the list of string and template literals. */
function scanJs(src) {
    let code = '', i = 0;
    const strings = [];
    const n = src.length;
    let prevSignificant = '';
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; code += ' '; continue; }
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1, s = '';
            while (j < n && src[j] !== c) {
                if (src[j] === '\\') { s += src[j] + (src[j + 1] || ''); j += 2; continue; }
                s += src[j]; j++;
            }
            strings.push(s);
            code += c + s + c;
            i = j + 1; prevSignificant = c; continue;
        }
        if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]$|^$|return$|typeof$/.test(prevSignificant)) {
            /* regex literal */
            let j = i + 1, inClass = false;
            while (j < n) {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === '[') inClass = true;
                else if (src[j] === ']') inClass = false;
                else if (src[j] === '/' && !inClass) break;
                else if (src[j] === '\n') break;
                j++;
            }
            code += src.slice(i, j + 1); i = j + 1; prevSignificant = '/'; continue;
        }
        code += c;
        if (!/\s/.test(c)) {
            if (/[A-Za-z0-9_$]/.test(c)) {
                let k = code.length - 1, w = '';
                while (k >= 0 && /[A-Za-z0-9_$]/.test(code[k])) { w = code[k] + w; k--; }
                prevSignificant = w;
            } else prevSignificant = c;
        }
        i++;
    }
    return {code, strings};
}

/* ------------------------------------------------------------------------ */
/* DOM                                                                       */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
    'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea']);
const BOOL_ATTRS = new Set(['disabled', 'checked', 'readonly', 'hidden', 'selected', 'multiple', 'required']);

function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e) => {
        const l = e.toLowerCase();
        if (l === 'amp') return '&';
        if (l === 'lt') return '<';
        if (l === 'gt') return '>';
        if (l === 'quot') return '"';
        if (l === 'apos' || l === '#39') return "'";
        if (l === 'nbsp') return ' ';
        if (l[1] === 'x') return String.fromCodePoint(parseInt(l.slice(2), 16));
        return String.fromCodePoint(parseInt(l.slice(1), 10));
    });
}
const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const kebab = s => (s.startsWith('--') ? s : s.replace(/[A-Z]/g, m => '-' + m.toLowerCase()).replace(/^ms-/, '-ms-'));

class DomEvent {
    constructor(type, init) {
        init = init || {};
        this.type = type;
        this.bubbles = init.bubbles !== undefined ? !!init.bubbles : !/^(focus|blur|mouseenter|mouseleave|load|scroll)$/.test(type);
        this.cancelable = true;
        this.defaultPrevented = false;
        this.timeStamp = Date.now();
        this.target = null;
        this.currentTarget = null;
        this._stop = false;
        this._stopImm = false;
        for (const k of Object.keys(init)) if (!(k in this)) this[k] = init[k];
        if (init.detail !== undefined) this.detail = init.detail;
    }
    preventDefault() { this.defaultPrevented = true; this.returnValue = false; }
    stopPropagation() { this._stop = true; }
    stopImmediatePropagation() { this._stop = true; this._stopImm = true; }
    isDefaultPrevented() { return this.defaultPrevented; }
    isPropagationStopped() { return this._stop; }
    isImmediatePropagationStopped() { return this._stopImm; }
    get originalEvent() { return this; }
    get which() { return this.keyCode || (this.button != null ? this.button + 1 : 1); }
    composedPath() { return this._path || []; }
}

class EvTarget {
    addEventListener(type, fn, opt) {
        if (!fn) return;
        const capture = typeof opt === 'boolean' ? opt : !!(opt && opt.capture);
        const once = !!(opt && typeof opt === 'object' && opt.once);
        const ls = this.__ls || (this.__ls = {});
        const list = ls[type] || (ls[type] = []);
        if (list.some(x => x.fn === fn && x.capture === capture)) return;
        list.push({fn, capture, once});
    }
    removeEventListener(type, fn, opt) {
        const list = this.__ls && this.__ls[type];
        if (!list) return;
        const capture = typeof opt === 'boolean' ? opt : !!(opt && opt.capture);
        const i = list.findIndex(x => x.fn === fn && x.capture === capture);
        if (i >= 0) list.splice(i, 1);
    }
    _listeners(type) { return (this.__ls && this.__ls[type]) || []; }
    _eventParent() { return null; }
    dispatchEvent(ev) {
        ev.target = this;
        const path = [];
        for (let x = this; x; x = x._eventParent()) path.push(x);
        ev._path = path;
        const call = (node, capturePhase) => {
            ev.currentTarget = node;
            for (const l of node._listeners(ev.type).slice()) {
                if (node !== this && l.capture !== capturePhase) continue;
                if (l.once) node.removeEventListener(ev.type, l.fn, l.capture);
                try {
                    const r = typeof l.fn === 'function' ? l.fn.call(node, ev) : l.fn.handleEvent(ev);
                    if (r === false) { ev.preventDefault(); ev.stopPropagation(); }
                } catch (e) {
                    const doc = this.ownerDocument || this.document || this;
                    const w = doc && doc.__world;
                    if (w) w.errors.push(e); else throw e;
                }
                if (ev._stopImm) return;
            }
        };
        for (let i = path.length - 1; i > 0 && !ev._stop; i--) call(path[i], true);
        if (!ev._stop) call(this, false);
        if (ev.bubbles) for (let i = 1; i < path.length && !ev._stop; i++) call(path[i], false);
        ev.currentTarget = null;
        return !ev.defaultPrevented;
    }
}

class DNode extends EvTarget {
    constructor(doc) { super(); this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
    get previousSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) - 1] || null; }
    get isConnected() { let x = this; while (x.parentNode) x = x.parentNode; return x.nodeType === 9; }
    hasChildNodes() { return this.childNodes.length > 0; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    appendChild(n) { return this.insertBefore(n, null); }
    insertBefore(n, ref) {
        if (n.nodeType === 11) { for (const c of n.childNodes.slice()) this.insertBefore(c, ref); return n; }
        if (n.parentNode) n.parentNode.removeChild(n);
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
        n.parentNode = this;
        return n;
    }
    removeChild(n) {
        const i = this.childNodes.indexOf(n);
        if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; }
        return n;
    }
    replaceChild(n, old) { this.insertBefore(n, old); this.removeChild(old); return old; }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    get textContent() { return this.childNodes.map(c => c.textContent).join(''); }
    set textContent(v) {
        for (const c of this.childNodes) c.parentNode = null;
        this.childNodes = [];
        if (v != null && v !== '') this.appendChild(this.ownerDocument.createTextNode(String(v)));
    }
    _eventParent() { return this.parentNode; }
    compareDocumentPosition(other) {
        if (this === other) return 0;
        const chain = n => { const a = []; for (let x = n; x; x = x.parentNode) a.unshift(x); return a; };
        const a = chain(this), b = chain(other);
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        if (i === 0) return 1;
        if (i === a.length) return 20;   /* other is a descendant: CONTAINED_BY | FOLLOWING */
        if (i === b.length) return 10;   /* other is an ancestor: CONTAINS | PRECEDING */
        const p = a[i - 1];
        return p.childNodes.indexOf(a[i]) < p.childNodes.indexOf(b[i]) ? 4 : 2;
    }
}

class DText extends DNode {
    constructor(doc, data) { super(doc); this.nodeType = 3; this.nodeName = '#text'; this.data = data; }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
    get nodeValue() { return this.data; }
    set nodeValue(v) { this.data = String(v); }
    cloneNode() { return new DText(this.ownerDocument, this.data); }
}

class DComment extends DNode {
    constructor(doc, data) { super(doc); this.nodeType = 8; this.nodeName = '#comment'; this.data = data; }
    get textContent() { return ''; }
    cloneNode() { return new DComment(this.ownerDocument, this.data); }
}

class DFragment extends DNode {
    constructor(doc) { super(doc); this.nodeType = 11; this.nodeName = '#document-fragment'; }
    querySelectorAll(sel) { return qsa(this, sel); }
    querySelector(sel) { return qsa(this, sel)[0] || null; }
    get children() { return this.childNodes.filter(c => c.nodeType === 1); }
}

function makeStyle(el) {
    const map = new Map();   /* kebab -> {value, important} */
    const parse = text => {
        map.clear();
        for (const d of splitTop(String(text || ''), ';')) {
            const k = d.indexOf(':');
            if (k < 0) continue;
            let name = d.slice(0, k).trim();
            let value = d.slice(k + 1).trim();
            if (!name) continue;
            if (!name.startsWith('--')) name = name.toLowerCase();
            const imp = /!\s*important\s*$/i.test(value);
            if (imp) value = value.replace(/!\s*important\s*$/i, '').trim();
            map.set(name, {value, important: imp});
        }
    };
    const api = {
        get cssText() { return Array.from(map, ([k, v]) => k + ': ' + v.value + (v.important ? ' !important' : '') + ';').join(' '); },
        set cssText(v) { parse(v); },
        setProperty(name, value, prio) {
            name = name.startsWith('--') ? name : kebab(name);
            if (value == null || value === '') map.delete(name);
            else map.set(name, {value: String(value), important: prio === 'important'});
        },
        getPropertyValue(name) { const e = map.get(name.startsWith('--') ? name : kebab(name)); return e ? e.value : ''; },
        getPropertyPriority(name) { const e = map.get(kebab(name)); return e && e.important ? 'important' : ''; },
        removeProperty(name) { const k = kebab(name); const e = map.get(k); map.delete(k); return e ? e.value : ''; },
        _entries() { return map; },
        get length() { return map.size; }
    };
    return new Proxy(api, {
        get(t, k) {
            if (typeof k === 'symbol') return undefined;
            if (k in t) return Reflect.get(t, k);
            const e = map.get(kebab(k));
            return e ? e.value : '';
        },
        set(t, k, v) {
            if (k === 'cssText') { t.cssText = v; return true; }
            const name = kebab(k);
            if (v == null || v === '') map.delete(name);
            else map.set(name, {value: String(v), important: false});
            return true;
        }
    });
}

class DElement extends DNode {
    constructor(doc, tag) {
        super(doc);
        this.nodeType = 1;
        this.localName = tag.toLowerCase();
        this.tagName = this.localName.toUpperCase();
        this.nodeName = this.tagName;
        this._attrs = new Map();
        this.style = makeStyle(this);
        this._props = {};
        const self = this;
        this.classList = {
            _list() { return (self.getAttribute('class') || '').split(/\s+/).filter(Boolean); },
            _set(list) { self.setAttribute('class', Array.from(new Set(list)).join(' ')); },
            add(...c) { this._set(this._list().concat(c.filter(Boolean))); },
            remove(...c) { this._set(this._list().filter(x => !c.includes(x))); },
            contains(c) { return this._list().includes(c); },
            toggle(c, force) {
                const has = this.contains(c);
                const on = force === undefined ? !has : !!force;
                if (on && !has) this.add(c); else if (!on && has) this.remove(c);
                return on;
            },
            replace(a, b) { if (!this.contains(a)) return false; this.remove(a); this.add(b); return true; },
            item(i) { return this._list()[i] || null; },
            get length() { return this._list().length; },
            forEach(fn) { this._list().forEach(fn); },
            [Symbol.iterator]() { return this._list()[Symbol.iterator](); },
            toString() { return self.getAttribute('class') || ''; },
            get value() { return self.getAttribute('class') || ''; }
        };
        this.dataset = new Proxy({}, {
            get: (t, k) => (typeof k === 'string' ? (this.getAttribute('data-' + kebab(k)) ?? undefined) : undefined),
            set: (t, k, v) => { this.setAttribute('data-' + kebab(k), v); return true; },
            deleteProperty: (t, k) => { this.removeAttribute('data-' + kebab(k)); return true; },
            has: (t, k) => this.hasAttribute('data-' + kebab(k))
        });
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get attributes() { return Array.from(this._attrs, ([name, value]) => ({name, value, nodeName: name, nodeValue: value})); }
    getAttribute(n) {
        n = String(n).toLowerCase();
        if (n === 'style') { const t = this.style.cssText; return t || (this._attrs.has('style') ? '' : null); }
        return this._attrs.has(n) ? this._attrs.get(n) : null;
    }
    setAttribute(n, v) {
        n = String(n).toLowerCase();
        v = String(v);
        if (n === 'style') { this.style.cssText = v; this._attrs.set('style', ''); return; }
        this._attrs.set(n, v);
        if (n === 'value' && !('value' in this._props)) { /* default value follows the attribute */ }
    }
    hasAttribute(n) { n = String(n).toLowerCase(); return n === 'style' ? this.style.length > 0 : this._attrs.has(n); }
    removeAttribute(n) { n = String(n).toLowerCase(); if (n === 'style') this.style.cssText = ''; this._attrs.delete(n); }
    toggleAttribute(n, force) {
        const on = force === undefined ? !this.hasAttribute(n) : !!force;
        if (on) this.setAttribute(n, ''); else this.removeAttribute(n);
        return on;
    }
    get children() { return this.childNodes.filter(c => c.nodeType === 1); }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
    get nextElementSibling() { let x = this.nextSibling; while (x && x.nodeType !== 1) x = x.nextSibling; return x; }
    get previousElementSibling() { let x = this.previousSibling; while (x && x.nodeType !== 1) x = x.previousSibling; return x; }
    get innerHTML() { return this.childNodes.map(serialize).join(''); }
    set innerHTML(html) {
        for (const c of this.childNodes) c.parentNode = null;
        this.childNodes = [];
        for (const n of parseHTML(this.ownerDocument, String(html == null ? '' : html))) this.appendChild(n);
    }
    get outerHTML() { return serialize(this); }
    get innerText() { return this.textContent; }
    set innerText(v) { this.textContent = v; }
    insertAdjacentHTML(pos, html) {
        const nodes = parseHTML(this.ownerDocument, html);
        const p = String(pos).toLowerCase();
        if (p === 'beforebegin') nodes.forEach(n => this.parentNode.insertBefore(n, this));
        else if (p === 'afterend') { const nx = this.nextSibling; nodes.forEach(n => this.parentNode.insertBefore(n, nx)); }
        else if (p === 'afterbegin') { const f = this.firstChild; nodes.forEach(n => this.insertBefore(n, f)); }
        else nodes.forEach(n => this.appendChild(n));
    }
    insertAdjacentElement(pos, el) { this.insertAdjacentHTML(pos, ''); const p = String(pos).toLowerCase();
        if (p === 'beforebegin') this.parentNode.insertBefore(el, this);
        else if (p === 'afterend') this.parentNode.insertBefore(el, this.nextSibling);
        else if (p === 'afterbegin') this.insertBefore(el, this.firstChild);
        else this.appendChild(el);
        return el; }
    append(...nodes) { nodes.forEach(n => this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n)); }
    prepend(...nodes) { const f = this.firstChild; nodes.forEach(n => this.insertBefore(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n, f)); }
    before(...nodes) { nodes.forEach(n => this.parentNode.insertBefore(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n, this)); }
    after(...nodes) { const nx = this.nextSibling; nodes.forEach(n => this.parentNode.insertBefore(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n, nx)); }
    replaceWith(n) { this.parentNode.replaceChild(n, this); }
    querySelectorAll(sel) { return qsa(this, sel); }
    querySelector(sel) { return qsa(this, sel)[0] || null; }
    getElementsByTagName(t) { return qsa(this, t); }
    getElementsByClassName(c) { return qsa(this, c.split(/\s+/).filter(Boolean).map(x => '.' + x).join('')); }
    matches(sel) { return matchesSelector(this, sel); }
    closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (matchesSelector(x, sel)) return x; return null; }
    cloneNode(deep) {
        const c = this.ownerDocument.createElement(this.localName);
        for (const [k, v] of this._attrs) c._attrs.set(k, v);
        c.style.cssText = this.style.cssText;
        if (deep) for (const ch of this.childNodes) c.appendChild(ch.cloneNode(true));
        return c;
    }
    click() {
        if (this.disabled) return;
        this.dispatchEvent(new DomEvent('click', {bubbles: true, button: 0}));
    }
    focus() {
        const d = this.ownerDocument;
        if (d.activeElement === this) return;
        const prev = d.activeElement;
        d.activeElement = this;
        if (prev && prev !== d.body && prev.dispatchEvent) prev.dispatchEvent(new DomEvent('blur', {bubbles: false}));
        this.dispatchEvent(new DomEvent('focus', {bubbles: false}));
        this.dispatchEvent(new DomEvent('focusin', {bubbles: true}));
    }
    blur() {
        const d = this.ownerDocument;
        if (d.activeElement !== this) return;
        d.activeElement = d.body;
        this.dispatchEvent(new DomEvent('blur', {bubbles: false}));
        this.dispatchEvent(new DomEvent('focusout', {bubbles: true}));
    }
    select() {}
    setSelectionRange() {}
    scrollIntoView() {}
    getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0}; }
    getClientRects() { return []; }
    get offsetWidth() { return parseFloat(this.style.width) || 0; }
    get offsetHeight() { return parseFloat(this.style.height) || 0; }
    get clientWidth() { return this.offsetWidth; }
    get clientHeight() { return this.offsetHeight; }
    get scrollWidth() { return this.offsetWidth; }
    get scrollHeight() { return this.offsetHeight; }
    get offsetLeft() { return 0; }
    get offsetTop() { return 0; }
    get offsetParent() { return this.parentElement; }
    get scrollTop() { return this._props.scrollTop || 0; }
    set scrollTop(v) { this._props.scrollTop = v; }
    get scrollLeft() { return this._props.scrollLeft || 0; }
    set scrollLeft(v) { this._props.scrollLeft = v; }
    get value() {
        if ('value' in this._props) return this._props.value;
        if (this.localName === 'textarea') return this.textContent;
        const a = this.getAttribute('value');
        return a == null ? '' : a;
    }
    set value(v) { this._props.value = v == null ? '' : String(v); }
    get checked() { return 'checked' in this._props ? this._props.checked : this.hasAttribute('checked'); }
    set checked(v) { this._props.checked = !!v; }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(v) { this.toggleAttribute('disabled', !!v); }
    get readOnly() { return this.hasAttribute('readonly'); }
    set readOnly(v) { this.toggleAttribute('readonly', !!v); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(v) { this.toggleAttribute('hidden', !!v); }
    get title() { return this.getAttribute('title') || ''; }
    set title(v) { this.setAttribute('title', v); }
    get type() { return this.getAttribute('type') || (this.localName === 'input' ? 'text' : this.localName === 'button' ? 'submit' : ''); }
    set type(v) { this.setAttribute('type', v); }
    get name() { return this.getAttribute('name') || ''; }
    set name(v) { this.setAttribute('name', v); }
    get placeholder() { return this.getAttribute('placeholder') || ''; }
    set placeholder(v) { this.setAttribute('placeholder', v); }
    get href() { return this.getAttribute('href') || ''; }
    set href(v) { this.setAttribute('href', v); }
    get src() { return this.getAttribute('src') || ''; }
    set src(v) { this.setAttribute('src', v); }
    get tabIndex() { const t = this.getAttribute('tabindex'); return t == null ? -1 : parseInt(t, 10); }
    set tabIndex(v) { this.setAttribute('tabindex', v); }
    get contentEditable() { return this.getAttribute('contenteditable') || 'inherit'; }
    set contentEditable(v) { this.setAttribute('contenteditable', v); }
    get isContentEditable() {
        for (let x = this; x && x.nodeType === 1; x = x.parentNode) {
            const v = x.getAttribute('contenteditable');
            if (v === '' || v === 'true' || v === 'plaintext-only') return true;
            if (v === 'false') return false;
        }
        return false;
    }
    get selectionStart() { return 0; }
    get selectionEnd() { return 0; }
    get width() { return parseFloat(this.getAttribute('width')) || 0; }
    set width(v) { this.setAttribute('width', v); }
    get height() { return parseFloat(this.getAttribute('height')) || 0; }
    set height(v) { this.setAttribute('height', v); }
    getContext() { return null; }
    get options() { return this.children.filter(c => c.localName === 'option'); }
}

class DDocument extends DNode {
    constructor(win) {
        super(null);
        this.ownerDocument = this;
        this.nodeType = 9;
        this.nodeName = '#document';
        this.defaultView = win;
        this.readyState = 'complete';
        this.baseURI = 'http://stand.test/web-apps/apps/presentationeditor/main/index.html';
        this.URL = this.baseURI;
        this.documentElement = this.createElement('html');
        this.appendChild(this.documentElement);
        this.head = this.createElement('head');
        this.body = this.createElement('body');
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        this.activeElement = this.body;
        this.hidden = false;
        this.visibilityState = 'visible';
        this.fonts = {ready: Promise.resolve(), check: () => true, load: () => Promise.resolve([])};
    }
    createElement(tag) { return new DElement(this, String(tag)); }
    createElementNS(ns, tag) { return new DElement(this, String(tag)); }
    createTextNode(t) { return new DText(this, String(t)); }
    createComment(t) { return new DComment(this, String(t)); }
    createDocumentFragment() { return new DFragment(this); }
    createEvent() { const e = new DomEvent(''); e.initEvent = (t, b) => { e.type = t; e.bubbles = !!b; }; return e; }
    createRange() { return {selectNodeContents() {}, setStart() {}, setEnd() {}, collapse() {}, getBoundingClientRect: () => ({left: 0, top: 0, width: 0, height: 0})}; }
    getElementById(id) { return qsa(this, '*').find(e => e.getAttribute('id') === String(id)) || null; }
    querySelectorAll(sel) { return qsa(this, sel); }
    querySelector(sel) { return qsa(this, sel)[0] || null; }
    getElementsByTagName(t) { return qsa(this, t); }
    getElementsByClassName(c) { return qsa(this, c.split(/\s+/).filter(Boolean).map(x => '.' + x).join('')); }
    hasFocus() { return true; }
    execCommand() { return false; }
    getSelection() { return this.defaultView.getSelection(); }
    elementFromPoint() { return null; }
    get textContent() { return null; }
    _eventParent() { return this.defaultView; }
}

function serialize(n) {
    if (n.nodeType === 3) return escText(n.data);
    if (n.nodeType === 8) return '<!--' + n.data + '-->';
    if (n.nodeType !== 1) return n.childNodes.map(serialize).join('');
    let attrs = '';
    for (const [k, v] of n._attrs) {
        if (k === 'style') continue;
        attrs += ' ' + k + '="' + escAttr(v) + '"';
    }
    const st = n.style.cssText;
    if (st) attrs += ' style="' + escAttr(st) + '"';
    if (VOID.has(n.localName)) return '<' + n.localName + attrs + '>';
    return '<' + n.localName + attrs + '>' + n.childNodes.map(serialize).join('') + '</' + n.localName + '>';
}

const TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseHTML(doc, html) {
    const frag = new DFragment(doc);
    const stack = [frag];
    const top = () => stack[stack.length - 1];
    const addText = t => { if (t) top().appendChild(doc.createTextNode(decodeEntities(t))); };
    let last = 0, m;
    const re = new RegExp(TAG_RE.source, 'g');
    while ((m = re.exec(html))) {
        if (m.index > last) addText(html.slice(last, m.index));
        last = re.lastIndex;
        const t = m[0];
        if (t.startsWith('<!--')) { top().appendChild(doc.createComment(t.slice(4, -3))); continue; }
        if (t.startsWith('<!')) continue;
        if (m[1]) {
            const name = m[1].toLowerCase();
            for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === name) { stack.length = i; break; }
            continue;
        }
        const el = doc.createElement(m[2]);
        const ar = new RegExp(ATTR_RE.source, 'g');
        let a;
        while ((a = ar.exec(m[3] || ''))) {
            const v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
            el.setAttribute(a[1], decodeEntities(v));
        }
        top().appendChild(el);
        if (!m[4] && !VOID.has(el.localName)) {
            if (RAW.has(el.localName)) {
                const end = html.toLowerCase().indexOf('</' + el.localName, last);
                const content = html.slice(last, end < 0 ? html.length : end);
                if (content) el.appendChild(doc.createTextNode(el.localName === 'textarea' ? decodeEntities(content) : content));
                const close = end < 0 ? html.length : html.indexOf('>', end) + 1;
                last = close;
                re.lastIndex = close;
                continue;
            }
            stack.push(el);
        }
    }
    if (last < html.length) addText(html.slice(last));
    const nodes = frag.childNodes.slice();
    nodes.forEach(n => { n.parentNode = null; });
    frag.childNodes = [];
    return nodes;
}

/* ------------------------------------------------------------------------ */
/* selectors                                                                 */

function splitTop(s, sep) {
    const out = [];
    let depth = 0, quote = null, cur = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) { cur += c; if (c === '\\') { cur += s[++i] || ''; continue; } if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; cur += c; continue; }
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out.map(x => x.trim()).filter(Boolean);
}

const selCache = new Map();
function parseSelectorList(sel) {
    const key = String(sel);
    if (selCache.has(key)) return selCache.get(key);
    const list = splitTop(key, ',').map(parseComplex);
    selCache.set(key, list);
    return list;
}

function parseComplex(s) {
    const parts = [];
    let i = 0, comb = null;
    const n = s.length;
    const ident = () => {
        let r = '';
        while (i < n) {
            const c = s[i];
            if (c === '\\') { r += s[i + 1] || ''; i += 2; continue; }
            if (/[A-Za-z0-9_\- -￿]/.test(c)) { r += c; i++; continue; }
            break;
        }
        return r;
    };
    const balanced = () => {
        let depth = 1, r = '';
        i++;
        while (i < n && depth) {
            const c = s[i];
            if (c === '(') depth++;
            else if (c === ')') { depth--; if (!depth) break; }
            r += c; i++;
        }
        i++;
        return r;
    };
    while (i < n) {
        while (i < n && /\s/.test(s[i])) { i++; if (comb === null && parts.length) comb = ' '; }
        if (i >= n) break;
        if (s[i] === '>' || s[i] === '+' || s[i] === '~') { comb = s[i]; i++; continue; }
        const comp = {tag: null, ids: [], classes: [], attrs: [], pseudos: [], pseudoEl: false};
        let any = false;
        while (i < n && !/[\s>+~]/.test(s[i])) {
            const c = s[i];
            any = true;
            if (c === '*') { comp.tag = '*'; i++; }
            else if (c === '#') { i++; comp.ids.push(ident()); }
            else if (c === '.') { i++; comp.classes.push(ident()); }
            else if (c === '[') {
                const e = s.indexOf(']', i);
                const body = s.slice(i + 1, e < 0 ? n : e);
                i = e < 0 ? n : e + 1;
                const am = /^\s*([^\s~|^$*!=]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?\s*$/.exec(body);
                if (am) comp.attrs.push({name: am[1].toLowerCase(), op: am[2] || null,
                    val: am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : am[5], ci: !!am[6]});
                else comp.attrs.push({name: '\u0000never', op: null});
            } else if (c === ':') {
                let el = false;
                i++;
                if (s[i] === ':') { el = true; i++; }
                const name = ident().toLowerCase();
                let arg = null;
                if (s[i] === '(') arg = balanced();
                if (el || /^(before|after|first-line|first-letter|placeholder|selection|marker|backdrop|-webkit-|-moz-|-ms-)/.test(name)) comp.pseudoEl = true;
                else comp.pseudos.push({name, arg});
            } else if (/[A-Za-z_\-]/.test(c)) { comp.tag = ident().toLowerCase(); }
            else { i++; comp.attrs.push({name: '\u0000never', op: null}); }
        }
        if (!any) { i++; continue; }
        parts.push({comb: parts.length ? (comb || ' ') : null, comp});
        comb = null;
    }
    const spec = [0, 0, 0];
    const addSpec = comp => {
        spec[0] += comp.ids.length;
        spec[1] += comp.classes.length + comp.attrs.length;
        if (comp.tag && comp.tag !== '*') spec[2]++;
        if (comp.pseudoEl) spec[2]++;
        for (const p of comp.pseudos) {
            if (p.name === 'where') continue;
            if (p.name === 'not' || p.name === 'is' || p.name === 'matches' || p.name === 'has') {
                let best = [0, 0, 0];
                for (const cx of parseSelectorList(p.arg || '')) {
                    const sp = cx.spec;
                    if (sp[0] > best[0] || (sp[0] === best[0] && (sp[1] > best[1] || (sp[1] === best[1] && sp[2] > best[2])))) best = sp;
                }
                spec[0] += best[0]; spec[1] += best[1]; spec[2] += best[2];
            } else spec[1]++;
        }
    };
    parts.forEach(p => addSpec(p.comp));
    const pseudoEl = parts.length ? parts[parts.length - 1].comp.pseudoEl : false;
    return {parts, spec, pseudoEl};
}

function nthMatch(arg, index) {
    const a = String(arg || '').replace(/\s+/g, '').toLowerCase();
    if (a === 'odd') return index % 2 === 1;
    if (a === 'even') return index % 2 === 0;
    const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(a);
    if (m) {
        const A = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseInt(m[1], 10);
        const B = m[2] ? parseInt(m[2], 10) : 0;
        if (A === 0) return index === B;
        return (index - B) / A >= 0 && (index - B) % A === 0;
    }
    return index === parseInt(a, 10);
}

function matchCompound(el, comp) {
    if (!el || el.nodeType !== 1) return false;
    if (comp.tag && comp.tag !== '*' && el.localName !== comp.tag) return false;
    for (const id of comp.ids) if (el.getAttribute('id') !== id) return false;
    if (comp.classes.length) {
        const cls = (el.getAttribute('class') || '').split(/\s+/);
        for (const c of comp.classes) if (!cls.includes(c)) return false;
    }
    for (const a of comp.attrs) {
        const v = el.getAttribute(a.name);
        if (v === null) return false;
        if (!a.op) continue;
        const x = a.ci ? v.toLowerCase() : v, y = a.ci ? String(a.val).toLowerCase() : String(a.val);
        if (a.op === '=' && x !== y) return false;
        if (a.op === '~=' && !x.split(/\s+/).includes(y)) return false;
        if (a.op === '|=' && !(x === y || x.startsWith(y + '-'))) return false;
        if (a.op === '^=' && !(y && x.startsWith(y))) return false;
        if (a.op === '$=' && !(y && x.endsWith(y))) return false;
        if (a.op === '*=' && !(y && x.includes(y))) return false;
    }
    for (const p of comp.pseudos) {
        const sibs = el.parentNode ? el.parentNode.childNodes.filter(c => c.nodeType === 1) : [el];
        const idx = sibs.indexOf(el);
        switch (p.name) {
            case 'not': if (matchesList(el, p.arg)) return false; break;
            case 'is': case 'matches': case 'where': if (!matchesList(el, p.arg)) return false; break;
            case 'has': if (!qsa(el, p.arg).length) return false; break;
            case 'first-child': if (idx !== 0) return false; break;
            case 'last-child': if (idx !== sibs.length - 1) return false; break;
            case 'only-child': if (sibs.length !== 1) return false; break;
            case 'first-of-type': if (sibs.filter(s => s.localName === el.localName)[0] !== el) return false; break;
            case 'last-of-type': { const t = sibs.filter(s => s.localName === el.localName); if (t[t.length - 1] !== el) return false; break; }
            case 'nth-child': if (!nthMatch(p.arg, idx + 1)) return false; break;
            case 'nth-last-child': if (!nthMatch(p.arg, sibs.length - idx)) return false; break;
            case 'nth-of-type': { const t = sibs.filter(s => s.localName === el.localName); if (!nthMatch(p.arg, t.indexOf(el) + 1)) return false; break; }
            case 'empty': if (el.childNodes.some(c => c.nodeType === 1 || (c.nodeType === 3 && c.data !== ''))) return false; break;
            case 'checked': if (!el.checked) return false; break;
            case 'disabled': if (!el.hasAttribute('disabled')) return false; break;
            case 'enabled': if (el.hasAttribute('disabled')) return false; break;
            case 'root': if (el !== el.ownerDocument.documentElement) return false; break;
            case 'link': case 'any-link': if (!(el.localName === 'a' && el.hasAttribute('href'))) return false; break;
            case 'visible': if (inlineHidden(el)) return false; break;
            case 'hidden': if (!inlineHidden(el)) return false; break;
            case 'first': case 'last': case 'eq': break;
            case 'focus': if (el.ownerDocument.activeElement !== el) return false; break;
            case 'focus-within': if (!el.contains(el.ownerDocument.activeElement)) return false; break;
            default: return false;   /* hover, active, focus-visible and other dynamic states are off */
        }
    }
    return true;
}

function inlineHidden(el) {
    for (let x = el; x && x.nodeType === 1; x = x.parentNode) if (x.style.display === 'none') return true;
    return false;
}

function matchComplex(el, cx) {
    const parts = cx.parts;
    const step = (node, k) => {
        if (!matchCompound(node, parts[k].comp)) return false;
        if (k === 0) return true;
        const comb = parts[k].comb;
        if (comb === '>') return step(node.parentNode, k - 1);
        if (comb === ' ') {
            for (let x = node.parentNode; x && x.nodeType === 1; x = x.parentNode) if (step(x, k - 1)) return true;
            return false;
        }
        if (comb === '+') return step(node.previousElementSibling, k - 1);
        if (comb === '~') {
            for (let x = node.previousElementSibling; x; x = x.previousElementSibling) if (step(x, k - 1)) return true;
            return false;
        }
        return false;
    };
    return parts.length ? step(el, parts.length - 1) : false;
}

function matchesList(el, sel) { return parseSelectorList(sel || '').some(cx => !cx.pseudoEl && matchComplex(el, cx)); }
function matchesSelector(el, sel) { return matchesList(el, sel); }

function descendants(root) {
    const out = [];
    const walk = n => { for (const c of n.childNodes) if (c.nodeType === 1) { out.push(c); walk(c); } };
    walk(root);
    return out;
}

function qsa(root, sel) {
    const s = String(sel).trim();
    if (/^#[\w-]+$/.test(s)) return descendants(root).filter(e => e.getAttribute('id') === s.slice(1));
    const scoped = s.replace(/^:scope\s*/, '');
    if (/^[>+~]/.test(scoped)) {
        /* relative selector, as jQuery .find('> x') */
        return descendants(root).filter(e => parseSelectorList(scoped.replace(/^>\s*/, '')).some(cx =>
            !cx.pseudoEl && matchComplex(e, cx) && e.parentNode === root));
    }
    return descendants(root).filter(e => matchesList(e, scoped));
}

/* ------------------------------------------------------------------------ */
/* jQuery subset                                                             */

function makeJQ(win) {
    const doc = win.document;
    const unknown = new Set();
    const base = {};

    function JQ(nodes) {
        this.length = 0;
        if (nodes) for (const n of nodes) if (n != null) this[this.length++] = n;
    }
    const proto = new Proxy(base, {
        get(t, k, r) {
            if (k in t) return Reflect.get(t, k, r);
            if (typeof k === 'string' && k !== 'then' && k !== 'constructor' && !/^\d+$/.test(k) && !k.startsWith('_')) {
                unknown.add(k);
                return function () { return this; };
            }
            return undefined;
        }
    });
    JQ.prototype = proto;

    const isJQ = x => x instanceof JQ;
    const arr = j => { const a = []; for (let i = 0; i < j.length; i++) a.push(j[i]); return a; };
    const uniq = list => Array.from(new Set(list));
    const isPlain = o => o != null && typeof o === 'object' && (Object.getPrototypeOf(o) === null || Object.getPrototypeOf(o).constructor === Object || Object.getPrototypeOf(o) === Object.prototype || String(Object.getPrototypeOf(o)) === '[object Object]') && !o.nodeType && !isJQ(o);

    function $(sel, ctx) {
        if (isJQ(sel)) return sel;
        if (sel == null || sel === '') return new JQ([]);
        if (typeof sel === 'function') { sel.call(doc, $); return new JQ([doc]); }
        if (typeof sel === 'string') {
            const s = sel.trim();
            if (s[0] === '<') {
                const j = new JQ(parseHTML(doc, s));
                if (ctx && isPlain(ctx)) j.attr(ctx);
                return j;
            }
            const roots = ctx ? arr($(ctx)) : [doc];
            return new JQ(uniq(roots.flatMap(r => (r.querySelectorAll ? r.querySelectorAll(s) : []))));
        }
        if (Array.isArray(sel)) return new JQ(sel);
        if (typeof sel === 'object' && sel.jquery && typeof sel.length === 'number') return new JQ(Array.from({length: sel.length}, (x, i) => sel[i]));
        if (typeof sel === 'object' && !sel.nodeType && sel !== win && typeof sel.length === 'number' && typeof sel !== 'string') return new JQ(Array.from(sel));
        return new JQ([sel]);
    }

    const toNodes = (c, clone) => {
        if (c == null || c === false) return [];
        if (typeof c === 'string' || typeof c === 'number') return parseHTML(doc, String(c));
        if (isJQ(c)) return arr(c).map(n => (clone ? n.cloneNode(true) : n));
        if (Array.isArray(c)) return c.flatMap(x => toNodes(x, clone));
        if (c.nodeType) return [clone ? c.cloneNode(true) : c];
        if (typeof c.length === 'number') return Array.from(c).map(n => (clone ? n.cloneNode(true) : n));
        return [];
    };

    const PROP_FIX = {'for': 'htmlFor', 'class': 'className', readonly: 'readOnly', maxlength: 'maxLength',
        tabindex: 'tabIndex', contenteditable: 'contentEditable', colspan: 'colSpan', rowspan: 'rowSpan'};
    const PX = new Set(['opacity', 'z-index', 'font-weight', 'line-height', 'flex', 'flex-grow', 'flex-shrink', 'order', 'zoom', 'column-count', 'fill-opacity']);

    function addHandler(el, types, selector, data, fn, once) {
        if (!el.addEventListener) return;
        for (const full of String(types).split(/\s+/).filter(Boolean)) {
            const [type, ...ns] = full.split('.');
            const wrapper = function (ev) {
                let target = el;
                if (selector) {
                    let x = ev.target;
                    target = null;
                    while (x && x !== el) { if (x.nodeType === 1 && matchesSelector(x, selector)) { target = x; break; } x = x.parentNode; }
                    if (!target) return;
                }
                if (once) removeHandlers(el, full, selector, fn);
                ev.data = data;
                ev.delegateTarget = el;
                const prevCur = ev.currentTarget;
                ev.currentTarget = target;
                const r = fn.apply(target, [ev].concat(ev._extra || []));
                ev.currentTarget = prevCur;
                if (r === false) { ev.preventDefault(); ev.stopPropagation(); }
                return undefined;
            };
            const list = el.__jq || (el.__jq = []);
            list.push({type, ns, selector, fn, wrapper});
            el.addEventListener(type, wrapper, false);
        }
    }
    function removeHandlers(el, types, selector, fn) {
        const list = el.__jq || [];
        const specs = types ? String(types).split(/\s+/).filter(Boolean).map(t => { const [type, ...ns] = t.split('.'); return {type, ns}; }) : [{type: '', ns: []}];
        for (const sp of specs) {
            for (const h of list.slice()) {
                if (sp.type && h.type !== sp.type) continue;
                if (sp.ns.length && !sp.ns.every(n => h.ns.includes(n))) continue;
                if (fn && h.fn !== fn) continue;
                if (selector && typeof selector === 'string' && h.selector !== selector) continue;
                el.removeEventListener(h.type, h.wrapper, false);
                list.splice(list.indexOf(h), 1);
            }
        }
    }

    Object.assign(base, {
        jquery: '3.7.1',
        constructor: $,
        [Symbol.iterator]() { return arr(this)[Symbol.iterator](); },
        each(fn) { for (let i = 0; i < this.length; i++) if (fn.call(this[i], i, this[i]) === false) break; return this; },
        map(fn) { const out = []; for (let i = 0; i < this.length; i++) { const r = fn.call(this[i], i, this[i]); if (r != null) Array.isArray(r) ? out.push(...r) : out.push(r); } return new JQ(out); },
        get(i) { return i === undefined ? arr(this) : this[i < 0 ? this.length + i : i]; },
        toArray() { return arr(this); },
        eq(i) { const n = this[i < 0 ? this.length + i : i]; return new JQ(n ? [n] : []); },
        first() { return this.eq(0); },
        last() { return this.eq(-1); },
        slice(a, b) { return new JQ(arr(this).slice(a, b)); },
        index(x) {
            if (x === undefined) { const n = this[0]; return n && n.parentNode ? n.parentNode.children.indexOf(n) : -1; }
            const node = isJQ(x) ? x[0] : typeof x === 'string' ? null : x;
            if (typeof x === 'string') return arr($(x)).indexOf(this[0]);
            return arr(this).indexOf(node);
        },
        find(sel) {
            if (typeof sel !== 'string') { const nodes = toNodes(sel); return new JQ(nodes.filter(n => arr(this).some(r => r !== n && r.contains && r.contains(n)))); }
            return new JQ(uniq(arr(this).flatMap(r => (r.querySelectorAll ? qsa(r, sel) : []))));
        },
        children(sel) { return new JQ(arr(this).flatMap(e => (e.children || []).filter(c => !sel || matchesSelector(c, sel)))); },
        contents() { return new JQ(arr(this).flatMap(e => e.childNodes || [])); },
        parent(sel) { return new JQ(uniq(arr(this).map(e => e.parentNode).filter(p => p && p.nodeType === 1 && (!sel || matchesSelector(p, sel))))); },
        parents(sel) { const out = []; for (const e of arr(this)) for (let x = e.parentNode; x && x.nodeType === 1; x = x.parentNode) if (!sel || matchesSelector(x, sel)) out.push(x); return new JQ(uniq(out)); },
        parentsUntil(sel) { const out = []; for (const e of arr(this)) for (let x = e.parentNode; x && x.nodeType === 1; x = x.parentNode) { if (sel && matchesSelector(x, sel)) break; out.push(x); } return new JQ(uniq(out)); },
        closest(sel) {
            const out = [];
            for (const e of arr(this)) {
                for (let x = e; x && x.nodeType === 1; x = x.parentNode) {
                    if (typeof sel === 'string' ? matchesSelector(x, sel) : (isJQ(sel) ? arr(sel).includes(x) : x === sel)) { out.push(x); break; }
                }
            }
            return new JQ(uniq(out));
        },
        siblings(sel) { return new JQ(uniq(arr(this).flatMap(e => (e.parentNode ? e.parentNode.children.filter(c => c !== e && (!sel || matchesSelector(c, sel))) : [])))); },
        next(sel) { return new JQ(arr(this).map(e => e.nextElementSibling).filter(n => n && (!sel || matchesSelector(n, sel)))); },
        prev(sel) { return new JQ(arr(this).map(e => e.previousElementSibling).filter(n => n && (!sel || matchesSelector(n, sel)))); },
        nextAll(sel) { const out = []; for (const e of arr(this)) for (let x = e.nextElementSibling; x; x = x.nextElementSibling) if (!sel || matchesSelector(x, sel)) out.push(x); return new JQ(out); },
        prevAll(sel) { const out = []; for (const e of arr(this)) for (let x = e.previousElementSibling; x; x = x.previousElementSibling) if (!sel || matchesSelector(x, sel)) out.push(x); return new JQ(out); },
        filter(sel) {
            if (typeof sel === 'function') return new JQ(arr(this).filter((e, i) => sel.call(e, i, e)));
            if (typeof sel === 'string') return new JQ(arr(this).filter(e => e.nodeType === 1 && matchesSelector(e, sel)));
            const nodes = toNodes(sel);
            return new JQ(arr(this).filter(e => nodes.includes(e)));
        },
        not(sel) {
            if (typeof sel === 'function') return new JQ(arr(this).filter((e, i) => !sel.call(e, i, e)));
            if (typeof sel === 'string') return new JQ(arr(this).filter(e => !(e.nodeType === 1 && matchesSelector(e, sel))));
            const nodes = toNodes(sel);
            return new JQ(arr(this).filter(e => !nodes.includes(e)));
        },
        is(sel) {
            if (!sel) return false;
            if (typeof sel === 'function') return arr(this).some((e, i) => sel.call(e, i, e));
            if (typeof sel === 'string') {
                if (sel === ':visible') return arr(this).some(e => e.nodeType === 1 && !(win.__world && win.__world.hidden(e)));
                if (sel === ':hidden') return arr(this).some(e => e.nodeType === 1 && win.__world && win.__world.hidden(e));
                return arr(this).some(e => e.nodeType === 1 && matchesSelector(e, sel));
            }
            const nodes = toNodes(sel);
            return arr(this).some(e => nodes.includes(e));
        },
        has(sel) { return new JQ(arr(this).filter(e => (typeof sel === 'string' ? qsa(e, sel).length : e.contains(isJQ(sel) ? sel[0] : sel)))); },
        add(sel, ctx) { return new JQ(uniq(arr(this).concat(arr($(sel, ctx))))); },
        addBack() { return this; },
        end() { return this; },
        append(...cs) { arr(this).forEach((t, i) => cs.forEach(c => toNodes(typeof c === 'function' ? c.call(t, i, t.innerHTML) : c, i > 0).forEach(n => t.appendChild(n)))); return this; },
        prepend(...cs) { arr(this).forEach((t, i) => { const f = t.firstChild; cs.forEach(c => toNodes(c, i > 0).forEach(n => t.insertBefore(n, f))); }); return this; },
        appendTo(target) { const ts = arr($(target)); ts.forEach((t, i) => arr(this).forEach(n => t.appendChild(i > 0 ? n.cloneNode(true) : n))); return this; },
        prependTo(target) { const ts = arr($(target)); ts.forEach((t, i) => { const f = t.firstChild; arr(this).forEach(n => t.insertBefore(i > 0 ? n.cloneNode(true) : n, f)); }); return this; },
        after(...cs) { arr(this).forEach((t, i) => { if (!t.parentNode) return; const nx = t.nextSibling; cs.forEach(c => toNodes(c, i > 0).forEach(n => t.parentNode.insertBefore(n, nx))); }); return this; },
        before(...cs) { arr(this).forEach((t, i) => { if (!t.parentNode) return; cs.forEach(c => toNodes(c, i > 0).forEach(n => t.parentNode.insertBefore(n, t))); }); return this; },
        insertAfter(target) { const t = $(target)[0]; if (t && t.parentNode) { let ref = t.nextSibling; arr(this).forEach(n => t.parentNode.insertBefore(n, ref)); } return this; },
        insertBefore(target) { const t = $(target)[0]; if (t && t.parentNode) arr(this).forEach(n => t.parentNode.insertBefore(n, t)); return this; },
        replaceWith(c) { arr(this).forEach((t, i) => { if (!t.parentNode) return; toNodes(c, i > 0).forEach(n => t.parentNode.insertBefore(n, t)); t.remove(); }); return this; },
        wrap(html) { arr(this).forEach(t => { const w = toNodes(html, true)[0]; if (!w || !t.parentNode) return; t.parentNode.insertBefore(w, t); let inner = w; while (inner.firstElementChild) inner = inner.firstElementChild; inner.appendChild(t); }); return this; },
        remove(sel) { arr(this).forEach(e => { if (!sel || matchesSelector(e, sel)) { removeHandlers(e); e.remove && e.remove(); } }); return this; },
        detach() { arr(this).forEach(e => e.remove && e.remove()); return this; },
        empty() { arr(this).forEach(e => { e.textContent = ''; }); return this; },
        clone() { return new JQ(arr(this).map(e => e.cloneNode(true))); },
        html(v) {
            if (v === undefined) return this[0] ? this[0].innerHTML : undefined;
            arr(this).forEach((e, i) => {
                const val = typeof v === 'function' ? v.call(e, i, e.innerHTML) : v;
                if (isJQ(val) || (val && val.nodeType)) { e.textContent = ''; toNodes(val).forEach(n => e.appendChild(n)); }
                else e.innerHTML = val == null ? '' : String(val);
            });
            return this;
        },
        text(v) {
            if (v === undefined) return arr(this).map(e => e.textContent || '').join('');
            arr(this).forEach((e, i) => { e.textContent = typeof v === 'function' ? v.call(e, i, e.textContent) : (v == null ? '' : String(v)); });
            return this;
        },
        attr(name, v) {
            if (name && typeof name === 'object') { Object.keys(name).forEach(k => this.attr(k, name[k])); return this; }
            if (v === undefined && arguments.length < 2) { const e = this[0]; if (!e || !e.getAttribute) return undefined; const r = e.getAttribute(name); return r === null ? undefined : r; }
            arr(this).forEach((e, i) => {
                if (!e.setAttribute) return;
                const val = typeof v === 'function' ? v.call(e, i, e.getAttribute(name)) : v;
                if (val === null || val === undefined) e.removeAttribute(name);
                else if (val === false && BOOL_ATTRS.has(String(name).toLowerCase())) e.removeAttribute(name);
                else if (val === true && BOOL_ATTRS.has(String(name).toLowerCase())) e.setAttribute(name, name);
                else e.setAttribute(name, val);
            });
            return this;
        },
        removeAttr(names) { arr(this).forEach(e => String(names).split(/\s+/).forEach(n => e.removeAttribute && e.removeAttribute(n))); return this; },
        prop(name, v) {
            if (name && typeof name === 'object') { Object.keys(name).forEach(k => this.prop(k, name[k])); return this; }
            name = PROP_FIX[name] || name;
            if (v === undefined && arguments.length < 2) { const e = this[0]; return e ? e[name] : undefined; }
            arr(this).forEach((e, i) => { e[name] = typeof v === 'function' ? v.call(e, i, e[name]) : v; });
            return this;
        },
        removeProp(name) { arr(this).forEach(e => { delete e[name]; }); return this; },
        data(key, v) {
            const e = this[0];
            const store = n => n.__jqdata || (n.__jqdata = {});
            if (key === undefined) return e ? Object.assign({}, store(e)) : undefined;
            if (typeof key === 'object') { arr(this).forEach(n => Object.assign(store(n), key)); return this; }
            if (v === undefined && arguments.length < 2) {
                if (!e) return undefined;
                const s = store(e);
                if (key in s) return s[key];
                const a = e.getAttribute ? e.getAttribute('data-' + kebab(key)) : null;
                if (a === null) return undefined;
                if (a === 'true') return true;
                if (a === 'false') return false;
                if (a !== '' && !isNaN(+a)) return +a;
                try { if (/^[[{]/.test(a)) return JSON.parse(a); } catch (er) { /* plain string */ }
                return a;
            }
            arr(this).forEach(n => { store(n)[key] = v; });
            return this;
        },
        removeData(key) { arr(this).forEach(n => { if (n.__jqdata) { if (key) delete n.__jqdata[key]; else n.__jqdata = {}; } }); return this; },
        val(v) {
            if (v === undefined) { const e = this[0]; return e ? e.value : undefined; }
            arr(this).forEach((e, i) => { e.value = typeof v === 'function' ? v.call(e, i, e.value) : v; });
            return this;
        },
        addClass(c) { arr(this).forEach((e, i) => { const v = typeof c === 'function' ? c.call(e, i, e.className) : c; if (e.classList && v) e.classList.add(...String(v).split(/\s+/).filter(Boolean)); }); return this; },
        removeClass(c) {
            arr(this).forEach((e, i) => {
                if (!e.classList) return;
                if (c === undefined) { e.setAttribute('class', ''); return; }
                const v = typeof c === 'function' ? c.call(e, i, e.className) : c;
                if (v) e.classList.remove(...String(v).split(/\s+/).filter(Boolean));
            });
            return this;
        },
        toggleClass(c, state) {
            arr(this).forEach(e => { if (!e.classList) return; String(c).split(/\s+/).filter(Boolean).forEach(x => e.classList.toggle(x, typeof state === 'boolean' ? state : undefined)); });
            return this;
        },
        hasClass(c) { return arr(this).some(e => e.classList && e.classList.contains(c)); },
        css(name, v) {
            if (name && typeof name === 'object' && !Array.isArray(name)) { Object.keys(name).forEach(k => this.css(k, name[k])); return this; }
            if (Array.isArray(name)) { const o = {}; name.forEach(n => { o[n] = this.css(n); }); return o; }
            if (v === undefined && arguments.length < 2) {
                const e = this[0];
                if (!e || !e.style) return undefined;
                const k = kebab(name);
                const inline = e.style.getPropertyValue(k);
                if (inline) return inline;
                const cs = win.getComputedStyle(e);
                return cs.getPropertyValue(k);
            }
            arr(this).forEach((e, i) => {
                if (!e.style) return;
                const k = kebab(name);
                let val = typeof v === 'function' ? v.call(e, i, e.style.getPropertyValue(k)) : v;
                if (typeof val === 'number' && !PX.has(k) && !k.startsWith('--')) val = val + 'px';
                e.style.setProperty(k, val === null || val === undefined ? '' : String(val));
            });
            return this;
        },
        show() { arr(this).forEach(e => { if (e.style && e.style.display === 'none') e.style.display = ''; if (e.hasAttribute && e.hasAttribute('hidden')) e.removeAttribute('hidden'); }); return this; },
        hide() { arr(this).forEach(e => { if (e.style) e.style.display = 'none'; }); return this; },
        toggle(state) { arr(this).forEach(e => { const on = typeof state === 'boolean' ? state : e.style.display === 'none'; e.style.display = on ? '' : 'none'; }); return this; },
        fadeIn(d, cb) { this.show(); const f = [d, cb].find(x => typeof x === 'function'); f && arr(this).forEach(e => f.call(e)); return this; },
        fadeOut(d, cb) { this.hide(); const f = [d, cb].find(x => typeof x === 'function'); f && arr(this).forEach(e => f.call(e)); return this; },
        slideDown(d, cb) { return this.fadeIn(d, cb); },
        slideUp(d, cb) { return this.fadeOut(d, cb); },
        animate(props, a, b, c) { if (props && typeof props === 'object') this.css(props); const f = [a, b, c].find(x => typeof x === 'function') || (a && a.complete); f && arr(this).forEach(e => f.call(e)); return this; },
        stop() { return this; },
        delay() { return this; },
        promise() { return {done: f => { f && f(); }, then: f => { f && f(); }}; },
        width(v) { if (v === undefined) { const e = this[0]; if (!e) return 0; if (e === win) return win.innerWidth; if (e.nodeType === 9) return win.innerWidth; return parseFloat(e.style && e.style.width) || 0; } return this.css('width', v); },
        height(v) { if (v === undefined) { const e = this[0]; if (!e) return 0; if (e === win) return win.innerHeight; if (e.nodeType === 9) return win.innerHeight; return parseFloat(e.style && e.style.height) || 0; } return this.css('height', v); },
        innerWidth() { return this.width(); },
        innerHeight() { return this.height(); },
        outerWidth() { return this.width(); },
        outerHeight() { return this.height(); },
        offset() { return {top: 0, left: 0}; },
        position() { return {top: 0, left: 0}; },
        scrollTop(v) { if (v === undefined) return this[0] ? this[0].scrollTop || 0 : 0; arr(this).forEach(e => { e.scrollTop = v; }); return this; },
        scrollLeft(v) { if (v === undefined) return this[0] ? this[0].scrollLeft || 0 : 0; arr(this).forEach(e => { e.scrollLeft = v; }); return this; },
        on(types, selector, data, fn) {
            if (types && typeof types === 'object') { Object.keys(types).forEach(t => this.on(t, selector, data, types[t])); return this; }
            if (fn === undefined && data === undefined) { fn = selector; selector = undefined; }
            else if (fn === undefined) {
                if (typeof selector === 'string') { fn = data; data = undefined; }
                else { fn = data; data = selector; selector = undefined; }
            }
            if (typeof fn !== 'function') return this;
            arr(this).forEach(e => addHandler(e, types, selector, data, fn, false));
            return this;
        },
        one(types, selector, data, fn) {
            if (fn === undefined && data === undefined) { fn = selector; selector = undefined; }
            else if (fn === undefined) { if (typeof selector === 'string') { fn = data; data = undefined; } else { fn = data; data = selector; selector = undefined; } }
            if (typeof fn !== 'function') return this;
            arr(this).forEach(e => addHandler(e, types, selector, data, fn, true));
            return this;
        },
        off(types, selector, fn) {
            if (typeof selector === 'function') { fn = selector; selector = undefined; }
            arr(this).forEach(e => removeHandlers(e, types, selector, fn));
            return this;
        },
        bind(t, d, f) { return this.on(t, d, f); },
        unbind(t, f) { return this.off(t, f); },
        delegate(sel, t, f) { return this.on(t, sel, f); },
        undelegate(sel, t, f) { return this.off(t, sel, f); },
        trigger(type, extra) {
            arr(this).forEach(e => {
                const ev = typeof type === 'string' ? new DomEvent(type.split('.')[0], {bubbles: true}) : Object.assign(new DomEvent(type.type, {bubbles: true}), type);
                ev._extra = extra === undefined ? [] : (Array.isArray(extra) ? extra : [extra]);
                if (ev.type === 'focus' && e.focus) { e.focus(); return; }
                if (ev.type === 'blur' && e.blur) { e.blur(); return; }
                if (ev.type === 'click' && e.disabled) return;
                if (e.dispatchEvent) e.dispatchEvent(ev);
            });
            return this;
        },
        triggerHandler(type, extra) {
            const e = this[0];
            if (!e || !e.__jq) return undefined;
            const ev = new DomEvent(type, {bubbles: false});
            ev.target = e;
            ev._extra = extra === undefined ? [] : (Array.isArray(extra) ? extra : [extra]);
            let r;
            for (const h of e.__jq.slice()) if (h.type === type && !h.selector) r = h.fn.apply(e, [ev].concat(ev._extra));
            return r;
        },
        hover(fin, fout) { return this.on('mouseenter', fin).on('mouseleave', fout || fin); },
        serialize() { return ''; },
        ready(fn) { fn && fn($); return this; }
    });
    ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
        'keydown', 'keyup', 'keypress', 'focus', 'blur', 'change', 'input', 'submit', 'scroll', 'resize', 'contextmenu',
        'focusin', 'focusout', 'select', 'wheel'].forEach(t => {
        base[t] = function (a, b) {
            if (typeof a === 'function') return this.on(t, a);
            if (typeof b === 'function') return this.on(t, a, b);
            if (t === 'focus') { if (this[0] && this[0].focus) this[0].focus(); return this; }
            if (t === 'blur') { if (this[0] && this[0].blur) this[0].blur(); return this; }
            return this.trigger(t);
        };
    });

    $.fn = base;
    $.fn.extend = obj => Object.assign(base, obj);
    $.extend = function (...args) {
        let deep = false;
        if (typeof args[0] === 'boolean') deep = args.shift();
        const target = args.shift() || {};
        for (const src of args) {
            if (!src) continue;
            for (const k of Object.keys(src)) {
                const v = src[k];
                if (deep && v && typeof v === 'object' && (isPlain(v) || Array.isArray(v))) {
                    const t = target[k] && typeof target[k] === 'object' ? target[k] : (Array.isArray(v) ? [] : {});
                    target[k] = $.extend(true, t, v);
                } else if (v !== undefined) target[k] = v;
            }
        }
        return target;
    };
    $.each = (obj, fn) => {
        if (obj == null) return obj;
        if (Array.isArray(obj) || isJQ(obj) || typeof obj.length === 'number') { for (let i = 0; i < obj.length; i++) if (fn.call(obj[i], i, obj[i]) === false) break; }
        else for (const k of Object.keys(obj)) if (fn.call(obj[k], k, obj[k]) === false) break;
        return obj;
    };
    $.map = (obj, fn) => { const out = []; $.each(obj, (k, v) => { const r = fn(v, k); if (r != null) Array.isArray(r) ? out.push(...r) : out.push(r); }); return out; };
    $.grep = (a, fn, inv) => Array.from(a).filter((v, i) => !!fn(v, i) !== !!inv);
    $.inArray = (v, a) => (a ? Array.from(a).indexOf(v) : -1);
    $.isArray = Array.isArray;
    $.isFunction = f => typeof f === 'function';
    $.isPlainObject = isPlain;
    $.isEmptyObject = o => !o || !Object.keys(o).length;
    $.isNumeric = v => !isNaN(parseFloat(v)) && isFinite(v);
    $.isWindow = o => o === win;
    $.type = o => (o === null ? 'null' : Array.isArray(o) ? 'array' : typeof o);
    $.trim = s => (s == null ? '' : String(s).trim());
    $.noop = () => {};
    $.now = () => Date.now();
    $.proxy = (fn, ctx) => (typeof ctx === 'string' ? fn[ctx].bind(fn) : fn.bind(ctx));
    $.contains = (a, b) => a !== b && a.contains(b);
    $.merge = (a, b) => { for (let i = 0; i < b.length; i++) a[a.length === undefined ? 0 : a.length] = b[i]; return a; };
    $.makeArray = a => Array.from(a || []);
    $.parseHTML = s => parseHTML(doc, s);
    $.data = (el, k, v) => (v === undefined ? $(el).data(k) : $(el).data(k, v));
    $.Event = (type, props) => Object.assign(new DomEvent(type, {bubbles: true}), props || {});
    $.support = {};
    $.browser = {};
    $.event = {special: {}, fix: e => e};
    $.expr = {pseudos: {}, ':': {}};
    $.cssHooks = {};
    $.fx = {off: true};
    $.Deferred = function () {
        let state = 'pending', value;
        const done = [], fail = [];
        const d = {
            resolve(...v) { if (state !== 'pending') return d; state = 'resolved'; value = v; done.forEach(f => f(...v)); return d; },
            reject(...v) { if (state !== 'pending') return d; state = 'rejected'; value = v; fail.forEach(f => f(...v)); return d; },
            done(f) { if (state === 'resolved') f(...value); else done.push(f); return d; },
            fail(f) { if (state === 'rejected') f(...value); else fail.push(f); return d; },
            always(f) { return d.done(f).fail(f); },
            then(a, b) { if (a) d.done(a); if (b) d.fail(b); return d; },
            state: () => state,
            promise: () => d
        };
        return d;
    };
    $.when = (...ds) => { const d = $.Deferred(); d.resolve(...ds); return d; };
    $._unknown = unknown;
    $._isJQ = isJQ;
    return $;
}

/* ------------------------------------------------------------------------ */
/* CSS: compile, parse, cascade                                              */

let lessCache = null;
function lessCompiler() {
    if (lessCache) return lessCache;
    const roots = [path.join(ROOT, 'build')];
    try {
        const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
        roots.push(path.join(path.dirname(common), 'build'));
    } catch (e) { /* no git */ }
    for (const r of roots) {
        try { lessCache = require(require.resolve('less', {paths: [r]})); return lessCache; } catch (e) { /* next */ }
    }
    throw new Error('the less compiler is not found (run npm install in build/ of the web-apps copy)');
}

const cssCache = new Map();
async function compileLess(file) {
    if (cssCache.has(file)) return cssCache.get(file);
    const p = (async () => {
        if (!fs.existsSync(file)) throw new Error(path.relative(ROOT, file) + ' is missing');
        const less = lessCompiler();
        const out = await less.render(fs.readFileSync(file, 'utf8'), {filename: file, javascriptEnabled: true});
        return out.css;
    })();
    cssCache.set(file, p);
    return p;
}

/* The compact layer of the document editor as its app.less imports it: the stock image
   paths from common/main/resources/less/variables.less, the shared shell files
   (common/main/resources/less/compact/*.less) in the app.less order, then its own
   compact-shell.less, whose definitions win. The documents are read as they are. */
const DE_APP_LESS = path.join(DE_LESS, 'app.less');
const STOCK_VARS = path.join(APPS, 'common/main/resources/less/variables.less');
const SHARED_COMPACT_LESS = path.join(APPS, 'common/main/resources/less/compact');
const SHARED_AIR = path.join(APPS, 'common/main/resources/img/air');

function documentsLayerSource() {
    const vars = fs.readFileSync(STOCK_VARS, 'utf8');
    const paths = ['app-image-const-path', 'common-image-const-path'].map(name => {
        const m = new RegExp('^@' + name + ':[^;\\n]*;', 'm').exec(vars);
        if (!m) throw new Error('variables.less: @' + name + ' is not found');
        return m[0];
    });
    const lines = fs.readFileSync(DE_APP_LESS, 'utf8').split('\n').map(l => l.trim());
    const own = lines.indexOf('@import "compact-shell.less";');
    if (own < 0) throw new Error('documents app.less does not import compact-shell.less');
    let first = own;
    while (first > 0 && /^@import\s+"[^"]*common\/main\/resources\/less\/compact\/[\w-]+\.less";$/.test(lines[first - 1])) first--;
    return paths.concat(lines.slice(first, own + 1)).join('\n');
}

async function compileDocumentsLess() {
    const key = DE_APP_LESS + '#compact';
    if (cssCache.has(key)) return cssCache.get(key);
    const p = lessCompiler().render(documentsLayerSource(), {filename: DE_APP_LESS, javascriptEnabled: true}).then(out => out.css);
    cssCache.set(key, p);
    return p;
}

/* Menu tokens of the shared layer (--vo-menu-* of compact/tokens.less): only the shared
   menu bar rules read them, the presentation shell keeps a menu bar of its own. */
function sharedMenuTokens() {
    const text = fs.readFileSync(path.join(SHARED_COMPACT_LESS, 'tokens.less'), 'utf8');
    return new Set(Array.from(text.matchAll(/(--vo-menu-[\w-]+)\s*:/g), m => m[1]));
}

const MEDIA_SKIP = /(max|min)-(width|height)|print|hover|pointer|prefers-|resolution|device-pixel-ratio/i;

function parseCss(text) {
    text = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    let order = 0;
    const scan = (s, from, to, include) => {
        let i = from;
        while (i < to) {
            let j = i, depth = 0, quote = null;
            while (j < to) {
                const c = s[j];
                if (quote) { if (c === '\\') { j += 2; continue; } if (c === quote) quote = null; j++; continue; }
                if (c === '"' || c === "'") { quote = c; j++; continue; }
                if (c === '(') depth++;
                else if (c === ')') depth--;
                else if ((c === '{' || c === ';') && depth === 0) break;
                j++;
            }
            if (j >= to) break;
            const prelude = s.slice(i, j).trim();
            if (s[j] === ';') { i = j + 1; continue; }
            let k = j + 1, d = 1;
            quote = null;
            while (k < to && d) {
                const c = s[k];
                if (quote) { if (c === '\\') { k += 2; continue; } if (c === quote) quote = null; k++; continue; }
                if (c === '"' || c === "'") quote = c;
                else if (c === '{') d++;
                else if (c === '}') d--;
                k++;
            }
            const innerFrom = j + 1, innerTo = k - 1;
            if (prelude.startsWith('@')) {
                const name = /^@([\w-]+)/.exec(prelude)[1].toLowerCase();
                if (name === 'media') { if (include && !MEDIA_SKIP.test(prelude)) scan(s, innerFrom, innerTo, true); }
                else if (name === 'supports' || name === 'layer' || name === 'document') scan(s, innerFrom, innerTo, include);
            } else if (include && prelude) {
                const decls = [];
                for (const d2 of splitTop(s.slice(innerFrom, innerTo), ';')) {
                    const c = d2.indexOf(':');
                    if (c < 0) continue;
                    let prop = d2.slice(0, c).trim();
                    let value = d2.slice(c + 1).trim();
                    if (!prop.startsWith('--')) prop = prop.toLowerCase();
                    const important = /!\s*important\s*$/i.test(value);
                    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
                    decls.push({prop, value, important});
                }
                const sels = splitTop(prelude, ',').map(t => {
                    const cx = parseComplex(t);
                    return {text: t, cx};
                });
                rules.push({sels, decls, order: order++});
            }
            i = k;
        }
    };
    scan(text, 0, text.length, true);
    return rules;
}

function ruleKey(cx) {
    const last = cx.parts[cx.parts.length - 1];
    if (!last) return '*';
    const c = last.comp;
    if (c.ids.length) return '#' + c.ids[0];
    if (c.classes.length) return '.' + c.classes[0];
    if (c.tag && c.tag !== '*') return c.tag;
    return '*';
}

class Cascade {
    constructor(cssText) {
        this.rules = parseCss(cssText);
        this.index = new Map();
        for (const r of this.rules) {
            r.sels.forEach(s => {
                if (s.cx.pseudoEl) return;
                const key = ruleKey(s.cx);
                if (!this.index.has(key)) this.index.set(key, []);
                this.index.get(key).push({rule: r, sel: s});
            });
        }
    }
    candidates(el) {
        const keys = ['*', el.localName];
        const id = el.getAttribute('id');
        if (id) keys.push('#' + id);
        for (const c of (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)) keys.push('.' + c);
        const out = [];
        const seen = new Set();
        for (const k of keys) {
            for (const e of this.index.get(k) || []) {
                if (seen.has(e)) continue;
                seen.add(e);
                if (matchComplex(el, e.sel.cx)) out.push(e);
            }
        }
        return out;
    }
    /* declared value of `prop` for `el` after the cascade, null when nothing applies */
    declared(el, prop) {
        const props = prop === 'background-color' ? ['background-color', 'background'] : [prop];
        let best = null;
        const better = (a, b) => {
            if (!b) return true;
            if (a.important !== b.important) return a.important;
            if (a.inline !== b.inline) return a.inline;
            for (let i = 0; i < 3; i++) if (a.spec[i] !== b.spec[i]) return a.spec[i] > b.spec[i];
            return a.order > b.order;
        };
        for (const e of this.candidates(el)) {
            e.rule.decls.forEach((d, di) => {
                if (!props.includes(d.prop)) return;
                const value = d.prop === 'background' && prop === 'background-color' ? backgroundColorOf(d.value) : d.value;
                const c = {value, important: d.important, inline: false, spec: e.sel.cx.spec, order: e.rule.order * 1000 + di, src: e.sel.text};
                if (better(c, best)) best = c;
            });
        }
        if (el.style) {
            const entries = el.style._entries();
            for (const p of props) {
                const v = entries.get(p);
                if (!v) continue;
                const value = p === 'background' && prop === 'background-color' ? backgroundColorOf(v.value) : v.value;
                const c = {value, important: v.important, inline: true, spec: [9, 9, 9], order: 1e12, src: 'inline'};
                if (better(c, best)) best = c;
            }
        }
        return best;
    }
    value(el, prop, depth) {
        if (!el || el.nodeType !== 1) return '';
        const d = this.declared(el, prop);
        const inherited = prop.startsWith('--') || /^(color|font|visibility|cursor|line-height|letter-spacing|text-align|white-space)/.test(prop);
        if (!d || d.value === 'inherit') {
            if (inherited && el.parentNode && el.parentNode.nodeType === 1) return this.value(el.parentNode, prop, depth);
            return '';
        }
        return this.resolveVars(el, d.value, (depth || 0) + 1);
    }
    resolveVars(el, value, depth) {
        if (depth > 20 || !/var\(/.test(value)) return value;
        let out = '', i = 0;
        while (i < value.length) {
            const k = value.indexOf('var(', i);
            if (k < 0) { out += value.slice(i); break; }
            out += value.slice(i, k);
            let j = k + 4, d = 1;
            while (j < value.length && d) { if (value[j] === '(') d++; else if (value[j] === ')') d--; j++; }
            const inner = value.slice(k + 4, j - 1);
            const parts = splitTop(inner, ',');
            const name = parts[0].trim();
            const fallback = inner.indexOf(',') >= 0 ? inner.slice(inner.indexOf(',') + 1).trim() : null;
            let v = this.value(el, name, depth);
            if (!v && fallback !== null) v = this.resolveVars(el, fallback, depth + 1);
            out += v ? v : '\u0000unresolved(' + name + ')';
            i = j;
        }
        return out;
    }
}

function backgroundColorOf(value) {
    const tokens = splitTop(String(value).replace(/\s+/g, ' '), ' ');
    for (const t of tokens) {
        if (/^var\(/.test(t)) return t;
        if (parseColor(t)) return t;
    }
    if (/^(none|transparent)$/i.test(value.trim())) return 'transparent';
    return 'transparent';
}

const NAMED = {white: '#ffffff', black: '#000000', transparent: 'rgba(0,0,0,0)', red: '#ff0000', gray: '#808080', grey: '#808080', silver: '#c0c0c0'};
function parseColor(s) {
    if (s == null) return null;
    s = String(s).trim().toLowerCase();
    if (NAMED[s]) s = NAMED[s];
    let m = /^#([0-9a-f]{3,8})$/.exec(s);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
        if (h.length !== 6 && h.length !== 8) return null;
        return {r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1};
    }
    m = /^rgba?\(([^)]*)\)$/.exec(s);
    if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(x => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)));
        if (p.length < 3 || p.slice(0, 3).some(isNaN)) return null;
        return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? (String(m[1]).split(/[\s,/]+/).filter(Boolean)[3].endsWith('%') ? p[3] / 255 : p[3]) : 1};
    }
    return null;
}
const colorHex = c => (c ? '#' + [c.r, c.g, c.b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('') + (c.a < 1 ? '/' + c.a.toFixed(2) : '') : String(c));
const luminance = c => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
const isWhite = c => !!c && c.a > 0.98 && c.r >= 250 && c.g >= 250 && c.b >= 250;

/* ------------------------------------------------------------------------ */
/* stock world                                                               */

const LIGHT_THEME_COLORS = {
    'canvas-background': '#eeeeee', 'background-toolbar': '#ffffff', 'background-normal': '#ffffff',
    'border-toolbar': '#cbcbcb', 'text-normal': 'rgba(0, 0, 0, 0.8)', 'canvas-scroll-thumb': '#f7f7f7',
    'canvas-page-border': '#dde0e5', 'border-preview-select': '#848484', 'border-preview-hover': '#cfcfcf'
};
const DARK_THEME_COLORS = {
    'canvas-background': '#555555', 'background-toolbar': '#404040', 'background-normal': '#333333',
    'border-toolbar': '#2a2a2a', 'text-normal': 'rgba(255, 255, 255, 0.8)', 'canvas-scroll-thumb': '#404040',
    'canvas-page-border': '#555555', 'border-preview-select': '#cccccc', 'border-preview-hover': '#999999'
};
const SKIN_BASE = {
    light: {Type: 'light', BackgroundColor: '#EEEEEE', BackgroundColorThumbnails: '#F4F4F4', BackgroundColorNotes: '#F0F0F0', ScrollBackgroundColor: '#EEEEEE', BorderSplitterColor: '#CBCBCB'},
    dark: {Type: 'dark', BackgroundColor: '#666666', BackgroundColorThumbnails: '#404040', BackgroundColorNotes: '#666666', ScrollBackgroundColor: '#666666', BorderSplitterColor: '#616161'}
};
/* the part of the engine colour map that paints the presentation workspace */
const SKIN_MAP = {
    BackgroundColor: 'canvas-background',
    ScrollBackgroundColor: 'canvas-background',
    BackgroundColorThumbnails: 'background-toolbar',
    BackgroundColorNotes: 'canvas-background',
    BorderSplitterColor: 'border-toolbar'
};

const SDK_HTML = skin =>
    '<div id="id_panel_thumbnails" class="block_elem" style="background-color:' + skin.BackgroundColorThumbnails + ';">' +
    '<div id="id_panel_thumbnails_split" class="block_elem" style="background-color:' + skin.BackgroundColorThumbnails + ';"></div>' +
    '<canvas id="id_thumbnails_background" class="block_elem"></canvas><canvas id="id_thumbnails" class="block_elem"></canvas>' +
    '<div id="id_vertical_scroll_thmbnl"></div></div>' +
    '<div id="id_main_parent" class="block_elem">' +
    '<div id="id_main" class="block_elem" style="background-color:' + skin.BackgroundColor + ';">' +
    '<div id="id_panel_left" class="block_elem"><canvas id="id_buttonTabs" class="block_elem"></canvas><canvas id="id_vert_ruler" class="block_elem"></canvas></div>' +
    '<div id="id_panel_top" class="block_elem"><canvas id="id_hor_ruler" class="block_elem"></canvas></div>' +
    '<div id="id_main_view" class="block_elem"><canvas id="id_viewer" class="block_elem" style="background-color:' + skin.BackgroundColor + ';"></canvas>' +
    '<canvas id="id_viewer_overlay" class="block_elem"></canvas></div>' +
    '<div id="id_panel_right" class="block_elem" style="background-color:' + skin.ScrollBackgroundColor + ';"></div>' +
    '<div id="id_horscrollpanel" class="block_elem" style="background-color:' + skin.ScrollBackgroundColor + ';"></div>' +
    '</div></div>' +
    '<div id="id_bottom_pannels_container" class="block_elem" style="background-color:' + skin.BackgroundColorNotes + ';">' +
    '<div id="id_panel_notes" class="block_elem" style="background-color:' + skin.BackgroundColorNotes + ';">' +
    '<canvas id="id_notes" class="block_elem" style="background-color:' + skin.BackgroundColorNotes + ';"></canvas>' +
    '<canvas id="id_notes_overlay" class="block_elem"></canvas></div>' +
    '<div id="id_panel_animation" class="block_elem"></div></div>';

const DEFAULT_RIGHTS = {
    isEdit: true, canEdit: true, canLicense: true, canDownload: true, canPrint: true, canComments: true,
    canViewComments: true, canCoAuthoring: true, canChat: true, canRename: true, canUseHistory: true,
    canRequestSharingSettings: true, sharingSettingsUrl: undefined, canHelp: true, canProtect: true,
    canHistoryClose: false, isOffline: false, isDesktopApp: false, canBrandingExt: false, isRestrictedEdit: false,
    canAnalytics: false, canPlugins: false, canSwitchMode: false, isEditDiagram: false, isEditMailMerge: false,
    isEditOle: false, canRequestEditRights: false, canRequestClose: false, canFeatureVersionHistory: true,
    canUseCommentPermissions: false, canUseReviewPermissions: false, canMakeActionLink: false, spellcheck: true,
    canSaveToFile: true, canPreviewPrint: true, isSignatureSupport: false, isPasswordSupport: true,
    canProtect_: true, fileChoiceUrl: '', canRequestInsertImage: true
};

const STOCK_SOURCES = {
    Toolbar: 'presentationeditor/main/app/view/Toolbar.js',
    ViewTab: 'presentationeditor/main/app/view/ViewTab.js',
    LeftMenu: 'presentationeditor/main/app/view/LeftMenu.js',
    Transitions: 'presentationeditor/main/app/view/Transitions.js',
    Animation: 'presentationeditor/main/app/view/Animation.js',
    Statusbar: 'presentationeditor/main/app/view/Statusbar.js',
    FileMenu: 'presentationeditor/main/app/view/FileMenu.js',
    Review: 'common/main/lib/view/ReviewChanges.js',
    ChartTab: 'common/main/lib/view/ChartTab.js'
};

function controlNames(rel) {
    const file = path.join(APPS, rel);
    if (!fs.existsSync(file)) return [];
    const src = fs.readFileSync(file, 'utf8');
    const set = new Set();
    for (const m of src.matchAll(/\b(?:me|this)\.((?:btns?|cmbs?|list|ch|num|mnu|mi|lbl|chk|spn)[A-Z][A-Za-z0-9]*)\s*=[^=]/g)) set.add(m[1]);
    return Array.from(set);
}

const MENU_BUTTONS = new Set(['btnPreview', 'btnAddSlide', 'btnChangeSlide', 'btnSlideSize', 'btnColorSchemas',
    'btnShapeArrange', 'btnShapeAlign', 'btnShapesMerge', 'btnHorizontalAlign', 'btnVerticalAlign', 'btnLineSpace',
    'btnMarkers', 'btnNumbers', 'btnChangeCase', 'btnColumns', 'btnInsertTable', 'btnInsertChart', 'btnInsertSmartArt',
    'btnInsertTextArt', 'btnInsertEquation', 'btnGuides', 'btnGridlines', 'btnInterfaceTheme', 'btnLanguage',
    'btnCoAuthMode', 'btnCommentResolve', 'btnCommentRemove', 'btnFontColor', 'btnHighlightColor', 'btnTextDir',
    'btnParameters', 'btnInsAudio', 'btnInsVideo', 'btnChartType', 'btnEditDataExt', 'btnMacros']);

/* A stock surface without a description here: it answers to any name. It has no plugin item flag
   (isCustomItem exists only on Common.UI.MenuItemCustom). */
function soft(w, name) {
    const kids = new Map();
    const fn = function () { w.log('soft', name, Array.from(arguments)); return undefined; };
    return new Proxy(fn, {
        get(t, k) {
            if (typeof k === 'symbol' || k === 'then' || k === 'toJSON' || k === 'valueOf' || k === 'toString') return Reflect.get(t, k);
            if (Object.prototype.hasOwnProperty.call(t, k)) return t[k];
            if (k === 'isCustomItem') return undefined;
            if (k === 'prototype') return {};
            if (k === 'length' || k === 'name' || k === 'call' || k === 'apply' || k === 'bind') return Reflect.get(t, k);
            if (!kids.has(k)) kids.set(k, soft(w, name + '.' + String(k)));
            return kids.get(k);
        },
        set(t, k, v) { t[k] = v; return true; },
        has(t, k) { return Object.prototype.hasOwnProperty.call(t, k); },
        construct() { return soft(w, name + '()'); }
    });
}

class World {
    constructor(opts) {
        opts = opts || {};
        this.opts = opts;
        this.calls = [];
        this.errors = [];
        this.warnings = [];
        this.timers = [];
        this.clock = 0;
        this.seq = 0;
        this.cascade = opts.css ? new Cascade(opts.css) : null;
        this.cssError = opts.cssError || null;
        this.rights = Object.assign({}, DEFAULT_RIGHTS, opts.rights || {});
        this.theme = opts.theme === 'dark' ? 'dark' : 'light';
        this.modules = {};
        this.callbacks = {};
        this._build();
    }

    log(who, what, args) { this.calls.push({who, what, args: args || []}); }
    used(re) { return this.calls.filter(c => (re instanceof RegExp ? re.test(c.who) : c.who === re)); }

    /* ---- context ---- */
    _build() {
        const w = this;
        const ctx = {};
        vm.createContext(ctx);
        this.ctx = ctx;
        const win = vm.runInContext('this', ctx);
        this.win = win;
        win.window = win;
        win.self = win;
        const winEvents = new EvTarget();
        win.addEventListener = winEvents.addEventListener.bind(winEvents);
        win.removeEventListener = winEvents.removeEventListener.bind(winEvents);
        win.dispatchEvent = ev => { ev.target = win; ev.currentTarget = win; for (const l of winEvents._listeners(ev.type).slice()) l.fn.call(win, ev); return !ev.defaultPrevented; };
        win._listeners = type => winEvents._listeners(type);
        win._eventParent = () => null;
        const doc = new DDocument(win);
        doc.__world = this;
        this.doc = doc;
        win.__world = this;
        win.document = doc;
        win.navigator = {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', platform: 'MacIntel', language: 'ru-RU', languages: ['ru-RU'], maxTouchPoints: 0, clipboard: {}};
        win.location = {href: doc.baseURI, search: '', hash: '', protocol: 'http:', host: 'stand.test', hostname: 'stand.test', origin: 'http://stand.test', pathname: '/web-apps/apps/presentationeditor/main/index.html', reload() {}};
        win.URL = URL;
        win.URLSearchParams = URLSearchParams;
        win.innerWidth = 1440;
        win.innerHeight = 900;
        win.devicePixelRatio = 1;
        win.screen = {width: 1440, height: 900};
        win.Event = DomEvent;
        win.CustomEvent = DomEvent;
        win.KeyboardEvent = DomEvent;
        win.MouseEvent = DomEvent;
        win.FocusEvent = DomEvent;
        win.Node = DNode;
        win.Element = DElement;
        win.HTMLElement = DElement;
        win.SVGElement = DElement;
        win.Text = DText;
        win.DocumentFragment = DFragment;
        win.performance = {now: () => w.clock};
        win.getSelection = () => ({removeAllRanges() {}, addRange() {}, rangeCount: 0, toString: () => ''});
        win.matchMedia = q => ({matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}});
        const Obs = class { constructor() {} observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
        win.ResizeObserver = Obs;
        win.MutationObserver = Obs;
        win.IntersectionObserver = Obs;
        const store = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => Array.from(m.keys())[i] || null, get length() { return m.size; }}; };
        win.localStorage = store();
        win.sessionStorage = store();
        win.setTimeout = (fn, ms) => { const id = ++w.seq; w.timers.push({id, fn, due: w.clock + (+ms || 0), every: 0}); return id; };
        win.setInterval = (fn, ms) => { const id = ++w.seq; w.timers.push({id, fn, due: w.clock + Math.max(+ms || 0, 10), every: Math.max(+ms || 0, 10)}); return id; };
        win.clearTimeout = win.clearInterval = id => { w.timers = w.timers.filter(t => t.id !== id); };
        win.requestAnimationFrame = fn => win.setTimeout(() => fn(w.clock), 16);
        win.cancelAnimationFrame = id => win.clearTimeout(id);
        win.queueMicrotask = fn => win.setTimeout(fn, 0);
        win.console = {
            log() {}, info() {}, debug() {}, trace() {},
            warn: (...a) => w.warnings.push(a.map(x => (x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ')),
            error: (...a) => w.warnings.push(a.map(x => (x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' '))
        };
        win.getComputedStyle = el => w.computedStyle(el);
        win.alert = () => {};
        win.open = () => null;
        win.postMessage = () => {};
        win.parent = win;
        win.top = win;
        win.Image = function () { return doc.createElement('img'); };

        /* underscore and Backbone from the tree */
        win.define = undefined;
        const loadVendor = rel => {
            const file = path.join(ROOT, rel);
            vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file});
        };
        loadVendor('vendor/underscore/underscore.js');
        if (!win._) throw new Error('vendor/underscore did not load');
        loadVendor('vendor/backbone/backbone.js');
        const $ = makeJQ(win);
        this.$ = $;
        win.$ = win.jQuery = $;
        if (win.Backbone) win.Backbone.$ = $;

        this._buildCommon();
        this._applyLocale();
        this._buildDom();
        this._buildStock();
        this._defineLoader();
    }

    _buildCommon() {
        const w = this, win = this.win, _ = win._;
        const nc = _.extend({}, win.Backbone.Events);
        const origTrigger = nc.trigger;
        nc.trigger = function (name) { w.log('NC', name, Array.prototype.slice.call(arguments, 1)); return origTrigger.apply(this, arguments); };
        const gateway = _.extend({}, win.Backbone.Events);
        const gwTrigger = gateway.trigger;
        gateway.trigger = function () { return gwTrigger.apply(this, arguments); };
        ['requestRename', 'requestHistory', 'requestHistoryClose', 'requestSharingSettings', 'requestEditRights',
            'metaChange', 'internalMessage', 'requestClose', 'reportError', 'reportWarning', 'documentReady',
            'appReady', 'setDocumentModified', 'requestRestore', 'requestInsertImage', 'requestSaveAs',
            'downloadAs', 'collaborativeChanges', 'requestHistoryData', 'requestUsers', 'requestSendNotify',
            'requestMakeActionLink', 'requestReferenceData', 'requestOpen', 'requestSelectDocument', 'requestSelectSpreadsheet',
            'switchEditorType', 'pluginsReady', 'requestStartFilling', 'requestRefreshFile', 'requestCreateNew']
            .forEach(m => { gateway[m] = function () { w.log('Gateway', m, Array.from(arguments)); }; });
        const themes = {
            isDarkTheme: () => w.theme === 'dark',
            isContentThemeDark: () => w.theme === 'dark',
            currentThemeId: () => (w.theme === 'dark' ? 'theme-dark' : 'theme-light'),
            defaultThemeId: () => 'theme-light',
            getThemeColors: () => Object.assign({}, w.theme === 'dark' ? DARK_THEME_COLORS : LIGHT_THEME_COLORS,
                {type: w.theme, name: w.theme === 'dark' ? 'theme-dark' : 'theme-light'}),
            getThemeProps: () => undefined,
            map: () => ({}),
            available: () => true,
            setTheme: id => { w.log('Themes', 'setTheme', [id]); },
            toggleContentTheme: () => {},
            isThemeSupported: () => true
        };
        const utils = {
            String: {
                format(s) { const a = Array.prototype.slice.call(arguments, 1); return String(s).replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m)); },
                htmlEncode: s => escAttr(escText(s == null ? '' : s)),
                htmlDecode: s => decodeEntities(String(s == null ? '' : s)),
                platformKey: (k, f) => String(f || '{0}').replace('{0}', k),
                textCtrl: 'Ctrl', textShift: 'Shift', textAlt: 'Alt',
                parseFloat: s => parseFloat(s),
                encodeSurrogateChar: s => s,
                ellipsis: s => s
            },
            isMac: false, isIE: false, isIE10: false, isIE11: false, isSafari: false, isChrome: true, isGecko: false,
            isOpera: false, isWindows: false, isLinux: false, isEdge: false, isIOS: false, isAndroid: false,
            InternalSettings: (() => {
                const m = new Map([['toolbar-height-normal', 88], ['toolbar-height-compact', 32], ['document-title-height', 28],
                    ['toolbar-height-tabs', 32], ['pe-hidden-rightmenu', false]]);
                return {get: k => m.get(k), set: (k, v) => m.set(k, v)};
            })(),
            applyCustomization() {},
            lockControls() {},
            getConfigOption: () => undefined,
            injectButtons: () => [],
            injectComponent: () => undefined,
            applicationPixelRatio: () => 1,
            zoom: () => 1,
            getKeyByValue: (o, v) => Object.keys(o || {}).find(k => o[k] === v),
            ThemeColor: {getHexColor: (r, g, b) => colorHex({r, g, b, a: 1}).slice(1), getRgbColor: c => c, colorValue2EffectId: () => null},
            Metric: {fnRecalcFromMM: v => v, getCurrentMetricName: () => 'cm', getCurrentMetric: () => 0, c_MetricUnits: {cm: 0, pt: 1, inch: 2}},
            documentSettingsType: {Paragraph: 0, Table: 1, Image: 2, Header: 3, Shape: 4, Slide: 5, Chart: 6, TextArt: 7, Signature: 8},
            isBrowserSupported: () => true,
            getUserInitials: s => String(s || '').slice(0, 1),
            fixedDigits: v => v
        };
        const ui = {
            Themes: themes,
            isRTL: () => false,
            LayoutManager: {getInitValue: () => undefined, isElementVisible: () => true, addControls() {}},
            FeaturesManager: {canChange: () => true, isFeatureEnabled: () => true, getInitValue: () => undefined},
            TooltipManager: {addTips() {}, showTip() {}, closeTip() {}},
            Menu: {Manager: {hideAll() {}}},
            Alert: function () { w.log('UI', 'Alert', Array.from(arguments)); },
            warning() { w.log('UI', 'warning', Array.from(arguments)); },
            info() { w.log('UI', 'info', Array.from(arguments)); },
            alert() { w.log('UI', 'alert', Array.from(arguments)); },
            ScreenReaderFocusManager: {},
            Compact: {}
        };
        const softUi = new Proxy(ui, {get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? (t[k] = soft(w, 'Common.UI.' + k)) : undefined))});
        const softUtils = new Proxy(utils, {get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? (t[k] = soft(w, 'Common.Utils.' + k)) : undefined))});
        const lsStore = new Map();
        win.Common = {
            NotificationCenter: nc,
            Gateway: gateway,
            UI: softUi,
            Utils: softUtils,
            localStorage: {
                getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
                setItem: (k, v) => lsStore.set(k, v),
                removeItem: k => lsStore.delete(k),
                itemExists: k => lsStore.has(k),
                getBool: (k, d) => (lsStore.has(k) ? lsStore.get(k) === true || lsStore.get(k) === 'true' || lsStore.get(k) === 1 || lsStore.get(k) === '1' : !!d),
                setBool: (k, v) => lsStore.set(k, v ? 1 : 0),
                getKeysFilter: () => '',
                setKeysFilter() {},
                sync() {},
                save() {}
            },
            Controllers: {Desktop: {isActive: () => false, isOffline: () => false, isWinXp: () => false, call() {}, process: () => false}},
            Views: {},
            Models: {},
            Collections: {},
            enumLock: new Proxy({}, {get: (t, k) => (typeof k === 'string' ? k : undefined)}),
            Locale: {getCurrentLanguage: () => 'ru', getDefaultLanguage: () => 'en', get: () => '', isCurrentLanguageRtl: () => false, apply() {}}
        };
        win.PE = {Views: {}, Controllers: {}, Models: {}, Collections: {}, getController: name => w.controller(name), getCollection: () => ({})};
        const restriction = {None: 0, OnlyForms: 1, OnlyComments: 2, OnlySignatures: 4, View: 128};
        win.Asc = new Proxy({
            c_oAscRestrictionType: restriction,
            c_oAscTypeSelectElement: {Paragraph: 0, Table: 1, Image: 2, Header: 3, Hyperlink: 4, SpellCheck: 5, Shape: 6, Slide: 7, Chart: 8, Math: 9, MailMerge: 10, ContentControl: 11, Animation: 12, Text: 13},
            c_oAscFileType: {PPTX: 129, PPT: 130, ODP: 131, PPSX: 132, POTX: 133, POTM: 134, ODG: 135, OTP: 136, PDF: 513, PDFA: 514, PNG: 1029, JPG: 1027},
            c_oAscZoomType: {Current: 0, FitWidth: 1, FitPage: 2},
            c_oAscAsyncAction: {Save: 4, ForceSaveButton: 9, ForceSaveTimeout: 10},
            c_oAscAsyncActionType: {Information: 0, BlockInteraction: 1},
            asc_CDownloadOptions: function (t) { this.type = t; this.asc_setFileType = v => { this.type = v; }; this.asc_getFileType = () => this.type; }
        }, {get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? (t[k] = soft(w, 'Asc.' + k)) : undefined))});
        const skinState = {skin: Object.assign({}, SKIN_BASE[this.theme])};
        this.skinState = skinState;
        win.AscCommon = {
            get GlobalSkin() { return skinState.skin; },
            updateGlobalSkin: obj => w.updateGlobalSkin(obj)
        };
    }

    /* Stock themes paint the engine on start and on every theme change. */
    updateGlobalSkin(obj) {
        if (!obj) return;
        if (typeof obj === 'string') obj = {name: obj, type: obj.indexOf('dark') >= 0 ? 'dark' : 'light'};
        const type = obj.type === 'dark' ? 'dark' : obj.type === 'light' ? 'light' : (this.skinState.skin.Type || 'light');
        const skin = Object.assign({}, SKIN_BASE[type]);
        for (const k of Object.keys(SKIN_MAP)) if (obj[SKIN_MAP[k]] !== undefined) skin[k] = obj[SKIN_MAP[k]];
        for (const k of Object.keys(obj)) skin[k] = obj[k];
        this.skinState.skin = skin;
        this.paintSdk();
    }

    paintSdk() {
        const s = this.skinState.skin, d = this.doc;
        const set = (id, prop, v) => { const e = d.getElementById(id); if (e) e.style.setProperty(prop, v); };
        set('editor_sdk', 'background-color', s.BackgroundColor);
        set('id_main', 'background-color', s.BackgroundColor);
        set('id_viewer', 'background-color', s.BackgroundColor);
        set('id_panel_thumbnails', 'background-color', s.BackgroundColorThumbnails);
        set('id_panel_thumbnails_split', 'background-color', s.BackgroundColorThumbnails);
        set('id_panel_right', 'background-color', s.ScrollBackgroundColor);
        set('id_horscrollpanel', 'background-color', s.ScrollBackgroundColor);
        set('id_panel_notes', 'background-color', s.BackgroundColorNotes);
        set('id_bottom_pannels_container', 'background-color', s.BackgroundColorNotes);
        set('id_notes', 'background-color', s.BackgroundColorNotes);
    }

    /* Common.Locale.apply: keys land on window paths before the views load. */
    _applyLocale() {
        const win = this.win;
        const ru = ruLocale();
        const shell = new Set(shellViewNames());
        this.shellNames = shell;
        for (const key of Object.keys(ru)) {
            const p = key.split('.');
            if (p.length < 3 || (p[0] !== 'PE' && p[0] !== 'Common')) continue;
            let obj = win;
            for (let i = 0; i < p.length - 1; i++) {
                const k = p[i];
                if (obj[k] === undefined) {
                    const isView = i === 2 && (p[1] === 'Views' || p[1] === 'Controllers') && !(p[0] === 'PE' && p[1] === 'Views' && shell.has(k));
                    if (isView) { const f = function () {}; obj[k] = f; }
                    else obj[k] = {};
                }
                obj = obj[k];
            }
            const last = p[p.length - 1];
            if (this.opts.shellLocale === false && p[0] === 'PE' && p[1] === 'Views' && shell.has(p[2])) continue;
            obj[last] = ru[key];
            if (typeof obj === 'function') obj.prototype[last] = ru[key];
        }
    }

    _texts(ns) {
        const parts = ns.split('.');
        let o = this.win;
        for (const p of parts) { o = o && o[p]; }
        if (!o) return {};
        return typeof o === 'function' ? o.prototype : o;
    }

    _buildDom() {
        const d = this.doc, $ = this.$, win = this.win;
        const body = d.body;
        body.setAttribute('class', this.theme === 'dark' ? 'theme-dark theme-type-dark' : 'theme-light');
        const vpTpl = fs.readFileSync(path.join(PE_MAIN, 'app/template/Viewport.template'), 'utf8');
        const viewport = d.createElement('div');
        viewport.setAttribute('id', 'viewport');
        viewport.innerHTML = vpTpl;
        body.appendChild(viewport);
        const byId = id => d.getElementById(id);
        byId('app-title').innerHTML = '<div class="extra"><div id="header-documentcaption"><div class="inner">Отчёт</div></div></div>';
        byId('toolbar').innerHTML = '<section class="toolbar"><section class="box-tabs"><ul><li class="ribtab"><a data-tab="home">Главная</a></li></ul></section><section class="box-panels"><section class="panel" data-tab="home"></section></section></section>';
        const leftTpl = fs.readFileSync(path.join(PE_MAIN, 'app/template/LeftMenu.template'), 'utf8');
        byId('left-menu').innerHTML = win._.template(leftTpl)({scope: this._texts('PE.Views.LeftMenu')});
        const statusTpl = fs.readFileSync(path.join(PE_MAIN, 'app/template/StatusBar.template'), 'utf8');
        byId('statusbar').innerHTML = win._.template(statusTpl)({scope: this._texts('PE.Views.Statusbar')});
        byId('right-menu').innerHTML = '<div class="right-panel"></div><div class="tool-menu-btns"></div>';
        this.updateGlobalSkin(this.win.Common.UI.Themes.getThemeColors());
        byId('editor_sdk').innerHTML = SDK_HTML(this.skinState.skin);
        this.paintSdk();
        void $;
    }

    _control(ref, extra) {
        const w = this;
        const handlers = {};
        const emit = (ev, args) => { (handlers[ev] || []).slice().forEach(([fn, ctx]) => fn.apply(ctx || c, args)); };
        const el = extra && extra.el ? extra.el : this.doc.createElement('button');
        if (!el.getAttribute('data-stock')) el.setAttribute('data-stock', ref);
        el.addEventListener('click', () => { w.log(ref, 'dom-click'); emit('click', [c]); });
        const c = {
            ref, id: ref, disabled: false, visible: true, pressed: false, caption: '', value: undefined, options: {},
            cmpEl: this.$(el), $el: this.$(el), el,
            isDisabled() { return this.disabled; },
            setDisabled(v) { this.disabled = !!v; emit('disabled', [this, this.disabled]); },
            isVisible() { return this.visible; },
            setVisible(v) { this.visible = !!v; },
            isActive() { return this.pressed; },
            isPressed() { return this.pressed; },
            toggle(state, suppress) {
                this.pressed = state === undefined ? !this.pressed : !!state;
                w.log(ref, 'toggle', [state, suppress]);
                if (!suppress) emit('toggle', [this, this.pressed]);
            },
            click() { w.log(ref, 'click'); emit('click', [this]); },
            on(ev, fn, ctx) {
                if (ev && typeof ev === 'object') { Object.keys(ev).forEach(k => this.on(k, ev[k], fn)); return this; }
                String(ev).split(/\s+/).forEach(n => { (handlers[n] = handlers[n] || []).push([fn, ctx]); });
                return this;
            },
            off(ev, fn) { if (!ev) { Object.keys(handlers).forEach(k => delete handlers[k]); return this; } String(ev).split(/\s+/).forEach(n => { handlers[n] = (handlers[n] || []).filter(h => fn && h[0] !== fn); }); return this; },
            once(ev, fn, ctx) { const self = this; const once = function () { self.off(ev, once); return fn.apply(ctx || self, arguments); }; return this.on(ev, once); },
            trigger(ev) { const args = Array.prototype.slice.call(arguments, 1); w.log(ref, 'trigger:' + ev, args); emit(ev, args); return this; },
            setCaption(v) { this.caption = v; }, getCaption() { return this.caption; },
            setIconCls() {}, updateHint() {}, render() { return this; }, focus() {}, setTooltip() {},
            getValue() { return this.value; },
            setValue(v, suppress) { this.value = v; w.log(ref, 'setValue', [v, suppress]); if (!suppress) emit('change', [this, v]); },
            checked: false,
            isChecked() { return this.checked; },
            setChecked(v, suppress) { this.checked = !!v; if (!suppress) emit('change', [this, v]); },
            menu: null,
            _emit: emit
        };
        if (extra) Object.keys(extra).forEach(k => { if (k !== 'el') c[k] = extra[k]; });
        return c;
    }

    _menu(ref, items) {
        const w = this;
        const m = this._control(ref + '.menu', {el: this.doc.createElement('ul')});
        m.items = [];
        m.addItem = it => { const item = w._item(ref + '.menu.' + (it.value !== undefined ? it.value : m.items.length), it, m); m.items.push(item); return item; };
        (items || []).forEach(it => m.addItem(it));
        m.isVisible = () => !!m._shown;
        m.show = () => { w.log(m.ref, 'show'); m._emit('show:before', [m]); m._shown = true; m._emit('show:after', [m]); };
        m.hide = () => { m._emit('hide:before', [m]); m._shown = false; m._emit('hide:after', [m]); };
        m.getItemsCount = () => m.items.length;
        m.getItem = i => m.items[i];
        m.removeAll = () => { m.items = []; };
        m.getChecked = () => m.items.find(i => i.checked);
        m.clearAll = () => m.items.forEach(i => { i.checked = false; });
        m.setChecked = (i, v) => { if (m.items[i]) m.items[i].checked = !!v; };
        m.resetItems = list => { m.items = []; (list || []).forEach(it => m.addItem(it)); };
        m.setRecent = () => {};
        m.render = () => m;
        return m;
    }

    _item(ref, opts, menu) {
        const w = this;
        const it = this._control(ref, {el: this.doc.createElement('a')});
        Object.assign(it, opts);
        it.checked = !!opts.checked;
        it.disabled = !!opts.disabled;
        it.click = function () { w.log(ref, 'click'); it._emit('click', [it]); if (menu) menu._emit('item:click', [menu, it]); };
        return it;
    }

    _view(name, rel, extra) {
        const proto = this._texts(name);
        const view = Object.create(proto);
        const short = name.split('.').pop();
        for (const c of controlNames(rel)) {
            const ref = (extra && extra.prefix ? extra.prefix : short) + '.' + c;
            if (/^btns|^cmbs/.test(c)) { view[c] = [this._control(ref)]; continue; }
            if (/^mi[A-Z]/.test(c)) { view[c] = this._item(ref, {caption: proto['btn' + c.slice(2) + 'Caption'] || c, value: c.slice(2).toLowerCase()}, null); continue; }
            const ctl = this._control(ref);
            if (MENU_BUTTONS.has(c)) ctl.menu = this._menu(ref, []);
            view[c] = ctl;
        }
        view.$el = this.$('<div></div>');
        view.el = view.$el[0];
        view.on = view.trigger = view.off = function () { return this; };
        view.fireEvent = function () {};
        view.getButton = () => undefined;
        view.isVisible = () => true;
        return view;
    }

    _buildStock() {
        const w = this, win = this.win, $ = this.$, d = this.doc;
        const r = this.rights;
        const api = this._api();
        this.api = api;
        const editorConfig = Object.assign({
            ui: {shell: 'modern'}, mode: r.isEdit ? 'edit' : 'view', lang: 'ru', canRename: r.canRename,
            canUseHistory: r.canUseHistory, canRequestSharingSettings: r.canRequestSharingSettings,
            customization: {}, user: {id: 'u1', name: 'Анна'}
        }, this.opts.config || {});
        this.editorConfig = editorConfig;
        const appOptions = Object.assign({customization: editorConfig.customization}, r);
        this.appOptions = appOptions;

        const toolbar = this._view('PE.Views.Toolbar', STOCK_SOURCES.Toolbar);
        const pv = toolbar.btnPreview;
        pv.menu = this._menu('Toolbar.btnPreview', [
            {caption: toolbar.textShowBegin, value: 0}, {caption: toolbar.textShowCurrent, value: 1},
            {caption: toolbar.textShowPresenterView, value: 2}, {caption: '--'}, {caption: toolbar.textShowSettings, value: 3}]);
        toolbar.lockToolbar = () => {};
        toolbar.setMode = () => {};
        const viewTab = this._view('PE.Views.ViewTab', STOCK_SOURCES.ViewTab);
        viewTab.cmbZoom.value = 100;
        const fileMenu = this._menu('FileMenu', []);
        Object.assign(fileMenu, this._view('PE.Views.FileMenu', STOCK_SOURCES.FileMenu, {prefix: 'FileMenu'}));
        for (const k of Object.keys(fileMenu)) if (/^mi[A-Z]/.test(k)) { const it = fileMenu[k]; it.click = function () { w.log(it.ref, 'click'); it._emit('click', [it]); fileMenu._emit('item:click', [fileMenu, it]); }; }
        fileMenu.miProtect.setVisible(r.canProtect !== false);
        fileMenu.miRename.setVisible(!!r.canRename);
        fileMenu.miDownload.setVisible(!!r.canDownload);
        fileMenu.miPrint.setVisible(!!r.canPrint);
        fileMenu.showMenu = fileMenu.show;
        fileMenu.isVisible = () => false;
        const leftMenu = this._view('PE.Views.LeftMenu', STOCK_SOURCES.LeftMenu);
        const bindLeft = (name, id) => { const el = d.getElementById(id); if (el) leftMenu[name] = this._control('LeftMenu.' + name, {el}); };
        bindLeft('btnSearchBar', 'left-btn-searchbar');
        bindLeft('btnThumbs', 'left-btn-thumbs');
        bindLeft('btnComments', 'left-btn-comments');
        bindLeft('btnChat', 'left-btn-chat');
        bindLeft('btnAbout', 'left-btn-about');
        bindLeft('btnSupport', 'left-btn-support');
        leftMenu.btnThumbs.pressed = true;
        leftMenu.getMenu = name => (name === 'file' ? fileMenu : undefined);
        leftMenu.showMenu = function (name) { w.log('LeftMenu', 'showMenu', [name]); };
        leftMenu.close = function () { w.log('LeftMenu', 'close'); };
        leftMenu.isOpened = () => false;
        leftMenu.$el = $('#left-menu');
        const statusbar = this._view('PE.Views.Statusbar', STOCK_SOURCES.Statusbar);
        const bindStatus = (name, id) => { const el = d.getElementById(id); if (el) statusbar[name] = this._control('Statusbar.' + name, {el}); };
        bindStatus('btnZoomToPage', 'btn-zoom-topage');
        bindStatus('btnZoomToWidth', 'btn-zoom-towidth');
        bindStatus('btnZoomDown', 'btn-zoom-down');
        bindStatus('btnZoomUp', 'btn-zoom-up');
        statusbar.btnPreview.menu = this._menu('Statusbar.btnPreview', [
            {caption: statusbar.textShowBegin, value: 0}, {caption: statusbar.textShowCurrent, value: 1},
            {caption: statusbar.textShowPresenterView, value: 2}]);
        statusbar.langMenu = this._menu('Statusbar.btnLanguage', [
            {caption: 'Русский', captionEn: 'Russian', value: 'ru-RU', code: 1049, checked: true},
            {caption: 'English (United States)', captionEn: 'English (United States)', value: 'en-US', code: 1033}]);
        statusbar.btnLanguage = this._control('Statusbar.btnLanguage', {el: d.getElementById('btn-cnt-lang') || d.createElement('span'), caption: 'Русский', menu: statusbar.langMenu});
        statusbar.btnLanguage.disabled = !r.isEdit;
        const pages = {current: 1, count: 5, start: 1};
        statusbar.pages = {get: k => pages[k], set: (k, v) => { pages[k] = v; }, on() {}, attributes: pages};
        statusbar.$el = $('#statusbar');
        this.pages = pages;
        const review = this._view('Common.Views.ReviewChanges', STOCK_SOURCES.Review, {prefix: 'Review'});
        review.btnsSpelling = [this._control('Review.btnsSpelling')];
        review.btnsDocLang = [this._control('Review.btnsDocLang')];
        review.getButton = function (name, type) { w.log('Review', 'getButton', [name, type]); return name === 'spelling' ? spelling : undefined; };
        const spelling = this._control('Statusbar.btnSpelling', {el: d.getElementById('btn-doc-spell') || d.createElement('span')});
        spelling.pressed = true;
        const transitions = this._view('PE.Views.Transitions', STOCK_SOURCES.Transitions);
        const animation = this._view('PE.Views.Animation', STOCK_SOURCES.Animation);
        const chartTab = this._view('Common.Views.ChartTab', STOCK_SOURCES.ChartTab, {prefix: 'ChartTab'});
        const rightMenu = Object.create(this._texts('PE.Views.RightMenu'));
        Object.assign(rightMenu, {
            $el: $('#right-menu'), el: d.getElementById('right-menu'),
            SetActivePane(type, open) { w.log('RightMenu', 'SetActivePane', [type, open]); },
            GetActivePane() { return undefined; },
            show() { w.log('RightMenu', 'show'); }, hide() { w.log('RightMenu', 'hide'); },
            isVisible: () => false, on() { return this; }, setMode() {}, render() { return this; },
            slideSettings: {ChangeSettings() { w.log('SlideSettings', 'ChangeSettings', Array.from(arguments)); }},
            shapeSettings: {ChangeSettings() { w.log('ShapeSettings', 'ChangeSettings', Array.from(arguments)); }},
            tableSettings: {ChangeSettings() { w.log('TableSettings', 'ChangeSettings', Array.from(arguments)); }},
            imageSettings: {ChangeSettings() { w.log('ImageSettings', 'ChangeSettings', Array.from(arguments)); }},
            paragraphSettings: {ChangeSettings() { w.log('ParagraphSettings', 'ChangeSettings', Array.from(arguments)); }},
            textartSettings: {ChangeSettings() { w.log('TextArtSettings', 'ChangeSettings', Array.from(arguments)); }},
            chartSettings: {ChangeSettings() { w.log('ChartSettings', 'ChangeSettings', Array.from(arguments)); }}
        });

        const vlayoutItems = [
            {el: $('#app-title'), alias: 'title', height: 28},
            {el: $('#toolbar'), alias: 'toolbar', height: 88},
            {el: $('#viewport-vbox-layout > .layout-item.middle'), stretch: true},
            {el: $('#statusbar'), alias: 'statusbar', height: 25}
        ];
        const layout = items => ({
            panels: items,
            getItem(alias) { return this.panels.find(p => p.alias === alias); },
            doLayout() { w.log('Layout', 'doLayout'); this.panels.forEach(p => { if (p.height != null && p.el && p.el.css) p.el.css('height', p.height + 'px'); }); },
            changeLayout(list) { this.panels = list; },
            hideItemResizer() {}, setResizeValue() {}, getElementHeight: el => parseInt(el.css('height'), 10) || 0,
            freezePanels() {}
        });
        const vlayout = layout(vlayoutItems);
        const hlayout = layout([
            {el: $('#left-menu'), rely: true, alias: 'left', resize: {hidden: true, min: 300, max: 600}},
            {el: $('#left-panel-history'), rely: true, alias: 'history', resize: {hidden: true, min: 300, max: 600}},
            {el: $('#editor-container'), stretch: true},
            {el: $('#right-menu'), rely: true, alias: 'right', resize: {hidden: true, min: -600, max: -260}}
        ]);
        this.stockHeights = {toolbar: 88, statusbar: 25, title: 28};
        const viewportView = {vlayout, hlayout, $el: $('#viewport'), el: d.getElementById('viewport')};
        const header = {
            setDocumentCaption() {}, getButton: () => undefined, setCanRename() {}, setDocumentReadOnly() {},
            setUserName() {}, setVisible() {}, lockHeaderBtns() {}, setMode() {}, btnSave: this._control('Header.btnSave'),
            btnUndo: this._control('Header.btnUndo'), btnRedo: this._control('Header.btnRedo'), $el: $('#app-title')
        };

        const main = {
            api, appOptions, editorConfig,
            document: {title: 'Отчёт.pptx', fileType: 'pptx', key: 'key-1', permissions: {}, info: {}},
            _state: {isDisconnected: false, isDocModified: false, fastCoauth: true},
            getApplication: () => app,
            disableEditing(disable, type) { w.log('Main', 'disableEditing', [disable, type]); },
            onEditComplete() { w.log('Main', 'onEditComplete'); },
            stackDisableActions: {get: () => null, add() {}, remove() {}},
            warnNoLicense: '', textLoadingDocument: '',
            getView: () => undefined
        };
        const ctl = (name, props) => Object.assign({
            name, api,
            getView(v) { return props && props._views && props._views[v]; },
            getApplication: () => app,
            onAppReady() {}, setApi() { return this; }, setMode() { return this; }
        }, props || {});
        const controllers = {
            Main: main,
            Viewport: ctl('Viewport', {viewport: viewportView, getApi: () => api, _views: {Viewport: viewportView, 'Common.Views.Header': header}, header}),
            Toolbar: ctl('Toolbar', {toolbar, mode: appOptions, btnsComment: [this._control('Toolbar.btnsComment')], _state: {}, _views: {Toolbar: toolbar},
                onPreview(slide, presenter) { w.log('ToolbarCtl', 'onPreview', [slide, presenter]); },
                onPreviewItemClick(menu, item) { w.log('ToolbarCtl', 'onPreviewItemClick', [item && item.value]); },
                onPrint() { w.log('ToolbarCtl', 'onPrint'); },
                onSave() { w.log('ToolbarCtl', 'onSave'); }}),
            ViewTab: ctl('ViewTab', {view: viewTab, _views: {ViewTab: viewTab}}),
            /* The left menu view rights are as after the stock LeftMenu.setMode
               (view/LeftMenu.js): the controller gives the view the same appOptions. */
            LeftMenu: (leftMenu.mode = appOptions, ctl('LeftMenu', {leftMenu, mode: appOptions, _views: {LeftMenu: leftMenu},
                onShowTumbnails(obj, show) { w.log('LeftMenuCtl', 'onShowTumbnails', [show]); },
                clickMenuFileItem(menu, action) { w.log('LeftMenuCtl', 'clickMenuFileItem', [action]); },
                clickSaveAsFormat(menu, format) { w.log('LeftMenuCtl', 'clickSaveAsFormat', [format]); },
                onMenuChange() {}, SetDisabled() { w.log('LeftMenuCtl', 'SetDisabled', Array.from(arguments)); }})),
            Statusbar: ctl('Statusbar', {statusbar, btnSpelling: spelling, _views: {Statusbar: statusbar}}),
            Transitions: ctl('Transitions', {view: transitions, _views: {Transitions: transitions}}),
            Animation: ctl('Animation', {view: animation, _views: {Animation: animation}}),
            RightMenu: ctl('RightMenu', {rightmenu: rightMenu, _views: {RightMenu: rightMenu}}),
            DocumentHolder: ctl('DocumentHolder', {documentHolder: {slideMenu: this._menu('DocumentHolder.slideMenu', [])}, _views: {}}),
            'Common.Controllers.ReviewChanges': ctl('Review', {view: review, _views: {'Common.Views.ReviewChanges': review}}),
            'Common.Controllers.Chat': ctl('Chat', {}),
            'Common.Controllers.Comments': ctl('Comments', {onCreateComment() { w.log('CommentsCtl', 'add'); }}),
            'Common.Controllers.ChartTab': ctl('ChartTab', {view: chartTab, _views: {'Common.Views.ChartTab': chartTab}}),
            Search: ctl('Search', {}),
            Print: ctl('Print', {})
        };
        const app = {getController: name => w.controller(name)};
        this.app = app;
        this.stock = {main, toolbar, viewTab, fileMenu, leftMenu, statusbar, review, spelling, transitions, animation, chartTab, rightMenu, viewportView, header};
        this.controllers = controllers;
        win.PE.getController = name => w.controller(name);
        win.PE.Views.Toolbar = win.PE.Views.Toolbar || function () {};
        void win;
    }

    controller(name) {
        if (this.controllers[name]) return this.controllers[name];
        const w = this;
        return (this.controllers[name] = {name, getView: () => undefined, api: this.api, getApplication: () => w.app});
    }

    _api() {
        const w = this;
        const callbacks = this.callbacks;
        const known = {
            asc_registerCallback(name, fn) { (callbacks[name] = callbacks[name] || []).push(fn); },
            asc_unregisterCallback(name, fn) { callbacks[name] = (callbacks[name] || []).filter(f => fn && f !== fn); },
            asc_setSkin(skin) { w.log('api', 'asc_setSkin', [skin]); w.updateGlobalSkin(skin); },
            asc_getZoom: () => 100,
            getCountPages: () => w.pages ? w.pages.count : 5,
            getCurrentPage: () => w.pages ? w.pages.current : 1,
            asc_getCurrentFocusObject: () => [],
            asc_getSelectedElements: () => [],
            asc_isDocumentModified: () => false,
            asc_isDocumentCanSave: () => true,
            asc_getDocumentName: () => 'Отчёт.pptx',
            asc_GetViewRulers: () => false,
            asc_getShowGuides: () => false,
            asc_getShowGridlines: () => false,
            asc_IsShowNotes: () => true,
            asc_isSpellCheckEnable: () => true,
            asc_getCoreProps: () => null,
            asc_getEditorPermissions: () => undefined,
            asc_IsSlideMasterMode: () => false,
            IsActionRestrictionPrev: () => false,
            asc_getLocale: () => 1049,
            asc_getDefaultLanguage: () => 1049,
            asc_getPropertyEditorShapes: () => [],
            asc_getPropertyEditorTextArts: () => [],
            asc_getFontsList: () => [],
            asc_getUndoRedoState: () => ({}),
            asc_getCanUndo: () => false,
            asc_getCanRedo: () => false
        };
        return new Proxy(known, {
            get(t, k) {
                if (typeof k === 'symbol') return undefined;
                if (k === 'then') return undefined;
                if (k in t) {
                    const f = t[k];
                    return typeof f === 'function' && k !== 'asc_registerCallback' && k !== 'asc_unregisterCallback'
                        ? function () { w.log('api', k, Array.from(arguments)); return f.apply(t, arguments); }
                        : f;
                }
                return function () { w.log('api', String(k), Array.from(arguments)); return undefined; };
            },
            has(t, k) { return typeof k === 'string'; }
        });
    }

    fire(name) {
        const args = Array.prototype.slice.call(arguments, 1);
        for (const fn of (this.callbacks[name] || []).slice()) fn.apply(null, args);
    }

    /* ---- module loader ---- */
    _defineLoader() {
        const w = this, win = this.win;
        const stock = stockViewNames();
        const resolve = dep => {
            if (dep === 'underscore') return win._;
            if (dep === 'backbone') return win.Backbone;
            if (dep === 'jquery') return w.$;
            if (dep.startsWith('text!')) {
                const f = path.join(APPS, dep.slice(5));
                return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
            }
            const m = /^presentationeditor\/main\/app\/view\/([A-Za-z0-9_]+)$/.exec(dep);
            if (m) {
                if (stock.has(m[1])) return win.PE.Views[m[1]];
                return w.load(m[1]);
            }
            const c = /^common\/main\/lib\/view\/compact\/([A-Za-z0-9_]+)$/.exec(dep);
            if (c && SHARED_MODULES[c[1]]) return w.load(c[1]);
            return {};
        };
        this._resolve = resolve;
        win.require = function (deps, cb) {
            if (typeof deps === 'string') return resolve(deps);
            const mods = (deps || []).map(resolve);
            if (typeof cb === 'function') cb.apply(null, mods);
            return undefined;
        };
    }

    load(name) {
        if (this.modules[name] && !this.modules[name].loading) return this.modules[name].exports;
        const shared = SHARED_MODULES[name];
        if (this.modules[name] && this.modules[name].loading) return shared ? this.win.Common.UI.Compact[name] : this.win.PE.Views[name];
        const file = shared || path.join(PE_VIEW, name + '.js');
        if (!fs.existsSync(file)) throw new Error(path.relative(ROOT, file) + ' is missing');
        this.modules[name] = {loading: true};
        const win = this.win;
        let result;
        let defined = false;
        const self = this;
        win.define = function (a, b, c) {
            let deps = a, factory = b;
            if (typeof a === 'function') { factory = a; deps = []; }
            else if (typeof a === 'string') { deps = Array.isArray(b) ? b : []; factory = Array.isArray(b) ? c : b; }
            defined = true;
            const args = (deps || []).map(d => self._resolve(d));
            result = typeof factory === 'function' ? factory.apply(win, args) : factory;
        };
        try {
            vm.runInContext(fs.readFileSync(file, 'utf8'), this.ctx, {filename: file});
        } finally {
            win.define = undefined;
        }
        const exports = result !== undefined ? result : (shared ? win.Common.UI.Compact[name] : win.PE.Views[name]);
        this.modules[name] = {exports, defined};
        return exports;
    }

    /* ---- time ---- */
    drain(limitMs) {
        const until = this.clock + (limitMs || 10000);
        let n = 0;
        while (this.timers.length && n < 5000) {
            this.timers.sort((a, b) => a.due - b.due || a.id - b.id);
            const t = this.timers[0];
            if (t.due > until) break;
            this.timers.shift();
            this.clock = Math.max(this.clock, t.due);
            if (t.every) this.timers.push({id: t.id, fn: t.fn, due: this.clock + t.every, every: t.every});
            n++;
            try { if (typeof t.fn === 'function') t.fn(); } catch (e) { this.errors.push(e); }
        }
        this.clock = Math.max(this.clock, until);
    }

    /* ---- the stock start sequence the shell hooks into ---- */
    boot() {
        const win = this.win;
        const shell = this.load('CompactShell');
        if (!shell || typeof shell.wanted !== 'function') throw new Error('PE.Views.CompactShell.wanted() is missing');
        const nc = win.Common.NotificationCenter;
        if (typeof shell.announce === 'function') {
            win.Common.Gateway.on('init', data => { try { shell.announce(data && data.config); } catch (e) { this.errors.push(e); } });
        }
        nc.on('app:ready', () => { if (!shell.wanted()) return; shell.start(); });
        win.Common.Gateway.trigger('init', {config: this.editorConfig});
        this.drain(50);
        nc.trigger('app:face', this.appOptions);
        this.drain(50);
        nc.trigger('app:ready', this.appOptions);
        this.drain(6000);
        this.fire('asc_onCountPages', this.pages.count);
        this.fire('asc_onCurrentPage', this.pages.current);
        this.drain(1000);
        this.shell = shell;
        return shell;
    }

    bootOrExplain() {
        const shell = this.boot();
        if (!this.doc.getElementById('vo-shell')) {
            throw new Error('the shell was not built (#vo-shell is missing)' + this.diagnostics());
        }
        return shell;
    }

    diagnostics() {
        const parts = [];
        if (this.warnings.length) parts.push('warnings: ' + this.warnings.slice(0, 3).join(' || '));
        if (this.errors.length) parts.push('errors: ' + this.errors.slice(0, 3).map(e => (e && e.message) || String(e)).join(' || '));
        return parts.length ? ' [' + parts.join('; ') + ']' : '';
    }

    /* ---- styles ---- */
    requireCss() {
        if (this.cssError) throw this.cssError;
        if (!this.cascade) throw new Error('compiled styles are not available');
        return this.cascade;
    }

    computedStyle(el) {
        const w = this;
        const get = name => {
            if (!el || el.nodeType !== 1) return '';
            const k = name.startsWith('--') ? name : kebab(name);
            if (w.cascade) { const v = w.cascade.value(el, k); if (v) return v; }
            return el.style ? el.style.getPropertyValue(k) : '';
        };
        return new Proxy({getPropertyValue: get, getPropertyPriority: () => ''}, {
            get(t, k) { if (k in t) return t[k]; if (typeof k !== 'string') return undefined; return get(k); }
        });
    }

    hidden(el) {
        for (let x = el; x && x.nodeType === 1; x = x.parentNode) {
            if (x.hasAttribute('hidden')) return true;
            const v = this.cascade ? this.cascade.value(x, 'display') : x.style.display;
            if (String(v).trim() === 'none') return true;
        }
        if (!el.isConnected) return true;
        return false;
    }

    /* first opaque background colour from the element up */
    background(el) {
        const c = this.requireCss();
        for (let x = el; x && x.nodeType === 1; x = x.parentNode) {
            const v = c.value(x, 'background-color');
            if (!v) continue;
            if (v.indexOf('\u0000unresolved') >= 0) return {unresolved: v.replace(/\u0000/g, ''), at: describe(x)};
            const col = parseColor(v);
            if (col && col.a > 0.5) return {color: col, at: describe(x), value: v};
        }
        return {none: true};
    }

    /* ---- DOM shortcuts ---- */
    byId(id) { return this.doc.getElementById(id); }
    must(id) { const e = this.byId(id); if (!e) throw new Error('#' + id + ' is missing' + this.diagnostics()); return e; }
    click(el) {
        el.dispatchEvent(new DomEvent('mousedown', {bubbles: true, button: 0}));
        el.dispatchEvent(new DomEvent('mouseup', {bubbles: true, button: 0}));
        el.click();
        this.drain(500);
    }
}

function describe(el) {
    if (!el || el.nodeType !== 1) return String(el);
    const id = el.getAttribute('id');
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return el.localName + (id ? '#' + id : '') + (cls ? '.' + cls : '');
}

/* elements a user can press: buttons, links, role=button/menuitem, anything with a click handler */
function isStrongControl(el) {
    if (!el || el.nodeType !== 1) return false;
    const role = el.getAttribute('role');
    if (el.localName === 'button' || el.localName === 'a' || el.localName === 'select') return true;
    if (role === 'button' || role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio' || role === 'switch' || role === 'tab' || role === 'option') return true;
    return el.localName === 'input' && /^(button|checkbox|radio|submit)$/.test(el.getAttribute('type') || '');
}
const hasPressHandler = el => ['click', 'mousedown', 'pointerdown', 'mouseup'].some(t => el._listeners(t).length > 0);
function isControl(el) {
    return isStrongControl(el) || (!!el && el.nodeType === 1 && hasPressHandler(el));
}

/* top-level visible controls under root, in document order; an element that only
   has a handler but holds real controls (a popup list, a group) is a container */
function controlsIn(w, root, opts) {
    opts = opts || {};
    const out = [];
    const walk = n => {
        for (const c of n.childNodes) {
            if (c.nodeType !== 1) continue;
            if (w.hidden(c)) continue;
            const strong = isStrongControl(c);
            const weak = !strong && hasPressHandler(c) && !c.querySelectorAll('*').some(x => isStrongControl(x) && !w.hidden(x));
            if ((strong || weak) && !(opts.skip && opts.skip(c))) { out.push(c); continue; }
            walk(c);
        }
    };
    walk(root);
    return out;
}

/* Opens a section of the menu bar by its caption and returns the controls that
   appeared: whatever the shell renders for that section, wherever it puts it. */
function sectionLabels(w) {
    const bar = w.must('vo-menubar');
    return controlsIn(w, bar);
}

function openSection(w, label) {
    const labels = sectionLabels(w);
    const btn = labels.find(c => normCaption(c.textContent || c.getAttribute('aria-label') || '') === normCaption(label));
    if (!btn) throw new Error('menu bar has no section "' + label + '" (sections: ' + labels.map(c => norm(c.textContent)).join(' · ') + ')');
    const before = new Set(controlsIn(w, w.doc.body));
    w.click(btn);
    const items = controlsIn(w, w.doc.body).filter(c => !before.has(c) && c !== btn);
    return {btn, items: items.map(el => ({el, text: norm(el.textContent), title: el.getAttribute('title') || el.getAttribute('aria-label') || ''}))};
}

function closeSection(w, opened) {
    if (!opened) return;
    const stillOpen = () => opened.items.some(i => i.el.isConnected && !w.hidden(i.el));
    if (stillOpen()) w.click(opened.btn);
    if (stillOpen()) {
        w.doc.dispatchEvent(new DomEvent('keydown', {bubbles: true, key: 'Escape', keyCode: 27, which: 27}));
        w.drain(300);
    }
    if (stillOpen()) { w.click(w.doc.body); }
}

/* all sections, opened one by one */
function menuTexts(w, labels) {
    const out = {};
    for (const l of labels) {
        const o = openSection(w, l);
        out[l] = o.items.map(i => i.text);
        closeSection(w, o);
    }
    return out;
}

function signature(el) {
    return [el.localName, el.getAttribute('class') || '', el.getAttribute('title') || '', el.getAttribute('aria-label') || '',
        norm(el.textContent)].join('|');
}

/* ------------------------------------------------------------------------ */
/* runner                                                                    */

async function prepareCss() {
    try {
        const css = await compileLess(path.join(PE_LESS, 'compact-shell.less'));
        return {css};
    } catch (e) {
        return {cssError: e};
    }
}

async function makeWorld(opts) {
    const c = await prepareCss();
    return new World(Object.assign({}, opts || {}, c));
}

async function run(tests) {
    const args = process.argv.slice(2);
    const i = args.indexOf('--only');
    const only = i >= 0 ? args[i + 1] : null;
    let failed = 0, ran = 0;
    for (const t of tests) {
        if (only && t.name !== only) continue;
        ran++;
        try {
            await t.fn();
            console.log('ok ' + t.name);
        } catch (e) {
            failed++;
            console.log('FAIL ' + t.name + ': ' + String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 1500));
        }
    }
    if (only && !ran) { console.log('FAIL ' + only + ': no such test in this file'); failed++; }
    process.exitCode = failed ? 1 : 0;
}

function argValue(name) {
    const args = process.argv.slice(2);
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}

module.exports = {
    ROOT, APPS, PE_MAIN, PE_VIEW, PE_LESS, DE_VIEW, DE_LESS, SHARED_AIR, SHELL_NAMES, SHARED_MODULES,
    git, forkBase, stockViewNames, shellViewNames, ruLocale, readJson, norm, normCaption, scanJs,
    parseHTML, Cascade, parseCss, compileLess, compileDocumentsLess, sharedMenuTokens, parseColor, colorHex, luminance, isWhite,
    World, makeWorld, prepareCss, run, argValue, describe, isControl, controlsIn, signature, DomEvent,
    sectionLabels, openSection, closeSection, menuTexts,
    DARK_THEME_COLORS, LIGHT_THEME_COLORS
};

if (require.main === module) process.exitCode = 0;
