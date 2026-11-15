'use strict';
const assert = require('node:assert/strict'), {test} = require('node:test'), vm = require('node:vm');
const fs = require('node:fs'), path = require('node:path');
const {page, read, main} = require('./reporter-harness.cjs');

test('readiness loop repeats and can stop during send without scheduling again', () => {
    let repeat;
    vm.runInNewContext(read('reporter-ready.js'), {define: fn => repeat = fn(), setTimeout, clearTimeout});
    const pending = new Map(); let id = 0, sends = 0, loop;
    const options = {firstDelay: 0, interval: 500, schedule: (fn, delay) => {pending.set(++id,{fn,delay});return id;}, cancel: id => pending.delete(id),
        send: () => {sends++; if (sends === 2) loop.stop();}};
    loop = repeat(options);
    assert.equal(pending.get(1).delay, 0); const first = pending.get(1); pending.delete(1); first.fn();
    assert.equal(sends,1); assert.equal(pending.get(2).delay,500);
    const second = pending.get(2); pending.delete(2); second.fn(); assert.equal(sends,2); assert.equal(pending.size,0);
    loop.stop();
    loop = repeat(options); loop.stop(); assert.equal(pending.size,0);
});

for (const [file, first] of [['app.reporter.js',500], ['app_dev.reporter.js',0]]) {
    test(file + ' repeats until the first trusted valid metadata and stops on pagehide', () => {
        const p = page(file);
        assert.equal(p.tick(), first); assert.equal(p.calls.filter(c => c[0] === 'sendFromReporter').length,1);
        p.metadata(undefined, {}, p.window.location.origin);
        p.metadata(undefined, p.opener, 'https://portal.test');
        p.metadata({key:'',tokenType:'open'}); p.metadata({key:'key',tokenType:'invalid'});
        assert.equal(p.calls.filter(c => c[0] === 'permissions').length,0);
        assert.equal(p.tick(),first + 500);
        p.metadata(); p.metadata(); assert.equal(p.calls.filter(c => c[0] === 'permissions').length,1);
        assert.equal(p.timers.size,0);
        const second = page(file); second.emit('pagehide'); assert.equal(second.timers.size,0);
    });
    test(file + ' loading cancellation is visible text and stops readiness before ending', () => {
        const p = page(file, false, '<img src=x onerror=alert(1)>');
        const button = p.nodes.get('reporter_loading_end'); assert.ok(button);
        assert.equal(button.textContent, '<img src=x onerror=alert(1)>'); assert.equal(button.innerHTML, undefined);
        assert.equal(String(button.style.zIndex), '10001'); assert.equal(button.style.position,'fixed');
        assert.ok(button.className.includes('btn-text-default'));
        p.api.EndDemonstration = () => {assert.equal(p.timers.size,0); p.calls.push(['cancelled']);};
        button.click(); button.click(); p.metadata(); p.callbacks.asc_onDocumentContentReady();
        assert.equal(p.calls.filter(c => c[0] === 'cancelled').length,1);
        assert.equal(p.calls.filter(c => c[0] === 'permissions').length,0);
        assert.equal(p.calls.filter(c => c[0] === 'maskRemoved').length,0);
    });
    test(file + ' removes the temporary end button only after normal document readiness', () => {
        const p = page(file); assert.ok(p.nodes.get('reporter_loading_end').textContent);
        p.metadata(); p.callbacks.asc_onDocumentContentReady();
        assert.equal(p.nodes.has('reporter_loading_end'),false); assert.ok(p.calls.some(c => c[0] === 'maskRemoved'));
    });
}

test('reporter packaging preserves the HTML entry and copies the AMD module', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(main,'../../../build/presentationeditor.json'),'utf8'));
    const copy = config.main.reporter.copy;
    assert.match(Object.keys(copy)[0], /index.reporter.html$/);
    assert.ok(Object.keys(copy).some(key => /reporter-ready.js$/.test(key)));
});
