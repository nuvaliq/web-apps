/* Run: node test/unit-tests/documenteditor/static-pages.cjs
 * Static pages of the documents editor without the ONLYOFFICE brand.
 * HTML is not loaded in vm, so the test reads the sources and checks the text;
 * setBranding of the viewer and forms controllers is executed in vm on an empty jQuery stub.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;

const LOGO_BLOCK = /<div class="margin-right-large">\s*<a id="header-logo"[^>]*><\/a>\s*<\/div>/;
const UNSUPPORTED_TEXT = 'Sorry, VibeOffice is currently only supported in the latest versions of the Chrome, '
    + 'Firefox, Safari or Internet Explorer web browsers.';

const VIEWER_PAGES = [
    'apps/documenteditor/embed/index.html',
    'apps/documenteditor/embed/index.html.deploy',
    'apps/documenteditor/embed/index_loader.html',
    'apps/documenteditor/embed/index_loader.html.deploy'
];
const FORMS_PAGES = [
    'apps/documenteditor/forms/index.html',
    'apps/documenteditor/forms/index.html.deploy'
];
const EDITOR_PAGES = [
    'apps/documenteditor/main/index.html',
    'apps/documenteditor/main/index.html.deploy',
    'apps/documenteditor/main/index_loader.html',
    'apps/documenteditor/main/index_loader.html.deploy'
];
const MOBILE_PAGE = 'apps/documenteditor/mobile/src/index_dev.html';
const AIR_FILE_SVG_SHA256 = 'a33b0996535818ad3a04ffe1269e7b25c0093e7202299f6a39c763120bc65e91';

// A function body by name: from the signature to the matching closing brace.
function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `не найдено: ${signature}`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`не закрыто: ${signature}`);
}

// An empty jQuery selection: chained methods that do nothing, like $() without a node.
function emptyQuery(selectors) {
    return selector => {
        selectors.push(selector);
        const chain = new Proxy({length: 0}, {get: (t, k) => (k in t ? t[k] : () => chain)});
        return chain;
    };
}

// setBranding must not fail and must not touch the DOM bypassing jQuery when there is no logo node.
function checkBrandingWithoutNode(source, signature, extra) {
    const selectors = [];
    const context = Object.assign({$: emptyQuery(selectors), console: {log() {}}}, extra);
    const fn = vm.runInNewContext(`(${extractFunction(source, signature).replace(/^setBranding\s*:\s*/, '')})`,
        context);
    const values = [
        {logo: {visible: false}},
        {logo: {image: 'logo.svg', url: 'https://example.test/'}},
        {logo: {imageEmbedded: 'logo.svg', url: ''}},
        {logo: {}},
        {},
        undefined
    ];
    values.forEach(value => fn.call({}, value));
    assert.ok(selectors.length > 0, 'setBranding не обратился к узлу логотипа');
    selectors.forEach(selector => assert.equal(selector, '#header-logo'));
}

let passed = 0, failed = 0;
function test(name, body) {
    try {
        body();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}

test('test_viewer_pages_have_no_brand', () => {
    VIEWER_PAGES.forEach(file => {
        const html = read(file);
        assert.doesNotMatch(html, /onlyoffice/i, `${file}: упоминание ONLYOFFICE`);
        assert.doesNotMatch(html, /id="header-logo"/, `${file}: узел логотипа`);
        assert.doesNotMatch(html, LOGO_BLOCK, `${file}: блок логотипа`);
        assert.equal(count(html, UNSUPPORTED_TEXT), 2, `${file}: фраза о неподдерживаемом браузере`);
        assert.match(html, /<div class="group left">\s*<button id="id-btn-prev-field"/,
            `${file}: левая группа строки начинается с кнопок полей`);
    });
    checkBrandingWithoutNode(read('apps/documenteditor/embed/js/ApplicationController.js'),
        'function setBranding(value)');
});

test('test_forms_pages_have_no_brand', () => {
    FORMS_PAGES.forEach(file => {
        const html = read(file);
        assert.doesNotMatch(html, /onlyoffice/i, `${file}: упоминание ONLYOFFICE`);
        assert.doesNotMatch(html, /id="header-logo"/, `${file}: узел логотипа`);
        assert.doesNotMatch(html, LOGO_BLOCK, `${file}: блок логотипа`);
        assert.match(html, /<div class="group left">\s*<span id="id-btn-undo"/,
            `${file}: левая группа строки начинается с кнопок отмены`);
    });
    checkBrandingWithoutNode(read('apps/documenteditor/forms/app/controller/ApplicationController.js'),
        'setBranding: function (value)', {Common: {UI: {Themes: {isDarkTheme: () => false}}}});
});

test('test_editor_pages_title_product', () => {
    EDITOR_PAGES.forEach(file => {
        const html = read(file);
        const titles = html.match(/<title>[^<]*<\/title>/g) || [];
        assert.deepEqual(titles, ['<title>VibeOffice</title>'], `${file}: заголовок вкладки`);
        assert.doesNotMatch(html, /onlyoffice/i, `${file}: упоминание ONLYOFFICE`);
    });
    assert.doesNotMatch(read('apps/documenteditor/main/index.html.deploy'), /(^|[^\r])\n/,
        'index.html.deploy: концы строк CRLF');
});

test('test_editor_pages_favicon_is_air_document', () => {
    EDITOR_PAGES.concat(MOBILE_PAGE).forEach(file => {
        const html = read(file);
        assert.doesNotMatch(html, /favicon\.(ico|png)/, `${file}: подключён прежний значок`);
        const icons = html.match(/<link\b[^>]*\brel="(shortcut )?icon"[^>]*>/g) || [];
        assert.equal(icons.length, 1, `${file}: один значок вкладки`);
        assert.match(icons[0], /\btype="image\/svg\+xml"/, `${file}: тип значка`);
        const href = (icons[0].match(/\bhref="data:image\/svg\+xml,([^"]*)"/) || [])[1];
        assert.ok(href, `${file}: значок — data-URI SVG`);
        assert.doesNotMatch(href, /[\s<>"#]/, `${file}: data-URI URL-кодирован`);
        const svg = decodeURIComponent(href);
        assert.match(svg, /^<svg width="24" height="24" viewBox="0 0 24 24"/, `${file}: SVG 24×24`);
        assert.equal(crypto.createHash('sha256').update(svg, 'utf8').digest('hex'), AIR_FILE_SVG_SHA256,
            `${file}: значок — AIR outline file без изменений`);
    });
    assert.ok(fs.existsSync(path.join(ROOT, 'apps/documenteditor/main/resources/img/favicon.ico')),
        'favicon.ico остаётся в репозитории');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
