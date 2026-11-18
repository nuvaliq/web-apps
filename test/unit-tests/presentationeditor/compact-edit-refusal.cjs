/* Run: node test/unit-tests/presentationeditor/compact-edit-refusal.cjs [--only <name>]
 * A reader's Edit command in the compact shell: one open request to the host, the waiting
 * indicator and the shared text after five seconds of silence in the message area of the menu bar, and a host
 * refusal that answers the request and does not break the viewing session. The request and the reply are methods of
 * controller/Main.js (the acceptance/mode-harness.cjs world takes them from the source), the item and the message
 * area are the real SlideActions and the shared menu bar. The test runs the world timers itself.
 */
'use strict';

const assert = require('node:assert/strict');
const h = require('./acceptance/mode-harness.cjs');

const WAIT = h.ruText('PE.Controllers.LeftMenu.requestEditRightsText');
const GENERAL = h.ruText('PE.Controllers.Main.textEditRequestFailed');
/* The string the host currently replies with when editing is refused by the editing limit. */
const HOST = 'Сейчас перейти к редактированию нельзя';

function reader() {
    const w = h.createWorld({edit: false, requestEdit: true});
    h.boot(w);
    return w;
}
const actions = w => w.modules.SlideActions;
function editItem(w) {
    const it = actions(w).groups()[0].items.find(x => x && x.k === 'requestEdit');
    assert.ok(it, 'no «Edit» item in File for a reader who can ask for editing');
    return it;
}
function chooseFile(w) { return actions(w).exec(editItem(w), w.shell); }
function chooseHeader(w) {
    const button = w.doc.querySelector('.vo-hd-right > button.vo-mode');
    assert.ok(button, 'no Edit button in the compact header');
    const accepted = button.getAttribute('aria-disabled') === 'false';
    button.click();
    return accepted;
}
function state(w) { return actions(w).itemState(editItem(w)); }
function status(w) {
    const menu = actions(w).menu;
    const el = menu && typeof menu.status === 'function' ? menu.status() : null;
    assert.ok(el, 'no status place in the menu bar');
    return el;
}
const requests = (w, m) => h.since(w, m).calls.filter(c => c.target === 'Gateway' && c.name === 'requestEditRights').length;
const disconnects = (w, m) => h.since(w, m).api.filter(c => c.name === 'asc_coAuthoringDisconnect').length;
const notices = (w, m, name) => h.since(w, m).notices.filter(n => n.name === name).length;
function waitTimer(w) { return w.timers.find(t => t.ms === 5000 && !t.cancelled) || null; }
/* Five seconds of host silence: the waiting timer fires. */
function silence(w) {
    const t = waitTimer(w);
    assert.ok(t, 'no five second wait');
    t.cancelled = true;
    t.f.apply(null, t.a);
}
function refuse(w, message) {
    w.controllers.Main.onProcessRightsChange({enabled: false, message});
}

function cases(choose) { return [
    {name: 'one_request_with_the_wait_indicator', fn() {
        const w = reader();
        const m = h.mark(w);
        assert.equal(choose(w), true, 'the item does not run');
        assert.equal(requests(w, m), 1, 'one request to the host');
        assert.equal(h.since(w, m).calls.filter(c => c.name === 'clickMenuFileItem').length, 0, 'the stock File handler runs too');
        assert.equal(h.since(w, m).calls.filter(c => c.name === 'setStatusCaption').length, 0, 'the stock status bar caption is set');
        assert.equal(status(w).textContent, WAIT, 'the wait indicator');
        assert.deepEqual([state(w).disabled, state(w).reason], [true, null], 'the item waits without a reason');
        const timer = waitTimer(w);
        assert.ok(timer, 'no five second wait');
        assert.equal(choose(w), false, 'a second choice runs while waiting');
        assert.equal(waitTimer(w), timer, 'a disabled entry restarts the wait');
        assert.equal(requests(w, m), 1, 'a second request');
    }},

    {name: 'silent_host_gets_the_general_text_and_the_item_back', fn() {
        const w = reader();
        const m = h.mark(w);
        choose(w);
        silence(w);
        assert.equal(status(w).textContent, GENERAL, 'the general text after five seconds');
        assert.equal(state(w).disabled, false, 'the item is back');
        /* The request stays open for a late reply: a new choice shows the indicator again, but there is no second request. */
        assert.equal(choose(w), true, 'the item does not run again');
        assert.equal(requests(w, m), 1, 'a second request while the first is open');
        assert.equal(status(w).textContent, WAIT, 'the indicator is back');
        assert.ok(waitTimer(w), 'the wait restarts');
    }},

    {name: 'refusal_answers_the_request_and_keeps_the_session', fn() {
        const w = reader();
        choose(w);
        const m = h.mark(w);
        refuse(w, HOST);
        assert.equal(disconnects(w, m), 0, 'the refusal closes the co-editing session');
        assert.equal(notices(w, m, 'api:disconnect'), 0, 'api:disconnect after the refusal');
        assert.equal(notices(w, m, 'collaboration:sharingdeny'), 0, 'collaboration:sharingdeny after the refusal');
        assert.equal(status(w).textContent, HOST, 'the host text');
        assert.equal(waitTimer(w), null, 'the wait goes on after the answer');
        assert.equal(state(w).disabled, false, 'the item is grey after the answer');
        /* After the reply the request is closed: the next choice is a new request. */
        const again = h.mark(w);
        choose(w);
        assert.equal(requests(w, again), 1, 'no new request after the answer');
    }},

    {name: 'refusal_without_text_shows_the_general_text', fn() {
        const w = reader();
        choose(w);
        refuse(w, '');
        assert.equal(status(w).textContent, GENERAL);
    }},

    {name: 'host_text_stays_text', fn() {
        const w = reader();
        choose(w);
        const text = '<b>Нельзя</b> & <img src=x onerror=alert(1)>';
        refuse(w, text);
        assert.equal(status(w).textContent, text, 'the host text is changed');
        assert.equal(status(w).children.length, 0, 'the host text became markup');
    }},

    {name: 'leaving_for_editing_drops_the_wait', fn() {
        const w = reader();
        choose(w);
        for (const l of w.winTarget._ls.filter(x => x.type === 'beforeunload')) l.fn({type: 'beforeunload'});
        assert.equal(status(w).textContent, '', 'the indicator stays while the page leaves');
        assert.equal(waitTimer(w), null, 'the general text would follow the page that leaves');
    }}
]; }

h.run([
    ...cases(chooseFile),
    ...cases(chooseHeader).map(test => ({...test, name: 'header_' + test.name})),
    {name: 'refusal_without_a_request_disconnects_as_the_stock_does', fn() {
        const w = reader();
        const m = h.mark(w);
        refuse(w, '');
        assert.equal(disconnects(w, m), 1, 'the stock refusal keeps the session');
        assert.equal(notices(w, m, 'api:disconnect'), 1, 'no api:disconnect');
        assert.equal(status(w).textContent, '', 'a status without a request');
    }}
]);
