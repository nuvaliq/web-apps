'use strict';
/* Fixture for the acceptance tests of the presentation shell toolbar.
 * The shell modules are executed in vm over a small DOM model: markup, events,
 * selectors, the cascade of rules from the shell LESS (visibility, background, pinning to the edge) and
 * control widths for measuring a row. The stock environment is stubs with spies:
 * ribbon twins, controllers, the engine api, the notification center.
 * Neighboring shell modules (the bridge, the selection classifier, the scaffold) are replaced by
 * stubs of their declared interface: the bridge passes a call to the stock twin,
 * the classifier returns a given selection kind, the scaffold keeps the command registry.
 * When run directly the file does nothing and exits with code 0.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../../../..');
const VIEW_DIR = path.join(ROOT, 'apps/presentationeditor/main/app/view');
const LESS_DIR = path.join(ROOT, 'apps/presentationeditor/main/resources/less');
const LESS_ENTRY = path.join(LESS_DIR, 'compact-shell.less');
const RU_FILE = path.join(ROOT, 'apps/presentationeditor/main/locale/ru.json');
const VENDOR = name => path.join(ROOT, 'vendor', name);
const rel = file => path.relative(ROOT, file).split(path.sep).join('/');

const OWN = ['CompactShell', 'StockBridge', 'SlideActions', 'SlideSelection', 'CompactToolbar',
    'SlideSections', 'CompactLeft', 'CompactStatus', 'CompactModes', 'CompactWindows'];

/* ------------------------------------------------------------- DOM model */

const SVG_NS = 'http://www.w3.org/2000/svg';
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
const decode = s => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : (ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m));
const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const kebab = n => {
    n = String(n);
    if (n.startsWith('--')) return n;
    if (n === 'cssFloat') return 'float';
    return n.replace(/^(webkit|moz|ms)(?=[A-Z])/, '-$1').replace(/[A-Z]/g, c => '-' + c.toLowerCase());
};

function makeEvent(type, init) {
    const ev = {
        type: String(type), bubbles: true, cancelable: true, defaultPrevented: false, target: null, currentTarget: null,
        timeStamp: Date.now(), isTrusted: false, button: 0, buttons: 0, which: 1, detail: 1, ctrlKey: false,
        metaKey: false, shiftKey: false, altKey: false, key: '', code: '', keyCode: 0, clientX: 0, clientY: 0,
        pageX: 0, pageY: 0, deltaX: 0, deltaY: 0, relatedTarget: null,
        preventDefault() { if (this.cancelable) this.defaultPrevented = true; },
        stopPropagation() { this._stop = true; },
        stopImmediatePropagation() { this._stop = this._stopImm = true; },
        isDefaultPrevented() { return this.defaultPrevented; },
        isPropagationStopped() { return !!this._stop; },
        isImmediatePropagationStopped() { return !!this._stopImm; },
        composedPath() { const p = []; for (let n = this.target; n; n = n.parentNode) p.push(n); return p; },
        initEvent(t, b, c) { this.type = t; this.bubbles = !!b; this.cancelable = c !== false; },
        initCustomEvent(t, b, c, d) { this.initEvent(t, b, c); this.detail = d; }
    };
    if (init) Object.assign(ev, init);
    ev.originalEvent = ev;
    return ev;
}

function dispatch(target, ev) {
    if (!ev.target) ev.target = target;
    const pathNodes = [];
    for (let n = target; n; n = n.parentNode) pathNodes.push(n);
    const last = pathNodes[pathNodes.length - 1];
    if (last && last.nodeType === 9 && last.defaultView) pathNodes.push(last.defaultView);
    const env = last && last.env;
    const call = (node, capture) => {
        const ls = node._ls && node._ls[ev.type];
        if (!ls) return;
        for (const l of ls.slice()) {
            if (capture !== null && l.capture !== capture) continue;
            if (l.once) node.removeEventListener(ev.type, l.fn, l.capture);
            ev.currentTarget = node;
            try {
                if (typeof l.fn === 'function') l.fn.call(node, ev); else l.fn.handleEvent(ev);
            } catch (e) {
                if (env) env.errors.push(e); else throw e;
            }
            if (ev._stopImm) break;
        }
    };
    for (let i = pathNodes.length - 1; i > 0 && !ev._stop; i--) call(pathNodes[i], true);
    if (!ev._stop) call(pathNodes[0], null);
    if (ev.bubbles) for (let i = 1; i < pathNodes.length && !ev._stop; i++) call(pathNodes[i], false);
    ev.currentTarget = null;
    return !ev.defaultPrevented;
}

class ETarget {
    addEventListener(type, fn, opt) {
        if (!fn) return;
        const capture = typeof opt === 'boolean' ? opt : !!(opt && opt.capture);
        const once = !!(opt && typeof opt === 'object' && opt.once);
        this._ls = this._ls || {};
        const list = this._ls[type] = this._ls[type] || [];
        if (list.some(l => l.fn === fn && l.capture === capture)) return;
        list.push({fn, capture, once});
    }
    removeEventListener(type, fn, opt) {
        const capture = typeof opt === 'boolean' ? opt : !!(opt && opt.capture);
        if (!this._ls || !this._ls[type]) return;
        this._ls[type] = this._ls[type].filter(l => !(l.fn === fn && l.capture === capture));
    }
    dispatchEvent(ev) { return dispatch(this, ev); }
}

class DNode extends ETarget {
    constructor(doc) { super(); this.ownerDocument = doc; this.parentNode = null; }
    _doc() { return this.ownerDocument || this; }
    _touch() { this._doc().version++; }
    get parentElement() { const p = this.parentNode; return p && p.nodeType === 1 ? p : null; }
    get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
    get previousSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) - 1] || null : null; }
    get nextElementSibling() { let n = this.nextSibling; while (n && n.nodeType !== 1) n = n.nextSibling; return n; }
    get previousElementSibling() { let n = this.previousSibling; while (n && n.nodeType !== 1) n = n.previousSibling; return n; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.nodeType === 9; }
    getRootNode() { let n = this; while (n.parentNode) n = n.parentNode; return n; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
    compareDocumentPosition(other) {
        if (other === this) return 0;
        if (this.contains(other)) return 20;
        if (other.contains(this)) return 10;
        const all = [], walk = n => { all.push(n); (n.childNodes || []).forEach(walk); };
        walk(this.getRootNode());
        return all.indexOf(other) > all.indexOf(this) ? 4 : 2;
    }
}

class DText extends DNode {
    constructor(doc, data) { super(doc); this.nodeType = 3; this.nodeName = '#text'; this._d = String(data); }
    get data() { return this._d; }
    set data(v) { this._d = String(v); this._touch(); }
    get nodeValue() { return this._d; }
    set nodeValue(v) { this.data = v; }
    get textContent() { return this._d; }
    set textContent(v) { this.data = v; }
    cloneNode() { return new DText(this.ownerDocument, this._d); }
}

function descendants(root) {
    const out = [], stack = [];
    for (let i = root.childNodes.length - 1; i >= 0; i--) stack.push(root.childNodes[i]);
    while (stack.length) {
        const n = stack.pop();
        if (n.nodeType !== 1) continue;
        out.push(n);
        for (let i = n.childNodes.length - 1; i >= 0; i--) stack.push(n.childNodes[i]);
    }
    return out;
}

class DParent extends DNode {
    constructor(doc) { super(doc); this.childNodes = []; }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    get childElementCount() { return this.children.length; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
    appendChild(node) { return this.insertBefore(node, null); }
    insertBefore(node, ref) {
        if (!node || node === ref) return node;
        const list = node.nodeType === 11 ? node.childNodes.slice() : [node];
        for (const n of list) if (n.parentNode) n.parentNode._detach(n);
        let i = ref ? this.childNodes.indexOf(ref) : -1;
        if (i < 0) i = this.childNodes.length;
        this.childNodes.splice(i, 0, ...list);
        for (const n of list) n.parentNode = this;
        this._touch();
        return node;
    }
    _detach(n) {
        const i = this.childNodes.indexOf(n);
        if (i >= 0) this.childNodes.splice(i, 1);
        n.parentNode = null;
        this._touch();
    }
    removeChild(n) { this._detach(n); return n; }
    replaceChild(nw, old) { this.insertBefore(nw, old); this.removeChild(old); return old; }
    append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new DText(this._doc(), n) : n); }
    prepend(...ns) { const f = this.firstChild; for (const n of ns) this.insertBefore(typeof n === 'string' ? new DText(this._doc(), n) : n, f); }
    replaceChildren(...ns) { for (const c of this.childNodes.slice()) this._detach(c); this.append(...ns); }
    get textContent() { return this.childNodes.map(n => n.textContent || '').join(''); }
    set textContent(v) {
        for (const c of this.childNodes.slice()) this._detach(c);
        if (v !== '' && v !== null && v !== undefined) this.appendChild(new DText(this._doc(), v));
        this._touch();
    }
    querySelectorAll(sel) { return qsa(this, sel); }
    querySelector(sel) { return qsa(this, sel)[0] || null; }
    getElementsByClassName(c) {
        const cls = String(c).split(/\s+/).filter(Boolean);
        return descendants(this).filter(e => cls.every(x => e.classList.contains(x)));
    }
    getElementsByTagName(t) {
        t = String(t).toLowerCase();
        return descendants(this).filter(e => t === '*' || e.localName === t);
    }
}

class DFragment extends DParent {
    constructor(doc) { super(doc); this.nodeType = 11; this.nodeName = '#document-fragment'; }
    cloneNode(deep) { const f = new DFragment(this.ownerDocument); if (deep) this.childNodes.forEach(c => f.appendChild(c.cloneNode(true))); return f; }
}

function parseStyle(text) {
    const m = new Map();
    String(text || '').split(';').forEach(part => {
        const i = part.indexOf(':');
        if (i < 0) return;
        const k = part.slice(0, i).trim().toLowerCase();
        let v = part.slice(i + 1).trim(), p = '';
        if (/!important$/i.test(v)) { p = 'important'; v = v.replace(/\s*!important$/i, ''); }
        if (k && v) m.set(k, {v, p});
    });
    return m;
}
const styleText = m => [...m].map(([k, e]) => `${k}: ${e.v}${e.p ? ' !important' : ''};`).join(' ');

function makeStyle(el) {
    const api = {
        setProperty(n, v, p) {
            const k = kebab(n);
            if (v === null || v === undefined || v === '') el._st.delete(k);
            else el._st.set(k, {v: String(v), p: p === 'important' ? 'important' : ''});
            el._touch();
        },
        getPropertyValue(n) { const e = el._st.get(kebab(n)); return e ? e.v : ''; },
        getPropertyPriority(n) { const e = el._st.get(kebab(n)); return e ? e.p : ''; },
        removeProperty(n) { const k = kebab(n), e = el._st.get(k); el._st.delete(k); el._touch(); return e ? e.v : ''; },
        item(i) { return [...el._st.keys()][i] || ''; }
    };
    return new Proxy(api, {
        get(t, k) {
            if (k in t) return t[k];
            if (k === 'cssText') return styleText(el._st);
            if (k === 'length') return el._st.size;
            if (typeof k !== 'string') return undefined;
            return t.getPropertyValue(k);
        },
        set(t, k, v) {
            if (k === 'cssText') { el._st = parseStyle(v); el._touch(); return true; }
            t.setProperty(k, v);
            return true;
        }
    });
}

function makeClassList(el) {
    const get = () => (el._a.get('class') || '').split(/\s+/).filter(Boolean);
    const set = a => el.setAttribute('class', [...new Set(a)].join(' '));
    return {
        add(...c) { set(get().concat(c.map(String))); },
        remove(...c) { set(get().filter(x => !c.includes(x))); },
        contains(c) { return get().includes(c); },
        toggle(c, f) { const on = f === undefined ? !get().includes(c) : !!f; if (on) this.add(c); else this.remove(c); return on; },
        replace(a, b) { if (!get().includes(a)) return false; set(get().map(x => (x === a ? b : x))); return true; },
        get length() { return get().length; },
        item(i) { return get()[i] || null; },
        forEach(fn) { get().forEach(fn); },
        [Symbol.iterator]() { return get()[Symbol.iterator](); },
        get value() { return el.className; },
        toString() { return el.className; }
    };
}

const BOOL_ATTRS = ['disabled', 'hidden', 'checked', 'selected', 'readonly', 'multiple', 'required'];
const STR_ATTRS = ['title', 'type', 'name', 'href', 'src', 'placeholder', 'role', 'alt', 'lang', 'dir', 'for'];

class DElement extends DParent {
    constructor(doc, tag, ns) {
        super(doc);
        this.nodeType = 1;
        this.localName = String(tag).toLowerCase();
        this.tagName = this.nodeName = ns ? String(tag) : String(tag).toUpperCase();
        this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
        this._a = new Map();
        this._st = new Map();
        this.scrollTop = 0;
        this.scrollLeft = 0;
        this.style = makeStyle(this);
        this.classList = makeClassList(this);
    }
    get _env() { return this._doc().env; }
    getAttribute(n) {
        n = String(n).toLowerCase();
        if (n === 'style') return this._st.size ? styleText(this._st) : null;
        return this._a.has(n) ? this._a.get(n) : null;
    }
    setAttribute(n, v) {
        n = String(n).toLowerCase();
        if (n === 'style') this._st = parseStyle(v); else this._a.set(n, String(v));
        this._touch();
    }
    removeAttribute(n) {
        n = String(n).toLowerCase();
        if (n === 'style') this._st = new Map(); else this._a.delete(n);
        this._touch();
    }
    hasAttribute(n) { n = String(n).toLowerCase(); return n === 'style' ? this._st.size > 0 : this._a.has(n); }
    toggleAttribute(n, f) { const on = f === undefined ? !this.hasAttribute(n) : !!f; if (on) this.setAttribute(n, ''); else this.removeAttribute(n); return on; }
    getAttributeNames() { return [...this._a.keys()].concat(this._st.size ? ['style'] : []); }
    get attributes() { return this.getAttributeNames().map(k => ({name: k, value: this.getAttribute(k)})); }
    get id() { return this._a.get('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this._a.get('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get value() { return this._value !== undefined ? this._value : (this._a.get('value') || ''); }
    set value(v) { this._value = String(v); this._touch(); }
    get tabIndex() { return this._a.has('tabindex') ? parseInt(this._a.get('tabindex'), 10) : (/^(button|input|select|textarea|a)$/.test(this.localName) ? 0 : -1); }
    set tabIndex(v) { this.setAttribute('tabindex', v); }
    get dataset() {
        const el = this;
        const key = k => 'data-' + kebab(k);
        return new Proxy({}, {
            get(t, k) { return typeof k === 'string' ? (el.getAttribute(key(k)) === null ? undefined : el.getAttribute(key(k))) : undefined; },
            set(t, k, v) { el.setAttribute(key(k), v); return true; },
            deleteProperty(t, k) { el.removeAttribute(key(k)); return true; },
            ownKeys() { return [...el._a.keys()].filter(a => a.startsWith('data-')).map(a => a.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())); },
            getOwnPropertyDescriptor() { return {enumerable: true, configurable: true}; }
        });
    }
    get innerHTML() { return this.childNodes.map(serialize).join(''); }
    set innerHTML(h) {
        for (const c of this.childNodes.slice()) this._detach(c);
        this.appendChild(parseHTML(this._doc(), h === null || h === undefined ? '' : String(h)));
    }
    get outerHTML() { return serialize(this); }
    set outerHTML(h) { if (this.parentNode) this.parentNode.replaceChild(parseHTML(this._doc(), String(h)), this); }
    get innerText() { return this.textContent; }
    set innerText(v) { this.textContent = v; }
    matches(sel) { return matchesSel(this, sel); }
    closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
    cloneNode(deep) {
        const c = new DElement(this._doc(), this.localName, this.namespaceURI === SVG_NS ? SVG_NS : null);
        this._a.forEach((v, k) => c._a.set(k, v));
        this._st.forEach((v, k) => c._st.set(k, {...v}));
        if (deep) this.childNodes.forEach(n => c.appendChild(n.cloneNode(true)));
        return c;
    }
    insertAdjacentHTML(pos, html) { this.insertAdjacentElement(pos, parseHTML(this._doc(), String(html))); }
    insertAdjacentElement(pos, node) {
        switch (String(pos).toLowerCase()) {
        case 'beforebegin': if (this.parentNode) this.parentNode.insertBefore(node, this); break;
        case 'afterbegin': this.insertBefore(node, this.firstChild); break;
        case 'beforeend': this.appendChild(node); break;
        case 'afterend': if (this.parentNode) this.parentNode.insertBefore(node, this.nextSibling); break;
        }
        return node;
    }
    insertAdjacentText(pos, text) { this.insertAdjacentElement(pos, new DText(this._doc(), text)); }
    before(...ns) { const p = this.parentNode; if (p) ns.forEach(n => p.insertBefore(typeof n === 'string' ? new DText(this._doc(), n) : n, this)); }
    after(...ns) { const p = this.parentNode; if (!p) return; const ref = this.nextSibling; ns.forEach(n => p.insertBefore(typeof n === 'string' ? new DText(this._doc(), n) : n, ref)); }
    replaceWith(...ns) { const p = this.parentNode; if (!p) return; this.before(...ns); p.removeChild(this); }
    focus() {
        const d = this._doc();
        if (d.activeElement === this) return;
        const prev = d.activeElement;
        d.activeElement = this;
        if (prev && prev !== d.body && prev.nodeType === 1) {
            dispatch(prev, makeEvent('blur', {bubbles: false}));
            dispatch(prev, makeEvent('focusout'));
        }
        dispatch(this, makeEvent('focus', {bubbles: false}));
        dispatch(this, makeEvent('focusin'));
    }
    blur() {
        const d = this._doc();
        if (d.activeElement !== this) return;
        d.activeElement = d.body;
        dispatch(this, makeEvent('blur', {bubbles: false}));
        dispatch(this, makeEvent('focusout'));
    }
    click() { if (this.hasAttribute('disabled')) return; dispatch(this, makeEvent('click')); }
    getBoundingClientRect() { return this._env.layout.rect(this); }
    getClientRects() { return this._env.layout.shown(this) ? [this.getBoundingClientRect()] : []; }
    get offsetWidth() { return this._env.layout.shown(this) ? this._env.layout.boxWidth(this) : 0; }
    get offsetHeight() { return this._env.layout.shown(this) ? 32 : 0; }
    get clientWidth() { return this.offsetWidth; }
    get clientHeight() { return this.offsetHeight; }
    get scrollWidth() { return this._env.layout.scrollWidth(this); }
    get scrollHeight() { return this.offsetHeight; }
    get offsetLeft() { const r = this.getBoundingClientRect(), p = this.parentElement; return p ? r.left - p.getBoundingClientRect().left : r.left; }
    get offsetTop() { return 0; }
    get offsetParent() { return this.parentElement; }
    scrollIntoView() {}
    scrollTo() {}
    setPointerCapture() {}
    releasePointerCapture() {}
    hasPointerCapture() { return false; }
    animate() { return {finished: Promise.resolve(), cancel() {}, onfinish: null}; }
    getAnimations() { return []; }
    attachShadow() { return new DFragment(this._doc()); }
}
for (const a of BOOL_ATTRS) {
    Object.defineProperty(DElement.prototype, a, {
        get() { return this.hasAttribute(a); },
        set(v) { if (v) this.setAttribute(a, ''); else this.removeAttribute(a); },
        configurable: true
    });
}
for (const a of STR_ATTRS) {
    Object.defineProperty(DElement.prototype, a, {
        get() { return this.getAttribute(a) || ''; },
        set(v) { this.setAttribute(a, v); },
        configurable: true
    });
}

function serialize(n) {
    if (n.nodeType === 3) return escText(n.data);
    if (n.nodeType !== 1) return '';
    const attrs = n.getAttributeNames().map(k => ` ${k}="${escAttr(n.getAttribute(k))}"`).join('');
    if (VOID.has(n.localName)) return `<${n.localName}${attrs}>`;
    return `<${n.localName}${attrs}>${n.childNodes.map(serialize).join('')}</${n.localName}>`;
}

function parseHTML(doc, html) {
    const frag = new DFragment(doc);
    const stack = [frag];
    const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=/>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)|</gi;
    const attrRe = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let m;
    while ((m = re.exec(html))) {
        const top = stack[stack.length - 1];
        if (m[0].startsWith('<!')) continue;
        if (m[1]) {
            const t = m[1].toLowerCase();
            for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === t) { stack.length = i; break; }
            continue;
        }
        if (m[2]) {
            const tag = m[2];
            const inSvg = tag.toLowerCase() === 'svg' || top.namespaceURI === SVG_NS;
            const el = new DElement(doc, inSvg ? tag : tag.toLowerCase(), inSvg ? SVG_NS : null);
            let a;
            attrRe.lastIndex = 0;
            while ((a = attrRe.exec(m[3] || ''))) {
                const v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
                if (a[1].toLowerCase() === 'style') el._st = parseStyle(decode(v));
                else el._a.set(a[1].toLowerCase(), decode(v));
            }
            top.appendChild(el);
            if (!m[4] && !VOID.has(tag.toLowerCase())) stack.push(el);
            continue;
        }
        top.appendChild(new DText(doc, decode(m[5] !== undefined ? m[5] : m[0])));
    }
    return frag;
}

class DDocument extends DParent {
    constructor(env) {
        super(null);
        this.nodeType = 9;
        this.nodeName = '#document';
        this.env = env;
        this.version = 0;
        this.documentElement = this.createElement('html');
        this.appendChild(this.documentElement);
        this.head = this.createElement('head');
        this.body = this.createElement('body');
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        this.activeElement = this.body;
        this.readyState = 'complete';
        this.fonts = {ready: Promise.resolve(), addEventListener() {}, removeEventListener() {}, check: () => true, load: () => Promise.resolve([])};
        this.defaultView = null;
        this.baseURI = 'http://stand.test/web-apps/apps/presentationeditor/main/index.html';
        this.visibilityState = 'visible';
        this.hidden = false;
    }
    get textContent() { return null; }
    createElement(t) { return new DElement(this, String(t).toLowerCase()); }
    createElementNS(ns, t) { return new DElement(this, t, ns === SVG_NS ? SVG_NS : null); }
    createTextNode(s) { return new DText(this, s); }
    createComment() { return new DText(this, ''); }
    createDocumentFragment() { return new DFragment(this); }
    createEvent() { return makeEvent(''); }
    createRange() { return {setStart() {}, setEnd() {}, selectNodeContents() {}, collapse() {}, getBoundingClientRect: () => ({left: 0, top: 0, width: 0, height: 0}), createContextualFragment: h => parseHTML(this, h)}; }
    getSelection() { return {removeAllRanges() {}, addRange() {}, rangeCount: 0, toString: () => ''}; }
    getElementById(id) { return descendants(this).find(e => e.id === id) || null; }
    elementFromPoint() { return null; }
    hasFocus() { return true; }
    execCommand() { return false; }
}

/* ------------------------------------------------------------- selectors */

function splitTop(s, sep) {
    const out = [];
    let depth = 0, q = null, cur = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (q) { cur += ch; if (ch === '\\') { cur += s[++i] || ''; continue; } if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
        if (ch === '(' || ch === '[') depth++;
        if (ch === ')' || ch === ']') depth--;
        if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    out.push(cur);
    return out;
}

const PSEUDO_ELEMENTS = /^(before|after|first-line|first-letter|placeholder|selection|marker|backdrop|-webkit-.*|-moz-.*)$/;
const IDENT = /^-?(?:[_a-zA-Z -￿]|\\.)(?:[-\w -￿]|\\.)*/;
const selCache = new Map();

function parseSelectorList(sel) {
    sel = String(sel);
    if (selCache.has(sel)) return selCache.get(sel);
    let out = [];
    try {
        for (const part of splitTop(sel, ',')) {
            const cx = parseComplex(part.trim());
            if (!cx) { out = null; break; }
            out.push(cx);
        }
    } catch (e) { out = null; }
    selCache.set(sel, out);
    return out;
}

function parseComplex(s) {
    if (!s) return null;
    const parts = [];
    let i = 0, comb = null;
    const ws = () => { const st = i; while (i < s.length && /\s/.test(s[i])) i++; return i > st; };
    ws();
    while (i < s.length) {
        if ('>+~'.includes(s[i])) { comb = s[i]; i++; ws(); }
        const c = {tag: null, id: null, classes: [], attrs: [], pseudos: []};
        let any = false;
        if (s[i] === '*') { c.tag = '*'; i++; any = true; } else {
            const m = IDENT.exec(s.slice(i));
            if (m) { c.tag = m[0].toLowerCase(); i += m[0].length; any = true; }
        }
        for (;;) {
            const ch = s[i];
            if (ch === '#' || ch === '.') {
                const m = IDENT.exec(s.slice(i + 1));
                if (!m) return null;
                const name = m[0].replace(/\\(.)/g, '$1');
                if (ch === '#') c.id = name; else c.classes.push(name);
                i += 1 + m[0].length; any = true; continue;
            }
            if (ch === '[') {
                const end = s.indexOf(']', i);
                if (end < 0) return null;
                const body = s.slice(i + 1, end).trim();
                const m = /^([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?$/.exec(body);
                if (!m) return null;
                c.attrs.push({name: m[1].toLowerCase(), op: m[2] || null, val: m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5], ci: !!m[6]});
                i = end + 1; any = true; continue;
            }
            if (ch === ':') {
                let el = false;
                i++;
                if (s[i] === ':') { el = true; i++; }
                const m = /^[-\w]+/.exec(s.slice(i));
                if (!m) return null;
                const name = m[0].toLowerCase();
                i += m[0].length;
                let arg = null;
                if (s[i] === '(') {
                    let depth = 1, j = i + 1;
                    while (j < s.length && depth) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; }
                    arg = s.slice(i + 1, j - 1).trim();
                    i = j;
                }
                if (el || PSEUDO_ELEMENTS.test(name)) c.pseudoEl = true;
                else c.pseudos.push({name, arg, list: /^(not|is|where|matches|-webkit-any|has)$/.test(name) ? parseSelectorList(arg || '') : null});
                any = true; continue;
            }
            break;
        }
        if (!any) return null;
        parts.push({c, comb});
        comb = null;
        if (ws() && i < s.length && !'>+~'.includes(s[i])) comb = ' ';
        if (i < s.length && !'>+~'.includes(s[i]) && comb === null) return null;
    }
    if (!parts.length) return null;
    parts.pseudoEl = parts.some(p => p.c.pseudoEl);
    return parts;
}

function nth(arg, idx) {
    arg = String(arg || '').replace(/\s+/g, '').toLowerCase();
    if (arg === 'odd') return idx % 2 === 1;
    if (arg === 'even') return idx % 2 === 0;
    const m = /^([+-]?\d*)?n([+-]\d+)?$/.exec(arg);
    if (!m) return idx === parseInt(arg, 10);
    const a = m[1] === '' || m[1] === undefined ? 1 : m[1] === '-' ? -1 : m[1] === '+' ? 1 : parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : 0;
    if (a === 0) return idx === b;
    return (idx - b) / a >= 0 && (idx - b) % a === 0;
}

function matchPseudo(el, p, scope) {
    const sibs = () => (el.parentNode ? el.parentNode.children : [el]);
    switch (p.name) {
    case 'not': return !!p.list && !p.list.some(cx => matchComplex(el, cx, cx.length - 1, scope));
    case 'is': case 'where': case 'matches': case '-webkit-any':
        return !!p.list && p.list.some(cx => matchComplex(el, cx, cx.length - 1, scope));
    case 'has': return !!p.list && descendants(el).some(d => p.list.some(cx => matchComplex(d, cx, cx.length - 1, scope)));
    case 'first-child': return sibs()[0] === el;
    case 'last-child': { const s = sibs(); return s[s.length - 1] === el; }
    case 'only-child': return sibs().length === 1;
    case 'first-of-type': return sibs().filter(x => x.localName === el.localName)[0] === el;
    case 'last-of-type': { const s = sibs().filter(x => x.localName === el.localName); return s[s.length - 1] === el; }
    case 'nth-child': return nth(p.arg, sibs().indexOf(el) + 1);
    case 'nth-last-child': { const s = sibs(); return nth(p.arg, s.length - s.indexOf(el)); }
    case 'nth-of-type': return nth(p.arg, sibs().filter(x => x.localName === el.localName).indexOf(el) + 1);
    case 'empty': return !el.childNodes.some(n => n.nodeType === 1 || (n.nodeType === 3 && n.data));
    case 'disabled': return el.hasAttribute('disabled');
    case 'enabled': return !el.hasAttribute('disabled');
    case 'checked': return el.hasAttribute('checked') || el.hasAttribute('selected');
    case 'root': return el === el._doc().documentElement;
    case 'scope': return el === scope;
    case 'focus': return el._doc().activeElement === el;
    case 'focus-within': return el.contains(el._doc().activeElement);
    case 'visible': return el._env.layout.shown(el);
    case 'hidden': return !el._env.layout.shown(el);
    default: return false;
    }
}

function matchCompound(el, c, scope) {
    if (!el || el.nodeType !== 1) return false;
    if (c.tag && c.tag !== '*' && el.localName !== c.tag) return false;
    if (c.id !== null && el.id !== c.id) return false;
    if (c.classes.length) {
        const cl = el.className.split(/\s+/);
        for (const x of c.classes) if (!cl.includes(x)) return false;
    }
    for (const a of c.attrs) {
        let v = el.getAttribute(a.name);
        if (v === null) return false;
        if (!a.op) continue;
        let want = a.val;
        if (a.ci) { v = v.toLowerCase(); want = want.toLowerCase(); }
        const ok = a.op === '=' ? v === want : a.op === '~=' ? v.split(/\s+/).includes(want)
            : a.op === '^=' ? v.startsWith(want) : a.op === '$=' ? v.endsWith(want)
                : a.op === '*=' ? v.includes(want) : (v === want || v.startsWith(want + '-'));
        if (!ok) return false;
    }
    for (const p of c.pseudos) if (!matchPseudo(el, p, scope)) return false;
    return true;
}

function matchComplex(el, cx, i, scope) {
    if (!matchCompound(el, cx[i].c, scope)) return false;
    const comb = cx[i].comb;
    if (i === 0) {
        if (!comb) return true;
        if (!scope) return false;
        if (comb === '>') return el.parentNode === scope;
        if (comb === ' ') return scope.contains(el) && el !== scope;
        if (comb === '+') return el.previousElementSibling === scope;
        if (comb === '~') { for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s === scope) return true; return false; }
        return false;
    }
    if (comb === '>') { const p = el.parentNode; return !!p && p.nodeType === 1 && matchComplex(p, cx, i - 1, scope); }
    if (comb === ' ') {
        for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) if (matchComplex(p, cx, i - 1, scope)) return true;
        return false;
    }
    if (comb === '+') { const s = el.previousElementSibling; return !!s && matchComplex(s, cx, i - 1, scope); }
    if (comb === '~') {
        for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (matchComplex(s, cx, i - 1, scope)) return true;
        return false;
    }
    return false;
}

function matchesSel(el, sel, scope) {
    const list = parseSelectorList(sel);
    if (!list) return false;
    return list.some(cx => !cx.pseudoEl && matchComplex(el, cx, cx.length - 1, scope || null));
}

function qsa(root, sel) {
    const list = parseSelectorList(sel);
    if (!list) return [];
    const scope = root.nodeType === 1 ? root : null;
    return descendants(root).filter(e => list.some(cx => !cx.pseudoEl && matchComplex(e, cx, cx.length - 1, scope)));
}

function specificity(cx) {
    let a = 0, b = 0, c = 0;
    const add = s => { a += s[0]; b += s[1]; c += s[2]; };
    for (const {c: k} of cx) {
        if (k.id !== null) a++;
        b += k.classes.length + k.attrs.length;
        if (k.tag && k.tag !== '*') c++;
        if (k.pseudoEl) c++;
        for (const p of k.pseudos) {
            if (p.name === 'where') continue;
            if (p.list && p.list.length) {
                const best = p.list.map(specificity).sort(cmpSpec).pop();
                add(best);
            } else b++;
        }
    }
    return [a, b, c];
}
const cmpSpec = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/* ------------------------------------------------------- rules from LESS */

function stripComments(s) {
    let out = '', i = 0, q = null, paren = 0;
    while (i < s.length) {
        const ch = s[i], nx = s[i + 1];
        if (q) { out += ch; if (ch === '\\') { out += nx || ''; i += 2; continue; } if (ch === q) q = null; i++; continue; }
        if (ch === '"' || ch === "'") { q = ch; out += ch; i++; continue; }
        if (ch === '/' && nx === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; out += ' '; continue; }
        if (ch === '/' && nx === '/' && paren === 0) { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue; }
        if (ch === '(') paren++; else if (ch === ')') paren = Math.max(0, paren - 1);
        out += ch; i++;
    }
    return out;
}

function readLess(file, seen, dir) {
    if (seen.has(file) || !fs.existsSync(file)) return '';
    seen.add(file);
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    return src.replace(/@import\s*(?:\([^)]*\)\s*)?["']([^"']+)["']\s*;/g, (m, ref) => {
        const f = path.resolve(path.dirname(file), /\.(less|css)$/.test(ref) ? ref : ref + '.less');
        return path.dirname(f) === dir && /^compact/.test(path.basename(f)) ? '\n' + readLess(f, seen, dir) + '\n' : '';
    });
}

function combineSels(parents, children) {
    const out = [];
    for (const c0 of children) {
        const c = c0.trim().replace(/\s+/g, ' ');
        if (!c) continue;
        for (const p of parents) out.push(c.includes('&') ? c.replace(/&/g, p).trim() : (p ? p + ' ' + c : c));
    }
    return out;
}

function flattenLess(src) {
    const decls = [], lessVars = Object.create(null), cssVars = Object.create(null);
    const stack = [{sels: [''], skip: false}];
    let buf = '', q = null, paren = 0, interp = 0, order = 0;
    const open = prelude => {
        const top = stack[stack.length - 1];
        const p = prelude.trim();
        const skip = top.skip || p === '' || /^@(media|supports|keyframes|-webkit-keyframes|font-face|page|document|layer|container)\b/i.test(p)
            || /^@[\w-]+\s*:/.test(p) || /^[.#][\w-]+\s*\(/.test(p) || /\bwhen\b/.test(p) || p.includes('@{');
        stack.push({sels: skip ? [] : combineSels(top.sels, splitTop(p, ',')), skip});
    };
    const stmt = text => {
        const t = text.trim();
        if (!t) return;
        const top = stack[stack.length - 1];
        const v = /^@([\w-]+)\s*:\s*([\s\S]*)$/.exec(t);
        if (v) { if (!top.skip) lessVars[v[1]] = v[2].trim(); return; }
        if (t[0] === '@' || top.skip || stack.length === 1) return;
        const d = /^(--[\w-]+|[a-zA-Z-][\w-]*)\s*:\s*([\s\S]*)$/.exec(t);
        if (!d) return;
        let val = d[2].trim(), imp = false;
        if (/!important\s*$/i.test(val)) { imp = true; val = val.replace(/\s*!important\s*$/i, ''); }
        const prop = d[1].startsWith('--') ? d[1] : d[1].toLowerCase();
        if (prop.startsWith('--')) {
            const dark = top.sels.some(s => /dark/i.test(s));
            if (!dark || !(prop in cssVars)) cssVars[prop] = val;
        }
        decls.push({sels: top.sels, prop, val, imp, order: order++});
    };
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (q) { buf += ch; if (ch === '\\') { buf += src[++i] || ''; continue; } if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") { q = ch; buf += ch; continue; }
        if (ch === '(') paren++;
        if (ch === ')') paren = Math.max(0, paren - 1);
        if (paren) { buf += ch; continue; }
        if (ch === '{' && src[i - 1] === '@') { interp++; buf += ch; continue; }
        if (ch === '}' && interp) { interp--; buf += ch; continue; }
        if (ch === '{') { open(buf); buf = ''; continue; }
        if (ch === ';') { stmt(buf); buf = ''; continue; }
        if (ch === '}') { stmt(buf); buf = ''; if (stack.length > 1) stack.pop(); continue; }
        buf += ch;
    }
    return {decls, lessVars, cssVars};
}

function loadSheet(entry) {
    const src = readLess(entry, new Set(), path.dirname(entry));
    const {decls, lessVars, cssVars} = flattenLess(src);
    const byProp = Object.create(null);
    for (const d of decls) {
        for (const s of d.sels) {
            const list = parseSelectorList(s);
            if (!list) continue;
            for (const cx of list) {
                if (cx.pseudoEl) continue;
                const k = cx[cx.length - 1].c;
                const key = k.id !== null ? '#' + k.id : k.classes.length ? '.' + k.classes[0] : (k.tag && k.tag !== '*' ? k.tag : null);
                (byProp[d.prop] = byProp[d.prop] || []).push({cx, key, spec: specificity(cx), val: d.val, imp: d.imp, order: d.order});
            }
        }
    }
    const resolve = (v, depth = 0) => {
        if (!v || depth > 12) return v || '';
        let r = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (m, n, fb) => (n in cssVars ? cssVars[n] : (fb || '').trim()));
        r = r.replace(/@([\w-]+)/g, (m, n) => (n in lessVars ? lessVars[n] : m)).replace(/~"([^"]*)"/g, '$1');
        return r === v ? r.trim() : resolve(r, depth + 1);
    };
    return {byProp, resolve, present: src.trim().length > 0};
}

/* ---------------------------------------------- visibility and widths */

const INTERACTIVE_TAGS = new Set(['button', 'select', 'input', 'textarea']);
const ROLES = new Set(['button', 'combobox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'switch', 'tab', 'link', 'listbox', 'spinbutton', 'textbox']);
const POP_CLASS = /(^|-)pop$|^popover$|^dropdown-menu$|-palette$|^vo-menu$/;
const ICON_CLASS = 'vo-test-ico';

const interactive = el => !!el && el.nodeType === 1 && (INTERACTIVE_TAGS.has(el.localName)
    || ROLES.has((el.getAttribute('role') || '').toLowerCase()) || (el.localName === 'a' && el.hasAttribute('href')));
const popupLike = el => !!el && el.nodeType === 1 && el.className.split(/\s+/).some(c => POP_CLASS.test(c));

function makeLayout(env) {
    const sheet = env.sheet;
    let cacheV = -1, disp = new Map(), widths = new Map();
    const fresh = () => {
        const v = env.document.version;
        if (v !== cacheV) { cacheV = v; disp = new Map(); widths = new Map(); }
    };
    const cascade = (el, prop) => {
        const entries = sheet.byProp[prop];
        let best = null;
        if (entries) {
            for (const e of entries) {
                if (e.key) {
                    if (e.key[0] === '#') { if (el.id !== e.key.slice(1)) continue; } else if (e.key[0] === '.') { if (!el.classList.contains(e.key.slice(1))) continue; } else if (el.localName !== e.key) continue;
                }
                if (!matchComplex(el, e.cx, e.cx.length - 1, null)) continue;
                if (!best || (e.imp !== best.imp ? e.imp : (cmpSpec(e.spec, best.spec) || e.order - best.order) > 0)) best = e;
            }
        }
        const inl = el._st.get(prop);
        if (inl && !(best && best.imp && inl.p !== 'important')) return inl.v;
        return best ? sheet.resolve(best.val) : '';
    };
    const shownSelf = el => {
        fresh();
        if (disp.has(el)) return disp.get(el);
        const d = el.hasAttribute('hidden') ? 'none' : cascade(el, 'display').trim();
        const r = d !== 'none';
        disp.set(el, r);
        return r;
    };
    const shown = el => {
        let n = el;
        for (; n && n.nodeType === 1; n = n.parentNode) if (!shownSelf(n)) return false;
        return !!n && n.nodeType === 9;
    };
    const outOfFlow = el => { const p = cascade(el, 'position'); return p === 'absolute' || p === 'fixed' || popupLike(el); };
    const visibleText = el => {
        let t = '';
        for (const n of el.childNodes) {
            if (n.nodeType === 3) t += n.data;
            else if (n.nodeType === 1 && !n.classList.contains(ICON_CLASS) && shownSelf(n) && !outOfFlow(n)) t += visibleText(n);
        }
        return t;
    };
    const hasIcon = el => descendants(el).some(d => d.classList.contains(ICON_CLASS) && shownSelf(d));
    const block = el => el === env.document.body || el === env.document.documentElement || el.id === 'vo-shell'
        || el.id === 'vo-toolbar' || (env.card && el === env.card);
    const widthOf = el => {
        fresh();
        if (widths.has(el)) return widths.get(el);
        let w = 0;
        if (shownSelf(el)) {
            const fx = el.getAttribute('data-test-width');
            if (fx !== null) w = Number(fx);
            else if (interactive(el)) {
                const t = visibleText(el).replace(/[▾\s ]+/g, ' ').trim();
                w = t ? 16 + 8 * [...t].length + (hasIcon(el) ? 16 : 0) : 32;
            } else {
                for (const n of el.childNodes) {
                    if (n.nodeType === 3) w += 8 * n.data.trim().length;
                    else if (n.nodeType === 1 && !outOfFlow(n)) w += widthOf(n);
                }
            }
        }
        widths.set(el, w);
        return w;
    };
    const boxWidth = el => (block(el) ? env.W : widthOf(el));
    const marginLeftAuto = el => {
        if (cascade(el, 'margin-left') === 'auto') return true;
        const m = cascade(el, 'margin').split(/\s+/).filter(Boolean);
        const left = m[3] || m[1] || m[0];
        return left === 'auto';
    };
    const xOf = el => {
        const p = el.parentNode;
        if (!p || p.nodeType !== 1 || block(el)) return 0;
        const px = xOf(p);
        if (outOfFlow(el)) return px;
        const sibs = p.children.filter(c => !outOfFlow(c) && shownSelf(c));
        const idx = sibs.indexOf(el);
        if (env.card && p === env.card) {
            const auto = sibs.findIndex(marginLeftAuto);
            const jc = cascade(p, 'justify-content');
            const pushed = (auto >= 0 && idx >= auto) || (/space-between/.test(jc) && idx === sibs.length - 1 && idx > 0);
            if (pushed) { let rest = 0; for (let k = idx; k < sibs.length; k++) rest += widthOf(sibs[k]); return px + env.W - rest; }
        }
        let x = px;
        for (let k = 0; k < idx; k++) x += widthOf(sibs[k]);
        return x;
    };
    const rect = el => {
        const ok = shown(el);
        const w = ok ? boxWidth(el) : 0, x = ok ? xOf(el) : 0, h = ok ? 32 : 0;
        return {left: x, x, top: 0, y: 0, width: w, height: h, right: x + w, bottom: h, toJSON() { return this; }};
    };
    const contentWidth = el => {
        let w = 0;
        for (const c of el.children) if (!outOfFlow(c) && shownSelf(c)) w += widthOf(c);
        return w;
    };
    const scrollWidth = el => (block(el) ? Math.max(env.W, contentWidth(el)) : widthOf(el));
    const LAYOUT_ZERO = /^(gap|column-gap|row-gap|grid-gap|grid-column-gap|(padding|margin)(-(top|right|bottom|left|inline|block|inline-start|inline-end))?|border(-(top|right|bottom|left))?-width|outline-width|text-indent|letter-spacing)$/;
    const defaults = (el, name) => {
        if (name === 'display') return /^(div|ul|ol|li|p|section|header|footer|nav|main|form|table|body|html)$/.test(el.localName) ? 'block' : /^(button|input|select|textarea)$/.test(el.localName) ? 'inline-block' : 'inline';
        return {position: 'static', visibility: 'visible', opacity: '1', 'font-size': '13px', 'line-height': 'normal',
            'flex-direction': 'row', 'flex-wrap': 'nowrap', 'flex-shrink': '1', 'flex-grow': '0', overflow: 'visible',
            'pointer-events': 'auto', transform: 'none', direction: 'ltr', 'z-index': 'auto', 'box-sizing': 'border-box'}[name] || '';
    };
    const computed = el => {
        const get = name => {
            name = kebab(name);
            if (LAYOUT_ZERO.test(name)) return '0px';
            if (name === 'width' || name === 'min-width' || name === 'max-width') return boxWidth(el) + 'px';
            if (name === 'height') return '32px';
            return cascade(el, name) || defaults(el, name);
        };
        return new Proxy({getPropertyValue: get, getPropertyPriority: () => ''}, {
            get(t, k) { if (k in t) return t[k]; return typeof k === 'string' ? get(k) : undefined; }
        });
    };
    return {cascade, shownSelf, shown, outOfFlow, visibleText, widthOf, boxWidth, rect, contentWidth, scrollWidth, computed, marginLeftAuto};
}

/* ------------------------------------------------------ jQuery subset */

function makeJQ(env) {
    const doc = env.document;
    const store = new WeakMap();
    const dataOf = n => { let d = store.get(n); if (!d) { d = {data: {}, events: []}; store.set(n, d); } return d; };
    const winTarget = () => env.winTarget;
    const isWin = o => o === env.ctx || o === env.winTarget;
    const L = () => env.layout;

    function wrap(o) {
        return new Proxy(o, {
            get(t, k, r) {
                if (k in t) return t[k];
                if (typeof k !== 'string' || k === 'then' || /^\d+$/.test(k) || k === 'toJSON' || k[0] === '_') return undefined;
                return function () { return r; };
            }
        });
    }
    class JQ {
        constructor(nodes) {
            const a = [];
            for (const n of nodes) if (n && !a.includes(n)) a.push(n);
            a.forEach((n, i) => { this[i] = n; });
            this.length = a.length;
            this._once = false;
            return wrap(this);
        }
    }
    const arr = q => Array.from({length: q.length}, (_, i) => q[i]);
    const toNodes = (x, clone) => {
        if (x === null || x === undefined || x === false) return [];
        if (typeof x === 'string' || typeof x === 'number') {
            const f = parseHTML(doc, String(x));
            return f.childNodes.slice();
        }
        if (x instanceof JQ) return arr(x).map(n => (clone ? n.cloneNode(true) : n));
        if (Array.isArray(x)) return x.flatMap(y => toNodes(y, clone));
        if (x.nodeType) return [clone ? x.cloneNode(true) : x];
        return [];
    };
    const test = (el, sel, i) => {
        if (sel === undefined || sel === null) return true;
        if (typeof sel === 'function') return !!sel.call(el, i, el);
        if (typeof sel === 'string') return el.nodeType === 1 && matchesSel(el, sel);
        if (sel instanceof JQ) return arr(sel).includes(el);
        if (Array.isArray(sel)) return sel.includes(el);
        return el === sel;
    };
    function $(sel, ctx) {
        if (sel === null || sel === undefined || sel === '') return new JQ([]);
        if (typeof sel === 'function') { try { sel($); } catch (e) { env.errors.push(e); } return new JQ([doc]); }
        if (sel instanceof JQ) return new JQ(arr(sel));
        if (typeof sel === 'string') {
            const s = sel.trim();
            if (s[0] === '<') {
                const nodes = parseHTML(doc, s).childNodes.filter(n => n.nodeType === 1);
                nodes.forEach(n => n.parentNode && n.parentNode._detach(n));
                const q = new JQ(nodes);
                if (ctx && typeof ctx === 'object' && !ctx.nodeType && !(ctx instanceof JQ)) q.attr(ctx);
                return q;
            }
            const roots = ctx ? arr($(ctx)) : [doc];
            const out = [];
            for (const r of roots) if (r.querySelectorAll) out.push(...qsa(r, s));
            return new JQ(out);
        }
        if (isWin(sel)) return new JQ([winTarget()]);
        if (sel.nodeType) return new JQ([sel]);
        if (Array.isArray(sel) || (typeof sel.length === 'number' && typeof sel !== 'string')) return new JQ(Array.from(sel));
        return new JQ([sel]);
    }
    const P = JQ.prototype;
    P.jquery = '4.0.0';
    P.each = function (fn) { for (let i = 0; i < this.length; i++) if (fn.call(this[i], i, this[i]) === false) break; return this; };
    P.map = function (fn) { const out = []; this.each((i, n) => { const r = fn.call(n, i, n); if (r !== null && r !== undefined) out.push(...(Array.isArray(r) ? r : [r])); }); return new JQ(out); };
    P.get = function (i) { return i === undefined ? arr(this) : this[i < 0 ? this.length + i : i]; };
    P.toArray = function () { return arr(this); };
    P.eq = function (i) { const n = this.get(i); return new JQ(n ? [n] : []); };
    P.first = function () { return this.eq(0); };
    P.last = function () { return this.eq(-1); };
    P.slice = function (a, b) { return new JQ(arr(this).slice(a, b)); };
    P.index = function (x) {
        if (x === undefined) { const n = this[0]; return n && n.parentNode ? n.parentNode.children.indexOf(n) : -1; }
        const t = typeof x === 'string' ? $(x) : x;
        const el = t instanceof JQ ? t[0] : t;
        if (typeof x === 'string') return arr(t).indexOf(this[0]);
        return arr(this).indexOf(el);
    };
    P.add = function (x, ctx) { return new JQ(arr(this).concat(arr($(x, ctx)))); };
    P.addBack = function () { return this; };
    P.end = function () { return this; };
    P.filter = function (sel) { return new JQ(arr(this).filter((n, i) => test(n, sel, i))); };
    P.not = function (sel) { return new JQ(arr(this).filter((n, i) => !test(n, sel, i))); };
    P.is = function (sel) { return arr(this).some((n, i) => test(n, sel, i)); };
    P.has = function (sel) { return new JQ(arr(this).filter(n => (typeof sel === 'string' ? qsa(n, sel).length > 0 : n.contains(sel.nodeType ? sel : sel[0])))); };
    P.find = function (sel) {
        if (typeof sel !== 'string') { const t = arr($(sel)); return new JQ(t.filter(x => arr(this).some(n => n !== x && n.contains && n.contains(x)))); }
        const out = [];
        for (const n of arr(this)) if (n.nodeType === 1 || n.nodeType === 9 || n.nodeType === 11) out.push(...qsa(n, sel));
        return new JQ(out);
    };
    P.children = function (sel) { const out = []; for (const n of arr(this)) if (n.children) out.push(...n.children.filter(c => test(c, sel))); return new JQ(out); };
    P.contents = function () { const out = []; for (const n of arr(this)) if (n.childNodes) out.push(...n.childNodes); return new JQ(out); };
    P.parent = function (sel) { return new JQ(arr(this).map(n => n.parentNode).filter(p => p && p.nodeType !== 9 && p.nodeType !== 11 && test(p, sel))); };
    P.parents = function (sel) { const out = []; for (const n of arr(this)) for (let p = n.parentNode; p && p.nodeType === 1; p = p.parentNode) if (test(p, sel)) out.push(p); return new JQ(out); };
    P.parentsUntil = function () { return this.parents(); };
    P.closest = function (sel) {
        const out = [];
        for (const n of arr(this)) for (let p = n; p && p.nodeType === 1; p = p.parentNode) if (test(p, sel)) { out.push(p); break; }
        return new JQ(out);
    };
    P.siblings = function (sel) { const out = []; for (const n of arr(this)) if (n.parentNode) out.push(...n.parentNode.children.filter(c => c !== n && test(c, sel))); return new JQ(out); };
    P.next = function (sel) { return new JQ(arr(this).map(n => n.nextElementSibling).filter(n => n && test(n, sel))); };
    P.prev = function (sel) { return new JQ(arr(this).map(n => n.previousElementSibling).filter(n => n && test(n, sel))); };
    P.nextAll = function (sel) { const out = []; for (const n of arr(this)) for (let s = n.nextElementSibling; s; s = s.nextElementSibling) if (test(s, sel)) out.push(s); return new JQ(out); };
    P.prevAll = function (sel) { const out = []; for (const n of arr(this)) for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (test(s, sel)) out.push(s); return new JQ(out); };
    P.offsetParent = function () { return this.parent(); };
    const insert = (q, items, how) => {
        const targets = arr(q);
        targets.forEach((t, i) => {
            const nodes = items.flatMap(x => (typeof x === 'function' ? toNodes(x.call(t, i, t.innerHTML)) : toNodes(x, i < targets.length - 1 && typeof x !== 'string')));
            if (how === 'append') nodes.forEach(n => t.appendChild(n));
            else if (how === 'prepend') { const f = t.firstChild; nodes.forEach(n => t.insertBefore(n, f)); }
            else if (how === 'before') { if (t.parentNode) nodes.forEach(n => t.parentNode.insertBefore(n, t)); }
            else if (how === 'after') { if (t.parentNode) { const ref = t.nextSibling; nodes.forEach(n => t.parentNode.insertBefore(n, ref)); } }
        });
        return q;
    };
    P.append = function (...x) { return insert(this, x, 'append'); };
    P.prepend = function (...x) { return insert(this, x, 'prepend'); };
    P.before = function (...x) { return insert(this, x, 'before'); };
    P.after = function (...x) { return insert(this, x, 'after'); };
    P.appendTo = function (t) { $(t).append(this); return this; };
    P.prependTo = function (t) { $(t).prepend(this); return this; };
    P.insertBefore = function (t) { $(t).before(this); return this; };
    P.insertAfter = function (t) { $(t).after(this); return this; };
    P.replaceWith = function (x) { for (const n of arr(this)) { if (n.parentNode) { toNodes(x).forEach(m => n.parentNode.insertBefore(m, n)); n.parentNode.removeChild(n); } } return this; };
    P.replaceAll = function (t) { $(t).replaceWith(this); return this; };
    P.wrap = function (html) { for (const n of arr(this)) { const w = toNodes(html, true)[0]; if (w && n.parentNode) { n.parentNode.insertBefore(w, n); w.appendChild(n); } } return this; };
    P.unwrap = function () { for (const n of arr(this)) { const p = n.parentNode; if (p && p.parentNode && p.nodeType === 1) { p.parentNode.insertBefore(n, p); if (!p.childNodes.length) p.remove(); } } return this; };
    P.remove = function (sel) { for (const n of arr(this)) if (test(n, sel) && n.parentNode) n.parentNode.removeChild(n); return this; };
    P.detach = P.remove;
    P.empty = function () { for (const n of arr(this)) if (n.childNodes) n.childNodes.slice().forEach(c => n._detach(c)); return this; };
    P.clone = function () { return new JQ(arr(this).map(n => n.cloneNode(true))); };
    P.html = function (v) {
        if (v === undefined) return this[0] && this[0].nodeType === 1 ? this[0].innerHTML : undefined;
        for (const [i, n] of arr(this).entries()) {
            if (n.nodeType !== 1) continue;
            const val = typeof v === 'function' ? v.call(n, i, n.innerHTML) : v;
            if (val instanceof JQ || (val && val.nodeType)) { n.childNodes.slice().forEach(c => n._detach(c)); toNodes(val).forEach(m => n.appendChild(m)); } else n.innerHTML = val === null ? '' : String(val);
        }
        return this;
    };
    P.text = function (v) {
        if (v === undefined) return arr(this).map(n => n.textContent || '').join('');
        for (const [i, n] of arr(this).entries()) n.textContent = typeof v === 'function' ? v.call(n, i, n.textContent) : String(v);
        return this;
    };
    P.val = function (v) {
        if (v === undefined) return this[0] ? this[0].value : undefined;
        for (const n of arr(this)) n.value = v;
        return this;
    };
    P.attr = function (name, v) {
        if (typeof name === 'object') { for (const k of Object.keys(name)) this.attr(k, name[k]); return this; }
        if (v === undefined) { const n = this[0]; if (!n || n.nodeType !== 1) return undefined; const a = n.getAttribute(name); return a === null ? undefined : a; }
        for (const [i, n] of arr(this).entries()) {
            if (n.nodeType !== 1) continue;
            const val = typeof v === 'function' ? v.call(n, i, n.getAttribute(name)) : v;
            if (val === null || val === false && !/^(aria-|data-)/.test(name)) n.removeAttribute(name); else n.setAttribute(name, val);
        }
        return this;
    };
    P.removeAttr = function (name) { for (const n of arr(this)) if (n.nodeType === 1) String(name).split(/\s+/).forEach(a => n.removeAttribute(a)); return this; };
    P.prop = function (name, v) {
        if (typeof name === 'object') { for (const k of Object.keys(name)) this.prop(k, name[k]); return this; }
        if (v === undefined) return this[0] ? this[0][name] : undefined;
        for (const [i, n] of arr(this).entries()) n[name] = typeof v === 'function' ? v.call(n, i, n[name]) : v;
        return this;
    };
    P.removeProp = function (name) { for (const n of arr(this)) delete n[name]; return this; };
    P.data = function (key, v) {
        const n = this[0];
        if (key === undefined) {
            if (!n) return undefined;
            const out = {};
            if (n.nodeType === 1) for (const a of n.getAttributeNames()) if (a.startsWith('data-')) out[a.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = n.getAttribute(a);
            return Object.assign(out, dataOf(n).data);
        }
        if (typeof key === 'object') { for (const m of arr(this)) Object.assign(dataOf(m).data, key); return this; }
        if (v === undefined) {
            if (!n) return undefined;
            const d = dataOf(n).data;
            if (key in d) return d[key];
            if (n.nodeType === 1) {
                const a = n.getAttribute('data-' + kebab(key));
                if (a !== null) { try { return JSON.parse(a); } catch (e) { return a; } }
            }
            return undefined;
        }
        for (const m of arr(this)) dataOf(m).data[key] = v;
        return this;
    };
    P.removeData = function (key) { for (const n of arr(this)) { const d = dataOf(n).data; if (key === undefined) dataOf(n).data = {}; else delete d[key]; } return this; };
    const classes = s => String(s || '').split(/\s+/).filter(Boolean);
    P.addClass = function (c) { arr(this).forEach((n, i) => { if (n.nodeType === 1) n.classList.add(...classes(typeof c === 'function' ? c.call(n, i, n.className) : c)); }); return this; };
    P.removeClass = function (c) {
        arr(this).forEach((n, i) => {
            if (n.nodeType !== 1) return;
            if (c === undefined) n.removeAttribute('class');
            else n.classList.remove(...classes(typeof c === 'function' ? c.call(n, i, n.className) : c));
        });
        return this;
    };
    P.toggleClass = function (c, state) {
        arr(this).forEach((n, i) => {
            if (n.nodeType !== 1) return;
            for (const x of classes(typeof c === 'function' ? c.call(n, i, n.className) : c)) n.classList.toggle(x, state === undefined ? undefined : !!state);
        });
        return this;
    };
    P.hasClass = function (c) { return arr(this).some(n => n.nodeType === 1 && n.classList.contains(c)); };
    const DIM = /^(width|height|top|left|right|bottom|margin.*|padding.*|min.*|max.*|font-size|gap|border.*width)$/;
    P.css = function (name, v) {
        if (typeof name === 'object' && !Array.isArray(name)) { for (const k of Object.keys(name)) this.css(k, name[k]); return this; }
        if (Array.isArray(name)) { const out = {}; name.forEach(k => { out[k] = this.css(k); }); return out; }
        if (v === undefined) { const n = this[0]; if (!n || n.nodeType !== 1) return undefined; return L().computed(n).getPropertyValue(name); }
        for (const [i, n] of arr(this).entries()) {
            if (n.nodeType !== 1) continue;
            let val = typeof v === 'function' ? v.call(n, i, this.css(name)) : v;
            if (typeof val === 'number' && DIM.test(kebab(name))) val = val + 'px';
            n.style.setProperty(kebab(name), val === null ? '' : String(val));
        }
        return this;
    };
    P.show = function () {
        for (const n of arr(this)) {
            if (n.nodeType !== 1) continue;
            n.style.removeProperty('display');
            if (!L().shownSelf(n)) n.style.setProperty('display', n.localName === 'div' ? 'block' : 'inline-block');
        }
        return this;
    };
    P.hide = function () { for (const n of arr(this)) if (n.nodeType === 1) n.style.setProperty('display', 'none'); return this; };
    P.toggle = function (state) {
        if (typeof state === 'function') return this.on('click', state);
        for (const n of arr(this)) { const q = $(n); if (state === undefined ? !L().shownSelf(n) : state) q.show(); else q.hide(); }
        return this;
    };
    ['fadeIn', 'slideDown'].forEach(m => { P[m] = function (a, b) { this.show(); [a, b].forEach(f => typeof f === 'function' && f.call(this[0])); return this; }; });
    ['fadeOut', 'slideUp'].forEach(m => { P[m] = function (a, b) { this.hide(); [a, b].forEach(f => typeof f === 'function' && f.call(this[0])); return this; }; });
    P.animate = function (props, a, b, c) { if (props && typeof props === 'object') this.css(props); [a, b, c].forEach(f => typeof f === 'function' && f.call(this[0])); return this; };
    P.stop = function () { return this; };
    P.promise = function () { return Promise.resolve(this); };
    const dims = (q, inner) => {
        const n = q[0];
        if (!n) return undefined;
        if (isWin(n)) return inner === 'h' ? 800 : env.W;
        if (n.nodeType === 9) return inner === 'h' ? 800 : env.W;
        return inner === 'h' ? (L().shown(n) ? 32 : 0) : (L().shown(n) ? L().boxWidth(n) : 0);
    };
    P.width = function (v) { return v === undefined ? dims(this, 'w') : this.css('width', v); };
    P.height = function (v) { return v === undefined ? dims(this, 'h') : this.css('height', v); };
    P.innerWidth = P.outerWidth = function () { return dims(this, 'w'); };
    P.innerHeight = P.outerHeight = function () { return dims(this, 'h'); };
    P.offset = function () { const n = this[0]; if (!n || n.nodeType !== 1) return {left: 0, top: 0}; const r = n.getBoundingClientRect(); return {left: r.left, top: r.top}; };
    P.position = function () { const n = this[0]; if (!n || n.nodeType !== 1) return {left: 0, top: 0}; return {left: n.offsetLeft, top: 0}; };
    P.scrollTop = function (v) { if (v === undefined) return this[0] ? this[0].scrollTop || 0 : 0; for (const n of arr(this)) n.scrollTop = v; return this; };
    P.scrollLeft = function (v) { if (v === undefined) return this[0] ? this[0].scrollLeft || 0 : 0; for (const n of arr(this)) n.scrollLeft = v; return this; };
    const parseEvents = s => String(s).split(/\s+/).filter(Boolean).map(t => { const [type, ...ns] = t.split('.'); return {type, ns}; });
    P.on = function (events, sel, data, fn) {
        if (typeof events === 'object') { for (const k of Object.keys(events)) this.on(k, sel, data, events[k]); return this; }
        if (fn === undefined && data === undefined) { fn = sel; sel = undefined; } else if (fn === undefined) {
            if (typeof sel === 'string') { fn = data; data = undefined; } else { fn = data; data = sel; sel = undefined; }
        }
        if (typeof fn !== 'function') { if (fn === false) fn = () => false; else return this; }
        const once = this._once;
        for (const n of arr(this)) {
            for (const {type, ns} of parseEvents(events)) {
                const rec = {type, ns, sel, fn};
                rec.wrapped = function (ev) {
                    let target = this;
                    if (sel) {
                        target = null;
                        for (let x = ev.target; x && x !== this; x = x.parentNode) if (x.nodeType === 1 && matchesSel(x, sel)) { target = x; break; }
                        if (!target) return;
                    }
                    if (once) { n.removeEventListener(type, rec.wrapped); dataOf(n).events = dataOf(n).events.filter(r => r !== rec); }
                    const saved = ev.currentTarget;
                    ev.data = data;
                    ev.delegateTarget = this;
                    ev.currentTarget = target;
                    const r = fn.apply(target, [ev].concat(ev._extra || []));
                    ev.currentTarget = saved;
                    if (r === false) { ev.preventDefault(); ev.stopPropagation(); }
                };
                dataOf(n).events.push(rec);
                if (n.addEventListener) n.addEventListener(type, rec.wrapped);
            }
        }
        return this;
    };
    P.one = function (...a) { this._once = true; try { return this.on(...a); } finally { this._once = false; } };
    P.off = function (events, sel, fn) {
        if (typeof sel === 'function') { fn = sel; sel = undefined; }
        for (const n of arr(this)) {
            const d = dataOf(n);
            const want = events === undefined ? null : parseEvents(events);
            d.events = d.events.filter(r => {
                const hit = (!want || want.some(w => (!w.type || w.type === r.type) && w.ns.every(x => r.ns.includes(x))))
                    && (sel === undefined || sel === r.sel) && (!fn || fn === r.fn);
                if (hit && n.removeEventListener) n.removeEventListener(r.type, r.wrapped);
                return !hit;
            });
        }
        return this;
    };
    P.trigger = function (event, extra) {
        for (const n of arr(this)) {
            const ev = typeof event === 'object' ? event : makeEvent(parseEvents(event)[0].type);
            ev.target = null;
            ev._stop = ev._stopImm = false;
            ev._extra = extra === undefined ? [] : Array.isArray(extra) ? extra : [extra];
            if (ev.type === 'focus' && n.focus) { n.focus(); continue; }
            if (ev.type === 'blur' && n.blur) { n.blur(); continue; }
            dispatch(n, ev);
        }
        return this;
    };
    P.triggerHandler = function (event, extra) {
        const n = this[0];
        if (!n) return undefined;
        const ev = makeEvent(typeof event === 'object' ? event.type : parseEvents(event)[0].type, {bubbles: false});
        ev._extra = extra === undefined ? [] : Array.isArray(extra) ? extra : [extra];
        dispatch(n, ev);
        return undefined;
    };
    ['click', 'dblclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'mousemove', 'keydown', 'keyup',
        'keypress', 'change', 'input', 'submit', 'resize', 'scroll', 'contextmenu', 'focusin', 'focusout'].forEach(t => {
        P[t] = function (fn) { return typeof fn === 'function' ? this.on(t, fn) : this.trigger(t); };
    });
    P.focus = function (fn) { if (typeof fn === 'function') return this.on('focus', fn); if (this[0] && this[0].focus) this[0].focus(); return this; };
    P.blur = function (fn) { if (typeof fn === 'function') return this.on('blur', fn); if (this[0] && this[0].blur) this[0].blur(); return this; };
    P.hover = function (a, b) { return this.on('mouseenter', a).on('mouseleave', b || a); };
    P.ready = function (fn) { fn.call(doc, $); return this; };

    $.fn = P;
    $.prototype = P;
    $.extend = function (...a) {
        let deep = false;
        if (typeof a[0] === 'boolean') deep = a.shift();
        if (a.length === 1) { a.unshift(this); }
        const target = a[0] || {};
        for (const src of a.slice(1)) {
            if (!src) continue;
            for (const k of Object.keys(src)) {
                const v = src[k];
                if (deep && v && typeof v === 'object' && !Array.isArray(v) && !v.nodeType) target[k] = $.extend(true, target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
                else if (v !== undefined) target[k] = v;
            }
        }
        return target;
    };
    $.each = (o, fn) => { if (Array.isArray(o) || (o && typeof o.length === 'number' && typeof o !== 'function')) { for (let i = 0; i < o.length; i++) if (fn.call(o[i], i, o[i]) === false) break; } else if (o) { for (const k of Object.keys(o)) if (fn.call(o[k], k, o[k]) === false) break; } return o; };
    $.map = (o, fn) => { const out = []; $.each(o, (k, v) => { const r = fn(v, k); if (r !== null && r !== undefined) out.push(...(Array.isArray(r) ? r : [r])); }); return out; };
    $.grep = (a, fn, inv) => Array.from(a || []).filter((v, i) => !!fn(v, i) !== !!inv);
    $.inArray = (v, a) => Array.from(a || []).indexOf(v);
    $.isArray = Array.isArray;
    $.isFunction = f => typeof f === 'function';
    $.isPlainObject = o => !!o && typeof o === 'object' && (Object.getPrototypeOf(o) === null || Object.getPrototypeOf(o).constructor.name === 'Object');
    $.isEmptyObject = o => !o || Object.keys(o).length === 0;
    $.isNumeric = v => !isNaN(parseFloat(v)) && isFinite(v);
    $.noop = () => {};
    $.trim = s => String(s === null || s === undefined ? '' : s).trim();
    $.contains = (a, b) => a !== b && !!a.contains && a.contains(b);
    $.proxy = (fn, ctx) => (typeof ctx === 'string' ? fn[ctx].bind(fn) : fn.bind(ctx));
    $.parseHTML = s => parseHTML(doc, String(s || '')).childNodes.slice();
    $.now = () => Date.now();
    $.type = o => (o === null ? 'null' : Array.isArray(o) ? 'array' : typeof o);
    $.data = (n, k, v) => (v === undefined ? $(n).data(k) : $(n).data(k, v));
    $.merge = (a, b) => { Array.prototype.push.apply(a, Array.from(b)); return a; };
    $.uniqueSort = $.unique = a => a;
    $.escapeSelector = s => String(s).replace(/([^\w-])/g, '\\$1');
    $.Event = (type, props) => makeEvent(type, props);
    $.Deferred = function () {
        let state = 'pending', args = [];
        const done = [], fail = [];
        const d = {
            resolve(...a) { if (state === 'pending') { state = 'resolved'; args = a; done.forEach(f => f(...a)); } return d; },
            reject(...a) { if (state === 'pending') { state = 'rejected'; args = a; fail.forEach(f => f(...a)); } return d; },
            done(f) { if (state === 'resolved') f(...args); else done.push(f); return d; },
            fail(f) { if (state === 'rejected') f(...args); else fail.push(f); return d; },
            always(f) { d.done(f); d.fail(f); return d; },
            then(f, g) { if (f) d.done(f); if (g) d.fail(g); return d; },
            promise() { return d; },
            state() { return state; }
        };
        return d;
    };
    $.when = (...a) => { const d = $.Deferred(); d.resolve(...a); return d; };
    $.ajax = () => $.Deferred().reject();
    $.get = $.getJSON = $.post = $.ajax;
    $.support = {};
    $.expr = {pseudos: {}, ':': {}};
    $.cssHooks = {};
    $.cssNumber = {};
    $.fx = {off: true};
    $.event = {special: {}, fixHooks: {}};
    $.Callbacks = () => { const l = []; return {add(f) { l.push(f); return this; }, fire(...a) { l.forEach(f => f(...a)); return this; }, remove() { return this; }}; };
    return {$, JQ};
}

/* ---------------------------------------------------------------- stubs */

const plainArg = a => {
    if (a === null || a === undefined) return a;
    if (['string', 'number', 'boolean'].includes(typeof a)) return a;
    if (Array.isArray(a)) return a.map(plainArg);
    return '[obj]';
};

/* The plugin item flag exists only on Common.UI.MenuItemCustom (MenuItemCustom.initialize), by it
   Common.UI.Menu tells 'item:custom-click' from 'item:click'. The stubs do not invent it. */
const PLUGIN_FLAG = 'isCustomItem';

/* Members of the stock Common.UI.MenuItem: its methods and fields (without Common.UI.MenuItemCustom with its
   isCustomItem), Common.UI.BaseView, Backbone.View and Backbone.Events, from the sources. The item
   stub answers only to these names; a stock item has no other names. */
let MENU_ITEM_MEMBERS = null;
function menuItemMembers() {
    if (MENU_ITEM_MEMBERS) return MENU_ITEM_MEMBERS;
    const lib = path.join(ROOT, 'apps/common/main/lib/component');
    const slice = (file, from, to) => {
        const src = fs.readFileSync(file, 'utf8');
        const a = src.indexOf(from), b = src.indexOf(to, a + 1);
        if (a < 0 || b < 0) throw new Error('в штатном ' + rel(file) + ' нет ' + from);
        return src.slice(a, b);
    };
    const names = new Set();
    const collect = (text, top) => {
        for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*function\b/g)) names.add(m[1]);
        for (const m of text.matchAll(/\b(?:this|me)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) names.add(m[1]);
        for (const m of text.matchAll(top)) names.add(m[1]);
    };
    collect(slice(path.join(lib, 'MenuItem.js'), 'Common.UI.MenuItem = ', 'Common.UI.MenuItemSeparator'), /^ {8}([A-Za-z_$][\w$]*)\s*:/gm);
    collect(slice(path.join(lib, 'BaseView.js'), 'BaseView: Backbone.View.extend', 'getId:'), /^ {12}([A-Za-z_$][\w$]*)\s*:/gm);
    const bb = VENDOR('backbone/backbone.js');
    for (const m of fs.readFileSync(bb, 'utf8').matchAll(/\bEvents\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
    collect(slice(bb, '_.extend(View.prototype, Events, {', '\n  });'), /^ {4}([A-Za-z_$][\w$]*)\s*:/gm);
    ['cid', 'el', '$el', 'options', 'model', 'collection', 'id', 'attributes', 'className', 'tagName', 'events'].forEach(n => names.add(n));
    names.delete(PLUGIN_FLAG);
    MENU_ITEM_MEMBERS = names;
    return names;
}

/* The stock MenuItem.onItemClick: left button only; the mark of a toggle item (except the one
   pressed in a group without allowDepress); a submenu holder does not send 'click'; a disabled one does not either. */
function stockItemClick(item, e, fire) {
    if (e.which != 1 && (e.which !== undefined || item.menu)) return false;
    if (!item.disabled && (item.allowDepress || !(item.checked && item.toggleGroup)) && !item.menu) item.setChecked(!item.checked);
    if (item.menu) return e.target && e.target.id == item.id ? false : undefined;
    if (item.disabled) return false;
    fire();
    return undefined;
}

function makeStubs(env) {
    const log = (who, ref, method, args) => env.log.push({who, ref, method, args: (args || []).map(plainArg)});

    function deepStub(name) {
        const cache = new Map(), props = Object.create(null);
        const fn = function () {};
        return new Proxy(fn, {
            get(t, k) {
                if (k === 'then' || k === 'toJSON' || k === 'nodeType' || k === 'jquery') return undefined;
                if (k === PLUGIN_FLAG && !(k in props)) return undefined;
                if (k === Symbol.toPrimitive) return hint => (hint === 'number' ? 0 : '');
                if (k === 'toString' || k === 'valueOf') return () => '';
                if (typeof k === 'symbol') return undefined;
                if (k === 'prototype') return t.prototype;
                if (k in props) return props[k];
                if (!cache.has(k)) cache.set(k, deepStub(name + '.' + k));
                return cache.get(k);
            },
            set(t, k, v) { props[k] = v; return true; },
            has(t, k) { return k in props || cache.has(k); },
            apply(t, self, args) { log('stock', name, 'call', args); return deepStub(name + '()'); },
            construct(t, args) { log('stock', name, 'new', args); return deepStub('new ' + name); }
        });
    }

    const READ = new Set(['isDisabled', 'isVisible', 'isActive', 'isChecked', 'getValue', 'getCaption', 'getRawValue', 'getSelectedRecord', 'on', 'off', 'once', 'listenTo', 'stopListening']);
    const twins = Object.create(null);
    const ruText = k => env.ru[k];
    function makeMenu(ref) {
        const handlers = {};
        const items = [];
        if (/:btnAddSlide$/.test(ref)) {
            items.push({id: 'layouts', caption: '', template: true}, {caption: '--', sep: true}, {id: 'duplicate', value: 'duplicate', caption: ruText('PE.Views.Toolbar.txtDuplicateSlide')});
        }
        /* A stock menu item (Common.UI.MenuItem from options): menu is null without a submenu
           (MenuItem.initialize: options.menu || null), option fields, Backbone events,
           the stock onItemClick; a stock item has no other names. */
        let menuProxy = null;
        const itemStub = (it, i) => {
            const on = {};
            const base = {
                options: it, id: it.id !== undefined ? it.id : ref + '#item' + i, caption: it.caption, value: it.value,
                checked: !!it.checked, disabled: !!it.disabled, menu: it.menu || null, rendered: true,
                checkable: it.checkable, toggleGroup: it.toggleGroup, allowDepress: it.allowDepress, iconCls: it.iconCls, template: it.template,
                isDisabled() { return this.disabled; }, isVisible: () => true, isChecked() { return this.checked; },
                /* the stock MenuItem.setChecked → toggle: only a toggle item changes its mark */
                setChecked(v, silent) {
                    log('stock', ref + '#item', 'setChecked', [it.value, v]);
                    if (!this.checkable) return;
                    this.checked = !!v;
                    if (!silent) this.trigger('toggle', proxy, this.checked);
                },
                on(ev, cb) { String(ev).split(/\s+/).forEach(n => { (on[n] = on[n] || []).push(cb); }); return proxy; },
                off(ev) { if (ev) delete on[ev]; else Object.keys(on).forEach(n => delete on[n]); return proxy; },
                trigger(ev, ...a) { (on[ev] || []).slice().forEach(cb => cb(...a)); return proxy; },
                onItemClick(e) { return stockItemClick(proxy, e, () => { log('stock', ref + '#item', 'click', [it.value]); proxy.trigger('click', proxy, e); }); }
            };
            const members = menuItemMembers();
            const proxy = new Proxy(base, {
                get(t, k) {
                    if (k in t) return t[k];
                    if (typeof k !== 'string' || k === 'then' || !members.has(k)) return undefined;
                    return (...a) => log('stock', ref + '#item', k, [it.value].concat(a));
                }
            });
            /* the stock Menu.addItem: item.on('click', menu's onItemClick) → 'item:click' ('item:custom-click' for a plugin item) */
            base.on('click', (item, e) => menuProxy.trigger(item.isCustomItem ? 'item:custom-click' : 'item:click', menuProxy, item, e));
            return proxy;
        };
        const base = {
            items: items.map(itemStub),
            isVisible: () => false,
            on(ev, cb) { (handlers[ev] = handlers[ev] || []).push(cb); return this; },
            off() { return this; },
            trigger(ev, ...a) { log('stock', ref + '#menu', 'trigger', [ev].concat(a)); (handlers[ev] || []).forEach(cb => cb(...a)); return this; }
        };
        menuProxy = new Proxy(base, {
            get(t, k) {
                if (k in t) return t[k];
                if (typeof k !== 'string' || k === 'then' || k === PLUGIN_FLAG) return undefined;
                return (...a) => { log('stock', ref + '#menu', k, a); return undefined; };
            }
        });
        return menuProxy;
    }
    function makeTwin(ref) {
        const handlers = {};
        const emit = (ev, ...a) => (handlers[ev] || []).slice().forEach(cb => { try { cb(...a); } catch (e) { env.errors.push(e); } });
        const el = env.document.createElement('button');
        const base = {
            ref, pressed: false, disabled: false, visible: true, checked: false, value: undefined, rendered: true,
            options: {caption: '', hint: ''},
            menu: makeMenu(ref),
            isDisabled() { return this.disabled; },
            isVisible() { return this.visible; },
            isActive() { return this.pressed; },
            isChecked() { return this.checked || this.pressed; },
            getValue() { return this.value; },
            setDisabled(d) { this.disabled = !!d; log('stock', ref, 'setDisabled', [d]); },
            toggle(s, silent) {
                this.pressed = s === undefined ? !this.pressed : !!s;
                log('stock', ref, 'toggle', [s]);
                if (!silent) emit('toggle', proxy, this.pressed);
            },
            click() { log('stock', ref, 'click', []); emit('click', proxy); },
            trigger(ev, ...a) { log('stock', ref, 'trigger', [ev].concat(a)); emit(ev, ...a); return proxy; },
            on(ev, cb) { String(ev).split(/\s+/).forEach(e => { (handlers[e] = handlers[e] || []).push(cb); }); return proxy; },
            off() { return proxy; },
            setValue(v) { this.value = v; log('stock', ref, 'setValue', [v]); },
            cmpEl: null, $el: null
        };
        /* Twin: onItemClick exists only on the stock Menu and MenuItem (an item by path has its own,
           below), isCustomItem only on a plugin item. */
        const proxy = new Proxy(base, {
            get(t, k) {
                if (k in t) return t[k];
                if (typeof k !== 'string' || k === 'then' || k === PLUGIN_FLAG || k === 'onItemClick') return undefined;
                if (READ.has(k)) return () => undefined;
                return (...a) => { log('stock', ref, k, a); return undefined; };
            }
        });
        base.cmpEl = base.$el = env.$(el);
        base.el = el;
        base.emit = emit;
        /* the twin of an item by the path '….menu.items.<n>' is a stock MenuItem with its own onItemClick */
        if (/\.items\.\d+$/.test(ref)) base.onItemClick = e => stockItemClick(proxy, e, () => proxy.click());
        return proxy;
    }
    const twin = ref => (twins[ref] = twins[ref] || makeTwin(ref));

    const VIEW_HOLDERS = {Toolbar: ['toolbar'], LeftMenu: ['leftMenu'], ViewTab: ['view'], Statusbar: ['statusbar'],
        RightMenu: ['rightmenu', 'rightMenu'], DocumentHolder: ['documentHolder'], Transitions: ['view'], Animation: ['view'],
        Review: ['view'], ChartTab: ['view'], FileMenu: ['view']};
    function stockView(root) {
        return new Proxy({}, {
            get(t, k) {
                if (k in t) return t[k];
                if (typeof k !== 'string' || k === 'then') return undefined;
                if (/^(btn|cmb|ch|chk|list|mnu|num|spn|radio|lbl|cmp|mi|btns|cmbs)[A-Z]/.test(k)) return (t[k] = twin(`${root}:${k}`));
                return (t[k] = deepStub(`${root}.${k}`));
            }
        });
    }
    const controllers = Object.create(null);
    function stockController(name) {
        name = String(name);
        if (controllers[name]) return controllers[name];
        const root = /ReviewChanges/.test(name) ? 'Review' : name.replace(/^.*\./, '');
        const view = stockView(root);
        const base = {api: env.api, appOptions: env.appOptions, mode: env.appOptions, getView: () => view, view};
        (VIEW_HOLDERS[root] || []).forEach(h => { base[h] = view; });
        if (root === 'Main') Object.assign(base, {editorConfig: {ui: {shell: 'modern'}, lang: 'ru', customization: {}}, _state: {}, isModalShowed: () => false});
        if (root === 'Viewport') base.viewport = deepStub('Viewport.viewport');
        return (controllers[name] = new Proxy(base, {
            get(t, k) {
                if (k in t) return t[k];
                if (typeof k !== 'string' || k === 'then') return undefined;
                return (t[k] = deepStub(`${root}.${k}`));
            }
        }));
    }
    return {deepStub, twin, stockController, log};
}

function makeEmitter(env, name, logged) {
    const h = Object.create(null);
    const em = {
        on(ev, fn, ctx) {
            if (ev && typeof ev === 'object') { for (const k of Object.keys(ev)) em.on(k, ev[k], fn); return em; }
            String(ev).split(/\s+/).filter(Boolean).forEach(e => { (h[e] = h[e] || []).push({fn, ctx}); });
            return em;
        },
        once(ev, fn, ctx) { const w = (...a) => { em.off(ev, w); fn.apply(ctx, a); }; return em.on(ev, w, ctx); },
        off(ev, fn) {
            if (ev === undefined) { for (const k of Object.keys(h)) delete h[k]; return em; }
            String(ev).split(/\s+/).forEach(e => { if (h[e]) h[e] = fn ? h[e].filter(x => x.fn !== fn) : []; });
            return em;
        },
        trigger(ev, ...a) {
            if (logged) env.log.push({who: name, ref: String(ev), method: 'trigger', args: a.map(plainArg)});
            String(ev).split(/\s+/).forEach(e => (h[e] || []).slice().forEach(x => {
                try { x.fn.apply(x.ctx, a); } catch (err) { env.errors.push(err); }
            }));
            (h.all || []).forEach(x => { try { x.fn.apply(x.ctx, [ev].concat(a)); } catch (err) { env.errors.push(err); } });
            return em;
        },
        listenTo() { return em; },
        stopListening() { return em; }
    };
    return em;
}

/* --------------------------------------------------------------- captions */

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const label = (...alts) => new RegExp('^(?:' + alts.map(esc).join('|') + ')(?:\\s*▾)?(?:\\s*[(—–:].*)?$', 'i');

/* Control names by caption or hint: the stock presentation locale and
   the required shell captions. */
const CONTROLS = [
    ['undo', label('Отменить', 'Отменить изменение')],
    ['redo', label('Повторить', 'Повторить изменение')],
    ['search', label('Поиск', 'Найти', 'Найти и заменить')],
    ['comment', label('Комментарий', 'Комментарии')],
    ['zoom', label('Масштаб')],
    ['font', label('Шрифт')],
    ['size', label('Размер шрифта', 'Кегль')],
    ['textPop', label('Стили текста')],
    ['align', label('Выравнивание и интервал')],
    ['lists', label('Списки и отступы')],
    ['newSlide', label('Новый слайд')],
    ['textbox', label('Надпись', 'Вставить надпись')],
    ['image', label('Изображение', 'Вставить изображение')],
    ['shape', label('Фигура', 'Вставить фигуру', 'Вставить автофигуру')],
    ['line', label('Линия', 'Вставить линию')],
    ['link', label('Ссылка', 'Добавить ссылку', 'Добавить или изменить ссылку')],
    ['bg', label('Фон', 'Фон слайда')],
    ['layout', label('Макет', 'Макет слайда', 'Изменить макет слайда')],
    ['theme', label('Тема', 'Изменить тему')],
    ['transition', label('Переход', 'Переходы')],
    ['fill', label('Цвет заливки')],
    ['lineColor', label('Цвет линии')],
    ['lineWidth', label('Толщина линии')],
    ['lineType', label('Тип линии')],
    ['borderColor', label('Цвет границ')],
    ['rowsCols', label('Строки и столбцы')],
    ['objProps', label('Свойства объекта')],
    ['crop', label('Обрезать')],
    ['cropShape', label('Обрезать по фигуре')],
    ['replace', label('Заменить изображение')],
    ['actual', label('Реальный размер')],
    ['editData', label('Изменить данные')],
    ['chartType', label('Изменить тип диаграммы')],
    ['painter', label('Формат по образцу')],
    ['bold', label('Полужирный')],
    ['italic', label('Курсив')],
    ['underline', label('Подчёркнутый')],
    ['strike', label('Зачёркнутый', 'Зачеркнутый')],
    ['sup', label('Надстрочный')],
    ['sub', label('Подстрочный')],
    ['textColor', label('Цвет текста')],
    ['highlight', label('Цвет выделения')],
    ['case', label('Регистр')],
    ['clearFmt', label('Очистить форматирование')],
    ['duplicate', label('Дублировать слайд')],
    ['focus', /фокус/i],
    ['more', /^(⋯|…|•••|\.\.\.|ещё|еще|дополнительно|другие команды)$/i]
];

/* ------------------------------------------------------------ environment */

const KIND_FOCUS = {
    none: ['Slide'], text: ['Slide', 'Paragraph', 'Shape'], typing: ['Slide', 'Paragraph', 'Shape'], shape: ['Slide', 'Shape'],
    image: ['Slide', 'Image'], table: ['Slide', 'Paragraph', 'Table'], chart: ['Slide', 'Chart'], line: ['Slide', 'Shape']
};

function createEnv(options) {
    options = options || {};
    const env = {
        W: options.width || 1600, kind: options.kind || 'none', log: [], errors: [], timers: [], tid: 0, ros: [],
        clickDepth: 0, registry: Object.create(null), card: null, zoom: 100,
        ru: JSON.parse(fs.readFileSync(RU_FILE, 'utf8')),
        appOptions: {isEdit: true, canEdit: true, canComments: true, canCoAuthoring: true, canViewComments: true,
            canEditComments: true, canDeleteComments: true, canDownload: true, canPrint: true, canChat: true, canRename: true,
            canUseHistory: true, canRequestSharingSettings: true, canHistoryClose: true, customization: {}, isDesktopApp: false,
            isOffline: false, user: {id: 'u1', fullname: 'Автор'}, lang: 'ru', isRestrictedEdit: false}
    };
    env.viewDir = options.viewDir || VIEW_DIR;
    env.sheet = loadSheet(options.lessEntry || LESS_ENTRY);
    const doc = env.document = new DDocument(env);
    env.layout = makeLayout(env);
    env.winTarget = new ETarget();
    doc.defaultView = env.winTarget;
    doc.body.className = 'vo-compact';
    doc.body.innerHTML = '<div id="viewport"><div id="vo-shell"><div id="vo-header"></div><div id="vo-menubar"></div>'
        + '<div id="vo-toolbar"></div></div><div id="toolbar"></div><div id="editor_sdk"><div id="id_panel_thumbnails"></div></div>'
        + '<div id="right-menu"></div><div id="left-menu"></div><div id="vo-status"></div><div id="statusbar"></div></div>';
    env.host = doc.getElementById('vo-toolbar');

    const ctx = env.ctx = {};
    const storage = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] || null, get length() { return m.size; }}; };
    const eventCtor = function (type, init) { return makeEvent(type, Object.assign({bubbles: false}, init || {})); };
    Object.assign(ctx, {
        window: ctx, self: ctx, top: ctx, parent: ctx, frames: ctx, document: doc,
        navigator: {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120', platform: 'MacIntel', language: 'ru', languages: ['ru'], maxTouchPoints: 0, clipboard: {}},
        location: {href: 'http://stand.test/', search: '', hash: '', origin: 'http://stand.test', protocol: 'http:', host: 'stand.test', hostname: 'stand.test', pathname: '/', reload() {}},
        console: {log() {}, info() {}, debug() {}, trace() {}, warn: (...a) => env.errors.push(new Error('console.warn: ' + a.join(' '))), error: (...a) => env.errors.push(new Error('console.error: ' + a.join(' ')))},
        setTimeout: (fn, ms, ...a) => { const id = ++env.tid; if (typeof fn === 'function') env.timers.push({id, fn: () => fn(...a), ms: +ms || 0}); return id; },
        clearTimeout: id => { env.timers = env.timers.filter(t => t.id !== id); },
        setInterval: (fn, ms) => { const id = ++env.tid; env.timers.push({id, fn, ms: +ms || 0, interval: true, runs: 0}); return id; },
        clearInterval: id => { env.timers = env.timers.filter(t => t.id !== id); },
        requestAnimationFrame: fn => ctx.setTimeout(() => fn(Date.now()), 16),
        cancelAnimationFrame: id => ctx.clearTimeout(id),
        requestIdleCallback: fn => ctx.setTimeout(() => fn({timeRemaining: () => 50, didTimeout: false}), 1),
        queueMicrotask: fn => Promise.resolve().then(fn),
        getComputedStyle: el => env.layout.computed(el),
        matchMedia: () => ({matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}}),
        ResizeObserver: class { constructor(cb) { this.cb = cb; this.targets = []; env.ros.push(this); } observe(t) { this.targets.push(t); } unobserve(t) { this.targets = this.targets.filter(x => x !== t); } disconnect() { this.targets = []; } },
        MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
        IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
        Node: DNode, Element: DElement, HTMLElement: DElement, SVGElement: DElement, HTMLButtonElement: DElement,
        HTMLInputElement: DElement, Text: DText, DocumentFragment: DFragment, Document: DDocument, EventTarget: ETarget,
        Event: eventCtor, CustomEvent: eventCtor, MouseEvent: eventCtor, KeyboardEvent: eventCtor, FocusEvent: eventCtor,
        WheelEvent: eventCtor, PointerEvent: eventCtor, InputEvent: eventCtor,
        innerHeight: 800, outerHeight: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0,
        localStorage: storage(), sessionStorage: storage(),
        performance: {now: () => Date.now()}, URL, URLSearchParams, TextEncoder, TextDecoder,
        fetch: () => Promise.reject(new Error('offline')),
        Image: function () { return doc.createElement('img'); },
        btoa: s => Buffer.from(String(s), 'binary').toString('base64'), atob: s => Buffer.from(String(s), 'base64').toString('binary'),
        addEventListener: (...a) => env.winTarget.addEventListener(...a),
        removeEventListener: (...a) => env.winTarget.removeEventListener(...a),
        dispatchEvent: ev => env.winTarget.dispatchEvent(ev),
        scrollTo() {}, scrollBy() {}, focus() {}, blur() {}, open() { return null; }, alert() {}, confirm: () => false,
        getSelection: () => doc.getSelection()
    });
    Object.defineProperty(ctx, 'innerWidth', {get: () => env.W, enumerable: true});
    Object.defineProperty(ctx, 'outerWidth', {get: () => env.W, enumerable: true});
    vm.createContext(ctx);

    for (const lib of ['underscore/underscore.js', 'backbone/backbone.js']) {
        const f = VENDOR(lib);
        if (fs.existsSync(f)) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, {filename: f});
    }
    const {$, JQ} = makeJQ(env);
    env.$ = $;
    env.JQ = JQ;
    ctx.$ = ctx.jQuery = $;
    if (ctx.Backbone) ctx.Backbone.$ = $;

    const callbacks = env.callbacks = Object.create(null);
    const stubs = makeStubs(env);
    env.stubs = stubs;
    const focusObjects = () => (KIND_FOCUS[env.kind] || ['Slide']).map(t => {
        const type = ctx.Asc.c_oAscTypeSelectElement[t];
        const value = stubs.deepStub('focus.' + t);
        return {get_ObjectType: () => type, asc_getObjectType: () => type, get_ObjectValue: () => value, asc_getObjectValue: () => value};
    });
    const apiBase = {
        asc_registerCallback(n, f) { (callbacks[n] = callbacks[n] || []).push(f); },
        asc_unregisterCallback(n, f) { if (callbacks[n]) callbacks[n] = callbacks[n].filter(x => x !== f); },
        asc_getZoom: () => env.zoom, get_ZoomValue: () => env.zoom,
        asc_getCurrentFocusObject: () => focusObjects(),
        getCurrentPage: () => 0, getCountPages: () => 3, asc_getCountPages: () => 3,
        asc_IsTextEditing: () => env.kind === 'typing', isDocumentModified: () => false
    };
    env.api = new Proxy(apiBase, {
        get(t, k) {
            if (k in t) return t[k];
            if (typeof k !== 'string' || k === 'then') return undefined;
            return (...a) => { stubs.log('api', k, 'call', a); return undefined; };
        }
    });

    const nc = env.nc = makeEmitter(env, 'nc', true);
    const fallback = (obj, name, skip) => new Proxy(obj, {
        get(t, k) {
            if (k in t) return t[k];
            if (typeof k !== 'string' || k === 'then' || k === 'toJSON' || (skip && skip.includes(k))) return undefined;
            return (t[k] = stubs.deepStub(name + '.' + k));
        }
    });
    const Common = {
        NotificationCenter: nc, Gateway: makeEmitter(env, 'gateway', false), Views: {}, Controllers: {}, Collections: {},
        UI: {isRTL: () => false, Themes: {isDarkTheme: () => false, currentThemeId: () => 'theme-light', on() {}, off() {}}, Menu: {Manager: {hideAll() {}}}, LayoutManager: {isElementVisible: () => true}},
        Utils: {
            isMac: true, isIE: false, isSafari: false, isChrome: true, isGecko: false, isIE11: false, isEdge: false, isOpera: false,
            documentSettingsType: {Paragraph: 0, Table: 1, Header: 2, TextArt: 3, Shape: 4, Image: 5, Slide: 6, Chart: 7, MailMerge: 8, Signature: 9},
            String: {format: (s, ...a) => String(s).replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m)), htmlEncode: escText, htmlDecode: s => s, platformKey: (k, s) => (s === undefined ? '' : s)},
            InternalSettings: (() => { const m = new Map(); return {get: k => m.get(k), set: (k, v) => m.set(k, v)}; })(),
            ModalWindow: {isVisible: () => false, show() {}, close() {}},
            isRTL: () => false, getConfigObject: () => ({}), applyCustomization() {}, innerWidth: () => env.W, innerHeight: () => 800
        },
        localStorage: (() => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), getBool: (k, d) => (m.has(k) ? m.get(k) === 'true' || m.get(k) === '1' : !!d), setBool: (k, v) => m.set(k, v ? 'true' : 'false'), itemExists: k => m.has(k), getKeysFilter: () => '', setKeysFilter() {}, save() {}}; })(),
        Locale: {get: (k, scope) => env.ru[(scope && scope.name ? scope.name + '.' : '') + k] || (scope && scope.default) || '', getCurrentLanguage: () => 'ru', isCurrentLanguageRtl: () => false, apply() {}}
    };
    const PE = {Views: {}, Controllers: {}, Collections: {}, Models: {}};
    ctx.Common = Common;
    ctx.PE = PE;
    ctx.Asc = {c_oAscTypeSelectElement: {Paragraph: 0, Table: 1, Image: 2, Header: 3, Hyperlink: 4, SpellCheck: 5, Shape: 6, Slide: 7, Chart: 8, Math: 9, MailMerge: 10, ContentControl: 11, Animation: 12},
        vertalign_Baseline: 0, vertalign_SubScript: 1, vertalign_SuperScript: 2, c_oAscZoomType: {Current: 0, FitWidth: 1, FitPage: 2},
        c_oAscRestrictionType: {None: 0, OnlyForms: 1, OnlyComments: 2, OnlySignatures: 4, View: 128}};
    ctx.AscCommon = {align_Right: 0, align_Left: 1, align_Center: 2, align_Justify: 3};

    /* The locale goes the same way as stock: the key "A.B.C.d" is written into the object by path. */
    for (const [k, v] of Object.entries(env.ru)) {
        const p = k.split('.');
        if (p.length <= 2) continue;
        let o = ctx;
        for (let i = 0; i < p.length - 1; i++) { if (o[p[i]] === undefined) o[p[i]] = {}; o = o[p[i]]; }
        o[p[p.length - 1]] = v;
    }
    for (const name of Object.keys(PE.Views)) {
        if (OWN.includes(name)) continue;
        const texts = PE.Views[name];
        const F = function () {};
        Object.assign(F, texts);
        F.prototype = Object.assign({}, texts);
        PE.Views[name] = F;
    }
    env.localeTexts = Object.create(null);
    for (const name of OWN) if (PE.Views[name] && typeof PE.Views[name] === 'object') env.localeTexts[name] = Object.assign({}, PE.Views[name]);
    PE.getController = n => stubs.stockController(n);
    PE.getCollection = n => stubs.deepStub('Collection:' + n);
    PE.getApplication = () => ({getController: n => stubs.stockController(n)});
    env.PE = PE;

    /* Neighboring shell modules are stubs of the declared interface. */
    const own = (name, base) => {
        const texts = PE.Views[name] && typeof PE.Views[name] === 'object' ? PE.Views[name] : {};
        const obj = Object.assign({}, texts, base);
        return new Proxy(obj, {
            get(t, k) {
                if (k in t) return t[k];
                if (typeof k !== 'string' || k === 'then' || k === 'toJSON') return undefined;
                return (...a) => { stubs.log('own', name, k, a); return undefined; };
            }
        });
    };
    const commandOwner = name => function (...a) { stubs.log('owner', name, 'run', a); };
    ['objectProperties', 'search', 'searchBar', 'focus', 'slideSection', 'addComment', 'chat', 'hideToolbar'].forEach(n => { env.registry[n] = commandOwner(n); });
    env.defaultOwners = Object.assign({}, env.registry);
    const shell = own('CompactShell', {
        api: env.api,
        wanted: () => true, editRight: () => true, hasToolbar: () => true, canAddComment: () => true, isReady: () => true,
        guarded(labelText, fn) {
            if (typeof labelText === 'function') fn = labelText;
            return function (...a) { try { return fn.apply(this, a); } catch (e) { env.errors.push(e); return undefined; } };
        },
        onApi(name, fn) { env.api.asc_registerCallback(name, shell.guarded(name, fn)); },
        command(name, fn) {
            if (typeof fn === 'function') { env.registry[name] = fn; return fn; }
            if (env.clickDepth > 0) stubs.log('command', name, 'lookup', []);
            return function (...a) {
                stubs.log('command', name, 'run', a);
                const owner = env.registry[name];
                return owner ? owner.apply(this, a) : undefined;
            };
        },
        closeSurfaces($el) {
            const tb = PE.Views.CompactToolbar;
            if (tb && typeof tb.closePopovers === 'function') tb.closePopovers($el);
        },
        stockLeftBtn: n => stubs.twin('LeftMenu:btn' + String(n)[0].toUpperCase() + String(n).slice(1)),
        toggleFocus() { shell.command('focus')(); },
        setRow() {}, isFocus: () => false, booted: true
    });
    const bridge = own('StockBridge', {
        twin: ref => stubs.twin(ref),
        state(ref) { const t = stubs.twin(ref); return {exists: true, disabled: !!t.disabled, pressed: !!t.pressed, visible: t.visible !== false}; },
        run(ref, o) {
            stubs.log('bridge', ref, 'run', o && o.event ? [o.event].concat(o.args || []) : []);
            const t = stubs.twin(ref);
            if (t.disabled) return false;
            if (o && o.event) t.trigger(o.event, t, ...(o.args || [])); else t.click();
            return true;
        },
        watch(ref, cb) { (env.watchers[ref] = env.watchers[ref] || []).push(cb); },
        mirror(ref) {
            stubs.log('bridge', ref, 'mirror', []);
            return stubs.twin(ref).menu.items.map(it => ({id: it.value || it.options.id, caption: it.caption, disabled: false, checked: false, sep: !!it.options.sep, sub: null}));
        },
        pick(ref, id) { stubs.log('bridge', ref, 'pick', [id]); return true; },
        gallery(ref, ...a) { stubs.log('bridge', ref, 'gallery', a); return stubs.deepStub('gallery:' + ref); },
        tiles(ref) { stubs.log('bridge', ref, 'tiles', []); return []; },
        engine(name, ...a) { stubs.log('bridge', name, 'engine', a); return undefined; },
        install() {}
    });
    env.watchers = Object.create(null);
    const selection = own('SlideSelection', {kind: () => env.kind, props: () => ({}), install() {}});
    const modes = own('CompactModes', {mode: () => 'edit', reason: () => null, setMode() {}, install() {}});
    /* Icons are the shared editor set (Common.UI.Compact.Icons): the replacement draws the icon name into data-icon. */
    const icons = own('Icons', {svg: name => `<i class="${ICON_CLASS}" data-icon="${escAttr(name)}"></i>`});
    Common.UI.Compact = {Icons: icons};
    const others = {};
    ['SlideActions', 'SlideSections', 'CompactStatus', 'CompactWindows'].forEach(n => { others[n] = own(n, {install() {}}); });
    /* The right to the left area panel is a stock condition for the comments button
       (controller/LeftMenu.js, createDelayedElements) by the environment appOptions. */
    others.CompactLeft = own('CompactLeft', {
        install() {},
        can(name) {
            const o = env.appOptions;
            return name !== 'comments' || !!(o.canCoAuthoring && o.canViewComments && !o.isLightVersion);
        }
    });
    Object.assign(PE.Views, {CompactShell: shell, StockBridge: bridge, SlideSelection: selection, CompactModes: modes}, others);
    if (!PE.Views.CompactToolbar || typeof PE.Views.CompactToolbar !== 'object') delete PE.Views.CompactToolbar;
    env.shell = shell;
    env.bridge = bridge;
    PE.Views = fallback(PE.Views, 'PE.Views', OWN);
    ctx.Common = fallback(Common, 'Common');
    Common.UI = fallback(Common.UI, 'Common.UI');
    Common.Utils = fallback(Common.Utils, 'Common.Utils');
    ctx.Asc = fallback(ctx.Asc, 'Asc');
    ctx.AscCommon = fallback(ctx.AscCommon, 'AscCommon');

    const resolveDep = d => {
        const base = String(d).split('/').pop().replace(/\.js$/, '');
        if (/^text!/.test(String(d))) return '';
        if (base === 'jquery') return $;
        if (base === 'underscore') return ctx._;
        if (base === 'backbone') return ctx.Backbone;
        if (OWN.includes(base)) return PE.Views[base];
        return stubs.deepStub('dep:' + base);
    };
    ctx.define = function (a, b, c) {
        let deps = [], factory;
        if (typeof a === 'function') factory = a;
        else if (Array.isArray(a)) { deps = a; factory = b; } else { deps = Array.isArray(b) ? b : []; factory = Array.isArray(b) ? c : b; }
        if (typeof factory !== 'function') return undefined;
        return factory.apply(ctx, deps.map(resolveDep));
    };
    ctx.require = function (deps, cb) {
        if (typeof deps === 'string') return resolveDep(deps);
        const mods = (deps || []).map(resolveDep);
        if (typeof cb === 'function') cb.apply(ctx, mods);
        return undefined;
    };

    /* ---------- test actions */
    env.load = name => {
        const file = path.join(env.viewDir, name + '.js');
        if (!fs.existsSync(file)) throw new Error(`нет модуля ${rel(file)} (PE.Views.${name})`);
        /* Before loading, in the module's place there are only its locale strings, as in the editor. */
        if (env.localeTexts[name]) PE.Views[name] = Object.assign({}, env.localeTexts[name]); else delete PE.Views[name];
        vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file});
        const mod = PE.Views[name];
        if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) throw new Error(`${rel(file)} не объявил PE.Views.${name}`);
        return mod;
    };
    env.flush = async () => {
        for (let round = 0; round < 8; round++) {
            let n = 0;
            while (env.timers.length && n < 400) {
                let k = 0;
                for (let i = 1; i < env.timers.length; i++) if (env.timers[i].ms < env.timers[k].ms) k = i;
                const t = env.timers.splice(k, 1)[0];
                n++;
                try { t.fn(); } catch (e) { env.errors.push(e); }
                if (t.interval && ++t.runs < 3) env.timers.push(t);
            }
            await new Promise(r => setImmediate(r));
            if (!env.timers.length) break;
        }
    };
    env.toolbar = () => PE.Views.CompactToolbar;
    env.relayout = async () => {
        const tb = env.toolbar();
        doc.version++;
        env.ros.forEach(ro => ro.targets.length && ro.cb(ro.targets.map(t => ({target: t, contentRect: {width: env.layout.boxWidth(t), height: 32}})), ro));
        dispatch(env.winTarget, makeEvent('resize', {bubbles: false}));
        await env.flush();
        if (tb && typeof tb.relayout === 'function') { try { tb.relayout(); } catch (e) { env.errors.push(e); } }
        await env.flush();
    };
    env.setWidth = async W => { env.W = W; await env.relayout(); };
    env.setKind = async kind => {
        env.kind = kind;
        nc.trigger('vo:selection', {kind, props: stubs.deepStub('props.' + kind)});
        (callbacks.asc_onFocusObject || []).slice().forEach(f => { try { f(focusObjects()); } catch (e) { env.errors.push(e); } });
        await env.flush();
        await env.relayout();
    };
    env.fire = async (name, ...args) => {
        (callbacks[name] || []).slice().forEach(f => { try { f(...args); } catch (e) { env.errors.push(e); } });
        await env.flush();
    };
    env.setTwin = async (ref, patch) => {
        const t = stubs.twin(ref);
        Object.keys(patch).forEach(k => { if (k === 'pressed' && t.pressed !== !!patch.pressed) t.toggle(!!patch.pressed, true); else t[k] = patch[k]; });
        if ('pressed' in patch) t.emit('toggle', t, !!patch.pressed);
        (env.watchers[ref] || []).slice().forEach(cb => { try { cb(env.bridge.state(ref), ref); } catch (e) { env.errors.push(e); } });
        await env.flush();
    };
    env.mount = async () => {
        const tb = env.load('CompactToolbar');
        if (typeof tb.install === 'function') { try { tb.install(shell); } catch (e) { env.errors.push(e); } }
        await env.flush();
        if (!env.host.firstElementChild) {
            if (typeof tb.render !== 'function') throw new Error('у PE.Views.CompactToolbar нет render(host)');
            tb.render($(env.host));
            await env.flush();
        }
        env.card = env.host.firstElementChild;
        if (!env.card) throw new Error('render(host) не построил карточку панели в #vo-toolbar');
        await env.setKind(env.kind);
        return env;
    };
    env.click = async el => {
        env.clickDepth++;
        try {
            for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) dispatch(el, makeEvent(t));
            if (!el.hasAttribute('disabled')) dispatch(el, makeEvent('click'));
        } finally { env.clickDepth--; }
        await env.flush();
    };
    env.clickOutside = async () => {
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) dispatch(env.document.getElementById('editor_sdk'), makeEvent(t));
        await env.flush();
    };
    env.capture = async fn => {
        const start = env.log.length;
        await fn();
        return env.log.slice(start);
    };

    /* ---------- reading the DOM */
    const L = env.layout;
    env.shown = el => !!el && L.shown(el);
    env.width = el => L.widthOf(el);
    env.names = el => {
        const out = [];
        for (const a of ['aria-label', 'title', 'data-title']) { const v = el.getAttribute(a); if (v) out.push(v); }
        const t = L.visibleText(el);
        if (t) out.push(t);
        return out.map(s => s.replace(/[\s ]+/g, ' ').replace(/\s*▾\s*$/, '').trim()).filter(Boolean);
    };
    env.text = el => L.visibleText(el).replace(/[\s\u00a0]+/g, ' ').trim();
    env.idOf = el => {
        const names = env.names(el);
        for (const [id, re] of CONTROLS) if (names.some(n => re.test(n))) return id;
        return '?' + (names[0] || el.localName);
    };
    env.end = () => doc.getElementById('vo-tb-end');
    env.more = () => doc.getElementById('vo-tb-more');
    env.moreToggle = () => {
        const m = env.more();
        if (!m) return null;
        if (interactive(m)) return m;
        return descendants(m).find(d => interactive(d) && !popupAncestor(d, m)) || null;
    };
    const popupAncestor = (el, stop) => { for (let p = el.parentNode; p && p !== stop && p.nodeType === 1; p = p.parentNode) if (popupLike(p)) return true; return false; };
    const topInteractive = (el, root) => { for (let p = el.parentNode; p && p !== root && p.nodeType === 1; p = p.parentNode) if (interactive(p)) return false; return true; };
    env.controls = (scope, opts) => {
        const root = scope || doc;
        const end = env.end(), more = env.more(), toggle = env.moreToggle();
        return descendants(root).filter(el => interactive(el) && topInteractive(el, root) && L.shown(el)
            && !(opts && opts.row && ((end && end.contains(el)) || (more && more.contains(el)) || el === toggle || env.idOf(el) === 'more')));
    };
    env.rowEls = () => (env.card ? env.controls(env.card, {row: true}) : []);
    const dedupe = ids => ids.filter((id, i) => id !== ids[i - 1]);
    env.rowIds = () => dedupe(env.rowEls().map(env.idOf));
    env.find = (id, scope) => env.controls(scope).find(el => env.idOf(el) === id) || null;
    env.moreShown = () => { const t = env.moreToggle(); return !!t && L.shown(t); };
    env.openMore = async () => {
        const before = new Set(env.controls());
        const t = env.moreToggle();
        if (!t || !L.shown(t)) return [];
        await env.click(t);
        return env.controls().filter(el => !before.has(el) && el !== t);
    };
    env.contentWidth = () => L.contentWidth(env.card);
    env.rect = el => L.rect(el);
    env.pressed = el => el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true'
        || ['on', 'active', 'pressed', 'checked', 'vo-on', 'is-active', 'selected'].some(c => el.classList.contains(c));
    env.iconNames = el => descendants(el).filter(d => d.classList.contains(ICON_CLASS) && L.shownSelf(d)).map(d => d.getAttribute('data-icon'));
    env.cssValue = (el, prop) => L.cascade(el, prop);
    env.atRightEdge = el => {
        for (let n = el; n && n !== env.card.parentNode; n = n.parentNode) {
            if (L.marginLeftAuto(n)) return true;
            const pos = L.cascade(n, 'position');
            if ((pos === 'absolute' || pos === 'fixed') && /^0(px)?$/.test(L.cascade(n, 'right'))) return true;
            const p = n.parentNode;
            if (p && p.nodeType === 1) {
                const jc = L.cascade(p, 'justify-content');
                const last = p.children.filter(c => L.shownSelf(c) && !L.outOfFlow(c)).pop() === n;
                if (last && /space-between|flex-end|^end|right/.test(jc)) return true;
            }
        }
        const r = L.rect(el);
        return r.width > 0 && r.right === env.W;
    };
    env.background = el => {
        const v = L.cascade(el, 'background-color') || L.cascade(el, 'background');
        return v || '';
    };
    env.fieldBackground = el => {
        for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
            const v = env.background(p);
            const c = parseColor(v);
            if (c && c[3] > 0) return v;
        }
        return '';
    };
    env.errorsText = () => env.errors.slice(0, 3).map(e => (e && e.message) || String(e)).join(' | ');
    return env;
}

function parseColor(v) {
    if (!v) return null;
    const s = String(v).trim().toLowerCase();
    if (/(^|\s)(transparent|none)(\s|$)/.test(s) && !/#|rgb|white/.test(s)) return [0, 0, 0, 0];
    let m = /#([0-9a-f]{3,8})\b/.exec(s);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(s);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4])];
    if (/(^|\s)white(\s|$)/.test(s)) return [255, 255, 255, 1];
    return null;
}
/* White, including the translucent white of the compact card over the gray field. */
const isWhite = v => { const c = parseColor(v); return !!c && c[3] >= 0.85 && c[0] === 255 && c[1] === 255 && c[2] === 255; };
const isLightGrey = v => {
    const c = parseColor(v);
    if (!c || c[3] < 0.99 || isWhite(v)) return false;
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    return mn >= 200 && mx - mn <= 24;
};

/* ------------------------------------------------------------------ run */

const tests = [];
let lastEnv = null;
function test(name, fn) { tests.push({name, fn}); }
async function mount(options) {
    const env = createEnv(options);
    lastEnv = env;
    await env.mount();
    return env;
}
function fresh(options) { const env = createEnv(options); lastEnv = env; return env; }
async function run() {
    const i = process.argv.indexOf('--only');
    const only = i >= 0 ? process.argv[i + 1] : null;
    let failed = 0;
    if (only && !tests.some(t => t.name === only)) { console.log(`FAIL ${only}: нет такого теста в файле`); process.exitCode = 1; return; }
    for (const t of tests) {
        if (only && t.name !== only) continue;
        lastEnv = null;
        try {
            await t.fn();
            console.log(`ok ${t.name}`);
        } catch (e) {
            failed++;
            let msg = (e && e.message ? e.message : String(e)).split('\n')[0];
            if (lastEnv && lastEnv.errors.length) msg += `; ошибки модуля: ${lastEnv.errorsText()}`;
            console.log(`FAIL ${t.name}: ${msg}`);
        }
    }
    process.exitCode = failed ? 1 : 0;
}

/* Subsequence order: all expected ones occur in this order. */
function inOrder(list, expected) {
    let k = 0;
    for (const x of list) if (x === expected[k]) k++;
    return k === expected.length;
}

module.exports = {test, run, mount, fresh, createEnv, inOrder, isWhite, isLightGrey, parseColor, CONTROLS, ROOT, rel};

if (require.main === module) process.exitCode = 0;
