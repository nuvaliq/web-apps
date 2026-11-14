/* Run: node test/unit-tests/documenteditor/text-to-table-autofit.cjs
 * Real AMD UI contracts; UI doubles do not verify SDK layout or saved documents.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const VIEW = path.resolve(__dirname, '../../../apps/documenteditor/main/app/view');
const autoFit = {Fixed: 1, Content: 2, Window: 3};
const units = ['cm', 'pt', 'inch'];
const sourceView = process.env.TEXT_TO_TABLE_UI_SOURCE || VIEW;

function properties(type = autoFit.Fixed, fit = -1, separatorType = 1, separator = 0) {
    let size = [3, 2];
    return {
        get_Size: () => size,
        put_ColsCount(value) { size = [size[0], value]; return size; },
        get_AutoFitType: () => type,
        put_AutoFitType(value) { type = value; },
        get_Fit: () => fit,
        put_Fit(value) { fit = value; },
        get_SeparatorType: () => separatorType,
        put_SeparatorType(value) { separatorType = value; return size; },
        get_Separator: () => separator,
        put_Separator(value) { separator = value; separatorType = 3; return size; }
    };
}

function environment(unit = 'cm', view = sourceView) {
    const DE = {Views: {}, Controllers: {}};
    const windows = [], conversions = [], notifications = [], toMM = [], groups = new Map();
    const chain = {find() { return this; }, on() { return this; }};
    const settings = new Map();
    const dependencies = [];
    function Window(options) { this.initialize(options); windows.push(this); }
    Window.prototype = {
        initialize(options) { this.options = Object.assign({}, options); },
        render() {}, show() { this.render(); }, close() { this.closed = true; },
        getChild() { return chain; }
    };
    Window.extend = function (definition) {
        function Dialog(options) { Window.call(this, options); }
        Dialog.prototype = Object.assign(Object.create(Window.prototype), definition);
        return Dialog;
    };
    function Control(options) { this.options = options; this.value = options.value; this.events = {}; }
    Control.prototype = {
        on(name, fn) { this.events[name] = fn; return this; },
        setDisabled(value) { this.disabled = value; }, setDefaultUnit() {}, setStep() {}, focus() {},
        setValue(value, silent) {
            this.value = value;
            if (!silent && this.events.change) this.events.change(this, value);
        },
        getValue() { return this.value; },
        getNumberValue() { return this.value === 'Auto' ? -1 : Number(this.value); }
    };
    function Element() { this.inputValue = ''; }
    Element.prototype = {
        addClass() { return this; }, on() { return this; }, html() { return this; },
        find() { return new Element(); }, width() {}, attr() { return this; },
        removeAttr() { return this; }, toggleClass() { return this; }, focus() {},
        val(value) {
            if (value === undefined) return this.inputValue;
            this.inputValue = value;
            return this;
        }
    };
    function BaseView() {}
    BaseView.prototype = {
        initialize(options) {
            this.options = Object.assign({}, this.options, options);
            this.$el = new Element();
            this.events = {};
        },
        on: Control.prototype.on,
        trigger(name, ...args) { if (this.events[name]) this.events[name](...args); }
    };
    BaseView.extend = function (definition) {
        function View(options) { this.initialize(options); }
        View.prototype = Object.assign(Object.create(this.prototype), definition);
        View.extend = BaseView.extend;
        return View;
    };
    function RadioBox(options) {
        Control.call(this, options);
        if (!groups.has(options.name)) groups.set(options.name, []);
        groups.get(options.name).push(this);
        this.setValue(!!options.checked, true);
    }
    RadioBox.prototype = Object.assign(Object.create(Control.prototype), {
        setValue(value, silent) {
            if (value) groups.get(this.options.name).forEach(radio => { radio.value = false; });
            Control.prototype.setValue.call(this, value, silent);
        }
    });
    const Common = {
        Views: {AdvancedSettingsWindow: Window},
        UI: {BaseView, MetricSpinner: Control, RadioBox, InputField: Control},
        Utils: {InternalSettings: {get: key => settings.get(key), set: (key, value) => settings.set(key, value)},
            String: {parseFloat}},
        NotificationCenter: {trigger(...args) { notifications.push(args); }}
    };
    const context = {DE, window: {DE, Common}, Common, $: () => new Element(),
        Asc: {c_oAscTextToTableAutoFitType: autoFit},
        Backbone: {Controller: {extend: definition => definition}},
        _: {extend: Object.assign, bind: (fn, owner) => fn.bind(owner), template: text => () => text},
        setTimeout(fn) { fn(); }, define(deps, factory) {
            dependencies.push(...deps);
            return factory();
        }};
    vm.createContext(context);
    const metricsFile = path.resolve(VIEW, '../../../../common/main/lib/util/utils.js');
    const utils = fs.readFileSync(metricsFile, 'utf8');
    const metricsStart = utils.indexOf('    var metrics = new (function () {');
    const metricsEnd = utils.indexOf('    Common.Utils.Metric =', metricsStart);
    assert.ok(metricsStart >= 0 && metricsEnd > metricsStart);
    vm.runInContext(utils.slice(metricsStart, metricsEnd) + '\nCommon.Utils.Metric = metrics;', context,
        {filename: metricsFile});
    Common.Utils.Metric.setCurrentMetric(Common.Utils.Metric.c_MetricUnits[unit]);
    const realToMM = Common.Utils.Metric.fnRecalcToMM;
    Common.Utils.Metric.fnRecalcToMM = value => { toMM.push(value); return realToMM(value); };
    const spinnerFile = path.resolve(VIEW, '../../../../common/main/lib/component/MetricSpinner.js');
    vm.runInContext(fs.readFileSync(spinnerFile, 'utf8'), context, {filename: spinnerFile});
    for (const file of ['TextToTableDialog.js', 'DocumentActions.js', '../controller/Toolbar.js']) {
        const filename = path.resolve(view, file);
        vm.runInContext(fs.readFileSync(filename, 'utf8'), context, {filename});
    }
    let props = properties();
    const api = new Proxy({
        asc_PreConvertTextToTable() { return props; },
        asc_ConvertTextToTable(value) { conversions.push(value); }
    }, {get(target, key) {
        if (!(key in target)) throw Error('Unexpected SDK access: ' + String(key));
        return target[key];
    }});
    DE.Views.DocumentActions.api = api;
    DE.Controllers.Toolbar.api = api;
    DE.Controllers.Toolbar.toolbar = {};
    function dialog(options = {}) {
        const d = new DE.Views.TextToTableDialog(Object.assign({props: properties()}, options));
        d.show();
        return d;
    }
    return {DE, dialog, conversions, notifications, toMM, settings, windows, dependencies, metric: Common.Utils.Metric,
        setProps(value) { props = value; }};
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.stack); failed++; }
}
function select(dialog, type) {
    const radios = {[autoFit.Fixed]: dialog.rbFixed, [autoFit.Content]: dialog.rbContents,
        [autoFit.Window]: dialog.rbWindow};
    radios[type].setValue(true);
    assert.equal(dialog.spnWidth.disabled, type !== autoFit.Fixed);
}
function fitIs(dialog, type, width) {
    const result = dialog.getSettings();
    assert.equal(result, dialog.props);
    assert.equal(result.get_AutoFitType(), type);
    assert.equal(result.get_Fit(), width);
}
function open(e, caller) {
    if (caller === 'compact') e.DE.Views.DocumentActions.textToTable();
    else e.DE.Controllers.Toolbar.onInsertTableClick(null, {value: 'convert'});
    return e.windows.at(-1);
}
function captureDialog(e, caller) {
    let options, shown = 0;
    e.DE.Views.TextToTableDialog = function (value) {
        options = value;
        this.show = () => { shown++; };
    };
    open(e, caller);
    assert.equal(shown, 1);
    return options;
}
for (const unit of units) {
    check('fixed_auto_matches_original_metric_' + unit, () => {
        const e = environment(unit);
        const d = e.dialog({defaultAutoFitType: autoFit.Content});
        assert.equal(d.rbContents.getValue(), true);
        select(d, autoFit.Fixed);
        assert.equal(d.spnWidth.getValue(), 'Auto');
        assert.equal(d.spnWidth.getNumberValue(), -1);
        const expected = e.metric.fnRecalcToMM(-1);
        fitIs(d, autoFit.Fixed, expected);
        if (process.env.TEXT_TO_TABLE_UI_BASE_SOURCE) {
            const base = environment(unit, process.env.TEXT_TO_TABLE_UI_BASE_SOURCE), original = base.dialog();
            assert.equal(original.getSettings().get_Fit(), d.props.get_Fit());
        }
    });
    check('fixed_number_matches_base_' + unit, () => {
        for (const width of [25.4, 50.8]) {
            const e = environment(unit), d = e.dialog({props: properties(autoFit.Fixed, width),
                defaultAutoFitType: autoFit.Content});
            select(d, autoFit.Fixed);
            const input = d.spnWidth.getNumberValue();
            const expected = e.metric.fnRecalcToMM(input);
            fitIs(d, autoFit.Fixed, expected);
            assert.ok(Math.abs(expected - width) < 0.03);
            if (process.env.TEXT_TO_TABLE_UI_BASE_SOURCE) {
                const base = environment(unit, process.env.TEXT_TO_TABLE_UI_BASE_SOURCE);
                const original = base.dialog({props: properties(autoFit.Fixed, width)});
                assert.equal(original.getSettings().get_Fit(), expected);
            }
        }
    });
    check('content_and_window_preserve_original_fit_' + unit, () => {
        for (const fit of [-1, -10, 42]) for (const type of [autoFit.Content, autoFit.Window]) {
            const e = environment(unit), d = e.dialog({props: properties(autoFit.Fixed, fit)});
            select(d, type);
            fitIs(d, type, fit);
            assert.deepEqual(e.toMM, []);
        }
    });
    check('real_spinner_keeps_auto_after_render_metric_switch_' + unit, () => {
        const e = environment('cm'), d = e.dialog({defaultAutoFitType: autoFit.Content});
        e.metric.setCurrentMetric(e.metric.c_MetricUnits[unit]);
        d.afterRender();
        select(d, autoFit.Fixed);
        assert.equal(d.spnWidth.getNumberValue(), -1);
        assert.equal(d.spnWidth.getValue(), 'Auto');
        fitIs(d, autoFit.Fixed, e.metric.fnRecalcToMM(-1));
    });
    check('final_radio_choice_wins_' + unit, () => {
        const e = environment(unit), d = e.dialog({props: properties(autoFit.Fixed, 42)});
        const input = {cm: 3, pt: 36, inch: 1}[unit];
        d.spnWidth.setValue(input);
        select(d, autoFit.Fixed);
        const width = e.metric.fnRecalcToMM(input);
        fitIs(d, autoFit.Fixed, width);
        select(d, autoFit.Content);
        fitIs(d, autoFit.Content, width);
        select(d, autoFit.Window);
        fitIs(d, autoFit.Window, width);
        d.spnWidth.setValue('Auto');
        select(d, autoFit.Fixed);
        fitIs(d, autoFit.Fixed, e.metric.fnRecalcToMM(-1));
    });
}
check('caller_props_without_default_are_respected', () => {
    const e = environment();
    for (const type of Object.values(autoFit)) {
        const d = e.dialog({props: properties(type)});
        assert.equal(d.rbFixed.getValue(), type === autoFit.Fixed);
        assert.equal(d.rbContents.getValue(), type === autoFit.Content);
        assert.equal(d.rbWindow.getValue(), type === autoFit.Window);
        assert.equal(d.spnWidth.disabled, type !== autoFit.Fixed);
    }
});
check('explicit_default_does_not_leak_to_next_dialog', () => {
    const e = environment();
    assert.equal(e.dialog({defaultAutoFitType: autoFit.Content}).rbContents.getValue(), true);
    assert.equal(e.dialog({props: properties(autoFit.Window)}).rbWindow.getValue(), true);
});
check('rows_cols_separator_preserved', () => {
    for (const [separatorType, separator] of [[1, 0], [2, 0], [3, 59], [3, 124]]) {
        const e = environment(), props = properties(autoFit.Fixed, 12, separatorType, separator);
        const d = e.dialog({props});
        assert.equal(d.spnColumns.getNumberValue(), 2);
        assert.equal(d.spnRows.getNumberValue(), 3);
        d.spnColumns.setValue(5);
        select(d, autoFit.Content);
        const result = d.getSettings();
        assert.deepEqual(result.get_Size(), [3, 5]);
        assert.equal(result.get_SeparatorType(), separatorType);
        assert.equal(result.get_Separator(), separator);
        if (separator === 124) assert.equal(e.settings.get('de-text-to-table-separator'), '|');
    }
});
check('cancel_does_not_apply', () => {
    const e = environment(), props = properties(autoFit.Fixed, 42), calls = [];
    const d = e.dialog({props, handler: (...args) => calls.push(args)});
    select(d, autoFit.Content);
    d.onDlgBtnClick('cancel');
    assert.equal(d.closed, true);
    assert.deepEqual(calls, []);
    assert.equal(props.get_AutoFitType(), autoFit.Fixed);
    assert.equal(props.get_Fit(), 42);
});
for (const caller of ['compact', 'toolbar']) {
    check(caller + '_defaults_to_content', () => {
        const e = environment(), props = properties(autoFit.Fixed, 50);
        e.setProps(props);
        const options = captureDialog(e, caller);
        assert.equal(options.props, props);
        assert.equal(options.defaultAutoFitType, autoFit.Content);
        assert.equal(e.conversions.length, 0);
    });
    check(caller + '_ok_directly_converts_once', () => {
        const e = environment(), options = captureDialog(e, caller), props = properties(autoFit.Content, -1);
        options.handler('ok', props);
        assert.deepEqual(e.conversions, [props]);
        assert.equal(e.notifications.length, 1);
        assert.equal(e.notifications[0][0], 'edit:complete');
        assert.equal(e.notifications[0][1], caller === 'toolbar' ? e.DE.Controllers.Toolbar.toolbar : undefined);
    });
    check(caller + '_cancel_calls_no_convert', () => {
        const e = environment(), options = captureDialog(e, caller);
        options.handler('cancel');
        assert.deepEqual(e.conversions, []);
        assert.equal(e.notifications.length, 1);
    });
    check(caller + '_final_settings_reach_direct_api', () => {
        for (const type of Object.values(autoFit)) for (const unit of units) {
            const e = environment(unit), props = properties(autoFit.Fixed, 42);
            e.setProps(props);
            const d = open(e, caller);
            assert.equal(d.rbContents.getValue(), true);
            select(d, type);
            const input = {cm: 3, pt: 36, inch: 1}[unit];
            if (type === autoFit.Fixed) d.spnWidth.setValue(input);
            d.onPrimary();
            assert.equal(d.closed, true);
            assert.deepEqual(e.conversions, [props]);
            assert.equal(props.get_AutoFitType(), type);
            assert.equal(props.get_Fit(), type === autoFit.Fixed ? e.metric.fnRecalcToMM(input) : 42);
            assert.equal(e.notifications.length, 1);
        }
    });
}
check('no_adapter_or_builder_command_dependency', () => {
    const e = environment();
    assert.ok(!e.dependencies.some(dep => /TextToTableConversion/.test(dep)));
    for (const file of ['DocumentActions.js', '../controller/Toolbar.js']) {
        const source = fs.readFileSync(path.resolve(sourceView, file), 'utf8');
        const start = file === 'DocumentActions.js' ? source.indexOf('textToTable: function') : source.indexOf("item.value == 'convert'");
        assert.ok(start >= 0);
        const body = source.slice(start, start + 1100);
        assert.doesNotMatch(body, /callCommand|callMethod|tblApply|TextToTableConversion/);
    }
});
check('toolbar_availability_follows_selected_text', () => {
    const e = environment(), toolbar = e.DE.Controllers.Toolbar, disabled = [];
    const menu = {items: Array.from({length: 5}, () => ({setDisabled(value) { disabled.push(value); }}))};
    for (const text of [null, '', 'some text']) {
        toolbar.api.asc_GetSelectedText = () => text;
        toolbar.onInsertTableShow(menu);
    }
    assert.deepEqual(disabled, [true, true, false]);
});
check('toolbar_disconnected_api_does_not_convert', () => {
    const e = environment(), options = captureDialog(e, 'toolbar');
    e.DE.Controllers.Toolbar.api = null;
    options.handler('ok', properties());
    assert.deepEqual(e.conversions, []);
    assert.equal(e.notifications[0][0], 'edit:complete');
});
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
