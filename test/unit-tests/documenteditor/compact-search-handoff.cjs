/* Run: node test/unit-tests/documenteditor/compact-search-handoff.cjs
 * Browser DOM integration for the compact search handoff. Loads production AMD methods; SDK and
 * editor construction are fixture boundaries, not a full document-server e2e.
 * Set PLAYWRIGHT_MODULE to the installed Playwright package when not in NODE_PATH.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const less = require(path.join(root, 'build/node_modules/less'));
(async () => {
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    try {
        const page = await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1.25});
        page.on('pageerror', error => console.error('Browser error:', error.message));
        const lessFile = path.join(root, 'apps/documenteditor/main/resources/less/app.less');
        const css = await less.render(fs.readFileSync(lessFile, 'utf8'), {filename:lessFile,
            modifyVars:JSON.parse(fs.readFileSync(path.join(root,'build/documenteditor.json'),'utf8')).main.less.vars});
        const menuMarkup = fs.readFileSync(path.join(root,'apps/documenteditor/main/app/template/LeftMenu.template'),'utf8')
            .replace(/<%= scope.ariaLeftMenu %>/g, 'Left menu');
        await page.setContent(`<style>${css.css}</style><div id="mode-vbox" style="height:720px"><div id="toolbar" style="height:100px"></div><div id="statusbar" style="height:24px"></div></div>
        <div id="searchbar"><input id="bar-query"><button id="advanced">Advanced</button></div>
        <div style="position:relative;width:1280px;height:544px"><div id="viewport-hbox-layout" class="layout-ct hbox">
        <div id="vo-rail-slot" class="layout-item" style="width:160px;height:544px"></div>
        <div id="left-menu" class="layout-item" style="width:40px;height:544px">${menuMarkup}</div>
        <div id="canvas" class="layout-item" style="height:544px">Document</div></div></div>`);
        await page.locator('#left-panel-search').evaluate(el => {el.innerHTML='<div id="search-box"><div id="panel-query"><input></div><div id="results"></div></div>';});
        for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js', 'vendor/backbone/backbone.js']) {
            await page.addScriptTag({path: path.join(root, file)});
        }
        await page.evaluate(() => {
            window.DE = {Views: {}, Controllers: {}, getController: name => window.controllers[name]};
            window.controllers = {};
            Backbone.Controller = Backbone.View;
            const base = Backbone.View.extend({
                fireEvent: function(name, args) { this.trigger.apply(this, [name].concat(args || [])); },
                show: function() { this.$el.show(); }, hide: function() { this.$el.hide(); this.trigger('hide'); },
                isVisible: function() { return this.$el.is(':visible'); }
            });
            window.Common = {UI: {BaseView: base, SideMenu: base, Window: base,
                Menu: {Manager: {hideAll: () => {}}}, LayoutManager: {isElementVisible: () => true}, isRTL: () => false},
                Views: {}, NotificationCenter: _.extend({}, Backbone.Events),
            Utils: {innerWidth: () => innerWidth, InternalSettings:{set:()=>{}}}, localStorage: {getItem: () => window.storedWidth, setItem: (key,value) => {window.storedWidth=value;}, setBool: () => {}}};
            window.define = (deps, factory) => factory('', $, _, Backbone);
        });
        for (const file of [
            'apps/common/main/lib/component/ToggleManager.js',
            'apps/common/main/lib/component/Button.js',
            'apps/common/main/lib/component/Layout.js',
            'apps/common/main/lib/view/SearchBar.js',
            'apps/common/main/lib/view/SearchPanel.js',
            'apps/documenteditor/main/app/view/LeftMenu.js',
            'apps/documenteditor/main/app/controller/LeftMenu.js',
            'apps/documenteditor/main/app/controller/Search.js',
            'apps/documenteditor/main/app/controller/Viewport.js',
            'apps/documenteditor/main/app/view/DocumentActions.js',
            'apps/documenteditor/main/app/view/CompactShell.js'
        ]) {
            const changedSource = file === 'apps/documenteditor/main/app/view/LeftMenu.js' || file === 'apps/documenteditor/main/app/controller/LeftMenu.js';
            const content = process.env.TEST_BASELINE && changedSource ?
                execFileSync('git', ['show', `${process.env.TEST_BASELINE}:${file}`], {cwd:root,encoding:'utf8'}) : fs.readFileSync(path.join(root,file),'utf8');
            await page.addScriptTag({content});
        }
        await page.evaluate(() => {
            // Construction/SDK boundaries are isolated; production transition,
            // visibility, toggle, layout sync, focus and query handling are used.
            function instance(proto, el) {
                return Object.assign(Object.create(proto), Backbone.Events, {el, $el: $(el)});
            }
            const panel = instance(Common.Views.SearchPanel.prototype, '#left-panel-search');
            panel.inputText = {$el: $('#panel-query'), getValue: () => $('#panel-query input').val(), setValue: v => $('#panel-query input').val(v)};
            panel.$resultsContainer = $('#results');
            panel.show = Common.UI.BaseView.prototype.show;
            panel.disableReplaceButtons = value => {panel.replaceDisabled = value;};
            panel.clearResultsNumber = () => {};
            panel.disableNavButtons = () => {};
            panel.setSearchMode = mode => {panel.mode = mode;};
            const menu = instance(DE.Views.LeftMenu.prototype, '#left-menu');
            menu._state = {disabled: false}; menu.mode = {canCoAuthoring:false}; menu.panelSearch = panel;
            const button = instance(Common.UI.Button.prototype, '#left-btn-searchbar');
            button.cmpEl = button.$el; button.options = {}; button.pressed = false; button.disabled = false;
            menu.btnSearchBar = button; menu.btnAbout = {toggle: () => {}};
            menu.btnNavigation = instance(Common.UI.Button.prototype, '#left-panel-navigation');
            menu.btnNavigation.pressed = false; menu.btnNavigation.enableToggle = true;
            menu.btnNavigation.toggleGroup = button.toggleGroup = 'left-menu';
            button.enableToggle = true;
            Common.UI.ToggleManager.register(button); Common.UI.ToggleManager.register(menu.btnNavigation);
            menu.panelNavigation = instance(Common.UI.BaseView.prototype, '#left-panel-navigation');
            menu.isButtonInMoreMenu = () => false;
            const left = Object.assign(Object.create(DE.Controllers.LeftMenu.prototype), {leftMenu:menu,mode:{isEdit:true}});
            controllers.LeftMenu = left;
            const bar = instance(Common.UI.SearchBar.prototype, '#searchbar');
            bar.inputSearch = $('#bar-query'); bar.$window = bar.$el;
            bar.setPosition = () => {}; bar.disableNavButtons = () => {};
            const headerButton = instance(Common.UI.Button.prototype, '#advanced');
            headerButton.pressed = true;
            bar.on('hide', () => headerButton.toggle(false, true));
            const hlayout = new Common.UI.HBoxLayout({box:$('#viewport-hbox-layout'), items:[
                {el:$('#vo-rail-slot'),rely:true}, {el:$('#left-menu'),rely:true,alias:'left'}, {el:$('#canvas'),stretch:true}
            ]});
            const vlayout = new Common.UI.VBoxLayout({box:$('#mode-vbox'),items:[{el:$('#toolbar'),height:100,alias:'toolbar'},{el:$('#statusbar'),height:24,alias:'statusbar'}]});
            controllers.Viewport = Object.assign(Object.create(DE.Controllers.Viewport.prototype), {header:{btnSearch:headerButton},searchBar:bar, viewport:{hlayout,vlayout},api:{Resize:()=>{}},boxSdk:$('#canvas')});
            const search = Object.assign(Object.create(DE.Controllers.Search.prototype), {
                view:panel, _state:{searchText:'old',matchCase:false}, resultItems:[],
                api:{asc_GetSelectedText: () => 'selected', asc_SetViewRulers:()=>{}, Resize:()=>{}},
                checkPunctuation: () => {}, getApplication: () => ({getController: name => controllers[name]}),
                onInputSearchChange: text => {window.searches.push(text); search._state.searchText = text;}
            });
            controllers.Search = search; search.getSearchText = () => search._state.searchText; search.getResultsNumber = () => [0,0];
            controllers.Viewport.getApplication = left.getApplication = search.getApplication;
            controllers.Viewport.api = search.api; bar.updateResultsNumber = () => {};
            DE.Views.DocumentActions.api = search.api;
            $(window).on('resize', e => controllers.Viewport.onWindowResize(e));
            menu.on('search:aftershow', text => {window.afterShows++; search.onShowAfterSearch(text);});
            button.on('toggle', (btn,state) => left.onMenuSearchBar(btn,state));
            bar.on('search:show', (state,text) => left.onShowHideSearch(state,text));
            bar.on('search:input', text => {if(search._state.searchText !== text) search.onInputSearchChange(text);});
            $('#advanced').on('click', () => bar.onOpenPanel());
            Common.NotificationCenter.on('layout:changed', area => controllers.Viewport.onLayoutChanged(area));
            Common.NotificationCenter.on('layout:changed', () => {if(document.body.classList.contains('vo-compact')) DE.Views.CompactShell.syncLeftState();});
            window.fixture = {menu,left,bar,panel,search,button};
            window.reset = (options = {}) => {
                document.body.className = 'pixel-ratio__1_25 theme-white chrome theme-type-light ' + (options.compact === false ? '' : 'vo-compact vo-outline-open');
                window.storedWidth = options.storedWidth === undefined ? 300 : options.storedWidth;
                headerButton.pressed = true; button.disabled = !!options.disabled; button.pressed = false; menu._state.disabled = !!options.menuDisabled;
                menu.$el.css({display:'',width:options.initialWidth===undefined ? 40 : options.initialWidth}); panel.$el.hide(); menu.panelNavigation.hide(); menu.btnNavigation.pressed = false;
                search._state.searchText = 'old'; search.resultItems = []; panel.inputText.setValue('old');
                left.mode.isEdit = options.edit !== false; left.mode.canBrandingExt = !!options.hiddenMenu; left.mode.customization = {leftMenu: !options.hiddenMenu}; window.searches = []; window.afterShows = 0; window.layouts = 0;
                bar.$el.show(); bar.inputSearch.val(options.query === undefined ? 'alpha' : options.query);
            };
            window.observe = () => ({panel:panel.isVisible(),bar:bar.isVisible(),query:panel.inputText.getValue(),barQuery:bar.inputSearch.val(),
                focus:document.activeElement === $('#panel-query input')[0] ? 'panel' : document.activeElement === bar.inputSearch[0] ? 'bar' : 'other',
                stockButtonVisible:button.isVisible(),pressed:button.pressed,open:document.body.classList.contains('vo-left-open'),left:$('#canvas')[0].getBoundingClientRect().left,
                panelWidth:$('#search-box')[0].getBoundingClientRect().width, menuWidth:menu.$el.width(),menuOuterWidth:menu.$el[0].getBoundingClientRect().width,
                toolbarPressed:headerButton.pressed,afterShows,searches:searches.slice(),mode:panel.mode,navigation:menu.panelNavigation.isVisible()});
        });
        let passed = 0;
        async function check(name, options, verify, before) {
            await page.evaluate(options => reset(options), options);
            if (before) await page.evaluate(before);
            await page.click('#advanced');
            await page.waitForTimeout(40);
            const state = await page.evaluate(() => observe());
            try {verify(state);} catch(error) {console.error(name, state); throw error;} passed++; console.log('PASS', name);
        }
        await check('hidden compact button opens visible panel, focus and layout once', {}, s => {
            assert.equal(s.stockButtonVisible,false); assert.equal(s.panel,true); assert.equal(s.bar,false); assert.equal(s.query,'alpha'); assert.equal(s.focus,'panel');
            assert.equal(s.pressed,true); assert.equal(s.open,true); assert.ok(s.panelWidth>=298); assert.ok(s.left>=459); assert.equal(s.afterShows,1); assert.deepEqual(s.searches,['alpha']);
        });
        for (const storedWidth of [40,40.8,300,480]) {
            await check(`compact search restores usable persisted width ${storedWidth}`, {storedWidth}, s => {
                assert.ok(s.panelWidth>=298, `clipped panel: ${s.panelWidth}`);
                assert.ok(s.left>=459, `canvas overlaps panel: ${s.left}`);
                if (storedWidth===480) assert.ok(s.panelWidth>=478);
                assert.equal(s.focus,'panel'); assert.equal(s.afterShows,1);
            });
        }
        await check('fractional collapsed width restores stock minimum', {initialWidth:40.8}, s => {
            assert.ok(s.panelWidth>=298); assert.ok(s.left>=459); assert.equal(s.afterShows,1);
        });
        await check('switching a wide current panel preserves its width over stale storage', {initialWidth:480,storedWidth:300}, s => {
            assert.ok(s.panelWidth>=478); assert.ok(s.left>=639); assert.equal(s.navigation,false);
        }, () => {fixture.menu.btnNavigation.pressed=true;fixture.menu.panelNavigation.show();document.body.classList.add('vo-left-open');});
        await check('explicit empty query wins over old query and selection', {query:''}, s => {
            assert.equal(s.panel,true); assert.equal(s.query,''); assert.equal(s.afterShows,1); assert.deepEqual(s.searches,[]);
        });
        await check('unmatched query transfers unchanged', {query:'no-match-999'}, s => assert.equal(s.query,'no-match-999'));
        for (const options of [{disabled:true},{hiddenMenu:true}]) await check('disabled handoff preserves visible bar and query', options, s => {
            assert.equal(s.panel,false); assert.equal(s.bar,true); assert.equal(s.barQuery,'alpha'); assert.equal(s.toolbarPressed,true); assert.equal(s.focus,'bar'); assert.equal(s.afterShows,0);
        });
        await page.evaluate(() => {
            const viewport = controllers.Viewport;
            viewport.header.btnSearch.toggle(!viewport.header.btnSearch.pressed);
            viewport.onSearchToggle();
        });
        assert.equal((await page.evaluate(() => observe())).bar,false);
        console.log('PASS toolbar click closes restored searchbar'); passed++;
        await check('view mode retains no-replace permission', {edit:false}, s => assert.equal(s.mode,'no-replace'));
        await check('stock SetDisabled preview retains permitted no-replace search', {}, s => {
            assert.equal(s.panel,true); assert.equal(s.mode,'no-replace'); assert.equal(s.afterShows,1);
        }, () => {
            fixture.menu.close = () => {};
            fixture.menu.setDisabledPluginButtons = () => {};
            fixture.left.SetDisabled(true, {});
        });
        await check('advanced DOCX retains normal transition', {compact:false}, s => {
            assert.equal(s.panel,true); assert.equal(s.query,'alpha'); assert.equal(s.afterShows,1); assert.equal(s.focus,'panel');
        });
        await check('other panel closes on search transition', {}, s => {assert.equal(s.panel,true); assert.equal(s.navigation,false);}, () => {
            fixture.menu.btnNavigation.pressed = true; fixture.menu.panelNavigation.show(); document.body.classList.add('vo-left-open');
        });
        await page.evaluate(() => fixture.left.onShowHideSearch(false));
        assert.equal((await page.evaluate(() => observe())).open,false);
        await check('close then reopen restores focus and width', {}, s => {assert.equal(s.panel,true); assert.equal(s.focus,'panel'); assert.equal(s.open,true);});
        await check('already pressed search keeps panel open and handles query once', {}, s => {
            assert.equal(s.panel,true); assert.equal(s.pressed,true); assert.equal(s.query,'alpha'); assert.equal(s.afterShows,1); assert.ok(s.panelWidth>=298);
        }, () => {fixture.button.pressed=true;fixture.panel.show();document.body.classList.add('vo-left-open');});
        for (const open of [true, false]) {
            await page.evaluate(open => {
                reset();
                const shell = Object.create(DE.Views.CompactShell);
                shell.advanced = false;
                shell.api = fixture.search.api;
                shell.rightOpen = false;
                fixture.button.pressed = open;
                if (open) {fixture.panel.show();document.body.classList.add('vo-left-open');}
                shell.toggleMode(); shell.toggleMode();
            }, open);
            const state = await page.evaluate(() => observe());
            assert.equal(state.panel,open); assert.equal(state.pressed,open); assert.equal(state.open,open); assert.equal(state.afterShows,0);
            passed++; console.log('PASS compact/advanced/compact cycle', open ? 'open' : 'closed');
        }
        for (const storedWidth of [40,40.8,300,480]) {
            await check(`already active advanced search repairs fractional width, saved ${storedWidth}`,
                {compact:false,initialWidth:40.8,storedWidth,query:'gamma'}, s => {
                    assert.equal(s.panel,true); assert.equal(s.pressed,true); assert.equal(s.query,'gamma');
                    assert.equal(s.afterShows,1); assert.deepEqual(s.searches,['gamma']);
                    assert.ok(s.panelWidth>=257); assert.ok(s.menuOuterWidth>=300);
                    if (storedWidth===480) assert.ok(s.panelWidth>=437);
                }, () => {fixture.button.pressed=true;fixture.panel.show();});
            await page.evaluate(storedWidth => {
                reset({storedWidth,initialWidth:40.8,query:'gamma'});
                const shell = Object.create(DE.Views.CompactShell);
                shell.advanced = false; shell.rightOpen = false;
                shell.api = fixture.search.api;
                shell.toggleMode();
                fixture.left.onShowHideSearch(true,'gamma');
                window.stockOpened = observe();
                shell.toggleMode();
                window.compactReturned = observe();
                shell.toggleMode();
            }, storedWidth);
            await page.waitForTimeout(40);
            const state = await page.evaluate(() => observe());
            try {
                for (const [step, intermediate] of Object.entries(await page.evaluate(() => ({stockOpened,compactReturned})))) {
                    assert.equal(intermediate.panel,true); assert.equal(intermediate.pressed,true);
                    assert.equal(intermediate.query,'gamma'); assert.equal(intermediate.afterShows,1);
                    assert.deepEqual(intermediate.searches,['gamma']);
                    assert.ok(intermediate.panelWidth>=257, `${step} active search clipped: ${intermediate.panelWidth}`);
                    assert.ok(intermediate.menuOuterWidth>=300, `${step} menu collapsed: ${intermediate.menuOuterWidth}`);
                    assert.ok(intermediate.left>=300, `${step} canvas overlaps search: ${intermediate.left}`);
                    if (storedWidth===480) assert.ok(intermediate.panelWidth>=437, `${step} wide search narrowed`);
                }
                assert.equal(state.panel,true); assert.equal(state.pressed,true);
                assert.equal(state.query,'gamma'); assert.equal(state.afterShows,1);
                assert.deepEqual(state.searches,['gamma']);
                assert.equal(state.focus,'panel');
                assert.ok(state.panelWidth>=257, `active advanced search clipped: ${state.panelWidth}`);
                if (storedWidth===480) assert.ok(state.panelWidth>=437, 'wide search must retain its width');
                assert.ok(state.left>=300, `canvas overlaps active search: ${state.left}`);
            } catch(error) {console.error('stock open mode cycle',storedWidth,state);throw error;}
            passed++; console.log('PASS stock advanced search to compact to advanced',storedWidth);
        }
        console.log(`${passed} browser integration scenarios passed`);
    } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});



