/* Run: node test/unit-tests/documenteditor/table-properties-panel.cjs [source root]
 * Exercise the bubble action with the stock sidebar controller and view.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = process.argv[2] || path.resolve(__dirname, '../../..');
const T = {Paragraph: 10, Table: 20, Image: 30, Shape: 40, Chart: 50, Math: 60};
const S = {Paragraph: 0, Table: 1, Image: 2, Shape: 3, TextArt: 4, MailMerge: 5,
    Signature: 6, Form: 7, SendForSigning: 8, FillingStatus: 9};
const ids = ['paragraph', 'table', 'image', 'shape', 'textart', 'mail-merge',
    'signature', 'form', 'send-for-signing', 'filling-status'];

function harness() {
    const nodes = new Map(), panels = [], classes = new Set(['vo-compact']);
    const stored = new Map(), internal = new Map(), changes = [], mutations = [];
    const counters = {layout: 0, resize: 0, queries: 0};
    let selected, lock = {on: false, options: {}}, layoutVisible = true;
    const makeNode = id => {
        const node = {id, classes: new Set(), style: {display: 'block'}, width: 260};
        nodes.set(id, node);
        return node;
    };
    const menuNode = makeNode('right-menu'), panelNode = makeNode('right-panel');
    class Collection {
        constructor(items) { this.items = items; this.length = items.length; Object.assign(this, items); }
        find(selector) {
            if (selector === '.right-panel') return $(panelNode);
            if (selector[0] === '#') return $(nodes.get(selector.slice(1)));
            if (selector === '.plugin-panel.active') return new Collection([]);
            if (selector.includes('.active'))
                return new Collection(panels.filter(n => n.classes.has('active')));
            throw Error('Unexpected selector: ' + selector);
        }
        parent() { return $(panelNode); }
        hasClass(name) { return !!this.items[0]?.classes.has(name); }
        addClass(name) { this.items.forEach(n => n.classes.add(name)); return this; }
        removeClass(name) { this.items.forEach(n => n.classes.delete(name)); return this; }
        css(key, value) {
            if (value === undefined) return key.startsWith('padding-') ? '20' : this.items[0]?.style[key];
            this.items.forEach(n => { n.style[key] = value; });
            return this;
        }
        width(value) {
            if (value === undefined) return this.items[0]?.width;
            this.items.forEach(n => { n.width = value; });
            return this;
        }
    }
    const $ = value => typeof value === 'string' ? $(nodes.get(value.replace(/^#/, ''))) :
        new Collection(value ? [value] : []);
    const underscore = {extend: Object.assign, template: () => () => '', bind: (fn, obj) => fn.bind(obj)};
    const viewport = {hlayout: {hideItemResizer() {}, doLayout() { counters.layout++; }}};
    const controllers = {Main: {appOptions: {isEdit: true, customization: {}}},
        Viewport: {viewport, getView: () => viewport}};
    const DE = {Views: {}, Controllers: {}, getController: name => controllers[name]};
    const storage = map => ({
        getBool: (key, fallback) => map.has(key) ? !!map.get(key) : !!fallback,
        setBool: (key, value) => map.set(key, value),
        getItem: key => map.get(key), setItem: (key, value) => map.set(key, value)
    });
    const Common = {
        Utils: {documentSettingsType: S,
            InternalSettings: {get: key => internal.get(key), set: (key, value) => internal.set(key, value)}},
        localStorage: storage(stored), NotificationCenter: {on() {}, trigger() {}},
        UI: {LayoutManager: {isElementVisible: () => layoutVisible}, SideMenu: {extend: definition => ({
            show() { this.$el.css('display', 'block'); },
            hide() { this.$el.css('display', 'none'); },
            clearSelection() {}, setDisabledMoreMenuItem() {}, ...definition
        })}}
    };
    const Asc = {c_oAscTypeSelectElement: T};
    const context = {DE, Common, Asc, $,
        window: {DE, Common, Asc}, document: {body: {classList: {
            contains: name => classes.has(name), remove: name => classes.delete(name),
            toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
        }}}, _: underscore, Backbone: {Controller: {extend: definition => definition}},
        setTimeout: () => 1, clearTimeout() {}, console,
        define(deps, factory) {
            if (deps[0]?.startsWith('text!')) factory('', $, underscore, {});
            else factory({svg: name => name});
        }
    };
    vm.createContext(context);
    for (const file of ['view/SelectionBubble.js', 'view/CompactShell.js',
        'view/DocumentActions.js', 'view/RightMenu.js', 'controller/RightMenu.js']) {
        const filename = path.join(root, 'apps/documenteditor/main/app', file);
        vm.runInContext(fs.readFileSync(filename, 'utf8'), context, {filename});
    }
    const shell = DE.Views.CompactShell, bubble = DE.Views.SelectionBubble;
    const controller = Object.create(DE.Controllers.RightMenu);
    const menu = Object.create(DE.Views.RightMenu);
    controllers.RightMenu = controller;
    menu.$el = $(menuNode);
    menu.el = '#right-menu';
    menu.initialize();
    menu.mode = {canBrandingExt: true, customization: {}};
    const buttons = [];
    for (const [name, type] of Object.entries(S)) {
        const id = 'id-' + ids[type] + '-settings', node = makeNode(id);
        panels.push(node);
        const button = {options: {asctype: type}, pressed: false, disabled: false,
            isDisabled() { return this.disabled; }, setDisabled(value) { this.disabled = value; },
            isActive() { return this.pressed; },
            toggle(value) {
                if (value) buttons.forEach(other => { other.pressed = false; });
                this.pressed = value;
            },
            trigger(event) { assert.equal(event, 'click'); menu.onBtnMenuClick(this); }};
        buttons.push(button);
        const panel = {ChangeSettings(props) { changes.push({type, props}); },
            setLocked(value) { this.locked = value; }, setProtected() {}, disableControls() {}};
        const panelName = {Paragraph: 'paragraph', TextArt: 'textart', MailMerge: 'merge'}[name] ||
            name[0].toLowerCase() + name.slice(1);
        menu[panelName + 'Settings'] = panel;
        const buttonName = {Paragraph: 'Text', MailMerge: 'MailMerge'}[name] || name;
        menu['btn' + buttonName] = button;
        menu._settings[type] = {panel: id, btn: button};
    }
    menu.fireEvent = (event, args) => {
        if (event === 'rightmenuclick') controller.onRightMenuClick(...args);
    };
    controller.editMode = true;
    controller._initSettings = false;
    controller._state = {docProtection: {isReadOnly: false, isFormsOnly: false, isCommentsOnly: false}};
    controller.rightmenu = menu;
    controller.getApplication = () => ({getController: () => null});
    controller.onRightMenuAfterRender(menu);
    const props = label => ({label, get_Locked: () => false, get_CanAddTable: () => true,
        can_EditBlockContentControl: () => true, get_ChartProperties: () => null,
        get_ShapeProperties: () => null});
    const element = (type, value = props(ids[S.Paragraph])) =>
        ({get_ObjectType: () => type, get_ObjectValue: () => value});
    const a = props('table-A'), b = props('table-B');
    const paragraph = element(T.Paragraph);
    selected = [paragraph, element(T.Table, a)];
    const api = {getSelectedElements() { counters.queries++; return selected; }, asc_IsContentControl: () => false};
    for (const name of ['tblApply', 'put_TablePr', 'SelectTable', 'asc_selectAll',
        'asc_setSelectedElements', 'Undo', 'addRowAbove', 'addRowBelow', 'MergeCells']) {
        api[name] = (...args) => mutations.push({name, args});
    }
    controller.api = shell.api = bubble.api = api;
    bubble.toolbar = {};
    shell.rightOpen = false;
    shell.advanced = false;
    shell.startupFailed = false;
    shell.lockState = () => lock;
    shell.resync = () => { counters.resize++; };
    DE.Views.DocumentActions.shell = shell;
    const setPane = (type, {minimized = false, visible = true, open = true} = {}) => {
        panels.forEach(node => node.classes.delete('active'));
        nodes.get('id-' + ids[type] + '-settings').classes.add('active');
        buttons.forEach(button => { button.pressed = button.options.asctype === type; });
        menu.minimizedMode = minimized;
        menuNode.style.display = visible ? 'block' : 'none';
        panelNode.style.display = minimized ? 'none' : 'inline-block';
        internal.set('de-hide-right-settings', minimized);
        stored.set('de-hide-right-settings', Number(minimized));
        shell.rightOpen = open;
        if (open) classes.add('vo-right-open'); else classes.delete('vo-right-open');
    };
    setPane(S.Paragraph, {minimized: true, open: false});
    const click = () => bubble.sets().table.find(item => item.i === 'panel').run();
    const snapshot = () => ({open: shell.rightOpen, classes: [...classes], active: menu.GetActivePane(),
        minimized: menu.minimizedMode, native: menuNode.style.display,
        stored: [...stored], internal: [...internal], changes: changes.length, mutations: [...mutations]});
    const expectTable = (expected = a) => {
        assert.equal(shell.rightOpen, true, 'stored compact visibility');
        assert.equal(classes.has('vo-right-open'), true, 'compact sidebar visible');
        assert.notEqual(menuNode.style.display, 'none', 'native sidebar visible');
        assert.equal(menu.minimizedMode, false, 'settings expanded');
        assert.equal(menu.GetActivePane(), 'id-table-settings', 'table category active');
        assert.equal(changes.filter(change => change.type === S.Table).at(-1)?.props, expected, 'current table values');
        assert.deepEqual(mutations, [], 'opening must not mutate the document or selection');
    };
    return {shell, bubble, controller, menu, api, DE, Common, context, T, S, a, b,
        element, paragraph, click, expectTable, snapshot, setPane, changes, mutations, counters,
        select: value => { selected = value; }, lock: value => { lock = value; },
        layoutVisible: value => { layoutVisible = value; }};
}

let passed = 0, failed = 0;
function check(name, run) {
    try { run(harness()); passed++; console.log('PASS', name); }
    catch (error) { failed++; console.error('FAIL', name, error.stack); }
}
function unchanged(h, action = h.click) {
    const before = h.snapshot();
    action();
    assert.deepEqual(h.snapshot(), before);
}
check('opens_table_from_hidden_sidebar', h => { h.click(); h.expectTable(); });
check('expands_minimized_table_settings', h => {
    h.setPane(S.Table, {minimized: true}); h.click(); h.expectTable();
});
check('switches_paragraph_to_table', h => { h.setPane(S.Paragraph); h.click(); h.expectTable(); });
check('switches_image_to_table', h => { h.setPane(S.Image); h.click(); h.expectTable(); });
check('repeated_open_stays_open', h => {
    h.click(); h.expectTable(); h.click(); h.expectTable();
});
check('refreshes_values_for_second_table', h => {
    h.click(); h.expectTable();
    h.select([h.paragraph, h.element(T.Table, h.b)]); h.click(); h.expectTable(h.b);
    h.select([h.paragraph, h.element(T.Table, h.a)]); h.click(); h.expectTable(h.a);
});
check('stale_table_button_is_noop', h => { h.select([h.paragraph]); unchanged(h); });
check('denied_sidebar_is_noop', h => {
    h.lock({on: false, options: {rightMenu: {disable: true}}}); unchanged(h);
});
check('locked_editor_is_noop', h => { h.lock({on: true, options: {viewMode: true}}); unchanged(h); });
check('missing_controller_is_noop', h => { delete h.DE.getController('RightMenu').rightmenu; unchanged(h); });
check('generic_open_keeps_contract', h => {
    h.shell.openRightPanel(); h.shell.openRightPanel();
    assert.equal(h.shell.rightOpen, true); assert.equal(h.counters.layout, 1);
    assert.equal(h.menu.GetActivePane(), null); assert.deepEqual(h.changes, []);
    const imageAction = h.bubble.sets().image.find(item => item.i === 'panel');
    imageAction.run(); assert.equal(h.counters.layout, 1);
});
check('no_sdk_mutation_on_open', h => { h.click(); h.expectTable(); assert.deepEqual(h.mutations, []); });
check('no_sdk_selection_change', h => {
    const selected = h.api.getSelectedElements(); h.click(); h.expectTable();
    assert.equal(h.api.getSelectedElements(), selected);
});
check('missing_sdk_is_noop', h => { h.shell.api = null; unchanged(h); });
check('unavailable_table_settings_is_noop', h => { delete h.controller._settings[S.Table]; unchanged(h); });
check('mode_roundtrip_keeps_stock_behavior', h => {
    for (const method of ['applyLayout', 'restoreStockLook', 'ensureBackButton', 'syncLeftState'])
        h.shell[method] = () => {};
    h.click(); h.expectTable();
    h.shell.toggleMode(); assert.equal(h.shell.advanced, true);
    h.shell.toggleMode(); h.expectTable();
    h.shell.toggleRightPanel(); assert.equal(h.shell.rightOpen, false);
    h.click(); h.expectTable();
    h.menu.btnTable.toggle(false); h.menu.btnTable.trigger('click');
    assert.equal(h.menu.minimizedMode, true);
    h.menu.btnTable.toggle(true); h.menu.btnTable.trigger('click'); h.expectTable();
});
check('active_table_in_hidden_native_menu_reopens', h => {
    h.setPane(S.Table, {visible: false, open: false}); h.click(); h.expectTable();
});
check('formula_in_table_is_noop', h => {
    h.select([h.paragraph, h.element(T.Table, h.a), h.element(T.Math)]); unchanged(h);
});
check('image_in_table_is_noop', h => {
    h.select([h.paragraph, h.element(T.Table, h.a), h.element(T.Image)]); unchanged(h);
});
check('invalid_selection_is_noop', h => {
    for (const selection of [[], null, undefined, {}, [null], [{get_ObjectType() { throw Error('selection'); }}]]) {
        h.select(selection); unchanged(h);
    }
});
check('advanced_direct_call_is_noop', h => {
    h.shell.advanced = true; unchanged(h, () => h.shell.openTableProperties());
});
check('startup_failure_is_noop', h => { h.shell.startupFailed = true; unchanged(h); });
check('selection_query_failure_is_noop', h => {
    h.api.getSelectedElements = () => { throw Error('SDK unavailable'); }; unchanged(h);
});
check('branding_denied_sidebar_is_noop', h => { h.menu.mode.customization.rightMenu = false; unchanged(h); });
check('branding_disabled_does_not_apply_customization', h => {
    h.menu.mode.canBrandingExt = false; h.menu.mode.customization.rightMenu = false;
    h.click(); h.expectTable();
});
check('locked_table_keeps_stock_restrictions', h => {
    h.a.get_Locked = () => true; h.click(); h.expectTable();
    assert.equal(h.menu.tableSettings.locked, true);
});
check('stale_cached_disabled_table_is_refreshed', h => {
    h.controller._settings[S.Table].hidden = 1; h.menu.btnTable.disabled = true;
    h.click(); h.expectTable();
});
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
