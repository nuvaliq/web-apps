/* Run: node test/unit-tests/documenteditor/compact-find-replace-entry.cjs
 * Compact search entry points of the document editor: Ctrl+F and the search button of the compact
 * toolbar open the floating search bar, as in the spreadsheet editor; Ctrl+H and Edit → Find and
 * replace open the stock find and replace panel. The replace field follows the edit right and the
 * stock preview mode of the left menu, also in a panel that is already open.
 * Loads the production LeftMenu view and controller, the search panel, the compact shell and the
 * compact toolbar into a browser page; the SDK, the editor construction and the main controller are
 * fixture boundaries: the editing lock is delivered the way the main controller delivers it to the
 * left menu (SetDisabled, then setPreviewMode).
 * Set PLAYWRIGHT_MODULE to the installed Playwright package when not in NODE_PATH.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const locale = JSON.parse(source('apps/documenteditor/main/locale/en.json'));

/* The left menu part of the payloads the main controller sends with editing:disable:
   a lost connection (controller/Main.js, disableEditing) and the user's own view
   (controller/Main.js, onDocModeApply). */
const DISCONNECT = {leftMenu: {disable: true, previewMode: true}, chat: true,
    comments: {disable: false, previewMode: true}, navigation: {disable: false, previewMode: true}};
const OWN_VIEW = {leftMenu: {disable: true, previewMode: true}, chat: false,
    comments: {disable: false, previewMode: true}, navigation: {disable: false, previewMode: true}};

(async () => {
    const browser = await chromium.launch({headless: true,
        executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    let passed = 0, failed = 0;
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 720}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(`<div id="toolbar"></div>
            <div id="left-menu" style="width:40px">
                <button id="left-btn-searchbar">Find</button>
                <div id="left-panel-search" style="display:none">
                    <div id="search-adv-title"></div>
                    <div id="panel-query"><input id="query"></div>
                    <div class="edit-setting"><div id="panel-replace"><input id="replace"></div></div>
                </div>
            </div>
            <div id="canvas">Document</div>`);
        for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js', 'vendor/backbone/backbone.js'])
            await page.addScriptTag({content: source(file)});
        await page.evaluate(() => {
            window.DE = {Views: {}, Controllers: {}, getController: name => window.controllers[name]};
            window.controllers = {};
            Backbone.Controller = Backbone.View;
            const base = Backbone.View.extend({
                fireEvent: function (name, args) { this.trigger.apply(this, [name].concat(args || [])); },
                show: function () { this.$el.show(); }, hide: function () { this.$el.hide(); },
                isVisible: function () { return this.$el.is(':visible'); }
            });
            window.Common = {UI: {BaseView: base, SideMenu: base, Window: base,
                Menu: {Manager: {hideAll: () => {}}}, LayoutManager: {isElementVisible: () => true}, isRTL: () => false},
                Views: {}, Controllers: {}, NotificationCenter: _.extend({}, Backbone.Events),
                Utils: {innerWidth: () => innerWidth, InternalSettings: {get: () => null, set: () => {}}},
                localStorage: {getItem: () => null, setItem: () => {}, getBool: () => false, setBool: () => {}}};
            window.define = (deps, factory) => factory('', $, _, Backbone);
        });
        for (const file of [
            'apps/common/main/lib/component/ToggleManager.js',
            'apps/common/main/lib/component/Button.js',
            'apps/common/main/lib/view/SearchPanel.js',
            'apps/documenteditor/main/app/view/LeftMenu.js',
            'apps/documenteditor/main/app/controller/LeftMenu.js',
            'apps/documenteditor/main/app/view/DocumentActions.js',
            'apps/documenteditor/main/app/view/CompactShell.js'
        ]) await page.addScriptTag({content: source(file)});
        await page.evaluate(() => {
            window.Icons = {svg: () => '<span class="vo-air" aria-hidden="true"></span>'};
            window.define = (deps, factory) => {
                if (deps.includes('documenteditor/main/app/view/Icons')) factory(Icons, window.ToolbarHints);
                else window.ToolbarHints = factory();
            };
            window.AscCommon = {checkDeviceScale: () => ({devicePixelRatio: 1, applicationPixelRatio: 1, correct: false, zoom: 1}),
                correctApplicationScale: () => {}};
            window.Asc = {CHyperlinkProperty: function () {}};
            Common.UI.DimensionPicker = function () { this.on = () => {}; };
        });
        for (const file of ['apps/common/main/lib/util/utils.js', 'apps/documenteditor/main/app/view/ToolbarHints.js',
            'apps/documenteditor/main/app/view/CompactToolbar.js'])
            await page.addScriptTag({content: source(file)});

        await page.evaluate(strings => {
            function instance(proto, el) {
                return Object.assign(Object.create(proto), Backbone.Events, {el, $el: $(el)});
            }
            const panel = instance(Common.Views.SearchPanel.prototype, '#left-panel-search');
            panel.options = {mode: {}};
            panel.inputText = {$el: $('#panel-query'), getValue: () => $('#query').val(), setValue: v => $('#query').val(v)};
            panel.inputReplace = {$el: $('#panel-replace')};
            panel.$resultsContainer = $('<div>');
            panel.show = Common.UI.BaseView.prototype.show;
            panel.hide = Common.UI.BaseView.prototype.hide;
            const stub = {setDisabled() {}, toggle() {}, pressed: false};
            const menu = instance(DE.Views.LeftMenu.prototype, '#left-menu');
            Object.assign(menu, {_state: {disabled: false}, mode: {canCoAuthoring: false}, panelSearch: panel,
                btnAbout: stub, btnComments: stub, btnChat: stub, btnNavigation: stub, buttons: [],
                menuFile: {isVisible: () => false}, isButtonInMoreMenu: () => false,
                setDisabledPluginButtons() {}, toggleActivePluginButton() {}});
            const button = instance(Common.UI.Button.prototype, '#left-btn-searchbar');
            Object.assign(button, {cmpEl: button.$el, options: {}, pressed: false, disabled: false,
                enableToggle: true, toggleGroup: 'leftMenuGroup'});
            menu.btnSearchBar = button;
            button.on('click', menu.onSearchButtonClick.bind(menu));
            menu.on('search:aftershow', () => { window.afterShows++; });

            const left = Object.assign(Object.create(DE.Controllers.LeftMenu.prototype), {leftMenu: menu,
                api: {asc_GetSelectedText: () => ''}, getApplication: () => ({getController: name => controllers[name]})});
            button.on('toggle', left.onMenuSearchBar.bind(left));
            controllers.LeftMenu = left;
            /* The floating search bar: search:show opens it (Viewport.onSearchShow), hide closes it. */
            const viewport = controllers.Viewport = {bar: false, isSearchBarVisible: () => viewport.bar,
                searchBar: {hide: () => { viewport.bar = false; }, focus() {}, setText() {}, inputSearch: {val: () => ''}},
                header: {btnSearch: {pressed: false, toggle() {}}}};
            Common.NotificationCenter.on('search:show', () => { window.searchBars++; viewport.bar = true; });
            Common.NotificationCenter.on('layout:changed', () => {
                if (document.body.classList.contains('vo-compact')) DE.Views.CompactShell.syncLeftState();
            });

            const tb = DE.Views.CompactToolbar;
            const prefix = 'DE.Views.CompactToolbar.';
            for (const [key, value] of Object.entries(strings))
                if (key.startsWith(prefix)) tb[key.slice(prefix.length)] = value;
            tb.api = new Proxy({}, {get: () => () => {}});
            tb.build().appendTo('#toolbar');

            /* The left menu branch of the main controller's onEditingDisable. */
            window.editingDisable = (disable, options) => {
                if (options.leftMenu.disable) left.SetDisabled(disable, options);
                if (options.leftMenu.previewMode) left.setPreviewMode(disable);
            };
            window.reset = (options = {}) => {
                document.body.className = options.compact === false ? '' : 'vo-compact';
                left.mode = {isEdit: options.edit !== false, canEdit: options.edit !== false};
                left._state = {disableEditing: false,
                    docProtection: {isReadOnly: false, isReviewOnly: false, isFormsOnly: false, isCommentsOnly: false}};
                left.viewmode = undefined;
                left.updatePreviewMode();
                menu._state.disabled = false;
                if (button.pressed) button.toggle(false, true);
                panel.$el.hide();
                panel.mode = undefined;
                panel.setSearchMode(options.edit === false ? 'no-replace' : undefined);
                $('#query').val('');
                document.activeElement && document.activeElement.blur && document.activeElement.blur();
                window.afterShows = 0;
                window.searchBars = 0;
                viewport.bar = false;
            };
            window.shortcut = name => left.onShortcut(name, {});
            /* Edit → Find and replace (DocumentActions, edit.find) and «⋮» of the search bar. */
            window.openPanel = () => left.onCompactFindReplace();
            window.toolbarSearch = () => $('#vo-tb button').filter((i, b) =>
                b.getAttribute('aria-label') === tb.tipSearch || b.title === tb.tipSearch).first().trigger('click');
            window.observe = () => ({
                panel: panel.isVisible(), pressed: button.pressed, open: document.body.classList.contains('vo-left-open'),
                replace: panel.isVisible() && $('#left-panel-search .edit-setting').is(':visible'),
                replaceShown: $('#left-panel-search .edit-setting').css('display') !== 'none',
                focus: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
                bar: controllers.Viewport.bar, searchBars, afterShows
            });
        }, locale);

        async function check(name, fn) {
            try { await fn(); console.log('PASS', name); passed++; }
            catch (error) { console.error('FAIL', name, error.message); failed++; }
        }
        const run = async (expression, arg) => {
            await page.evaluate(expression, arg);
            await page.waitForTimeout(40);
            return page.evaluate(() => observe());
        };

        let fromShortcut;
        await check('ctrl f opens the floating search bar in compact', async () => {
            await page.evaluate(() => reset());
            const s = fromShortcut = await run(() => shortcut('search'));
            assert.equal(s.searchBars, 1, 'the floating search bar is asked for');
            assert.equal(s.bar, true);
            assert.equal(s.panel, false, 'the find and replace panel stays closed');
            assert.equal(s.open, false, 'the left area stays closed');
        });

        await check('toolbar search opens the same bar and closes it', async () => {
            await page.evaluate(() => reset());
            const s = await run(() => toolbarSearch());
            assert.deepEqual(s, fromShortcut, 'the toolbar opens what Ctrl+F opens');
            const again = await run(() => toolbarSearch());
            assert.equal(again.bar, false, 'a second click closes the bar');
            assert.equal(again.panel, false);
            assert.equal(again.searchBars, 1, 'the second click does not ask for the bar again');
        });

        await check('find and replace opens the panel with replace in compact', async () => {
            await page.evaluate(() => reset());
            const s = await run(() => openPanel());
            assert.equal(s.searchBars, 0, 'no search bar');
            assert.equal(s.panel, true, 'the find and replace panel is open');
            assert.equal(s.pressed, true);
            assert.equal(s.open, true, 'the compact shell reveals its left area');
            assert.equal(s.replace, true, 'with the replace field');
            assert.equal(s.focus, 'query', 'the cursor is in the search field');
            const again = await run(() => shortcut('search'));
            assert.equal(again.panel, true, 'Ctrl+F in an open panel keeps the panel');
            assert.equal(again.searchBars, 0, 'and does not open the bar over it');
        });

        await check('ctrl h focuses the replace field', async () => {
            await page.evaluate(() => reset());
            let s = await run(() => shortcut('replace'));
            assert.equal(s.panel, true);
            assert.equal(s.replace, true);
            assert.equal(s.focus, 'replace', 'from a closed panel');
            await page.evaluate(() => document.getElementById('query').focus());
            s = await run(() => shortcut('replace'));
            assert.equal(s.focus, 'replace', 'in an open panel');
            assert.equal(s.searchBars, 0);
        });

        await check('viewer gets no replace field', async () => {
            await page.evaluate(() => reset({edit: false}));
            let s = await run(() => openPanel());
            assert.equal(s.panel, true);
            assert.equal(s.replace, false, 'Find and replace');
            await page.evaluate(() => reset({edit: false}));
            s = await run(() => shortcut('replace'));
            assert.equal(s.panel, true);
            assert.equal(s.replace, false, 'Ctrl+H');
            assert.equal(s.focus, 'query', 'Ctrl+H without the replace field stays in the search field');
            await page.evaluate(() => document.activeElement.blur());
            s = await run(() => shortcut('replace'));
            assert.equal(s.focus, 'query', 'Ctrl+H in an open panel without the replace field goes to the search field');
            const props = {isReadOnly: false, isReviewOnly: false, isFormsOnly: false, isCommentsOnly: false};
            s = await run(p => controllers.LeftMenu.onChangeProtectDocument(p), Object.assign({}, props, {isReadOnly: true}));
            s = await run(p => controllers.LeftMenu.onChangeProtectDocument(p), props);
            assert.equal(s.panel, true);
            assert.equal(s.replace, false, 'unprotecting an open panel does not bring the replace field to a viewer');
        });

        await check('open panel hides the replace field on disconnect and returns it after reconnect', async () => {
            await page.evaluate(() => reset());
            let s = await run(() => openPanel());
            assert.equal(s.replace, true);
            s = await run(options => editingDisable(true, options), DISCONNECT);
            assert.equal(s.replaceShown, false, 'no replace field while the connection is lost');
            s = await run(() => openPanel());
            assert.equal(s.panel, true);
            assert.equal(s.replace, false, 'a panel opened without connection has no replace field');
            s = await run(() => shortcut('replace'));
            assert.equal(s.replace, false);
            s = await run(options => editingDisable(false, options), DISCONNECT);
            assert.equal(s.panel, true, 'the panel stays open');
            assert.equal(s.replace, true, 'the replace field returns by itself');
            s = await run(() => shortcut('search'));
            assert.equal(s.replace, true, 'and stays on the next Ctrl+F');
        });

        await check('open panel returns the replace field after unprotect', async () => {
            for (const kind of ['isReadOnly', 'isCommentsOnly', 'isFormsOnly']) {
                await page.evaluate(() => reset());
                let s = await run(() => openPanel());
                assert.equal(s.replace, true);
                const props = {isReadOnly: false, isReviewOnly: false, isFormsOnly: false, isCommentsOnly: false};
                s = await run(p => controllers.LeftMenu.onChangeProtectDocument(p), Object.assign({}, props, {[kind]: true}));
                assert.equal(s.panel, true);
                assert.equal(s.replace, false, `${kind}: protected`);
                s = await run(() => shortcut('replace'));
                assert.equal(s.replace, false, `${kind}: Ctrl+H keeps it hidden`);
                s = await run(p => controllers.LeftMenu.onChangeProtectDocument(p), props);
                assert.equal(s.panel, true);
                assert.equal(s.replace, true, `${kind}: returns after unprotect`);
            }
        });

        await check('open panel returns the replace field after leaving own view', async () => {
            await page.evaluate(() => reset());
            await run(options => editingDisable(true, options), OWN_VIEW);
            let s = await run(() => openPanel());
            assert.equal(s.panel, true);
            assert.equal(s.replace, false, 'no replace field in own view');
            s = await run(() => openPanel());
            assert.equal(s.replace, false, 'opening it again does not bring it back');
            s = await run(options => editingDisable(false, options), OWN_VIEW);
            assert.equal(s.panel, true);
            assert.equal(s.replace, true, 'the replace field returns by itself');
        });

        await check('stock interface keeps the search bar', async () => {
            await page.evaluate(() => reset({compact: false}));
            const s = await run(() => shortcut('search'));
            assert.equal(s.searchBars, 1, 'Ctrl+F asks for the stock search bar');
            assert.equal(s.panel, false, 'the panel is not opened');
            const h = await run(() => shortcut('replace'));
            assert.equal(h.panel, true, 'Ctrl+H opens the stock panel');
            assert.equal(h.searchBars, 1);
        });

        assert.deepEqual(errors, [], 'no page errors');
    } finally {
        await browser.close();
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
