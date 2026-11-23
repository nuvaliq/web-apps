const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.MONACO_SOURCE_ROOT || path.resolve(__dirname, '../../../..');
const ORIGIN = 'https://editor.example.test';
const PAGE = ORIGIN + '/web-apps/apps/documenteditor/main/index.html';
const COMPONENT = 'apps/common/main/lib/component/MonacoEditor.js';
const FRAME = 'vendor/monaco/MonacoEditorCode.js';

function load(file, context) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, {filename: file});
}

function message(id, command, data) {
    const result = {referer: 'monaco-editor-' + id, command};
    if (data !== undefined) result.data = data;
    return JSON.stringify(result);
}

function parentEditor(options = {}) {
    const events = [], sent = [], listeners = new Set(), order = [];
    const notificationListeners = new Set();
    const mask = {visible: false, show() {this.visible = true;}, hide() {this.visible = false;}};
    let parseCalls = 0;
    const remote = {postMessage(data, origin) {sent.push({data: JSON.parse(data), origin});}};
    const frame = {style: {}, contentWindow: null};
    Object.defineProperty(frame, 'src', {
        get() {return this._src;},
        set(value) {
            this._src = value;
            order.push('navigate');
            if (options.onNavigate) options.onNavigate({dispatch, frame, order});
        }
    });
    const container = {append(element) {element.contentWindow = remote; order.push('append');}};
    const window = {
        JSON: {parse(value) {parseCalls++; return JSON.parse(value);}, stringify: JSON.stringify},
        URL,
        location: {href: options.page || PAGE, origin: new URL(options.page || PAGE).origin},
        addEventListener(event, fn) {if (event === 'message') {listeners.add(fn); order.push('subscribe');}},
        removeEventListener(event, fn) {if (event === 'message') listeners.delete(fn);}
    };
    const document = {baseURI: options.baseURI || options.page || PAGE, createElement() {return frame;}};
    function BaseView() {}
    BaseView.prototype.initialize = function() {this.handlers = {};};
    BaseView.prototype.on = function(event, fn) {
        (this.handlers[event] || (this.handlers[event] = [])).push(fn);
        return this;
    };
    BaseView.prototype.fireEvent = function(event, ...args) {
        events.push({event, args});
        for (const fn of this.handlers[event] || []) fn(...args);
    };
    BaseView.extend = function(proto) {
        function View(options) {this.initialize(options);}
        View.prototype = Object.assign(Object.create(BaseView.prototype), proto);
        return View;
    };
    const Common = {
        UI: {BaseView, LoadMask: function() {return mask;}, Themes: {getThemeColors: () => ({type: 'dark'})}},
        NotificationCenter: {
            on(event, fn) {notificationListeners.add(fn);}, off(event, fn) {notificationListeners.delete(fn);}
        }
    };
    const context = vm.createContext({window, document, URL, Common, $: () => container,
        _: {uniqueId: () => options.id || '1', bind: (fn, scope) => fn.bind(scope)},
        define: (deps, factory) => factory()});
    const parseJSON = vm.runInContext('JSON.parse', context);
    window.JSON.parse = value => {parseCalls++; return parseJSON(value);};
    load(COMPONENT, context);
    const component = new Common.UI.MonacoEditor({parentEl: container, language: options.language});
    function dispatch(event) {for (const fn of listeners) fn(event);}
    return {component, context, frame, window, Common, events, sent, mask, order, listeners,
        notificationListeners, dispatch,
        event(command, data, overrides = {}) {
            return {source: frame.contentWindow, origin: window.location.origin,
                data: message(component.id, command, data), ...overrides};
        },
        get parseCalls() {return parseCalls;}};
}

function frameEditor(options = {}) {
    const calls = [], sent = [], listeners = new Map();
    const parent = {postMessage(data, origin) {sent.push({data: JSON.parse(data), origin});}};
    let ready, change, parseCalls = 0;
    const editor = {
        value: '', position: {lineNumber: 1, column: 1}, readonly: false,
        create(element, theme, value, config, callback) {ready = callback; if (options.syncReady) callback();},
        addLibrary() {},
        on(event, callback) {if (event === 'onDidChangeModelContent') change = callback;},
        getValue() {return this.value;}, getPosition() {return this.position;},
        setValue(value) {calls.push(['value', value]); this.value = value; if (change) change({});},
        setPosition(pos) {calls.push(['position', pos]); this.position = pos;},
        setReadonly(value) {calls.push(['readonly', value]); this.readonly = value;},
        setFocus() {}, setTheme(value) {calls.push(['theme', value]);},
        revealPositionInCenter() {calls.push(['reveal']);},
        undo() {calls.push(['undo']);}, redo() {calls.push(['redo']);}
    };
    const window = {
        JSON: {parse(value) {parseCalls++; return JSON.parse(value);}, stringify: JSON.stringify},
        id: '1', language: options.language || 'vba',
        location: {origin: options.origin || ORIGIN,
            protocol: (options.origin || ORIGIN).startsWith('https:') ? 'https:' : 'http:'}, innerHeight: 600,
        parent, MonacoEditor: function() {return editor;},
        addEventListener(event, fn) {listeners.set(event, fn);}
    };
    if (options.standalone) window.parent = window;
    const elements = {editor: {}, 'dynamic-styles': {}};
    const document = {getElementById: id => elements[id], createElement: () => ({}), head: {appendChild() {}}};
    const context = vm.createContext({window, document, console});
    const parseJSON = vm.runInContext('JSON.parse', context);
    window.JSON.parse = value => {parseCalls++; return parseJSON(value);};
    load(FRAME, context);
    return {window, context, editor, calls, sent, listeners, elements,
        ready() {ready();}, change() {change({});},
        dispatch(event) {const fn = listeners.get('message'); if (fn) fn(event);},
        event(command, data, overrides = {}) {
            return {source: parent, origin: options.origin || ORIGIN, data: message('1', command, data), ...overrides};
        },
        get parseCalls() {return parseCalls;}};
}

module.exports = {ROOT, ORIGIN, PAGE, COMPONENT, FRAME, load, message, parentEditor, frameEditor};
