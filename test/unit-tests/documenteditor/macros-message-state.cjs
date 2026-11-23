// Run: node test/unit-tests/documenteditor/macros-message-state.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const {parentEditor, load} = require('./fixtures/monaco-message.cjs');

function record(value, guid) {
    const fields = {value, guid, name: guid, autostart: false};
    return {get: key => fields[key], set(key, value) {fields[key] = value;}};
}

function dialogEnvironment(customFunction = false) {
    const env = parentEditor();
    env.component.destroyEditor();
    env.Common.Views = {};
    env.Common.UI.Window = {extend: proto => proto, prototype: {close() {}}};
    env.context._.extend = Object.assign;
    env.context.setTimeout = fn => fn();
    load('apps/common/main/lib/view/MacrosDialog.js', env.context);
    load('apps/common/main/lib/view/MacrosAiDialog.js', env.context);
    const macro = record('original macro', 'macro');
    const fn = record('original function', 'function');
    const other = record('other macro', 'other');
    function list(models, selected) {
        const store = {models, indexOf: item => models.indexOf(item),
            remove(item) {models.splice(models.indexOf(item), 1);}, get length() {return models.length;}};
        return {store, getSelectedRec: () => selected};
    }
    const calls = {run: [], macros: [], functions: []};
    const dialog = Object.assign(Object.create(env.Common.Views.MacrosDialog), {
        api: {
            callCommand: text => calls.run.push(text),
            pluginMethod_SetMacros: data => calls.macros.push(JSON.parse(data)),
            SetCustomFunctions: data => calls.functions.push(JSON.parse(data))
        },
        options: {}, ItemTypes: {Macros: 1, CustomFunction: 0},
        _state: {selectedItem: {record: customFunction ? fn : macro, type: customFunction ? 0 : 1},
            currentValue: customFunction ? 'original function' : 'original macro',
            currentPos: {row: 0, column: 0}, isFunctionsSupport: true},
        aceContainer: {removeClass() {}},
        listMacros: list([macro, other], macro), listFunctions: list([fn], fn),
        setDisableButtons(value) {this.buttonsDisabled = value;}
    });
    dialog.createCodeEditor();
    return {env, dialog, macro, fn, other, calls};
}

for (const customFunction of [false, true]) {
    for (const overrides of [{source: {}}, {origin: 'https://other.example.test'}]) {
        test('rejects foreign changes before Run and OK for ' + (customFunction ? 'function' : 'macro') +
            ' with ' + Object.keys(overrides)[0], () => {
            const {env, dialog, macro, fn, other, calls} = dialogEnvironment(customFunction);
            env.dispatch(env.event('changeValue', {value: 'foreign text', pos: {row: 9, column: 9}}, overrides));
            assert.equal(dialog._state.currentValue, customFunction ? 'original function' : 'original macro');
            assert.equal(macro.get('value'), 'original macro');
            assert.equal(fn.get('value'), 'original function');
            assert.equal(other.get('value'), 'other macro');
            dialog.onRunMacros(false);
            dialog._handleInput('ok');
            assert.deepEqual(calls.run, [customFunction ? 'original function' : 'original macro']);
            assert.equal(calls.macros[0].macrosArray[0].value, 'original macro');
            assert.equal(calls.functions[0].macrosArray[0].value, 'original function');
        });
    }
    test('preserves typed ' + (customFunction ? 'function' : 'macro') + ' through Run, debug and OK', () => {
        const {env, dialog, macro, fn, other, calls} = dialogEnvironment(customFunction);
        env.dispatch(env.event('changeValue', {value: 'typed text', pos: {row: 2, column: 3}}));
        assert.equal((customFunction ? fn : macro).get('value'), 'typed text');
        assert.equal(other.get('value'), 'other macro');
        dialog.onRunMacros(false); dialog.onRunMacros(true); dialog._handleInput('ok');
        assert.deepEqual(calls.run, ['typed text', 'debugger;\ntyped text']);
        assert.equal((customFunction ? calls.functions : calls.macros)[0].macrosArray[0].value, 'typed text');
        assert.equal(env.listeners.size, 0);
    });
}

test('Cancel does not save either macros or custom functions', () => {
    const {env, dialog, calls} = dialogEnvironment();
    env.dispatch(env.event('changeValue', {value: 'edited', pos: {row: 0, column: 0}}));
    dialog._handleInput('cancel');
    assert.deepEqual(calls, {run: [], macros: [], functions: []});
    env.dispatch(env.event('changeValue', {value: 'late', pos: {row: 0, column: 0}}));
    assert.equal(dialog._state.currentValue, 'edited');
});

test('deleting the last macro keeps the editor empty and readonly', () => {
    const {env, dialog, other} = dialogEnvironment();
    dialog.listMacros.store.remove(other);
    dialog.onDeleteItem();
    assert.deepEqual(env.sent.at(-1).data.data, {value: '', readonly: true, currentPos: {row: 0, column: 0}});
    assert.equal(dialog.buttonsDisabled, true);
});

test('VBA dialog accepts only its own input and passes it to the AI boundary', () => {
    const {env, dialog: main} = dialogEnvironment();
    const calls = [];
    const vba = Object.assign(Object.create(env.Common.Views.MacrosAiDialog), {
        _state: {codeEditorValue: ''}, inputType: 'codeEditor', instruction: 'convert',
        options: {handler() {}}, api: {AI: request => calls.push(request)}
    });
    main.close();
    vba.createCodeEditor();
    env.dispatch(env.event('changeValue', {value: 'foreign VBA', pos: {row: 0, column: 0}}, {source: {}}));
    assert.equal(vba._state.codeEditorValue, '');
    env.dispatch(env.event('monacoEditorReady'));
    assert.deepEqual(env.sent.at(-1).data.data, {value: '', currentPos: {row: 0, column: 0}});
    env.dispatch(env.event('changeValue', {value: 'Sub Example()', pos: {row: 1, column: 1}}));
    vba._handleInput('ok');
    assert.equal(calls[0].data[1].content, 'Sub Example()');
    vba.close();
    env.dispatch(env.event('changeValue', {value: 'late VBA', pos: {row: 1, column: 1}}));
    assert.equal(vba._state.codeEditorValue, 'Sub Example()');
    assert.equal(main._state.currentValue, 'original macro');
});
