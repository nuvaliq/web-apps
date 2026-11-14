/* Test editor: a second consumer of the shared compact menu contract.
 * Its sections, items, reason texts and view values are its own and differ from the
 * document editor on purpose: a shared module that works only with the document catalog
 * or its row heights fails on this editor.
 * The file has no requires: the menu bar tests load the same file into a browser page.
 *
 * context(overrides) gives the state the items read:
 *  - commands  — names of the editor commands that exist (needs);
 *  - reasons   — common reasons in force now, any order;
 *  - rights    — 'edit' or 'view';
 *  - selection, grid, snap, zoom, layers — the drawing state of the test editor;
 *  - history, print — the version history and printing exist.
 *  - guides    — names of the guides the Info section lists; its submenu is computed from
 *                them at every snapshot.
 *  - modal     — a window of the editor covers it.
 *  - gallery   — keys of the submenus the editor shows on its own surface outside the menu
 *                bar (a gallery of choices) instead of a list of the menu bar;
 *  - bar       — the menu bar the own rows and the gallery report to: a test sets it.
 * Unlike the document editor, the test editor nests a submenu in a submenu (depth: 2) and
 * gives items a hint on the right and a description. It declares its own disabled reasons
 * (REASONS): «no layers» ranks above «open for viewing», «no shape» after every common reason.
 * Every run(args), every call to the engine keys, every own row the adapter draws and every
 * closing of its gallery are recorded in context().log; every item state read by the adapter counts in context().reads.
 */

const REASON_TEXT = {
    noShape: 'No shape selected',
    noLayers: 'The drawing has no layers'
};

/* Disabled reasons of the test editor from the senior one: the common codes in their order
   and its own codes among them. */
const REASONS = ['limit', 'offline', 'noLayers', 'view', 'protected', 'noShape'];

/* Shortcuts of the test editor commands, keys joined with «+» as the stock registry gives them. */
const SHORTCUTS = {NewDrawing: 'Ctrl+Alt+N'};

/* View values of the test editor rows: header, menu, toolbar. */
const VARS = {'vo-h-header': '44px', 'vo-h-menu': '28px', 'vo-h-toolbar': '40px'};

function context(overrides) {
    const ctx = Object.assign({
        commands: ['exportSvg', 'snapGrid', 'zoom'],
        reasons: [],
        rights: 'edit',
        selection: false,
        grid: true,
        snap: 'grid',
        zoom: 100,
        layers: 0,
        modal: false,
        history: true,
        print: true,
        guides: ['Shapes', 'Layers'],
        gallery: [],
        bar: null,
        log: [],
        reads: 0
    }, overrides || {});
    ctx.has = name => ctx.commands.indexOf(name) >= 0;
    /* Common reasons that stop editing; the shared model picks the senior one. */
    ctx.edit = () => (ctx.reasons.length ? ctx.reasons.slice() : null);
    ctx.net = () => (ctx.reasons.indexOf('offline') >= 0 ? 'offline' : null);
    ctx.canEdit = () => ctx.rights === 'edit';
    return ctx;
}

function record(ctx, k) {
    return args => { ctx.log.push({k, args}); };
}

/* Sections of the test editor. Items read the context given to the snapshot. */
function sections(ctx) {
    ctx = ctx || context();
    const edit = c => c.canEdit();
    return [
        {k: 'drawing', t: 'Drawing', items: [
            {k: 'drawing.new', t: 'New drawing', kind: 'action', sc: 'NewDrawing', run: record(ctx, 'drawing.new')},
            {k: 'drawing.history', t: 'History', kind: 'action', when: c => c.history,
                run: record(ctx, 'drawing.history')},
            {k: 'drawing.export', t: 'Export', kind: 'submenu', items: [
                {k: 'drawing.export.png', t: 'PNG', kind: 'action', run: record(ctx, 'drawing.export.png')},
                {k: 'drawing.export.svg', t: 'SVG', kind: 'action', needs: 'exportSvg',
                    run: record(ctx, 'drawing.export.svg')}
            ]},
            {sep: true},
            {k: 'drawing.print', t: 'Print…', kind: 'action', when: c => c.print, disabled: c => c.net(),
                run: record(ctx, 'drawing.print')}
        ]},
        {k: 'shape', t: 'Shape', when: edit, items: [
            {k: 'shape.duplicate', t: 'Duplicate', kind: 'action', when: edit,
                disabled: c => [].concat(c.edit() || [], c.selection ? [] : ['noShape']),
                run: record(ctx, 'shape.duplicate')},
            {k: 'shape.delete', t: 'Delete', kind: 'action', when: edit,
                disabled: c => [].concat(c.edit() || [], c.selection ? [] : ['noShape']),
                run: record(ctx, 'shape.delete')},
            {sep: true},
            {k: 'shape.snapHead', t: 'Snap to', kind: 'group', when: edit},
            {k: 'shape.snapGrid', t: 'Grid', kind: 'radio', when: edit, needs: 'snapGrid',
                checked: c => c.snap === 'grid', disabled: c => c.edit(), run: record(ctx, 'shape.snapGrid')},
            {k: 'shape.snapShapes', t: 'Other shapes', kind: 'radio', when: edit,
                checked: c => c.snap === 'shapes', disabled: c => c.edit(), run: record(ctx, 'shape.snapShapes')}
        ]},
        {k: 'layout', t: 'Layout', items: [
            {k: 'layout.grid', t: 'Grid', kind: 'check', checked: c => c.grid, run: record(ctx, 'layout.grid')},
            {k: 'layout.zoom', t: c => 'Zoom ' + c.zoom + '%', kind: 'widget', needs: 'zoom',
                run: record(ctx, 'layout.zoom')},
            {sep: true},
            {k: 'layout.layers', t: 'Layers', kind: 'submenu', when: edit,
                disabled: c => [].concat(c.edit() || [], c.layers ? [] : ['noLayers']), items: [
                {k: 'layout.layers.merge', t: 'Merge layers', kind: 'action', run: record(ctx, 'layout.layers.merge')},
                {k: 'layout.layers.flatten', t: 'Flatten', kind: 'action', run: record(ctx, 'layout.layers.flatten')}
            ]}
        ]},
        {k: 'info', t: 'Info', items: [
            {k: 'info.about', t: 'About the test editor', kind: 'action', run: record(ctx, 'info.about')},
            {sep: true},
            {k: 'info.guides', t: 'Guides', kind: 'submenu', items: c => c.guides.map(name => ({
                k: 'info.guides.' + name, t: name, kind: 'action', desc: () => 'Opens the guide to ' + name.toLowerCase(),
                run: record(ctx, 'info.guides.' + name)
            })).concat([
                {sep: true},
                {k: 'info.keys', t: 'Keyboard', kind: 'submenu', items: [
                    {k: 'info.keys.drawing', t: 'Drawing keys', kind: 'action', hint: 'F1',
                        desc: 'Keys of the drawing area', disabled: c => c.edit(), run: record(ctx, 'info.keys.drawing')},
                    {k: 'info.keys.shape', t: 'Shape keys', kind: 'action', hint: now => (now.selection ? 'F2' : null),
                        run: record(ctx, 'info.keys.shape')}
                ]}
            ])}
        ]}
    ];
}

/* Submenus are nested two levels deep in the test editor. */
const DEPTH = 2;

const reasonText = code => REASON_TEXT[code] || null;

/* The test editor behind the shared menu bar contract. Model is Common.UI.Compact.MenuModel;
   the adapter reads the context given here, so a test changes the editor state by changing
   ctx and calling refresh() of the menu. A computed submenu is read by the menu bar itself
   through context(). Its own row is the zoom widget: the adapter draws the value, two buttons
   and a field into the row the menu bar hands to it; they run the zoom through exec of the
   menu bar. A submenu named in ctx.gallery opens as a gallery of the editor outside the menu
   bar: its choices run the items and report the closing to the menu bar (ownClosed). */
function adapter(ctx, Model) {
    const list = sections(ctx);
    const find = k => list.find(s => s.k === k);
    const keys = name => () => { ctx.log.push({keys: name}); };
    let gallery = null;
    const closeGallery = () => {
        if (gallery && gallery.parentNode) gallery.parentNode.removeChild(gallery);
        gallery = null;
    };
    const closed = how => {
        closeGallery();
        ctx.log.push({gallery: how});
        if (ctx.bar) ctx.bar.ownClosed(how);
    };
    const button = (doc, cls, text, label, onClick) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = text;
        b.setAttribute('tabindex', '-1');
        if (label) b.setAttribute('aria-label', label);
        b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
        return b;
    };
    const openGallery = (row, it) => {
        const doc = row.ownerDocument;
        closeGallery();
        gallery = doc.createElement('div');
        gallery.className = 'fixture-gallery';
        gallery.setAttribute('data-gallery', it.k);
        gallery.style.cssText = 'position:fixed;left:620px;top:120px;padding:8px;background:#eee';
        Model.itemsOf(it, ctx).forEach(choice => {
            if (Model.kindOf(choice) === 'sep') return;
            const b = button(doc, 'fixture-choice', choice.t, null, () => {
                if (choice.run) choice.run();
                closed('chosen');
            });
            b.setAttribute('data-choice', choice.k);
            gallery.appendChild(b);
        });
        gallery.appendChild(button(doc, 'fixture-dismiss', '×', 'Close', () => closed('dismissed')));
        doc.body.appendChild(gallery);
    };
    const drawZoom = (row, it, level) => {
        const doc = row.ownerDocument;
        ctx.log.push({openRow: it.k, level, row: row.getAttribute('data-k')});
        const run = zoom => ctx.bar && ctx.bar.exec(it, {zoom});
        const value = doc.createElement('span');
        value.className = 'fixture-value';
        value.textContent = ctx.zoom + '%';
        const field = doc.createElement('input');
        field.className = 'fixture-field';
        field.value = String(ctx.zoom);
        field.setAttribute('tabindex', '-1');
        field.setAttribute('aria-label', 'Zoom value');
        field.style.width = '40px';
        field.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            e.stopPropagation();
            run(Number(field.value));
        });
        row.appendChild(value);
        row.appendChild(button(doc, 'fixture-out', '−', 'Zoom out', () => run(ctx.zoom - 10)));
        row.appendChild(field);
        row.appendChild(button(doc, 'fixture-in', '+', 'Zoom in', () => run(ctx.zoom + 10)));
    };
    return {
        sections: () => list.map(s => ({k: s.k, t: s.t})),
        groups: k => (find(k) || {items: []}).items,
        context: () => ctx,
        itemState: it => { ctx.reads++; return Model.state(it, ctx, REASONS); },
        exec: (it, args) => { if (it.run) it.run(args); },
        shortcut: it => SHORTCUTS[it.sc] || null,
        openRow: (row, it, level) => {
            if (it.kind === 'widget') {
                drawZoom(row, it, level);
                return true;
            }
            if (it.kind !== 'submenu' || ctx.gallery.indexOf(it.k) < 0) return false;
            openGallery(row, it);
            return true;
        },
        closeRow: () => closeGallery(),
        owns: el => !!gallery && gallery.contains(el),
        focusRow: () => {
            const first = gallery && gallery.querySelector('button');
            if (!first) return false;
            first.focus();
            return true;
        },
        reasons: REASONS,
        reasonText,
        blocked: () => !!ctx.modal,
        keys: {hold: keys('hold'), release: keys('release'), beforeCommand: keys('beforeCommand')}
    };
}

/* Rows and state changes the shared menu bar tests use with this editor; every editor of
   lib/editors.cjs with an adapter gives the same roles for its own catalog. A role an editor
   has no row for yet is null, and the checks that need it name the editor as skipped. */
const roles = {
    order: ['drawing', 'shape', 'layout', 'info'],
    first: {k: 'drawing', label: 'Drawing', firstItem: 'drawing.new', lastItem: 'drawing.print'},
    second: {label: 'Shape', firstLocked: {}},
    scanFrom: 520,
    submenu: {section: 'drawing', row: 'drawing.export', index: 3, plain: 'drawing.new',
        rows: ['drawing.export.png', 'drawing.export.svg']},
    check: {section: 'layout', row: 'layout.grid', on: {grid: true}, off: {grid: false}},
    radio: {section: 'shape', context: {snap: 'shapes'}, rows: ['shape.snapGrid', 'shape.snapShapes'],
        checked: 'shape.snapShapes', header: {k: 'shape.snapHead', text: 'Snap to'}},
    /* A titled group of choices: the rows of the section in walk order, the options of the group
       among them, and a change of the checked option. */
    group: {section: 'shape', k: 'shape.snapHead', title: 'Snap to', context: {selection: true, snap: 'shapes'},
        walk: ['shape.duplicate', 'shape.delete', 'shape.snapGrid', 'shape.snapShapes'],
        options: ['shape.snapGrid', 'shape.snapShapes'], focus: 'shape.snapShapes', change: {snap: 'grid'},
        checked: 'shape.snapGrid'},
    /* A hint on the right instead of the shortcut, and a description in a second line; both read
       by items of the computed submenus of Info. */
    hint: {open: ['info', 'info.guides', 'info.keys'], row: 'info.keys.drawing', text: 'F1', none: 'info.keys.shape',
        shortcut: {section: 'drawing', row: 'drawing.new'}},
    desc: {open: ['info', 'info.guides'], row: 'info.guides.Shapes', label: 'Shapes', text: 'Opens the guide to shapes',
        none: 'info.keys'},
    widget: {section: 'layout', row: 'layout.zoom', context: {zoom: 150}, label: 'Zoom 150%', value: '150%',
        change: {zoom: 120}, changed: 'Zoom 120%',
        /* Rows and controls of the section in the walk order, the field and the control that
           zooms in by ten among them. */
        walk: ['layout.grid', '.fixture-out', '.fixture-field', '.fixture-in', 'layout.layers'],
        field: '.fixture-field', control: '.fixture-in', runs: {zoom: 160}},
    /* Submenus two levels deep: the rows that open them and their first rows; a change the
       second level shows after refresh. */
    deep: {section: 'info', rows: ['info.guides', 'info.keys'], firsts: ['info.guides.Shapes', 'info.keys.drawing'],
        change: {selection: true}, changed: {row: 'info.keys.shape', hint: 'F2'}},
    /* A submenu whose rows the editor computes from its state at every snapshot. */
    computed: {section: 'info', row: 'info.guides', rows: ['info.guides.Shapes', 'info.guides.Layers', 'info.keys'],
        change: {guides: ['Shapes', 'Text', 'Layers']},
        changed: ['info.guides.Shapes', 'info.guides.Text', 'info.guides.Layers', 'info.keys'],
        back: {guides: ['Shapes', 'Layers']}},
    /* A submenu the editor shows as its gallery outside the menu bar. */
    owned: {section: 'drawing', row: 'drawing.export', index: 3, context: {gallery: ['drawing.export']},
        surface: '.fixture-gallery', choice: '[data-choice="drawing.export.png"]', chosen: 'drawing.export.png',
        dismiss: '.fixture-dismiss'},
    /* The gallery of a row that goes grey (no layers left) or is gone (no editing right) after it opened. */
    ownedLock: {section: 'layout', row: 'layout.layers', context: {gallery: ['layout.layers'], layers: 2},
        surface: '.fixture-gallery', choice: '[data-choice="layout.layers.merge"]', after: {layers: 0},
        back: {layers: 2}, gone: {rights: 'view'}, title: 'The drawing has no layers'},
    locked: {context: {selection: false}, section: 'shape', row: 'shape.duplicate', title: 'No shape selected'},
    greyLater: {context: {selection: true}, section: 'shape', row: 'shape.delete', lock: {selection: false},
        title: 'No shape selected'},
    subLock: {section: 'layout', row: 'layout.layers', item: 'layout.layers.merge', before: {layers: 2}, after: {layers: 0},
        title: 'The drawing has no layers'},
    reasons: {net: {section: 'drawing', row: 'drawing.print'}, edit: {section: 'shape', row: 'shape.duplicate'},
        context: {selection: false}, own: 'No shape selected'},
    /* A code of the editor that its order ranks above a common reason in force: its text comes
       from the editor. */
    ownReason: {section: 'layout', row: 'layout.layers', context: {reasons: ['view'], layers: 0}, code: 'noLayers',
        title: 'The drawing has no layers'},
    /* A disabled row with a description: the screen reader hears the reason and the description. */
    descLocked: {open: ['info', 'info.guides', 'info.keys'], row: 'info.keys.drawing', context: {reasons: ['offline']},
        reason: 'No connection', desc: 'Keys of the drawing area'},
    shortcut: {section: 'drawing', row: 'drawing.new', text: 'Ctrl+Alt+N', mac: '⌘⌥N', plain: 'drawing.history'},
    tail: {k: 'layout', index: 2, label: 'Layout', rows: ['layout.grid', 'layout.zoom', 'layout.layers'], click: 'layout.grid'},
    about: 'info.about',
    viewer: {tops: ['drawing', 'layout'], editOnly: 'shape', editTops: ['drawing', 'shape', 'layout']},
    refresh: {index: 2, label: 'Layout', nextFirst: 'info.about', lockLabel: 'Shape', lockRow: 'shape.duplicate',
        lock: {}, unlock: {selection: true}},
    hide: {section: 'drawing', index: 0, middle: 'drawing.history', middleOff: {history: false}, next: 'drawing.export',
        last: 'drawing.print', lastOff: {print: false}, lastGone: ['drawing.print'], prev: 'drawing.export', restore: {history: true, print: true},
        rows: ['drawing.new', 'drawing.history', 'drawing.export', 'drawing.print']},
    emptied: {index: 1, label: 'Shape', focus: 'layout'},
    anySection: 'layout',
    /* A window of the test editor over the drawing; it has no loading mask. */
    modal: {on: {modal: true}, off: {modal: false}, mask: false}
};

module.exports = {
    name: 'fixture',
    roles,
    vars: VARS,
    /* The section the shell pins at the right of the menu bar, with its about entry. */
    pinned: 'info',
    depth: DEPTH,
    reasons: REASONS,
    context,
    sections,
    reasonText,
    adapter
};
