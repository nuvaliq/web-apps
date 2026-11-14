// Run with node; an optional argument selects a baseline CompactShell.js.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const file = process.argv[2] || path.resolve(__dirname,
    '../../../apps/documenteditor/main/app/view/CompactShell.js');
const source = fs.readFileSync(file, 'utf8');
const modifiedEvent = 'asc_onDocumentModifiedChanged';
const endEvent = 'asc_onEndAction';
const canSaveEvent = 'asc_onDocumentCanSaveChanged';
const startEvent = 'asc_onStartAction';
const actions = {Save: 1, ForceSaveButton: 2, Other: 3};

function fixture(unsupportedEvent) {
    const callbacks = new Map();
    const engine = {modified: false, canSave: true};
    let reads = 0, wordCounts = 0, now = 10000, nextTimer = 0;
    const timers = new Map();
    const state = {
        attributes: {}, classes: new Set(), markup: '',
        attr(name, value) {
            if (typeof name === 'object') Object.assign(this.attributes, name);
            else this.attributes[name] = value;
            return this;
        },
        toggleClass(name, enabled) {
            if (enabled) this.classes.add(name);
            else this.classes.delete(name);
            return this;
        },
        html(value) { this.markup = value; return this; },
        text(value) { this.markup = value; return this; },
        removeAttr(names) { names.split(' ').forEach(name => delete this.attributes[name]); return this; },
        removeClass(names) { names.split(' ').forEach(name => this.classes.delete(name)); return this; },
        addClass(name) { this.classes.add(name); return this; }
    };
    const DE = {Views: {}};
    const api = {
        isDocumentModified() {
            reads++;
            return engine.modified || !engine.canSave;
        },
        asc_registerCallback(name, callback) {
            if (name === unsupportedEvent) throw new Error('Unsupported callback');
            if (!callbacks.has(name)) callbacks.set(name, []);
            callbacks.get(name).push(callback);
        }
    };
    vm.runInNewContext(source, {
        DE, Asc: {c_oAscAsyncAction: actions}, window: {DE, Asc: {c_oAscAsyncAction: actions}},
        Date: {now: () => now},
        setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, {callback, at: now + delay}); return id; },
        clearTimeout: id => timers.delete(id),
        _: {extend: Object.assign}, $: () => state,
        define: (dependencies, factory) => factory({svg: icon => '<svg>' + icon + '</svg>'})
    }, {filename: file});
    const shell = DE.Views.CompactShell;
    shell.api = api;
    shell.scheduleWordCount = () => { wordCounts++; };
    shell.buildSaveState();
    shell.bindStatus();
    return {
        shell, api, engine, callbacks,
        tick(ms) {
            now += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= now) { timers.delete(id); timer.callback(); }
            }
        },
        get reads() { return reads; },
        get wordCounts() { return wordCounts; },
        emit(name, ...args) {
            if (name === endEvent && !args.length) args = [0, actions.Save];
            for (const callback of callbacks.get(name) || []) callback.apply(api, args);
        },
        expectDirty(dirty) { this.expectState(dirty ? 'dirty' : 'saved'); },
        expectState(key) {
            assert.deepEqual([...state.classes], [key], 'state class');
            assert.equal(state.attributes.role, 'status', 'status role');
            if (key === 'saved') {
                assert.equal(state.attributes.title, shell.textSaved, 'title');
                assert.equal(state.attributes['aria-label'], shell.textSaved, 'aria-label');
                assert.equal(state.markup, '<svg>accept</svg>', 'saved icon');
            } else {
                assert.equal(state.markup, key === 'saving' ? shell.textSaving : shell.textUnsaved, 'visible status');
                assert.equal(state.attributes.title, undefined, 'no stale title');
                assert.equal(state.attributes['aria-label'], undefined, 'visible status provides accessible text');
            }
        }
    };
}

let passed = 0, failed = 0;
function check(name, run) {
    try { run(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

for (const completion of [endEvent, canSaveEvent]) {
    check('save completes without another modified event: ' + completion, () => {
        const f = fixture();
        f.engine.modified = true;
        f.emit(modifiedEvent);
        f.expectDirty(true);
        f.engine.canSave = false;
        f.engine.modified = false;
        f.emit(modifiedEvent);
        f.expectDirty(true);
        f.engine.canSave = true;
        f.emit(completion);
        f.expectDirty(false);
    });
}

check('edits during save remain dirty until the next successful save', () => {
    const f = fixture();
    f.engine.modified = true;
    f.emit(modifiedEvent);
    f.engine.canSave = false;
    f.engine.modified = false;
    f.emit(modifiedEvent);
    f.expectDirty(true);
    f.engine.modified = true;
    f.emit(modifiedEvent);
    f.engine.canSave = true;
    f.emit(endEvent);
    f.emit(canSaveEvent, false);
    f.expectDirty(true);
    f.engine.canSave = false;
    f.engine.modified = false;
    f.emit(modifiedEvent);
    f.engine.canSave = true;
    f.emit(endEvent);
    f.emit(canSaveEvent);
    f.expectDirty(false);
});

for (const event of [modifiedEvent, endEvent, canSaveEvent]) {
    check('reads current SDK state instead of callback arguments: ' + event, () => {
        const f = fixture();
        f.engine.modified = true;
        f.emit(event, false);
        f.expectDirty(true);
        f.engine.modified = false;
        f.emit(event, true);
        f.expectDirty(false);
    });
}

check('autosave, repeated saves, duplicates and saving an unchanged document', () => {
    const f = fixture();
    for (const modified of [true, true, false]) {
        f.engine.modified = modified;
        f.emit(modifiedEvent);
        f.engine.canSave = false;
        f.engine.modified = false;
        f.emit(modifiedEvent);
        f.expectDirty(true);
        f.engine.canSave = true;
        for (const event of [canSaveEvent, endEvent, endEvent, canSaveEvent]) {
            f.emit(event);
            f.expectDirty(false);
        }
    }
});

check('failed save does not clear edits; a successful retry does', () => {
    const f = fixture();
    f.engine.modified = true;
    f.engine.canSave = false;
    f.emit(modifiedEvent);
    f.engine.canSave = true;
    f.emit(endEvent);
    f.emit(canSaveEvent);
    f.expectDirty(true);
    f.engine.canSave = false;
    f.engine.modified = false;
    f.emit(modifiedEvent);
    f.engine.canSave = true;
    f.emit(endEvent);
    f.expectDirty(false);
});

check('missing SDK reader preserves the last known dirty state', () => {
    const f = fixture();
    f.engine.modified = true;
    f.emit(modifiedEvent);
    delete f.api.isDocumentModified;
    for (const event of [modifiedEvent, endEvent, canSaveEvent]) {
        f.emit(event);
        f.expectDirty(true);
    }
});

for (const unavailable of [modifiedEvent, endEvent, canSaveEvent, startEvent]) {
    check('unsupported callback does not prevent other subscriptions: ' + unavailable, () => {
        const f = fixture(unavailable);
        const remaining = [modifiedEvent, endEvent, canSaveEvent].filter(event => event !== unavailable);
        for (const event of remaining) {
            f.engine.modified = true;
            f.emit(event);
            f.expectDirty(true);
            f.engine.modified = false;
            f.emit(event);
            f.expectDirty(false);
        }
        assert.ok(f.callbacks.has('asc_onGetDocInfoEnd'), 'later status callbacks are registered');
    });
}

check('startup failure disables all save-state callbacks', () => {
    const f = fixture();
    f.engine.modified = true;
    f.emit(modifiedEvent);
    f.shell.startupFailed = true;
    const reads = f.reads, wordCounts = f.wordCounts;
    f.engine.modified = false;
    for (const event of [modifiedEvent, endEvent, canSaveEvent, startEvent]) f.emit(event, 0, actions.Save);
    f.expectDirty(true);
    assert.equal(f.reads, reads);
    assert.equal(f.wordCounts, wordCounts);
});

check('save state, word count and other SDK listeners coexist', () => {
    const f = fixture();
    let externalCalls = 0;
    for (const event of [modifiedEvent, endEvent, canSaveEvent]) {
        f.api.asc_registerCallback(event, () => { externalCalls++; });
    }
    const wordCounts = f.wordCounts;
    f.engine.modified = true;
    f.emit(modifiedEvent);
    f.emit(endEvent);
    f.emit(canSaveEvent);
    f.expectDirty(true);
    assert.equal(f.wordCounts, wordCounts + 1, 'only modified schedules the word count');
    assert.equal(externalCalls, 3);
});

for (const action of [actions.Save, actions.ForceSaveButton]) {
    check('save completion keeps target three-state UI and three-second hold: ' + action, () => {
        const f = fixture();
        f.engine.modified = true;
        f.emit(modifiedEvent);
        f.expectState('dirty');
        f.emit(startEvent, 0, action);
        f.expectState('saving');
        f.engine.modified = false;
        f.emit(endEvent, 0, action);
        f.expectState('saving');
        f.tick(2999);
        f.expectState('saving');
        f.tick(1);
        f.expectState('saved');
    });
}

check('new save extends hold and edits during save survive completion', () => {
    const f = fixture();
    f.emit(startEvent, 0, actions.Save);
    f.tick(2000);
    f.emit(startEvent, 0, actions.ForceSaveButton);
    f.engine.modified = true;
    f.emit(modifiedEvent);
    f.emit(endEvent, 0, actions.ForceSaveButton);
    f.tick(2999);
    f.expectState('saving');
    f.tick(1);
    f.expectState('dirty');
});

check('unrelated action completion rereads modified without clearing saving', () => {
    const f = fixture();
    f.emit(startEvent, 0, actions.Other);
    f.expectState('saved');
    f.engine.modified = true;
    f.emit(endEvent, 0, actions.Other);
    f.expectState('dirty');
    f.emit(startEvent, 0, actions.Save);
    f.engine.modified = false;
    f.emit(endEvent, 0, actions.Other);
    f.tick(3000);
    f.expectState('saving');
    f.emit(endEvent, 0, actions.Save);
    f.expectState('saved');
});

check('missing reader at Save end clears saving while preserving dirty flag', () => {
    const f = fixture();
    f.engine.modified = true;
    f.emit(modifiedEvent);
    f.emit(startEvent, 0, actions.Save);
    delete f.api.isDocumentModified;
    f.emit(endEvent, 0, actions.Save);
    f.tick(3000);
    f.expectState('dirty');
});

for (const order of [[modifiedEvent, endEvent], [endEvent, modifiedEvent], [canSaveEvent, endEvent]]) {
    check('SDK unlock/event ordering after save: ' + order.join(', '), () => {
        const f = fixture();
        f.engine.modified = true;
        f.emit(modifiedEvent);
        f.emit(startEvent, 0, actions.Save);
        f.engine.modified = false;
        f.engine.canSave = false;
        f.emit(order[0], 0, actions.Save);
        f.engine.canSave = true;
        f.emit(order[1], 0, actions.Save);
        f.tick(3000);
        f.expectState('saved');
    });
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
