/* Run: node test/unit-tests/spreadsheeteditor/formula-bar.cjs [path to FormulaBar.js] [path to compact-shell.less]
 * The formula bar in the compact: collapsed at the start, the expanded state does not survive the
 * session, the height snaps to whole field lines, the expansion is standard and smooth
 *: the row and the grid move with one transition, the canvas layout runs once per transition.
 * The stock is real: the CellEditor controller methods, Viewport.getCelleditorResizeOptions and
 * Common.localStorage are loaded from the stock files; only the DOM nodes of the bar and its
 * layout neighbors (the edge, the grid area), the notification bus with a double subscriber of the
 * standard Viewport.onLayoutChanged (doLayout + asc_Resize), timers, the "reduce motion"
 * preference and computed styles (the row and the field line: compact 32/20, stock 20/18) are faked.
 * A click on the expand button goes as in the browser: interception on window, then the standard
 * button handler (CellEditor.expandEditorField), then bubbling up to window.
 * The CSS transitions (row height, neighbor shift) are modeled per the CSS Transitions specification
 * (transitionOf below): in the middle of a transition the stock, the layout and getBoundingClientRect read
 * the intermediate height, removing the class does not interrupt a running transition - as in the browser.
 * The look of the formula bar and the sheet row is checked in
 * real headless Chrome on the built spreadsheet editor app.less (the section at the end of the file).
 * The optional arguments are broken copies of the module and styles for the negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const APP = path.join(ROOT, 'apps/spreadsheeteditor/main/app');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(APP, 'view/FormulaBar.js');
const lessFile = process.argv[3] ? path.resolve(process.argv[3])
    : path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/compact-shell.less');

/* The metrics the stock reads from styles: --celleditor-height (= the bar min-height) and
   --celleditor-line-height. In the compact they are set by compact-shell.less under body.vo-compact. Here are the model numbers: row 32 and line 20
   (in the compact styles the row is 36): snapping and expansion are counted from these numbers, not from one height, and the checks below are written for
   them. */
const METRICS = {compact: {h: 32, lh: 20}, stock: {h: 20, lh: 18}};
const BORDER = 1;
/* The rest gap "grid top − row bottom": the .layout-resizer edge between them. */
const GAP = 4;

function classes(initial) {
    const set = new Set(initial || []);
    return {
        set,
        hasClass: c => set.has(c),
        addClass(c) { set.add(c); return this; },
        removeClass(c) { set.delete(c); return this; }
    };
}

/* A DOM node with classList, inline style and listeners - for the bar and its neighbors. */
function node(id, set) {
    const listeners = {};
    const el = {
        id, nodeType: 1, style: {transform: ''}, parentNode: null,
        classList: {add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c)},
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        removeEventListener: (t, fn) => { const a = listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        fire: (t, props) => (listeners[t] || []).slice().forEach(fn => fn(Object.assign({type: t, target: el}, props))),
        listeners: t => (listeners[t] || []).length,
        closest: () => null
    };
    return el;
}

function makeEnv(stored, opts) {
    opts = opts || {};
    const store = new Map(Object.entries(stored || {}));
    const bodyClasses = new Set(['vo-compact']);
    const metrics = () => METRICS[bodyClasses.has('vo-compact') ? 'compact' : 'stock'];
    const winListeners = {capture: {}, bubble: {}};
    const notes = [];
    const created = [];
    const motion = {reduce: !!opts.reduce};
    const timers = [];
    let timerId = 0;
    const counts = {doLayout: 0, resize: 0};
    /* The transition events that the browser will dispatch later, in a frame (frame()). */
    const queued = [];
    /* The row height read by the last layout: the grid is laid out for it. */
    let laid = null;

    /* The #cell-editing-box node: border-box, min-height = the row, bottom border 1px.
       jQuery height() reads and writes the content height, without the border; the inline
       height style.height is the full box height (this is how jQuery writes it). What it reads is
       what is shown (in the middle of a transition - intermediate), what it writes is the value by style. */
    const rowClasses = new Set(['layout-item']);
    const $el = Object.assign(classes(), {
        set: rowClasses,
        hasClass: c => rowClasses.has(c),
        addClass(c) { rowClasses.add(c); return this; },
        removeClass(c) { rowClasses.delete(c); return this; },
        inlineTotal: 18 + BORDER,
        /* The box height by style - final, where the row will arrive. */
        spec() { return Math.max(this.inlineTotal, metrics().h); },
        /* The height seen by the browser, jQuery and the layout - after the style recalculation. */
        totalHeight() { flushAll(); return rowT.value(); },
        height(v) {
            if (v === undefined) return this.totalHeight() - BORDER;
            this.inlineTotal = v + BORDER;
            return this;
        },
        css(prop, v) {
            if (v !== undefined) { if (prop === 'height') this.inlineTotal = parseFloat(v); return this; }
            if (prop === 'min-height') return metrics().h + 'px';
            if (prop === 'border-bottom-width') return BORDER + 'px';
            return '';
        }
    });
    const row = node('cell-editing-box', rowClasses);
    const writes = {row: [], sdk: [], resizer: []};
    Object.defineProperty(row.style, 'height', {
        get: () => $el.inlineTotal + 'px',
        set: v => { writes.row.push(String(v)); $el.inlineTotal = parseFloat(v); },
        enumerable: true
    });
    let flushes = 0;
    Object.defineProperty(row, 'offsetHeight', {get: () => { flushes++; return $el.totalHeight(); }});
    row.getBoundingClientRect = () => { const h = $el.totalHeight(); return {top: 0, height: h, bottom: h}; };
    $el[0] = row;
    const resizer = node(null, new Set(['layout-resizer', 'after']));
    const sdk = node('editor_sdk', new Set(['layout-item']));
    [['sdk', sdk], ['resizer', resizer]].forEach(([k, n]) => {
        let t = '';
        Object.defineProperty(n.style, 'transform', {get: () => t, set: v => { writes[k].push(String(v)); t = String(v); }, enumerable: true});
    });
    /* Nodes that can stand in a parent: the layout column (the bar, the edge, the grid) and the shell
       card. insertBefore / appendChild / removeChild - as in the DOM: a node leaves its previous
       parent. */
    const container = id => {
        const c = {id, children: []};
        c.removeChild = n => { const i = c.children.indexOf(n); if (i >= 0) c.children.splice(i, 1); n.parentNode = null; return n; };
        c.insertBefore = (n, ref) => {
            if (n.parentNode) n.parentNode.removeChild(n);
            const i = ref ? c.children.indexOf(ref) : -1;
            c.children.splice(i < 0 ? c.children.length : i, 0, n);
            n.parentNode = c;
            return n;
        };
        c.appendChild = n => c.insertBefore(n, null);
        return c;
    };
    const parent = container('column');
    [row, resizer, sdk].forEach(n => parent.appendChild(n));
    /* The shell card (#vo-plate): the panel row is already in it. */
    const plate = container('vo-plate');
    plate.appendChild(node('vo-tb', new Set()));
    sdk.getBoundingClientRect = () => ({top: 0, height: 600, bottom: 600});

    /* CSS transitions per the CSS Transitions specification - exactly as far as the module is affected by them. The value by style (read) against the shown one (shown); the style is recalculated on
       reading the layout (flushAll), as in the browser. A transition starts when the value
       changed with a duration > 0 (the transition class, without "reduce motion"). A running
       transition goes on if its end is the same - however the class and the duration changed
       (at rest nodes have `all 0s`, the property is in the list); it is interrupted only by
       transition-property: none (inline `transition: none`) or a new value with a zero
       duration. An interruption is a transitioncancel event that the browser will dispatch later, in a frame
       (frame()). Time is a fraction of the path for all running transitions (advance), the end is transitionEnd(). */
    function transitionOf(el, prop, cls, read) {
        const t = {el, prop, shown: null, run: null};
        t.duration = () => /(^|[\s,])none([\s,]|$)/.test(el.style.transition || '') ? null
            : el.classList.contains(cls) && !motion.reduce ? 0.3 : 0;
        t.value = () => t.run ? t.run.from + (t.run.to - t.run.from) * t.run.frac : t.shown;
        t.cancel = () => {
            if (!t.run) return;
            queued.push({el, type: 'transitioncancel', propertyName: prop});
            t.shown = t.value();
            t.run = null;
        };
        t.flush = () => {
            const spec = read(), dur = t.duration();
            if (t.shown === null) { t.shown = spec; return; }
            if (t.run) {
                if (dur === null) { t.cancel(); t.shown = spec; return; }
                if (spec === t.run.to) return;
                const cur = t.value();
                t.cancel();
                if (dur > 0) t.run = {from: cur, to: spec, frac: 0};
                else t.shown = spec;
                return;
            }
            if (spec !== t.shown) {
                if (dur > 0) t.run = {from: t.shown, to: spec, frac: 0};
                else t.shown = spec;
            }
        };
        t.complete = () => { if (!t.run) return false; t.shown = t.run.to; t.run = null; return true; };
        return t;
    }
    const shiftOf = n => () => { const m = /translateY\((-?[\d.e+-]+)px\)/.exec(n.style.transform || ''); return m ? parseFloat(m[1]) : 0; };
    const rowT = transitionOf(row, 'height', 'vo-ce-anim', () => $el.spec());
    const sdkT = transitionOf(sdk, 'transform', 'vo-ce-follow', shiftOf(sdk));
    const rzT = transitionOf(resizer, 'transform', 'vo-ce-follow', shiftOf(resizer));
    const TRANSITIONS = [['row', rowT], ['sdk', sdkT], ['resizer', rzT]];
    function flushAll() { TRANSITIONS.forEach(([, t]) => t.flush()); }
    /* Web Animations: the running row transitions (the module sees them, telling its own interruption from a foreign one). */
    row.getAnimations = () => { flushAll(); return rowT.run ? [{transitionProperty: 'height', playState: 'running'}] : []; };
    /* The expand button: closest('#ce-btn-expand') answers with itself. */
    const button = node('ce-btn-expand', new Set(['btn']));
    button.closest = sel => sel === '#ce-btn-expand' ? button : null;
    const caret = node(null, new Set(['caret']));
    caret.closest = sel => sel === '#ce-btn-expand' ? button : null;

    /* The formula bar field #ce-cell-content is a standard textarea, white-space: pre-wrap: long text
       wraps, a line break is a new line. The field height is the row height without the bottom border (on
       screen, in the middle of a transition - intermediate); the content is paddings and lines field lines; scrollHeight,
       as in the browser, is no less than the box itself. wide - the text is wider than the field (scrollWidth). The paddings are such
       that one line fills the collapsed row entirely: row 32 − border 1 = 6 + 20 + 5. */
    const TA = {pt: 6, pb: 5};
    const field = {lines: 1, wide: false};
    /* The bar was hidden by the standard "View → Formula bar" (display: none on the row) - the field has no box, all sizes are 0. */
    const hidden = () => row.style.display === 'none';
    const ta = {
        id: 'ce-cell-content', nodeType: 1,
        get clientHeight() { return hidden() ? 0 : $el.totalHeight() - BORDER; },
        get scrollHeight() { return hidden() ? 0 : Math.max(TA.pt + TA.pb + field.lines * metrics().lh, this.clientHeight); },
        get clientWidth() { return 1000; },
        get scrollWidth() { return field.wide ? 1300 : 1000; }
    };

    const editor = {$el, $btnexpand: classes(['btn']), $cellcontent: {0: ta, length: 1}, keep_height: 74, cellEditorTextChange() {}};

    /* The engine: asc_* callbacks (asc_registerCallback collects subscribers, as the standard api does). */
    const apiSubs = {};
    const api = {
        isCellEdited: false,
        asc_registerCallback: (n, fn) => { (apiSubs[n] = apiSubs[n] || []).push(fn); },
        asc_unregisterCallback: (n, fn) => { const a = apiSubs[n] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        fire: (n, ...args) => (apiSubs[n] || []).slice().forEach(fn => fn(...args)),
        subs: n => (apiSubs[n] || []).length
    };
    const EDIT_STATE = {editEnd: 0, editStart: 1, editEmptyCell: 2, editText: 3, editFormula: 4, editInFormulaBar: 5, editInCell: 6};

    /* The notification bus: trigger is on the prototype, as in Common.NotificationCenter. */
    function Bus() { this.subs = {}; }
    Bus.prototype.on = function (n, fn) { (this.subs[n] = this.subs[n] || []).push(fn); return this; };
    Bus.prototype.off = function (n, fn) { const a = this.subs[n] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); return this; };
    Bus.prototype.trigger = function (n, ...args) { notes.push([n, ...args]); (this.subs[n] || []).slice().forEach(fn => fn(...args)); return this; };
    const bus = new Bus();
    /* A double of the standard Viewport.onLayoutChanged: layout and asc_Resize on any event. */
    const layoutLog = [];
    bus.on('layout:changed', area => {
        counts.doLayout++; counts.resize++;
        laid = $el.totalHeight();                       // Layout.getElementHeight: css('height') - the shown one
        layoutLog.push({area, rowTotal: laid, animating: rowClasses.has('vo-ce-anim')});
    });

    const calls = {expand: 0, change: 0};
    const context = {
        console,
        document: {
            body: {classList: {contains: c => bodyClasses.has(c), add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c)}},
            createElement(tag) {
                created.push(tag);
                const el = node(null, new Set());
                el.tag = tag;
                el.className = '';
                el.attrs = {};
                el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
                return el;
            },
            getElementById: id => id === 'editor_sdk' ? sdk : null
        },
        localStorage: {
            setItem: (k, v) => store.set(k, String(v)),
            getItem: k => store.has(k) ? store.get(k) : null,
            removeItem: k => store.delete(k)
        },
        getComputedStyle: el => {
            /* Reading computed is a style recalculation. The bar transition declares the style under the transition
               class (compact-shell.less), inline `transition: none` turns it off. */
            flushAll();
            const t = TRANSITIONS.find(([, x]) => x.el === el);
            const dur = t ? t[1].duration() : 0;
            if (el === ta) return {paddingTop: TA.pt + 'px', paddingBottom: TA.pb + 'px', lineHeight: metrics().lh + 'px', getPropertyValue: () => ''};
            return {
                display: el && el.style && el.style.display === 'none' ? 'none' : 'block',
                transitionDuration: dur ? dur + 's' : '0s',
                getPropertyValue: name =>
                    name === '--celleditor-height' ? metrics().h + 'px' :
                    name === '--celleditor-line-height' ? metrics().lh + 'px' : ''
            };
        },
        matchMedia: q => ({matches: /prefers-reduced-motion:\s*reduce/.test(q) && motion.reduce, media: q}),
        setTimeout: (fn, ms) => { const id = ++timerId; timers.push({id, fn, ms: ms || 0}); return id; },
        clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
        addEventListener: (t, fn, cap) => {
            const box = (cap === true || (cap && cap.capture)) ? winListeners.capture : winListeners.bubble;
            (box[t] = box[t] || []).push(fn);
        },
        removeEventListener: (t, fn, cap) => {
            const box = (cap === true || (cap && cap.capture)) ? winListeners.capture : winListeners.bubble;
            const a = box[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
        },
        Common: {
            Gateway: {on() {}},
            NotificationCenter: bus
        },
        Asc: {c_oAscCellEditorState: EDIT_STATE},
        Backbone: {Controller: {extend: o => o}, View: {extend: o => o}},
        _: {bind: (fn, ctx) => fn.bind(ctx), template: () => () => ''},
        $: () => ({css() {}, parent() { return {find: () => ({css() {}})}; }, on() {}}),
        /* A jQuery wrapper for the stub of the bar place in the layout: [0] is the node itself. */
        jQuery: el => ({0: el, is: () => false})
    };
    context.window = context;
    vm.createContext(context);
    const run = (src, filename, args) => {
        let result;
        context.define = (deps, factory) => { result = factory.apply(null, args || []); };
        vm.runInContext(src, context, {filename});
        return result;
    };

    /* The stock from files. */
    run(fs.readFileSync(path.join(ROOT, 'apps/common/main/lib/util/LocalStorage.js'), 'utf8'), 'LocalStorage.js');
    context.SSE = {Views: {}, Controllers: {}};
    run(fs.readFileSync(path.join(APP, 'controller/CellEditor.js'), 'utf8'), 'CellEditor.js');
    run(fs.readFileSync(path.join(APP, 'view/Viewport.js'), 'utf8'), 'Viewport.js',
        ['', context.$, context._, context.Backbone]);
    const proto = context.SSE.Controllers.CellEditor;
    const ctl = Object.assign(Object.create(proto), {editor, api});
    ctl.expandEditorField = function () { calls.expand++; return proto.expandEditorField.apply(this, arguments); };
    ctl.changeCellEditorHeight = function () { calls.change++; return proto.changeCellEditorHeight.apply(this, arguments); };
    /* The standard button handler is bound in onLaunch (events: _.bind(this.expandEditorField)),
       that is, with the method at the time of binding: replacing the method later does not change the click. */
    const stockClick = ctl.expandEditorField.bind(ctl);

    const view = {getCelleditorResizeOptions: context.SSE.Views.Viewport.getCelleditorResizeOptions};
    const options = view.getCelleditorResizeOptions();          // parameters at render - the standard styles
    const item = {alias: 'celleditor', rely: true, resize: options};
    const events = {};
    const celayout = {
        splitters: [{resizer: {isresizer: true, minpos: options.min, multiply: options.multiply}}],
        getItem: alias => alias === 'celleditor' ? item : undefined,
        on: (n, fn) => { (events[n] = events[n] || []).push(fn); },
        off: (n, fn) => { const a = events[n] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        trigger: (n, ...a) => (events[n] || []).slice().forEach(fn => fn(...a)),
        doLayout() {}
    };
    view.celayout = celayout;

    /* The render went with the standard styles; the shell attaches body.vo-compact later, on app:ready. */
    bodyClasses.delete('vo-compact');
    const fresh = view.getCelleditorResizeOptions();
    Object.assign(item.resize, {min: fresh.min});
    Object.assign(item.resize.multiply, fresh.multiply);
    celayout.splitters[0].resizer.minpos = fresh.min;

    /* The standard CellEditor onLaunch (controller/CellEditor.js): the expansion height and
       the expanded state from the previous session. Repeated verbatim - onLaunch itself pulls in the view. */
    const val = context.Common.localStorage.getItem('sse-celleditor-height');
    editor.keep_height = (val !== null && parseInt(val) > 0) ? parseInt(val) : 74;
    if (context.Common.localStorage.getBool('sse-celleditor-expand')) {
        editor.$el.height(editor.keep_height);
        ctl.onLayoutResize(undefined, 'cell:edit');
    }
    bodyClasses.add('vo-compact');

    context.SSE.getController = name => name === 'CellEditor' ? ctl : name === 'Viewport' ? {viewport: view} : undefined;
    /* The shell: the card height is reported to it by FormulaBar (formulaRowChanged) - we record it. */
    const shellCalls = [];
    context.SSE.Views.CompactShell = {advanced: false, guarded: (label, fn) => fn,
        formulaRowChanged: moving => shellCalls.push({moving, total: $el.spec(), resize: counts.resize})};
    const bar = run(fs.readFileSync(file, 'utf8'), file);

    const dispatch = (type, target, stock) => {
        const ev = {type, target, propagationStopped: false, stopPropagation() { this.propagationStopped = true; }};
        (winListeners.capture[type] || []).slice().forEach(fn => fn(ev));
        if (stock && !ev.propagationStopped) stock(ev);
        if (!ev.propagationStopped) (winListeners.bubble[type] || []).slice().forEach(fn => fn(ev));
        return ev;
    };

    return {
        bar, ctl, editor, item, celayout, store, calls, notes, created, row, resizer, sdk, button, caret, bus, counts,
        layoutLog, motion, timers, winListeners, writes, parent, plate, shellCalls, bodyClasses, api, ta,
        /* A cell edit is the engine asc_onEditCell with the state by name (Asc.c_oAscCellEditorState);
           the standard onApiEditCell is subscribed earlier and sets api.isCellEdited before us. */
        editCell(state) {
            const v = EDIT_STATE[state];
            if (v === EDIT_STATE.editStart) api.isCellEdited = true;
            else if (v === EDIT_STATE.editEnd) api.isCellEdited = false;
            api.fire('asc_onEditCell', v);
        },
        /* The selected cell text in the field: lines field lines (wrap or a line break), wide - wider than the field.
           The engine puts it into the field before asc_onSelectionChanged (selection, paste, undo). */
        cellText(lines, wide) { field.lines = lines; field.wide = !!wide; },
        select() { api.fire('asc_onSelectionChanged', {}); },
        /* The text in the edit field changed - the engine asc_onEditorSelectionChanged (typing in a cell and in the field, paste,
           Alt+Enter): the engine updated the field before the callback. */
        editorText() { api.fire('asc_onEditorSelectionChanged'); },
        /* Deferred by 0 ms - after all subscribers of the current engine step. It does not touch transition timers. */
        tick() {
            for (let i = 0; i < 10; i++) {
                const due = timers.filter(t => !t.ms);
                if (!due.length) return;
                due.forEach(t => { const j = timers.indexOf(t); if (j >= 0) { timers.splice(j, 1); t.fn(); } });
            }
        },
        resize() { (winListeners.bubble.resize || []).slice().forEach(fn => fn({type: 'resize'})); },
        /* The pointer on the window (the own edge listens to move and release on window). */
        pointer(type, props) { (winListeners.bubble[type] || []).slice().forEach(fn => fn(Object.assign({type}, props))); },
        flushes: () => flushes,
        /* The row height by style - final (in the middle of a transition - where the row will arrive). */
        total: () => $el.spec(),
        /* The row height on screen now (in the middle of a transition - intermediate). */
        shown: () => $el.totalHeight(),
        /* The gap "grid top − row bottom" on screen: the grid is laid out for the row height that the
           last layout read, and shifted by its own transform. */
        gap() { flushAll(); return (laid === null ? $el.spec() : laid) + GAP + sdkT.value() - rowT.value(); },
        /* Nodes with a running transition. */
        running() { flushAll(); return TRANSITIONS.filter(([, t]) => t.run).map(([n]) => n); },
        /* Time: the running transitions - by the fraction of the path frac (0…1). */
        advance(frac) { flushAll(); TRANSITIONS.forEach(([, t]) => { if (t.run) t.run.frac = frac; }); },
        /* A frame: the browser dispatches the accumulated transition events (transitioncancel). */
        frame() { queued.splice(0).forEach(ev => ev.el.fire(ev.type, {propertyName: ev.propertyName})); },
        expanded: () => $el.hasClass('expanded'),
        toAdvanced() { bodyClasses.delete('vo-compact'); context.SSE.Views.CompactShell.advanced = true; },
        toCompact() { bodyClasses.add('vo-compact'); context.SSE.Views.CompactShell.advanced = false; },
        pagehide() { (winListeners.bubble.pagehide || []).slice().forEach(fn => fn({type: 'pagehide'})); },
        /* A click on the expand button as in the browser: interception on window → the standard
           button handler → bubbling up to window. lost - someone broke the bubbling. */
        clickExpand(target, lost) {
            return dispatch('click', target || button, ev => { stockClick(); if (lost) ev.stopPropagation(); });
        },
        press(target) { return dispatch('pointerdown', target, null); },
        /* The end of the bar height transition (transitionend), as the browser sends it: the row and the neighbors
           (their transitions of the same duration and curve) - at the end, then the event. */
        transitionEnd(prop) {
            prop = prop || 'height';
            if (prop === 'height') { flushAll(); TRANSITIONS.forEach(([, t]) => t.complete()); }
            row.fire('transitionend', {propertyName: prop});
        },
        runTimers() { timers.splice(0).forEach(t => t.fn()); },
        /* The edge exactly as Layout.resizeStop: snapping to offset + k·koeff, then
           the divider min limit, the box height = the value; then the standard chain
           layout:resizedrag → CellEditor.onLayoutResize(o, 'cell:edit'). */
        drag(raw) {
            const sp = celayout.splitters[0].resizer, m = sp.multiply;
            const v = raw / m.koeff;
            const vfloor = Math.floor(v) * m.koeff + (m.offset || 0), vceil = Math.ceil(v) * m.koeff + (m.offset || 0);
            let value = raw > vfloor + m.koeff / 2 ? vceil : vfloor;
            if (value < sp.minpos) value = sp.minpos;
            $el.css('height', value + 'px');
            ctl.onLayoutResize(celayout, 'cell:edit');
            celayout.trigger('layout:resizedrag', celayout);
            return $el.totalHeight();
        }
    };
}

/* LESS without comments, expanded into "full selector → declarations" pairs (nesting
   and `&` are expanded, @media is a separate field). Enough for the checks of this file. */
function flattenLess(src) {
    const text = src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n')
        .map(l => l.replace(/(^|[^:"'])\/\/.*$/, '$1')).join('\n');
    const rules = [];
    const stack = [{sels: [''], media: null}];
    let buf = '';
    const join = (parents, child) => {
        const out = [];
        parents.forEach(p => child.split(',').map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach(c => {
            out.push(c.indexOf('&') >= 0 ? c.replace(/&/g, p).trim() : (p ? p + ' ' + c : c));
        }));
        return out;
    };
    for (const ch of text) {
        if (ch === '{') {
            const head = buf.trim(); buf = '';
            const top = stack[stack.length - 1];
            if (/^@media/.test(head)) stack.push({sels: top.sels, media: head});
            else if (/^@/.test(head) || /\)\s*$/.test(head) && !/[#.:\[]/.test(head.split('(')[0])) stack.push({sels: top.sels, media: top.media, skip: true});
            else stack.push({sels: join(top.sels, head), media: top.media});
        } else if (ch === '}') {
            const decl = buf.trim(); buf = '';
            const top = stack.pop();
            if (decl && !top.skip) top.sels.forEach(sel => rules.push({sel, media: top.media, decl}));
        } else if (ch === ';') {
            const decl = buf.trim(); buf = '';
            const top = stack[stack.length - 1];
            if (decl && stack.length > 1 && !top.skip) top.sels.forEach(sel => rules.push({sel, media: top.media, decl}));
        } else buf += ch;
    }
    return rules.map(r => {
        const m = /^([\w-]+)\s*:\s*([\s\S]+)$/.exec(r.decl);
        return m ? {sel: r.sel, media: r.media, prop: m[1], value: m[2].replace(/\s+/g, ' ').trim()} : null;
    }).filter(Boolean);
}

function lessVars(src) {
    const out = {};
    const text = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of text.matchAll(/^@(vo-[\w-]+)\s*:\s*([^;]+);/gm)) out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
    return out;
}

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, '—', error && error.message);
        failed++;
    }
}

const onGrid = (total, row, lh) => total >= row && (total - row) % lh === 0;

test('opens_collapsed_even_if_stored_expanded', () => {
    const env = makeEnv({'sse-celleditor-expand': '1', 'sse-celleditor-height': '73'});
    assert.ok(env.expanded(), 'precondition: stock opened the stored expanded field');
    env.bar.apply();
    assert.equal(env.expanded(), false, 'field stays expanded on compact start');
    assert.equal(env.editor.$btnexpand.hasClass('btn-collapse'), false, 'expand button left in collapse state');
    assert.equal(env.total(), 32, 'collapsed field is not the 32px row');
    assert.equal(env.calls.expand, 1, 'collapse must go through the stock expandEditorField once');

    const plain = makeEnv({'sse-celleditor-expand': '0'});
    plain.bar.apply();
    assert.equal(plain.calls.expand, 0, 'collapsed field was toggled');
    assert.equal(plain.total(), 32);

    /* A return from the Standard is not a start: what the user expanded is not collapsed. */
    env.ctl.expandEditorField();
    env.toAdvanced(); env.bar.release();
    env.toCompact(); env.bar.apply();
    assert.ok(env.expanded(), 'return from advanced collapsed the field again');
});

test('stored_state_restored_on_pagehide', () => {
    const env = makeEnv({'sse-celleditor-expand': '1', 'sse-celleditor-height': '73'});
    env.bar.apply();
    assert.equal(env.store.get('sse-celleditor-expand'), '0', 'precondition: stock collapse wrote its key');
    env.ctl.expandEditorField();
    env.drag(95);
    assert.notEqual(env.store.get('sse-celleditor-height'), '73', 'precondition: drag wrote a new height');
    env.pagehide();
    assert.equal(env.store.get('sse-celleditor-expand'), '1', 'expand key not restored');
    assert.equal(env.store.get('sse-celleditor-height'), '73', 'height key not restored');

    const empty = makeEnv({});
    empty.bar.apply();
    empty.ctl.expandEditorField();
    empty.drag(80);
    empty.pagehide();
    assert.equal(empty.store.has('sse-celleditor-expand'), false, 'absent expand key left behind');
    assert.equal(empty.store.has('sse-celleditor-height'), false, 'absent height key left behind');
});

test('resize_snaps_to_whole_lines', () => {
    const env = makeEnv({});
    env.bar.apply();
    const C = METRICS.compact;
    assert.equal(env.item.resize.min, C.h - 1, 'resize.min not recomputed for the compact row');
    assert.deepEqual({...env.item.resize.multiply}, {koeff: C.lh, offset: C.h - C.lh}, 'snapping not recomputed');
    assert.equal(env.celayout.splitters[0].resizer.minpos, C.h - 1, 'splitter keeps the stock lower limit');
    assert.equal(env.celayout.splitters[0].resizer.multiply, env.item.resize.multiply, 'splitter lost the shared multiply');
    assert.ok(onGrid(env.editor.keep_height + BORDER, C.h, C.lh), 'expand height off the line grid: ' + env.editor.keep_height);
    for (let raw = 25; raw <= 160; raw += 3) {
        const h = env.drag(raw);
        assert.ok(onGrid(h, C.h, C.lh), 'drag to ' + raw + ' gave ' + h);
    }

    /* The Standard: snapping by the standard styles again. */
    env.toAdvanced();
    env.bar.release();
    const S = METRICS.stock;
    assert.equal(env.item.resize.min, S.h - 1);
    assert.deepEqual({...env.item.resize.multiply}, {koeff: S.lh, offset: S.h - S.lh});
    assert.ok(onGrid(env.editor.keep_height + BORDER, S.h, S.lh), 'advanced expand height off the stock grid');
});

test('expand_through_stock_handler', () => {
    const env = makeEnv({});
    env.bar.apply();
    const before = env.calls.expand;
    env.ctl.expandEditorField();             // the standard #ce-btn-expand button handler
    assert.equal(env.calls.expand - before, 1);
    assert.ok(env.expanded(), 'stock expand did not expand');
    assert.ok(env.total() > 32 && onGrid(env.total(), 32, 20), 'expanded height off the line grid: ' + env.total());
    assert.equal(env.store.get('sse-celleditor-expand'), '1', 'stock expand did not record its key');
    env.ctl.expandEditorField();
    assert.equal(env.expanded(), false);
    assert.equal(env.total(), 32, 'stock collapse did not return to the row');
    assert.deepEqual(env.created, [], 'formula bar built its own nodes');
});

test('drag_to_one_line_is_collapsed', () => {
    const env = makeEnv({});
    env.bar.apply();
    env.ctl.expandEditorField();
    assert.equal(env.drag(30), 32, 'drag to the top must stop at the row');
    assert.equal(env.expanded(), false, 'one-line field marked as expanded');
    assert.equal(env.editor.$btnexpand.hasClass('btn-collapse'), false);
    assert.equal(env.store.get('sse-celleditor-expand'), '0');
    env.ctl.expandEditorField();
    assert.ok(env.total() > 32, 'expand button stuck after a drag to one line');
});


/* --- Smooth expansion --------------------------------------------------- */
const less = fs.readFileSync(lessFile, 'utf8');
const RULES = flattenLess(less);
const VARS = lessVars(less);
const rulesFor = (pred, media) => RULES.filter(r => pred(r.sel) && (media === undefined ? true : media ? r.media && media.test(r.media) : !r.media));
const own = o => Object.prototype.hasOwnProperty.call(o, 'trigger');
const ANIM = 'vo-ce-anim', FOLLOW = 'vo-ce-follow';

test('expand_resizes_canvas_once', () => {
    const env = makeEnv({});
    env.bar.apply();
    assert.equal(env.bar.ANIM_CLASS, ANIM, 'row transition class');
    assert.equal(env.bar.FOLLOW_CLASS, FOLLOW, 'grid transition class');
    const c0 = env.counts.resize, l0 = env.layoutLog.length;
    env.clickExpand();
    assert.ok(env.expanded(), 'stock handler did not expand');
    const final = env.total(), d = final - 32;
    assert.ok(d > 0, 'precondition: expanded height ' + final);
    /* The layout is deferred: the standard layout:changed is held until the end of the transition. */
    assert.equal(env.counts.resize, c0, 'canvas resized at the click, before the row moved');
    assert.equal(own(env.bus), false, 'NotificationCenter.trigger left wrapped after the click');
    /* The row by a transition from the previous height to the standard one: first 32 (without a transition, with a
       forced read), then the standard height under the transition class. */
    assert.ok(env.row.classList.contains(ANIM), 'row has no transition class');
    assert.deepEqual(env.writes.row.slice(-2), ['32px', final + 'px'], 'row FLIP writes');
    assert.ok(env.flushes() > 0, 'no style flush between the start and the end state');
    /* The grid (and the edge) move by the same transition by the same amount. */
    [env.sdk, env.resizer].forEach(n => {
        assert.ok(n.classList.contains(FOLLOW), (n.id || 'resizer') + ' has no follow class');
        assert.equal(n.style.transform, 'translateY(' + d + 'px)', (n.id || 'resizer') + ' shift');
    });
    env.transitionEnd('background-color');            // a foreign property - not the end
    env.sdk.fire('transitionend', {propertyName: 'transform'});
    assert.equal(env.counts.resize, c0, 'finished on a foreign transitionend');
    env.transitionEnd('height');
    assert.equal(env.counts.resize, c0 + 1, 'not exactly one canvas resize per expand');
    const last = env.layoutLog[env.layoutLog.length - 1];
    assert.equal(last.area, 'celleditor');
    assert.equal(last.rowTotal, final, 'layout read a height other than the final one');
    assert.equal(last.animating, false, 'layout ran while the row was still under the transition class');
    assert.equal(env.layoutLog.length - l0, 1);
    assert.equal(env.row.classList.contains(ANIM), false, 'transition class left on the row');
    [env.sdk, env.resizer].forEach(n => {
        assert.equal(n.classList.contains(FOLLOW), false, 'follow class left');
        assert.equal(n.style.transform, '', 'shift left on ' + (n.id || 'resizer'));
    });
    env.runTimers();                                   // the fallback timer is no longer needed
    assert.equal(env.counts.resize, c0 + 1, 'fallback timer resized again');
});

test('collapse_resizes_canvas_once', () => {
    const env = makeEnv({});
    env.bar.apply();
    env.clickExpand(); env.transitionEnd();
    const top = env.total(), c0 = env.counts.resize;
    assert.ok(top > 32, 'precondition: expanded');
    env.writes.sdk.length = 0; env.writes.row.length = 0;
    env.clickExpand();
    assert.equal(env.expanded(), false, 'stock handler did not collapse');
    /* Collapsing: the layout at once - the grid gets the larger height before the motion, no empty strip
       is left at the bottom; the layout sees the standard final row height. */
    assert.equal(env.counts.resize, c0 + 1, 'collapse must lay out the canvas once, at the start');
    const last = env.layoutLog[env.layoutLog.length - 1];
    assert.equal(last.rowTotal, 32, 'layout read the animated height');
    assert.equal(last.animating, false, 'layout ran under the transition class');
    assert.deepEqual(env.writes.row, [top + 'px', '32px'], 'row FLIP writes');
    assert.deepEqual(env.writes.sdk, ['translateY(' + (top - 32) + 'px)', ''], 'grid FLIP: from the old place to none');
    assert.ok(env.sdk.classList.contains(FOLLOW) && env.row.classList.contains(ANIM));
    env.transitionEnd();
    env.runTimers();
    assert.equal(env.counts.resize, c0 + 1, 'second canvas resize on collapse');
    assert.equal(env.row.classList.contains(ANIM) || env.sdk.classList.contains(FOLLOW), false, 'classes left');
    assert.equal(env.sdk.style.transform, '');
});

test('drag_edge_without_transition', () => {
    const env = makeEnv({});
    env.bar.apply();
    env.clickExpand(); env.transitionEnd();
    env.writes.row.length = 0;
    const c0 = env.counts.resize;
    const h = env.drag(140);
    assert.ok(h > 32, 'precondition: drag resized the row');
    assert.equal(env.row.classList.contains(ANIM), false, 'drag put the row under the transition');
    assert.equal(env.sdk.classList.contains(FOLLOW) || env.sdk.style.transform !== '', false, 'drag moved the grid with a transition');
    assert.equal(own(env.bus), false);
    assert.deepEqual(env.writes.row, [], 'module rewrote the dragged height');
    /* A press on the edge in the middle of a transition - the transition ends at once, the layout is handed over.
       A second click - in the middle of collapsing (not in its first frame: there the row is still at the old
       height, and expanding to the same one gives no transition). */
    env.clickExpand();                                    // collapsing: the layout at the start
    env.advance(0.4);
    env.clickExpand();                                    // expanding: the layout is held
    env.advance(0.4);
    const c1 = env.counts.resize;
    env.press(env.resizer);
    assert.equal(env.counts.resize, c1 + 1, 'press on the edge did not release the held layout');
    assert.equal(env.row.classList.contains(ANIM), false, 'transition class left after the press');
    assert.deepEqual(env.running(), [], 'transition kept running after the press on the edge');
    assert.equal(env.layoutLog[env.layoutLog.length - 1].rowTotal, h, 'layout on the press read the row on its way');
    assert.ok(c1 > c0);
    /* Styles: the row height transition is only under the transition class, not by a rule without it. */
    const rowTr = rulesFor(sel => /#cell-editing-box/.test(sel)).filter(r => r.prop === 'transition' || r.prop === 'transition-property');
    const bare = rowTr.filter(r => !/\.vo-ce-anim/.test(r.sel) && /height|all/.test(r.value) && !/none/.test(r.value));
    assert.deepEqual(bare.map(r => r.sel + ' { ' + r.value + ' }'), [], 'height transition on the row outside the transition class');
    const anim = rowTr.filter(r => /^\.vo-compact #cell-editing-box\.vo-ce-anim$/.test(r.sel) && !r.media);
    assert.deepEqual(anim.map(r => r.value), ['height .3s @vo-ease'], 'row transition rule');
    assert.equal(VARS['vo-ease'], 'cubic-bezier(.32, .72, 0, 1)', '@vo-ease');
    const follow = RULES.filter(r => r.sel === '.vo-compact .vo-ce-follow' && !r.media && r.prop === 'transition');
    assert.deepEqual(follow.map(r => r.value), ['transform .3s @vo-ease'], 'grid follows with the same duration and curve');
});

test('reduced_motion_instant', () => {
    const env = makeEnv({}, {reduce: true});
    env.bar.apply();
    const c0 = env.counts.resize;
    env.clickExpand();
    assert.ok(env.expanded());
    assert.equal(env.counts.resize, c0 + 1, 'reduced motion: layout must be immediate');
    assert.equal(env.row.classList.contains(ANIM), false, 'reduced motion: row put under a transition');
    assert.deepEqual(env.writes.sdk, [], 'reduced motion: grid shifted');
    env.clickExpand();
    assert.equal(env.counts.resize, c0 + 2);
    assert.equal(own(env.bus), false);
    /* And by the styles: under "reduce motion" there are no transitions of the bar, the grid and the chevron. */
    const rm = /prefers-reduced-motion:\s*reduce/;
    ['.vo-compact #cell-editing-box.vo-ce-anim', '.vo-compact .vo-ce-follow', '.vo-compact #ce-btn-expand .caret'].forEach(sel => {
        const r = rulesFor(x => x === sel, rm).filter(x => x.prop === 'transition');
        assert.deepEqual(r.map(x => x.value), ['none'], 'reduced motion rule for ' + sel);
    });
});

test('chevron_rotates_150ms', () => {
    const r = rulesFor(sel => sel === '.vo-compact #ce-btn-expand .caret', false).filter(x => x.prop === 'transition');
    assert.deepEqual(r.map(x => x.value), ['transform @vo-dur-state @vo-ease'], 'chevron transition');
    assert.equal(VARS['vo-dur-state'], '.15s', '@vo-dur-state');
    /* The chevron is the AIR chevron 16 glyph as a mask on the standard .caret node. The standard corner made of borders
       is rotated by -135° (on press - by 45°), the AIR glyph is not: collapsed and on press
       there is no rotation, expanded (the stock .btn-collapse) - exactly 180°. The compact has no other chevron
       rotations. */
    const turned = {};
    RULES.filter(x => /#ce-btn-expand/.test(x.sel) && /caret/.test(x.sel) && x.prop === 'transform' && !x.media)
        .forEach(x => { assert.ok(!(x.sel in turned), 'chevron turn declared twice for ' + x.sel); turned[x.sel] = x.value; });
    assert.deepEqual(turned, {
        '.vo-compact #ce-btn-expand .caret': 'none',
        '.vo-compact #ce-btn-expand:active .caret': 'none',
        '.vo-compact #ce-btn-expand.active .caret': 'none',
        '.vo-compact #ce-btn-expand.btn-collapse .caret': 'rotate(180deg)',
        '.vo-compact #ce-btn-expand.btn-collapse:active .caret': 'rotate(180deg)'
    }, 'chevron turn');
    const glyph = {};
    rulesFor(sel => sel === '.vo-compact #ce-btn-expand .caret', false).forEach(x => { glyph[x.prop] = x.value; });
    assert.deepEqual([glyph.width, glyph.height, glyph.border], ['16px', '16px', 'none'], 'chevron glyph box');
    const block = /\n {4}#ce-btn-expand \{[\s\S]*?\n {8}\.caret \{([\s\S]*?)\n {8}\}/.exec(less);
    assert.ok(block, '#ce-btn-expand .caret block not found');
    assert.ok(/\.vo-glyph-mask\(16px\)/.test(block[1]) && /\.vo-glyph-src\(@vo-glyph-chevron\)/.test(block[1]), 'chevron is not the AIR glyph mask');
    assert.equal(VARS['vo-glyph-chevron'], '~"url(\'@{vo-air-url}chevron.svg\')"', '@vo-glyph-chevron');
});

test('lost_bubble_releases_layout_without_motion', () => {
    const env = makeEnv({});
    env.bar.apply();
    const c0 = env.counts.resize;
    env.clickExpand(null, true);                       // bubbling is broken
    assert.ok(env.expanded());
    env.runTimers();
    assert.equal(env.counts.resize, c0 + 1, 'held layout not released when the click did not bubble');
    assert.equal(own(env.bus), false, 'NotificationCenter.trigger left wrapped');
    assert.equal(env.row.classList.contains(ANIM), false);
    /* Foreign notifications in the interception window pass. */
    env.bar.hold();
    env.bus.trigger('layout:changed', 'toolbar');
    env.bus.trigger('layout:changed', 'celleditor', 'hidden');
    assert.equal(env.counts.resize, c0 + 3, 'hold swallowed a foreign notification');
    assert.equal(env.bar.unhold(), false, 'hold reports a held layout it did not catch');
    assert.equal(own(env.bus), false);
});

test('second_click_and_leaving_compact_finish_transition', () => {
    const env = makeEnv({});
    env.bar.apply();
    const c0 = env.counts.resize;
    env.clickExpand();                                  // expanding: held
    env.clickExpand();                                  // a second click in the middle of a transition
    assert.equal(env.expanded(), false, 'second click did not collapse');
    assert.equal(env.counts.resize, c0 + 2, 'one layout per transition: expand released, collapse laid out');
    env.transitionEnd();
    assert.equal(env.counts.resize, c0 + 2);
    env.clickExpand();                                  // expanding is held again
    env.advance(0.4);
    env.toAdvanced(); env.bar.release();
    assert.equal(env.row.classList.contains(ANIM), false, 'transition left running in advanced');
    assert.deepEqual(env.running(), [], 'row or grid kept moving in advanced');
    assert.ok(env.counts.resize >= c0 + 3, 'held layout lost on the way to advanced');
    const c1 = env.counts.resize;
    env.clickExpand();                                  // in the Standard - the standard way, instantly
    assert.equal(env.counts.resize, c1 + 1);
    assert.equal(env.row.classList.contains(ANIM), false);
    env.toCompact(); env.bar.apply();
    env.bar.dispose();
    ['click', 'pointerdown'].forEach(t => assert.equal(
        (env.winListeners.capture[t] || []).length + (env.winListeners.bubble[t] || []).length, 0, t + ' listener left after dispose'));
});

/* --- A transition that gets interrupted --------------------------------- */
/* Removing the transition class does not interrupt a running transition (at rest the row has `all 0s`, the end
   is the same - the transition goes on), so the module "end of transition" must interrupt it itself:
   otherwise the layout on a press and the standard handler of the second click read the row half-way. */
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.01 : tol);
const sweep = (env, fracs, label) => fracs.forEach(fr => {
    env.advance(fr);
    const g = env.gap();
    assert.ok(near(g, GAP, 1), label + ': grid off the row bottom at ' + fr + ' of the way: gap ' + g + ' (rest ' + GAP + ')');
});

test('press_mid_transition_lands_at_the_end', () => {
    const env = makeEnv({});
    env.bar.apply();
    const c0 = env.counts.resize;
    env.clickExpand();                                  // expanding: the layout is held
    const final = env.total();
    sweep(env, [0, 0.2, 0.4], 'expand');
    const mid = env.shown();
    assert.ok(mid > 32 && mid < final, 'precondition: row on its way, ' + mid);
    env.press(env.sdk);                                 // a press on the grid in the middle of expanding
    assert.equal(env.counts.resize, c0 + 1, 'press did not release the held layout once');
    const last = env.layoutLog[env.layoutLog.length - 1];
    assert.equal(last.rowTotal, final, 'layout on the press read the row on its way: ' + last.rowTotal + ' of ' + final);
    assert.deepEqual(env.running(), [], 'row or grid kept moving after the press');
    assert.equal(env.shown(), final, 'row not at its end after the press');
    assert.ok(near(env.gap(), GAP), 'grid at rest off the row bottom: gap ' + env.gap());
    env.frame();                                        // the interruption arrives as an event - already without a listener
    env.runTimers();
    assert.equal(env.counts.resize, c0 + 1, 'canvas laid out again after the press');

    /* Collapsing: the layout is already final; a press brings the row and the grid to the end at once. */
    env.clickExpand();
    sweep(env, [0, 0.2, 0.4], 'collapse');
    assert.ok(env.shown() > 32 && env.shown() < final, 'precondition: collapsing row on its way');
    const c1 = env.counts.resize;
    env.press(env.resizer);
    assert.equal(env.counts.resize, c1, 'collapse laid out again on the press');
    assert.deepEqual(env.running(), [], 'row or grid kept moving after the press on a collapse');
    assert.equal(env.shown(), 32);
    assert.ok(near(env.gap(), GAP), 'grid at rest off the row bottom after the collapse: gap ' + env.gap());
});

test('second_click_mid_expand_collapses_from_where_the_row_is', () => {
    const env = makeEnv({});
    env.bar.apply();
    const keep = env.editor.keep_height;
    assert.ok(onGrid(keep + BORDER, 32, 20), 'precondition: expand height on the line grid, ' + keep);
    env.clickExpand();
    const final = env.total();
    env.advance(0.4);
    const mid = env.shown();
    assert.ok(mid > 32 && mid < final, 'precondition: row on its way, ' + mid);
    env.writes.row.length = 0;
    env.clickExpand();                                  // a second click in the middle of expanding
    assert.equal(env.expanded(), false, 'second click mid-expand did not collapse');
    assert.equal(env.editor.keep_height, keep, 'stock took the height on the way for the expand height: ' + env.editor.keep_height);
    /* The reverse transition - from where the row is visible; the collapsing layout is final. */
    assert.deepEqual(env.writes.row, [mid + 'px', '32px'], 'reverse transition does not start where the row is');
    assert.equal(env.layoutLog[env.layoutLog.length - 1].rowTotal, 32, 'collapse layout read the row on its way');
    assert.deepEqual(env.running().sort(), ['resizer', 'row', 'sdk'], 'no reverse transition');
    env.frame();                                        // interrupting the previous transition - an event in a frame
    assert.ok(env.row.classList.contains(ANIM), 'cancel event of the old transition ended the reverse one');
    sweep(env, [0, 0.25, 0.5, 0.75, 1], 'reverse collapse');
    env.transitionEnd();
    assert.equal(env.shown(), 32);
    assert.ok(near(env.gap(), GAP), 'grid at rest off the row bottom: gap ' + env.gap());
    env.clickExpand(); env.transitionEnd();             // the next expansion - to the same line height
    assert.equal(env.total(), final, 'next expand height ' + env.total() + ' != ' + final);
    assert.ok(near(env.gap(), GAP));
});

test('second_click_mid_collapse_expands_from_where_the_row_is', () => {
    const env = makeEnv({});
    env.bar.apply();
    const keep = env.editor.keep_height;
    env.clickExpand(); env.transitionEnd();
    const final = env.total();
    env.clickExpand();                                  // collapsing: the layout at once
    env.advance(0.4);
    const mid = env.shown();
    assert.ok(mid > 32 && mid < final, 'precondition: collapsing row on its way, ' + mid);
    const c0 = env.counts.resize;
    env.clickExpand();                                  // a second click in the middle of collapsing
    assert.ok(env.expanded(), 'second click mid-collapse collapsed again instead of expanding');
    assert.equal(env.total(), final, 'expanded to ' + env.total() + ', not ' + final);
    assert.equal(env.editor.keep_height, keep, 'stock took the height on the way for the expand height: ' + env.editor.keep_height);
    assert.equal(env.counts.resize, c0, 'expand laid out the canvas before its transition ended');
    env.frame();
    assert.ok(env.row.classList.contains(ANIM), 'cancel event of the old transition ended the reverse one');
    /* The grid is laid out for the collapsed row, and the row starts from half-way: the grid shift is from their
       difference, not from zero. */
    sweep(env, [0, 0.25, 0.5, 0.75, 1], 'reverse expand');
    env.transitionEnd();
    assert.equal(env.counts.resize, c0 + 1, 'not one layout for the reverse expand');
    assert.equal(env.layoutLog[env.layoutLog.length - 1].rowTotal, final);
    assert.ok(near(env.gap(), GAP), 'grid at rest off the row bottom: gap ' + env.gap());
    env.clickExpand(); env.transitionEnd();
    assert.equal(env.total(), 32);
    env.clickExpand(); env.transitionEnd();
    assert.equal(env.total(), final, 'next expand height ' + env.total() + ' != ' + final);
});


/* --- The bar in the card --------------------------------------------------- */
/* In the compact the formula bar node lives in the shell card, under the panel row: in the standard
   layout it is in the middle column, between the side ones, and with an open column it would be narrower than the card. The place in the column layout
   is held by a hidden stub (the grid takes the whole column, the standard edge
   hides with it); the Standard and a rollback return the node to the same place. */
test('plate_takes_the_row_and_gives_it_back', () => {
    const env = makeEnv({});
    const $item = env.item.el;
    env.bar.apply(env.plate);
    assert.equal(env.row.parentNode, env.plate, 'the formula row is not in the plate');
    assert.equal(env.plate.children[1], env.row, 'the formula row is not right under the toolbar row');
    const stub = env.parent.children[0];
    assert.ok(stub && stub !== env.row && /vo-ce-home/.test(stub.className), 'no stub at the row place in the column');
    assert.equal(stub.style.display, 'none', 'the stub is shown: the column would keep room for the row');
    assert.equal(env.parent.children[1], env.resizer, 'the stub is not where the row stood (before the stock edge)');
    assert.equal(env.item.el[0], stub, 'the column layout cell still lays out the row');
    const grip = env.plate.children[2];
    assert.ok(grip && /vo-ce-grip/.test(grip.className), 'no own edge under the formula row');
    assert.equal(env.bar.inPlate(), true);
    assert.equal(env.bar.owns(env.row), true, 'the row in the plate is not the formula bar field');
    assert.equal(env.bar.owns(env.button), false);
    assert.equal(env.bar.plateRowHeight(), 32, 'collapsed row height for the shell rows');
    /* A repeated apply (theme, return from the Standard) does not set a second stub. */
    env.bar.apply(env.plate);
    assert.equal(env.parent.children.filter(n => n !== env.row && /vo-ce-home/.test(n.className || '')).length, 1, 'second stub');
    /* The Standard: the bar goes back in place, there is no stub or edge, the layout cell is the bar again. */
    env.toAdvanced();
    env.bar.release();
    assert.deepEqual(env.parent.children, [env.row, env.resizer, env.sdk], 'the row is not back in its column place');
    assert.equal(env.item.el, $item, 'the column layout cell did not get the row back');
    assert.equal(env.plate.children.indexOf(grip), -1, 'own edge left in the plate');
    assert.equal(env.bar.plateRowHeight(), 0, 'row height counted in the plate in the advanced mode');
    env.toCompact();
    env.bar.apply(env.plate);
    assert.equal(env.row.parentNode, env.plate, 'back to compact: the row is not in the plate');
    /* A start rollback - back in place too. */
    env.bar.dispose();
    assert.deepEqual(env.parent.children, [env.row, env.resizer, env.sdk], 'rollback left the row in the plate');
    assert.equal(env.item.el, $item);
});

/* A bar hidden by the standard "View → Formula bar" (display: none on the node) does not count toward the card height. */
test('plate_row_height_zero_when_stock_hides_the_row', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    assert.equal(env.bar.plateRowHeight(), 32, 'precondition: the shown row counts');
    env.row.style.display = 'none';                     // the standard setVisible(false) - jQuery hide()
    assert.equal(env.bar.plateRowHeight(), 0, 'the hidden row keeps its height in the plate');
    env.row.style.display = '';
    assert.equal(env.bar.plateRowHeight(), 32, 'the shown again row lost its height');
});

/* Expansion in the card: only the row goes by a transition, the grid and the column edge are not touched (they are
   laid out by the shell), the held notification is not handed over - there is no grid recalculation from
   FormulaBar, the shell gets one "motion" message with the final height. */
test('plate_expand_moves_the_row_alone_and_hands_rows_to_the_shell', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    const c0 = env.counts.resize, n0 = env.shellCalls.length;
    env.clickExpand();
    assert.ok(env.expanded(), 'stock handler did not expand');
    const final = env.total();
    assert.ok(final > 32, 'precondition: expanded height ' + final);
    assert.deepEqual(env.writes.row.slice(-2), ['32px', final + 'px'], 'row FLIP writes');
    assert.ok(env.row.classList.contains(ANIM), 'row has no transition class');
    [env.sdk, env.resizer].forEach(n => {
        assert.equal(n.classList.contains(FOLLOW), false, 'the column node follows the row in the plate');
        assert.equal(n.style.transform, '', 'the column node is shifted');
    });
    assert.equal(env.counts.resize, c0, 'the held stock notification was given out: canvas resized by the formula bar');
    assert.equal(own(env.bus), false, 'NotificationCenter.trigger left wrapped after the click');
    assert.deepEqual(env.shellCalls.slice(n0).map(c => c.moving), [true], 'the shell got no single moving row change');
    assert.equal(env.bar.plateRowHeight(), final, 'mid transition the shell must lay out the final height');
    env.advance(0.5);
    assert.equal(env.bar.plateRowHeight(), final, 'mid transition the shell must lay out the final height');
    env.transitionEnd();
    assert.equal(env.counts.resize, c0, 'the end of the row transition resized the canvas: the shell does it');
    assert.equal(env.row.classList.contains(ANIM), false, 'transition class left on the row');
    /* Collapsing - the same. */
    env.clickExpand();
    assert.equal(env.expanded(), false);
    assert.deepEqual(env.shellCalls.slice(n0).map(c => c.moving), [true, true]);
    env.transitionEnd();
    assert.equal(env.counts.resize, c0);
});

/* The own edge at the card bottom: snapping to the grid of the standard edge (offset + k·koeff), from one
   line; each grid step is a message to the shell without motion; on release - the standard accounting
   (onLayoutResize: expansion classes, keys) and one line - collapsed (afterDrag). */
test('plate_grip_snaps_to_lines_and_records_like_the_stock_edge', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    const grip = env.plate.children[2];
    let prevented = false;
    const n0 = env.shellCalls.length;
    grip.fire('pointerdown', {button: 0, clientY: 100, preventDefault() { prevented = true; }});
    assert.ok(prevented, 'pointerdown on the edge starts a text selection');
    assert.ok(env.bodyClasses.has('vo-ce-dragging'), 'no drag cursor on the body');
    env.pointer('pointermove', {clientY: 105});
    assert.equal(env.total(), 32, 'a 5 px pull moved off the line grid');
    env.pointer('pointermove', {clientY: 147});           // 32 + 47 → the nearest 12 + 3·20
    assert.equal(env.total(), 72, 'not snapped to whole lines: ' + env.total());
    assert.ok(onGrid(env.total(), 32, 20));
    env.pointer('pointermove', {clientY: 149});           // the same line - no new message
    assert.deepEqual(env.shellCalls.slice(n0).map(c => [c.moving, c.total]), [[false, 72]], 'shell messages while dragging');
    env.pointer('pointerup', {clientY: 149});
    assert.equal(env.bodyClasses.has('vo-ce-dragging'), false, 'drag cursor left on the body');
    assert.ok(env.expanded(), 'the dragged-open row is not marked expanded');
    assert.equal(env.store.get('sse-celleditor-expand'), '1', 'stock key of the expanded state');
    /* Up to one line - collapsed, the button expands again. */
    grip.fire('pointerdown', {button: 0, clientY: 200, preventDefault() {}});
    env.pointer('pointermove', {clientY: 120});
    assert.equal(env.total(), 32, 'not clamped to one line');
    env.pointer('pointerup', {clientY: 120});
    assert.equal(env.expanded(), false, 'one dragged line is left expanded');
    /* After release a move does not drag the edge. */
    const before = env.total();
    env.pointer('pointermove', {clientY: 400});
    assert.equal(env.total(), before, 'the edge follows the pointer after it was released');
    /* The right button is not a drag. */
    grip.fire('pointerdown', {button: 2, clientY: 100, preventDefault() {}});
    env.pointer('pointermove', {clientY: 160});
    assert.equal(env.total(), before, 'the right button drags the edge');
});

/* --- The expand chevron - only when needed ------------------------------------------------------------
   At rest there is no chevron: it appears when typing into a cell or into the formula bar and when a long
   text is pasted. When the chevron is needed the row has the class vo-ce-expand-on (by it and by the standard
   .expanded compact-shell.less shows the expand group): while a cell is edited - from the engine editStart to
   editEnd, in the formula bar field and in the cell itself; while the selected cell text does not fit in one
   field line - longer than the width (wrap) or with a line break. The collapsed formula bar is one field
   line; the stock compares the same way: the field scrollHeight against its height (CellEditor.cellEditorTextChange).
   Paste and undo arrive via the same asc_onSelectionChanged as selection. */
const ON = 'vo-ce-expand-on';
const shown = env => env.row.classList.contains(ON);

test('expand_chevron_while_editing', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    assert.equal(shown(env), false, 'the chevron is wanted with nothing being edited and a one-line text');
    env.editCell('editStart');
    assert.equal(shown(env), true, 'editing started: the chevron is not wanted');
    for (const st of ['editInFormulaBar', 'editEmptyCell', 'editText', 'editFormula', 'editInCell']) {
        env.editCell(st);
        assert.equal(shown(env), true, 'still editing (' + st + '): the chevron went away');
    }
    env.editCell('editEnd');
    env.runTimers();
    assert.equal(shown(env), false, 'editing ended with a one-line text: the chevron stays');
    /* The end of an edit with long text - the chevron stays: the text does not fit. The engine might not have updated the
       field yet (Escape returns the previous text) - the recalculation is also after all subscribers. */
    env.editCell('editStart');
    env.editCell('editEnd');
    env.cellText(3);
    env.runTimers();
    assert.equal(shown(env), true, 'editing ended with a three-line text: the chevron went away');
    /* The edit went before the compact start (the start retry cycle) - the stock sign. */
    const late = makeEnv({});
    late.api.isCellEdited = true;
    late.bar.apply(late.plate);
    assert.equal(shown(late), true, 'compact started mid edit: the chevron is not shown');
});

test('expand_chevron_for_text_longer_than_one_line', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    env.cellText(2);
    env.select();
    assert.equal(shown(env), true, 'a two-line text (wrapped or with a line break): no chevron');
    env.cellText(1);
    env.select();
    assert.equal(shown(env), false, 'a one-line text: the chevron stays');
    env.cellText(1, true);
    env.select();
    assert.equal(shown(env), true, 'a text wider than the field: no chevron');
    env.cellText(1);
    env.select();
    assert.equal(shown(env), false);
    /* The window got narrower - the same text wraps: a recalculation on window resize. */
    env.cellText(2);
    env.resize();
    assert.equal(shown(env), true, 'the window got narrower and the text wraps: no chevron');
    env.cellText(1);
    env.resize();
    assert.equal(shown(env), false);
});

/* An expanded bar - the chevron always (otherwise there is nothing to collapse it with; this is .expanded in the styles). Collapsing
   by a transition: while the row moves, the chevron stays - the field is still taller than one line - and at the end of the transition
   a recalculation: one line - it goes, long text - it stays. Without flicker half-way. */
test('expand_chevron_through_collapse', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    env.editCell('editStart');
    env.clickExpand();
    env.transitionEnd();
    assert.ok(env.expanded(), 'precondition: expanded');
    env.editCell('editEnd');
    env.runTimers();
    env.clickExpand();
    assert.equal(env.expanded(), false, 'precondition: collapsing');
    for (const frac of [0, 0.5, 0.9]) {
        env.advance(frac);
        env.select();
        assert.equal(shown(env), true, 'the chevron left mid collapse at ' + frac);
    }
    env.transitionEnd();
    assert.equal(shown(env), false, 'collapsed to a one-line text: the chevron stays');
    /* The same with long text: it stays after the end too. */
    env.cellText(2);
    env.select();
    env.clickExpand();
    env.transitionEnd();
    env.clickExpand();
    env.transitionEnd();
    assert.equal(shown(env), true, 'collapsed to a two-line text: the chevron went away');
    /* The own edge: dragged to one line - a recalculation on release. */
    env.cellText(1);
    env.select();
    env.clickExpand();
    env.transitionEnd();
    const grip = env.plate.children[2];
    grip.fire('pointerdown', {button: 0, clientY: 100, preventDefault() {}});
    env.pointer('pointermove', {clientY: 0});
    env.pointer('pointerup', {clientY: 0});
    assert.equal(env.expanded(), false, 'precondition: dragged to one line');
    assert.equal(shown(env), false, 'dragged to one line with a one-line text: the chevron stays');
});

/* The wheel over the field is its own handler on the row (wheel, mousewheel and DOMMouseScroll, as for the shell
   lists): one for the life of the compact, the Standard does not remove it (it is silent there by itself), a start
   rollback removes it. What it does is checked by real Chrome, wheel_scrolls_the_formula_field. */
test('formula_wheel_bound_once_and_unbound_on_rollback', () => {
    const env = makeEnv({});
    const count = () => ['wheel', 'mousewheel', 'DOMMouseScroll'].map(t => env.row.listeners(t));
    env.bar.apply(env.plate);
    assert.deepEqual(count(), [1, 1, 1], 'no wheel listener on the formula row');
    env.toAdvanced();
    env.bar.release();
    env.toCompact();
    env.bar.apply(env.plate);
    assert.deepEqual(count(), [1, 1, 1], 'the wheel listener is bound twice after the advanced mode');
    env.bar.dispose();
    assert.deepEqual(count(), [0, 0, 0], 'the wheel listener left after the rollback');
});

/* The field scroll does not carry over to another text. The standard textarea keeps the previous
   scrollTop on a value change: the field was scrolled (by wheel or by bar) and another cell with long text was selected - its text
   in the field does not start from the beginning. New text in the field outside an edit (selection, paste, undo - the engine puts it before
   asc_onSelectionChanged) - from the beginning; the same text (the selection was extended from the same cell) - where it was.
   In the middle of an edit and in the Standard we do not touch the field. */
test('formula_field_starts_from_the_top_for_new_text', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    const show = (text, top) => { env.ta.value = text; env.select(); if (top !== undefined) env.ta.scrollTop = top; return env.ta.scrollTop; };
    show('F32 long text', 40);
    assert.equal(show('F34 long text'), 0, 'another cell: the field kept the scroll of the previous text');
    show('F34 long text', 40);
    assert.equal(show('F34 long text'), 40, 'the same text: the field must stay where it was');
    /* Paste or undo in the same cell - new text without an edit. */
    assert.equal(show('F34 pasted text'), 0, 'a new text after paste: the field kept the old scroll');
    /* In the middle of an edit - we do not touch it (formula reference selection, the caret). */
    show('F34 pasted text', 40);
    env.editCell('editStart');
    assert.equal(show('=SUM(F34'), 40, 'editing: the field scroll changed');
    env.editCell('editEnd');
    assert.equal(show('F35 long text'), 0, 'after the edit: a new cell kept the old scroll');
    /* The Standard - the standard way. */
    show('F35 long text', 40);
    env.toAdvanced();
    env.bar.release();
    assert.equal(show('F36 long text'), 40, 'advanced mode: the field scroll changed');
});

/* The subscriptions are for the life of the compact: the Standard does not remove them (the bar there is standard, the class without
   body.vo-compact affects nothing), a start rollback removes them along with the class. */
test('expand_chevron_unbound_on_rollback', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    assert.equal(env.api.subs('asc_onEditCell'), 1, 'no edit subscription');
    assert.equal(env.api.subs('asc_onSelectionChanged'), 1, 'no selection subscription');
    env.toAdvanced();
    env.bar.release();
    env.toCompact();
    env.bar.apply(env.plate);
    assert.equal(env.api.subs('asc_onEditCell'), 1, 'subscribed twice after the advanced mode');
    env.editCell('editStart');
    assert.equal(shown(env), true);
    env.bar.dispose();
    assert.equal(env.api.subs('asc_onEditCell') + env.api.subs('asc_onSelectionChanged'), 0, 'engine callbacks left after the rollback');
    assert.equal((env.winListeners.bubble.resize || []).length, 0, 'window resize listener left after the rollback');
    assert.equal(shown(env), false, 'the chevron class left after the rollback');
});

/* --- The bar expands by itself when the text stops fitting --------------------------------------------
   A collapsed bar expands at the moment when the field would get a scroll - there is no need to expand it by hand.
   Behavior: only while a cell is edited; it expands the standard way, as by the chevron, to the expansion height
   (keep_height) and by the same transition; at the end of the edit it collapses if we expanded it ourselves; what the human did
   themselves during the edit (by the chevron or the edge) we do not touch. The engine puts the text into the field before
   asc_onEditorSelectionChanged; typing over a long cell in one engine step shows in the field first its
   previous text, then the new one - hence the decision is after the step (timer 0). Focus stays where the input goes:
   the standard button handler sends edit:complete, and Main.onEditComplete outside a click would give focus to the sheet. */
const focusAsks = env => env.notes.filter(n => n[0] === 'edit:complete').length;

test('auto_expand_when_text_stops_fitting', () => {
    const ref = makeEnv({});
    ref.bar.apply(ref.plate);
    ref.clickExpand();
    const chevronTotal = ref.total();

    const env = makeEnv({});
    env.bar.apply(env.plate);
    const c0 = env.calls.expand, f0 = focusAsks(env);
    env.editCell('editStart');
    env.editorText();
    env.tick();
    assert.equal(env.expanded(), false, 'a one-line text expanded the row');
    const n0 = env.shellCalls.length;
    env.cellText(2);
    env.editorText();
    env.tick();
    assert.ok(env.expanded(), 'the text stopped fitting while editing: the row did not expand');
    assert.equal(env.calls.expand - c0, 1, 'not through the stock expand handler');
    assert.equal(env.total(), chevronTotal, 'expanded to another height than the chevron gives');
    assert.ok(env.row.classList.contains(ANIM), 'expanded without the chevron transition');
    assert.deepEqual(env.shellCalls.slice(n0).map(c => c.moving), [true], 'the shell got no single moving row change');
    assert.equal(own(env.bus), false, 'NotificationCenter.trigger left wrapped');
    assert.equal(focusAsks(env), f0, 'edit:complete went out: the focus would leave the typing');
    env.transitionEnd();
    /* The text grows further - the bar is already expanded, we do not touch it a second time. */
    env.cellText(6);
    env.editorText();
    env.tick();
    assert.ok(env.expanded());
    assert.equal(env.calls.expand - c0, 1, 'the expanded row was toggled again');
    /* The end of the edit (Enter, Escape) - collapsed by the same path. */
    env.editCell('editEnd');
    env.tick();
    assert.equal(env.expanded(), false, 'the row expanded by itself stayed expanded after the edit');
    assert.ok(env.row.classList.contains(ANIM), 'collapsed without the chevron transition');
    assert.equal(focusAsks(env), f0, 'collapse: edit:complete went out');
    assert.equal(own(env.bus), false);
    env.transitionEnd();
    assert.equal(env.total(), 32, 'not collapsed to one line');
    assert.equal(env.editor.keep_height + BORDER, chevronTotal, 'the expand height changed');
});

test('auto_expand_only_while_editing', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    const c0 = env.calls.expand;
    /* Selecting a long cell, a paste without an edit, a narrower window - the chevron, but not an expansion. */
    env.cellText(3);
    env.select();
    env.editorText();
    env.resize();
    env.tick();
    assert.equal(env.expanded(), false, 'a long cell without editing expanded the row');
    /* The bar is hidden ("View → Formula bar"): editing long text does not expand it. */
    env.row.style.display = 'none';
    env.editCell('editStart');
    env.editorText();
    env.tick();
    assert.equal(env.expanded(), false, 'the hidden row expanded');
    env.editCell('editEnd');
    env.row.style.display = '';
    /* The Standard - the bar is standard. */
    env.toAdvanced();
    env.bar.release();
    env.editCell('editStart');
    env.editorText();
    env.tick();
    assert.equal(env.expanded(), false, 'advanced mode: the row expanded');
    env.editCell('editEnd');
    env.tick();
    assert.equal(env.calls.expand, c0, 'the stock handler was called');
});

test('auto_expand_for_a_long_cell_but_not_for_typing_over_it', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    env.cellText(3);
    env.select();
    /* Typing over a long cell: in the same engine step the field has first its previous text, then the new one. */
    env.editCell('editStart');
    env.editorText();
    env.cellText(1);
    env.editorText();
    env.tick();
    assert.equal(env.expanded(), false, 'typing over a long cell expanded the row by its old text');
    env.editCell('editEnd');
    env.tick();
    /* F2, a double click, a click into the field of a long cell - the text in the edit does not fit from the start. */
    env.cellText(3);
    env.select();
    env.editCell('editStart');
    env.tick();
    assert.ok(env.expanded(), 'editing a long cell: the row did not expand');
    env.transitionEnd();
    env.editCell('editEnd');
    env.tick();
    env.transitionEnd();
    assert.equal(env.expanded(), false, 'the long cell stayed expanded after the edit');
    /* The edit went before the compact start (the start retry cycle) - the same. */
    const late = makeEnv({});
    late.api.isCellEdited = true;
    late.cellText(2);
    late.bar.apply(late.plate);
    late.editorText();
    late.tick();
    assert.ok(late.expanded(), 'compact started mid edit: the row did not expand');
});

test('auto_expand_leaves_what_was_done_by_hand', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    const grow = lines => { env.cellText(lines); env.editorText(); env.tick(); };
    /* It expanded by itself before the edit - at the end of the edit it stays. */
    env.clickExpand();
    env.transitionEnd();
    let c = env.calls.expand;
    env.editCell('editStart');
    grow(3);
    assert.equal(env.calls.expand, c, 'the row expanded by hand was toggled');
    env.editCell('editEnd');
    env.tick();
    assert.ok(env.expanded(), 'the row expanded by hand collapsed after the edit');
    env.clickExpand();
    env.transitionEnd();
    /* It expanded by itself, collapsed by the chevron - until the end of this edit it does not expand, at the end - we do not touch it. */
    env.cellText(1);
    env.select();
    env.editCell('editStart');
    grow(3);
    env.transitionEnd();
    env.clickExpand();
    env.transitionEnd();
    assert.equal(env.expanded(), false, 'precondition: collapsed by the chevron');
    grow(5);
    assert.equal(env.expanded(), false, 'the row collapsed by hand during the edit expanded again');
    c = env.calls.expand;
    env.editCell('editEnd');
    env.tick();
    assert.equal(env.calls.expand, c, 'the row collapsed by hand was toggled after the edit');
    /* The next edit - by itself again. */
    env.cellText(1);
    env.select();
    env.editCell('editStart');
    grow(2);
    assert.ok(env.expanded(), 'the next edit: the row did not expand');
    env.transitionEnd();
    /* Collapsed and expanded again - now it is the human's: at the end of the edit it stays. */
    env.clickExpand();
    env.transitionEnd();
    env.clickExpand();
    env.transitionEnd();
    env.editCell('editEnd');
    env.tick();
    assert.ok(env.expanded(), 'the row expanded again by hand collapsed after the edit');
    env.clickExpand();
    env.transitionEnd();
    /* It expanded by itself, dragged the edge - it is the human's: at the end of the edit it stays. */
    env.cellText(1);
    env.select();
    env.editCell('editStart');
    grow(3);
    env.transitionEnd();
    const grip = env.plate.children[2];
    grip.fire('pointerdown', {button: 0, clientY: 100, preventDefault() {}});
    env.pointer('pointermove', {clientY: 120});
    env.pointer('pointerup', {clientY: 120});
    const dragged = env.total();
    env.editCell('editEnd');
    env.tick();
    assert.ok(env.expanded(), 'the row dragged by hand collapsed after the edit');
    assert.equal(env.total(), dragged, 'the dragged height changed');
});

test('auto_expand_reduced_motion_instant', () => {
    const env = makeEnv({}, {reduce: true});
    env.bar.apply(env.plate);
    const f0 = focusAsks(env);
    env.editCell('editStart');
    env.cellText(2);
    env.editorText();
    env.tick();
    assert.ok(env.expanded(), 'reduced motion: the row did not expand');
    assert.equal(env.row.classList.contains(ANIM), false, 'reduced motion: row put under a transition');
    assert.equal(focusAsks(env), f0, 'reduced motion: edit:complete went out');
    env.editCell('editEnd');
    env.tick();
    assert.equal(env.expanded(), false, 'reduced motion: the row stayed expanded after the edit');
    assert.equal(env.row.classList.contains(ANIM), false);
    assert.equal(focusAsks(env), f0);
    assert.equal(own(env.bus), false);
});

/* Enter or Escape in the middle of expanding - collapsing from where the row is on screen. */
test('auto_expand_edit_ends_mid_transition', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    const k0 = env.editor.keep_height;
    env.editCell('editStart');
    env.cellText(2);
    env.editorText();
    env.tick();
    env.advance(0.5);
    const mid = env.shown();
    assert.ok(mid > 32 && mid < env.total(), 'precondition: mid transition ' + mid);
    env.editCell('editEnd');
    env.tick();
    assert.equal(env.expanded(), false, 'the edit ended mid expand: the row stayed expanded');
    assert.equal(env.writes.row.slice(-2)[0], mid + 'px', 'collapse jumped instead of starting where the row was');
    assert.equal(env.editor.keep_height, k0, 'the expand height was taken mid transition');
    env.transitionEnd();
    assert.equal(env.total(), 32);
});

test('auto_expand_unbound_on_rollback', () => {
    const env = makeEnv({});
    env.bar.apply(env.plate);
    assert.equal(env.api.subs('asc_onEditorSelectionChanged'), 1, 'no editor text subscription');
    env.toAdvanced();
    env.bar.release();
    env.toCompact();
    env.bar.apply(env.plate);
    assert.equal(env.api.subs('asc_onEditorSelectionChanged'), 1, 'subscribed twice after the advanced mode');
    env.editCell('editStart');
    env.cellText(3);
    env.editorText();
    const c = env.calls.expand;
    env.bar.dispose();
    env.tick();
    assert.equal(env.api.subs('asc_onEditorSelectionChanged'), 0, 'editor text subscription left after the rollback');
    assert.equal(env.calls.expand, c, 'a check queued before the rollback expanded the row');
    assert.equal(env.expanded(), false);
});

/* --- The formula bar and the sheet row: look ------------------------------------------------------------
   Real headless Chrome (playwright, as compact-toolbar.cjs): NODE_PATH or PLAYWRIGHT_MODULE
   for the package, CHROMIUM_PATH for the browser. The styles are the real spreadsheet editor app.less (the standard celleditor.less,
   statusbar.less, layout.less and the default theme), built by the less from build/node_modules, with
   the tree compact-shell.less or its broken copy (the second argument). The formula bar markup is the
   standard CellEditor.template (plus the address chevron button, as the stock finishes it); the sheet row - the
   editor nodes (Statusbar.template and TabBar after the build: ids, classes, nesting). The numbers are
   literals: measured in headless Chrome at 1280 and 1440, DPR 1. */
const EXPECTED = {
    icon: 'rgb(82, 92, 105)',        // .vo-ib at rest - var(--vo-icon) #525c69
    text: 'rgb(51, 51, 51)',         // .vo-ib:hover — color: var(--vo-text) #333
    hover: 'rgba(0, 0, 0, 0.03)',    // .vo-ib:hover — var(--vo-hover)
    press: 'rgba(0, 0, 0, 0.06)',    // .vo-ib:active — var(--vo-active)
    tabHoverTop: 247,                // a hovered tab: its background #f7f7f7 (--vo-outline-hover) over the row line
    rowH: 36,                        // the collapsed formula bar in the card
    ctrlTop: 5,                      // (36 − 26) / 2 - the address, fx and expand at the center of the collapsed row
    ctrlH: 26,
    expandEdge: 23,                  // the expand chevron center from the row edge: under the panel chevron (padding 6 + 32 / 2 = 22) and 1 inward - an optical correction
    glyphMid: 18,                    // the expand chevron glyph center from the row top
    lineMid: 18                      // the center of the first field line (collapsed and expanded) from the row top
};

/* A minimal PNG: 8 bit, RGB/RGBA, non-interlaced (a Chrome screenshot). */
function decodePng(buf) {
    const zlib = require('node:zlib');
    let p = 8, w = 0, h = 0, ct = 0;
    const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; assert.ok(data[8] === 8 && data[12] === 0, 'png: unsupported'); }
        else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        p += 12 + len;
    }
    const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
    assert.ok(bpp, 'png: colour type ' + ct);
    const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
            let v = src[x];
            if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            out[y * stride + x] = v & 255;
        }
    }
    return {w, h, px: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2]]; }};
}

const CE_TEMPLATE = fs.readFileSync(path.join(APP, 'template/CellEditor.template'), 'utf8')
    .replace('<div id="ce-cell-name-menu"></div>', '<div id="ce-cell-name-menu"><div class="btn-group"><button type="button" class="btn dropdown-toggle">' +
        '<span class="caption"></span><span class="inner-box-caret"><i class="caret"></i></span></button></div></div>');
const SB_BTN = (id, icon, extra) => `<button id="${id}" type="button" class="btn small btn-toolbar canfocused${extra || ''}"><i class="icon toolbar__icon ${icon}">&nbsp;</i></button>`;
const SB_TAB = (name, i, cls) => `<li class="list-item${cls || ''}" data-label="${name}"><span tabtitle="${name}" draggable="true" tabindex="-1" data-index="${i}">` +
    `<div class="toolbar__icon btn-sheet-view" title=""></div>${name}</span></li>`;
const STAGE = rtl => `<body class="theme-light theme-type-light vo-compact${rtl ? ' rtl' : ''}" style="margin:0">
<div class="layout-ct vbox" style="width:1440px;height:420px">
  <div id="toolbar" class="layout-item" style="top:0;height:92px"><div id="vo-shell"><div id="vo-plate" class="vo-plate-split vo-plate-fx">
    <div id="vo-tb"></div>
    <div id="cell-editing-box" class="layout-item" style="top:0;height:36px">${CE_TEMPLATE}</div>
  </div></div></div>
  <div id="statusbar" class="layout-item" style="top:380px;height:25px"><div class="statusbar">
    <div id="status-tabs-scroll" class="status-group cnt-flex-center">${SB_BTN('status-btn-tabback', 'btn-previtem')}${SB_BTN('status-btn-tabnext', 'btn-nextitem', ' disabled" disabled="true')}</div>
    <div id="status-addtabs-box" class="status-group cnt-flex-center">${SB_BTN('status-btn-addtab', 'btn-zoomup')}
      <div class="cnt-tablist">${SB_BTN('status-btn-tabslist', 'btn-sheet-list', ' dropdown-toggle')}</div></div>
    <div id="status-zoom-box" class="status-group cnt-flex-center"><div class="separator short"></div>${SB_BTN('status-btn-zoomdown', 'btn-zoomdown')}
      <div class="cnt-zoom canfocused"><div class="dropdown-toggle" role="button"><label id="status-label-zoom" class="status-label" style="min-width:80px">Масштаб 100%</label></div></div>
      ${SB_BTN('status-btn-zoomup', 'btn-zoomup')}</div>
    <div id="status-sheets-bar-box" style="left:122px;right:140px"><div id="status-sheets-bar" class="status-group">
      <ul id="statusbar_bottom" class="nav nav-tabs bottom">${SB_TAB('Sales report', 0, ' active selected')}${SB_TAB('Лист1', 1)}${SB_TAB('Лист2', 2)}</ul></div></div>
  </div></div>
</div></body>`;

const chromeTests = [];
const chromeTest = (name, fn) => chromeTests.push([name, fn]);

/* Building app.less with the tree compact-shell.less or a copy: the copy takes the place of the standard @import. */
async function appCss() {
    const lessLib = require(path.join(ROOT, 'build/node_modules/less'));
    const appLess = path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/app.less');
    const own = '@import "compact-shell.less";';
    const src = fs.readFileSync(appLess, 'utf8');
    assert.ok(src.indexOf(own) >= 0, 'app.less: ' + own + ' not found');
    const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/spreadsheeteditor.json'), 'utf8')).main.less.vars;
    return (await lessLib.render(src.replace(own, '@import ' + JSON.stringify(lessFile) + ';'),
        {filename: appLess, modifyVars: vars})).css;
}

let page = null, CSS = '';
const AWAY = [5, 470];
async function stage(rtl) {
    await page.setContent(`<style>${CSS}</style>${STAGE(rtl)}`);
    await page.mouse.move(...AWAY);
    await page.evaluate(() => document.getAnimations().forEach(a => a.finish()));
}
/* A node box from the formula bar row top and its center in the window. */
const ceBox = sel => page.evaluate(sel => {
    const row = document.getElementById('cell-editing-box').getBoundingClientRect(), r = document.querySelector(sel).getBoundingClientRect();
    return {top: r.top - row.top, h: r.height, mid: r.top + r.height / 2 - row.top, x: r.left + r.width / 2, y: r.top + r.height / 2};
}, sel);
/* The center of the first field line: the field top + border + padding + half the line height. */
const firstLineMid = () => page.evaluate(() => {
    const row = document.getElementById('cell-editing-box').getBoundingClientRect(), ta = document.getElementById('ce-cell-content');
    const s = getComputedStyle(ta), r = ta.getBoundingClientRect();
    return r.top - row.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop) + parseFloat(s.lineHeight) / 2;
});
const expandRow = () => page.evaluate(() => { const b = document.getElementById('cell-editing-box'); b.classList.add('expanded'); b.style.height = '76px'; });

/* The formula bar is the second card row (its node in the compact lives in #vo-plate under #vo-tb). The expand
   chevron (and with it the address, its chevron, fx and the field text) is at the center of the collapsed 36 row:
   5 from its top. The expanded bar: the controls are in place, the first field line is where it is in the
   collapsed one. Right to left - the same top. */
chromeTest('formula_row_controls_aligned', async () => {
    for (const rtl of [false, true]) {
        await stage(rtl);
        const where = rtl ? 'rtl: ' : '';
        assert.equal((await ceBox('#cell-editing-box')).h, EXPECTED.rowH, where + 'precondition: the collapsed formula row is ' + EXPECTED.rowH);
        const group = await ceBox('#cell-editing-box .ce-group-name');
        assert.deepEqual([group.top, group.h], [0, EXPECTED.rowH], where + 'the name group left the row: ' + JSON.stringify([group.top, group.h]));
        for (const expanded of [false, true]) {
            if (expanded) await expandRow();
            const tag = where + (expanded ? 'expanded: ' : '');
            for (const sel of ['#ce-cell-name', '#ce-cell-name-menu button', '#ce-func-label', '#ce-btn-expand']) {
                const b = await ceBox(sel);
                assert.deepEqual([b.top, b.h], [EXPECTED.ctrlTop, EXPECTED.ctrlH], tag + sel + ' top/height ' + JSON.stringify([b.top, b.h]) +
                    ' — every control is expected ' + EXPECTED.ctrlTop + ' below the row top (centred in the collapsed row)');
            }
            const caret = await ceBox('#ce-btn-expand .caret');
            assert.equal(caret.mid, EXPECTED.glyphMid, tag + 'expand chevron glyph centre ' + caret.mid + ' != ' + EXPECTED.glyphMid);
            /* Horizontally the expand chevron is under the panel chevron (a 32 button at padding 6, center 22 from the edge) with an optical
               correction of 1 inward: the center 23 from the row edge, right to left - from the left. */
            const edge = await page.evaluate(rtl => {
                const row = document.getElementById('cell-editing-box').getBoundingClientRect(), b = document.getElementById('ce-btn-expand').getBoundingClientRect();
                return rtl ? (b.left + b.right) / 2 - row.left : row.right - (b.left + b.right) / 2;
            }, rtl);
            assert.equal(edge, EXPECTED.expandEdge, tag + 'expand chevron centre is ' + edge + ' from the row edge, expected ' + EXPECTED.expandEdge + ' (toolbar chevron above at 22, 1 inward)');
            const line = await firstLineMid();
            assert.equal(line, EXPECTED.lineMid, tag + 'first field line centre ' + line + ' != ' + EXPECTED.lineMid);
        }
    }
});

/* An object is selected - the stock disables the field (#ce-cell-content[disabled], opacity .5 - a layer over
   the absolute .ce-group-expand, under which the field stretches in the compact). The expand chevron, when it is
   visible (a collapsed bar - by the class vo-ce-expand-on, an expanded one - always), stays on top: at its
   center is the button itself, a real mouse click reaches it (collapsed and expanded). */
chromeTest('expand_clickable_over_disabled_field', async () => {
    await stage(false);
    await page.evaluate(() => {
        document.getElementById('cell-editing-box').classList.add('vo-ce-expand-on');
        document.getElementById('ce-cell-content').disabled = true;
        window.__expandClicks = 0;
        document.getElementById('ce-btn-expand').addEventListener('click', () => window.__expandClicks++);
    });
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('ce-cell-content')).opacity), '0.5',
        'precondition: the stock dims the disabled field (celleditor.less)');
    for (const expanded of [false, true]) {
        if (expanded) await expandRow();
        const tag = expanded ? 'expanded: ' : '';
        const c = await ceBox('#ce-btn-expand');
        const top = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + e.className); }, [c.x, c.y]);
        assert.ok(top === '#ce-btn-expand' || top === 'span.caret', tag + 'the disabled field lies over the expand chevron: ' + top + ' is on top');
        const before = await page.evaluate(() => window.__expandClicks);
        await page.mouse.click(c.x, c.y);
        assert.equal(await page.evaluate(() => window.__expandClicks) - before, 1, tag + 'a real click on the chevron did not reach #ce-btn-expand');
    }
});

/* The expand chevron - only when needed. At rest (collapsed, without the class vo-ce-expand-on) the expand group is not
   visible, its button takes neither a click (in its place is the field: a click puts the caret), nor focus (Tab from fx goes -
   straight into the field). With the class and in an expanded bar - visible, in the same place (center 23 from the row edge),
   a click and Tab are its. The field and its text do not move: the place under the chevron stays behind it (the right padding
   of the field). Appearing and leaving is by opacity over @vo-dur-state, visibility goes off at the end of leaving - like the
   column header chevron; "reduce motion" - at once. Right to left - mirrored, from the left edge. */
const DUR_STATE = parseFloat(VARS['vo-dur-state']);
chromeTest('expand_chevron_only_when_needed', async () => {
    assert.ok(DUR_STATE > 0, 'precondition: @vo-dur-state ' + VARS['vo-dur-state']);
    const look = rtl => page.evaluate(rtl => {
        document.getAnimations().forEach(a => a.finish());
        const row = document.getElementById('cell-editing-box'), g = row.querySelector('.ce-group-expand');
        const b = document.getElementById('ce-btn-expand'), ta = document.getElementById('ce-cell-content');
        const rr = row.getBoundingClientRect(), br = b.getBoundingClientRect(), tr = ta.getBoundingClientRect();
        const gs = getComputedStyle(g), ts = getComputedStyle(ta);
        const x = (br.left + br.right) / 2, y = (br.top + br.bottom) / 2, hit = document.elementFromPoint(x, y);
        b.focus();
        const focusable = document.activeElement === b;
        b.blur();
        return {visibility: gs.visibility, opacity: gs.opacity, edge: rtl ? x - rr.left : rr.right - x,
                hit: hit && (hit === b || b.contains(hit)) ? 'button' : hit === ta ? 'field' : hit && (hit.id || hit.className),
                focusable, field: [tr.left, tr.width, tr.top, tr.height, ts.paddingLeft, ts.paddingRight, ts.paddingTop].join(' ')};
    }, rtl);
    /* Tab from fx: where focus landed. */
    const tabFromFx = async () => {
        await page.evaluate(() => document.getElementById('ce-func-label').focus());
        await page.keyboard.press('Tab');
        return page.evaluate(() => document.activeElement && document.activeElement.id);
    };
    const set = (cls, on) => page.evaluate(([cls, on]) => document.getElementById('cell-editing-box').classList.toggle(cls, on), [cls, on]);
    for (const rtl of [false, true]) {
        await stage(rtl);
        const where = rtl ? 'rtl: ' : '';
        const rest = await look(rtl);
        assert.deepEqual([rest.visibility, rest.opacity], ['hidden', '0'], where + 'the chevron is shown at rest: ' + JSON.stringify(rest));
        assert.equal(rest.hit, 'field', where + 'at rest a click on the chevron place does not reach the field: ' + rest.hit);
        assert.equal(rest.focusable, false, where + 'the hidden chevron takes focus');
        assert.equal(await tabFromFx(), 'ce-cell-content', where + 'Tab from fx stops on the hidden chevron');

        await set('vo-ce-expand-on', true);
        const anim = await page.evaluate(() => document.querySelector('#cell-editing-box .ce-group-expand').getAnimations()
            .map(a => a.transitionProperty + ' ' + a.effect.getTiming().duration));
        assert.ok(anim.indexOf('opacity ' + DUR_STATE * 1000) >= 0, where + 'the chevron does not fade in over @vo-dur-state: ' + JSON.stringify(anim));
        const on = await look(rtl);
        assert.deepEqual([on.visibility, on.opacity], ['visible', '1'], where + 'vo-ce-expand-on: the chevron is not shown');
        assert.equal(on.hit, 'button', where + 'the shown chevron does not take the click: ' + on.hit);
        assert.equal(on.focusable, true, where + 'the shown chevron is not focusable');
        assert.equal(await tabFromFx(), 'ce-btn-expand', where + 'Tab from fx skips the shown chevron');
        assert.equal(on.edge, EXPECTED.expandEdge, where + 'the shown chevron moved: centre ' + on.edge + ' from the row edge');
        assert.equal(on.field, rest.field, where + 'the field moved or changed its padding when the chevron showed up');

        /* Leaving: while fading - visible, at the end - hidden. */
        await set('vo-ce-expand-on', false);
        const going = await page.evaluate(() => {
            const g = document.querySelector('#cell-editing-box .ce-group-expand');
            return {visibility: getComputedStyle(g).visibility, anim: g.getAnimations().map(a => a.transitionProperty)};
        });
        assert.equal(going.visibility, 'visible', where + 'the chevron vanished without fading out');
        assert.ok(going.anim.indexOf('opacity') >= 0, where + 'the chevron does not fade out: ' + JSON.stringify(going.anim));
        assert.deepEqual([(await look(rtl)).visibility], ['hidden'], where + 'the chevron stays after fading out');

        /* An expanded bar - the chevron without the class. */
        await expandRow();
        const open = await look(rtl);
        assert.deepEqual([open.visibility, open.opacity, open.hit], ['visible', '1', 'button'], where + 'expanded row without its chevron');
        assert.equal(open.edge, EXPECTED.expandEdge, where + 'expanded: the chevron moved');
    }
    /* "Reduce motion" - without a transition. */
    await page.emulateMedia({reducedMotion: 'reduce'});
    try {
        await stage(false);
        await set('vo-ce-expand-on', true);
        const anim = await page.evaluate(() => document.querySelector('#cell-editing-box .ce-group-expand').getAnimations().length);
        assert.equal(anim, 0, 'reduced motion: the chevron still fades');
    } finally {
        await page.emulateMedia({reducedMotion: null});
    }
});

/* The wheel and trackpad over the formula bar field. A plain wheel over the row is suppressed on bubbling by the standard
   handlers of the ancestors: the SDK on #viewport (sdkjs apiBase - mousewheel and DOMMouseScroll without
   modifiers: preventDefault and stopPropagation) and the ribbon on #toolbar (controller/Viewport.js -
   preventDefault), in Safari also body (view/Viewport.js). The field scrollbar works, the wheel does not;
   at the standard bar place (before the card, the base) - the same, the SDK. Here are their doubles on the row ancestors,
   the real FormulaBar.js (apply into the card) and real wheel events over the real markup and
   styles. A field that has something to scroll scrolls - expanded and collapsed, in focus too,
   at the edges it does not go beyond the field; the event does not reach the doubles. Where there is nothing to scroll (short
   text, the address) - the wheel is suppressed the standard way, as before. Ctrl+wheel (the sheet zoom) - the standard way. In
   the Standard and after a rollback - the standard way. The negative control is a module without the wheel handler. */
chromeTest('wheel_scrolls_the_formula_field', async () => {
    const LONG = Array.from({length: 60}, (_, i) => 'Line ' + (i + 1) + ': a long text that does not fit the formula field and goes down.').join(' ');
    await stage(false);
    await page.addScriptTag({path: path.join(ROOT, 'vendor/jquery/jquery.js')});
    await page.evaluate(() => {
        window.stockWheel = [];
        window.lastWheel = null;
        window.addEventListener('wheel', ev => { lastWheel = ev; }, {capture: true, passive: true});
        /* The ribbon: jquery.mousewheel attaches wheel, suppresses any. */
        document.getElementById('toolbar').addEventListener('wheel', ev => { stockWheel.push('toolbar'); ev.preventDefault(); }, {passive: false});
        /* The SDK on an ancestor: old types, without modifiers - suppresses and lets nothing further. */
        ['mousewheel', 'DOMMouseScroll'].forEach(t => document.querySelector('.layout-ct').addEventListener(t, ev => {
            stockWheel.push('sdk');
            if (ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey) return;
            ev.preventDefault();
            ev.stopPropagation();
        }, {passive: false}));
        /* The stock around the bar - exactly what FormulaBar reads. */
        const $ = window.jQuery, row = document.getElementById('cell-editing-box');
        const resize = {min: 36, multiply: {koeff: 20, offset: 16}};
        const api = {isCellEdited: false, asc_registerCallback() {}, asc_unregisterCallback() {}};
        const ctl = {api, editor: {$el: $(row), $cellcontent: $('#ce-cell-content'), keep_height: 74},
            expandEditorField() {}, changeCellEditorHeight() {}, onCellEditorTextChange() {}};
        const view = {celayout: {getItem: a => a === 'celleditor' ? {el: $(row), resize} : undefined, on() {}, off() {}, splitters: []},
            getCelleditorResizeOptions: () => ({min: 36, multiply: {koeff: 20, offset: 16}})};
        window.Common = {localStorage: {getItem: () => null, setItem() {}, removeItem() {}}, NotificationCenter: {on() {}, off() {}, trigger() {}}};
        window.Asc = {c_oAscCellEditorState: {editEnd: 0, editStart: 1}};
        window.SSE = {Views: {CompactShell: {advanced: false, guarded: (l, f) => f, formulaRowChanged() {}}},
            getController: n => n === 'CellEditor' ? ctl : n === 'Viewport' ? {viewport: view} : null};
        window.define = (deps, f) => f();
    });
    await page.addScriptTag({content: fs.readFileSync(file, 'utf8') + '\n//# sourceURL=FormulaBar.js'});
    await page.evaluate(long => {
        SSE.Views.FormulaBar.apply(document.getElementById('vo-plate'));
        document.getElementById('ce-cell-content').value = long;
    }, LONG);
    const field = () => page.evaluate(() => {
        const ta = document.getElementById('ce-cell-content');
        return {top: ta.scrollTop, max: ta.scrollHeight - ta.clientHeight, stock: stockWheel.slice(),
            prevented: !!(lastWheel && lastWheel.defaultPrevented), page: document.scrollingElement.scrollTop};
    });
    const spin = async (sel, deltas, mod) => {
        await page.evaluate(() => { stockWheel.length = 0; lastWheel = null; });
        const at = await page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect();
            return {x: r.left + Math.min(200, r.width / 2), y: r.top + r.height / 2}; }, sel);
        await page.mouse.move(at.x, at.y);
        if (mod) await page.keyboard.down(mod);
        try {
            for (const d of deltas) { await page.mouse.wheel(0, d); await page.waitForTimeout(20); }
        } finally {
            if (mod) await page.keyboard.up(mod);
        }
        await page.waitForTimeout(250);
        return field();
    };
    const toTop = () => page.evaluate(() => { document.getElementById('ce-cell-content').scrollTop = 0; });
    const FIELD = '#ce-cell-content';

    /* An expanded bar: a wheel click, small trackpad steps, the edge, back. */
    await expandRow();
    let f = await field();
    assert.ok(f.max > 200, 'precondition: the expanded field has much more text than it shows: ' + JSON.stringify(f));
    f = await spin(FIELD, [60]);
    assert.ok(f.top > 0, 'expanded: the wheel did not scroll the field: ' + JSON.stringify(f));
    assert.deepEqual([f.stock, f.prevented], [[], false], 'expanded: the wheel reached the stock handlers or was cancelled');
    const notch = f.top;
    f = await spin(FIELD, [5, 5, 5, 5, 5, 5, 5, 5]);
    assert.ok(f.top > notch, 'expanded: trackpad steps did not scroll the field: ' + JSON.stringify([notch, f.top]));
    assert.deepEqual(f.stock, [], 'trackpad: the steps reached the stock handlers');
    f = await spin(FIELD, [5000, 5000]);
    assert.deepEqual([f.top, f.page, f.stock], [f.max, 0, []], 'at the end: the field must stop at its end, the page must not move');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('ce-cell-content')).overscrollBehaviorY), 'contain',
        'the field passes its overscroll on');
    f = await spin(FIELD, [-60]);
    assert.ok(f.top < f.max, 'expanded: the wheel up did not scroll back: ' + JSON.stringify(f));
    /* In focus (an edit in the formula bar) - the same. */
    await toTop();
    await page.focus(FIELD);
    f = await spin(FIELD, [60]);
    assert.ok(f.top > 0 && !f.stock.length, 'editing: the wheel did not scroll the field: ' + JSON.stringify(f));
    await page.evaluate(() => document.activeElement.blur());
    /* A collapsed bar with the same text - the field has a bar too, the wheel scrolls it. */
    await page.evaluate(() => { const b = document.getElementById('cell-editing-box'); b.classList.remove('expanded'); b.style.height = '36px'; });
    await toTop();
    f = await spin(FIELD, [60]);
    assert.ok(f.max > 0 && f.top > 0 && !f.stock.length, 'collapsed: the wheel did not scroll the field: ' + JSON.stringify(f));
    /* Nothing to scroll - the standard way: short text, the address. */
    await toTop();
    await page.evaluate(() => { document.getElementById('ce-cell-content').value = 'Short'; });
    f = await spin(FIELD, [60]);
    assert.deepEqual([f.max, f.stock, f.prevented], [0, ['toolbar', 'sdk'], true], 'a short text: the wheel must go the stock way');
    await page.evaluate(long => { document.getElementById('ce-cell-content').value = long; }, LONG);
    f = await spin('#ce-cell-name', [60]);
    assert.deepEqual([f.stock, f.prevented], [['toolbar', 'sdk'], true], 'over the address: the wheel must go the stock way');
    /* Ctrl+wheel over the field is zoom: the standard way, the field stays. */
    await toTop();
    f = await spin(FIELD, [60], 'Control');
    assert.deepEqual([f.top, f.stock.includes('toolbar')], [0, true], 'Ctrl+wheel must go the stock way (zoom)');
    /* The Standard - the standard way; a return to the compact - scrolls again; a rollback - the standard way. */
    await page.evaluate(() => { SSE.Views.CompactShell.advanced = true; SSE.Views.FormulaBar.release(); });
    f = await spin(FIELD, [60]);
    assert.deepEqual([f.top, f.stock], [0, ['toolbar', 'sdk']], 'advanced mode: the wheel must go the stock way');
    await page.evaluate(() => { SSE.Views.CompactShell.advanced = false; SSE.Views.FormulaBar.apply(document.getElementById('vo-plate')); });
    f = await spin(FIELD, [60]);
    assert.ok(f.top > 0 && !f.stock.length, 'back in compact: the wheel did not scroll the field: ' + JSON.stringify(f));
    await toTop();
    await page.evaluate(() => SSE.Views.FormulaBar.dispose());
    f = await spin(FIELD, [60]);
    assert.deepEqual([f.top, f.stock], [0, ['toolbar', 'sdk']], 'after the rollback: the wheel must go the stock way');
});

/* The sheet row buttons ‹ › + ≡ − + - the glyph darkens, as for .vo-ib: at rest #525c69, on
   hover with a real mouse and while the mouse button is held - #333 (together with the background blend); for a button with
   an open list (the stock .active) - also #333. A disabled one (› with no sheets to the right) does not change on
   hover. */
chromeTest('sheet_tab_buttons_darken_glyph_on_hover', async () => {
    await stage(false);
    const look = id => page.evaluate(id => {
        document.getAnimations().forEach(a => a.finish());
        const b = document.getElementById(id), i = b.querySelector('.icon');
        return {glyph: getComputedStyle(i).backgroundColor, bg: getComputedStyle(b).backgroundColor};
    }, id);
    const center = id => page.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
    for (const id of ['status-btn-tabback', 'status-btn-addtab', 'status-btn-tabslist', 'status-btn-zoomdown', 'status-btn-zoomup']) {
        await page.mouse.move(...AWAY);
        assert.equal((await look(id)).glyph, EXPECTED.icon, id + ': glyph at rest');
        const [x, y] = await center(id);
        await page.mouse.move(x, y);
        /* Hover is visible by the background (the --vo-hover blend, it was there before the edit): :hover from a script of
           headless Chrome under playwright is not read. */
        const hover = await look(id);
        assert.deepEqual([hover.glyph, hover.bg], [EXPECTED.text, EXPECTED.hover], id + ': hover — the glyph darkens (.vo-ib:hover)');
        await page.mouse.down();
        const held = await look(id);
        await page.mouse.move(...AWAY);
        await page.mouse.up();
        assert.deepEqual([held.glyph, held.bg], [EXPECTED.text, EXPECTED.press], id + ': held mouse button');
    }
    /* The sheet list is open (the stock sets .active on the button with a menu), the mouse left. */
    await page.evaluate(() => document.getElementById('status-btn-tabslist').classList.add('active'));
    await page.mouse.move(...AWAY);
    const open = await look('status-btn-tabslist');
    assert.deepEqual([open.glyph, open.bg], [EXPECTED.text, EXPECTED.press], 'the sheet list button with its list open');
    /* A disabled button. */
    const off = await look('status-btn-tabnext');
    await page.mouse.move(...(await center('status-btn-tabnext')));
    assert.equal((await look('status-btn-tabnext')).glyph, off.glyph, 'a disabled button changed its glyph on hover');
});

/* The line above the tabs is the row line and above an inactive tab: the tab top border is
   the row line color, neither the standard tone nor a gap. The expected color is from the built row
   style: the inset shadow of .statusbar over its background (rgba(0,0,0,.08) on white - 234.6). The row itself
   Chrome draws with a shadow (235), and the top border of a tab with translucent side borders - by another
   path, with another alpha rounding (234); so the tolerance is rounding to a whole level, no
   more. A hovered inactive tab: its background #f7f7f7 covers the row line (247).
   The pixels are from a frame screenshot (DPR 1). */
chromeTest('sheet_tab_line_over_tabs', async () => {
    await stage(false);
    const geo = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('#statusbar .statusbar'));
        const rgba = v => (/rgba?\(([^)]+)\)/.exec(v) || [0, '0, 0, 0, 0'])[1].split(',').map(Number);
        const [r, g, b, a = 1] = rgba(s.boxShadow), bg = rgba(s.backgroundColor);
        const lineColor = [r, g, b].map((c, i) => bg[i] * (1 - a) + c * a);
        const row = document.getElementById('statusbar').getBoundingClientRect();
        const tabs = [...document.querySelectorAll('#status-sheets-bar .nav-tabs > li')].map(li => {
            const r = li.querySelector('span').getBoundingClientRect();
            return {active: li.classList.contains('active'), x: Math.round(r.left + r.width / 2), top: r.top, y: Math.round(row.top + row.height / 2)};
        });
        return {top: row.top, tabs, lineColor, shadow: s.boxShadow, bg: s.backgroundColor};
    });
    assert.ok(geo.tabs.length === 3 && geo.tabs.every(t => t.top === geo.top), 'precondition: tabs start at the row top ' + JSON.stringify(geo));
    const line = async x => decodePng(await page.screenshot({clip: {x: 0, y: geo.top, width: 1440, height: 1}})).px(x, 0);
    const grey = v => [v, v, v];
    /* A pixel is the row line color to within channel rounding. */
    const isRowLine = px => px.every((v, i) => Math.abs(v - geo.lineColor[i]) < 1);
    const want = 'the row line ' + geo.lineColor.map(v => v.toFixed(1)).join(', ') + ' (' + geo.shadow + ' on ' + geo.bg + ')';
    assert.ok(/inset/.test(geo.shadow) && geo.lineColor.some(v => v < 254), 'precondition: the row draws a line with its inset shadow: ' + geo.shadow);
    const atButtons = await line(20);
    assert.ok(isRowLine(atButtons), 'precondition: the row line over the buttons is ' + atButtons.join(', ') + ', expected ' + want);
    for (const t of geo.tabs.filter(t => !t.active)) {
        const px = await line(t.x);
        assert.ok(isRowLine(px), 'line over an inactive tab is ' + px.join(', ') + ', expected ' + want);
    }
    const t = geo.tabs.find(t => !t.active);
    await page.mouse.move(t.x, t.y);
    const hs = await page.evaluate(x => { document.getAnimations().forEach(a => a.finish());
        const s = getComputedStyle(document.querySelectorAll('#status-sheets-bar .nav-tabs > li > span')[x]);
        return [s.backgroundColor, s.borderTopWidth, s.borderTopColor].join(' '); }, geo.tabs.indexOf(t));
    assert.ok(/247, 247, 247/.test(hs), 'precondition: the tab under the mouse shows its hover background ' + hs);
    assert.deepEqual(await line(t.x), grey(EXPECTED.tabHoverTop), 'line over a hovered inactive tab — the tab background covers the row line (247): ' + hs);
});

/* The top of the grid area on the host theme. The host gets theme-white, and it has the standard
   --content-padding-top: 8px (colors-table-white.less) - a top padding of the grid area
   .layout-item.middle (common layout.less). Through the transparent padding #viewport of the color
   --background-pane (#f3f3f3) shows: a gray strip between the white top and the grid, the grid at 176 instead of 168
   (@vo-h-shell). In the compact and in the early start skeleton there is no padding: the grid is right under the rows,
   the pixels from the card bottom (46 + 30 + 4 + 44 + 36 = 160) to the grid are white. The formula bar in the compact is
   in the card, in the skeleton the standard bar is hidden (its row is drawn by the skeleton card). In the Standard the theme padding
   stays. The markup is the nesting and classes of the Viewport.template nodes, the heights and shifts are as the layout
   writes them. */
/* The engine canvas in the markup - filled with the column header row color (#f7f7f7) across the whole grid area. */
const TOP = {shell: 168, plateBottom: 160, themePad: 8, headerFill: '#f7f7f7', headerFillPx: 247};
const TOP_STAGE = (mode, theme) => {
    const inPlate = mode === 'vo-compact';
    const ce = `<div id="cell-editing-box" class="layout-item" style="top:0;height:36px">${CE_TEMPLATE}</div>`;
    return `<body class="${theme || 'theme-white'} theme-type-light ${mode}" style="margin:0">
<div id="viewport"><div class="layout-region"><div id="viewport-vbox-layout" class="layout-ct vbox">
  <div id="toolbar" class="layout-item" style="top:0;height:${TOP.shell}px"><div id="vo-shell">
    <div style="height:76px;flex:0 0 auto"></div>
    ${inPlate ? `<div id="vo-plate" class="vo-plate-split vo-plate-fx"><div id="vo-tb"></div>${ce}</div>` : ''}
  </div></div>
  <div class="layout-item middle" style="top:${TOP.shell}px;height:300px">
    <div id="viewport-hbox-layout" class="layout-ct hbox"><div class="layout-item" style="left:0;width:1440px"><div class="layout-ct vbox">
      ${inPlate ? '<div class="vo-ce-home" style="display:none"></div>' : ce}
      <div id="editor_sdk" class="layout-item" style="top:0;height:200px"><div id="ws-canvas-outer" style="height:100%;background:${TOP.headerFill}"></div></div>
    </div></div></div>
  </div>
</div></div></div></body>`;
};
async function topLook(mode) {
    await page.setContent(`<style>${CSS}</style>${TOP_STAGE(mode)}`);
    await page.evaluate(() => document.getAnimations().forEach(a => a.finish()));
    return page.evaluate(() => {
        const ce = document.getElementById('cell-editing-box');
        return {
            themePad: getComputedStyle(document.body).getPropertyValue('--content-padding-top').trim(),
            pad: getComputedStyle(document.querySelector('.layout-item.middle')).paddingTop,
            gridTop: document.getElementById('editor_sdk').getBoundingClientRect().top,
            ceShown: ce.getClientRects().length > 0,
            ceBottom: ce.getBoundingClientRect().bottom
        };
    });
}

chromeTest('theme_white_no_strip_above_the_grid', async () => {
    for (const mode of ['vo-compact', 'vo-boot']) {
        const look = await topLook(mode);
        assert.equal(look.themePad, TOP.themePad + 'px', mode + ': precondition: theme-white sets --content-padding-top ' + TOP.themePad);
        assert.equal(look.pad, '0px', mode + ': the grid area keeps the theme padding above the grid: ' + look.pad);
        assert.equal(look.gridTop, TOP.shell, mode + ': the grid starts at ' + look.gridTop + ', not right under the rows (' + TOP.shell + ')');
        if (mode === 'vo-compact') assert.equal(look.ceBottom, TOP.plateBottom, 'vo-compact: the formula row is not the bottom row of the plate');
        else assert.equal(look.ceShown, false, 'vo-boot: the stock formula row is shown under the skeleton plate');
        const shot = decodePng(await page.screenshot({clip: {x: 0, y: TOP.plateBottom, width: 1440, height: look.gridTop - TOP.plateBottom}}));
        const off = [];
        for (let y = 0; y < shot.h; y++) {
            for (const x of [20, 720, 1420]) {
                const px = shot.px(x, y);
                if (px.some(v => v !== 255)) off.push((TOP.plateBottom + y) + '@' + x + ':' + px.join(','));
            }
        }
        assert.deepEqual(off, [], mode + ': pixels between the plate and the grid are not white');
    }
});

/* There is no line above the column headers.
   The strip is the standard top border of the grid area (layout.less: #editor_sdk border-top:
   var(--border-editor-sdk) - 1px of the --border-toolbar color by default and in the light theme of the test page; in
   theme-white it is absent): under the white card gap there is a dark line right above the headers. In the compact and
   in the early start skeleton it is absent: the canvas starts at the top of the grid area (168), the row 168 is the header
   fill, the row above it is the white gap under the card. In the Standard the stock border stays. */
chromeTest('no_line_above_the_column_headers', async () => {
    for (const mode of ['vo-compact', 'vo-boot', 'vo-advanced']) {
        await page.setContent(`<style>${CSS}</style>${TOP_STAGE(mode, 'theme-light')}`);
        const look = await page.evaluate(() => {
            const sdk = document.getElementById('editor_sdk'), s = getComputedStyle(sdk);
            return {stock: getComputedStyle(document.body).getPropertyValue('--border-editor-sdk').trim(), width: s.borderTopWidth,
                    sdkTop: sdk.getBoundingClientRect().top, canvasTop: document.getElementById('ws-canvas-outer').getBoundingClientRect().top};
        });
        assert.ok(/solid/.test(look.stock), mode + ': precondition: the light theme gives the grid area a top border: ' + look.stock);
        if (mode === 'vo-advanced') {
            assert.equal(look.width, '1px', 'vo-advanced: the stock border above the grid is gone: ' + look.width);
            continue;
        }
        assert.equal(look.sdkTop, TOP.shell, mode + ': precondition: the grid area starts at ' + TOP.shell);
        assert.equal(look.width, '0px', mode + ': a line above the column headers — #editor_sdk border-top ' + look.width);
        assert.equal(look.canvasTop, TOP.shell, mode + ': the canvas starts at ' + look.canvasTop + ', not at the grid area top');
        const shot = decodePng(await page.screenshot({clip: {x: 0, y: TOP.shell - 1, width: 1440, height: 2}}));
        for (const x of [20, 720, 1420]) {
            assert.deepEqual(shot.px(x, 0), [255, 255, 255], mode + ': the gap under the plate is not white at ' + x);
            assert.deepEqual(shot.px(x, 1), [TOP.headerFillPx, TOP.headerFillPx, TOP.headerFillPx], mode + ': row ' + TOP.shell + ' is not the column header fill at ' + x + ': ' + shot.px(x, 1).join(','));
        }
    }
});

/* The Standard (vo-advanced) is the stock look: the theme padding stays, the grid at 168 + 8. */
chromeTest('theme_white_padding_kept_in_advanced', async () => {
    const look = await topLook('vo-advanced');
    assert.equal(look.pad, TOP.themePad + 'px', 'vo-advanced: the theme padding of the grid area is ' + look.pad);
    assert.equal(look.gridTop, TOP.shell + TOP.themePad, 'vo-advanced: the grid starts at ' + look.gridTop);
});

(async () => {
    let chromium = null;
    try { ({chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
    catch (e) { console.error('FAIL playwright is not available (set NODE_PATH or PLAYWRIGHT_MODULE): ' + e.message); failed++; }
    if (chromium) {
        CSS = await appCss();
        const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
        try {
            page = await browser.newPage({viewport: {width: 1440, height: 480}, deviceScaleFactor: 1});
            for (const [name, fn] of chromeTests) {
                try {
                    await fn();
                    console.log('PASS', name);
                    passed++;
                } catch (error) {
                    console.error('FAIL', name, '—', error && error.message);
                    failed++;
                }
            }
        } finally {
            await browser.close();
        }
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
