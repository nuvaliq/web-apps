/* Run: node test/unit-tests/presentationeditor/acceptance/shell-header.cjs [--only <name>]
 * Header of the presentation shell: order of the right cluster, rights for
 * download and print, portal capabilities and the document title.
 */
'use strict';

const assert = require('node:assert/strict');
const H = require('./shell-harness.cjs');

const NINE = ['Файл', 'Правка', 'Вид', 'Вставка', 'Формат', 'Слайд', 'Упорядочить', 'Совместная работа', 'Справка'];
const TITLE = 'Отчёт';

const isTitle = el => el.localName === 'input' || el.localName === 'textarea' || el.isContentEditable ||
    H.norm(el.textContent).includes(TITLE) || String(el.value || '').includes(TITLE);

async function header(rights) {
    const w = await H.makeWorld({rights});
    w.bootOrExplain();
    w.requireCss();
    const root = w.must('vo-header');
    const controls = H.controlsIn(w, root, {skip: isTitle});
    return {w, root, controls, sigs: controls.map(H.signature)};
}

/* indices of controls in `full` that are absent in `other` */
function lost(full, other) {
    const rest = other.sigs.slice();
    const out = [];
    full.sigs.forEach((s, i) => {
        const k = rest.indexOf(s);
        if (k >= 0) rest.splice(k, 1); else out.push(i);
    });
    return out;
}

async function clusterGroups() {
    const full = await header({});
    const noHistory = await header({canUseHistory: false});
    const noDownload = await header({canDownload: false, canPrint: false});
    const noAccess = await header({canRequestSharingSettings: false, sharingSettingsUrl: undefined});
    const reader = await header({isEdit: false, canEdit: false});
    const groups = {
        history: lost(full, noHistory),
        download: lost(full, noDownload),
        access: lost(full, noAccess)
    };
    const taken = new Set([].concat(groups.history, groups.download, groups.access));
    groups.mode = lost(full, reader).filter(i => !taken.has(i));
    return {full, groups};
}

function titleNode(w, root) {
    const all = root.querySelectorAll('*');
    return all.find(e => e.localName === 'input' || e.localName === 'textarea') ||
        all.find(e => e.isContentEditable) ||
        all.find(e => e.children.length === 0 && H.norm(e.textContent).includes(TITLE)) || null;
}

/* clicks every control in a fresh header and returns what was called */
async function clickAll(rights) {
    const h = await header(rights);
    const start = h.w.calls.length;
    for (const c of h.controls) {
        if (!c.isConnected) continue;
        h.w.click(c);
        h.w.doc.dispatchEvent(new H.DomEvent('keydown', {bubbles: true, key: 'Escape', keyCode: 27, which: 27}));
        h.w.drain(200);
    }
    return h.w.calls.slice(start);
}

async function headerRightClusterHistoryDownloadAccessModeWithoutComments() {
    const {full, groups} = await clusterGroups();
    const names = Object.keys(groups);
    for (const n of names) assert.ok(groups[n].length > 0, 'header: no ' + n + ' control on the right (controls: ' + full.sigs.join(' ; ') + ')');
    const max = a => Math.max(...a), min = a => Math.min(...a);
    assert.ok(max(groups.history) < min(groups.download), 'version history is not left of "Download"');
    assert.ok(max(groups.download) < min(groups.access), '"Download" is not left of document access');
    assert.ok(max(groups.access) < min(groups.mode), 'document access is not left of the mode switch');
    assert.equal(max(groups.mode), full.controls.length - 1, 'the mode switch is not the rightmost control');
    const known = new Set([].concat(...names.map(n => groups[n])));
    const extra = full.sigs.filter((s, i) => !known.has(i));
    assert.deepEqual(extra, [], 'header has controls beyond history, download, access and mode');

    const title = titleNode(full.w, full.root);
    assert.ok(title, 'header shows no presentation title');
    const first = full.controls[min(groups.history)];
    assert.ok(title.compareDocumentPosition(first) & 4, 'title is not on the left of the right cluster');
    const saved = full.root.querySelectorAll('*').find(e => [e.getAttribute('title'), e.getAttribute('aria-label'), e.children.length ? '' : H.norm(e.textContent)]
        .some(t => t === 'Сохранено' || t === 'Сохранение…'));
    assert.ok(saved, 'header shows no save state');
    assert.ok(saved.compareDocumentPosition(first) & 4, 'save state is not on the left of the right cluster');

    const calls = await clickAll({});
    const comments = calls.filter(c => /LeftMenu\.btnComments|Toolbar\.btnsComment|CommentsCtl/.test(c.who) ||
        (c.who === 'NC' && /^app:comment|^comments:/.test(c.what)) ||
        (c.who === 'LeftMenu' && String(c.args[0]) === 'comments'));
    assert.deepEqual(comments.map(c => c.who + ' ' + c.what), [], 'a header control opens comments');
}

function textsAfterClick(w, ctl) {
    const before = new Set(H.controlsIn(w, w.doc.body));
    w.click(ctl);
    const shown = H.controlsIn(w, w.doc.body).filter(c => !before.has(c));
    return shown.map(c => H.norm(c.textContent || c.getAttribute('title') || c.getAttribute('aria-label') || ''));
}

const FORMATS = ['PPTX', 'PDF', 'ODP'];
const has = (texts, re) => texts.some(t => re.test(t));

async function downloadAndPrintRightsRemoveItemsAndEmptyDownloadButton() {
    const {full, groups} = await clusterGroups();
    assert.ok(groups.download.length > 0, 'header has no "Download" control');
    const dlSig = full.sigs[groups.download[0]];

    const check = async (rights, where, want) => {
        const h = await header(rights);
        const k = h.sigs.indexOf(dlSig);
        if (!want.button) {
            assert.equal(k, -1, where + ': "Download" is still in the header');
            assert.equal(h.controls.length, full.controls.length - groups.download.length, where + ': header controls changed beyond "Download"');
        } else {
            assert.ok(k >= 0, where + ': "Download" is not in the header');
            const texts = textsAfterClick(h.w, h.controls[k]);
            for (const f of FORMATS) assert.equal(has(texts, new RegExp('\\b' + f + '\\b')), want.download, where + ': "Download" menu ' + (want.download ? 'lacks ' : 'still has ') + f + ' (' + texts.join(' · ') + ')');
            assert.equal(has(texts, /^Печать/), want.print, where + ': "Download" menu ' + (want.print ? 'lacks' : 'still has') + ' "Печать"');
        }
        /* "File → Download ▸": the formats are in the submenu; without the download right the whole item is absent, there is no empty submenu. */
        const opened = H.openSection(h.w, 'Файл');
        const file = opened.items.map(i => i.text);
        const dl = opened.items.find(i => /^Скачать(\s|$)/.test(i.text));
        assert.equal(!!dl, want.download, where + ': "Файл" ' + (want.download ? 'lacks' : 'still has') + ' "Скачать" (' + file.join(' · ') + ')');
        if (dl) {
            const before = new Set(H.controlsIn(h.w, h.w.doc.body));
            h.w.click(dl.el);
            const formats = H.controlsIn(h.w, h.w.doc.body).filter(c => !before.has(c)).map(c => H.norm(c.textContent));
            assert.deepEqual(formats, FORMATS.concat(['PNG']), where + ': "Файл → Скачать" is not the list of formats');
            H.closeSection(h.w, opened);
        }
        assert.equal(has(file, /^Печать/), want.print, where + ': "Файл" ' + (want.print ? 'lacks' : 'still has') + ' "Печать"');
    };
    await check({}, 'all rights', {button: true, download: true, print: true});
    await check({canDownload: false}, 'no download right', {button: true, download: false, print: true});
    await check({canPrint: false}, 'no print right', {button: true, download: true, print: false});
    await check({canDownload: false, canPrint: false}, 'no download and print rights', {button: false, download: false, print: false});
}

const PORTAL = [/^История версий/, /^Доступ к документу/, /^Переименовать/];

function editable(el) {
    if (el.localName === 'input' || el.localName === 'textarea') return !el.readOnly && !el.disabled;
    return el.isContentEditable;
}

async function portalWithoutAccessHistoryRenameDrawsNothingAndTitleIsFixed() {
    const {full, groups} = await clusterGroups();
    assert.ok(groups.history.length && groups.access.length, 'with the portal capabilities the header has no history or access control');
    const fullMenu = [].concat(...Object.values(H.menuTexts(full.w, NINE)));
    for (const re of PORTAL) assert.ok(has(fullMenu, re), 'with the portal capabilities the menu has no item ' + re);
    const fullTitle = titleNode(full.w, full.root);
    assert.ok(fullTitle && editable(fullTitle), 'with rename and edit rights the title is not editable');

    const rights = {canUseHistory: false, canRequestSharingSettings: false, sharingSettingsUrl: undefined, canRename: false};
    const none = await header(rights);
    assert.equal(none.controls.length, full.controls.length - groups.history.length - groups.access.length,
        'without the portal capabilities the header still has extra controls');
    const menu = [].concat(...Object.values(H.menuTexts(none.w, NINE)));
    for (const re of PORTAL) assert.ok(!has(menu, re), 'without the portal capabilities the menu still has ' + re);

    const calls = await clickAll(rights);
    const portal = calls.filter(c => (c.who === 'NC' && /^collaboration:(history|sharing)/.test(c.what)) ||
        (c.who === 'Gateway' && /^request(History|SharingSettings|Rename)$/.test(c.what)));
    assert.deepEqual(portal.map(c => c.who + ' ' + c.what), [], 'a control still reaches the portal');

    const h = await header(rights);
    const title = titleNode(h.w, h.root);
    assert.ok(title, 'header shows no presentation title');
    assert.ok(!editable(title), 'title is editable without the rename capability');
    const start = h.w.calls.length;
    if (title.localName === 'input' || title.localName === 'textarea') title.value = 'Новое имя';
    else title.textContent = 'Новое имя';
    for (const type of ['input', 'change']) title.dispatchEvent(new H.DomEvent(type, {bubbles: true}));
    title.dispatchEvent(new H.DomEvent('keydown', {bubbles: true, key: 'Enter', keyCode: 13, which: 13}));
    title.focus();
    title.blur();
    h.w.drain(500);
    const renames = h.w.calls.slice(start).filter(c => (c.who === 'Gateway' && c.what === 'requestRename') ||
        (c.who === 'LeftMenuCtl' && c.what === 'clickMenuFileItem' && /rename/i.test(String(c.args[0]))) ||
        (c.who === 'FileMenu.miRename') || (c.who === 'api' && /rename|title/i.test(c.what)));
    assert.deepEqual(renames.map(c => c.who + ' ' + c.what), [], 'title change is sent without the rename capability');
}

H.run([
    {name: 'header_right_cluster_history_download_access_mode_without_comments', fn: headerRightClusterHistoryDownloadAccessModeWithoutComments},
    {name: 'download_and_print_rights_remove_items_and_empty_download_button', fn: downloadAndPrintRightsRemoveItemsAndEmptyDownloadButton},
    {name: 'portal_without_access_history_rename_draws_nothing_and_title_is_fixed', fn: portalWithoutAccessHistoryRenameDrawsNothingAndTitleIsFixed}
]);
