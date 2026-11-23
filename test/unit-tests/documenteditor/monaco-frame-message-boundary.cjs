// Run: node test/unit-tests/documenteditor/monaco-frame-message-boundary.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {frameEditor, message, ORIGIN} = require('./fixtures/monaco-message.cjs');

for (const [name, overrides] of [
    ['another window', {source: {}}], ['missing window', {source: null}],
    ['another host', {origin: 'https://other.example.test'}],
    ['another scheme', {origin: 'http://editor.example.test'}],
    ['another port', {origin: 'https://editor.example.test:444'}],
    ['domain suffix', {origin: 'https://editor.example.test.other.test'}],
    ['opaque origin', {origin: 'null'}], ['missing origin', {origin: undefined}]
]) {
    test('ignores setValue from ' + name + ' before parsing', () => {
        const env = frameEditor();
        env.dispatch(env.event('setValue', {value: 'untrusted'}, overrides));
        assert.equal(env.editor.value, '');
        assert.equal(env.calls.length, 0);
        assert.equal(env.parseCalls, 0);
        env.dispatch(env.event('setValue', {value: 'trusted'}));
        assert.equal(env.editor.value, 'trusted');
    });
}

const bad = [null, {}, 42, '{', 'null', '[]', 'false',
    Object(message('1', 'revealPositionInCenter')),
    message('2', 'setValue', {value: 'wrong id'}), message('1', 'changeValue', {value: 'wrong command'}),
    message('1', 'setValue'), message('1', 'setValue', []),
    ...[null, 42, false, {}].map(value => message('1', 'setValue', {value})),
    ...['true', 1, null].map(readonly => message('1', 'setValue', {value: 'text', readonly})),
    ...[{}, [], 'pos', {row: -1, column: 0}, {row: 1, column: 0.5},
        {row: 1, column: '0'}, {row: 1e20, column: 0}]
        .map(currentPos => message('1', 'setValue', {value: 'text', currentPos})),
    ...[null, {}, {type: 1}, [], {type: null}].map(data => message('1', 'setTheme', data)),
    ...[null, {}, 0, 1, 'false', []].map(data => message('1', 'disableDrop', data)),
    ...[null, 'undo', [], {value: 1}].map(data => message('1', 'undo', data))];
for (const [index, data] of bad.entries()) {
    test('ignores invalid frame message ' + index + ' without partial effects', () => {
        const env = frameEditor();
        assert.doesNotThrow(() => env.dispatch(env.event('setValue', {value: 'ignored'}, {data})));
        assert.equal(env.calls.length, 0);
        env.dispatch(env.event('setValue', {value: 'next'}));
        assert.equal(env.editor.value, 'next');
    });
}

test('requires own command and payload properties', () => {
    const env = frameEditor();
    vm.runInContext("Object.prototype.command = 'setValue'; Object.prototype.value = 'inherited';", env.context);
    env.dispatch(env.event('setValue', {}, {data: JSON.stringify({referer: 'monaco-editor-1', data: {}})}));
    assert.equal(env.calls.length, 0);
});

for (const currentPos of [undefined, null, {row: 0, column: 0}, {row: 3, column: 0}]) {
    test('accepts empty text and position ' + JSON.stringify(currentPos), () => {
        const env = frameEditor();
        env.dispatch(env.event('setValue', {value: '', currentPos, readonly: true}));
        assert.equal(env.editor.value, '');
        assert.equal(env.editor.readonly, true);
        assert.deepEqual(JSON.parse(JSON.stringify(env.editor.position)),
            {lineNumber: currentPos ? currentPos.row : 0, column: currentPos ? currentPos.column : 0});
        assert.equal(env.sent.length, 0, 'programmatic setValue must not echo a user change');
    });
}

test('preserves themes, drop control, undo, redo, and reveal commands', () => {
    const env = frameEditor();
    for (const type of ['dark', 'light', 'custom']) env.dispatch(env.event('setTheme', {type, name: 'custom'}));
    env.dispatch(env.event('disableDrop', true));
    let prevented = 0;
    env.elements.editor.ondrop({preventDefault() {prevented++;}});
    env.dispatch(env.event('disableDrop', false));
    env.elements.editor.ondrop({preventDefault() {prevented++;}});
    assert.equal(prevented, 1);
    for (const cmd of ['undo', 'redo', 'revealPositionInCenter']) env.dispatch(env.event(cmd));
    assert.deepEqual(env.calls, [['theme', 'vs-dark'], ['theme', 'vs-light'], ['theme', 'vs-light'],
        ['undo'], ['redo'], ['reveal']]);
});

test('sends readiness and actual user changes only to the fixed parent origin', () => {
    const env = frameEditor();
    env.ready();
    env.editor.value = 'typed text'; env.editor.position = {lineNumber: 2, column: 3}; env.change();
    assert.deepEqual(env.sent, [
        {origin: ORIGIN, data: {referer: 'monaco-editor-1', command: 'monacoEditorReady'}},
        {origin: ORIGIN, data: {referer: 'monaco-editor-1', command: 'changeValue',
            data: {value: 'typed text', pos: {row: 2, column: 3}}}}
    ]);
});

test('can announce readiness synchronously', () => {
    const env = frameEditor({syncReady: true});
    assert.equal(env.sent[0].origin, ORIGIN);
});

for (const options of [{standalone: true}, {origin: 'null'}, {origin: 'file://'}]) {
    test('disables messages for unsupported frame context ' + JSON.stringify(options), () => {
        const env = frameEditor(options);
        assert.doesNotThrow(() => {env.ready(); env.change();});
        env.dispatch(env.event('setValue', {value: 'ignored'}));
        assert.equal(env.calls.length, 0);
        assert.equal(env.sent.length, 0);
    });
}
