/* Run: node test/unit-tests/documenteditor/help-url.cjs
 * Help goes to the helpdesk by interface language: DE.Views.DocumentActions.helpUrl(lang), used by
 * "File -> Help" and F1; "Suggest a feature" is gone. The compact "Editor help" item opens the helpdesk
 * article on documents: the Russian article for Russian, the English one for every other language, one
 * pair of addresses (HELP_URL). The compact "Keyboard shortcuts" item opens the page of the help that ships
 * with the editor in the interface language, English when there is none.
 * Main.js does not load in vm, its checks read the source.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const ACTIONS = path.join(ROOT, 'apps/documenteditor/main/app/view/DocumentActions.js');
const FILE_MENU = path.join(ROOT, 'apps/documenteditor/main/app/view/FileMenu.js');
const LEFT_MENU = path.join(ROOT, 'apps/documenteditor/main/app/controller/LeftMenu.js');
const MAIN = path.join(ROOT, 'apps/documenteditor/main/app/controller/Main.js');
const HELP_DIR = path.join(ROOT, 'apps/documenteditor/main/resources/help');
const RU = 'https://helpdesk.bitrix24.ru/';
const COM = 'https://helpdesk.bitrix24.com/';
const ARTICLE_RU = 'https://helpdesk.bitrix24.ru/open/19629424/';
const ARTICLE_EN = 'https://helpdesk.bitrix24.com/open/20606316/';

let lang = 'en';
const opened = [];
const DE = {Views: {}, Controllers: {}, getController: name => (name === 'Main' ? {appOptions: {}} : null)};
const context = {
    DE,
    window: {DE, open: (...args) => { opened.push(args); return null; }},
    _: {extend: Object.assign},
    Common: {
        Locale: {getCurrentLanguage: () => lang},
        NotificationCenter: {trigger() {}, on() {}},
        Utils: {}
    },
    define: (dependencies, factory) => factory({})
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(ACTIONS, 'utf8'), context, {filename: ACTIONS});
const da = DE.Views.DocumentActions;

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}
/* assert.match on a whole source file prints the file; report the pattern instead. */
function has(source, pattern, message) {
    assert.ok(pattern.test(source), message || 'source matches ' + pattern);
}

/* The Help section of sections() with nothing available: no SDK methods, the shell can use nothing. */
function helpGroup() {
    da.api = {};
    da.shell = new Proxy({}, {get: () => () => false});
    const group = da.sections().find(g => g.k === 'help');
    assert.ok(group, 'Help group exists');
    assert.equal(group.t, da.textHelp);
    return group;
}

check('test_help_url_ru_goes_to_ru', () => {
    assert.equal(typeof da.helpUrl, 'function');
    for (const value of ['ru', 'RU', 'ru-ru', 'ru-RU', 'ru_RU'])
        assert.equal(da.helpUrl(value), RU, value);
});

check('test_help_url_other_langs_go_to_com', () => {
    for (const value of ['en', 'de', 'kk', 'be', 'uk', 'pt-br', 'zh', 'rus', 'run', 'en-ru', '', null, undefined])
        assert.equal(da.helpUrl(value), COM, String(value));
});

/* The menu item of the Help section by key, run in the interface language given. */
function runHelpItem(k, value) {
    const item = helpGroup().items.find(it => it && it.k === k);
    assert.ok(item, k + ' exists');
    lang = value;
    opened.length = 0;
    item.run();
    return opened.slice();
}

check('help opens the article for Russian', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(da.HELP_URL)), {ru: ARTICLE_RU, en: ARTICLE_EN}, 'one pair of addresses');
    for (const value of ['ru', 'ru-RU', 'ru_RU'])
        assert.deepEqual(runHelpItem('help.help', value), [[ARTICLE_RU, '_blank']], value);
});

check('english help opens the english article', () => {
    for (const value of ['en', 'en-US', 'en-GB'])
        assert.deepEqual(runHelpItem('help.help', value), [[ARTICLE_EN, '_blank']], value);
});

check('other languages open the english article', () => {
    for (const value of ['de', 'kk', 'uk', 'be', 'pt-br', 'zh', 'rus', '', undefined])
        assert.deepEqual(runHelpItem('help.help', value), [[ARTICLE_EN, '_blank']], String(value));
    /* The rule is the one constant: no other address of the article in the bundle source. */
    const source = fs.readFileSync(ACTIONS, 'utf8');
    assert.equal(source.split('19629424').length - 1, 1, 'the Russian article is written once');
    assert.equal(source.split('20606316').length - 1, 1, 'the English article is written once');
});

check('shortcuts page falls back to English', () => {
    const page = name => 'resources/help/' + name + '/HelpfulHints/KeyboardShortcuts.htm';
    /* The languages the catalog knows are exactly the help folders that have the page. */
    const folders = fs.readdirSync(HELP_DIR, {withFileTypes: true})
        .filter(d => d.isDirectory() && fs.existsSync(path.join(HELP_DIR, d.name, 'HelpfulHints/KeyboardShortcuts.htm')))
        .map(d => d.name).sort();
    assert.deepEqual(Array.from(da.HELP_LANGS).sort(), folders);
    for (const [value, name] of [['ru', 'ru'], ['de', 'de'], ['pt-BR', 'pt'], ['pt_BR', 'pt'], ['sr-Latn-RS', 'sr-Latn'],
        ['tr', 'tr'], ['en', 'en'], ['kk', 'en'], ['zh', 'en'], ['sr', 'en'], ['rus', 'en'], ['', 'en'], [undefined, 'en']])
        assert.deepEqual(runHelpItem('help.shortcuts', value), [[page(name), '_blank']], String(value));
    /* The page opens beside the editor page and every page it names is in the help folder. */
    for (const name of da.HELP_LANGS)
        assert.ok(fs.existsSync(path.join(HELP_DIR, name, 'HelpfulHints/KeyboardShortcuts.htm')), name);
    const item = helpGroup().items.find(it => it && it.k === 'help.shortcuts');
    assert.equal(item.t, 'Keyboard shortcuts');
    assert.equal(item.disabled, undefined, 'never greyed');
    assert.equal(item.when, undefined, 'shown to everyone');
});

check('test_compact_help_item_opens_helpdesk', () => {
    const group = helpGroup();
    const help = group.items.find(it => it && it.i === 'help');
    assert.ok(help, 'Help item exists');
    assert.equal(help.t, da.textMenuEditorHelp);
    assert.equal(help.t, 'Editor help');
    /* No reason greys it: the item has neither disabled() nor needs. */
    assert.equal(help.disabled, undefined);
    assert.equal(help.needs, undefined);

    for (const [value, url] of [['ru', ARTICLE_RU], ['en', ARTICLE_EN], ['de', ARTICLE_EN]]) {
        lang = value;
        opened.length = 0;
        help.run();
        assert.deepEqual(opened, [[url, '_blank']], value);
    }

    for (const it of group.items)
        assert.ok(!/onlyoffice/i.test(it.t || ''), 'no ONLYOFFICE item: ' + it.t);
    assert.equal(da.textHelpOnlyoffice, undefined);
    const source = fs.readFileSync(ACTIONS, 'utf8');
    assert.ok(!/textHelpOnlyoffice/.test(source), 'textHelpOnlyoffice removed from code');
    assert.ok(!/helpcenter\.onlyoffice\.com/i.test(source), 'no ONLYOFFICE help center address');
});

/* The stock File menu and LeftMenu controller in the same context: identity extend
   stubs turn the AMD definitions into plain objects with the real methods. */
Object.assign(context._, {
    template: () => () => '',
    bind: (fn, owner) => fn.bind(owner),
    findWhere: (list, props) => list.find(it => Object.keys(props).every(k => it[k] === props[k]))
});
context.Common.UI = {BaseView: {extend: definition => definition}, Menu: {Manager: {hideAll() {}}}};
context.Backbone = {Controller: {extend: definition => definition}};
context.navigator = {onLine: true};
context.$ = () => ({hasClass: () => true, removeClass() {}, addClass() {}});
context.define = (dependencies, factory) => factory('', context._);
for (const file of [FILE_MENU, LEFT_MENU])
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});

check('test_file_help_opens_helpdesk', () => {
    const fileMenu = DE.Views.FileMenu;
    const el = {};
    const fired = [];
    const shown = [];
    const menu = Object.assign(Object.create(fileMenu), {
        el: {},
        items: [{el, options: {action: 'help'}}],
        panels: {},
        /* The arguments array comes from the vm realm: copy it for deepStrictEqual. */
        fireEvent: (name, args) => fired.push([name, Array.from(args)]),
        $el: {find: () => ({hide() {}})}
    });
    const click = fileMenu.events.call(menu)['click .fm-btn'];
    for (const [value, url] of [['ru', RU], ['en', COM]]) {
        lang = value;
        opened.length = fired.length = 0;
        click({currentTarget: el});
        assert.deepEqual(fired, [['item:click', [menu, 'external-help', true]]], value);
        assert.deepEqual(opened, [[url, '_blank']], value);
    }
    /* Even a leftover guide panel with contents is not shown: help is always external. */
    menu.panels = {help: {noHelpContents: false, show: () => shown.push('help')}};
    context.navigator.onLine = false;
    lang = 'ru';
    opened.length = fired.length = 0;
    click({currentTarget: el});
    assert.deepEqual(opened, [[RU, '_blank']]);
    assert.deepEqual(fired, [['item:click', [menu, 'external-help', true]]]);
    assert.deepEqual(shown, []);
    context.navigator.onLine = true;

    const source = fs.readFileSync(FILE_MENU, 'utf8');
    assert.ok(!/FileMenuPanels\.Help/.test(source), 'the guide panel is not created');
    assert.ok(!/url-help-center|noHelpContents/.test(source), 'no help center fallback');
    has(source, /isVisible = this\.mode\.canHelp;\s*this\.miHelp\[isVisible \?'show':'hide'\]\(\);/);
    has(fs.readFileSync(MAIN, 'utf8'), /this\.appOptions\.canHelp\s*= !\(\(typeof \(this\.editorConfig\.customization\) == 'object'\) && this\.editorConfig\.customization\.help===false\);/,
        'customization.help === false gate is kept');
});

check('test_f1_opens_helpdesk', () => {
    const menus = [];
    const controller = Object.assign({}, DE.Controllers.LeftMenu, {
        mode: {canHelp: true},
        leftMenu: {showMenu: (...args) => menus.push(args)}
    });
    lang = 'ru';
    opened.length = 0;
    assert.equal(controller.onShortcut('help', {}), false);
    assert.deepEqual(opened, [[RU, '_blank']]);

    /* file:help from the mail merge, forms and equation tips carries a guide article: not needed. */
    lang = 'en';
    opened.length = 0;
    controller.showHelp('UsageInstructions/UseMailMerge.htm');
    controller.showHelp();
    assert.deepEqual(opened, [[COM, '_blank'], [COM, '_blank']]);
    assert.deepEqual(menus, [], 'the File menu guide panel is not opened');
    has(fs.readFileSync(LEFT_MENU, 'utf8'),
        /NotificationCenter\.on\('file:help', _\.bind\(this\.showHelp, this\)\)/);

    /* customization.help === false: no help at all, as before. */
    controller.mode = {canHelp: false};
    opened.length = 0;
    controller.onShortcut('help', {});
    controller.showHelp('UsageInstructions/UseMailMerge.htm');
    controller.mode = undefined;
    controller.showHelp();
    assert.deepEqual(opened, []);
    assert.deepEqual(menus, []);
});

check('test_suggest_feature_hidden', () => {
    const main = fs.readFileSync(MAIN, 'utf8');
    has(main, /this\.appOptions\.canSuggest\s*=\s*false\s*;/);
    assert.ok(!/onSuggest/.test(main), 'onSuggest removed');
    assert.ok(!/NotificationCenter\.on\(\s*'suggest'/.test(main), 'no suggest subscription');
    assert.ok(!/SUGGEST_URL/.test(main), 'no suggest address');
    assert.ok(!/HELP_CENTER_WEB_DE|url-help-center/.test(main), 'no help center address');
    has(fs.readFileSync(FILE_MENU, 'utf8'),
        /isVisible = this\.mode\.canSuggest;\s*this\.miSuggest\[isVisible \?'show':'hide'\]\(\);/,
        'the File menu shows "Suggest a feature" only by canSuggest');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
