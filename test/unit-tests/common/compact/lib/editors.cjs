/* Editors the shared compact layer is checked against.
 * Every test in test/unit-tests/common/compact/ runs its checks for each entry:
 *  - name   — editor name in messages;
 *  - app    — application folder from the repository root, null for the test editor;
 *  - cssEnv — environment variable with the path to the built app.css of the editor,
 *             null when the styles are compiled by the test itself;
 *  - adapter — path to the module that describes the editor menu for the shared layer:
 *             context(overrides), sections(ctx), adapter(ctx, Model), pinned and the rows
 *             the menu bar tests use (roles); absent while the editor has none yet.
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
    {name: 'fixture', app: null, cssEnv: null, adapter: path.join(__dirname, 'fixture-editor.cjs')}
];
