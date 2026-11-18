/* Browser fixture for the presentation compact header with a stock layout stand-in. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {ROOT, PE_APP, SHARED_MODULES, methodText, stockSource} = require('../acceptance/mode-harness.cjs');

function launch() {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const executablePath = process.env.CHROMIUM_PATH;
    return chromium.launch(executablePath ? {headless: true, executablePath} : {headless: true, channel: 'chrome'});
}

function addScript(page, file) {
    return page.addScriptTag({content: fs.readFileSync(file, 'utf8')});
}

const HTML = `<!doctype html>
    <style>html, body {height: 100%; margin: 0}
    *, *::before, *::after {animation: none !important; transition: none !important}
    #area_id {position: absolute; top: 200px; left: 10px}
    </style>
    <div id="viewport">
        <div id="toolbar"><div class="toolbar"></div></div>
        <div id="editor_sdk"><textarea id="area_id"></textarea></div>
        <div id="statusbar"></div>
    </div>`;

function installEnvironment({options, locale, sdkFocusCapture}) {
    window.PE = {Views: {}, Controllers: {}};
    window.Common = {Views: {}, UI: {Themes: {available: () => true}}, Utils: {}};
    for (const [key, value] of Object.entries(locale)) {
        const parts = key.split('.');
        if (!['PE', 'Common'].includes(parts[0])) continue;
        const prop = parts.pop();
        const owner = parts.reduce((obj, part) => obj[part] ||= {}, window);
        owner[prop] = value;
    }
    window.define = (deps, factory) => factory(...deps.map(dep => {
        const name = dep.split('/').pop();
        return dep.startsWith('common/') ? Common.UI.Compact?.[name] : PE.Views[name];
    }));
    Common.NotificationCenter = Object.assign({}, Backbone.Events);
    window.requestCount = 0;
    Common.Gateway = {requestEditRights: () => { requestCount++; }};
    window.Asc = {c_oAscRestrictionType: {View: 128}};
    window.keyOwner = {engine: true, enabled: true, modal: false};
    Common.Utils.ModalWindow = {isVisible: () => keyOwner.modal};

    const htmlArea = document.getElementById('area_id');
    const callbacks = new Map();
    const api = {
        asc_registerCallback(name, fn) {
            if (!callbacks.has(name)) callbacks.set(name, []);
            callbacks.get(name).push(fn);
        },
        asc_enableKeyEvents(on, fromInput) {
            keyOwner.engine = on;
            if (fromInput) return;
            keyOwner.enabled = on;
            if (on && document.activeElement !== htmlArea) htmlArea.focus();
        },
        asc_addRestriction() {},
        asc_removeRestriction() {},
        Resize() {}
    };
    window.fireSdk = (name, ...args) => (callbacks.get(name) || []).forEach(fn => fn(...args));

    // Model the desktop capture focus rules of SDK common/text_input.js and the editor's own input field.
    if (sdkFocusCapture) document.addEventListener('focus', event => {
        if (!keyOwner.enabled) return;
        const target = event.target;
        if (target === htmlArea) {
            api.asc_enableKeyEvents(true, true);
            return;
        }
        const ancestors = [];
        for (let el = target; el && ancestors.length < 3; el = el.parentElement) ancestors.push(el);
        const attribute = name => ancestors.map(el => el.getAttribute(name)).find(value => value !== null);
        let input = attribute('oo_editor_input');
        const keyboard = attribute('oo_editor_keyboard');
        if (!input && !keyboard && ancestors.some(el => el.matches('.canfocused, .dropdown-menu, .dropdown-toggle, .dropdown-submenu')))
            input = 'true';
        if (keyboard === 'true') input = undefined;
        const editable = target.matches('input, textarea, div[contenteditable="true"]');
        if (target.matches('iframe') || input === 'true' || (editable && input !== 'false')) {
            api.asc_enableKeyEvents(false, true);
        } else {
            htmlArea.focus();
            api.asc_enableKeyEvents(true, true);
        }
    }, true);

    const reasons = [];
    const stackDisableActions = {length: () => reasons.length, get: i => reasons[i]};
    Common.NotificationCenter.on('editing:disable', (disable, options, type) => {
        const i = reasons.findIndex(reason => reason.type === type);
        if (i >= 0) reasons.splice(i, 1);
        if (disable) reasons.push({disable, options, type});
    });
    const panels = {toolbar: {el: $('#toolbar'), height: 88}, statusbar: {el: $('#statusbar'), height: 25}};
    const controllers = {
        Main: {
            api, appOptions: options, _state: {}, stackDisableActions,
            editorConfig: {ui: {shell: 'modern'}}, editRequest: null,
            document: {title: 'Quarterly presentation with a very long title '.repeat(20).trim() + '.pptx'},
            getApplication: () => ({getController: PE.getController}),
            textEditRequestFailed: PE.Controllers.Main.textEditRequestFailed
        },
        LeftMenu: {requestEditRightsText: PE.Controllers.LeftMenu.requestEditRightsText},
        Statusbar: {statusbar: {btnPreview: {isDisabled: () => false, isVisible: () => true}}},
        Viewport: {api, viewport: {
            vlayout: {panels: Object.values(panels), getItem: name => panels[name], doLayout() {}},
            hlayout: {doLayout() {}}
        }}
    };
    PE.getController = name => controllers[name] || null;
    window.main = controllers.Main;
}

async function open(browser, {appOptions = {}, cssPath, locale = 'ru', width = 1280, sdkFocusCapture = true} = {}) {
    if (!cssPath || !path.isAbsolute(cssPath) || !fs.existsSync(cssPath))
        throw new Error('Set COMPACT_CSS_PRESENTATIONEDITOR to the absolute path of the compiled presentation app.css');
    const page = await browser.newPage({viewport: {width, height: 720}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'warning') errors.push(msg.text()); });
    try {
        await page.setContent(HTML);
        await page.addStyleTag({path: cssPath});
        for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js', 'vendor/backbone/backbone.js'])
            await addScript(page, path.join(ROOT, file));
        await page.evaluate(installEnvironment, {
            options: Object.assign({
                isEdit: false, canEdit: true, canRequestEditRights: true,
                canDownload: true, canUseHistory: true, canRequestSharingSettings: true
            }, appOptions),
            locale: JSON.parse(fs.readFileSync(path.join(PE_APP, '..', 'locale', locale + '.json'), 'utf8')),
            sdkFocusCapture
        });
        for (const name of ['Icons', 'MenuModel', 'AdapterKit', 'MenuBar', 'StockBridge', 'CompactModes',
            'SlideActions', 'CompactMenuAdapter', 'CompactShell'])
            await addScript(page, SHARED_MODULES[name] || path.join(PE_APP, 'view', name + '.js'));

        const mainFile = 'controller/Main.js';
        const mainSource = stockSource(mainFile);
        const methods = ['onProcessRightsChange', 'markEditRequest', 'isEditRequestWaiting', 'answerEditRequest',
            'cancelEditRequestWait', 'editRequestStatus'];
        await page.addScriptTag({content: 'Object.assign(main, {' +
            methods.map(name => name + ': ' + methodText(mainSource, name, mainFile)).join(',\n') + '});'});
        await page.evaluate(() => {
            window.shell = PE.Views.CompactShell;
            shell.create();
            document.getElementById('area_id').focus();
        });
        page.errors = errors;
        return page;
    } catch (error) {
        await page.close();
        throw error;
    }
}

module.exports = {launch, open};
