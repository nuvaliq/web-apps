'use strict';
const assert = require('node:assert/strict'), {test} = require('node:test');
const {page, viewport} = require('./reporter-harness.cjs');

test('presenter metadata is copied and keeps the actual browser token type', () => {
    for (const type of ['open', 'session']) {
        const {original, started} = viewport(false, {type, token: type + '-token'});
        assert.equal(original.token, 'original-token'); assert.equal(original.translations, undefined);
        assert.notEqual(started, original); assert.equal(started.permissions, original.permissions);
        assert.equal(started.token, type + '-token'); assert.equal(started.tokenType, type);
    }
});

test('desktop metadata keeps its legacy token contract', () => {
    const {original, started} = viewport(true);
    assert.equal(started.token, 'legacy-token'); assert.equal(started.tokenType, undefined); assert.equal(original.token, 'original-token');
});

for (const file of ['app.reporter.js', 'app_dev.reporter.js']) {
    test(file + ' sets typed view metadata before requesting permissions', () => {
        for (const type of ['open', 'session']) {
            const p = page(file);
            const permissions = {edit: false, download: false};
            p.metadata({key: 'key', tokenType: type, token: 'value', permissions});
            assert.equal(p.api.info.TokenType, type); assert.equal(p.api.info.Token, 'value');
            assert.deepEqual(p.api.info.Permissions, permissions);
            assert.deepEqual(p.calls.find(c => c[0] === 'permissions'), ['permissions', 'view', true, type]);
        }
    });
    test(file + ' rejects unsupported browser token types before opening', () => {
        const p = page(file); p.metadata({key: 'key', tokenType: 'unknown', token: 'value'});
        assert.equal(p.calls.filter(c => c[0] === 'permissions').length, 0);
    });
    test(file + ' keeps desktop metadata without a browser type', () => {
        const p = page(file, true); p.metadata({key: 'key', token: 'legacy'});
        assert.equal(p.api.info.Token, 'legacy'); assert.equal(p.api.info.TokenType, undefined);
    });
}
