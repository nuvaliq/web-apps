/* Run: node test/unit-tests/documenteditor/selection-bubble-anchor.cjs */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.resolve(__dirname,
    '../../../apps/documenteditor/main/app/view/SelectionBubble.js'), 'utf8');

function fixture() {
    const rect = {left: 100, top: 100, right: 1100, bottom: 800};
    const nodes = {id_main_view: {getBoundingClientRect: () => rect},
        editor_sdk: {getBoundingClientRect: () => rect}};
    const callbacks = {}, events = [], timers = new Map(), removed = [];
    let number = 0;
    const shape = (id, page = 0) => ({Get_Id: () => id, selectStartPage: page});
    const controller = {selection: {}, objects: [shape('a')],
        getSelectedArray() {return this.objects;},
        getSelectedObjectsBounds(flag) {assert.equal(flag, true); return this.bounds;},
        bounds: {minX: 20, minY: 30, maxX: 60, maxY: 70, pageIndex: 0}};
    const drawing = {m_arrPages: [{}, {}],
        ConvertCoordsToCursor(x, y, page) {return {X: x * 2, Y: y * 2 - page * 10, Error: false};}};
    const api = {WordControl: {m_oLogicDocument: {DrawingObjects: controller}, m_oDrawingDocument: drawing},
        getSelectedElements: () => [{get_ObjectType: () => 2, get_ObjectValue: () => ({})}],
        asc_GetSelectionBounds: () => [[0, 0], [0, 0], [0, 0], [0, 0]],
        asc_registerCallback(n, f) {callbacks[n] = f;}, can_CopyCut: () => true};
    api.asc_unregisterCallback = (n, f) => {
        removed.push(n); if (callbacks[n] === f) delete callbacks[n];
    };
    class Node {
        constructor() {this.classes = new Set(); this.length = 1;}
        addClass(s) {this.classes.add(s); return this;}
        removeClass(s) {this.classes.delete(s); return this;}
        hasClass(s) {return this.classes.has(s);}
        children() {return [1];}
        css(p) {this.position = p; return this;}
        outerWidth() {return 200;}
        outerHeight() {return 40;}
        offset() {return {left: 100, top: 100};}
        width() {return 1200;}
        height() {return 900;}
        on(names, selector, fn) {events.push({names, selector, fn: fn || selector}); return this;}
        off() {return this;}
        toArray() {return [];}
    }
    const win = {innerWidth: 1200, innerHeight: 900, pageXOffset: 0, pageYOffset: 0,
        addEventListener() {}, removeEventListener() {}};
    const doc = {getElementById: id => nodes[id]};
    const DE = {Views: {CompactShell: {advanced: false, editingLocked: () => false}}};
    const context = {window: win, document: doc, DE, Asc: {c_oAscTypeSelectElement:
        {Paragraph: 0, Table: 1, Image: 2, Shape: 3, Chart: 4, Math: 5}},
        _: {extend: Object.assign}, $: () => new Node(),
        Common: {NotificationCenter: {on(names, fn) {events.push({names, fn});}, off() {}}},
        clearTimeout(id) {timers.delete(id);}, setTimeout(fn) {timers.set(++number, fn); return number;},
        define(deps, factory) {factory({});}};
    win.Asc = context.Asc;
    vm.runInNewContext(source, context);
    const bubble = DE.Views.SelectionBubble;
    bubble.api = api; bubble.$el = new Node(); bubble.renderSet = kind => {bubble.kind = kind;};
    return {bubble, api, controller, drawing, rect, nodes, win, doc, shape, events, callbacks, timers, removed,
        fire(name, ...args) {
            events.filter(e => e.names.split(' ').some(n => n.split('.')[0] === name)).forEach(e => e.fn(...args));
        }, drain() {const list = [...timers.values()]; timers.clear(); list.forEach(fn => fn());}};
}
const plain = v => JSON.parse(JSON.stringify(v));
let failed = 0, passed = 0;
function check(name, run) {
    try {run(fixture()); passed++; console.log('PASS', name);}
    catch (e) {failed++; console.error('FAIL', name, e.stack);}
}
check('graphics_ignore_text_bounds', h => {
    h.bubble.refresh();
    assert.equal(h.bubble.isOpen(), true);
    assert.deepEqual(plain(h.bubble.$el.position), {left: '108px', top: '282px'});
});
check('page_and_container_offsets_applied_once', h => {
    h.controller.objects[0].selectStartPage = 1; h.controller.bounds.pageIndex = 1;
    h.win.pageXOffset = 7; h.win.pageYOffset = 11;
    const a = h.bubble.readAnchor({kind: 'image'});
    assert.deepEqual(plain(a.rect), {left: 147, top: 161, right: 227, bottom: 241});
});
check('grouped_child_uses_group_page', h => {
    h.controller.selection.groupSelection = {selectStartPage: 1};
    h.controller.bounds.pageIndex = 1;
    assert(h.bubble.readAnchor({kind: 'image'}));
});
check('multi_page_hidden', h => {
    h.controller.objects.push(h.shape('b', 1)); h.bubble.refresh();
    assert.equal(h.bubble.isOpen(), false);
});
check('finite_and_ordered_bounds_required', h => {
    for (const bounds of [null, {}, {...h.controller.bounds, minX: NaN},
        {...h.controller.bounds, maxY: Infinity}, {...h.controller.bounds, maxX: 0},
        {...h.controller.bounds, pageIndex: 2}, {...h.controller.bounds, pageIndex: -1}]) {
        h.controller.bounds = bounds; h.bubble.refresh(); assert.equal(h.bubble.isOpen(), false);
    }
});
check('missing_sdk_hidden', h => {
    delete h.controller.getSelectedObjectsBounds; h.bubble.refresh(); assert.equal(h.bubble.isOpen(), false);
});
check('conversion_error_hidden', h => {
    h.drawing.ConvertCoordsToCursor = () => ({X: 3, Y: 4, Error: true});
    h.bubble.refresh(); assert.equal(h.bubble.isOpen(), false);
});
check('zero_sentinel_hidden_for_text', h => {
    h.api.getSelectedElements = () => [{get_ObjectType: () => 0}];
    h.bubble.refresh(); assert.equal(h.bubble.isOpen(), false);
});
check('line_bounds_valid', h => {
    for (const axis of ['maxX', 'maxY']) {
        const b = {minX: 20, minY: 30, maxX: 60, maxY: 70, pageIndex: 0};
        b[axis] = b[axis === 'maxX' ? 'minX' : 'minY']; h.controller.bounds = b;
        assert(h.bubble.readAnchor({kind: 'image'}));
    }
});
check('offscreen_and_point_contact_hidden', h => {
    for (const r of [{left: -40, right: 0, top: 200, bottom: 240},
        {left: 80, right: 100, top: 80, bottom: 100}]) {
        assert.equal(h.bubble.placement(r, h.rect, {width: 200, height: 40}), null);
    }
});
check('bottom_fallback_and_narrow_frame_without_space', h => {
    assert.deepEqual(plain(h.bubble.placement({left: 400, right: 440, top: 110, bottom: 150},
        h.rect, {width: 200, height: 40})), {left: 320, top: 192});
    assert.equal(h.bubble.placement({left: 400, right: 440, top: 100, bottom: 800},
        h.rect, {width: 200, height: 40}), null);
});
check('visible_chrome_clips_the_document_area', h => {
    h.nodes['vo-tb'] = {getBoundingClientRect: () => ({left: 110, right: 1090, top: 90, bottom: 146})};
    h.nodes['vo-status'] = {getBoundingClientRect: () => ({left: 100, right: 1100, top: 770, bottom: 800})};
    assert.deepEqual(plain(h.bubble.availableRect()), {...h.rect, top: 146, bottom: 770});
    h.nodes['vo-tb'].getBoundingClientRect = () => ({left: 0, right: 0, top: 0, bottom: 0});
    h.nodes['vo-status'].getBoundingClientRect = () => ({left: 100, right: 1100, top: 800, bottom: 830});
    assert.deepEqual(plain(h.bubble.availableRect()), h.rect);
});
check('large_object_uses_the_visible_part_of_its_frame', h => {
    const frame = {left: 20, right: 800, top: 40, bottom: 900};
    assert.deepEqual(plain(h.bubble.placement(frame, h.rect, {width: 200, height: 40})),
        {left: 350, top: 430});
});
check('bottom_fallback_leaves_rotated_handle_available', h => {
    const p = h.bubble.placement({left: 400, right: 600, top: 170, bottom: 270},
        h.rect, {width: 200, height: 40});
    assert(p.top > 295 + 6);
});
check('line_clipping_and_partial_object', h => {
    assert(h.bubble.placement({left: 400, right: 400, top: 200, bottom: 250},
        h.rect, {width: 200, height: 40}));
    assert(h.bubble.placement({left: 50, right: 300, top: 200, bottom: 400},
        h.rect, {width: 200, height: 40}));
});
check('layout_refreshes_open_graphic_and_not_hidden', h => {
    h.bubble.bind(); h.bubble.refresh();
    h.controller.bounds.minX += 100; h.controller.bounds.maxX += 100;
    h.fire('resize'); assert.equal(h.timers.size, 1); h.drain();
    assert.equal(h.bubble.$el.position.left, '280px');
    h.bubble.hide(); h.fire('resize'); assert.equal(h.timers.size, 0);
});
check('escape_survives_geometry_and_selection_order', h => {
    h.controller.objects.push(h.shape('b')); h.bubble.refresh(); h.bubble.dismiss();
    h.controller.objects.reverse(); h.controller.bounds.minX += 10;
    h.bubble.refresh(); assert.equal(h.bubble.isOpen(), false);
    h.controller.objects = [h.shape('c')]; h.bubble.refresh(); assert.equal(h.bubble.isOpen(), true);
});
check('scroll_and_zoom_cancel_pending_refresh', h => {
    h.bubble.bind();
    for (const name of ['wheel', 'scroll']) {
        h.bubble.scheduleRefresh(); const stale = [...h.timers.values()][0];
        h.fire(name); assert.equal(h.timers.size, 0); stale(); assert.equal(h.bubble.isOpen(), false);
    }
    h.bubble.scheduleRefresh(); h.callbacks.asc_onZoomChange(); assert.equal(h.timers.size, 0);
});
check('scroll_restores_the_same_object_with_fresh_coordinates', h => {
    const bar = {bind: (name, fn) => {bar.scroll = fn;}, unbind() {}};
    h.api.WordControl.m_oScrollVerApi = bar;
    h.bubble.bind(); h.bubble.refresh();
    h.controller.bounds.minY += 50; h.controller.bounds.maxY += 50;
    bar.scroll(); assert.equal(h.bubble.isOpen(), false);
    const stale = [...h.timers.values()][0];
    h.fire('wheel'); assert.equal(h.timers.size, 1);
    stale(); assert.equal(h.bubble.isOpen(), false);
    h.drain();
    assert.equal(h.bubble.isOpen(), true);
    assert.equal(h.bubble.$el.position.top, '180px');
});
check('scroll_can_bring_the_same_object_back_into_view', h => {
    h.bubble.bind(); h.bubble.refresh();
    h.controller.bounds = {...h.controller.bounds, minY: -100, maxY: -50};
    h.fire('scroll'); h.drain(); assert.equal(h.bubble.isOpen(), false);
    h.controller.bounds = {...h.controller.bounds, minY: 30, maxY: 70};
    h.fire('scroll'); h.drain(); assert.equal(h.bubble.isOpen(), true);
});
check('scroll_does_not_restore_a_dismissed_object', h => {
    h.bubble.bind(); h.bubble.refresh(); h.bubble.dismiss();
    h.fire('wheel'); h.drain(); assert.equal(h.bubble.isOpen(), false);
});
check('modal_close_restores_the_same_object_after_the_last_dialog', h => {
    h.bubble.bind(); h.bubble.refresh();
    const a = {}, b = {};
    h.fire('modal:show', a); h.fire('modal:show', b);
    h.fire('modal:hide', a); h.drain(); assert.equal(h.bubble.isOpen(), false);
    h.fire('modal:close', b); h.drain(); assert.equal(h.bubble.isOpen(), true);
});
check('modal_close_does_not_open_for_a_different_object', h => {
    h.bubble.bind(); h.bubble.refresh();
    const dialog = {};
    h.fire('modal:show', dialog);
    h.controller.objects = [h.shape('b')];
    h.fire('modal:close', dialog); h.drain(); assert.equal(h.bubble.isOpen(), false);
});
check('nested_modals_remain_blocked_and_close_idempotently', h => {
    h.bubble.bind();
    const a = {$window: [{}]}, b = {$window: [{}]};
    h.fire('modal:show', a); h.fire('modal:show', b);
    h.fire('modal:close', a); h.fire('modal:hide', a);
    h.bubble.refresh(); assert.equal(h.bubble.isOpen(), false);
    h.fire('modal:hide', b); assert.equal(h.bubble.isOpen(), false);
    h.bubble.refresh(); assert.equal(h.bubble.isOpen(), true);
});
check('first_modal_is_tracked_before_render', h => {
    h.bubble.bind(); const dialog = {};
    h.fire('modal:show', dialog);
    dialog.$window = [{}];
    h.bubble.refresh(); assert.equal(h.bubble.isOpen(), false);
    h.fire('modal:hide', dialog); h.bubble.refresh(); assert.equal(h.bubble.isOpen(), true);
});
check('repeated_bind_and_dispose_preserve_generation', h => {
    h.bubble.bind(); const n = h.events.length, old = h.callbacks.asc_onFocusObject;
    h.bubble.bind(); assert.equal(h.events.length, n);
    h.bubble.scheduleRefresh(); h.bubble.dispose();
    assert(h.removed.includes('asc_onFocusObject')); assert.equal(h.timers.size, 0);
    h.bubble.bind(); old(h.api.getSelectedElements()); assert.equal(h.timers.size, 0);
    h.callbacks.asc_onFocusObject(h.api.getSelectedElements()); assert.equal(h.timers.size, 1);
});
check('scrollbar_replacement_unbinds_only_owned_namespace', h => {
    const log = [], bar = () => ({bind: n => log.push('bind '+n), unbind: n => log.push('unbind '+n)});
    h.api.WordControl.m_oScrollVerApi = bar(); h.bubble.bind();
    h.api.WordControl.m_oScrollVerApi = bar(); h.bubble.bindScrollbars(); h.bubble.dispose();
    assert.deepEqual(log, ['bind scrollvertical.voBubble','unbind scrollvertical.voBubble',
        'bind scrollvertical.voBubble','unbind scrollvertical.voBubble']);
});
check('guards_hide_before_geometry', h => {
    h.bubble.bind(); let queries = 0;
    h.controller.getSelectedObjectsBounds = () => {queries++; throw Error('should not query');};
    h.bubble.modalNodes.push({}); h.bubble.refresh(); assert.equal(queries, 0);
    h.bubble.dispose(); h.bubble.refresh(); assert.equal(queries, 0);
});
if (require.main === module) {
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
}
module.exports = {fixture, check, plain};
