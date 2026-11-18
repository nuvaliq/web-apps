/* Run: node test/unit-tests/documenteditor/compact-edit-refusal.cjs
 * "Edit document" of the compact menu in a view session: one open request to the host, the wait indicator
 * and the general text after five silent seconds in the status place of the menu bar, and a refusal that
 * answers the request without closing the co-editing session.
 * The request and the answer are the methods of controller/Main.js, cut out of the source and run in vm
 * over a stand-in controller (Main.js does not load in vm). The catalog and the adapter are the real ones
 * over the stand-ins of common/compact/lib/documents-editor.cjs; the listener that carries the request
 * state to the menu bar is the one of CompactShell.js, loaded as it is. Timers are the test's own clock.
 * The last check opens the real menu bar in headless Chrome through Playwright (NODE_PATH or
 * PLAYWRIGHT_MODULE) and looks at the status place after the menu closes and on a narrow bar.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const MAIN = path.join(ROOT, 'apps/documenteditor/main/app/controller/Main.js');
const SHELL = path.join(ROOT, 'apps/documenteditor/main/app/view/CompactShell.js');
const docs = require('../common/compact/lib/documents-editor.cjs');
const page = require('../common/compact/lib/menu-bar-page.cjs');

const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/documenteditor/main/locale/en.json'), 'utf8'));
const RU = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/documenteditor/main/locale/ru.json'), 'utf8'));
const GENERAL = EN['DE.Controllers.Main.textEditRequestFailed'];
const WAIT = EN['DE.Controllers.LeftMenu.requestEditRightsText'];
const DENIED = EN['DE.Controllers.Main.warnProcessRightsChange'];
/* The two lines the host sends today: a refusal by the editing limit and every other outcome. */
const HOST_LIMIT = 'Сейчас перейти к редактированию нельзя';
const HOST_RIGHTS = 'Недостаточно прав, чтобы редактировать документ. Возможно, права доступа изменились';

let passed = 0, failed = 0;
const pending = [];
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* ---- Methods of Main.js ------------------------------------------------------------------------------- */

const MAIN_METHODS = ['onProcessRightsChange', 'markEditRequest', 'isEditRequestWaiting', 'answerEditRequest',
    'cancelEditRequestWait', 'editRequestStatus'];

/* `name: function (params) { … }` of the controller, from the name to the bracket that closes the body.
 * Strings and comments are skipped, so braces in them do not count. */
function cutMethod(text, name) {
    const m = new RegExp('\\b' + name + ':\\s*function\\s*\\(([^)]*)\\)\\s*\\{').exec(text);
    assert.ok(m, 'Main.js has ' + name);
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
        const c = text[i];
        if (c === '\'' || c === '"' || c === '`') {
            for (i++; i < text.length && text[i] !== c; i++)
                if (text[i] === '\\') i++;
        } else if (c === '/' && text[i + 1] === '/') {
            i = text.indexOf('\n', i);
        } else if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2) + 1;
        } else if (c === '{') {
            depth++;
        } else if (c === '}' && --depth === 0) {
            return name + ': function (' + m[1] + ') ' + text.slice(m.index + m[0].length - 1, i + 1);
        }
    }
    assert.fail(name + ' is not closed');
}
const MAIN_SOURCE = (() => {
    const text = fs.readFileSync(MAIN, 'utf8');
    return '({\n' + MAIN_METHODS.map(name => cutMethod(text, name)).join(',\n') + '\n})';
})();

/* ---- The editor ---------------------------------------------------------------------------------------- */

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;

/* The test's clock: timers run when the test moves the time. */
const clock = {
    now: 0, seq: 0, timers: [],
    set(fn, ms) { const id = ++this.seq; this.timers.push({id, at: this.now + (ms || 0), ms, fn}); return id; },
    clear(id) { this.timers = this.timers.filter(t => t.id !== id); },
    advance(ms) {
        const end = this.now + ms;
        for (;;) {
            const due = this.timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
            if (!due) break;
            this.timers = this.timers.filter(t => t !== due);
            this.now = due.at;
            due.fn();
        }
        this.now = end;
    },
    reset() { this.now = 0; this.timers = []; }
};
G.setTimeout = (fn, ms) => clock.set(fn, ms);
G.clearTimeout = id => clock.clear(id);

/* What the stock parts around the request record. */
let world = null;
G._.isEmpty = value => value === undefined || value === null || value === '' ||
    (typeof value === 'object' && Object.keys(value).length === 0) || typeof value === 'number';
G.Common.Gateway = {requestEditRights: () => world.sent++};
G.Common.UI.TooltipManager = {showTip: options => world.tips.push(options.text)};
G.Common.Utils.String = {htmlEncode: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')};
G.Common.Utils.isMac = false;
G.addEventListener = (type, fn) => { (world.listeners[type] = world.listeners[type] || []).push(fn); };

/* The listener of the shell: loaded as it is and bound once, over a shell that refreshes the open menu. */
G.$ = () => new Proxy({length: 0}, {get: (t, k) => (k in t ? t[k] : () => t)});
G.document = G.document || {body: {classList: {add() {}, remove() {}, contains: () => false, toggle() {}}},
    getElementById: () => null};
vm.runInContext(fs.readFileSync(SHELL, 'utf8'), G, {filename: SHELL});
G.DE.Views.CompactShell.bindMenuRefresh.call({api: null, bindHeaderDisconnect() {}, refreshMenuLocks: () => world.refreshes++});

/* A view session of a user with the edit right whose host takes edit requests. Main is the stand-in of
 * the catalog tests with the request methods of Main.js on it. */
function session() {
    clock.reset();
    actions.showRequestStatus('');
    const ctx = docs.context({editMode: false, editRight: true, requestEdit: true, reasons: ['view']});
    world = {ctx, sent: 0, tips: [], listeners: {}, refreshes: 0, disconnects: 0, status: {textContent: ''}};
    const main = ctx.main;
    Object.assign(main, vm.runInContext(MAIN_SOURCE, G, {filename: MAIN}), {
        warnProcessRightsChange: DENIED,
        textEditRequestFailed: GENERAL,
        getApplication: () => ({getController: name => (name === 'LeftMenu' ? {requestEditRightsText: WAIT} : null)})
    });
    main._state.lostEditingRights = false;
    main.api = {asc_coAuthoringDisconnect: () => world.disconnects++};
    ctx.shell.menu = {status: () => world.status};
    world.main = main;
    world.adapter = docs.adapter(ctx);
    return world;
}

const item = () => actions.command('file.edit');
const itemState = w => Model.state(item(), w.ctx);
const choose = w => w.adapter.exec(item());
const status = w => w.status.textContent;
const events = (w, name) => w.ctx.log.filter(e => e.event === name).map(e => e.args);
const refuse = (w, message) => w.main.onProcessRightsChange(message === undefined ? {enabled: false} : {enabled: false, message});
/* The session is the same: nothing closed co-editing, nothing marked the rights as lost. */
function sessionKept(w) {
    assert.equal(w.disconnects, 0, 'co-editing is not disconnected');
    assert.deepEqual(events(w, 'api:disconnect'), [], 'no disconnect notification');
    assert.deepEqual(events(w, 'collaboration:sharingdeny'), [], 'no sharing deny notification');
    assert.equal(w.main._state.lostEditingRights, false, 'the rights are not marked as lost');
    assert.deepEqual(w.tips, [], 'no stock tip over the toolbar');
}

function headerSession() {
    const w = session(), shell = G.DE.Views.CompactShell;
    w.ctx.reasons = [];
    w.main.editorConfig = {ui: {shell: 'modern'}};
    w.main.document = {fileType: 'docx'};
    G.document.body.classList.contains = name => name === 'vo-compact';
    G.document.querySelectorAll = () => [];
    shell.advanced = false;
    shell.startupFailed = false;
    shell.menuAdapter = w.adapter;
    shell.closeSurfaces = () => {};
    shell.$editRequest = {toggleClass() { return this; }, attr(name, value) { w.aria = value; return this; }};
    w.header = () => shell.runEditRequest();
    shell.applyEditButtonLock();
    return w;
}

check('header_and_file_share_open_request', () => {
    for (const headerFirst of [true, false]) {
        const w = headerSession();
        assert.equal(headerFirst ? w.header() : choose(w), true);
        assert.equal(headerFirst ? choose(w) : w.header(), false);
        assert.equal(w.sent, 1);
        G.DE.Views.CompactShell.applyEditButtonLock();
        assert.equal(w.aria, 'true');
        clock.advance(5000);
        assert.equal(status(w), GENERAL);
        assert.equal(w.header(), true);
        assert.equal(w.sent, 1);
        refuse(w, HOST_LIMIT);
        sessionKept(w);
        assert.equal(w.header(), true);
        assert.equal(w.sent, 2);
    }
});

check('header_request_rechecks_current_locks_and_owner', () => {
    const shell = G.DE.Views.CompactShell;
    for (const reason of ['reconnect', 'refresh-file', 'disconnect', 'not-loaded', 'history']) {
        const w = headerSession();
        w.ctx.stack = [{disable: true, type: reason}, {disable: true, type: 'view'}];
        assert.equal(w.header(), false, reason);
        assert.equal(w.sent, 0);
        assert.equal(w.aria, 'true');
        w.ctx.stack = [];
        assert.equal(w.header(), true);
    }
    for (const key of ['markEditRequest', 'isEditRequestWaiting']) {
        const w = headerSession();
        delete w.main[key];
        assert.equal(w.header(), false);
        assert.equal(w.sent, 0);
    }
    for (const flag of ['advanced', 'startupFailed']) {
        const w = headerSession();
        shell[flag] = true;
        assert.equal(w.header(), false);
        assert.equal(w.sent, 0);
    }
    const w = headerSession();
    w.ctx.editRight = false;
    assert.equal(w.header(), false);
    assert.equal(w.sent, 0);
});

check('reader_sdk_disconnect_updates_button_without_mode_switch', () => {
    const w = headerSession(), shell = G.DE.Views.CompactShell;
    shell.api = w.ctx.api;
    shell.bindHeaderDisconnect();
    shell.bindHeaderDisconnect();
    assert.equal(w.ctx.callbacks.asc_onCoAuthoringDisconnect.length, 1);
    assert.equal(w.aria, 'false');
    w.ctx.fire('asc_onCoAuthoringDisconnect');
    w.ctx.disconnected = true;
    clock.advance(0);
    assert.equal(w.aria, 'true');
    assert.equal(w.header(), false);
    assert.equal(w.sent, 0);
    w.ctx.disconnected = false;
    shell.applyEditButtonLock();
    assert.equal(w.aria, 'false');
});

check('fallback_lock_keeps_external_reason_separate_from_view_right', () => {
    const w = headerSession(), shell = G.DE.Views.CompactShell;
    delete w.main.stackDisableActions;
    shell.syncHeaderHint = () => {};
    shell.applyEditingLock({disable: true, type: 'history'});
    assert.equal(w.header(), false);
    assert.equal(w.sent, 0);
    shell.applyEditingLock();
    assert.equal(w.header(), false, 'an unrelated protection refresh must preserve the external lock');
    assert.equal(w.sent, 0);
    shell.applyEditingLock({disable: true, type: 'view'});
    assert.equal(w.header(), true);
    refuse(w, HOST_LIMIT);
    shell.applyEditingLock({disable: false, type: 'history'});
    assert.equal(w.header(), true);
});

check('fallback_unlock_drops_released_surface_restrictions', () => {
    const w = headerSession(), shell = G.DE.Views.CompactShell;
    delete w.main.stackDisableActions;
    w.ctx.editMode = true;
    shell.applyEditingLock({disable: true, options: {navigation: {disable: true}}, type: 'history'});
    shell.applyEditingLock({disable: false, options: {navigation: {disable: true}}, type: 'history'});
    const state = shell.lockState();
    assert.equal(!!(state.options.navigation && state.options.navigation.disable), false);
});

check('header_request_keeps_view_on_refusal_and_unload', () => {
    for (const text of [HOST_LIMIT, '', '<img src=x onerror=alert(1)>', undefined]) {
        const w = headerSession();
        w.header();
        clock.advance(5000);
        refuse(w, text);
        sessionKept(w);
        assert.equal(status(w), text || GENERAL);
        assert.deepEqual(clock.timers, []);
    }
    const w = headerSession();
    w.header();
    w.listeners.beforeunload.forEach(fn => fn());
    assert.deepEqual(clock.timers, []);
});

/* ---- Checks -------------------------------------------------------------------------------------------- */

check('the locale has the general text in ru and en', () => {
    assert.equal(GENERAL, 'Couldn\'t open the document for editing. Try again');
    assert.equal(RU['DE.Controllers.Main.textEditRequestFailed'], 'Не удалось открыть документ для редактирования. Попробуйте ещё раз');
    assert.ok(WAIT, 'the stock wait text is there');
});

check('menu request shows the wait indicator at once', () => {
    const w = session();
    assert.equal(itemState(w).disabled, false, 'the item is offered');
    assert.equal(choose(w), true, 'the item runs');
    assert.equal(w.sent, 1, 'one request to the host');
    assert.equal(status(w), WAIT, 'the indicator is in the status place right away');
    assert.deepEqual(events(w, 'editrequest:status'), [[WAIT]]);
});

check('item is greyed without a reason during the first five seconds', () => {
    const w = session();
    choose(w);
    const refreshes = w.refreshes;
    assert.ok(refreshes > 0, 'the open menu rereads the item when the indicator shows');
    assert.deepEqual([itemState(w).disabled, itemState(w).reason], [true, null], 'greyed, no reason');
    clock.advance(4999);
    assert.deepEqual([itemState(w).disabled, itemState(w).reason], [true, null], 'still greyed at 4.999 s');
    assert.equal(choose(w), false, 'a greyed item does not run');
    assert.equal(w.sent, 1);
    clock.advance(1);
    assert.equal(itemState(w).disabled, false, 'available again at 5 s');
    assert.ok(w.refreshes > refreshes, 'the open menu rereads the item when the indicator goes');
    /* The lost connection is still the reason over the wait. */
    const off = session();
    choose(off);
    off.ctx.reasons = ['offline'];
    assert.deepEqual([itemState(off).disabled, itemState(off).reason], [true, 'offline']);
});

check('refusal after a menu request keeps co-editing connected', () => {
    const w = session();
    choose(w);
    clock.advance(1200);
    refuse(w, HOST_LIMIT);
    sessionKept(w);
    assert.equal(w.sent, 1);
});

check('refusal shows the host text as is', () => {
    for (const text of [HOST_LIMIT, HOST_RIGHTS, '<b>Нет</b> & "доступа"', '&amp; 5 < 6']) {
        const w = session();
        choose(w);
        refuse(w, text);
        assert.equal(status(w), text, 'the host text, not encoded and not parsed: ' + text);
        assert.equal(w.main.isEditRequestWaiting(), false, 'the indicator is gone');
        sessionKept(w);
    }
});

check('empty host message shows the general text', () => {
    for (const data of [{enabled: false}, {enabled: false, message: ''}, {enabled: false, message: null}]) {
        const w = session();
        choose(w);
        w.main.onProcessRightsChange(data);
        assert.equal(status(w), GENERAL, JSON.stringify(data));
        sessionKept(w);
    }
});

check('silence for five seconds shows the general text and hides the indicator no earlier than five and no later than six seconds', () => {
    const w = session();
    choose(w);
    const timers = clock.timers.map(t => t.ms);
    assert.deepEqual(timers, [5000], 'one timer of five seconds');
    clock.advance(4999);
    assert.equal(status(w), WAIT, 'the indicator at 4.999 s');
    assert.equal(w.main.isEditRequestWaiting(), true);
    clock.advance(1);
    assert.equal(status(w), GENERAL, 'the general text at 5 s');
    assert.equal(w.main.isEditRequestWaiting(), false, 'the indicator is hidden');
    clock.advance(1000);
    assert.equal(status(w), GENERAL, 'still the general text at 6 s');
    assert.equal(itemState(w).disabled, false, 'the item is available');
    assert.equal(w.main.editRequest.open, true, 'the request waits for the answer');
    sessionKept(w);
});

check('refusal after the timeout keeps the session and shows the host text', () => {
    const w = session();
    choose(w);
    clock.advance(30000);
    assert.equal(status(w), GENERAL);
    refuse(w, HOST_RIGHTS);
    assert.equal(status(w), HOST_RIGHTS);
    assert.equal(w.main.editRequest.open, false, 'the request is answered');
    sessionKept(w);
});

check('repeat while a request is open sends no new request, shows the indicator again and restarts the timer', () => {
    const w = session();
    choose(w);
    clock.advance(5000);
    assert.equal(status(w), GENERAL);
    assert.equal(choose(w), true, 'the item runs again after the timeout');
    assert.equal(w.sent, 1, 'no second request');
    assert.equal(status(w), WAIT, 'the indicator again');
    assert.deepEqual(clock.timers.map(t => t.ms), [5000], 'one timer');
    clock.advance(4999);
    assert.equal(status(w), WAIT, 'the indicator 4.999 s after the repeat');
    clock.advance(1);
    assert.equal(status(w), GENERAL, 'the general text 5 s after the repeat');
    /* A repeat inside the first five seconds restarts the same timer as well. */
    const early = session();
    choose(early);
    clock.advance(3000);
    early.main.markEditRequest();
    assert.equal(early.sent, 1);
    assert.equal(clock.timers.length, 1, 'still one timer');
    clock.advance(4999);
    assert.equal(status(early), WAIT, 'the indicator 7.999 s after the first choice');
    clock.advance(1);
    assert.equal(status(early), GENERAL);
    /* The answer to the repeated request is the answer to the first one. */
    refuse(early, HOST_LIMIT);
    assert.equal(status(early), HOST_LIMIT);
    sessionKept(early);
});

check('choice after an answer sends a new request', () => {
    const w = session();
    choose(w);
    refuse(w, HOST_LIMIT);
    assert.equal(choose(w), true);
    assert.equal(w.sent, 2, 'a new request');
    assert.equal(status(w), WAIT);
    assert.equal(w.main.editRequest.open, true);
    refuse(w, HOST_RIGHTS);
    assert.equal(status(w), HOST_RIGHTS);
    sessionKept(w);
});

check('refusal with an empty message shows the general text at once', () => {
    const w = session();
    choose(w);
    clock.advance(100);
    refuse(w, '');
    assert.equal(status(w), GENERAL, 'no wait for the timer');
    assert.equal(itemState(w).disabled, false);
    assert.deepEqual(clock.timers, [], 'the timer is stopped');
    const shown = events(w, 'editrequest:status').length;
    clock.advance(10000);
    assert.equal(events(w, 'editrequest:status').length, shown, 'nothing more is shown later');
    sessionKept(w);
});

check('refusal without a pending request keeps the stock disconnect', () => {
    const w = session();
    refuse(w, '<i>rights changed</i>');
    assert.equal(w.disconnects, 1, 'co-editing is disconnected');
    assert.equal(events(w, 'api:disconnect').length, 1);
    assert.equal(events(w, 'collaboration:sharingdeny').length, 1);
    assert.deepEqual(w.tips, ['&lt;i&gt;rights changed&lt;/i&gt;'], 'the stock tip with the encoded host text');
    assert.deepEqual(events(w, 'editrequest:status'), [], 'the status place is not used');
    /* After an answered request the next refusal comes without a request too. */
    const answered = session();
    choose(answered);
    refuse(answered, HOST_LIMIT);
    refuse(answered);
    assert.equal(answered.disconnects, 1);
    assert.deepEqual(answered.tips, [DENIED]);
});

check('item stays available after a refusal', () => {
    for (const message of [HOST_LIMIT, '']) {
        const w = session();
        choose(w);
        clock.advance(2000);
        refuse(w, message);
        assert.equal(itemState(w).visible, true, 'the item is still offered');
        assert.equal(itemState(w).disabled, false, 'and available');
        clock.advance(10000);
        assert.equal(itemState(w).disabled, false);
    }
});

check('page navigation cancels the wait', () => {
    const w = session();
    choose(w);
    assert.equal((w.listeners.beforeunload || []).length, 1, 'one listener of the page leaving');
    clock.advance(2000);
    w.listeners.beforeunload[0]();
    assert.equal(status(w), '', 'the indicator is hidden');
    assert.equal(w.main.isEditRequestWaiting(), false);
    assert.deepEqual(clock.timers, [], 'the timer is stopped');
    clock.advance(10000);
    assert.equal(status(w), '', 'no general text while the page goes');
    /* A page that stays after all still takes the answer to the open request. */
    assert.equal(w.main.editRequest.open, true);
    refuse(w, HOST_RIGHTS);
    assert.equal(status(w), HOST_RIGHTS);
    sessionKept(w);
    /* A second request adds no second listener. */
    choose(w);
    assert.equal(w.listeners.beforeunload.length, 1);
    /* Leaving without a wait shows nothing. */
    const idle = session();
    choose(idle);
    refuse(idle, HOST_LIMIT);
    idle.listeners.beforeunload[0]();
    assert.equal(status(idle), HOST_LIMIT, 'the answer stays');
});

check('paste hint lies over the request message for five seconds and gives it back', () => {
    const w = session();
    choose(w);
    clock.advance(5000);
    assert.equal(status(w), GENERAL);
    /* The paste hint of the menu, over the general text. */
    actions.pasteHint();
    assert.equal(status(w), 'Paste with Ctrl+V');
    clock.advance(5000);
    assert.equal(status(w), GENERAL, 'the request message is back');
    /* A new request message replaces the paste hint at once and is not wiped by its timer. */
    actions.pasteHint();
    refuse(w, HOST_LIMIT);
    assert.equal(status(w), HOST_LIMIT);
    clock.advance(5000);
    assert.equal(status(w), HOST_LIMIT, 'the old paste timer leaves the newer message');
    /* The indicator under the paste hint, then the general text on time. */
    const wait = session();
    choose(wait);
    clock.advance(1000);
    actions.pasteHint();
    clock.advance(4000);
    assert.equal(status(wait), GENERAL, 'the request timer shows the general text');
    clock.advance(5000);
    assert.equal(status(wait), GENERAL);
});

/* ---- The real menu bar --------------------------------------------------------------------------------- */

pending.push(async () => {
    const entry = require('../common/compact/lib/editors.cjs').find(e => e.name === 'documenteditor');
    const browser = await page.launch();
    try {
        const name = 'hint stays visible after the menu closes and when sections overflow';
        try {
            const p = await page.openMenu(browser, entry, {width: 900,
                context: {editMode: false, editRight: true, requestEdit: true, reasons: ['view']}});
            await p.addScriptTag({content: `window.__mainMethods = ${MAIN_SOURCE};`});
            await p.addScriptTag({content: `window.$ = function () { return {}; };`});
            await p.addScriptTag({content: fs.readFileSync(SHELL, 'utf8')});
            await p.evaluate(({wait, general}) => {
                window.sent = 0;
                window._.isEmpty = v => v === undefined || v === null || v === '';
                Common.Gateway = {requestEditRights: () => { window.sent++; }};
                Common.UI.TooltipManager = {showTip() { throw new Error('stock tip'); }};
                Object.assign(ctx.main, window.__mainMethods, {
                    textEditRequestFailed: general,
                    api: {asc_coAuthoringDisconnect() { throw new Error('disconnect'); }},
                    getApplication: () => ({getController: () => ({requestEditRightsText: wait})})
                });
                ctx.main._state.lostEditingRights = false;
                ctx.shell.menu = menu;
                DE.Views.CompactShell.bindMenuRefresh.call({api: null, bindHeaderDisconnect() {}, refreshMenuLocks() { menu.refresh(); }});
            }, {wait: WAIT, general: GENERAL});
            const place = () => p.evaluate(() => {
                const s = menu.status(), bar = menu.el.getBoundingClientRect(), r = s.getBoundingClientRect();
                return {text: s.textContent, shown: s.getClientRects().length > 0 && r.width > 0,
                    inList: !!s.closest('.vo-mn-drop, .vo-mn-more'), inBar: s.parentNode === menu.el,
                    inside: r.left >= bar.left - 0.5 && r.right <= bar.right + 0.5, live: s.getAttribute('aria-live'),
                    open: menu.isOpen()};
            });

            await p.click('[data-k="file"]');
            await p.click('[data-k="file.edit"]');
            await page.settle(p);
            assert.equal(await p.evaluate(() => window.sent), 1, 'one request');
            assert.deepEqual(await place(), {text: WAIT, shown: true, inList: false, inBar: true, inside: true,
                live: 'polite', open: false}, 'the indicator after the menu closed');
            /* The open menu shows the item greyed while the indicator is there. */
            await p.click('[data-k="file"]');
            assert.equal((await page.rowInfo(p, 'file.edit')).locked, true, 'greyed in the open menu');
            await p.evaluate(text => ctx.main.onProcessRightsChange({enabled: false, message: text}), HOST_RIGHTS);
            await page.settle(p);
            assert.equal((await page.rowInfo(p, 'file.edit')).locked, false, 'available again in the open menu');
            await p.keyboard.press('Escape');
            await page.settle(p);
            assert.deepEqual(await place(), {text: HOST_RIGHTS, shown: true, inList: false, inBar: true, inside: true,
                live: 'polite', open: false}, 'the hint after the menu closed');
            /* A narrow bar: sections leave for the more button, the hint stays in the bar. */
            for (const width of [900, 700]) {
                await p.evaluate(w => { document.getElementById('host').style.width = w + 'px'; }, width);
                await page.settle(p);
                const bar = await page.readBar(p);
                assert.ok(bar.tops.includes('more'), `sections overflow at ${width}px: ${bar.tops.join(',')}`);
                assert.deepEqual(await place(), {text: HOST_RIGHTS, shown: true, inList: false, inBar: true, inside: true,
                    live: 'polite', open: false}, `the hint on a ${width}px bar`);
                await p.click('.vo-mn-more > .vo-mn-item');
                assert.equal((await place()).text, HOST_RIGHTS, `the hint with the more list open at ${width}px`);
                await p.keyboard.press('Escape');
                await page.settle(p);
                assert.deepEqual(await place(), {text: HOST_RIGHTS, shown: true, inList: false, inBar: true, inside: true,
                    live: 'polite', open: false}, `the hint after the more list closed at ${width}px`);
            }
            assert.deepEqual(p.errors, [], 'no page errors');
            await p.close();
            console.log('PASS', name);
            passed++;
        } catch (error) {
            console.error('FAIL', name, error.message);
            failed++;
        }
    } finally {
        await browser.close();
    }
});

(async () => {
    for (const run of pending) await run();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
