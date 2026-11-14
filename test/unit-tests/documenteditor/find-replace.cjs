// Run: node test/unit-tests/documenteditor/find-replace.cjs
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const DE = {Controllers: {}, Views: {}};
let notifications = [];
const Common = {NotificationCenter: {trigger: (...args) => notifications.push(args)},
    UI: {Menu: {Manager: {hideAll() {}}}, LayoutManager: {isElementVisible: () => true}}};
// The controller uses core's global jQuery to read the shell mode from the DOM.
const bodyClasses = new Set();
const $ = selector => {
    assert.equal(selector, 'body');
    return {hasClass: name => bodyClasses.has(name)};
};
const context = {DE, window: {DE}, Common, $, _: {extend: Object.assign},
    Backbone: {Controller: {extend: value => value}}, define: (_, factory) => factory()};
vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/documenteditor/main/app/controller/LeftMenu.js'), 'utf8'), context);
Common.UI.SideMenu = {extend: value => value};
context.define = (_, factory) => factory('', null, {extend: Object.assign, template: () => ''});
vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/documenteditor/main/app/view/LeftMenu.js'), 'utf8'), context);
context.define = (_, factory) => factory();
function fixture() {
    let query = 'pending query', visible = false, barVisible = false, barText = '', selection = '', opened = 0, focused = 0;
    const events = [], modes = [];
    const panel = {inputText: {getValue: () => query}, setFindText: text => {query = text;}, isVisible: () => visible, setSearchMode: mode => modes.push(mode), focus: () => focused++};
    const button = {isDisabled: () => false, isVisible: () => true, pressed: false};
    const viewport = {isSearchBarVisible: () => barVisible,
        searchBar: {inputSearch: {val: () => barText}, hide: () => {barVisible = false;}}};
    const controller = Object.assign({}, DE.Controllers.LeftMenu, {
        mode: {isEdit: true}, _state: {docProtection: {}},
        api: {asc_GetSelectedText: () => selection},
        getApplication: () => ({getController: () => viewport}),
        tryToShowLeftMenu() {},
        leftMenu: {btnSearchBar: button, panelSearch: panel, menuFile: {isVisible: () => false},
            isButtonInMoreMenu: () => false, setDisabledPluginButtons() {},
            // Pressing the stock button fires its toggle, which the controller binds to onMenuSearchBar.
            onBtnMenuClick(btn) {visible = true; opened++; btn.pressed = true; controller.onMenuSearchBar(btn, true);},
            showMenu(name, _, suspend) {
                assert.equal(name, 'advancedsearch'); assert.equal(suspend, true);
                if (button.isDisabled() || button.pressed || (!button.isVisible() && !this.isButtonInMoreMenu(button))) return;
                visible = true; opened++; button.pressed = true; controller.onMenuSearchBar(button, true);
            },
            fireEvent(name, args) {events.push([name, args && args[0]]); if (name === 'search:aftershow') barVisible = false;}
        }
    });
    controller.leftMenu.onSearchButtonClick = DE.Views.LeftMenu.onSearchButtonClick;
    button.click = () => controller.leftMenu.onSearchButtonClick();
    return {controller, events, modes, button, viewport,
        bar(text) {barVisible = true; barText = text;}, select(text) {selection = text;},
        get opened() {return opened;}, get focused() {return focused;}};
}
let f = fixture(); f.bar('alpha'); f.select('beta'); f.controller.onFindReplace();
assert.equal(f.events[0][1], 'alpha'); assert.equal(f.opened, 1); assert.equal(f.focused, 1);
f.bar(''); f.controller.onFindReplace();
assert.equal(f.events[1][1], ''); assert.equal(f.opened, 1); assert.equal(f.focused, 2);
f.select('beta'); f.controller.onFindReplace(); assert.equal(f.events[2][1], 'beta');
f.select(''); f.controller.onFindReplace(); assert.equal(f.events[3][1], 'pending query');
// The replace field of an open panel follows protect:doclock and editing:disable; reopening keeps it.
for (const protection of ['isReadOnly', 'isFormsOnly', 'isCommentsOnly']) {
    f.controller.onChangeProtectDocument({[protection]: true}); assert.equal(f.modes.at(-1), 'no-replace');
    f.controller.onFindReplace(); assert.equal(f.modes.at(-1), 'no-replace');
    f.controller.onChangeProtectDocument({}); assert.equal(f.modes.at(-1), 'search');
}
f.controller.setPreviewMode(true); assert.equal(f.modes.at(-1), 'no-replace');
f.controller.onFindReplace(); assert.equal(f.modes.at(-1), 'no-replace');
f.controller.setPreviewMode(false); assert.equal(f.modes.at(-1), 'search');
f.controller.onFindReplace(); assert.equal(f.modes.at(-1), 'search');
// Opening the panel takes the mode from the button toggle: no replace field without the edit right.
f = fixture(); f.controller.mode.isEdit = false; f.controller.onFindReplace(); assert.equal(f.modes.at(-1), 'no-replace');
f = fixture(); f.controller.onChangeProtectDocument({isReadOnly: true}); f.modes.length = 0; f.controller.onFindReplace();
assert.equal(f.modes.at(-1), 'no-replace');
f = fixture(); f.controller.onFindReplace(); assert.equal(f.modes.at(-1), undefined);
f = fixture(); f.button.isVisible = () => false; f.controller.leftMenu.isButtonInMoreMenu = () => true;
f.controller.onFindReplace(); assert.equal(f.opened, 1);
f = fixture(); f.button.isVisible = () => false;
f.controller.onFindReplace(() => {f.button.isVisible = () => true;});
assert.equal(f.opened, 1); // The shell must reveal its rail before stock showMenu checks visibility.
f = fixture(); f.bar('alpha'); f.select('beta');
f.controller.onFindReplace(() => f.button.click());
assert.equal(f.opened, 1);
assert.deepEqual(f.events, [['search:aftershow', 'alpha']]); // The actual stock button must not search the selection first.
f = fixture(); f.bar(''); f.select('beta gamma');
f.controller.onFindReplace(() => f.button.click());
assert.deepEqual(f.events, [['search:aftershow', '']]); // An empty compact query also wins over selection.
f = fixture(); f.button.click();
assert.deepEqual(f.events, [['search:aftershow', undefined]]); // Ordinary stock search keeps its selection fallback.
f = fixture(); f.button.isDisabled = () => true; f.controller.onFindReplace(); assert.equal(f.opened, 0);
f = fixture(); f.controller.mode = {canBrandingExt: true, customization: {leftMenu: false}};
f.controller.onFindReplace(); assert.equal(f.opened, 0); assert.equal(notifications.at(-1)[0], 'search:show');
f = fixture(); f.controller.mode = {canBrandingExt: true, customization: {layout: {leftMenu: false}}};
Common.UI.LayoutManager.isElementVisible = () => false;
const fallbackCount = notifications.length;
f.controller.onFindReplace();
assert.equal(f.opened, 0); assert.equal(notifications.length, fallbackCount + 1);
assert.equal(notifications.at(-1)[0], 'search:show');
Common.UI.LayoutManager.isElementVisible = () => true;
f = fixture(); f.controller.api = null; f.controller.onFindReplace(); assert.equal(f.opened, 0);
bodyClasses.add('vo-compact');
f = fixture(); f.bar('compact query'); f.controller.onFindReplace();
assert.equal(f.opened, 1); assert.deepEqual(f.events, [['search:aftershow', 'compact query']]);
assert.equal(f.focused, 1);
bodyClasses.clear();
console.log('PASS find-replace actual LeftMenu methods: query precedence, repeated opening, focus, protection, More, branding and readiness');

// Exercise the existing receiver, including pending input ahead of its stored search state.
vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/documenteditor/main/app/controller/Search.js'), 'utf8'), context);
f = fixture();
const search = Object.assign({}, DE.Controllers.Search, {
    _state: {searchText: 'old query'}, resultItems: [],
    api: f.controller.api, view: Object.assign(f.controller.leftMenu.panelSearch, {
        $resultsContainer: {find: () => ({length: 1})},
        disableReplaceButtons() {}, clearResultsNumber() {}, disableNavButtons() {}
    }),
    getApplication: f.controller.getApplication,
    checkPunctuation() {}, hideResults() {}, onInputSearchChange(text) {this._state.searchText = text;}
});
f.controller.leftMenu.fireEvent = (name, args) => {
    assert.equal(name, 'search:aftershow');
    search.onShowAfterSearch(args[0]);
};
f.controller.onFindReplace(); // closed panel retains stored search query
assert.equal(search._state.searchText, 'old query');
f.controller.leftMenu.panelSearch.setFindText('typed ahead of debounce');
f.controller.onFindReplace();
assert.equal(search._state.searchText, 'typed ahead of debounce');
assert.equal(f.controller.leftMenu.panelSearch.inputText.getValue(), 'typed ahead of debounce');
f.controller.leftMenu.panelSearch.setFindText('');
f.controller.onFindReplace();
assert.equal(f.controller.leftMenu.panelSearch.inputText.getValue(), '');
assert.equal(search._state.searchText, undefined);
console.log('PASS existing Search receiver preserves pending and empty full-panel input');

// A selection with spaces must not clear whole-word mode before the compact query reaches Search.
f = fixture(); f.bar('alpha'); f.select('beta gamma');
let wholeWordChecked = true;
context.AscCommon = {IsPunctuation: () => false};
const searchWithOptions = Object.assign({}, DE.Controllers.Search, {
    _state: {searchText: '', matchCase: false, matchWord: true}, resultItems: [],
    api: f.controller.api, getApplication: f.controller.getApplication,
    view: Object.assign(f.controller.leftMenu.panelSearch, {
        chMatchWord: {setValue(value) {wholeWordChecked = value;}, setDisabled() {}, isDisabled: () => false},
        $resultsContainer: {find: () => ({length: 1})},
        disableReplaceButtons() {}, clearResultsNumber() {}, disableNavButtons() {}
    }),
    hideResults() {}, onInputSearchChange(text) {this._state.searchText = text;}
});
f.controller.leftMenu.fireEvent = (name, args) => {
    assert.equal(name, 'search:aftershow');
    searchWithOptions.onShowAfterSearch(args && args[0]);
};
f.controller.onFindReplace(() => f.button.click());
assert.equal(f.controller.leftMenu.panelSearch.inputText.getValue(), 'alpha');
assert.equal(searchWithOptions._state.matchWord, true);
assert.equal(wholeWordChecked, true);
console.log('PASS stock button click preserves whole-word mode with a different document selection');
