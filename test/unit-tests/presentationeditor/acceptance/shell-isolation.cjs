/* Run: node test/unit-tests/presentationeditor/acceptance/shell-isolation.cjs
 *        [--only <name>] [--base <ref>]
 * The presentation shell leaves the document and spreadsheet editors alone.
 * The base of the diff is the fork base of HEAD (shell-harness forkBase):
 * --base <ref>, otherwise the merge base with b24/9.4.0 under any remote name.
 *
 * Out of scope here: the engine repositories (sdkjs, sdkjs-forms) are other
 * repositories, a web-apps branch cannot change them; and apps/common, where
 * the shell takes the shared compact layer from.
 */
'use strict';

const cp = require('node:child_process');
const assert = require('node:assert/strict');
const H = require('./shell-harness.cjs');

const OTHER_EDITORS = ['apps/documenteditor', 'apps/spreadsheeteditor'];

async function otherEditorsUntouchedAgainstBase() {
    const base = H.forkBase();
    assert.ok(base, 'no fork base: no copy of b24/9.4.0 in this clone, pass --base <ref>');
    const r = cp.spawnSync('git', ['diff', '--quiet', base, '--'].concat(OTHER_EDITORS), {cwd: H.ROOT, encoding: 'utf8'});
    if (r.status !== 0 && r.status !== 1) throw new Error('git diff failed: ' + String(r.stderr).trim());
    if (r.status === 1) {
        const stat = H.git(['diff', '--stat', base, '--'].concat(OTHER_EDITORS)).split('\n');
        assert.fail('diff against ' + base.slice(0, 10) + ' is not empty: ' + stat.slice(-1)[0].trim() + ' (' + stat.slice(0, 3).map(s => s.trim()).join('; ') + ')');
    }
    const untracked = H.git(['ls-files', '--others', '--exclude-standard', '--'].concat(OTHER_EDITORS));
    assert.equal(untracked, '', 'new files in the other editors');
}

H.run([
    {name: 'other_editors_untouched_against_base', fn: otherEditorsUntouchedAgainstBase}
]);
