/* The spreadsheet editor compact layer as app.less includes it: the shared shell files
 * (apps/common/main/resources/less/compact: tokens.less - defaults, menu.less - menu row
 * rules, about.less) in app.less order, then its own compact-shell.less - for a LESS
 * variable the last definition wins, so the shared rules receive the spreadsheet editor values. Before the layer app.less
 * includes the stock variables (common/main/resources/less/variables.less); the layer reads image paths
 * from them (STOCK_PATHS) - the layer source starts with their definitions taken from there. The style tests
 * build this layer without the rest of app.less; compact-shell.less can be replaced with a broken
 * copy (negative control). source(file) is the text for less.render with filename: APP_LESS
 * (the relative imports of app.less resolve from it); imports() lists the layer imports in order.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const APP_LESS = path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/app.less');
const OWN = '@import "compact-shell.less";';
const SHARED = /^@import\s+"[^"]*common\/main\/resources\/less\/compact\/[\w-]+\.less";\s*$/;
const STOCK_VARS = path.join(ROOT, 'apps/common/main/resources/less/variables.less');
const STOCK_PATHS = ['app-image-const-path', 'common-image-const-path'];

/* Stock path definitions from variables.less - lines as is. */
function stockPaths() {
    const text = fs.readFileSync(STOCK_VARS, 'utf8');
    return STOCK_PATHS.map(name => {
        const m = new RegExp('^@' + name + ':[^;\\n]*;', 'm').exec(text);
        if (!m) throw new Error('variables.less: @' + name + ' not found');
        return m[0];
    });
}

/* Layer imports in app.less: the shared shell files before compact-shell.less, then compact-shell.less itself. */
function imports() {
    const lines = fs.readFileSync(APP_LESS, 'utf8').split('\n').map(l => l.trim());
    const own = lines.indexOf(OWN);
    if (own < 0) throw new Error('app.less: ' + OWN + ' not found');
    let first = own;
    while (first > 0 && SHARED.test(lines[first - 1])) first--;
    return lines.slice(first, own + 1);
}

function source(lessFile) {
    return stockPaths().concat(
        imports().map(l => l === OWN ? '@import ' + JSON.stringify(path.resolve(lessFile)) + ';' : l)).join('\n');
}

module.exports = {ROOT, APP_LESS, imports, source};
