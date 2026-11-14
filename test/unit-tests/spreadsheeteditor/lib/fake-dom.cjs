/* Fake DOM of the spreadsheet editor tests for the shared menu row (Common.UI.Compact.MenuBar).
 * The shell tests load its modules in node via vm on top of their own fake DOM; the menu row
 * of the shared layer reads from nodes what their own row did not need: visibility (getClientRects -
 * the node is in the document and neither it nor an ancestor is hidden by display: none or hidden), isConnected, closest,
 * siblings and children (childNodes, nextSibling, firstElementChild), focus (focus, blur,
 * document.activeElement, focusin and focusout with bubbling). patch(El, {matches, replaceClosest})
 * adds what is missing to the node class and leaves the class's own members alone; closest works via
 * the file's matches (replaceClosest replaces its stub); capture - capture on nodes; hidden(node) - the node is hidden by styles
 * (rules that the fake DOM does not have). focusIn - focus to a node plus focus events, as in the browser.
 */

function bubble(node, type, init) {
    const ev = Object.assign({type, target: node, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }}, init || {});
    for (let n = node; n && !ev.propagationStopped; n = n.parentNode) {
        const list = n.listeners && n.listeners[type];
        if (list) list.slice().forEach(fn => fn.call(n, ev));
    }
    return ev;
}

function focusIn(el) {
    const doc = el.ownerDocument;
    const prev = doc.activeElement || null;
    if (prev === el) return;
    doc.activeElement = el;
    if (prev && prev !== doc.body && prev.nodeType === 1) bubble(prev, 'focusout', {relatedTarget: el});
    bubble(el, 'focusin', {relatedTarget: prev && prev !== doc.body ? prev : null});
}

function patch(El, opts = {}) {
    const P = El.prototype;
    const has = name => {
        for (let o = P; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
            if (Object.getOwnPropertyDescriptor(o, name)) return true;
        }
        return false;
    };
    const def = (name, desc, force) => {
        if (has(name) && !force) return;
        /* The methods are writable: a test can replace them on a node. */
        Object.defineProperty(P, name, Object.assign({configurable: true}, 'value' in desc ? {writable: true} : {}, desc));
    };
    def('isConnected', {get() {
        const root = this.ownerDocument && this.ownerDocument.documentElement;
        for (let n = this; n; n = n.parentNode) if (n === root) return true;
        return false;
    }});
    def('getClientRects', {value() {
        if (!this.isConnected) return [];
        for (let n = this; n && n.nodeType === 1; n = n.parentNode) {
            if (n.hidden === true || (n.style && n.style.display === 'none')) return [];
            if (opts.hidden && opts.hidden(n)) return [];
        }
        return [this.getBoundingClientRect ? this.getBoundingClientRect() : {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}];
    }});
    if (opts.matches) {
        def('closest', {value(sel) {
            for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (opts.matches(n, sel)) return n;
            return null;
        }}, !!opts.replaceClosest);
    }
    def('contains', {value(n) {
        for (; n; n = n.parentNode) if (n === this) return true;
        return false;
    }});
    def('childNodes', {get() { return this.children; }});
    def('nextSibling', {get() {
        const p = this.parentNode;
        if (!p || !p.children) return null;
        return p.children[p.children.indexOf(this) + 1] || null;
    }});
    def('firstElementChild', {get() { return this.children[0] || null; }});
    def('parentElement', {get() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }});
    /* Layout metrics are 0 until a test sets its own value on the node. */
    ['clientTop', 'offsetTop', 'clientWidth', 'scrollWidth', 'scrollHeight', 'clientHeight'].forEach(k => def(k, {
        get() { return this['_' + k] || 0; },
        set(v) { this['_' + k] = v; }
    }));
    def('focus', {value() { focusIn(this); }});
    def('blur', {value() {
        const doc = this.ownerDocument;
        if (doc.activeElement !== this) return;
        doc.activeElement = doc.body;
        bubble(this, 'focusout', {relatedTarget: null});
    }});
    /* Capture on nodes (addEventListener with capture): the capture listeners of the ancestors and of the node itself run before
       its event, as in the browser; stopping at capture means the event goes no further. The shell menu row
       listens to its clicks this way (other surfaces are closed before its action). */
    if (opts.capture && !P._captureWired) {
        const add = P.addEventListener, remove = P.removeEventListener, dispatch = P.dispatch;
        P._captureWired = true;
        P.addEventListener = function (t, fn, o) {
            if (o === true || (o && o.capture)) {
                const c = this._capture || (this._capture = {});
                (c[t] = c[t] || []).push(fn);
                return undefined;
            }
            return add.call(this, t, fn, o);
        };
        P.removeEventListener = function (t, fn, o) {
            const c = this._capture && this._capture[t];
            const i = c ? c.indexOf(fn) : -1;
            if (i >= 0) { c.splice(i, 1); return undefined; }
            return remove.call(this, t, fn, o);
        };
        P.dispatch = function (type, extra) {
            const path = [];
            for (let n = this; n && n.nodeType === 1; n = n.parentNode) path.unshift(n);
            const ev = Object.assign({type, target: this, defaultPrevented: false, propagationStopped: false,
                preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }}, extra || {});
            for (const n of path) {
                const list = n._capture && n._capture[type];
                if (list) list.slice().forEach(fn => fn.call(n, ev));
                if (ev.propagationStopped) return ev;
            }
            return dispatch.call(this, type, extra);
        };
    }
    return El;
}

module.exports = {patch, bubble, focusIn};
