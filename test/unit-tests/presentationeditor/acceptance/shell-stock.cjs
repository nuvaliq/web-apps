/* Run: node test/unit-tests/presentationeditor/acceptance/shell-stock.cjs [--only <name>] [--stock <ref>]
 * The acceptance harness tells stock view files from shell ones by the release
 * commit the fork starts from, not by the fork branch: once the shell is on the
 * fork branch, a merge base with it would count the shell as stock.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./shell-harness.cjs');

async function stockViewFilesComeFromTheReleaseCommit() {
    const base = H.stockBase();
    assert.ok(base, 'the stock commit ' + H.STOCK.slice(0, 10) + ' is not in this clone, pass --stock <ref>');
    assert.doesNotThrow(() => H.git(['merge-base', '--is-ancestor', base, 'HEAD']),
        'the stock commit is not in the history of HEAD');
    const stock = H.stockViewNames();
    for (const name of ['Toolbar', 'Viewport', 'Statusbar', 'LeftMenu', 'DocumentHolder']) {
        assert.ok(stock.has(name), name + ' is not counted as stock');
    }
    const own = H.SHELL_NAMES.filter(n => fs.existsSync(path.join(H.PE_VIEW, n + '.js')));
    assert.ok(own.length, 'no shell view files in this tree');
    assert.deepEqual(own.filter(n => stock.has(n)), [], 'shell view files counted as stock');
    const shell = new Set(H.shellViewNames());
    assert.deepEqual(own.filter(n => !shell.has(n)), [], 'shell view files missing from the shell list');
}

H.run([
    {name: 'stock_view_files_come_from_the_release_commit', fn: stockViewFilesComeFromTheReleaseCommit}
]);
