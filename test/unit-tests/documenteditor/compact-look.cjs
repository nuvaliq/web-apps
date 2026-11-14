/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-look.cjs
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names the compiled app.css.
 * Look of the new elements of the compact shell of the document editor: the header
 * hint, the icons of the new menu items and slash commands, the wait sign of the edit request in the menu
 * bar, the greyed slash command and toolbar list row, the font size field and the table size grid styled
 * by the stylesheet, and the two windows of the menu on the window template (password, header settings).
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH; CHROMIUM_PATH optional) over
 * fixtures/compact-shell-page.cjs and fixtures/compact-quick-page.cjs with the compiled styles; the
 * catalog and the shared icon list are read in vm through common/compact/lib/documents-editor.cjs.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const shellPage = require('./fixtures/compact-shell-page.cjs');
const quick = require('./fixtures/compact-quick-page.cjs');
const docs = require('../common/compact/lib/documents-editor.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/documenteditor/main/app/view');
const AIR = path.join(ROOT, 'apps/common/main/resources/img/air');
const read = file => fs.readFileSync(file, 'utf8');

function stylesheet() {
    const file = process.env.COMPACT_CSS_DOCUMENTEDITOR || process.env.COMPACT_CSS;
    if (!file || !fs.existsSync(file))
        throw new Error('set COMPACT_CSS_DOCUMENTEDITOR to app.css of the document editor LESS build');
    return read(file);
}

/* The shared icon list, as the shell asks it. */
function icons() {
    const box = {document: {baseURI: 'http://stand.test/web-apps/apps/documenteditor/main/index.html'}, URL};
    box.window = box;
    box.define = (deps, f) => f();
    vm.createContext(box);
    vm.runInContext(read(path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js')), box);
    return box.Common.UI.Compact.Icons;
}

/* Menu items that had no icon of their own, and the icon each one has now. */
const NEW_ICONS = {
    'edit.autocorrect': 'autoCorrect',
    'view.screenReader': 'access',
    'insert.horizontalLine': 'horizontalLine',
    'insert.break.page': 'pageBreak',
    'insert.break.section': 'sectionBreak',
    'insert.break.blank': 'blankPage',
    'insert.field': 'field',
    'insert.control': 'contentControl',
    'collab.trackAll': 'trackAll',
    'collab.unprotect': 'unlock',
    'help.shortcuts': 'keyboard'
};

(async () => {
    const css = stylesheet();
    const browser = await shellPage.launch();
    const {check, done} = shellPage.checker();
    const rect = (page, sel) => page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el || !el.getClientRects().length) return null;
        const r = el.getBoundingClientRect();
        return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height};
    }, sel);
    try {
        await check('header hint does not cover the header text', async () => {
            const page = await shellPage.open(browser);
            const canvas = await rect(page, '#editor_sdk');
            const middle = canvas.top + canvas.height / 2;
            /* A header is at the top of the window when the caret is in it: the hint is below the middle. */
            await page.evaluate(() => select('header'));
            const forHeader = await rect(page, '#vo-hf-hint');
            assert.ok(forHeader.top > middle, 'the hint of a header is low: ' + JSON.stringify({forHeader, canvas}));
            assert.ok(forHeader.bottom <= canvas.bottom, 'above the bottom row');
            /* A footer is at the bottom: the hint goes up, under the toolbar. */
            await page.evaluate(() => select('footer'));
            const forFooter = await rect(page, '#vo-hf-hint');
            const toolbar = await rect(page, '#vo-tb');
            assert.ok(forFooter.bottom < middle, 'the hint of a footer is high: ' + JSON.stringify({forFooter, canvas}));
            assert.ok(forFooter.top >= toolbar.bottom, 'under the toolbar: ' + JSON.stringify({forFooter, toolbar}));
            /* The header and menu collapsed: the toolbar moves up, the hint of a footer follows it, as close
               to the toolbar as with the header and menu shown. */
            const gap = forFooter.top - toolbar.bottom;
            await page.evaluate(() => { select('text'); shell.toggleFocus(); select('footer'); });
            await shellPage.settle(page);
            const inFocus = await rect(page, '#vo-hf-hint');
            const raised = await rect(page, '#vo-tb');
            assert.ok(raised.bottom < toolbar.bottom, 'the toolbar moves up');
            assert.equal(inFocus.top - raised.bottom, gap, 'under the raised toolbar: ' + JSON.stringify({inFocus, raised}));
            /* The toolbar folded and the header and menu gone by scrolling: the hint stays near the top edge. */
            await page.evaluate(() => { shell.toggleToolbar(); shell.hideTop('scroll'); select('footer'); });
            await shellPage.settle(page);
            const bare = await rect(page, '#vo-hf-hint');
            assert.ok(bare.top > 0 && bare.top < inFocus.top, 'near the top edge: ' + JSON.stringify(bare));
            await page.evaluate(() => { shell.toggleToolbar(); shell.toggleFocus(); select('header'); });
            await shellPage.settle(page);
            const low = await rect(page, '#vo-hf-hint');
            assert.ok(low.top > middle, 'a header with the top collapsed: the hint is low');
            assert.ok(low.bottom <= canvas.bottom, 'still above the bottom row');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('new menu items have icons', async () => {
            const G = docs.host();
            const actions = G.DE.Views.DocumentActions;
            const set = icons();
            const got = {};
            Object.keys(NEW_ICONS).forEach(k => { got[k] = (actions.command(k) || {}).i; });
            assert.deepEqual(got, NEW_ICONS);
            Object.values(NEW_ICONS).forEach(name => {
                assert.equal(set.has(name), true, name + ' is in the shared list');
                assert.ok(fs.existsSync(path.join(AIR, name + '.svg')), name + '.svg is in the shared folder');
            });
            /* Each break has its own icon. */
            assert.equal(new Set(['insert.break.page', 'insert.break.section', 'insert.break.blank'].map(k => got[k])).size, 3);
            /* Slash commands: every one has an icon of the set, the breaks and the line their own. */
            const page = await quick.open(browser);
            const list = await page.evaluate(() => slash.buildItems().map(i => ({k: i.k, ic: i.ic})));
            const ic = {};
            list.forEach(i => { ic[i.k] = i.ic; });
            list.forEach(i => assert.equal(set.has(i.ic), true, i.k + ': ' + i.ic + ' is in the shared list'));
            assert.deepEqual(['insert.break.page', 'insert.break.section', 'insert.break.blank', 'insert.horizontalLine']
                .map(k => ic[k]), ['pageBreak', 'sectionBreak', 'blankPage', 'horizontalLine']);
            await page.close();
        });

        await check('waiting edit request shows the wait sign in the menu bar', async () => {
            const page = await shellPage.open(browser);
            const status = () => page.evaluate(() => {
                const el = shell.menu.status(), before = getComputedStyle(el, '::before');
                return {text: el.textContent, busy: el.classList.contains('vo-busy'), sign: before.content !== 'none' &&
                    parseFloat(before.width) > 0 && /hourglass\.svg/.test(before.webkitMaskImage || before.maskImage)};
            });
            await page.evaluate(() => {
                window.waiting = true;
                const stock = DE.getController;
                DE.getController = name => (name === 'Main' ? {isEditRequestWaiting: () => waiting} : stock(name));
                actions.showRequestStatus('Requesting editing rights…');
            });
            assert.deepEqual(await status(), {text: 'Requesting editing rights…', busy: true, sign: true});
            /* The paste hint over it has no sign; when it goes, the sign is back. */
            await page.evaluate(() => { actions.pasteHint(); });
            assert.equal((await status()).busy, false, 'no wait sign on the paste hint');
            await page.evaluate(() => { clearTimeout(actions.pasteHintTimer); actions.pasteHintText = ''; actions.renderStatus(); });
            assert.equal((await status()).busy, true);
            /* The answer: text only. */
            await page.evaluate(() => { waiting = false; actions.showRequestStatus('You no longer have permission'); });
            assert.deepEqual(await status(), {text: 'You no longer have permission', busy: false, sign: false});
            await page.evaluate(() => actions.showRequestStatus(''));
            assert.equal((await status()).busy, false);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('greyed slash command and toolbar list row differ beyond colour', async () => {
            assert.ok(!/opacity/.test(read(path.join(VIEW, 'SlashMenu.js'))), 'no inline dimming in SlashMenu.js');
            const page = await quick.open(browser, {context: {protection: {isCommentsOnly: true}}});
            await page.addStyleTag({content: css});
            await page.evaluate(() => slash.show());
            const sel = '#vo-slash .vo-slash-item.vo-locked';
            await page.hover(sel);
            const off = await page.evaluate(sel => {
                const b = document.querySelector(sel), cs = getComputedStyle(b);
                const live = document.querySelector('#vo-slash .vo-slash-item:not(.vo-locked)');
                return {style: b.getAttribute('style'), cursor: cs.cursor, background: cs.backgroundColor,
                    label: getComputedStyle(b.querySelector('.vo-slash-t')).color,
                    icon: getComputedStyle(b.querySelector('.vo-slash-i')).color,
                    liveLabel: getComputedStyle(live.querySelector('.vo-slash-t')).color};
            }, sel);
            assert.equal(off.style, null, 'no inline style');
            assert.equal(off.cursor, 'default');
            assert.equal(off.background, 'rgba(0, 0, 0, 0)', 'no fill under the pointer');
            assert.notEqual(off.label, off.liveLabel, 'the label is muted');
            assert.equal(off.icon, off.label, 'the icon is muted with it');
            /* A greyed row of a toolbar list: icon and mark muted with the label. */
            const row = await page.evaluate(() => {
                const wrap = document.createElement('span');
                wrap.className = 'vo-pop-wrap open';
                wrap.innerHTML = '<div class="vo-pop vo-pop-list"><button class="vo-pop-item vo-locked on">' +
                    '<span class="vo-pop-i">i</span><span>Label</span><span class="vo-pop-check">v</span></button></div>';
                document.getElementById('vo-tb').appendChild(wrap);
                const b = wrap.querySelector('.vo-pop-item');
                return {label: getComputedStyle(b).color, icon: getComputedStyle(b.querySelector('.vo-pop-i')).color,
                    mark: getComputedStyle(b.querySelector('.vo-pop-check')).color, cursor: getComputedStyle(b).cursor};
            });
            assert.deepEqual([row.icon, row.mark, row.cursor], [row.label, row.label, 'default']);
            await page.close();
        });

        await check('font size field and table size grid take their look from the stylesheet', async () => {
            /* No inline look left in the code. */
            const toolbar = read(path.join(VIEW, 'CompactToolbar.js'));
            const at = toolbar.indexOf('sizeBox: function');
            const size = toolbar.slice(at, toolbar.indexOf('var cur = null, open = false', at));
            assert.ok(size.length > 100 && !/\.css\(/.test(size), 'sizeBox sets no inline style');
            const actionsSrc = read(path.join(VIEW, 'DocumentActions.js'));
            const grid = actionsSrc.slice(actionsSrc.indexOf('tableGrid: function'), actionsSrc.indexOf('runOwnRow: function'));
            assert.ok(grid.length > 100 && !/cssText|\.style\./.test(grid), 'tableGrid sets no inline style');
            const page = await quick.open(browser);
            await page.addStyleTag({content: css});
            const field = await page.evaluate(() => {
                const input = document.querySelector('#vo-tb .vo-size-input'), box = input.parentNode;
                const caret = document.querySelector('#vo-tb .vo-size-caret');
                const ci = getComputedStyle(input), cb = getComputedStyle(box), cc = getComputedStyle(caret);
                return {style: [input, box, caret].map(e => e.getAttribute('style')),
                    border: ci.borderTopWidth, background: ci.backgroundColor, padding: ci.paddingLeft,
                    font: [ci.fontSize, ci.fontFamily, ci.color].join('|'), boxFont: [cb.fontSize, cb.fontFamily, cb.color].join('|'),
                    display: cb.display, caretBg: cc.backgroundColor, caretPad: cc.paddingLeft};
            });
            assert.deepEqual(field.style, [null, null, null], 'no inline style on the size field');
            assert.deepEqual([field.border, field.background, field.padding], ['0px', 'rgba(0, 0, 0, 0)', '0px'],
                'the field has no frame of its own');
            assert.equal(field.font, field.boxFont, 'the field takes the font and colour of its box');
            /* The box is a flex item of the list wrapper: its inline-flex computes to flex. */
            assert.deepEqual([field.display, field.caretBg, field.caretPad], ['flex', 'rgba(0, 0, 0, 0)', '0px']);
            /* The grid: a plain stop and a live region only a screen reader hears. */
            const cells = await page.evaluate(() => {
                const row = document.createElement('div');
                row.className = 'vo-mn';
                row.innerHTML = '<div class="vo-mn-drop open"><div class="vo-mn-sub vo-mn-widget">' +
                    '<button class="vo-mn-dim">grid</button><span class="vo-mn-dim-live">3 × 2</span></div></div>';
                document.body.appendChild(row);
                const b = getComputedStyle(row.querySelector('.vo-mn-dim'));
                const l = row.querySelector('.vo-mn-dim-live').getBoundingClientRect();
                return {display: b.display, border: b.borderTopWidth, background: b.backgroundColor, cursor: b.cursor,
                    live: [l.width, l.height], clip: getComputedStyle(row.querySelector('.vo-mn-dim-live')).position};
            });
            assert.deepEqual(cells, {display: 'block', border: '0px', background: 'rgba(0, 0, 0, 0)', cursor: 'default',
                live: [1, 1], clip: 'absolute'});
            await page.close();
        });

        await check('font size field reads as the other value lists', async () => {
            const page = await quick.open(browser);
            await page.addStyleTag({content: css});
            const look = await page.evaluate(() => {
                const style = sel => getComputedStyle(document.querySelector(sel));
                const input = style('#vo-tb .vo-size-input'), label = style('#vo-tb .vo-w-font .vo-value-label');
                const box = style('#vo-tb .vo-size-box'), btn = style('#vo-tb .vo-w-font .vo-value-btn');
                const plate = cs => [cs.borderTopLeftRadius, cs.paddingLeft, cs.paddingRight];
                return {font: [input.fontSize, label.fontSize], box: plate(box), btn: plate(btn)};
            });
            /* The digits of the field are the size of the font name next to it. */
            assert.equal(look.font[0], look.font[1], 'the field text is the size of the font list label');
            /* Rounding and the inner sides of the box are those of the font list button. */
            assert.deepEqual(look.box, look.btn, 'the box has the rounding and sides of the font list button');
            await page.close();
        });

        await check('password and header settings windows follow the window template', async () => {
            const page = await browser.newPage({viewport: {width: 1000, height: 700}});
            /* The stock markup of the two windows: the box of Common.UI.Window, the password field with its
               eye button (InputFieldBtnPassword), three check boxes (CheckBox) and the distance (MetricSpinner). */
            const win = (cls, body) => `<div class="asc-window modal-dlg vo-win ${cls}" style="width:420px">
                <div class="header"><div class="tools"><div class="tool close"></div></div><div class="title">T</div></div>
                <div class="body"><div class="box">${body}</div><div class="footer center">
                <button class="btn normal dlg-btn primary">Apply</button><button class="btn normal dlg-btn">Cancel</button></div></div></div>`;
            const box = cls => `<div class="${cls}"><label class="checkbox-indeterminate"><input type="checkbox" class="checkbox__native">` +
                '<label class="checkbox__shape"></label><span>Option</span></label></div>';
            await page.setContent(`<!doctype html><style>${css}</style><body class="vo-compact">
                ${win('vo-win--unprotect', '<div class="vo-unprotect"><label class="input-label">Password</label>' +
                    '<div class="vo-unprotect-pwd"><div class="input-field input-field-btn"><input type="password" class="form-control">' +
                    '<span class="input-error"></span><div class="select-button"><button type="button" class="btn btn-toolbar">' +
                    '<i class="icon toolbar__icon btn-hide-password">&nbsp;</i></button></div></div></div></div>')}
                ${win('vo-win--hf', '<div class="vo-hf-settings">' + box('vo-hf-first') + box('vo-hf-odd') + box('vo-hf-link') +
                    '<label class="input-label">Distance</label><div class="vo-hf-distance spinner" style="width:100px">' +
                    '<input type="text" class="form-control"><div class="spinner-buttons"><button class="spinner-up"><i></i></button>' +
                    '<button class="spinner-down"><i></i></button></div></div></div>')}</body>`);
            const pwd = await page.evaluate(() => {
                const w = document.querySelector('.vo-win--unprotect');
                const input = w.querySelector('.form-control').getBoundingClientRect();
                const btn = w.querySelector('.select-button .btn-toolbar').getBoundingClientRect();
                const pad = parseFloat(getComputedStyle(w.querySelector('.form-control')).paddingRight);
                const box = w.querySelector('.box').getBoundingClientRect();
                return {height: input.height, width: input.width, boxWidth: box.width,
                    centred: Math.abs((btn.top + btn.height / 2) - (input.top + input.height / 2)) <= 1,
                    inside: btn.right <= input.right && btn.left >= input.left, clear: input.right - pad <= btn.left + 0.5};
            });
            assert.deepEqual(pwd, Object.assign({}, pwd, {height: 38, centred: true, inside: true, clear: true}),
                'the eye button sits in the field: ' + JSON.stringify(pwd));
            assert.equal(pwd.width, pwd.boxWidth, 'the field is as wide as the window body');
            const hf = await page.evaluate(() => {
                const w = document.querySelector('.vo-win--hf');
                const r = sel => w.querySelector(sel).getBoundingClientRect();
                const first = r('.vo-hf-first'), odd = r('.vo-hf-odd'), link = r('.vo-hf-link');
                const label = r('.input-label'), spin = r('.spinner'), box = r('.box');
                return {step: [Math.round(odd.top - first.bottom), Math.round(link.top - odd.bottom)],
                    label: Math.round(label.top - link.bottom), field: spin.height, full: spin.width === box.width,
                    gap: Math.round(spin.top - label.bottom)};
            });
            assert.deepEqual(hf, {step: [12, 12], label: 16, field: 38, full: true, gap: 6}, 'header settings layout');
            await page.close();
        });

        await check('password and header settings windows keep their content inside the window', async () => {
            const page = await browser.newPage({viewport: {width: 1000, height: 700}});
            /* As AdvancedSettingsWindow renders them: the content panel gets the content width (372) inline and
               the window its panel plus 2 (374) inline, while the window was asked for 420. */
            const win = (cls, body) => `<div class="asc-window modal-dlg vo-win ${cls}" style="width:374px">
                <div class="header"><div class="tools"><div class="tool close"></div></div><div class="title">T</div></div>
                <div class="body"><div class="box"><div class="content-panel" style="width:372px">${body}</div></div>
                <div class="footer center"><button class="btn normal dlg-btn primary">Apply</button>
                <button class="btn normal dlg-btn">Cancel</button></div></div></div>`;
            const box = (cls, text) => `<div class="${cls}"><label class="checkbox-indeterminate">` +
                '<input type="checkbox" class="checkbox__native"><label class="checkbox__shape"></label>' +
                `<span>${text}</span></label></div>`;
            await page.setContent(`<!doctype html><style>${css}</style><body class="vo-compact">
                ${win('vo-win--unprotect', '<div class="vo-unprotect"><label class="input-label">Password</label>' +
                    '<div class="vo-unprotect-pwd"><div class="input-field input-field-btn"><input type="password" class="form-control">' +
                    '<span class="input-error"></span><div class="select-button"><button type="button" class="btn btn-toolbar">' +
                    '<i class="icon toolbar__icon btn-hide-password">&nbsp;</i></button></div></div></div></div>')}
                ${win('vo-win--hf', '<div class="vo-hf-settings">' + box('vo-hf-first', 'Different first page header and footer') +
                    box('vo-hf-odd', 'Different odd and even pages') + box('vo-hf-link', 'Link to previous') +
                    '<label class="input-label">Distance from the edge</label><div class="vo-hf-distance spinner" style="width:100px">' +
                    '<input type="text" class="form-control"><div class="spinner-buttons"><button class="spinner-up"><i></i></button>' +
                    '<button class="spinner-down"><i></i></button></div></div></div>')}</body>`);
            for (const cls of ['vo-win--unprotect', 'vo-win--hf']) {
                const got = await page.evaluate(cls => {
                    const w = document.querySelector('.' + cls), wr = w.getBoundingClientRect();
                    const body = w.querySelector('.body'), pad = parseFloat(getComputedStyle(body).paddingRight);
                    const edge = wr.right - pad;
                    const out = Array.from(w.querySelectorAll('.content-panel, .content-panel *'))
                        .filter(e => e.getClientRects().length && e.getBoundingClientRect().right > edge + 0.5)
                        .map(e => e.tagName.toLowerCase() + '.' + (String(e.className).split(' ')[0] || '') + ' +' +
                            Math.round(e.getBoundingClientRect().right - edge));
                    return {width: wr.width, pad, out,
                        panel: w.querySelector('.content-panel').getBoundingClientRect().width === w.querySelector('.box').getBoundingClientRect().width};
                }, cls);
                assert.equal(got.width, 420, cls + ': the window is as wide as it was asked');
                assert.equal(got.pad, 24, cls + ': the body keeps its side padding');
                assert.deepEqual(got.out, [], cls + ': nothing goes beyond the body padding');
                assert.equal(got.panel, true, cls + ': the content panel follows the window body');
            }
            await page.close();
        });
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
