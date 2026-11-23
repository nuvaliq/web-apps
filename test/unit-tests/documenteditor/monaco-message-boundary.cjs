// Run: node test/unit-tests/documenteditor/monaco-message-boundary.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {parentEditor, message, ORIGIN, PAGE} = require('./fixtures/monaco-message.cjs');
const value = {value: 'plain text', pos: {row: 0, column: 0}};

for (const [name, overrides] of [
    ['another window', {source: {}}], ['missing window', {source: null}],
    ['another host', {origin: 'https://other.example.test'}],
    ['another scheme', {origin: 'http://editor.example.test'}],
    ['another port', {origin: 'https://editor.example.test:444'}],
    ['domain suffix', {origin: 'https://editor.example.test.other.test'}],
    ['opaque origin', {origin: 'null'}], ['missing origin', {origin: undefined}]
]) {
    test('ignores change from ' + name + ' before parsing', () => {
        const env = parentEditor();
        env.dispatch(env.event('changeValue', value, overrides));
        assert.equal(env.events.length, 0);
        assert.equal(env.parseCalls, 0);
        env.dispatch(env.event('changeValue', value));
        assert.equal(env.events.length, 1);
    });
}

test('forwards valid changes and readiness to consumers', () => {
    const env = parentEditor();
    env.dispatch(env.event('changeValue', value));
    assert.deepEqual(JSON.parse(JSON.stringify(env.events[0])), {event: 'change', args: ['plain text', value.pos]});
    env.dispatch(env.event('monacoEditorReady'));
    env.dispatch(env.event('monacoEditorReady', {}));
    assert.equal(env.events.filter(e => e.event === 'ready').length, 2);
});

const malformed = [null, {}, 42, 'broken', 'null', '[]', 'false', '"text"',
    Object(message('1', 'monacoEditorReady')),
    message('2', 'changeValue', value), message('1', 'setValue', value),
    JSON.stringify({referer: 'monaco-editor-1', command: 42}),
    message('1', 'changeValue'), message('1', 'changeValue', []),
    ...[null, 42, false, {}].map(v => message('1', 'changeValue', {...value, value: v})),
    ...[null, 'position', {}, {row: -1, column: 0}, {row: 1.5, column: 1},
        {row: '1', column: 1}, {row: 1, column: false}, {row: 1e20, column: 1}]
        .map(pos => message('1', 'changeValue', {...value, pos})),
    ...[null, [], 'ready', {value: 'unexpected'}].map(data => message('1', 'monacoEditorReady', data))];
for (const [index, data] of malformed.entries()) {
    test('ignores invalid message ' + index + ' without affecting the next change', () => {
        const env = parentEditor();
        assert.doesNotThrow(() => env.dispatch(env.event('changeValue', value, {data})));
        assert.equal(env.events.length, 0);
        env.dispatch(env.event('changeValue', value));
        assert.equal(env.events.length, 1);
    });
}

test('does not accept mandatory fields inherited from the object prototype', () => {
    const env = parentEditor();
    vm.runInContext("Object.prototype.command = 'changeValue'; Object.prototype.value = 'inherited';", env.context);
    env.dispatch(env.event('changeValue', value, {data: JSON.stringify({referer: 'monaco-editor-1', data: value})}));
    assert.equal(env.events.length, 0);
});

test('sends all public commands only to the expected origin', () => {
    const env = parentEditor();
    env.component.setValue('', {row: 0, column: 0}, true);
    env.component.updateTheme(); env.component.disableDrop(false);
    env.component.revealPositionInCenter(); env.component.undo(); env.component.redo();
    assert.deepEqual(env.sent.map(m => m.data.command),
        ['setValue', 'setTheme', 'disableDrop', 'revealPositionInCenter', 'undo', 'redo']);
    assert.ok(env.sent.every(m => m.origin === ORIGIN && m.data.referer === 'monaco-editor-1'));
});

test('binds the sender before navigation can deliver readiness', () => {
    const env = parentEditor({onNavigate({dispatch, frame}) {
        dispatch({source: frame.contentWindow, origin: ORIGIN, data: message('1', 'monacoEditorReady')});
    }});
    assert.deepEqual(env.order, ['append', 'subscribe', 'navigate']);
    assert.equal(env.events[0].event, 'ready');
});

for (const options of [
    {page: 'file:///editor/index.html'}, {baseURI: 'https://other.example.test/editor/'},
    {baseURI: 'not a URL'}, {baseURI: 'data:text/html,editor'}
]) {
    test('keeps invalid iframe configuration inactive: ' + JSON.stringify(options), () => {
        const env = parentEditor(options);
        assert.equal(env.frame.src, undefined);
        assert.equal(env.listeners.size, 0);
        assert.equal(env.mask.visible, false);
        env.component.setValue('ignored'); env.component.updateTheme(); env.component.undo();
        assert.equal(env.sent.length, 0);
        assert.doesNotThrow(() => {env.component.destroyEditor(); env.component.destroyEditor();});
    });
}

test('normalizes the iframe URL and standard port once', () => {
    const env = parentEditor({page: PAGE.replace('editor.example.test', 'editor.example.test:443')});
    env.component.setValue('text');
    assert.equal(env.frame.src, ORIGIN + '/web-apps/vendor/monaco/MonacoEditor.html?editorType=word&language=javascript&id=1');
    assert.equal(env.sent[0].origin, ORIGIN);
});

test('ignores another instance even when its correlation id matches', () => {
    const first = parentEditor(), second = parentEditor();
    first.dispatch(first.event('changeValue', value, {source: second.frame.contentWindow}));
    assert.equal(first.events.length, 0);
});

test('destroy detaches events and rejects queued messages and outgoing calls', () => {
    const env = parentEditor();
    const queued = env.event('changeValue', value);
    env.component.destroyEditor(); env.component.destroyEditor();
    env.component._onMessage(queued);
    env.component.setValue('ignored'); env.component.updateTheme(); env.component.disableDrop(true);
    env.component.revealPositionInCenter(); env.component.undo(); env.component.redo();
    assert.equal(env.listeners.size, 0);
    assert.equal(env.notificationListeners.size, 0);
    assert.equal(env.events.length, 0);
    assert.equal(env.sent.length, 0);
});
