/* Editors the shared compact layer is checked against.
 * Every test in test/unit-tests/common/compact/ runs its checks for each entry:
 *  - name   — editor name in messages;
 *  - app    — application folder from the repository root, null for the test editor;
 *  - cssEnv — environment variable with the path to the built app.css of the editor,
 *             null when the styles are compiled by the test itself;
 *  - adapter — path to the module that describes the editor menu for the shared layer:
 *             context(overrides), sections(ctx), adapter(ctx, Model), pinned and the rows
 *             the menu bar tests use (roles); absent while the editor has none yet;
 *  - drawsCssIcons — false: every icon of the editor shell comes from Common.UI.Compact.Icons
 *             (an inline --vo-air-src), its css draws none of the set itself.
 *  - menuRow — false: the editor shows the shared menu bar as one pinned section (a single menu
 *             button), not as a row of sections; the checks of a row (menu-bar, menu-bar-keys,
 *             menu-bar-overflow, through lib/menu-bar-page.cjs editorsWithAdapter) do not run with it,
 *             the editor checks its menu itself.
 * The application editors run their real catalog and adapter over a stand-in of the stock
 * editor. The PDF editor is a viewer: of the common reasons its menu meets only a lost
 * connection.
 * The test editor is a second consumer of the shared contract with its own sections,
 * reason texts and view values, so a shared module that silently relies on the document
 * editor fails here.
 */
const path = require('node:path');

module.exports = [
    {name: 'documenteditor', app: 'apps/documenteditor/main', cssEnv: 'COMPACT_CSS_DOCUMENTEDITOR',
        adapter: path.join(__dirname, 'documents-editor.cjs')},
    {name: 'spreadsheeteditor', app: 'apps/spreadsheeteditor/main', cssEnv: 'COMPACT_CSS_SPREADSHEETEDITOR',
        adapter: path.join(__dirname, 'sheets-editor.cjs')},
    {name: 'pdfeditor', app: 'apps/pdfeditor/main', cssEnv: 'COMPACT_CSS_PDFEDITOR',
        adapter: path.join(__dirname, 'pdf-editor.cjs'), drawsCssIcons: false, menuRow: false},
    {name: 'fixture', app: null, cssEnv: null, adapter: path.join(__dirname, 'fixture-editor.cjs')}
];
