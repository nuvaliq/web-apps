/* Browser page with the shared compact menu bar over an editor adapter.
 * Headless Chrome through Playwright (NODE_PATH or PLAYWRIGHT_MODULE points to the package).
 * The page has no jQuery, underscore or editor namespaces: MenuModel.js and MenuBar.js are
 * loaded as they are, with a small define() that hands over the shared modules by name.
 * The editor module (lib/editors.cjs, field adapter) is loaded into the page as well and
 * gives context(overrides) and adapter(ctx, Model). An editor whose catalog and adapter are
 * modules of the application gives install(window) — its stand-ins for the stock editor — and
 * scripts, the modules loaded after it.
 * In the page: window.ctx — the editor state, window.adapter, window.menu — the menu bar,
 * #field — a text field outside the menu, #next — the next focus stop after the menu bar.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../..');
const MODEL = path.join(ROOT, 'apps/common/main/lib/view/compact/MenuModel.js');
const BAR = path.join(ROOT, 'apps/common/main/lib/view/compact/MenuBar.js');

/* Layout the bar needs to be measured: one row, absolute lists, labels on one line and
   sections that do not shrink (the shared menu.less gives them; the bar sets no layout
   inline). The real look comes from the editor styles. */
const CSS = `
body {margin: 0; font: 13px sans-serif}
#host {margin: 10px 0 0 10px}
.vo-mn {position: relative; display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px; box-sizing: border-box}
.vo-mn-wrap {position: relative; flex: 0 0 auto}
.vo-mn-item {height: 20px; padding: 0 8px; border: 0; background: none; font: inherit; white-space: nowrap}
.vo-mn-drop {display: none; position: absolute; top: calc(100% + 5px); left: -4px; min-width: 200px; background: #fff;
    border: 1px solid #ccc; z-index: 5}
.vo-mn-drop.open {display: block}
.vo-mn-sub, .vo-mn-grp-t {display: flex; box-sizing: border-box; width: 100%; height: 28px; align-items: center; border: 0;
    background: none; font: inherit; text-align: left; white-space: nowrap}
.vo-mn-i {display: inline-block; width: 16px}
.vo-mn-t {flex: 1 1 auto}
.vo-mn-tc {display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0}
.vo-mn-sub.vo-has-desc {height: auto; min-height: 28px}
.vo-mn-d {width: 0; min-width: 100%; white-space: normal}
.vo-mn-h, .vo-mn-chk, .vo-mn-arrow {margin-left: 12px}
.vo-mn-sep {height: 1px; background: #ccc}
.vo-mn-status {flex: 0 0 auto; white-space: nowrap}
`;

function playwright() {
    return require(process.env.PLAYWRIGHT_MODULE || 'playwright');
}

/* Editors of lib/editors.cjs that describe their menu for the shared layer. */
function editorsWithAdapter() {
    return require('./editors.cjs').filter(e => e.adapter);
}

async function launch() {
    return playwright().chromium.launch({channel: 'chrome', headless: true});
}

/* A new page with the menu bar of the editor.
 *  - width    — width of the menu bar host;
 *  - context  — editor state overrides;
 *  - options  — create() options that survive JSON (pinned, mac); pinned defaults to the editor's;
 *  - bar      — path to MenuBar.js (a broken copy for a negative control).
 */
async function openMenu(browser, editor, {width = 900, context = {}, options = {}, bar = BAR} = {}) {
    const page = await browser.newPage({viewport: {width: 1000, height: 700}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'warning' && /Compact menu/.test(msg.text())) errors.push(msg.text()); });
    await page.setContent(`<style>${CSS}</style>
        <input id="field" value="draft text">
        <div id="host" style="width:${width}px"></div>
        <div style="margin-top:300px"><button id="next">next</button></div>`);
    await page.addScriptTag({content: `window.define = function (deps, factory) {
        var shared = function () { return (window.Common && Common.UI && Common.UI.Compact) || {}; };
        return factory.apply(null, deps.map(function (d) { return shared()[d.split('/').pop()]; }));
    };`});
    await page.addScriptTag({content: fs.readFileSync(MODEL, 'utf8')});
    await page.addScriptTag({content: fs.readFileSync(bar, 'utf8')});
    const source = fs.readFileSync(editor.adapter, 'utf8');
    await page.addScriptTag({content: `(function (module) {\n${source}\n;window.editorModule = module.exports;})({exports: {}});`});
    const own = require(editor.adapter);
    if (own.install) await page.evaluate(() => editorModule.install(window));
    for (const file of own.scripts || [])
        await page.addScriptTag({content: fs.readFileSync(path.join(ROOT, file), 'utf8')});
    const opts = Object.assign({pinned: own.pinned}, options);
    await page.evaluate(({context, opts}) => {
        window.ctx = editorModule.context(context);
        window.adapter = editorModule.adapter(ctx, Common.UI.Compact.MenuModel);
        window.menu = Common.UI.Compact.MenuBar.create(adapter, opts);
        document.getElementById('host').appendChild(menu.el);
    }, {context, opts});
    await settle(page);
    page.errors = errors;
    return page;
}

/* Two frames: the resize observer and a requested refresh have run. */
function settle(page) {
    return page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/* What the menu bar shows now, read from the page. */
function readBar(page) {
    return page.evaluate(() => {
        const shown = el => !!el && el.getClientRects().length > 0;
        const bar = menu.el;
        const tops = Array.from(bar.querySelectorAll(':scope > .vo-mn-wrap > .vo-mn-item')).filter(shown);
        const label = el => el.getAttribute('data-k') || (el.closest('.vo-mn-more') ? 'more' : '');
        const open = Array.from(bar.querySelectorAll('.vo-mn-drop.open')).filter(shown);
        const active = document.activeElement;
        return {
            tops: tops.map(label),
            open: open.map(d => ({
                label: d.getAttribute('aria-label'),
                level: d.getAttribute('data-level'),
                inMore: !!d.closest('.vo-mn-more'),
                rows: Array.from(d.querySelectorAll(':scope > .vo-mn-sub, :scope > .vo-mn-grp > .vo-mn-sub'))
                    .map(r => r.getAttribute('data-k'))
            })),
            active: active && bar.contains(active) ? (active.getAttribute('data-k') || label(active)) :
                (active && active.id) || null,
            isOpen: menu.isOpen()
        };
    });
}

/* Attributes of a row or top button by data-k. */
function rowInfo(page, k) {
    return page.evaluate(k => {
        const row = menu.el.querySelector(`[data-k="${k}"]:not(.vo-mn-more-row)`);
        if (!row) return null;
        const attrs = {};
        for (const a of row.attributes) attrs[a.name] = a.value;
        return {attrs, locked: row.classList.contains('vo-locked'), shown: row.getClientRects().length > 0,
                text: row.textContent, check: !!row.querySelector('.vo-mn-chk')};
    }, k);
}

/* Check list of one test file; failures are counted, the file exits non-zero on any.
   skip(name, why) names a check an editor has no rows for yet; skips do not count as passes. */
function checker() {
    let passed = 0, failed = 0, skipped = 0;
    return {
        async check(name, fn) {
            try {
                await fn();
                console.log('PASS', name);
                passed++;
            } catch (error) {
                console.error('FAIL', name, error.message);
                failed++;
            }
        },
        skip(name, why) {
            console.log('SKIP', name, '—', why);
            skipped++;
        },
        done() {
            console.log(`${passed} passed, ${failed} failed` + (skipped ? `, ${skipped} skipped` : ''));
            process.exitCode = failed || !passed ? 1 : 0;
        }
    };
}

/* Applies a state change of the editor in the page: fields of the editor context. */
function patch(page, change) {
    return page.evaluate(change => { Object.assign(ctx, change); }, change || {});
}

/* Focuses a row of an open list by its key. */
function focusRow(page, k) {
    return page.evaluate(k => { menu.el.querySelector(`[data-k="${k}"]:not(.vo-mn-more-row)`).focus(); }, k);
}

module.exports = {ROOT, MODEL, BAR, launch, openMenu, settle, readBar, rowInfo, editorsWithAdapter, checker, patch, focusRow};
