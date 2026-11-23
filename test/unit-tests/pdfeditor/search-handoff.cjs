/* Run: node test/unit-tests/pdfeditor/search-handoff.cjs
 * Browser integration of PDF search entry points. Production event bus, buttons, SearchBar,
 * SearchPanel, Search and viewport methods; window construction, menus and SDK are boundaries.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./lib/shell-page.cjs');

(async () => {
    const browser = await H.launch();
    const {check, done} = H.checker();
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 720}});
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setContent(`<div id="vo-shell"></div><div style="display:flex;height:600px">
            <div id="left-menu" style="width:40px;flex-shrink:0"><div class="tool-menu-btns">
            <button id="left-btn-searchbar">Search</button></div><div class="left-panel">
            <div id="left-panel-search" style="display:none"><div id="query"><input></div>
            <div id="search-adv-title"></div><div class="edit-setting">Replace</div>
            <div id="result-number"></div><div id="results"></div></div></div></div>
            <div id="canvas" style="flex:1">PDF</div></div>`);
        await page.addStyleTag({content: await H.styles(browser)});
        await page.addStyleTag({content: '.hidden {display:none !important}'});
        for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js', 'vendor/backbone/backbone.js'])
            await page.addScriptTag({path: path.join(H.ROOT, file)});
        await page.evaluate(() => {
            window.PDFE = {Views: {}, Controllers: {}, getController: name => controllers[name]};
            window.controllers = {};
            window.define = (deps, factory) => factory(...deps.map(d => d === 'underscore' ? _ : d === 'backbone' ? Backbone : d === 'jquery' ? $ : ''));
            window.Common = {UI: {}, Views: {}, NotificationCenter: _.extend({}, Backbone.Events),
                Utils: {innerWidth: () => innerWidth, InternalSettings: {set() {}}, getPosition: () => ({top: 0}),
                    String: {format: (text, ...args) => (text || '').replace(/\{(\d+)\}/g, (_, i) => args[i])}},
                localStorage: {getItem: () => window.savedWidth, setItem(k, v) {window.savedWidth = v;}, setBool() {}}};
        });
        for (const file of ['apps/common/main/lib/core/application.js', 'apps/common/main/lib/component/BaseView.js'])
            await page.addScriptTag({path: path.join(H.ROOT, file)});
        await page.evaluate(() => {
            window.app = {getController: name => controllers[name], addListeners: (listeners, controller) => bus.addListeners(listeners, controller)};
            window.bus = new Backbone.EventBus({application: app});
            Common.UI.SideMenu = Common.UI.BaseView;
            Common.UI.Window = Common.UI.BaseView.extend({
                initialize(options) {Common.UI.BaseView.prototype.initialize.call(this, options);},
                render() {
                    if (!this.$window) {
                        this.setElement($('<div class="search-bar"></div>').html(this.options.tpl).appendTo('body'));
                        this.$window = this.$el; this.rendered = true;
                    }
                    return this;
                },
                show() {if (!this.rendered) this.render(); this.$window.show(); this.fireEvent('show', this);},
                hide() {if (this.$window) this.$window.hide(); this.fireEvent('hide', this);},
                setPosition() {}
            });
            Common.UI.Menu = Backbone.View.extend({render() {}, alignPosition() {}});
            Common.UI.Menu.Manager = {hideAll() {}};
            Common.UI.LayoutManager = {isElementVisible: () => !window.denied};
            Common.UI.Scaling = {currentRatio: () => 1};
            Common.UI.isRTL = () => false;
            window.AscCommon = {CSearchSettings: function () {
                this.put_Text = value => {this.text = value;};
                this.put_MatchCase = this.put_WholeWords = () => {};
            }};
        });
        for (const file of [
            'apps/common/main/lib/component/ToggleManager.js', 'apps/common/main/lib/component/Button.js',
            'apps/common/main/lib/view/SearchBar.js', 'apps/common/main/lib/view/SearchPanel.js',
            'apps/pdfeditor/main/app/view/LeftMenu.js', 'apps/pdfeditor/main/app/controller/LeftMenu.js',
            'apps/pdfeditor/main/app/controller/Search.js', 'apps/pdfeditor/main/app/controller/Viewport.js',
            'apps/pdfeditor/main/app/view/CompactShell.js'
        ]) await page.addScriptTag({path: path.join(H.ROOT, file)});
        await page.evaluate(() => {
            Common.UI.Button.prototype.createHint = function () {this.btnEl = this.cmpEl;};
            Common.UI.Button.prototype.applyScaling = () => {};
            function instance(proto, el, alias) {
                return Object.assign(Object.create(proto), Backbone.Events, {el, $el: $(el), options: {alias}});
            }
            const panel = instance(Common.Views.SearchPanel.prototype, '#left-panel-search', 'Common.Views.SearchPanel');
            panel.options.mode = {isPDFEdit: true};
            panel.inputText = {$el: $('#query'), _input: $('#query input'), getValue: () => $('#query input').val(), setValue: v => $('#query input').val(v)};
            panel.$resultsContainer = $('#results'); panel.$resultsContainer.scroller = {scrollTop() {}};
            panel.$reaultsNumber = $('#result-number'); panel.updateResultsContainerHeight = () => {};
            const inert = {setDisabled() {}};
            panel.btnBack = panel.btnNext = panel.btnReplace = panel.btnReplaceAll = panel.btnMark = panel.btnMarkAll = inert;
            const menu = instance(PDFE.Views.LeftMenu.prototype, '#left-menu', 'LeftMenu');
            menu.mode = {canCoAuthoring: false}; menu._state = {}; menu.panelSearch = panel;
            menu.btnAbout = {toggle() {}}; menu.isButtonInMoreMenu = () => false;
            const buttonOptions = {el: $('#left-btn-searchbar'), action: 'advancedsearch', enableToggle: true,
                toggleGroup: 'leftMenuGroup', scaling: false};
            // Older snapshots construct a stock button before the PDF-specific guard exists.
            const button = menu.createSearchButton ? menu.createSearchButton(buttonOptions) : new Common.UI.Button(buttonOptions);
            const neighbor = new Common.UI.Button({el: $('<button>About</button>').appendTo('body'),
                enableToggle: true, toggleGroup: 'leftMenuGroup', scaling: false});
            const neighborPanel = $('<div>About panel</div>').appendTo('body').hide();
            neighbor.on('toggle', (btn, state) => neighborPanel.toggle(state));
            menu.btnSearchBar = button;
            const left = Object.assign(Object.create(PDFE.Controllers.LeftMenu.prototype), {id: 'LeftMenu', leftMenu: menu,
                mode: {}, getApplication: () => app, getView: () => menu});
            controllers.LeftMenu = left;
            button.on('toggle', left.onMenuSearchBar.bind(left));
            button.on('click', menu.onBtnMenuClick.bind(menu));
            const header = {pressed: true, toggle(value) {this.pressed = value;}};
            const api = {asc_GetSelectedText: () => window.selection, Resize() {},
                asc_findText(settings) {window.searches.push(settings.text); return false;},
                asc_StartTextAroundSearch() {}, asc_endFindText() {}, asc_selectSearchingResults(value) {window.highlighted = value;}};
            const viewport = Object.assign(Object.create(PDFE.Controllers.Viewport.prototype), {header: {btnSearch: header},
                mode: {}, api, getApplication: () => app, viewport: {hlayout: {doLayout() {}}}});
            controllers.Viewport = viewport;
            const search = Object.assign(Object.create(PDFE.Controllers.Search.prototype), {id: 'Search', view: panel,
                getApplication: () => app, api, checkPunctuation() {}});
            controllers.Search = search;
            bus.addListeners({'SearchBar': {'search:show': left.onShowHideSearch.bind(left),
                'search:showredact': left.onShowHideRedactSearch.bind(left)}}, left);
            search.initialize();
            menu.on('search:aftershow', () => {window.afterShows++;});
            panel.inputText._input.on('input', () => panel.fireEvent('search:input', [panel.inputText.getValue()]));
            PDFE.Views.CompactShell.resync = () => {};
            Common.NotificationCenter.on('layout:changed', () => PDFE.Views.CompactShell.syncLeftState());
            window.openBar = () => {header.pressed = true; viewport.onSearchToggle(); return viewport.searchBar;};
            window.reset = (o = {}) => {
                if (search.searchTimer) clearInterval(search.searchTimer);
                search.searchTimer = undefined;
                document.body.className = o.stock ? '' : 'vo-compact';
                window.savedWidth = o.width === undefined ? 300 : o.width; window.denied = !!o.denied;
                left.mode = viewport.mode = {canBrandingExt: !!o.branding, customization: {leftMenu: !o.brandingDenied}, isPDFEdit: !!o.edit};
                menu.btnSearchBar = o.missingButton ? undefined : button;
                left.leftMenu = o.missingMenu ? undefined : menu;
                button.pressed = false; button.disabled = !!o.disabled; header.pressed = true; neighbor.toggle(false);
                menu.$el.css({display: '', width: 40}); panel.$el.hide(); panel.mode = 'no-replace';
                const query = o.query === undefined ? 'PDF' : o.query;
                $('#query input').val(query); window.selection = ''; window.afterShows = 0; window.searches = [];
                search._state = {searchText: query, matchCase: false, currentResult: 1, resultsNumber: 3, isHighlightedResults: true};
                search.resultItems = o.emptyResults ? [] : [0, 1, 2].map(id => {
                    const el = $('<div class="item">').text('PDF ' + id)[0];
                    return {id, el, $el: $(el), selected: id === 1};
                });
                panel.$resultsContainer.empty();
                search.resultItems.forEach(item => panel.$resultsContainer.append(item.el));
                window.highlighted = true;
                if (o.emptyResults) {search._state.currentResult = search._state.resultsNumber = 0;}
                if (viewport.searchBar) {viewport.searchBar.mode = o.edit ? 'edit' : 'comment'; viewport.searchBar.hide();}
            };
            window.observe = () => {
                const bar = viewport.searchBar;
                return {panel: panel.isVisible(), bar: !!bar && bar.isVisible(), query: panel.inputText.getValue(),
                    barQuery: bar && bar.inputSearch.val(), width: menu.$el.width(), pressed: button.pressed, mode: panel.mode,
                    focus: document.activeElement === $('#query input')[0] ? 'panel' : bar && document.activeElement === bar.inputSearch[0] ? 'bar' : 'other',
                    afterShows, searches: searches.slice(), results: panel.$resultsContainer.find('.item').length,
                    selected: panel.$resultsContainer.find('.item.selected').text(), current: search._state.currentResult,
                    total: search._state.resultsNumber, highlighted, headerPressed: header.pressed,
                    advanced: !!bar && !!bar.btnOpenPanel && bar.btnOpenPanel.isVisible(),
                    redact: !!bar && !!bar.btnOpenPanelRedact && bar.btnOpenPanelRedact.isVisible(),
                    left: $('#canvas')[0].getBoundingClientRect().left, menuRight: menu.$el[0].getBoundingClientRect().right};
            };
            window.fixture = {left, menu, button, panel, search, viewport, neighbor, neighborPanel};
        });
        async function reset(options = {}) {
            await page.evaluate(o => {reset(o); openBar();}, options);
        }
        async function advance() {
            await page.evaluate(() => fixture.viewport.searchBar.onOpenPanel());
            await page.waitForTimeout(30);
            return page.evaluate(() => observe());
        }
        for (const width of [40, 40.8, 300, 480]) await check(`compact PDF opens panel, focus and retained results at ${width}`, async () => {
            await reset({width}); const s = await advance();
            assert.equal(s.panel, true); assert.equal(s.bar, false); assert.equal(s.query, 'PDF');
            assert.ok(s.width >= Math.max(width, 300)); assert.equal(s.focus, 'panel'); assert.equal(s.mode, 'no-replace');
            assert.equal(s.afterShows, 1); assert.equal(s.results, 3); assert.equal(s.current, 1); assert.equal(s.total, 3);
            assert.equal(s.selected, 'PDF 1'); assert.equal(s.highlighted, true); assert.deepEqual(s.searches, []);
            assert.ok(s.left >= s.menuRight);
        });
        for (const query of ['__PDF_AUDIT_NO_MATCH__', '']) await check(`explicit query ${JSON.stringify(query)} beats selection`, async () => {
            await reset({query, emptyResults: true});
            await page.evaluate(() => {window.selection = 'selected';});
            const s = await advance();
            assert.equal(s.panel, true); assert.equal(s.query, query); assert.equal(s.afterShows, 1);
            assert.equal(s.results, 0); assert.equal(s.current, 0); assert.equal(s.total, 0);
        });
        for (const options of [{disabled: true}, {denied: true}, {denied: true, branding: true},
            {branding: true, brandingDenied: true}, {missingButton: true}, {missingMenu: true}]) {
            await check(`unavailable panel hides action ${JSON.stringify(options)}`, async () => {
                await reset(options); const s = await page.evaluate(() => observe());
                assert.equal(s.bar, true); assert.equal(s.advanced, false); assert.equal(s.redact, false);
                assert.equal(s.barQuery, 'PDF'); assert.equal(s.panel, false);
            });
        }
        await check('the same rendered bar follows both permission directions and mode changes', async () => {
            await reset({branding: true, brandingDenied: true});
            const s = await page.evaluate(() => {
                const bar = fixture.viewport.searchBar;
                fixture.left.mode.customization.leftMenu = true; openBar();
                const allowed = observe();
                fixture.left.mode.customization.leftMenu = false;
                Common.NotificationCenter.trigger('pdf:mode-changed', {isPDFEdit: true});
                const forbidden = observe();
                fixture.left.mode.customization.leftMenu = true;
                Common.NotificationCenter.trigger('pdf:mode-changed', {isPDFEdit: true});
                const edit = observe();
                Common.NotificationCenter.trigger('pdf:mode-changed', {isPDFEdit: false});
                const view = observe();
                return {same: bar === fixture.viewport.searchBar, allowed, forbidden, edit, view};
            });
            assert.equal(s.same, true); assert.equal(s.allowed.advanced, true); assert.equal(s.allowed.redact, false);
            assert.equal(s.forbidden.advanced, false); assert.equal(s.forbidden.redact, false);
            assert.equal(s.edit.advanced, false); assert.equal(s.edit.redact, true);
            assert.equal(s.view.advanced, true); assert.equal(s.view.redact, false);
        });
        await check('a bar first constructed under branding denial can later expose the allowed action', async () => {
            await page.evaluate(() => {fixture.viewport.searchBar.$el.remove(); fixture.viewport.searchBar = undefined; Common.NotificationCenter.off('pdf:mode-changed');});
            await reset({branding: true, brandingDenied: true});
            const s = await page.evaluate(() => {
                const bar = fixture.viewport.searchBar;
                fixture.left.mode.customization.leftMenu = true; openBar();
                return {same: bar === fixture.viewport.searchBar, state: observe()};
            });
            assert.equal(s.same, true); assert.equal(s.state.advanced, true);
        });
        for (const entry of ['ordinary', 'redact', 'menu', 'button']) await check(`dynamic denial blocks ${entry} without changing mode`, async () => {
            await reset({stock: true});
            const s = await page.evaluate(entry => {
                window.denied = true; fixture.panel.mode = 'redact';
                if (entry === 'ordinary') fixture.viewport.searchBar.onOpenPanel();
                if (entry === 'redact') {const bar = fixture.viewport.searchBar; bar.hide(); bar.fireEvent('search:showredact', [true, bar.inputSearch.val()]);}
                if (entry === 'menu') fixture.menu.showMenu('advancedsearch');
                if (entry === 'button') fixture.button.click();
                return observe();
            }, entry);
            await page.waitForTimeout(30); const settled = await page.evaluate(() => observe());
            assert.equal(s.panel, false); assert.equal(s.mode, 'redact'); assert.equal(s.afterShows, 0);
            assert.equal(settled.bar, true); assert.equal(settled.barQuery, 'PDF'); assert.equal(settled.focus, 'bar');
            assert.equal(settled.headerPressed, true); assert.equal(settled.results, 3);
        });
        await check('denied direct entry does not create a floating search bar', async () => {
            await reset({stock: true});
            const s = await page.evaluate(() => {
                fixture.viewport.searchBar.hide(); window.denied = true;
                fixture.menu.showMenu('advancedsearch'); return observe();
            });
            assert.equal(s.bar, false); assert.equal(s.panel, false); assert.equal(s.afterShows, 0);
        });
        await check('a typed query survives its pending search and discards old results', async () => {
            await reset();
            await page.evaluate(() => {
                const bar = fixture.viewport.searchBar;
                bar.inputSearch.val('new query').trigger('input');
            });
            await advance();
            await page.waitForFunction(() => window.searches.length > 0);
            const s = await page.evaluate(() => observe());
            assert.equal(s.query, 'new query'); assert.deepEqual(s.searches, ['new query']); assert.equal(s.results, 0);
        });
        await check('empty input clears old results even with a pending query', async () => {
            await reset();
            await page.evaluate(() => {
                const bar = fixture.viewport.searchBar;
                bar.inputSearch.val('pending').trigger('input'); bar.inputSearch.val('').trigger('input');
            });
            const s = await advance();
            assert.equal(s.query, ''); assert.equal(s.results, 0); assert.deepEqual(s.searches, []);
        });
        await check('clearing a completed query resets its counters and result list', async () => {
            await reset();
            await page.evaluate(() => {fixture.viewport.searchBar.inputSearch.val('').trigger('input');});
            const s = await advance();
            assert.equal(s.query, ''); assert.equal(s.results, 0); assert.equal(s.current, 0); assert.equal(s.total, 0);
        });
        await check('switching from a wide panel retains its current width', async () => {
            await reset(); await page.evaluate(() => {fixture.menu.$el.width(480);});
            const s = await advance(); assert.equal(s.width, 480);
        });
        for (const entry of ['button', 'menu', 'suppressed', 'redact']) await check(`stock ${entry} owns exactly one initialization`, async () => {
            await reset({stock: true});
            const s = await page.evaluate(entry => {
                window.selection = 'selected';
                if (entry === 'button') fixture.button.click();
                if (entry === 'menu') fixture.menu.showMenu('advancedsearch');
                if (entry === 'redact') fixture.left.onShowHideRedactSearch(true);
                if (entry === 'suppressed') {
                    fixture.menu.showMenu('advancedsearch', undefined, true);
                    if (window.afterShows !== 0) throw Error('nested initialization was not suppressed');
                    fixture.menu.fireEvent('search:aftershow', ['explicit']);
                }
                return observe();
            }, entry);
            assert.equal(s.panel, true); assert.equal(s.bar, false); assert.equal(s.afterShows, 1);
            assert.equal(s.query, entry === 'suppressed' ? 'explicit' : 'selected');
            assert.equal(s.mode, entry === 'redact' ? 'redact' : 'no-replace');
        });
        await check('redact and ordinary entries switch an already open panel explicitly', async () => {
            await reset({stock: true}); await advance();
            const s = await page.evaluate(() => {
                fixture.left.onShowHideRedactSearch(true); const redact = observe();
                fixture.left.onShowHideSearch(true, 'PDF'); const ordinary = observe();
                fixture.left.onShowHideSearch(false); const closed = observe();
                return {redact, ordinary, closed};
            });
            assert.equal(s.redact.mode, 'redact'); assert.equal(s.ordinary.mode, 'no-replace');
            assert.equal(s.ordinary.afterShows, 2); assert.equal(s.closed.afterShows, 2); assert.equal(s.closed.panel, false);
        });
        for (const stock of [false, true]) {
            await check(`redact keeps the open ${stock ? 'stock' : 'compact'} panel query and results over document selection`, async () => {
                await reset({stock, edit: true}); await advance();
                const s = await page.evaluate(() => {
                    window.selection = 'selected'; fixture.left.onShowHideRedactSearch(true); return observe();
                });
                assert.equal(s.query, 'PDF'); assert.equal(s.results, 3); assert.equal(s.current, 1);
                assert.equal(s.total, 3); assert.equal(s.afterShows, 1); assert.equal(s.mode, 'redact');
                assert.deepEqual(s.searches, []); assert.equal(s.highlighted, true);
            });
            await check(`redact preserves a pending query in the open ${stock ? 'stock' : 'compact'} panel`, async () => {
                await reset({stock, edit: true, query: 'Alpha'}); await advance();
                await page.evaluate(() => {
                    fixture.panel.inputText._input.val('Beta').trigger('input');
                    fixture.left.onShowHideRedactSearch(true);
                });
                await page.waitForTimeout(500);
                const s = await page.evaluate(() => observe());
                assert.equal(s.query, 'Beta'); assert.deepEqual(s.searches, ['Beta']); assert.equal(s.mode, 'redact');
            });
        }
        for (const entry of ['bar', 'panel']) for (const query of ['PDF', '']) {
            await check(`returning to ${JSON.stringify(query)} cancels pending ${entry} search`, async () => {
                await reset({query});
                if (entry === 'panel') await advance();
                await page.evaluate(entry => {
                    const input = entry === 'bar' ? fixture.viewport.searchBar.inputSearch : fixture.panel.inputText._input;
                    const original = input.val();
                    input.val('Beta').trigger('input'); input.val(original).trigger('input');
                }, entry);
                if (entry === 'bar') await advance();
                await page.waitForTimeout(500);
                const s = await page.evaluate(() => observe());
                assert.equal(s.query, query); assert.deepEqual(s.searches, []);
                if (query) {assert.equal(s.results, 3); assert.equal(s.current, 1); assert.equal(s.total, 3);}
            });
        }
        await check('closing and reopening restores usable width and focus', async () => {
            await reset({width: 480}); await advance();
            await page.evaluate(() => {fixture.left.onShowHideSearch(false); openBar();});
            const s = await advance();
            assert.equal(s.panel, true); assert.equal(s.query, 'PDF'); assert.equal(s.width, 480); assert.equal(s.focus, 'panel');
        });
        await check('redact from the bar preserves an explicit query over the selection', async () => {
            await reset({stock: true, edit: true});
            const s = await page.evaluate(() => {
                const bar = fixture.viewport.searchBar;
                window.selection = 'selected'; bar.inputSearch.val('new query'); bar.hide();
                bar.fireEvent('search:showredact', [true, bar.inputSearch.val()]); return observe();
            });
            assert.equal(s.query, 'new query'); assert.equal(s.mode, 'redact'); assert.equal(s.afterShows, 1);
        });
        await check('a denied button click preserves the neighboring toggle and panel', async () => {
            await reset({stock: true});
            const s = await page.evaluate(() => {
                fixture.neighbor.toggle(true); window.denied = true; fixture.button.click();
                return {pressed: fixture.neighbor.pressed, panel: fixture.neighborPanel.is(':visible'), search: observe()};
            });
            assert.equal(s.pressed, true); assert.equal(s.panel, true); assert.equal(s.search.panel, false);
            assert.equal(s.search.afterShows, 0);
        });
        await check('no browser errors', async () => assert.deepEqual(errors, []));
        done();
    } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
