/* Run with compiled CSS: COMPACT_CSS=<app.css> node test/unit-tests/documenteditor/selection-bubble-anchor-dom.cjs */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const css = fs.readFileSync(process.env.COMPACT_CSS ||
    path.join(root, 'deploy/web-apps/apps/documenteditor/main/resources/css/app.css'), 'utf8');

(async () => {
    const engine = process.env.BROWSER_ENGINE || 'chromium';
    const browser = await playwright[engine].launch(engine === 'chromium' ?
        (process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH, headless: true} :
            {channel: 'chrome', headless: true}) : {headless: true});
    let passed = 0;
    try {
        for (const dpr of [1, 2]) {
            const context = await browser.newContext({deviceScaleFactor: dpr, viewport: {width: 1280, height: 900}});
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setContent('<style>' + css + '</style><style>' +
                'body{margin:0}#editor_sdk{position:absolute!important;left:120px!important;top:160px!important;' +
                'width:1000px!important;height:600px!important;display:block!important}' +
                '#id_main_view{position:absolute!important;left:20px!important;top:30px!important;' +
                'width:800px!important;height:500px!important;display:block!important}' +
                '#vo-shell{position:absolute;top:0;left:0;height:120px;width:1280px}' +
                '#vo-bubble{animation:none!important}</style><body class="vo-compact">' +
                '<div id="vo-shell"></div><div id="editor_sdk"><div id="id_main_view"></div></div></body>');
            for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js']) {
                await page.addScriptTag({path: path.join(root, file)});
            }
            await page.evaluate(() => {
                const handlers = {};
                Object.defineProperty(window, 'toolbar', {
                    get() {throw new Error('Selection toolbar must not read the browser toolbar');}
                });
                window.Common = {NotificationCenter: {
                    on(names, fn) {names.split(' ').forEach(n => (handlers[n] ||= []).push(fn));},
                    off(names, fn) {names.split(' ').forEach(n => handlers[n] = (handlers[n] || []).filter(f => f !== fn));},
                    trigger(name, ...args) {(handlers[name] || []).slice().forEach(f => f(...args));}
                }};
                window.DE = {Views: {CompactShell: {advanced: false, editingLocked: () => false}}};
                window.Asc = {c_oAscTypeSelectElement: {Paragraph: 0, Table: 1, Image: 2, Shape: 3, Chart: 4, Math: 5}};
                window.define = (deps, factory) => factory({svg: () => '<svg width="20" height="20"></svg>'});
                const callbacks = {};
                const controller = {selection: {}, objects: [{Get_Id: () => 'one', selectStartPage: 0}],
                    bounds: {minX: 200, minY: 200, maxX: 300, maxY: 300, pageIndex: 0},
                    getSelectedArray() {return this.objects;}, getSelectedObjectsBounds() {return this.bounds;}};
                window.probe = {controller, zoom: 1, callbacks};
                probe.api = {WordControl: {m_oLogicDocument: {DrawingObjects: controller}, m_oDrawingDocument: {
                    m_arrPages: [{}, {}], ConvertCoordsToCursor: (x, y) => ({X: x * probe.zoom, Y: y * probe.zoom})}},
                    getSelectedElements: () => [{get_ObjectType: () => 2, get_ObjectValue: () => ({})}],
                    asc_GetSelectionBounds: () => [[0,0],[0,0],[0,0],[0,0]],
                    asc_registerCallback: (n, f) => callbacks[n] = f,
                    asc_unregisterCallback: (n, f) => {if (callbacks[n] === f) delete callbacks[n];}};
            });
            await page.addScriptTag({path: path.join(root, 'apps/documenteditor/main/app/view/SelectionBubble.js')});
            await page.evaluate(() => DE.Views.SelectionBubble.create(probe.api).refresh());
            const state = () => page.evaluate(() => {
                const bubble = DE.Views.SelectionBubble, rect = bubble.$el[0].getBoundingClientRect();
                return {open: bubble.isOpen(), panel: {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom},
                    anchor: bubble.readAnchor({kind: 'image'}), area: bubble.availableRect()};
            });
            for (const zoom of [0.75, 1, 1.5]) {
                await page.evaluate(z => {probe.zoom = z; DE.Views.SelectionBubble.refresh();}, zoom);
                const s = await state(); assert(s.open);
                assert(Math.abs(s.panel.bottom + 40 - s.anchor.rect.top) <= 2);
                assert(s.panel.left >= s.area.left + 6 && s.panel.right <= s.area.right - 6);
                assert(await page.evaluate(({x, y}) => {
                    const hit = document.elementFromPoint(x, y);
                    return !hit || !hit.closest('#vo-bubble');
                }, {x: (s.anchor.rect.left + s.anchor.rect.right) / 2, y: s.anchor.rect.top - 24}));
                passed++; console.log('PASS frame at zoom ' + zoom + ' DPR ' + dpr);
            }
            await page.evaluate(() => {
                probe.zoom = 1;
                probe.controller.bounds = {minX: 200, minY: 0, maxX: 300, maxY: 100, pageIndex: 0};
                DE.Views.SelectionBubble.refresh();
            });
            let s = await state(); assert(s.open);
            assert(Math.abs(s.panel.top - s.anchor.rect.bottom - 42) <= 2);
            assert(await page.evaluate(({x, y}) => {
                const hit = document.elementFromPoint(x, y);
                return !hit || !hit.closest('#vo-bubble');
            }, {x: (s.anchor.rect.left + s.anchor.rect.right) / 2, y: s.anchor.rect.bottom + 25}));
            passed++; console.log('PASS below object near header DPR ' + dpr);
            await page.evaluate(() => {
                probe.controller.bounds = {minX: -40, minY: 200, maxX: 100, maxY: 300, pageIndex: 0};
                DE.Views.SelectionBubble.refresh();
            });
            s = await state(); assert(s.open && s.panel.left >= s.area.left + 6);
            passed++; console.log('PASS partially visible object DPR ' + dpr);
            await page.evaluate(() => {
                const toolbar = $('<div id="vo-tb">').appendTo('#vo-shell')[0];
                const status = $('<div id="vo-status">').appendTo('body')[0];
                const place = (node, top, height) => {
                    for (const [key, value] of Object.entries({
                        display: 'block', position: 'absolute', margin: '0', left: '140px',
                        top: top + 'px', width: '800px', height: height + 'px'
                    })) node.style.setProperty(key, value, 'important');
                };
                place(toolbar, 190, 46);
                place(status, 660, 30);
                probe.controller.bounds = {minX: 0, minY: 0, maxX: 800, maxY: 500, pageIndex: 0};
                DE.Views.SelectionBubble.refresh();
            });
            s = await state(); assert(s.open);
            const chrome = await page.evaluate(() => ({
                toolbarBottom: document.getElementById('vo-tb').getBoundingClientRect().bottom,
                statusTop: document.getElementById('vo-status').getBoundingClientRect().top
            }));
            assert.equal(s.area.top, chrome.toolbarBottom);
            assert.equal(s.area.bottom, chrome.statusTop);
            assert(s.panel.top >= chrome.toolbarBottom + 6 && s.panel.bottom <= chrome.statusTop - 6);
            assert(s.panel.left >= s.anchor.rect.left + 6 && s.panel.right <= s.anchor.rect.right - 6);
            await page.evaluate(() => {
                $('#vo-tb, #vo-status').remove();
                $('#editor_sdk').trigger('wheel');
            });
            assert.equal((await state()).open, false);
            await page.waitForFunction(() => DE.Views.SelectionBubble.isOpen());
            passed++; console.log('PASS large object avoids chrome and returns after scroll DPR ' + dpr);
            const dismissedAfterScrollbar = await page.evaluate(() => {
                const bubble = DE.Views.SelectionBubble;
                bubble.dismiss();
                const dismissed = bubble.dismissed;
                const scrollbar = $('<div id="id_vertical_scroll"><canvas></canvas></div>').appendTo('#editor_sdk');
                scrollbar.find('canvas').trigger('mousedown').trigger('mouseup');
                scrollbar.remove();
                return bubble.dismissed === dismissed && bubble.refreshTimer === null;
            });
            assert(dismissedAfterScrollbar);
            passed++; console.log('PASS scrollbar drag keeps Escape dismissal DPR ' + dpr);
            await page.evaluate(() => {
                probe.controller.bounds = {minX: 200, minY: 200, maxX: 300, maxY: 300, pageIndex: 0};
                DE.Views.SelectionBubble.dismissed = null;
                DE.Views.SelectionBubble.refresh();
                probe.controller.bounds.minX += 200; probe.controller.bounds.maxX += 200;
                Common.NotificationCenter.trigger('layout:changed');
            });
            await page.waitForTimeout(60);
            s = await state(); assert(s.open);
            assert(Math.abs((s.panel.left + s.panel.right) / 2 - (s.anchor.rect.left + s.anchor.rect.right) / 2) <= 2);
            passed++; console.log('PASS layout without focus DPR ' + dpr);
            await page.evaluate(() => DE.Views.SelectionBubble.dismiss());
            await page.setViewportSize({width: 1200, height: 850});
            await page.waitForTimeout(60); assert.equal((await state()).open, false);
            passed++; console.log('PASS Escape survives resize DPR ' + dpr);
            await page.evaluate(() => {
                DE.Views.SelectionBubble.dismissed = null; DE.Views.SelectionBubble.refresh();
                const a = document.createElement('div'), b = document.createElement('div');
                probe.dialogs = [{$window: $(a)}, {$window: $(b)}];
                probe.dialogs.forEach(d => Common.NotificationCenter.trigger('modal:show', d));
                Common.NotificationCenter.trigger('modal:hide', probe.dialogs[0]);
                DE.Views.SelectionBubble.refresh();
            });
            assert.equal((await state()).open, false);
            await page.evaluate(() => {
                Common.NotificationCenter.trigger('modal:close', probe.dialogs[1]);
            });
            await page.waitForFunction(() => DE.Views.SelectionBubble.isOpen());
            passed++; console.log('PASS nested modal lifecycle DPR ' + dpr);
            await page.evaluate(() => {
                document.getElementById('id_main_view').style.setProperty('width', '80px', 'important');
                DE.Views.SelectionBubble.refresh();
            });
            assert.equal((await state()).open, false);
            passed++; console.log('PASS no room hides DPR ' + dpr);
            const recreated = await page.evaluate(() => {
                const bubble = DE.Views.SelectionBubble, old = probe.callbacks.asc_onFocusObject;
                bubble.format.bold = true;
                bubble.dispose(); bubble.create(probe.api);
                old(probe.api.getSelectedElements());
                return {nodes: document.querySelectorAll('#vo-bubble').length, buttons: bubble.$el.children().length,
                    kind: bubble.kind, format: bubble.format, btn: bubble.btn, dismissed: bubble.dismissed,
                    pending: bubble.pending, imgProps: bubble.imgProps};
            });
            assert.deepEqual(recreated, {nodes: 1, buttons: 0, kind: 'text', format: {}, btn: {},
                dismissed: null, pending: null, imgProps: null});
            assert.equal((await state()).open, false);
            assert.deepEqual(errors, []);
            await context.close();
            passed++; console.log('PASS dispose and recreate DPR ' + dpr);
        }
        console.log(passed + ' browser checks passed');
    } finally {await browser.close();}
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
