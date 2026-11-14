/* Run: node test/unit-tests/documenteditor/mobile-about.cjs
 * Mobile "About": the common mobile About.jsx shows the lawyer's
 * text — product name, the version line, the lines of the notice, the CC BY-SA paragraph — with no logo, publisher
 * or licensee block. English is the default in code (EN), Russian lives in the mobile ru.json of every editor;
 * texts, %1 and the help address rule are the same as on the desktop (Common.Views.About,
 * DE.Views.DocumentActions.helpUrl). The source address and the release number come from the build as the webpack
 * constants __SOURCE_URL__ and __RELEASE_VERSION__. JSX does not load in vm: the plain parts (EN, About.text,
 * About.helpUrl, the version and source helpers) are cut out of the source and run in vm, the markup and the styles
 * are checked as text. Expected strings are the accepted texts verbatim (PROTOTYPE.ru / PROTOTYPE.en).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const ABOUT = path.join(ROOT, 'apps/common/mobile/lib/view/About.jsx');
const ABOUT_LESS = path.join(ROOT, 'apps/common/mobile/resources/less/about.less');
const RU_JSON = path.join(ROOT, 'apps/documenteditor/mobile/locale/ru.json');
const EN_JSON = path.join(ROOT, 'apps/documenteditor/mobile/locale/en.json');
const DESKTOP_ABOUT = path.join(ROOT, 'apps/common/main/lib/view/About.js');
const DESKTOP_ACTIONS = path.join(ROOT, 'apps/documenteditor/main/app/view/DocumentActions.js');

const LICENSE_HREF = '../../common/LICENSE.txt';
const CC_URL = 'https://creativecommons.org/licenses/by-sa/4.0/legalcode';
const RU_HELP = 'https://helpdesk.bitrix24.ru/';
const COM_HELP = 'https://helpdesk.bitrix24.com/';

/* Mobile editors: every one has its ru.json with the strings of the page; the PDF editor has no mobile version. */
const EDITORS = ['documenteditor', 'spreadsheeteditor', 'presentationeditor', 'visioeditor'];

/* Values the build gives the constants: two releases with different addresses. */
const SOURCE_URL = 'https://git.example.test/example/overlay/-/tree/v9.4.0.129-b24.5';
const RELEASE = '9.4.0.129-b24.5';
const OTHER_SOURCE_URL = 'https://code.example.test/example/overlay/tree/v9.4.0.129-b24.6';
const OTHER_RELEASE = '9.4.0.129-b24.6';

/* Accepted texts by the keys of the page; %1 is the version, the license link, the source address or the CC link. */
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

/* Keys of the "About" section: the desktop has the same keys with the txt prefix. */
const NAMES = Object.keys(PROTOTYPE.en);
function keysOf(t) {
    const keys = {};
    for (const name of NAMES) keys['text' + name] = t[name];
    return keys;
}
const KEYS = {ru: keysOf(PROTOTYPE.ru), en: keysOf(PROTOTYPE.en)};

const source = fs.readFileSync(ABOUT, 'utf8');
const ruJson = JSON.parse(fs.readFileSync(RU_JSON, 'utf8'));
const enJson = JSON.parse(fs.readFileSync(EN_JSON, 'utf8'));

/* One top-level statement of `text`: from the match of `start` to its `;` at bracket depth 0. Strings, regular
 * expression literals and comments are skipped, so brackets, slashes and semicolons in them do not count. */
function cut(text, start) {
    const m = start.exec(text);
    assert.ok(m, 'source has ' + start);
    let depth = 0, prev = '';
    for (let i = m.index; i < text.length; i++) {
        const c = text[i];
        if (/\s/.test(c)) continue;
        if (c === '\'' || c === '"' || c === '`') {
            for (i++; i < text.length && text[i] !== c; i++)
                if (text[i] === '\\') i++;
        } else if (c === '/' && text[i + 1] === '/') {
            i = text.indexOf('\n', i);
            if (i < 0) break;
            continue;
        } else if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2) + 1;
            continue;
        } else if (c === '/' && (prev === '' || '(,=:[!&|?{};>'.includes(prev))) {
            /* A regular expression literal: up to the closing slash outside a character class. */
            for (let inClass = false, j = i + 1; j < text.length; j++) {
                if (text[j] === '\\') j++;
                else if (text[j] === '[') inClass = true;
                else if (text[j] === ']') inClass = false;
                else if (text[j] === '/' && !inClass) { i = j; break; }
            }
        } else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ';' && depth === 0) return text.slice(m.index, i + 1);
        prev = text[i];
    }
    assert.fail('statement ' + start + ' has no end');
}

/* EN, About.text and About.helpUrl have no JSX: they run in vm as they are in About.jsx. */
function loadPlain() {
    const code = [
        cut(source, /^const EN = /m),
        'const About = {};',
        cut(source, /^About\.text = /m),
        cut(source, /^About\.helpUrl = /m),
        'this.EN = EN; this.About = About;'
    ].join('\n');
    const context = {};
    vm.runInNewContext(code, context, {filename: ABOUT});
    return context;
}

/* The version and source helpers of About.jsx run in vm with the constants webpack defines for the build. */
const HELPERS = ['appVersion', 'compareVersions', 'developVersion', 'sourceUrl', 'displayVersion'];
function loadBuilt(constants) {
    const code = ['const About = {};']
        .concat(HELPERS.map(name => cut(source, new RegExp('^About\\.' + name + ' = ', 'm'))))
        .concat('this.About = About;')
        .join('\n');
    const context = Object.assign({}, constants);
    vm.runInNewContext(code, context, {filename: ABOUT});
    return context.About;
}

/* Desktop counterparts: English defaults of Common.Views.About (string literals of About.js), the desktop ru.json
 * and DE.Views.DocumentActions.helpUrl loaded in vm with the same stubs as help-url.cjs. */
function desktopDefaults() {
    const text = fs.readFileSync(DESKTOP_ABOUT, 'utf8');
    const result = {};
    for (const m of text.matchAll(/^\s*txt(\w+):\s*('(?:[^'\\]|\\.)*')/gm))
        result[m[1]] = vm.runInNewContext(m[2]);
    return result;
}
function desktopHelpUrl() {
    const DE = {Views: {}, Controllers: {}, getController: () => null};
    const context = {
        DE,
        window: {DE, open() {}},
        _: {extend: Object.assign},
        Common: {Locale: {getCurrentLanguage: () => 'en'}, NotificationCenter: {trigger() {}, on() {}}, Utils: {}},
        define: (dependencies, factory) => factory({})
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(DESKTOP_ACTIONS, 'utf8'), context, {filename: DESKTOP_ACTIONS});
    return DE.Views.DocumentActions.helpUrl;
}

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
/* Selectors of the rules directly inside `body` (nested rules are not listed). */
function childSelectors(body) {
    const result = [];
    let depth = 0, from = 0;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === '{') {
            if (depth === 0) result.push(body.slice(from, i).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').split(';').pop().trim());
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) from = i + 1;
        } else if (c === ';' && depth === 0) from = i + 1;
    }
    return result;
}
function declares(body, selector, declarations) {
    for (const d of declarations) {
        const at = d.indexOf(':');
        const prop = d.slice(0, at).trim(), value = d.slice(at + 1).trim();
        const re = new RegExp('(^|[\\s;{])' + prop + '\\s*:\\s*' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*;');
        assert.ok(re.test(body), selector + ' declares ' + d);
    }
}
/* assert.match on a whole source file prints the file; report the pattern instead. */
function has(text, pattern, message) {
    assert.ok(pattern.test(text), message || 'source matches ' + pattern);
}

/* The page with whitespace collapsed: the part under the Navbar, from div.about__content to </Page>. */
const flat = source.replace(/\s+/g, ' ');
function page() {
    const m = /<div className="about__content">(.*?)<\/Page>/.exec(flat);
    assert.ok(m, 'the page has div.about__content');
    return m[1];
}
/* The source line is shown only with an address and links it with the address as text:
 * `{url && <p className="about__line">{withLink(_t.textSource, url, url)}</p>}`, url being About.sourceUrl() itself
 * or a constant set from it. */
function checkSourceLine() {
    const m = /\{(?:!!)?(About\.sourceUrl\(\)|\w+) (?:&&|\?) <p className="about__line">\{withLink\(_t\.textSource, \1, \1\)\}<\/p>(?: : null)? ?\}/.exec(page());
    assert.ok(m, 'the source line is shown only with About.sourceUrl() and links it: '
        + '{url && <p className="about__line">{withLink(_t.textSource, url, url)}</p>}');
    if (m[1] !== 'About.sourceUrl()')
        has(flat, new RegExp('\\bconst ' + m[1] + ' = About\\.sourceUrl\\(\\);'), m[1] + ' is About.sourceUrl()');
}
const VERSION_LINE = /^ <div className="about__head"> <h2 className="about__name">\{_t\.textProductName\}<\/h2> <div className="about__version">\{_t\.textVersionLine\.replace\('%1', About\.displayVersion\(\)\)\}<\/div> <\/div> <div className="about__lines">/;
/* Addresses written in the code (the license header aside). */
const addresses = text => [...new Set(text.replace(/^\/\*[\s\S]*?\*\//, '').match(/https?:\/\/[^\s'"`)]+/g) || [])];

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

test('test_mobile_about_source_link_and_release_from_build', () => {
    /* The version helpers Main.jsx compares the server build with give the values they gave before, whatever
     * the source address and the release number are. */
    const before = {
        '9.4.0.129': {appVersion: '9.4.0', compareVersions: false, developVersion: false},
        '9.4.0.129d': {appVersion: '9.4.0', compareVersions: true, developVersion: true},
        '10.12.3.7debug': {appVersion: '10.12.3', compareVersions: false, developVersion: true}
    };
    for (const [url, release] of [[SOURCE_URL, RELEASE], [OTHER_SOURCE_URL, OTHER_RELEASE], ['', '']]) {
        for (const [product, values] of Object.entries(before)) {
            const About = loadBuilt({__PRODUCT_VERSION__: product, __SOURCE_URL__: url, __RELEASE_VERSION__: release});
            const what = product + ', ' + (url || 'no address') + ', ' + (release || 'no release');
            for (const [name, value] of Object.entries(values))
                assert.equal(About[name](), value, 'About.' + name + ' as before: ' + what);
            /* The page gets the address of the build and the release number; without them no address and the
             * three numbers of the product version. */
            assert.equal(About.sourceUrl(), url, 'About.sourceUrl: ' + what);
            assert.equal(About.displayVersion(), release || values.appVersion, 'About.displayVersion: ' + what);
        }
    }

    /* The page shows the release number and links the source address in a new tab with the address as text. */
    has(page(), VERSION_LINE, 'head: product name, then "Version %1" with About.displayVersion()');
    checkSourceLine();
    has(flat, /<a className="external" href=\{href\} target="_blank" rel="noopener">\{label\}<\/a>/,
        'withLink makes <a class="external" target="_blank" rel="noopener">');

    /* No address literal: the source address comes from the build only. */
    assert.deepEqual(addresses(source).sort(), [CC_URL, RU_HELP, COM_HELP].sort(),
        'About.jsx has no address besides the CC legal code and the helpdesk');
});

test('test_mobile_about_has_no_logo_publisher_customer', () => {
    for (const token of ['__PUBLISHER_URL__', '__PUBLISHER_NAME__', '__PUBLISHER_ADDRESS__', '__SUPPORT_EMAIL__',
        'about__logo', 'logo-block', 'settings-about', 'Customer', 'customer', 'customization', 'canBranding',
        'storeAppOptions', 'licInfo', 'mailto:', 'tel:', '<img', 'textPoweredBy', 'DOCUMENT EDITOR', 'nameEditor'])
        assert.ok(!source.includes(token), 'About.jsx still has ' + token);

    /* Navbar as before; under it .about__content — name, version, the lines in the lawyer's order, CC. */
    has(source, /<Navbar title=\{_t\.textAbout\} backLink=\{_t\.textBack\} \/>/, 'Navbar keeps textAbout / textBack');
    has(page(), VERSION_LINE, 'head: product name, then "Version %1" with About.displayVersion()');
    const lines = [...page().matchAll(/<p className="about__line">(.*?)<\/p>/g)].map(m => m[1]);
    assert.deepEqual(lines.slice(0, 6), ['{_t.textModified}', '{_t.textCopyright}', '{_t.textBasedOn}', '{_t.textAscensio}',
        '{_t.textTrademark}', '{withLink(_t.textLicense, LICENSE_URL, _t.textLicenseLink)}'],
        'six lines in the lawyer\'s order, the license line links the license file');
    assert.equal(lines.length, 7, 'the source line is the seventh');
    checkSourceLine();
    has(page(), /<\/div> <p className="about__cc">\{withLink\(_t\.textNonCode, CC_URL, CC_URL\)\}<\/p> <\/div> $/,
        'CC paragraph after the lines links the legal code with the address as text');

    /* Links open in a new tab and are external for the Framework7 router. */
    has(source, /^const LICENSE_URL = '\.\.\/\.\.\/common\/LICENSE\.txt';/m, 'LICENSE_URL is ' + LICENSE_HREF);
    has(source, /^const CC_URL = 'https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/legalcode';/m, 'CC_URL is ' + CC_URL);
    assert.equal((source.match(/<a[\s>]/g) || []).length, 1, 'one link element, in withLink');
    has(flat, /<a className="external" href=\{href\} target="_blank" rel="noopener">\{label\}<\/a>/,
        'link is <a class="external" target="_blank" rel="noopener">');
    has(flat, /const withLink = \(text, href, label\) => \{ const at = text\.indexOf\('%1'\); return at < 0 \? text : \( <Fragment> \{text\.slice\(0, at\)\} <a [^>]*>\{label\}<\/a> \{text\.slice\(at \+ 2\)\} <\/Fragment> \); \};/,
        'withLink puts the link in place of %1');

    /* Version helpers are kept as they were: Main.jsx compares the build with them. */
    for (const line of [
        'About.appVersion = () => (__PRODUCT_VERSION__).match(/\\d+.\\d+.\\d+/)[0];     // skip build number',
        'About.compareVersions = () => /d$/.test(__PRODUCT_VERSION__);',
        'About.developVersion = () => /(?:d|debug)$/.test(__PRODUCT_VERSION__);'
    ]) assert.ok(source.includes(line), 'About.jsx keeps ' + line.split(' =')[0]);
    has(source, /^export default About;$/m, 'About is the default export');

    /* Styles: no image or licensee blocks, the blocks of about.css on the phone page of scenes.css. */
    const less = fs.readFileSync(ABOUT_LESS, 'utf8');
    for (const token of ['logo', 'common-image-path', '__licensor', '__customer', '__contacts', '__editor', '__text'])
        assert.ok(!less.toLowerCase().includes(token.toLowerCase()), 'about.less still has ' + token);
    const about = rule(less, '.about');
    const content = rule(about, '&__content');
    declares(content, '.about__content',
        ['display: flex', 'flex-direction: column', 'align-items: center', 'gap: 16px', 'padding: 24px 16px 32px',
            'text-align: center', 'font-size: 14px', 'line-height: 1.4', 'color: @text-normal', 'overflow-wrap: anywhere']);
    declares(rule(about, '&__head'), '.about__head', ['display: flex', 'flex-direction: column', 'align-items: center', 'gap: 2px']);
    declares(rule(about, '&__name'), '.about__name',
        ['margin: 0', 'font-size: 16px', 'line-height: 1.35', 'font-weight: 600', 'color: @text-normal']);
    declares(rule(about, '&__version'), '.about__version', ['font-size: 13px', 'color: @text-tertiary']);
    declares(rule(about, '&__lines'), '.about__lines', ['display: flex', 'flex-direction: column', 'gap: 2px']);
    declares(rule(about, '&__line'), '.about__line', ['margin: 0', 'text-wrap: balance']);
    declares(rule(about, '&__cc'), '.about__cc',
        ['margin: 0', 'font-size: 13px', 'line-height: 1.4', 'font-weight: 400', 'color: @text-secondary', 'text-wrap: pretty']);
    /* Link style stays inside the content: the back link of the Navbar is an <a> of the same page. */
    assert.ok(!childSelectors(about).includes('a'), '.about has no rule for every <a> of the page');
    assert.ok(childSelectors(content).includes('a'), 'links are styled inside .about__content');
    declares(rule(content, 'a'), '.about__content a', ['color: @text-link', 'text-decoration: underline', 'text-underline-offset: 2px']);
});

test('test_mobile_about_english_defaults_match_prototype', () => {
    const {EN, About} = loadPlain();
    assert.deepEqual({...EN}, KEYS.en, 'EN is the prototype TEXT.en');

    /* The same texts and %1 as the desktop English defaults. */
    const desktop = desktopDefaults();
    for (const name of NAMES)
        assert.equal(EN['text' + name], desktop[name], 'EN.text' + name + ' = Common.Views.About.txt' + name);

    /* About.text(t): the locale's "About" over the English defaults, once i18next returns an object. */
    const calls = [];
    const t = value => (key, options) => { calls.push([key, {...options}]); return value; };
    assert.deepEqual({...About.text(t('About'))}, KEYS.en, 'not loaded yet: the key comes back, English defaults');
    assert.deepEqual(calls, [['About', {returnObjects: true}]], 't("About", {returnObjects: true})');
    assert.deepEqual({...About.text(t(undefined))}, KEYS.en, 'no section: English defaults');
    const en = About.text(t(enJson.About));
    for (const [key, value] of Object.entries(KEYS.en))
        assert.equal(en[key], value, 'en.json has no ' + key + ': the default from code');
    assert.equal(en.textAbout, enJson.About.textAbout, 'en.json strings stay (textAbout)');
    assert.equal(en.textBack, enJson.About.textBack, 'en.json strings stay (textBack)');
    const ru = About.text(t(ruJson.About));
    for (const [key, value] of Object.entries(KEYS.ru))
        assert.equal(ru[key], value, 'ru.json ' + key + ' wins over the default');
    assert.equal(ru.textAbout, 'О программе');
    assert.deepEqual({...EN}, KEYS.en, 'About.text does not change EN');
});

test('test_mobile_ru_about_keys_in_every_editor', () => {
    const appsDir = path.join(ROOT, 'apps');
    const withRu = fs.readdirSync(appsDir).filter(app => fs.existsSync(path.join(appsDir, app, 'mobile/locale/ru.json')));
    assert.deepEqual(withRu.sort(), [...EDITORS].sort(), 'every mobile editor with ru.json is checked');
    for (const editor of EDITORS) {
        const file = path.join(appsDir, editor, 'mobile/locale/ru.json');
        const raw = fs.readFileSync(file, 'utf8');
        const json = JSON.parse(raw);
        const about = json.About || {};
        for (const [key, value] of Object.entries(KEYS.ru))
            assert.equal(about[key], value, editor + ' mobile ru.json About.' + key);
        /* The keys the page had before stay. */
        for (const key of ['textAbout', 'textBack'])
            assert.equal(typeof about[key], 'string', editor + ' mobile ru.json keeps About.' + key);

        /* The same Russian texts as the desktop ru.json of the editor. */
        const desktopRu = JSON.parse(fs.readFileSync(path.join(appsDir, editor, 'main/locale/ru.json'), 'utf8'));
        for (const name of NAMES)
            assert.equal(about['text' + name], desktopRu['Common.Views.About.txt' + name],
                editor + ': About.text' + name + ' = desktop ru.json');

        /* ru.json keeps its form: 2-space JSON, LF, no newline at the end; "About" keys stay sorted. */
        assert.equal(JSON.stringify(json, null, 2), raw, editor + ' mobile ru.json is formatted as before');
        const keys = Object.keys(about);
        assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
            editor + ' mobile ru.json: About keys are sorted');
    }

    /* Other locales get no keys and show the English defaults from code. */
    const offenders = [];
    for (const app of fs.readdirSync(appsDir)) {
        const dir = path.join(appsDir, app, 'mobile/locale');
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'ru.json')) {
            const full = path.join(dir, file);
            const about = JSON.parse(fs.readFileSync(full, 'utf8')).About || {};
            for (const key of Object.keys(KEYS.en))
                if (key in about) offenders.push(path.relative(ROOT, full) + ': ' + key);
        }
    }
    assert.deepEqual(offenders, [], 'only ru.json carries the keys of the page');
});

test('test_mobile_help_url_ru_and_com', () => {
    const {About} = loadPlain();
    assert.equal(typeof About.helpUrl, 'function', 'About.helpUrl');
    for (const value of ['ru', 'RU', 'ru-ru', 'ru-RU', 'ru_RU'])
        assert.equal(About.helpUrl(value), RU_HELP, value);
    for (const value of ['en', 'de', 'kk', 'be', 'uk', 'pt-br', 'zh', 'rus', 'run', 'en-ru', '', null, undefined])
        assert.equal(About.helpUrl(value), COM_HELP, String(value));

    /* One rule in both bundles: the desktop DE.Views.DocumentActions.helpUrl gives the same address. */
    const desktop = desktopHelpUrl();
    for (const value of ['ru', 'RU', 'ru-RU', 'ru_RU', 'en', 'de', 'kk', 'rus', '', null, undefined])
        assert.equal(About.helpUrl(value), desktop(value), 'same as the desktop for ' + String(value));
});

/* "Settings" of the document editor's mobile version: "Help" goes to the helpdesk by language,
 * there is no feedback item. The controller's showHelp has no JSX and runs in vm with the real About.helpUrl. */
const SETTINGS = path.join(ROOT, 'apps/documenteditor/mobile/src/controller/settings/Settings.jsx');
const SETTINGS_PAGE = path.join(ROOT, 'apps/documenteditor/mobile/src/view/settings/SettingsPage.jsx');

/* Titles of the "Settings" list items in their order. */
function itemTitles(page) {
    return [...page.matchAll(/<ListItem\b[^>]*?\btitle=\{([^}]*)\}/g)].map(m => m[1].replace(/\s+/g, ' ').trim());
}

test('test_mobile_settings_help_goes_to_helpdesk', () => {
    const controller = fs.readFileSync(SETTINGS, 'utf8');
    const code = controller.replace(/^\/\*[\s\S]*?\*\//, '');    // the copyright header stays as it is
    for (const token of ['__HELP_URL__', 'mobile-applications', 'index.aspx', 'helpcenter', 'onlyoffice'])
        assert.ok(!code.toLowerCase().includes(token.toLowerCase()), 'Settings.jsx still has ' + token);
    has(controller, /^import About from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/common\/mobile\/lib\/view\/About';$/m,
        'Settings.jsx imports the common mobile About');

    /* The settings close first, then the helpdesk of the interface language opens in a new tab. */
    const {About} = loadPlain();
    const showHelp = cut(controller, /const showHelp = /);
    for (const [lang, url] of [['ru', RU_HELP], ['en', COM_HELP], ['de', COM_HELP], ['kk', COM_HELP]]) {
        const log = [];
        const context = {
            About,
            Common: {Locale: {currentLang: lang}},
            closeModal: () => log.push(['close']),
            setTimeout: (fn, delay) => { log.push(['timeout', delay]); fn(); },
            window: {open: (...args) => log.push(['open', ...args])}
        };
        vm.runInNewContext(showHelp + '\nshowHelp();', context, {filename: SETTINGS});
        assert.deepEqual(log, [['close'], ['timeout', 400], ['open', url, '_blank']], lang);
    }

    /* The item stays where it was: shown unless customization.help === false, runs showHelp of the context. */
    const page = fs.readFileSync(SETTINGS_PAGE, 'utf8');
    has(page, /_canHelp = appOptions\.customization\.help !== false;/, 'customization.help gate is kept');
    has(page.replace(/\s+/g, ' '), /\{_canHelp && <ListItem title=\{_t\.textHelp\} link="#" className='no-indicator' onClick=\{settingsContext\.showHelp\}>/,
        'Help item runs showHelp');
    has(controller.replace(/\s+/g, ' '), /<SettingsContext\.Provider value=\{\{[^}]*\bshowHelp,/, 'showHelp is in the settings context');
});

test('test_mobile_settings_has_no_feedback', () => {
    const controller = fs.readFileSync(SETTINGS, 'utf8');
    const page = fs.readFileSync(SETTINGS_PAGE, 'utf8');
    for (const token of ['showFeedback', '__SUPPORT_URL__', 'feedback'])
        assert.ok(!controller.toLowerCase().includes(token.toLowerCase()), 'Settings.jsx still has ' + token);
    for (const token of ['_canFeedback', 'textFeedback', 'showFeedback', 'IconFeedback', 'icon-feedback', 'feedback'])
        assert.ok(!page.toLowerCase().includes(token.toLowerCase()), 'SettingsPage.jsx still has ' + token);

    /* The context keeps every other action. */
    const provider = /<SettingsContext\.Provider value=\{\{([^}]*)\}\}>/.exec(controller);
    assert.ok(provider, 'SettingsContext.Provider value');
    assert.deepEqual(provider[1].split(',').map(s => s.trim()).filter(Boolean),
        ['onPrint', 'showHelp', 'onOrthographyCheck', 'onDownloadOrigin', 'onChangeMobileView', 'changeTitleHandler',
            'closeModal', 'clearAllFields', 'toggleFavorite', 'switchAutosave', 'tryToSave', 'saveAsPdf', 'submitForm']);

    /* The end of the list: document info, Help, About, then closing the editor — the feedback item between About
     * and closing is gone, its neighbours stay. */
    assert.deepEqual(itemTitles(page).slice(-4),
        ['_t.textDocumentInfo', '_t.textHelp', '_t.textAbout', 'closeButtonText ?? t(\'Settings.textClose\')']);
    has(page.replace(/\s+/g, ' '), /\{_canAbout && <ListItem title=\{_t\.textAbout\} link="\/about\/">/, 'About item opens the About page');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
