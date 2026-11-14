/* Run: node test/unit-tests/documenteditor/compact-watermark-late-load.cjs
 * The optional argument is the path to an AMD file for checking the baseline.
 * The "Watermark settings" window: an image load started in a window that
 * was closed finishes when the next one is already open. The engine's
 * asc_onWatermarkImageLoaded event is shared and carries no data, so the next
 * window must not use it to bring back an image removed with the cross.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const file = process.argv[2] || path.join(ROOT, 'apps/documenteditor/main/app/view/CompactWatermark.js');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

const T = {None: 0, Text: 1, Image: 2};
const ZONE = 'vo-wm-thumb';

/* Engine event subscribers are shared by all windows. */
const handlers = {};
const api = {
    asc_registerCallback(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    asc_unregisterCallback(name, fn) { handlers[name] = (handlers[name] || []).filter(h => h !== fn); },
    sendEvent(name) { (handlers[name] || []).slice().forEach(h => h()); }
};

/* Texture nodes in the document: id → the picture drawn in it. The zone node
   of a closed window is removed together with the window, the zone id of the next one is the same. */
let nodes = {};

/* Watermark properties modeled on CAscWatermarkProperties
   (sdkjs/word/apiCommon.js:2128–2146, 2256–2260): the load ends on
   its own object (the picture, the "Image" type, rendering into the node by DivId
   at that moment) and with the shared event without data. */
function makeProps(type, url) {
    const pending = [];
    return {
        Type: type, ImageUrl: url, DivId: null,
        get_Type() { return this.Type; },
        put_Type(v) { this.Type = v; },
        get_ImageUrl() { return this.ImageUrl; },
        put_ImageUrl2(v) { this.ImageUrl = v; },
        put_DivId(v) { this.DivId = v; this.drawTexture(); },
        drawTexture() {
            if (this.ImageUrl && Object.prototype.hasOwnProperty.call(nodes, this.DivId)) nodes[this.DivId] = this.ImageUrl;
        },
        put_ImageUrl(v) {
            pending.push(() => {
                this.ImageUrl = v;
                this.Type = T.Image;
                this.drawTexture();
                api.sendEvent('asc_onWatermarkImageLoaded');
            });
        },
        finish() { pending.shift()(); }
    };
}

/* A stock window with only what the code under test relies on: the subscription to
   the load in afterRender (WatermarkSettingsDialog.js:401–420) and the document
   view in _setDefaults (:514–526). */
function Base() {}
Base.prototype = {
    afterRender() {
        const me = this;
        this._setDefaults(this.props);
        const onLoaded = () => { me.isImageLoaded = true; me.btnOk.setDisabled(false); };
        this.api.asc_registerCallback('asc_onWatermarkImageLoaded', onLoaded);
        this.on('close', () => me.api.asc_unregisterCallback('asc_onWatermarkImageLoaded', onLoaded));
    },
    _setDefaults(props) {
        if (props.get_Type() === T.Image) {
            this.setType(T.Image, true);
            this.isImageLoaded = !!props.get_ImageUrl();
        }
    },
    getSettings() { return this.props; },
    disableControls() {}
};
Base.extend = function (proto) {
    function Dialog() {}
    Dialog.prototype = Object.assign(Object.create(Base.prototype), proto);
    return Dialog;
};

const DE = {Views: {WatermarkSettingsDialog: Base, CompactWindows: {}}};
const Common = {Views: {AdvancedSettingsWindow: function () {}}};
const context = {
    window: {DE, Common}, DE, Common, _,
    Asc: {c_oAscWatermarkType: T},
    define: (dependencies, factory) => factory()
};
vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
const Dialog = DE.Views.CompactWatermark.ensure();

/* A window over the properties: rendered (afterRender), its zone is in the document. */
function open(props) {
    nodes = {[ZONE]: null};
    const onClose = [];
    const win = Object.create(Dialog.prototype);
    Object.assign(win, {
        api, props, wmType: T.Text, segs: [], _built: true, hadWm: false,
        options: {},
        on(name, fn) { if (name === 'close') onClose.push(fn); return this; },
        close() { onClose.forEach(fn => fn()); },
        btnOk: {disabled: true, setDisabled(v) { this.disabled = v; }},
        btnClear: {isDisabled: () => false},
        zone: {focus() {}},
        paint() {}
    });
    win.afterRender();
    return win;
}

/* A window with the image watermark a.png starts loading b.png and closes
   before the load ends. */
function cancelledLoad() {
    const props = makeProps(T.Image, 'a.png');
    const win = open(props);
    props.put_ImageUrl('b.png');
    win.close();
    return props;
}

let passed = 0, failed = 0;
function check(name, run) {
    for (const key of Object.keys(handlers)) delete handlers[key];
    try {
        run();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}

check('late load of a closed window keeps the next window cleared', () => {
    const stale = cancelledLoad();
    const props = makeProps(T.Image, 'a.png');
    const win = open(props);
    win.clearImage();
    stale.finish();
    assert.equal(win.hasImage(), false);
    assert.equal(win.btnOk.disabled, false);
    assert.equal(win.getSettings().get_Type(), T.None);
});

check('late load of a closed window leaves the next window image as is', () => {
    const stale = cancelledLoad();
    const props = makeProps(T.Image, 'a.png');
    const win = open(props);
    stale.finish();
    assert.equal(win.hasImage(), true);
    const settings = win.getSettings();
    assert.equal(settings.get_Type(), T.Image);
    assert.equal(settings.get_ImageUrl(), 'a.png');
});

check('own load after clearing shows its image even when the stale load lands first', () => {
    const stale = cancelledLoad();
    const props = makeProps(T.Image, 'a.png');
    const win = open(props);
    win.clearImage();
    props.put_ImageUrl('c.png');
    stale.finish();
    assert.equal(win.hasImage(), false);
    props.finish();
    assert.equal(win.hasImage(), true);
    assert.equal(nodes[ZONE], 'c.png');
    const settings = win.getSettings();
    assert.equal(settings.get_Type(), T.Image);
    assert.equal(settings.get_ImageUrl(), 'c.png');
});

check('the same image loaded again after clearing comes back', () => {
    const props = makeProps(T.Image, 'a.png');
    const win = open(props);
    win.clearImage();
    assert.equal(win.hasImage(), false);
    props.put_ImageUrl('a.png');
    props.finish();
    assert.equal(win.hasImage(), true);
    assert.equal(win.getSettings().get_Type(), T.Image);
});

check('clearing an image the document has and applying removes the watermark', () => {
    const props = makeProps(T.Image, 'a.png');
    const win = open(props);
    win.clearImage();
    assert.equal(win.btnOk.disabled, false);
    assert.equal(win.getSettings().get_Type(), T.None);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
