'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const main = path.join(root, 'apps/presentationeditor/main');
const read = file => fs.readFileSync(path.join(main, file), 'utf8');
function page(file, desktop = false, label = 'End slideshow') {
    const timers = new Map(), listeners = {}, calls = [], nodes = new Map();
    let timerId = 0, time = 0, api, readyModule;
    function element(tag) { return {tagName: tag, style: {}, addEventListener(type, fn) { this[type] = fn; }, remove() {nodes.delete(this.id);}, setAttribute(k,v) {this[k]=v;}}; }
    const document = {title: 'Presenter', createElement: element, getElementById: id => nodes.get(id),
        body: {appendChild(el) {nodes.set(el.id, el); el.parentNode = this;}, removeChild(el) {nodes.delete(el.id);}}};
    const opener = {closed: false};
    const window = {document, opener, JSON, postMessage: (...args) => calls.push(['selfMessage', ...args]), location: {origin: 'https://editor.test', search: '?reporterEndLabel=' + encodeURIComponent(label)},
        addEventListener(type, fn) {(listeners[type] ||= []).push(fn);},
        removeEventListener(type, fn) {listeners[type] = (listeners[type] || []).filter(f => f !== fn);}};
    if (desktop) window.AscDesktopEditor = {};
    function schedule(fn, delay) {const id = ++timerId; timers.set(id, {fn, at: time + delay, delay}); return id;}
    const cancel = id => timers.delete(id);
    const callbacks = {};
    function Info() {}
    for (const name of ['Id','Url','DirectUrl','Title','Format','VKey','Options','Token','TokenType','Permissions','Mode'])
        Info.prototype['put_' + name] = function(value) {this[name] = value; calls.push(['put_' + name, value]);};
    const Asc = {asc_CDocInfo: Info, asc_docs_api: function() {
        api = this; this.callbacks = callbacks;
        for (const name of ['preloadReporter','SetThemesPath','SetDrawingFreeze','asc_LoadDocument','sendFromReporter','EndDemonstration'])
            this[name] = (...args) => calls.push([name, ...args]);
        this.asc_setViewMode = value => {this.isViewMode = value; calls.push(['view', value]);};
        this.asc_setDocInfo = info => {this.info = info; calls.push(['info', info]);};
        this.asc_getEditorPermissions = () => calls.push(['permissions', this.info.Mode, this.isViewMode, this.info.TokenType]);
        this.asc_registerCallback = (name, fn) => callbacks[name] = fn;
    }};
    const context = {window, document, location: window.location, Asc, URLSearchParams,
        localStorage: {getItem() {return null;}}, setTimeout: schedule, clearTimeout: cancel,
        $: () => ({hide() {return this;}, remove() {calls.push(['maskRemoved']);}}), console};
    context.require = (deps, fn) => fn(...deps.map(name => /reporter-ready$/.test(name) ? readyModule : {}));
    context.require.config = () => {};
    context.define = fn => {readyModule = fn();};
    if (fs.existsSync(path.join(main, 'reporter-ready.js'))) vm.runInNewContext(read('reporter-ready.js'), context);
    vm.runInNewContext(read(file), context, {filename: file});
    function emit(type, event = {}) {for (const fn of (listeners[type] || []).slice()) fn(event);}
    function metadata(data = {key: 'document-key', token: 'test-token', tokenType: 'session', permissions: {edit: false}}, source = opener, origin = window.location.origin) {
        emit('message', {source, origin, data: JSON.stringify({type: 'file:open', data})});
    }
    function tick() {const next = [...timers.entries()].sort((a,b) => a[1].at - b[1].at)[0]; if (!next) return false; timers.delete(next[0]); time = next[1].at; next[1].fn(); return time;}
    return {api, calls, timers, listeners, nodes, window, opener, callbacks, metadata, emit, tick};
}
function viewport(desktop = false, auth = {type: 'session', token: 'session-token'}) {
    const text = read('app/controller/Viewport.js'), start = text.indexOf('onPreviewStart: function('), end = text.indexOf('\n        onFileMenu:', start);
    const fn = text.slice(text.indexOf('function', start), end).trim().replace(/,$/, '');
    const original = {key: 'key', token: 'original-token', permissions: {edit: true}};
    let started;
    const preview = new Proxy({isVisible: () => false, show() {}, btnDraw: {setDisabled() {}}}, {get: (obj,key) => key in obj ? obj[key] : 'translated'});
    const context = {PE: {getController: name => name === 'Main' ? {document: original} : null},
        window: desktop ? {AscDesktopEditor: {}} : {}, document: {}, setTimeout: fn => fn(),
        Common: {Utils: {}, UI: {Menu: {Manager: {hideAll() {}}}}, NotificationCenter: {off() {}}, component: {Analytics: {trackEvent() {}}}}};
    const controller = {previewPanel: preview, viewport: {mode: {isDesktopApp: desktop, customization: {}}},
        api: {asc_getReporterAuth: () => auth, asc_getSessionToken: () => 'legacy-token',
        StartDemonstrationFromBeginning: (id, data) => started = data}};
    vm.runInNewContext('(' + fn + ')', context).call(controller, 0, true, false, false);
    return {original, started};
}
module.exports = {page, viewport, read, main};
