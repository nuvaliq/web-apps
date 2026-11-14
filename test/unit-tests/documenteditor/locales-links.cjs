/* Run: node test/unit-tests/documenteditor/locales-links.cjs
 * The documents editor locales do not lead to the publisher's sites: not a single string of main, forms, embed and mobile,
 * including the nested objects of the mobile
 * locales, contains an onlyoffice.com address. The form save error window
 * (DE.Controllers.ApplicationController.errorConnectToServer, ApplicationController.js — ID.Warning)
 * in ja and pt ends with a request to download the document, without a link to the server documentation.
 * The files are read as text: the format of the forms ja.json and pt.json (LF, no newline at the end) does not change.
 * The word "ONLYOFFICE" is in the locales only in the "About" strings about the basis and the trademark.
 * The trial license title and the mobile user limit window in the translations take
 * the product name via %1: Main.js and Main.jsx substitute textProductName into %1.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const APPS = ['main', 'forms', 'embed', 'mobile'];
const FORMS_LOCALE = path.join(ROOT, 'apps/documenteditor/forms/locale');
const KEY = 'DE.Controllers.ApplicationController.errorConnectToServer';
const ENDINGS = {
    'ja.json': 'ドキュメントをダウンロードするように求められます。',
    'pt.json': 'você será solicitado a baixar o documento.'
};
// Key paths where the ONLYOFFICE name is legitimate: "Based on ONLYOFFICE" and the trademark in "About".
const BRAND_KEYS = new Set([
    'Common.Views.About.txtBasedOn',
    'Common.Views.About.txtTrademark',
    'Common.Views.About.txtNonCode',
    'About.textBasedOn',
    'About.textTrademark',
    'About.textNonCode'
]);
// Translations where the product name was written as a word, not via %1.
const PRODUCT_NAME_VALUES = [
    ['main/locale/vi.json', 'DE.Controllers.Main.textNoLicenseTitle'],
    ['main/locale/bg.json', 'DE.Controllers.Main.textNoLicenseTitle'],
    ['main/locale/fi.json', 'DE.Controllers.Main.textNoLicenseTitle'],
    ['main/locale/ko.json', 'DE.Controllers.Main.textNoLicenseTitle'],
    ['main/locale/lv.json', 'DE.Controllers.Main.textNoLicenseTitle'],
    ['mobile/locale/ko.json', 'Main.warnNoLicenseUsers']
];

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

// All string values of an object with key paths, nested objects recursively.
function strings(value, prefix, out) {
    for (const [key, item] of Object.entries(value)) {
        const at = prefix ? `${prefix}.${key}` : key;
        if (typeof item === 'string') out.push([at, item]);
        else if (item && typeof item === 'object') strings(item, at, out);
    }
    return out;
}

// All main, forms, embed and mobile locales: [file relative to apps/documenteditor, parsed JSON].
function locales() {
    const out = [];
    for (const app of APPS) {
        const dir = path.join(ROOT, 'apps/documenteditor', app, 'locale');
        const names = fs.readdirSync(dir).filter(name => name.endsWith('.json'));
        assert.ok(names.length > 0, `${app}: локали найдены`);
        for (const name of names) {
            const file = `${app}/locale/${name}`;
            try {
                out.push([file, JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))]);
            } catch (error) {
                assert.fail(`${file}: JSON не разбирается — ${error.message}`);
            }
        }
    }
    assert.ok(out.length > 100, `прочитано локалей: ${out.length}`);
    return out;
}

test('test_locales_parse_and_have_no_publisher_links', () => {
    const hits = [];
    for (const [file, data] of locales())
        for (const [key, text] of strings(data, '', []))
            if (/onlyoffice\.com/i.test(text)) hits.push(`${file}: ${key}`);
    assert.deepEqual(hits, [], 'строки со ссылкой на onlyoffice.com');
});

test('test_locales_name_publisher_only_in_about_brand_lines', () => {
    const hits = [];
    for (const [file, data] of locales())
        for (const [key, text] of strings(data, '', []))
            if (/onlyoffice/i.test(text) && !BRAND_KEYS.has(key)) hits.push(`${file}: ${key}`);
    assert.deepEqual(hits, [], 'строки со словом ONLYOFFICE вне «О программе»');
});

test('test_license_titles_take_product_name_from_placeholder', () => {
    for (const [file, key] of PRODUCT_NAME_VALUES) {
        const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/documenteditor', file), 'utf8'));
        const found = strings(data, '', []).find(([at]) => at === key);
        assert.ok(found, `${file}: ключ ${key} есть`);
        const text = found[1];
        assert.ok(text.includes('%1'), `${file}: ${key} берёт имя продукта через %1, а не «${text}»`);
        assert.ok(!/onlyoffice/i.test(text), `${file}: ${key} без слова ONLYOFFICE`);
    }
});

test('test_forms_save_error_ends_without_link', () => {
    for (const [name, ending] of Object.entries(ENDINGS)) {
        const text = JSON.parse(fs.readFileSync(path.join(FORMS_LOCALE, name), 'utf8'))[KEY];
        assert.equal(typeof text, 'string', `${name}: ключ есть`);
        assert.ok(text.trim().length > 0, `${name}: значение непустое`);
        assert.ok(!text.includes('<a'), `${name}: в тексте нет ссылки`);
        assert.ok(text.endsWith(ending), `${name}: кончается на «${ending}», а не на «${text.slice(-60)}»`);
    }
});

test('test_forms_ja_pt_keep_file_format', () => {
    for (const name of Object.keys(ENDINGS)) {
        const source = fs.readFileSync(path.join(FORMS_LOCALE, name), 'utf8');
        assert.ok(!source.includes('\r'), `${name}: без \\r`);
        assert.ok(!source.endsWith('\n'), `${name}: без перевода строки в конце`);
    }
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
