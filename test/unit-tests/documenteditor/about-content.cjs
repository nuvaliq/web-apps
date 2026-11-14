/* Run: node test/unit-tests/documenteditor/about-content.cjs
 * "About" content: Common.Views.About builds the lawyer's text
 * from locale strings — product name, the version line, the lines of the notice, the CC BY-SA paragraph — with no
 * logo, publisher, contacts or licensee block. English is the default in code, Russian lives in the ru.json of every
 * desktop editor. The source address and the release number come from the build: grunt puts them in place of
 * {{SOURCE_URL}} and {{RELEASE_VERSION}} of About.js; here the placeholders are replaced in the source text the
 * same way. Expected strings are the accepted texts verbatim (PROTOTYPE.ru / PROTOTYPE.en).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const ABOUT = path.join(ROOT, 'apps/common/main/lib/view/About.js');
const RU_JSON = path.join(ROOT, 'apps/documenteditor/main/locale/ru.json');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

const LICENSE_HREF = '../../common/LICENSE.txt';
const CC_URL = 'https://creativecommons.org/licenses/by-sa/4.0/legalcode';
const PREFIX = 'Common.Views.About.';

/* Desktop editors: every one has its ru.json with the strings of the window. */
const EDITORS = ['documenteditor', 'spreadsheeteditor', 'presentationeditor', 'pdfeditor', 'visioeditor'];

/* Values the build puts in place of the placeholders: two releases with different addresses. */
const SOURCE_URL = 'https://git.example.test/example/overlay/-/tree/v9.4.0.129-b24.5';
const RELEASE = '9.4.0.129-b24.5';
const OTHER_SOURCE_URL = 'https://code.example.test/example/overlay/tree/v9.4.0.129-b24.6';
const OTHER_RELEASE = '9.4.0.129-b24.6';

/* Accepted texts by the keys of the window; %1 is the version, the license link, the source address or the CC link. */
const PROTOTYPE = {
    ru: {
        ProductName: 'ВайбОфис',
        VersionLine: 'Версия %1',
        Modified: 'ВайбОфис – модифицированная версия, изменения с 27.08.2026.',
        Copyright: '© 2026 ООО «Битрикс», в части внесенных изменений.',
        BasedOn: 'Основано на программном обеспечении ONLYOFFICE Docs, разработанном Ascensio System SIA.',
        Ascensio: '© 2009–2026 Ascensio System SIA.',
        Trademark: 'ONLYOFFICE – товарный знак Ascensio System SIA.',
        License: 'Лицензия: %1',
        LicenseLink: 'GNU Affero General Public License версии 3 (AGPLv3) + дополнительные условия',
        Source: 'Исходный код: %1',
        NonCode: 'Отдельные элементы оригинального некодового контента ONLYOFFICE Docs, сохраняемые в программе или поставляемые вместе с ней, включая, помимо прочего, иллюстрации, наборы иконок, технические и документационные материалы, предоставляются на условиях Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0): %1.'
    },
    en: {
        ProductName: 'VibeOffice',
        VersionLine: 'Version %1',
        Modified: 'VibeOffice is a modified version, changes since 27 August 2026.',
        Copyright: '© 2026 Bitrix LLC, with respect to modifications.',
        BasedOn: 'Based on ONLYOFFICE Docs software developed by Ascensio System SIA.',
        Ascensio: '© 2009–2026 Ascensio System SIA.',
        Trademark: 'ONLYOFFICE is a trademark of Ascensio System SIA.',
        License: 'License: %1',
        LicenseLink: 'GNU Affero General Public License v3.0 (AGPLv3) + Additional Terms',
        Source: 'Source code: %1',
        NonCode: 'Certain elements of the original non-code content of ONLYOFFICE Docs retained in or distributed with the program, including but not limited to illustrations, icon sets, technical and documentation materials, are provided under the Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0): %1.'
    }
};
const NAMES = Object.keys(PROTOTYPE.en);
const LANGS = [['en', null], ['ru', null]];

const source = fs.readFileSync(ABOUT, 'utf8');
const ruJson = JSON.parse(fs.readFileSync(RU_JSON, 'utf8'));
const ruLocale = {};
Object.keys(ruJson).filter(k => k.startsWith(PREFIX)).forEach(k => { ruLocale[k.slice(PREFIX.length)] = ruJson[k]; });
LANGS[1][1] = ruLocale;

/* About.js as the build leaves it: {{SOURCE_URL}} and {{RELEASE_VERSION}} replaced everywhere. */
const build = (url, release) => source.split('{{SOURCE_URL}}').join(url).split('{{RELEASE_VERSION}}').join(release);

/* Loads About.js (or its built text) in vm. `locale` plays Common.Locale: it puts the strings on Common.Views.About
 * before the module runs, and the module merges them over its English defaults. */
function loadAbout(locale, text = source) {
    const log = {selectors: [], notifications: [], scrollers: []};
    const empty = new Proxy({length: 0}, {
        get(obj, key) { return key in obj || typeof key === 'symbol' ? obj[key] : () => empty; }
    });
    const Common = {
        Views: locale ? {About: Object.assign({}, locale)} : {},
        UI: {
            BaseView: {
                extend(proto) {
                    function View(options) { this.options = options; }
                    View.prototype = proto;
                    return View;
                },
                prototype: {initialize() {}, show() {}, hide() {}}
            },
            Scroller: function (options) { log.scrollers.push(options); },
            Themes: {isDarkTheme: () => false}
        },
        Utils: {String: {htmlEncode: value => _.escape(value)}},
        NotificationCenter: {on: (...args) => log.notifications.push(args), trigger() {}}
    };
    const $ = (...args) => { log.selectors.push(args); return empty; };
    vm.runInNewContext(text, {Common, _, $, jQuery: $, define: (deps, factory) => factory()}, {filename: ABOUT});
    return {About: Common.Views.About, log};
}

/* An instance with a recording $el, as LeftMenu creates it. */
function instance(About) {
    const el = {calls: [], html(v) { this.calls.push(['html', v]); this.content = v; return this; },
        addClass(v) { this.calls.push(['addClass', v]); this.cls = v; return this; }};
    const view = new About({el: '#about-menu-panel', appName: 'Document Editor'});
    view.$el = el;
    view.initialize({el: '#about-menu-panel', appName: 'Document Editor'});
    return view;
}

const SKELETON = new RegExp('^<div class="about-content">' +
    '<div class="about-head"><h2 class="about-name">([^<]*)</h2><div class="about-version">([^<]*)</div></div>' +
    '<div class="about-lines">(.*)</div>' +
    '<p class="about-cc">(.*)</p>' +
    '</div>$', 's');

function parse(html) {
    const m = String(html).match(SKELETON);
    assert.ok(m, 'markup is div.about-content > div.about-head + div.about-lines + p.about-cc, got: ' + String(html).slice(0, 300));
    const lines = [...m[3].matchAll(/<p class="about-line">(.*?)<\/p>/g)].map(x => x[1]);
    assert.equal(lines.map(l => '<p class="about-line">' + l + '</p>').join(''), m[3], 'div.about-lines holds only p.about-line');
    return {name: m[1], version: m[2], lines, cc: m[4]};
}

const ENTITIES = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#x60;': '`'};
const plain = html => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#x27|#x60);/g, e => ENTITIES[e]);
const link = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener">' + text + '</a>';
/* Ready html in place of %1 of an encoded string. */
const insert = (encoded, html) => encoded.replace('%1', () => html);

/* Expected markup of the lines and of the CC paragraph for the texts `t` and the source address `url`. */
function expected(t, url) {
    return {
        lines: [
            _.escape(t.Modified),
            _.escape(t.Copyright),
            _.escape(t.BasedOn),
            _.escape(t.Ascensio),
            _.escape(t.Trademark),
            insert(_.escape(t.License), link(LICENSE_HREF, _.escape(t.LicenseLink))),
            insert(_.escape(t.Source), link(_.escape(url), _.escape(url)))
        ],
        cc: insert(_.escape(t.NonCode), link(CC_URL, CC_URL))
    };
}

/* Addresses written in the code (the license header aside). */
const addresses = text => [...new Set(text.replace(/^\/\*[\s\S]*?\*\//, '').match(/https?:\/\/[^\s'"`)]+/g) || [])];

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

test('test_about_source_link_and_release_from_build', () => {
    for (const name of ['SOURCE_URL', 'RELEASE_VERSION'])
        assert.equal(source.split('{{' + name + '}}').length - 1, 1, 'About.js has one {{' + name + '}} placeholder for the build');
    assert.deepEqual(addresses(source), [CC_URL], 'About.js has no address besides the CC legal code: the source address comes from the build');

    for (const [lang, locale] of LANGS) {
        const t = PROTOTYPE[lang];
        /* Built with an address and a release: the source line links the address in a new tab, the address is the
         * text of the link; the version line shows the release number. */
        for (const [url, release] of [[SOURCE_URL, RELEASE], [OTHER_SOURCE_URL, OTHER_RELEASE]]) {
            const {About} = loadAbout(locale, build(url, release));
            const content = parse(About.prototype.contentHtml());
            assert.equal(content.lines.length, 7, lang + ': seven lines with the source line');
            assert.equal(content.lines[6], insert(_.escape(t.Source), link(url, url)), lang + ': source line links ' + url);
            assert.equal(content.version, insert(_.escape(t.VersionLine), _.escape(release)), lang + ': version line is ' + release);
            /* Main.onServerVersion still compares the server build with the product version. */
            assert.equal(About.prototype.txtVersionNum, '{{PRODUCT_VERSION}}', lang + ': txtVersionNum stays the product version');
            assert.equal(instance(About).txtVersionNum, '{{PRODUCT_VERSION}}', lang + ': instance exposes txtVersionNum');
        }

        /* Built without the variables (empty values) or not built (placeholders as they are): no source line,
         * the version line shows three numbers of the product version. */
        for (const [what, text] of [['empty values', build('', '')], ['unreplaced placeholders', source]]) {
            const {About} = loadAbout(locale, text);
            const scope = Object.create(About.prototype);
            scope.txtVersionNum = '9.4.0.129';
            const content = parse(About.prototype.contentHtml.call(scope));
            const prefix = t.Source.split('%1')[0];
            assert.equal(content.lines.length, 6, lang + ', ' + what + ': no source line');
            assert.ok(content.lines.every(line => !plain(line).startsWith(prefix)), lang + ', ' + what + ': no "' + prefix + '"');
            assert.equal(plain(content.version), t.VersionLine.replace('%1', '9.4.0'), lang + ', ' + what + ': three numbers');
        }
    }
});

test('test_about_lines_in_lawyer_order', () => {
    const {About: english} = loadAbout(null, build(SOURCE_URL, RELEASE));
    for (const name of NAMES)
        assert.equal(english.prototype['txt' + name], PROTOTYPE.en[name], 'English default txt' + name);

    for (const [lang, locale] of LANGS) {
        const {About, log} = loadAbout(locale, build(SOURCE_URL, RELEASE));
        const t = PROTOTYPE[lang];
        const want = expected(t, SOURCE_URL);
        assert.equal(typeof About.prototype.contentHtml, 'function', 'Common.Views.About.prototype.contentHtml');
        /* Works without an instance: `this` is the prototype carrying the strings. */
        const html = About.prototype.contentHtml();
        const content = parse(html);
        assert.equal(content.name, _.escape(t.ProductName), lang + ': product name');
        assert.equal(content.version, insert(_.escape(t.VersionLine), _.escape(RELEASE)), lang + ': version line');
        /* Changes, copyright of the changes, origin, Ascensio, trademark, license, source code; then CC BY-SA. */
        assert.equal(content.lines.length, want.lines.length, lang + ': seven lines');
        want.lines.forEach((line, i) => assert.equal(content.lines[i], line, lang + ': line ' + (i + 1)));
        assert.equal(content.cc, want.cc, lang + ': CC paragraph');

        /* render() puts the same markup into $el, keeps the about-dlg class and the scroller. */
        const view = instance(About);
        view.render();
        assert.equal(view.$el.content, html, lang + ': render() puts contentHtml() into $el');
        assert.equal(view.$el.cls, 'about-dlg');
        assert.equal(log.scrollers.length, 1, lang + ': one scroller');
        assert.equal(log.scrollers[0].el, view.$el);
        assert.equal(log.scrollers[0].suppressScrollX, true);
        view.render();
        assert.equal(view.$el.calls.filter(c => c[0] === 'html').length, 1, lang + ': renders once');
    }
});

test('test_about_license_link_opens_license_file_in_new_tab', () => {
    for (const [lang, locale] of LANGS) {
        const {About} = loadAbout(locale);
        const content = parse(About.prototype.contentHtml());
        const t = PROTOTYPE[lang];
        assert.equal(content.lines[5], insert(_.escape(t.License), link(LICENSE_HREF, _.escape(t.LicenseLink))),
            lang + ': "' + t.License.replace('%1', t.LicenseLink) + '" links the license file in a new tab');
        const others = content.lines.filter((l, i) => i !== 5);
        assert.ok(others.every(l => !l.includes('<a')), lang + ': without a source address only the license line has a link');
    }
});

test('test_about_cc_link', () => {
    for (const [lang, locale] of LANGS) {
        const {About} = loadAbout(locale);
        const content = parse(About.prototype.contentHtml());
        assert.equal(content.cc, expected(PROTOTYPE[lang], '').cc,
            lang + ': CC paragraph links the legal code with the address as text');
    }
});

test('test_about_version_without_build_number', () => {
    assert.equal((source.match(/\{\{PRODUCT_VERSION\}\}/g) || []).length, 1, 'About.js keeps one {{PRODUCT_VERSION}} placeholder');
    for (const [lang, locale, word] of [['en', null, 'Version'], ['ru', ruLocale, 'Версия']]) {
        const {About} = loadAbout(locale);
        assert.equal(About.prototype.txtVersionNum, '{{PRODUCT_VERSION}}', 'full version stays in txtVersionNum');
        /* Main.onServerVersion compares the server build with getMenu('about').txtVersionNum. */
        assert.equal(instance(About).txtVersionNum, '{{PRODUCT_VERSION}}', 'instance exposes txtVersionNum');
        const cases = [
            ['9.4.0.129', '9.4.0'],
            ['9.4.0', '9.4.0'],
            ['10.12.3.7', '10.12.3'],
            ['{{PRODUCT_VERSION}}', '{{PRODUCT_VERSION}}']
        ];
        for (const [full, shown] of cases) {
            const scope = Object.create(About.prototype);
            scope.txtVersionNum = full;
            assert.equal(plain(parse(About.prototype.contentHtml.call(scope)).version), word + ' ' + shown, lang + ': ' + full);
        }
        assert.equal(plain(parse(About.prototype.contentHtml()).version), word + ' {{PRODUCT_VERSION}}',
            lang + ': unreplaced placeholder is shown as is');
    }
});

test('test_about_has_no_logo_publisher_contacts', () => {
    for (const token of ['{{PUBLISHER_NAME}}', '{{PUBLISHER_ADDRESS}}', '{{PUBLISHER_URL}}', '{{PUBLISHER_PHONE}}',
        '{{SUPPORT_EMAIL}}', 'changeLogo', 'asc-about', 'customer', 'mailto:', '<img', 'txtPoweredBy'])
        assert.ok(!source.includes(token), 'About.js still has ' + token);

    for (const locale of [null, ruLocale]) {
        const {About, log} = loadAbout(locale);
        const html = About.prototype.contentHtml();
        for (const pattern of [/<img/i, /logo/i, /mailto:/i, /onlyoffice\.com/i, /www\./i, /tel\.?:/i, /address:/i, /email:/i, /Riga/i])
            assert.ok(!pattern.test(html), 'content matches ' + pattern);
        assert.equal((html.match(/href=/g) || []).length, 2, 'two links: license and CC');

        /* Licensee data and the light edition no longer change anything — before or after render. */
        const lic = {customer: {name: 'Licensee', address: 'Street 1', mail: 'a@b.c', phone: '+1 23', www: 'example.test',
            info: 'Info', logo: 'logo.svg', logoDark: 'logo-dark.svg'}};
        const early = instance(About);
        early.setLicInfo(lic);
        early.render();
        assert.equal(early.$el.content, html, 'setLicInfo before render changes nothing');
        const view = instance(About);
        view.render();
        view.setLicInfo(lic);
        view.setMode({isLightVersion: true});
        assert.equal(view.$el.calls.filter(c => c[0] === 'html').length, 1, 'setLicInfo/setMode do not re-render');
        assert.equal(view.$el.content, html);
        assert.deepEqual(log.selectors, [], 'no global $() lookups');
        assert.deepEqual(log.notifications, [], 'no theme subscription for a logo');
    }
});

test('test_about_ru_keys_in_every_editor', () => {
    const appsDir = path.join(ROOT, 'apps');
    const withRu = fs.readdirSync(appsDir).filter(app => fs.existsSync(path.join(appsDir, app, 'main/locale/ru.json')));
    assert.deepEqual(withRu.sort(), [...EDITORS].sort(), 'every desktop editor with ru.json is checked');
    for (const editor of EDITORS) {
        const file = path.join(appsDir, editor, 'main/locale/ru.json');
        const raw = fs.readFileSync(file, 'utf8');
        const json = JSON.parse(raw);
        for (const name of NAMES)
            assert.equal(json[PREFIX + 'txt' + name], PROTOTYPE.ru[name], editor + ' ru.json ' + PREFIX + 'txt' + name);
        /* The file keeps its form: 2-space JSON, LF; only the document editor ends with a line break. */
        assert.equal(raw, JSON.stringify(json, null, 2) + (editor === 'documenteditor' ? '\n' : ''),
            editor + ' ru.json is formatted as before');
    }

    /* Other locales get no keys and show the English defaults from code. */
    const offenders = [];
    for (const app of fs.readdirSync(appsDir)) {
        const dir = path.join(appsDir, app, 'main/locale');
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'ru.json')) {
            const full = path.join(dir, file);
            const text = fs.readFileSync(full, 'utf8');
            for (const name of NAMES)
                if (text.includes('"' + PREFIX + 'txt' + name + '"')) offenders.push(path.relative(ROOT, full) + ': txt' + name);
        }
    }
    assert.deepEqual(offenders, [], 'only ru.json carries the keys of the window');
});

/* The extended interface panel. less does not load in vm: the source is read as text. */
const ABOUT_LESS = path.join(ROOT, 'apps/common/main/resources/less/about.less');
const LEFT_MENU = path.join(ROOT, 'apps/documenteditor/main/app/view/LeftMenu.js');
const LEFT_MENU_TPL = path.join(ROOT, 'apps/documenteditor/main/app/template/LeftMenu.template');

/* Body of the first `selector { ... }` rule inside `text`, braces matched. */
function rule(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp('(^|[\\s;{}])' + escaped + '\\s*\\{').exec(text);
    assert.ok(m, 'rule ' + selector + ' exists');
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    for (; i < text.length && depth; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
    }
    return text.slice(start, i - 1);
}
function declares(body, selector, declarations) {
    for (const d of declarations) {
        const [prop, value] = d.split(':').map(s => s.trim());
        const re = new RegExp('(^|[\\s;{])' + prop + '\\s*:\\s*' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*;');
        assert.ok(re.test(body), selector + ' declares ' + d);
    }
}

test('test_about_panel_styles_have_no_logo', () => {
    const less = fs.readFileSync(ABOUT_LESS, 'utf8');
    for (const token of ['asc-about', 'about/logo', 'logo'])
        assert.ok(!less.includes(token), 'about.less still has ' + token);

    /* about.css of the prototype: centered for the panel, gaps and sizes by the AIR scale, colors by the editor theme. */
    const dlg = rule(less, '.about-dlg');
    declares(rule(dlg, '.about-content'), '.about-content',
        ['display: flex', 'flex-direction: column', 'align-items: center', 'gap: 16px', 'text-align: center',
            'font-size: 14px', 'line-height: 1.4', 'color: @text-normal']);
    declares(rule(dlg, '.about-head'), '.about-head', ['display: flex', 'flex-direction: column', 'align-items: center', 'gap: 2px']);
    declares(rule(dlg, '.about-name'), '.about-name',
        ['margin: 0', 'font-size: 16px', 'line-height: 1.35', 'font-weight: 600', 'color: @text-normal']);
    declares(rule(dlg, '.about-version'), '.about-version', ['font-size: 13px', 'color: @text-tertiary']);
    declares(rule(dlg, '.about-lines'), '.about-lines', ['display: flex', 'flex-direction: column', 'gap: 2px']);
    declares(rule(dlg, '.about-line'), '.about-line', ['margin: 0', 'text-wrap: balance']);
    declares(rule(dlg, '.about-cc'), '.about-cc',
        ['margin: 0', 'font-size: 13px', 'line-height: 1.4', 'font-weight: 400', 'color: @text-secondary', 'text-wrap: pretty']);
    const a = rule(dlg, 'a');
    declares(a, 'a', ['color: @text-link', 'text-decoration: underline', 'text-underline-offset: 2px']);
});

test('test_left_menu_has_no_support_button', () => {
    const template = fs.readFileSync(LEFT_MENU_TPL, 'utf8');
    const view = fs.readFileSync(LEFT_MENU, 'utf8');
    for (const token of ['left-btn-support', 'btn-menu-support'])
        assert.ok(!template.includes(token), 'LeftMenu.template still has ' + token);
    for (const token of ['btnSupport', '{{SUPPORT_URL}}', 'left-btn-support', 'tipSupport'])
        assert.ok(!view.includes(token), 'LeftMenu.js still has ' + token);

    /* Render the rail in vm: no button is created for support, setButtons and disableMenu work without it. */
    const buttons = [];
    function Button(options) { this.options = options; this.calls = []; buttons.push(this); }
    for (const method of ['on', 'hide', 'show', 'setDisabled', 'toggle', 'updateHint'])
        Button.prototype[method] = function (...args) { this.calls.push([method, args]); return this; };
    let sideButtons = null;
    const markupHtml = [];
    const $ = arg => {
        markupHtml.push(arg);
        return {find: selector => ({selector}), elementById: selector => ({selector})};
    };
    const DE = {Views: {FileMenu: function () {}}, getController: () => ({updateShortcutHints() {}})};
    const Common = {
        UI: {
            SideMenu: {
                extend: proto => proto,
                prototype: {
                    render() { this.btnMore = {menu: {}}; },
                    setButtons(list) { sideButtons = list; }
                }
            },
            Button
        },
        Views: {About: function (options) { this.options = options; }},
        NotificationCenter: {trigger() {}}
    };
    const context = {DE, Common, window: {DE}, _,
        define: (deps, factory) => factory(template, $, _, {})};
    vm.runInNewContext(view, context, {filename: LEFT_MENU});

    const menu = Object.create(DE.Views.LeftMenu);
    menu.$el = {html() { return this; }};
    menu.setDisabledAllMoreMenuItems = () => {};
    menu.render();
    assert.ok(!String(markupHtml[0]).includes('left-btn-support'), 'rendered rail has no support button');
    assert.ok(buttons.length > 0, 'rail buttons are created');
    const support = buttons.filter(b => b.options.action === 'support' ||
        (b.options.el && b.options.el.selector === '#left-btn-support') || b.options.iconCls === 'btn-menu-support');
    assert.equal(support.length, 0, 'no support button is created');
    assert.ok(menu.btnAbout && menu.btnAbout.options.action === 'about', 'About stays in the rail');
    assert.equal(menu.btnAbout.panel.options.el, '#about-menu-panel', 'About panel is Common.Views.About');

    menu.setButtons();
    assert.ok(Array.isArray(sideButtons) && sideButtons.length > 0, 'setButtons passes the rail buttons');
    assert.ok(sideButtons.every(b => b instanceof Button), 'every rail button exists');
    assert.ok(sideButtons.includes(menu.btnAbout), 'About is in setButtons');
    assert.equal(sideButtons.length, 6, 'search, comments, chat, navigation, thumbnails, about');

    menu.disableMenu('all', true);
    assert.ok(menu.btnAbout.calls.some(c => c[0] === 'setDisabled'), 'disableMenu reaches About');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
