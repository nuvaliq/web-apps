/* Run with PLAYWRIGHT_MODULE and CHROMIUM_PATH when they are not installed locally.
 * Real DOM and bubble clicks; document selection and property controls are SDK fixtures.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');

(async () => {
    const browser = await chromium.launch({headless: true,
        executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    try {
        const page = await browser.newPage({viewport: {width: 1000, height: 700}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(`<style>
            body.vo-compact #right-menu { display: none !important; }
            body.vo-compact.vo-right-open #right-menu { display: block !important; }
            .settings-panel { display: none; } .settings-panel.active { display: block; }
            </style><body class="vo-compact"><input id="document-input"><div id="bubble"></div>
            <div id="right-menu"><div class="right-panel"><div class="content-box"></div></div></div></body>`);
        for (const name of ['jquery', 'underscore', 'backbone'])
            await page.addScriptTag({path: path.join(root, 'vendor', name, name + '.js')});
        await page.evaluate(() => {
            const settings = new Map(), internal = new Map();
            window.DE = {Views: {}, Controllers: {}, getController: name => window.controllers[name]};
            window.controllers = {Main: {appOptions: {isEdit: true}}};
            Backbone.Controller = Backbone.View;
            const base = Backbone.View.extend({
                fireEvent(name, args) { this.trigger.apply(this, [name].concat(args || [])); },
                show() { this.$el.show(); }, hide() { this.$el.hide(); },
                clearSelection() {}, setDisabledMoreMenuItem() {}
            });
            window.Common = {UI: {SideMenu: base, LayoutManager: {isElementVisible: () => true}},
                Utils: {documentSettingsType: {Paragraph: 0, Table: 1, Image: 2, Shape: 3,
                    TextArt: 4, MailMerge: 5, Signature: 6, Form: 7, SendForSigning: 8, FillingStatus: 9},
                    InternalSettings: {get: key => internal.get(key), set: (key, value) => internal.set(key, value)}},
                localStorage: {getBool: key => !!settings.get(key), getItem: key => settings.get(key),
                    setBool: (key, value) => settings.set(key, value), setItem: (key, value) => settings.set(key, value)},
                NotificationCenter: _.extend({}, Backbone.Events)};
            window.Asc = {c_oAscTypeSelectElement: {Paragraph: 10, Table: 20, Image: 30,
                Shape: 40, Chart: 50, Math: 60}};
            window.define = (deps, factory) => deps[0]?.startsWith('text!') ?
                factory('', $, _, Backbone) : factory({svg: () => ''});
        });
        for (const file of ['view/SelectionBubble.js', 'view/CompactShell.js',
            'view/DocumentActions.js', 'view/RightMenu.js', 'controller/RightMenu.js']) {
            const relative = 'apps/documenteditor/main/app/' + file;
            const changed = file === 'view/SelectionBubble.js' || file === 'view/CompactShell.js';
            const content = process.env.TEST_BASELINE && changed ?
                execFileSync('git', ['show', process.env.TEST_BASELINE + ':' + relative],
                    {cwd: root, encoding: 'utf8'}) : fs.readFileSync(path.join(root, relative), 'utf8');
            await page.addScriptTag({content});
        }
        await page.evaluate(() => {
            const S = Common.Utils.documentSettingsType;
            const ids = ['paragraph', 'table', 'image', 'shape', 'textart', 'mail-merge',
                'signature', 'form', 'send-for-signing', 'filling-status'];
            const menu = Object.assign(Object.create(DE.Views.RightMenu.prototype), Backbone.Events,
                {el: '#right-menu', $el: $('#right-menu')});
            menu.initialize();
            menu.mode = {canBrandingExt: true, customization: {}};
            const buttons = [];
            for (const [name, type] of Object.entries(S)) {
                const id = 'id-' + ids[type] + '-settings';
                $('<div class="settings-panel"></div>').attr('id', id).appendTo('.content-box');
                const button = _.extend({options: {asctype: type}, pressed: false,
                    isDisabled() { return !!this.disabled; }, setDisabled(value) { this.disabled = value; },
                    isActive() { return this.pressed; },
                    toggle(value) {
                        if (value) buttons.forEach(other => { other.pressed = false; });
                        this.pressed = value;
                    }
                }, Backbone.Events);
                buttons.push(button);
                button.on('click', menu.onBtnMenuClick.bind(menu));
                const panel = {ChangeSettings(props) { $('#' + id).text(props?.label || ''); },
                    setLocked() {}, setProtected() {}, disableControls() {}};
                const panelName = {Paragraph: 'paragraph', TextArt: 'textart', MailMerge: 'merge'}[name] ||
                    name[0].toLowerCase() + name.slice(1);
                menu[panelName + 'Settings'] = panel;
                menu['btn' + ({Paragraph: 'Text'}[name] || name)] = button;
                menu._settings[type] = {panel: id, btn: button};
            }
            const controller = Object.assign(Object.create(DE.Controllers.RightMenu.prototype),
                {rightmenu: menu, editMode: true, _initSettings: false,
                    _state: {docProtection: {}}, getApplication: () => ({getController: () => null})});
            menu.on('rightmenuclick', controller.onRightMenuClick.bind(controller));
            controller.onRightMenuAfterRender(menu);
            controllers.RightMenu = controller;
            const viewport = {hlayout: {doLayout() {}, hideItemResizer() {}}};
            controllers.Viewport = {viewport, getView: () => viewport};
            const props = label => ({label, get_Locked: () => false, get_CanAddTable: () => true,
                can_EditBlockContentControl: () => true});
            const paragraph = {get_ObjectType: () => Asc.c_oAscTypeSelectElement.Paragraph,
                get_ObjectValue: () => props('paragraph')};
            window.selectTable = label => {
                const value = props(label);
                window.selected = [paragraph, {get_ObjectType: () => Asc.c_oAscTypeSelectElement.Table,
                    get_ObjectValue: () => value}];
            };
            selectTable('table-A');
            $('#document-input').on('blur', () => { window.selected = [paragraph]; });
            const api = {getSelectedElements: () => selected, asc_IsContentControl: () => false};
            controller.api = api;
            const shell = DE.Views.CompactShell, bubble = DE.Views.SelectionBubble;
            Object.assign(shell, {api, rightOpen: false, advanced: false, startupFailed: false,
                lockState: () => ({on: false, options: {}}), resync() {}});
            DE.Views.DocumentActions.shell = shell;
            Object.assign(bubble, {api, toolbar: {}, $el: $('#bubble')});
            bubble.renderSet('table');
            window.testMenu = menu;
        });
        const button = page.locator('#bubble button').last();
        const expectTable = async label => {
            assert.equal(await page.locator('#right-menu').isVisible(), true);
            assert.notEqual(await page.locator('#right-menu').evaluate(el => el.style.display), 'none');
            assert.equal(await page.locator('#id-table-settings').isVisible(), true);
            assert.equal(await page.locator('#id-table-settings').innerText(), label);
            assert.equal(await page.locator('#id-paragraph-settings').isVisible(), false);
            assert.equal(await page.evaluate(() => testMenu.minimizedMode), false);
            assert.equal(await page.locator('#document-input').evaluate(el => document.activeElement === el), true);
        };
        let passed = 0;
        const check = async (name, run) => { await run(); passed++; console.log('PASS', name); };
        await check('native click opens table and retains document focus', async () => {
            await page.locator('#document-input').focus(); await button.click(); await expectTable('table-A');
        });
        await check('repeated native click keeps settings expanded', async () => {
            await button.click(); await expectTable('table-A');
        });
        await check('already active settings refresh after A to B', async () => {
            await page.evaluate(() => selectTable('table-B')); await button.click(); await expectTable('table-B');
        });
        await check('native hidden menu reopens with active table', async () => {
            await page.evaluate(() => {
                testMenu.hide(); DE.Views.CompactShell.toggleRightPanel();
            });
            await button.click(); await expectTable('table-B');
        });
        await check('real native view switches paragraph to table', async () => {
            await page.evaluate(() => testMenu.SetActivePane(Common.Utils.documentSettingsType.Paragraph, true));
            await button.click(); await expectTable('table-B');
        });
        await check('real native view expands minimized settings', async () => {
            await page.evaluate(() => {
                testMenu.btnTable.toggle(false); testMenu.btnTable.trigger('click', testMenu.btnTable);
            });
            await button.click(); await expectTable('table-B');
        });
        await check('stale bubble does not change the sidebar', async () => {
            await page.evaluate(() => {
                selected = []; DE.Views.CompactShell.toggleRightPanel();
            });
            await button.click();
            assert.equal(await page.locator('#right-menu').isVisible(), false);
        });
        assert.deepEqual(errors, []);
        console.log(`${passed} passed, 0 failed; Chrome ${browser.version()}`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
