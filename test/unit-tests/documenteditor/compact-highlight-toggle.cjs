/* Run: node test/unit-tests/documenteditor/compact-highlight-toggle.cjs
 * The highlight button of the compact toolbar toggles like Bold: it is pressed while the
 * highlighter is on or the whole selection is highlighted, and a click on the pressed button
 * removes the highlight from the selection and turns the highlighter off. A caret, a mixed
 * selection and an unhighlighted selection leave the button unpressed, and its click opens the
 * palette. Loads the production compact toolbar into a browser page; the SDK is a fixture that
 * keeps the selection, its highlight and the highlighter the way word/api.js reports them
 * (asc_onTextHighLight, asc_onBold, asc_onMarkerFormatChanged, get_TextProps).
 * Set PLAYWRIGHT_MODULE to the installed Playwright package when not in NODE_PATH.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const locale = JSON.parse(source('apps/documenteditor/main/locale/en.json'));

(async () => {
    const browser = await chromium.launch({headless: true,
        executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    let passed = 0, failed = 0;
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 720}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<div id="toolbar"></div>');
        for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js', 'vendor/backbone/backbone.js'])
            await page.addScriptTag({content: source(file)});
        await page.evaluate(() => {
            window.DE = {Views: {CompactShell: {canAddComment: () => false}}, Controllers: {}, getController: () => null};
            window.Common = {UI: {isRTL: () => false, Menu: {Manager: {hideAll: () => {}}}},
                NotificationCenter: _.extend({}, Backbone.Events),
                Utils: {InternalSettings: {get: () => null, set: () => {}}},
                localStorage: {getItem: () => null, setItem: () => {}, getBool: () => false, setBool: () => {}}};
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
            /* highlight: -1 none, null mixed, otherwise a hex string. */
            const engine = window.engine = {selection: false, highlight: -1, marker: false, calls: [], callbacks: {}};
            const fire = window.fire = (name, value) => (engine.callbacks[name] || []).forEach(fn => fn(value));
            /* What word/api.js UpdateTextPr reports after the selection or its format changes: Bold
               always, the highlight only when it is uniform (sync_TextHighLight skips undefined). */
            window.update = () => {
                fire('asc_onBold', false);
                if (engine.highlight !== null) fire('asc_onTextHighLight', {});
            };
            const own = {
                asc_registerCallback: (name, fn) => { (engine.callbacks[name] = engine.callbacks[name] || []).push(fn); },
                can_CopyCut: () => engine.selection,
                get_TextProps: () => ({get_TextPr: () => ({get_HighLight: () => engine.highlight === -1 || engine.highlight === null
                    ? engine.highlight : {get_hex: () => engine.highlight}})}),
                /* word/api.js SetMarkerFormat: the highlighter takes the value, and when it turns on the
                   selection gets the colour or, without one, loses its highlight. */
                SetMarkerFormat: (value, isColor, r, g, b) => {
                    engine.calls.push(value ? (isColor ? 'colour' : 'eraser') : 'off');
                    engine.marker = value;
                    if (value && engine.selection) {
                        engine.highlight = isColor ? [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('') : -1;
                        update();
                    }
                }
            };
            const tb = DE.Views.CompactToolbar;
            const prefix = 'DE.Views.CompactToolbar.';
            for (const [key, value] of Object.entries(strings))
                if (key.startsWith(prefix)) tb[key.slice(prefix.length)] = value;
            tb.api = new Proxy(own, {get: (target, key) => key in target ? target[key] : () => {}});
            tb.build().appendTo('#toolbar');
            tb.bindApi();

            const $wrap = () => $('#vo-tb .vo-cb').filter((i, el) =>
                $(el).children('button').attr('aria-label') === tb.tipHighlight ||
                $(el).children('button').attr('aria-label') === tb.textMarkerOff).first();
            window.clickButton = () => $wrap().children('button').trigger('click');
            window.pick = hex => $wrap().find('.vo-pal-item[data-color="' + hex + '"]').trigger('click');
            window.select = (selection, highlight) => {
                engine.selection = selection;
                engine.highlight = highlight;
                update();
            };
            window.reset = () => {
                $('.vo-cb').removeClass('open');
                engine.calls = [];
                engine.marker = false;
                fire('asc_onMarkerFormatChanged', false);
                select(false, -1);
            };
            window.observe = () => ({
                pressed: $wrap().children('button').hasClass('on'),
                label: $wrap().children('button').attr('aria-label'),
                palette: $wrap().hasClass('open'),
                highlight: engine.highlight, marker: engine.marker, calls: engine.calls.slice()
            });
        }, locale);

        async function check(name, fn) {
            try { await fn(); console.log('PASS', name); passed++; }
            catch (error) { console.error('FAIL', name, error.message); failed++; }
        }
        const run = async (expression, arg) => {
            await page.evaluate(expression, arg);
            return page.evaluate(() => observe());
        };
        const tip = locale['DE.Views.CompactToolbar.tipHighlight'];
        const offTip = locale['DE.Views.CompactToolbar.textMarkerOff'];

        await check('a second click removes the highlight just applied to the selection', async () => {
            await page.evaluate(() => reset());
            let s = await run(() => select(true, -1));
            assert.equal(s.pressed, false, 'plain selection');
            s = await run(() => clickButton());
            assert.equal(s.palette, true, 'the first click opens the palette');
            s = await run(() => pick('ffff00'));
            assert.equal(s.highlight, 'ffff00');
            assert.equal(s.pressed, true, 'the button is pressed after the colour is picked');
            s = await run(() => clickButton());
            assert.equal(s.highlight, -1, 'the highlight is removed from the selection');
            assert.equal(s.marker, false, 'and the highlighter is off');
            assert.deepEqual(s.calls, ['colour', 'eraser', 'off']);
            assert.equal(s.pressed, false);
            assert.equal(s.palette, false, 'the palette does not open');
            assert.equal(s.label, tip);
        });

        await check('a highlighted selection presses the button like Bold', async () => {
            await page.evaluate(() => reset());
            let s = await run(() => select(true, '00ff00'));
            assert.equal(s.pressed, true);
            assert.equal(s.label, tip, 'the tip stays the colour command: there is no highlighter to turn off');
            s = await run(() => clickButton());
            assert.equal(s.highlight, -1, 'the click removes it');
            assert.deepEqual(s.calls, ['eraser', 'off']);
            assert.equal(s.pressed, false);
            assert.equal(s.palette, false);
        });

        await check('caret and mixed selection keep the palette', async () => {
            await page.evaluate(() => reset());
            let s = await run(() => select(false, 'ffff00'));
            assert.equal(s.pressed, false, 'a caret in highlighted text');
            s = await run(() => select(true, null));
            assert.equal(s.pressed, false, 'a mixed selection');
            s = await run(() => clickButton());
            assert.equal(s.palette, true, 'opens the palette');
            assert.deepEqual(s.calls, [], 'without touching the document');
        });

        await check('a mixed selection after a highlighted one releases the button', async () => {
            await page.evaluate(() => reset());
            let s = await run(() => select(true, 'ffff00'));
            assert.equal(s.pressed, true);
            s = await run(() => select(true, null));
            assert.equal(s.pressed, false, 'the engine sends no highlight for it, Bold carries the update');
        });

        await check('the highlighter without a selection only turns off', async () => {
            await page.evaluate(() => reset());
            await run(() => clickButton());
            let s = await run(() => pick('00ffff'));
            assert.equal(s.marker, true);
            assert.equal(s.pressed, true);
            assert.equal(s.label, offTip);
            s = await run(() => clickButton());
            assert.equal(s.marker, false);
            assert.deepEqual(s.calls, ['colour', 'off'], 'no eraser without a selection');
            assert.equal(s.pressed, false);
        });

        await check('the engine turning the highlighter off keeps a highlighted selection pressed', async () => {
            await page.evaluate(() => reset());
            await run(() => select(true, -1));
            await run(() => clickButton());
            await run(() => pick('ffff00'));
            let s = await run(() => fire('asc_onMarkerFormatChanged', false));
            assert.equal(s.pressed, true, 'the selection is still highlighted');
            assert.equal(s.label, tip);
        });

        assert.deepEqual(errors, [], 'no page errors');
    } finally {
        await browser.close();
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
