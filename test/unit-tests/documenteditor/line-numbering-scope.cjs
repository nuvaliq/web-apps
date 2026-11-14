/* Run: node test/unit-tests/documenteditor/line-numbering-scope.cjs
 * Real AMD UI contracts; doubles do not verify actual ComboBox, SDK or DOCX.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const VIEW = path.resolve(__dirname, '../../../apps/documenteditor/main/app/view');
const scope = {Current: 0, ToEnd: 1, All: 2};
const restart = {Continuous: 0, NewPage: 1, NewSection: 2};

function environment() {
    const DE = {Views: {}, Controllers: {}};
    const windows = [], baseOptions = [];
    const chain = {find() { return this; }, on() { return this; }};
    function Window(options) { this.initialize(options); windows.push(this); }
    Window.prototype = {
        initialize(options) { baseOptions.push(this.options); this.options = Object.assign({}, options); },
        render() {}, show() { this.render(); }, close() { this.closed = true; },
        getChild() { return chain; }
    };
    Window.extend = function (definition) {
        function Dialog(options) { Window.call(this, options); }
        Dialog.prototype = Object.assign(Object.create(Window.prototype), definition);
        return Dialog;
    };
    function Control(options) { this.value = options.value; this.checked = !!options.checked; }
    Control.prototype = {
        on() { return this; }, setDisabled() {}, setDefaultUnit() {}, setStep() {},
        setValue(value) { this.value = value; this.checked = !!value; },
        getValue() { return this.value; }, getNumberValue() { return Number(this.value); }
    };
    function CheckBox(options) { Control.call(this, options); }
    CheckBox.prototype = Object.assign(Object.create(Control.prototype), {
        getValue() { return this.checked ? 'checked' : 'unchecked'; }
    });
    function RadioBox(options) { Control.call(this, options); }
    RadioBox.prototype = Object.assign(Object.create(Control.prototype), {
        getValue() { return this.checked; }
    });
    function Props() {}
    for (const name of ['Restart', 'Start', 'Distance', 'CountBy']) {
        Props.prototype['put_' + name] = function (value) { this[name] = value; };
        Props.prototype['get_' + name] = function () { return this[name]; };
    }
    const Common = {
        UI: {Window, CheckBox, RadioBox, MetricSpinner: Control, ComboBox: Control},
        Utils: {Metric: {fnRecalcToMM: v => v, fnRecalcFromMM: v => v,
            getCurrentMetricName: () => 'cm', getCurrentMetric: () => 0, c_MetricUnits: {pt: 1}}},
        NotificationCenter: {trigger() {}}
    };
    const context = {DE, window: {DE, Common}, Common, $: () => chain,
        Asc: {c_oAscSectionApplyType: scope, c_oAscLineNumberRestartType: restart, CSectionLnNumType: Props},
        Backbone: {Controller: {extend: definition => definition}},
        _: {extend: Object.assign, bind: (fn, owner) => fn.bind(owner), template: text => () => text,
            isUndefined: value => value === undefined},
        define: (deps, factory) => factory()};
    vm.createContext(context);
    for (const name of ['DocumentActions', 'LineNumbersDialog']) {
        const file = path.join(VIEW, name + '.js');
        vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
    }
    const toolbarFile = path.resolve(VIEW, '../controller/Toolbar.js');
    vm.runInContext(fs.readFileSync(toolbarFile, 'utf8'), context, {filename: toolbarFile});
    const calls = [];
    let getterValue;
    DE.Views.DocumentActions.api = {
        asc_GetLineNumbersProps() { return getterValue; },
        asc_SetLineNumbersProps(type, props) { calls.push({type, props}); }
    };
    function dialog(options) { const d = new DE.Views.LineNumbersDialog(options); d.show(); return d; }
    function open() { DE.Views.DocumentActions.lineNumbers(); return windows.at(-1); }
    return {DE, dialog, open, calls, baseOptions, Props, windows, setGetter(value) { getterValue = value; }};
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}
check('caller passes explicit All and fresh SDK properties on every open', () => {
    const e = environment(), seen = [];
    e.DE.Views.DocumentActions.dialog = (name, options, props) => seen.push({name, options, props});
    const props = new e.Props(); e.setGetter(props);
    e.DE.Views.DocumentActions.lineNumbers(); e.setGetter(null); e.DE.Views.DocumentActions.lineNumbers();
    assert.equal(seen.length, 2);
    for (const call of seen) { assert.equal(call.name, 'LineNumbersDialog'); assert.equal(call.options.applyTo, scope.All); }
    assert.equal(seen[0].props, props); assert.equal(seen[1].props, null);
    assert.notEqual(seen[0].options, seen[1].options);
});
check('missing and invalid initial scope default to All', () => {
    const e = environment();
    assert.equal(e.dialog().cmbApply.getValue(), scope.All);
    for (const value of [undefined, null, '', '0', '1', '2', -1, 99, false, {}, NaN]) {
        assert.equal(e.dialog({applyTo: value}).cmbApply.getValue(), scope.All, String(value));
    }
});
check('Current, ToEnd and All including numeric zero survive unchanged', () => {
    const e = environment();
    for (const value of Object.values(scope)) {
        const d = e.dialog({applyTo: value});
        assert.equal(d.cmbApply.getValue(), value); assert.equal(d.getSettings().type, value);
    }
});
check('options are isolated before base initialize; no scope or handler leaks', () => {
    const e = environment(), prototype = e.DE.Views.LineNumbersDialog.prototype.options;
    const initial = {...prototype}; let callbacks = 0;
    for (const value of [scope.Current, scope.ToEnd]) {
        const input = {applyTo: value, handler() { callbacks++; }, width: 315};
        const first = e.dialog(input); first._handleInput('cancel');
        const second = e.dialog();
        assert.notEqual(e.baseOptions.at(-1), prototype);
        assert.notEqual(e.baseOptions.at(-1), e.baseOptions.at(-2));
        assert.notEqual(first.options, second.options);
        assert.equal(second.options.width, initial.width);
        assert.equal(second.options.handler, undefined);
        assert.equal(second.cmbApply.getValue(), scope.All);
        second.onPrimary(); assert.equal(callbacks, value === scope.Current ? 1 : 2);
        assert.equal(input.applyTo, value); assert.equal(input.width, 315);
        assert.deepEqual({...prototype}, initial);
    }
});
check('OK without changing scope calls SDK once with All and continuous properties', () => {
    const e = environment(), d = e.open();
    d.chAddLineNumbering.setValue(true); d.rbContinuous.setValue(true);
    d.spnStartAt.setValue(5); d.spnCountBy.setValue(3); d.spnFromText.setValue(-1);
    d.onPrimary();
    assert.equal(e.calls.length, 1); assert.equal(e.calls[0].type, scope.All);
    assert.equal(e.calls[0].props.Restart, restart.Continuous);
    assert.equal(e.calls[0].props.Start, 5); assert.equal(e.calls[0].props.CountBy, 3);
    assert.equal(e.calls[0].props.Distance, null); assert.equal(d.closed, true);
});
check('each selected scope and props reach SDK unchanged; reopen starts All', () => {
    const e = environment();
    for (const value of Object.values(scope)) {
        const d = e.open(); d.cmbApply.setValue(value); d.chAddLineNumbering.setValue(true);
        const settings = d.getSettings();
        d.getSettings = () => settings;
        d.onBtnClick({currentTarget: {attributes: {result: {value: 'ok'}}}});
        assert.equal(e.calls.at(-1).type, value); assert.equal(e.calls.at(-1).props, settings.props);
        assert.equal(e.open().cmbApply.getValue(), scope.All);
    }
    assert.equal(e.calls.length, 3);
});
check('Cancel after edits and window close do not apply; next open starts All', () => {
    const e = environment();
    for (const value of [scope.Current, scope.ToEnd]) {
        const d = e.open(); d.cmbApply.setValue(value); d.chAddLineNumbering.setValue(true);
        d.onBtnClick({currentTarget: {attributes: {result: {value: 'cancel'}}}});
        assert.equal(d.closed, true); assert.equal(e.open().cmbApply.getValue(), scope.All);
        const closed = e.open(); closed.cmbApply.setValue(value); closed.close();
    }
    assert.equal(e.calls.length, 0);
});
check('getter properties populate controls without retaining previous menu scope', () => {
    const e = environment(), props = new e.Props();
    props.put_Restart(restart.Continuous); props.put_Start(7); props.put_CountBy(2); props.put_Distance(0);
    e.setGetter(props); const d = e.open();
    assert.equal(d.chAddLineNumbering.getValue(), 'checked'); assert.equal(d.rbContinuous.getValue(), true);
    assert.equal(d.spnStartAt.getNumberValue(), 7); assert.equal(d.spnCountBy.getNumberValue(), 2);
    d.cmbApply.setValue(scope.Current); d.onPrimary();
    assert.equal(e.open().cmbApply.getValue(), scope.All);
});
check('legacy Toolbar keeps successful scope through reopen and Cancel', () => {
    const e = environment(), toolbar = e.DE.Controllers.Toolbar;
    toolbar._state = {linenum_apply: scope.All};
    toolbar.api = e.DE.Views.DocumentActions.api;
    const open = () => { toolbar.onLineNumbersSelect(null, {value: 5}); return e.windows.at(-1); };
    assert.equal(open().cmbApply.getValue(), scope.All);
    for (const value of [scope.Current, scope.ToEnd]) {
        const d = open(); d.cmbApply.setValue(value); d.chAddLineNumbering.setValue(true); d.onPrimary();
        assert.equal(toolbar._state.linenum_apply, value); assert.equal(e.calls.at(-1).type, value);
        const next = open(); assert.equal(next.cmbApply.getValue(), value);
        next.cmbApply.setValue(scope.All); next._handleInput('cancel');
        assert.equal(open().cmbApply.getValue(), value);
    }
    assert.equal(e.calls.length, 2);
});
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
