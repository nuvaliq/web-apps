/* Run: node test/unit-tests/documenteditor/selection-bubble-math.cjs */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const file = process.argv[2] || path.resolve(__dirname, '../../../apps/documenteditor/main/app/view/SelectionBubble.js');
const source = fs.readFileSync(file, 'utf8');
const T = {Paragraph: 0, Table: 1, Image: 2, Shape: 3, Chart: 4, Math: 5};
const element = (type, value = {}) => ({get_ObjectType: () => type, get_ObjectValue: () => value});
const text = () => [element(T.Paragraph)];
const math = () => [element(T.Math)];
function harness() {
    const handlers = [], nativeHandlers = [], notifications = [], callbacks = {}, timers = new Map();
    let next = 0, queries = 0, renders = 0, stack = text(), bounds = [[100, 100], [200, 120]], selection = true, locked = false;
    class Node {
        constructor() { this.classes = new Set(); this.nodes = []; }
        on(events, selector, fn) { handlers.push({node: this, events, selector: typeof selector === 'string' ? selector : null, fn: fn || selector}); return this; }
        toArray() { return []; }
        closest() { return []; }
        off() { return this; }
        addClass(c) { this.classes.add(c); return this; }
        removeClass(c) { this.classes.delete(c); return this; }
        hasClass(c) { return this.classes.has(c); }
        toggleClass(c, v) { return v ? this.addClass(c) : this.removeClass(c); }
        append(n) { this.nodes.push(n); return this; }
        appendTo() { return this; }
        empty() { this.nodes = []; return this; }
        children() { return this.nodes; }
        attr() { return this; }
        html() { return this; }
        css(value) { this.position = value; return this; }
        offset() { return {left: 10, top: 20}; }
        width() { return 1000; }
        outerWidth() { return 200; }
        outerHeight() { return 40; }
    }
    const canvas = {getBoundingClientRect: () => ({left: 10, top: 20, right: 1000, bottom: 900})};
    const doc = {getElementById: id => id === 'id_main_view' || id === 'editor_sdk' ? canvas : null},
        documentNode = new Node(),
        editorNode = new Node(), windowNode = new Node();
    const remove = (listeners, match) => {
        const index = listeners.findIndex(match);
        if (index !== -1) listeners.splice(index, 1);
    };
    const win = {innerWidth: 1000, innerHeight: 900,
        addEventListener: (name, fn, capture = false) => nativeHandlers.push({name, fn, capture}),
        removeEventListener: (name, fn, capture = false) =>
            remove(nativeHandlers, entry => entry.name === name && entry.fn === fn && entry.capture === capture)};
    const shell = {advanced: false, editingLocked: () => locked, canAddComment: () => true};
    const DE = {Views: {CompactShell: shell}};
    const graphics = {selection: {}, getSelectedArray: () => [{Get_Id: () => 'drawing', selectStartPage: 0}],
        getSelectedObjectsBounds: () => ({minX: 100, minY: 100, maxX: 200, maxY: 140, pageIndex: 0})};
    const api = {WordControl: {m_oLogicDocument: {DrawingObjects: graphics}, m_oDrawingDocument: {
        m_arrPages: [{}], ConvertCoordsToCursor: (x, y) => ({X: x, Y: y, Error: false})}},
        getSelectedElements() { queries++; if (stack instanceof Error) throw stack; return stack; },
        asc_GetSelectionBounds: () => bounds, can_CopyCut: () => selection,
        asc_registerCallback: (n, fn) => {callbacks[n] = fn;},
        asc_unregisterCallback: (n, fn) => {if (callbacks[n] === fn) delete callbacks[n];},
        ClearFormating() {}, asc_addComment() {}, addRowAbove() {}, addRowBelow() {}, addColumnLeft() {}, addColumnRight() {}, MergeCells() {}, remRow() {}, remColumn() {}};
    Object.assign(win, {DE, Asc: {c_oAscTypeSelectElement: T}});
    const context = {window: win, document: doc, DE, Asc: win.Asc, _: {extend: Object.assign},
        $: x => x === doc ? documentNode : x === win ? windowNode : x === '#editor_sdk' ? editorNode : new Node(),
        Common: {NotificationCenter: {
            on: (name, fn) => notifications.push({name, fn}),
            off: (name, fn) => remove(notifications, entry => entry.name === name && entry.fn === fn)
        }},
        setTimeout(fn, delay) { assert.equal(delay, 10); const id = ++next; timers.set(id, {fn, canceled: false}); return id; },
        clearTimeout(id) { if (timers.has(id)) timers.get(id).canceled = true; },
        define: (deps, factory) => factory({svg: name => name})};
    vm.runInNewContext(source, context, {filename: file});
    const b = DE.Views.SelectionBubble;
    b.api = api; b.toolbar = {}; b.$el = new Node();
    const render = b.renderSet;
    b.renderSet = function(kind) { renders++; return render.call(this, kind); };
    b.bind();
    const keydown = {target: {closest: () => true}, key: 'ArrowRight', shiftKey: true};
    const manual = () => nativeHandlers.filter(h => h.name === 'keydown').forEach(h => h.fn(keydown));
    return {b, api, shell, win, context, callbacks, timers, manual, keydown, nativeHandlers, notifications,
        stack(v) { stack = v; }, bounds(v) { bounds = v; }, selection(v) { selection = v; }, lock(v) { locked = v; },
        queries: () => queries, renders: () => renders,
        fire(id) { timers.get(id).fn(); }, live: () => [...timers].filter(([, t]) => !t.canceled),
        event(name, selector = '#editor_sdk, #editor_sdk *') { handlers.filter(h => h.events.split(' ').some(n => n.split('.')[0] === name) && h.selector === selector).forEach(h => h.fn({target: editorNode})); }};
}
function hidden(h) { assert.equal(h.b.isOpen(), false); assert.equal(h.b.pending, null); assert.equal(h.b.imgProps, null); }
let passed = 0, failed = 0;
function check(name, fn) { try { fn(harness()); passed++; console.log('PASS', name); } catch(e) { failed++; console.error('FAIL', name, e.stack); } }
check('math_overrides_stack_permutations', h => {
    const permutations = [[5,1,2],[5,2,1],[1,5,2],[1,2,5],[2,5,1],[2,1,5]];
    permutations.forEach(types => { h.b.$el.addClass('open'); h.b.detect(types.map(t => element(t))); hidden(h); });
    assert.equal(h.renders(), 0);
});
check('math_survives_malformed_neighbors', h => {
    [null, {}, {get_ObjectType: 1}, {get_ObjectType() { throw Error('type'); }}].forEach(bad => {
        [[bad, ...math()], [...math(), bad]].forEach(stack => { h.b.detect(stack); hidden(h); assert.equal(h.b.classifyContext(stack).state, 'math'); });
    });
});
check('math_needs_no_value', h => { h.b.detect([{get_ObjectType: () => T.Math, get_ObjectValue() {throw Error('unused');}}]); hidden(h); });
check('unknown_clears_pending_image', h => {
    const bad = [null, undefined, [], {}, 'stack', [null], [{}], [{get_ObjectType() {throw Error('type');}}], [element(T.Image, null)], [{get_ObjectType: () => T.Image, get_ObjectValue() {throw Error('value');}}]];
    bad.forEach(stack => { h.b.detect([element(T.Image)]); h.b.$el.addClass('open'); h.b.detect(stack); hidden(h); });
    delete h.win.Asc; h.b.detect(text()); hidden(h);
    h.context.Asc = h.win.Asc = {}; h.b.detect(text()); hidden(h);
    h.context.Asc = h.win.Asc = {c_oAscTypeSelectElement: {}}; h.b.detect(text()); hidden(h);
});
check('fresh_stack_overrides_callback', h => {
    h.callbacks.asc_onFocusObject(text()); h.stack(math()); h.fire(h.b.refreshTimer); hidden(h); assert.equal(h.renders(), 0);
    h.callbacks.asc_onFocusObject(math()); h.stack(text()); h.b.refresh(); assert.equal(h.b.isOpen(), true); assert.equal(h.b.kind, 'text');
});
check('empty_current_stack_has_no_stale_fallback', h => { h.callbacks.asc_onFocusObject([element(T.Image)]); h.stack([]); h.b.refresh(); hidden(h); assert.equal(h.renders(), 0); });
check('absent_throwing_api_hides', h => {
    [undefined, null, [], {}, Error('query')].forEach(v => {h.stack(v); h.b.$el.addClass('open'); h.b.refresh(); hidden(h);});
    delete h.api.getSelectedElements; h.b.refresh(); hidden(h); h.api.getSelectedElements = 1; h.b.refresh(); hidden(h);
});
check('unknown_recovers_known', h => {
    [T.Table, T.Image, T.Paragraph].forEach(type => {h.stack(Error('temporary')); h.b.refresh(); hidden(h); h.stack([element(type)]); h.b.refresh(); assert.equal(h.b.isOpen(), true); assert.equal(h.b.kind, type === T.Table ? 'table' : type === T.Image ? 'image' : 'text'); assert.ok(h.b.$el.children().length);});
});
check('canceled_callback_cannot_refresh_new_generation', h => {
    h.callbacks.asc_onFocusObject(text()); const old = h.b.refreshTimer;
    h.callbacks.asc_onFocusObject(math()); assert.equal(h.timers.get(old).canceled, true); h.fire(old); hidden(h); assert.equal(h.queries(), 0);
    h.callbacks.asc_onFocusObject(text()); const fresh = h.b.refreshTimer; h.fire(old); assert.equal(h.b.refreshTimer, fresh); assert.equal(h.queries(), 0);
    h.fire(fresh); assert.equal(h.b.isOpen(), true); assert.equal(h.b.refreshTimer, null); assert.equal(h.queries(), 1);
});
check('burst_has_one_live_refresh', h => {
    for(let i=0;i<8;i++) { h.event('mouseup'); h.event('keyup'); }
    assert.equal(h.live().length, 1); const current = h.b.refreshTimer;
    [...h.timers.keys()].filter(id => id !== current).forEach(id => h.fire(id)); assert.equal(h.queries(), 0);
    h.fire(current); assert.equal(h.queries(), 1); assert.equal(h.renders(), 1);
});
check('mouseup_keyup_cannot_restore_math', h => {h.stack(math()); h.callbacks.asc_onFocusObject(math()); assert.equal(h.timers.size, 0); ['mouseup','keyup'].forEach(name => {h.event(name); h.fire(h.b.refreshTimer); hidden(h);}); assert.equal(h.renders(), 0);});
check('modes_hide_before_query', h => {h.b.$el.addClass('open'); h.shell.advanced = true; h.b.refresh(); assert.equal(h.b.isOpen(), false); h.shell.advanced = false; h.lock(true); h.b.$el.addClass('open'); h.b.refresh(); assert.equal(h.b.isOpen(), false); assert.equal(h.queries(), 0);});
check('return_from_modes_rechecks_math', h => {h.stack(math()); h.shell.advanced = true; h.b.refresh(); h.shell.advanced = false; h.b.refresh(); hidden(h); h.lock(true); h.b.refresh(); h.lock(false); h.b.refresh(); hidden(h); h.stack(text()); h.b.refresh(); assert.equal(h.b.isOpen(), true);});
check('escape_preserves_same_selection', h => {
    h.b.refresh(); h.b.dismiss(); const dismissed = h.b.dismissed; h.b.refresh(); assert.equal(h.b.isOpen(), false);
    h.stack(math()); h.b.refresh(); assert.equal(h.b.dismissed, dismissed); h.stack([]); h.b.refresh(); assert.equal(h.b.dismissed, dismissed);
    h.stack(text()); h.b.refresh(); assert.equal(h.b.isOpen(), false); assert.equal(h.b.dismissed, dismissed);
});
check('new_signature_gesture_restores_known', h => {h.b.refresh(); h.b.dismiss(); h.bounds([[120,120],[240,140]]); h.b.refresh(); assert.equal(h.b.isOpen(), true); h.b.dismiss(); h.event('mousedown', '#editor_sdk'); h.event('mouseup'); h.fire(h.b.refreshTimer); assert.equal(h.b.isOpen(), true); h.stack(math()); h.event('mousedown', '#editor_sdk'); h.event('keyup'); h.fire(h.b.refreshTimer); hidden(h);});
check('text_requires_selection', h => {h.selection(false); h.b.refresh(); assert.equal(h.b.isOpen(), false); assert.equal(h.renders(), 0); h.selection(true); h.b.refresh(); assert.equal(h.b.isOpen(), true); assert.deepEqual({...h.b.$el.position}, {left:'60px',top:'72px'});});
check('image_precedes_table', h => {
    [T.Image,T.Shape,T.Chart].forEach(type => {
        h.stack([element(T.Table),element(type)]); h.b.refresh();
        assert.equal(h.b.kind,'image'); assert.equal(h.b.isOpen(),true);
    });
    h.bounds(null); h.b.refresh(); assert.equal(h.b.isOpen(),true);
    h.api.WordControl.m_oLogicDocument.DrawingObjects.getSelectedObjectsBounds = () => null;
    h.b.refresh(); assert.equal(h.b.isOpen(),false);
});
check('table_caret_and_cells_preserved', h => {
    h.stack([element(T.Table)]);
    for (const bounds of [[[100,100],[100,120]], [[100,100],[300,180]]]) {
        h.bounds(bounds); h.b.refresh();
        assert.equal(h.b.kind, 'table'); assert.equal(h.b.isOpen(), true);
    }
});
check('manual input subscriptions are removed and stale callbacks are inert after rebind', h => {
    const staleSearch = h.callbacks.asc_onSetSearchCurrent;
    const staleManual = h.notifications.find(entry => entry.name === 'selection:manual').fn;
    const staleKeydown = h.nativeHandlers.find(entry => entry.name === 'keydown').fn;
    const nativeCount = h.nativeHandlers.length;

    h.b.dispose();
    assert.equal(h.nativeHandlers.length, 0);
    assert.equal(h.notifications.length, 0);
    assert.equal(h.callbacks.asc_onSetSearchCurrent, undefined);

    h.b.bind();
    assert.equal(h.nativeHandlers.length, nativeCount);
    assert.equal(h.notifications.filter(entry => entry.name === 'selection:manual').length, 1);
    h.callbacks.asc_onSetSearchCurrent(0);
    staleManual();
    staleKeydown(h.keydown);
    h.b.refresh();
    assert.equal(h.b.isOpen(), false);
    h.manual();
    staleSearch(0);
    h.b.refresh();
    assert.equal(h.b.isOpen(), true);
    h.callbacks.asc_onSetSearchCurrent(0);
    assert.equal(h.b.isOpen(), false);
});
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
