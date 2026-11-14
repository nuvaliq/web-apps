/* Run: node test/unit-tests/documenteditor/license-limits.cjs
 * License limit windows: "%1" of the limit messages is the product
 * name from the locale — the English default in code, the Russian name in ru.json; the limit window keeps
 * only "OK", the paid loader warning only "Close": no "Visit website", no sales e-mail, no publisher site.
 * Main.js does not load in vm: applyLicense and the "%1" statements are cut out of the source and run in vm on stubs;
 * the forms controller loads in vm as it is, its "%1" statements live in onLaunch and are cut out the same way.
 * Mobile: "%1" is About.text(t).textProductName (the "About" section of the mobile locale over its English default);
 * JSX does not load in vm, so applyLicense of Main.jsx and EN with About.text of About.jsx are cut out and run on stubs.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const readJson = file => JSON.parse(read(file));

const MAIN = 'apps/documenteditor/main/app/controller/Main.js';
const MAIN_LOCALES = 'apps/documenteditor/main/locale';
const FORMS = 'apps/documenteditor/forms/app/controller/ApplicationController.js';
const FORMS_LOCALES = 'apps/documenteditor/forms/locale';
const MOBILE = 'apps/documenteditor/mobile/src/controller/Main.jsx';
const MOBILE_ABOUT = 'apps/common/mobile/lib/view/About.jsx';
const MOBILE_LOCALES = 'apps/documenteditor/mobile/locale';

const NAME = {en: 'VibeOffice', ru: 'ВайбОфис'};
const PERCENT_KEYS = ['warnNoResources', 'warnNoLicenseUsers', 'textNoLicenseTitle', 'textNoResourcesTitle'];
const BRAND_TOKENS = ['{{COMPANY_NAME}}', '{{SALES_EMAIL}}', '{{PUBLISHER_URL}}', 'mailto:', 'buynow',
    'textBuyNow', 'textContactUs'];
const MOBILE_BRAND_TOKENS = ['__COMPANY_NAME__', '__SALES_EMAIL__', '__PUBLISHER_URL__', 'mailto:',
    'textBuyNow', 'textContactUs'];

/* Distinct values are enough: applyLicense only compares license types. */
const LICENSE = {};
['Error', 'Expired', 'Success', 'UnknownUser', 'Connections', 'ExpiredTrial', 'SuccessLimit', 'UsersCount',
    'ConnectionsOS', 'UsersCountOS', 'ExpiredLimited', 'ConnectionsLiveOS', 'ConnectionsLive', 'UsersViewCount',
    'UsersViewCountOS', 'NotBefore'].forEach((name, index) => { LICENSE[name] = index + 1; });
const LICENSE_MODE = {None: 0, Trial: 1, Developer: 2, Limited: 4};
/* Types that end in the limit window: not "limited renewed", not "read-only", not the b24 capacity guard. */
const LIMIT_WINDOW_TYPES = ['ConnectionsLiveOS', 'UsersViewCountOS', 'ConnectionsLive', 'UsersViewCount'];

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* From the match of `start` to the bracket that closes the first "{" after it. Strings and comments are skipped,
 * so braces in them ('{{SALES_EMAIL}}', `${…}`) do not count. */
function cutBlock(text, start) {
    const m = start.exec(text);
    assert.ok(m, 'source has ' + start);
    let depth = 0, opened = false;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
        const c = text[i];
        if (c === '\'' || c === '"' || c === '`') {
            for (i++; i < text.length && text[i] !== c; i++)
                if (text[i] === '\\') i++;
        } else if (c === '/' && text[i + 1] === '/') {
            i = text.indexOf('\n', i);
        } else if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2) + 1;
        } else if (c === '{') {
            depth++; opened = true;
        } else if (c === '}' && --depth === 0 && opened) {
            return text.slice(m.index + m[0].length - 1, i + 1);
        }
    }
    assert.fail('block ' + start + ' is not closed');
}

/* Plain copies of vm-realm values, for deepEqual. */
const plain = value => JSON.parse(JSON.stringify(value));
/* What a window button stands for: a string button is its value, an object button — its value or text. */
const buttonValues = buttons => Array.from(buttons || [], b => (typeof b === 'string' ? b : b.value !== undefined ? b.value : b.text));

/* The statements that fill "%1": `me.warnNoResources = (…).replace(/%1/g, …);` and the like. */
function percentStatements(source) {
    const statements = source.match(/^[ \t]*(?:me|this)\.\w+\s*=[^;\n]*\.replace\(\/%1\/g,[^;\n]*;[ \t]*$/gm) || [];
    const targets = statements.map(s => /(?:me|this)\.(\w+)\s*=/.exec(s)[1]);
    assert.deepEqual(targets.slice().sort(), PERCENT_KEYS.slice().sort(), '"%1" is filled in the four limit strings');
    return statements.join('\n');
}

/* Runs the "%1" statements on a controller with the given strings, as onLaunch does. */
function fillPercent(source, strings) {
    const controller = Object.assign({}, strings);
    vm.runInNewContext('(function () { var me = this;\n' + percentStatements(source) + '\n})', {}).call(controller);
    return controller;
}

/* Locale strings of a controller as Common.Locale puts them: "<prefix>.<key>" of the json. */
function localeStrings(json, prefix) {
    const strings = {};
    for (const [key, value] of Object.entries(json))
        if (key.startsWith(prefix + '.') && !key.slice(prefix.length + 1).includes('.'))
            strings[key.slice(prefix.length + 1)] = value;
    return strings;
}

/* The Russian name lives in ru.json only; other locales show the English default from code. */
function checkLocales(dir, fullKey) {
    for (const file of fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.json'))) {
        const json = readJson(path.join(dir, file));
        if (file === 'ru.json')
            assert.equal(json[fullKey], NAME.ru, dir + '/ru.json ' + fullKey);
        else
            assert.equal(json[fullKey], undefined, dir + '/' + file + ' must not define ' + fullKey);
    }
}

/* Globals of desktop applyLicense: Common.UI records the windows, window.open records what would be opened. */
function desktopStubs() {
    const log = {shown: [], opened: [], reported: []};
    const context = {
        Asc: {c_oLicenseResult: LICENSE, c_oLicenseMode: LICENSE_MODE},
        Common: {
            UI: {
                info: o => log.shown.push(['info', o]),
                warning: o => log.shown.push(['warning', o]),
                TooltipManager: {showTip: o => log.shown.push(['tip', o])}
            },
            NotificationCenter: {trigger() {}},
            Gateway: {reportWarning: (...args) => log.reported.push(args), sendInfo() {}}
        },
        window: {open: (...args) => { log.opened.push(args); return null; }}
    };
    return {context, log};
}

/* A controller in edit mode with the given license type over its strings. */
function controllerState(strings, licenseType, extra) {
    return Object.assign(Object.create(strings), {
        editorConfig: {mode: 'edit', customization: {}},
        appOptions: {isAnonymousSupport: true, user: {}, trialMode: 0, isEdit: true, canLiveView: true, canFillForms: true},
        _state: {licenseType: licenseType === undefined ? undefined : LICENSE[licenseType]},
        stackDisableActions: {length: () => 0},
        api: {asc_coAuthoringDisconnect() {}},
        disableEditing() {},
        disableLiveViewing() {}
    }, extra);
}

/* Desktop applyLicense cut out of the source, run on stubs. */
function runDesktopApply(fn, strings, licenseType, extra) {
    const {context, log} = desktopStubs();
    vm.runInNewContext('(' + fn + ')', context).call(controllerState(strings, licenseType, extra));
    return log;
}

/* Every button of a shown window is pressed: none may open a site or a mail client. */
function pressAll(options, opened) {
    if (typeof options.callback === 'function')
        for (const value of ['ok', 'close', 'buynow', 'contact', 'cancel', undefined])
            options.callback(value);
    assert.deepEqual(plain(opened), [], 'buttons open nothing');
}

const mainSource = read(MAIN);
const mainApply = 'function () ' + cutBlock(mainSource, /\bapplyLicense:\s*function\s*\(\)\s*\{/);

function mainController(lang) {
    const defaultName = /^[ \t]*textProductName:\s*'([^']*)'/m.exec(mainSource);
    assert.ok(defaultName, 'Main.js strings have textProductName');
    const strings = Object.assign({textProductName: defaultName[1]},
        localeStrings(readJson(MAIN_LOCALES + '/' + lang + '.json'), 'DE.Controllers.Main'));
    return fillPercent(mainSource, strings);
}

check('test_main_limit_messages_use_product_name', () => {
    assert.equal(/^[ \t]*textProductName:\s*'([^']*)'/m.exec(mainSource)?.[1], NAME.en,
        'English default of DE.Controllers.Main.textProductName is in code');
    checkLocales(MAIN_LOCALES, 'DE.Controllers.Main.textProductName');
    assert.ok(!mainSource.includes('{{COMPANY_NAME}}'), 'Main.js still has {{COMPANY_NAME}}');
    /* The tab title is not this name: it stays the build placeholder (the build sets its default). */
    assert.ok(/me\.defaultTitleText = '\{\{APP_TITLE_TEXT\}\}';/.test(mainSource), 'defaultTitleText keeps {{APP_TITLE_TEXT}}');

    for (const lang of ['en', 'ru']) {
        const locale = localeStrings(readJson(MAIN_LOCALES + '/' + lang + '.json'), 'DE.Controllers.Main');
        const me = mainController(lang);
        assert.equal(me.textProductName, NAME[lang], lang + ': product name');
        for (const key of PERCENT_KEYS) {
            assert.equal(me[key], locale[key].replace(/%1/g, NAME[lang]), lang + ': ' + key);
            assert.ok(!me[key].includes('%1'), lang + ': ' + key + ' has no "%1"');
        }
        assert.ok(me.warnNoResources.includes(NAME[lang]), lang + ': warnNoResources names the product');
        assert.equal(me.warnNoLicenseUsers.split(NAME[lang]).length - 1, 2, lang + ': warnNoLicenseUsers names the product twice');

        /* The window itself shows the filled strings. */
        const {shown} = runDesktopApply(mainApply, me, 'ConnectionsLiveOS');
        assert.equal(shown.length, 1, lang + ': one window');
        assert.equal(shown[0][1].title, me.textNoLicenseTitle, lang + ': title');
        assert.equal(shown[0][1].msg, me.warnNoLicenseUsers, lang + ': message');
    }
    assert.ok(mainController('ru').warnNoResources.startsWith('На сервере ВайбОфис '), 'ru: "На сервере ВайбОфис …"');
    assert.ok(mainController('en').warnNoResources.startsWith('The VibeOffice server '), 'en: "The VibeOffice server …"');
});

check('test_main_license_windows_have_no_buy_or_sales', () => {
    for (const token of BRAND_TOKENS)
        assert.ok(!mainSource.includes(token), 'Main.js still has ' + token);

    const me = mainController('ru');
    for (const type of LIMIT_WINDOW_TYPES) {
        const {shown, opened} = runDesktopApply(mainApply, me, type);
        assert.equal(shown.length, 1, type + ': one window');
        const [kind, options] = shown[0];
        assert.equal(kind, 'info', type + ': limit window');
        assert.deepEqual(buttonValues(options.buttons), ['ok'], type + ': only "OK"');
        assert.ok(options.primary === undefined || options.primary === 'ok', type + ': "OK" is primary');
        pressAll(options, opened);
    }

    /* The b24 capacity guard still hands these two to the host. */
    for (const type of ['ConnectionsOS', 'UsersCountOS']) {
        const {shown, reported} = runDesktopApply(mainApply, me, type);
        assert.deepEqual(shown, [], type + ': no window');
        assert.equal(reported.length, 1, type + ': reported to the host');
    }

    /* Paid loader warning: a custom loader without the extended branding license. */
    const {shown, opened} = runDesktopApply(mainApply, me, undefined, {
        editorConfig: {mode: 'edit', customization: {loaderName: 'Loader'}},
        appOptions: {isAnonymousSupport: true, user: {}, isEdit: true, isDesktopApp: false, canBrandingExt: false}
    });
    assert.equal(shown.length, 1, 'paid feature: one window');
    const [kind, options] = shown[0];
    assert.equal(kind, 'warning', 'paid feature: warning');
    assert.equal(options.title, me.textPaidFeature, 'paid feature: title');
    assert.equal(options.msg, me.textCustomLoader, 'paid feature: message');
    assert.deepEqual(buttonValues(options.buttons), ['close'], 'paid feature: only "Close"');
    if (options.buttons.some(b => typeof b === 'object'))
        assert.deepEqual(Array.from(options.buttons, b => b.caption), [me.textClose], 'paid feature: "Close" caption');
    pressAll(options, opened);
});

const formsSource = read(FORMS);

/* The forms controller as the page builds it: the language's json plays Common.Locale and goes over the defaults
 * in code; applyLicense runs with the globals of `context`. */
function loadForms(lang, context) {
    const DE = {Controllers: {ApplicationController:
        localeStrings(readJson(FORMS_LOCALES + '/' + lang + '.json'), 'DE.Controllers.ApplicationController')}};
    Object.assign(context, {DE, Backbone: {Controller: {extend: definition => definition}}, _: {assign: Object.assign},
        define: (dependencies, factory) => factory()});
    vm.runInNewContext(formsSource, context, {filename: FORMS});
    return DE.Controllers.ApplicationController;
}

function runFormsApply(lang, licenseType) {
    const {context, log} = desktopStubs();
    const controller = loadForms(lang, context);
    const filled = fillPercent(formsSource, controller);
    controller.applyLicense.call(controllerState(filled, licenseType));
    return Object.assign(log, {controller, filled});
}

check('test_forms_limit_messages_use_product_name', () => {
    for (const token of BRAND_TOKENS)
        assert.ok(!formsSource.includes(token), 'ApplicationController.js still has ' + token);
    assert.equal(loadForms('en', desktopStubs().context).textProductName, NAME.en,
        'English default of DE.Controllers.ApplicationController.textProductName is in code');
    checkLocales(FORMS_LOCALES, 'DE.Controllers.ApplicationController.textProductName');

    for (const lang of ['en', 'ru']) {
        for (const type of LIMIT_WINDOW_TYPES) {
            const {shown, opened, controller, filled} = runFormsApply(lang, type);
            assert.equal(filled.textProductName, NAME[lang], lang + ': product name');
            for (const key of PERCENT_KEYS) {
                assert.equal(filled[key], controller[key].replace(/%1/g, NAME[lang]), lang + ': ' + key);
                assert.ok(!filled[key].includes('%1'), lang + ': ' + key + ' has no "%1"');
            }
            assert.equal(filled.warnNoLicenseUsers.split(NAME[lang]).length - 1, 2,
                lang + ': warnNoLicenseUsers names the product twice');

            /* The same window as in the editor: filled strings, only "OK", nothing opens. */
            assert.equal(shown.length, 1, lang + ' ' + type + ': one window');
            const [kind, options] = shown[0];
            assert.equal(kind, 'info', lang + ' ' + type + ': limit window');
            assert.equal(options.title, filled.textNoLicenseTitle, lang + ' ' + type + ': title');
            assert.equal(options.msg, filled.warnNoLicenseUsers, lang + ' ' + type + ': message');
            assert.deepEqual(buttonValues(options.buttons), ['ok'], lang + ' ' + type + ': only "OK"');
            assert.ok(options.primary === undefined || options.primary === 'ok', lang + ' ' + type + ': "OK" is primary');
            pressAll(options, opened);
        }

        /* The b24 capacity guard still hands these two to the host. */
        for (const type of ['ConnectionsOS', 'UsersCountOS']) {
            const {shown, reported} = runFormsApply(lang, type);
            assert.deepEqual(shown, [], lang + ' ' + type + ': no window');
            assert.equal(reported.length, 1, lang + ' ' + type + ': reported to the host');
        }
    }
    assert.ok(runFormsApply('ru', 'ConnectionsOS').filled.warnNoResources.startsWith('На сервере ВайбОфис '),
        'ru: "На сервере ВайбОфис …"');
    assert.ok(runFormsApply('en', 'ConnectionsOS').filled.warnNoResources.startsWith('The VibeOffice server '),
        'en: "The VibeOffice server …"');
});

const mobileSource = read(MOBILE);
const mobileApply = 'function () ' + cutBlock(mobileSource, /^[ \t]*applyLicense\s*\(\)\s*\{/m);
const aboutSource = read(MOBILE_ABOUT);

/* Mobile applyLicense on stubs: i18next `t` over the language's json, the real EN and About.text, f7 dialogs
 * recorded; the edit features are supported, so the "Community" warning is not in the way. */
function runMobileApply(lang, licenseType, customization) {
    const json = readJson(MOBILE_LOCALES + '/' + lang + '.json');
    const t = key => {
        const value = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), json);
        return value === undefined ? key : value;
    };
    const dialogs = [], opened = [];
    const context = {
        Asc: {c_oLicenseResult: LICENSE, c_oLicenseMode: LICENSE_MODE},
        Common: {Notifications: {trigger() {}}},
        f7: {dialog: {create: o => { dialogs.push(o); return {open() {}}; }}},
        EditorUIController: {isSupportEditFeature: () => true},
        LocalStorage: {getItem: () => null, setItem() {}},
        window: {open: (...args) => { opened.push(args); return null; }}
    };
    vm.runInNewContext('const EN = ' + cutBlock(aboutSource, /^const EN = \{/m) + ';\nconst About = {};\n'
        + 'About.text = t => ' + cutBlock(aboutSource, /^About\.text = t => \{/m) + ';\nthis.About = About;',
        context, {filename: MOBILE_ABOUT});
    const appOptions = {config: {mode: 'edit', user: {}, customization: customization || {}}, isAnonymousSupport: true,
        trialMode: 0, canLiveView: true, isDesktopApp: false, canBrandingExt: false};
    vm.runInNewContext('(' + mobileApply + ')', context, {filename: MOBILE}).call({
        props: {t, storeAppOptions: appOptions},
        _state: {licenseType: licenseType === undefined ? undefined : LICENSE[licenseType]},
        api: {asc_coAuthoringDisconnect() {}, asc_SetFastCollaborative() {}}
    });
    return {dialogs, opened, main: json.Main};
}

/* A dialog button only closes the dialog: text and nothing else, no onClick. */
function checkCloseOnly(buttons, text, label) {
    assert.deepEqual(Array.from(buttons || [], b => Object.keys(b).sort().join()), ['text'], label + ': one plain button');
    assert.equal(buttons[0].text, text, label + ': button text');
}

check('test_mobile_limit_messages_use_product_name', () => {
    for (const token of MOBILE_BRAND_TOKENS)
        assert.ok(!mobileSource.includes(token), 'Main.jsx still has ' + token);
    assert.ok(/About\.text\(t\)\.textProductName/.test(mobileApply), 'applyLicense takes the name from About.text(t)');
    assert.equal(readJson(MOBILE_LOCALES + '/ru.json').About.textProductName, NAME.ru, 'mobile ru.json About.textProductName');

    const cases = [
        ['ConnectionsOS', 'textNoResourcesTitle', 'warnNoResources'],
        ['UsersCountOS', 'textNoLicenseTitle', 'warnNoLicenseUsers']
    ].concat(LIMIT_WINDOW_TYPES.map(type => [type, 'textNoLicenseTitle', 'warnNoLicenseUsers']));
    for (const lang of ['en', 'ru']) {
        for (const [type, titleKey, textKey] of cases) {
            const {dialogs, opened, main} = runMobileApply(lang, type);
            const label = lang + ' ' + type;
            assert.equal(dialogs.length, 1, label + ': one dialog');
            assert.equal(dialogs[0].title, main[titleKey].replace(/%1/g, NAME[lang]), label + ': title');
            assert.equal(dialogs[0].text, main[textKey].replace(/%1/g, NAME[lang]), label + ': text');
            assert.ok(dialogs[0].text.includes(NAME[lang]) && !dialogs[0].text.includes('%1'), label + ': names the product');
            checkCloseOnly(dialogs[0].buttons, main.textOk, label);
            assert.deepEqual(plain(opened), [], label + ': nothing opens');
        }
        assert.ok(runMobileApply(lang, 'ConnectionsOS').dialogs[0].text.startsWith(
            lang === 'ru' ? 'На сервере ВайбОфис ' : 'The VibeOffice server '), lang + ': warnNoResources wording');

        /* Paid loader warning: a custom loader without the extended branding license. */
        const {dialogs, opened, main} = runMobileApply(lang, undefined, {loaderName: 'Loader'});
        assert.equal(dialogs.length, 1, lang + ' paid feature: one dialog');
        assert.equal(dialogs[0].title, main.textPaidFeature, lang + ' paid feature: title');
        assert.equal(dialogs[0].text, main.textCustomLoader, lang + ' paid feature: text');
        checkCloseOnly(dialogs[0].buttons, main.textClose, lang + ' paid feature');
        assert.deepEqual(plain(opened), [], lang + ' paid feature: nothing opens');
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
