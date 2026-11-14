/* Run: node test/unit-tests/documenteditor/shared-service-worker-upstream.cjs [<sdkjs dir>]
 * The shared worker (apps/common/main/lib/util/document_editor_shared_service_worker.js) is a copy of
 * sdkjs common/serviceworker/document_editor_service_worker.js with a session-independent cache key.
 * Fails when the sdkjs worker is no longer the one the copy was made from, so an upstream change
 * gets ported into the copy. sdkjs is taken from the argument, then SDKJS_DIR, then ../sdkjs next
 * to web-apps; only the last one may be absent, and then the check is skipped.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../../..');
const UPSTREAM = 'common/serviceworker/document_editor_service_worker.js';
// sdkjs v9.4.0.129
const UPSTREAM_SHA256 = '8299ca5e5d27df5c16da9a88361c2fa2831ff491ea92f35eabab8877ea34b9e6';

function workerPath() {
    const explicit = process.argv[2] || process.env.SDKJS_DIR;
    if (explicit) {
        const file = path.join(explicit, UPSTREAM);
        if (!fs.existsSync(file)) {
            console.error('shared-service-worker-upstream: ' + file + ' not found');
            process.exit(2);
        }
        return file;
    }
    const sibling = path.join(ROOT, '../sdkjs', UPSTREAM);
    return fs.existsSync(sibling) ? sibling : null;
}

const file = workerPath();
if (!file) {
    console.log('shared-service-worker-upstream: skipped, sdkjs not found next to web-apps '
        + '(pass its path or set SDKJS_DIR)');
    process.exit(0);
}
const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (actual !== UPSTREAM_SHA256) {
    console.error('shared-service-worker-upstream: ' + file + ' changed (sha256 ' + actual + ').\n'
        + 'Port the change into apps/common/main/lib/util/document_editor_shared_service_worker.js, '
        + 'then record the new sha256 and sdkjs version here.');
    process.exit(1);
}
console.log('shared-service-worker-upstream: ok');
