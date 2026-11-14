/* Run: node test/unit-tests/documenteditor/print-pdf-loader.cjs [AMD-file] [real.pdf]
 * An isolated PDF loading contract; the clock and transport are controlled by the test.
 * It does not check the SDK, UI or native viewer. The binary fixture is not part of the repository.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const file = process.argv[2] || path.resolve(__dirname,
    '../../../apps/documenteditor/main/app/util/PrintPdfLoader.js');
const source = fs.readFileSync(file, 'utf8');
const origin = 'https://editor.example.test';
const pdf = Buffer.from('%PDF-1.7\r\n%\xff\xfe\x80\x81\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return {promise, resolve, reject};
}
function response(bytes = pdf, mime = 'application/pdf', extra = {}) {
    return Object.assign({status: 200, redirected: false, url: origin + '/printfile/a',
        headers: {get: name => { assert.equal(name, 'Content-Type'); return mime; }},
        blob: () => Promise.resolve(new Blob([bytes]))}, extra);
}
function stream() {
    const reads = [];
    let cancelled = 0, released = 0;
    const reader = {
        read() { const next = deferred(); reads.push(next); return next.promise; },
        cancel() { cancelled++; return Promise.resolve(); },
        releaseLock() { released++; }
    };
    return {body: {getReader: () => reader}, reads,
        get cancelled() { return cancelled; }, get released() { return released; },
        chunk(value) { assert.ok(reads.length, 'pending stream read'); reads.shift().resolve({value, done: false}); },
        end() { assert.ok(reads.length, 'pending stream read'); reads.shift().resolve({done: true}); }};
}
function harness(fetcher = () => Promise.resolve(response()), extra = {}) {
    let now = 1000, current = true, api, checks = 0, sequence = 0;
    const timers = new Map(), calls = [], allTimers = [];
    const context = {
        Blob, Uint8Array, URL, AbortController, Promise,
        location: {origin}, Date: {now: () => now},
        setTimeout(callback, delay) {
            const id = ++sequence;
            timers.set(id, {callback, at: now + delay}); allTimers.push(callback); return id;
        },
        clearTimeout: id => timers.delete(id),
        fetch(url, options) { calls.push({url, options}); return fetcher(url, options); },
        define(dependencies, factory) { assert.equal(dependencies.length, 0); api = factory(); },
        ...extra
    };
    vm.runInNewContext(source, context, {filename: file});
    return {
        calls, timers, allTimers,
        get checks() { return checks; },
        set current(value) { current = value; },
        set now(value) { now = value; },
        tick(value) {
            now = value;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= now) { timers.delete(id); timer.callback(); }
            }
        },
        load(url, options = {}) {
            if (arguments.length === 0) url = '/printfile/a';
            const result = {state: 'pending'};
            result.promise = api.loadValidatedPdf(url, {
                deadline: 31000, isCurrent: () => { checks++; return current; }, ...options
            });
            result.promise.then(blob => { result.state = 'fulfilled'; result.blob = blob; },
                error => { result.state = 'rejected'; result.error = error; });
            return result;
        }
    };
}
async function rejected(result, code) {
    await flush();
    assert.equal(result.state, 'rejected');
    if (code) assert.equal(result.error.code, code);
}
async function fulfilled(result, bytes = pdf) {
    const blob = await result.promise;
    assert.equal(blob.type, 'application/pdf');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
}
let passed = 0, failed = 0;
async function check(name, fn) {
    let watchdog;
    try {
        await Promise.race([Promise.resolve().then(fn), new Promise((resolve, reject) => {
            watchdog = setTimeout(() => reject(new Error('test did not settle')), 5000);
        })]);
        console.log('PASS', name); passed++;
    } catch (error) { console.error('FAIL', name, error.stack); failed++; }
    finally { clearTimeout(watchdog); }
}
async function main() {
    await check('one GET preserves opaque path/query and returns the same binary bytes', async () => {
        const h = harness();
        await fulfilled(h.load('/printfile/key_4?shardkey=x%2Fy&vo_sess=s%2Bz'));
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0].url, origin + '/printfile/key_4?shardkey=x%2Fy&vo_sess=s%2Bz');
        const opts = h.calls[0].options;
        assert.equal(opts.method, 'GET');
        for (const [key, value] of Object.entries({mode: 'same-origin', credentials: 'same-origin',
            cache: 'no-store', redirect: 'error'})) assert.equal(opts[key], value);
        assert.equal(opts.headers, undefined, 'no Range header');
        assert.ok(opts.signal instanceof AbortSignal);
        assert.equal(opts.signal.aborted, false);
        assert.equal(h.timers.size, 0);
    });
    await check('relative URL resolves at editor origin, not the current document path', async () => {
        const h = harness(); await fulfilled(h.load('printfile/a'));
        assert.equal(h.calls[0].url, origin + '/printfile/a');
    });
    for (const url of ['', ' ', null, undefined, 42, 'https://foreign.example.test/a',
        '//foreign.example.test/a', 'http://editor.example.test/a', origin + ':444/a',
        'data:application/pdf,x', 'blob:' + origin + '/x', 'javascript:alert(1)',
        'https://user:password@editor.example.test/a', 'https://[', '/printfile/\na']) {
        await check('reject URL ' + JSON.stringify(url), async () => {
            const h = harness();
            const r = h.load(url);
            await rejected(r, 'url'); assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
        });
    }
    for (const status of [0, 204, 206, 301, 302, 304, 307, 308, 401, 403, 404, 500, 502, 503]) {
        await check('reject HTTP ' + status + ' without reading its body', async () => {
            const h = harness(() => Promise.resolve(response(pdf, 'application/pdf', {
                status, blob() { throw new Error('body must not be read'); }
            })));
            const r = h.load(); await rejected(r, 'http');
            assert.equal(r.error.status, status); assert.equal(h.calls.length, 1);
            assert.equal(h.calls[0].options.signal.aborted, true); assert.equal(h.timers.size, 0);
        });
    }
    for (const extra of [{redirected: true}, {type: 'opaqueredirect'},
        {url: 'https://foreign.example.test/pdf'}]) {
        await check('reject redirected/cross-origin response ' + JSON.stringify(extra), async () => {
            const h = harness(() => Promise.resolve(response(pdf, 'application/pdf', extra)));
            await rejected(h.load()); assert.equal(h.timers.size, 0);
        });
    }
    for (const mime of ['application/pdf', ' APPLICATION/PDF ; charset=binary',
        'application/octet-stream', '', null]) {
        await check('accept MIME ' + JSON.stringify(mime) + ' only with valid bytes', async () => {
            await fulfilled(harness(() => Promise.resolve(response(pdf, mime))).load());
        });
    }
    for (const mime of ['text/html', 'application/json', 'text/plain', 'image/png', 'application/pdfx']) {
        await check('reject MIME ' + mime, async () => {
            await rejected(harness(() => Promise.resolve(response(pdf, mime))).load(), 'mime');
        });
    }
    for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0']) {
        await check('accept header version ' + version + ' CR and LF', async () => {
            for (const eol of ['\r', '\n']) {
                const bytes = Buffer.from('%PDF-' + version + eol + 'body\n%%EOF\0\t\n\f\r ');
                await fulfilled(harness(() => Promise.resolve(response(bytes))).load(), bytes);
            }
        });
    }
    for (const bytes of ['', '<html>404</html>', '{"error":"access"}', '\ufeff%PDF-1.7\n%%EOF',
        ' %PDF-1.7\n%%EOF', '%PDF-1.8\n%%EOF', '%PDF-2.1\n%%EOF', '%PDF-1.7 %%EOF',
        '%PDF-1.7\nbody', '%PDF-1.7\nbody%%EOF', '%PDF-1.7\n%%EO',
        '%PDF-1.7\n%%EOF\v', '%PDF-1.7\n%%EOF\nHTML',
        '%PDF-1.7\n%%EOF\n%%EOFx', '%PDF-1.7\n%%EOF' + ' '.repeat(1020)]) {
        await check('reject empty/spoofed/truncated envelope ' + JSON.stringify(bytes.slice(0, 45)), async () => {
            await rejected(harness(() => Promise.resolve(response(bytes))).load(), 'pdf');
        });
    }
    await check('EOF window boundary preserves preceding newline and uses the last marker', async () => {
        const bytes = Buffer.from('%PDF-1.7\n%%EOF\n%%EOF' + ' '.repeat(1019));
        await fulfilled(harness(() => Promise.resolve(response(bytes))).load(), bytes);
    });
    await check('only small Blob slices are read, never whole-body text/arrayBuffer', async () => {
        const slices = [];
        const body = new Blob([pdf]);
        body.text = body.arrayBuffer = () => { throw new Error('whole-body read'); };
        body.slice = (start, end) => {
            const part = Blob.prototype.slice.call(body, start, end);
            slices.push(part.size); return part;
        };
        await fulfilled(harness(() => Promise.resolve(response(pdf, '', {blob: () => Promise.resolve(body)}))).load());
        assert.equal(slices.length, 2); assert.equal(slices[0], 9); assert.ok(slices[1] <= 1025);
    });
    for (const failure of ['fetch throws', 'fetch rejects', 'body throws', 'body rejects', 'body unavailable', 'slice rejects', 'allocation']) {
        await check('settles and cleans up on ' + failure, async () => {
            const h = harness(() => {
                if (failure === 'fetch throws') throw new Error('network');
                if (failure === 'fetch rejects') return Promise.reject(new Error('network'));
                return Promise.resolve(response(pdf, '', {blob() {
                    if (failure === 'body throws') throw new Error('body');
                    if (failure === 'body rejects') return Promise.reject(new Error('body'));
                    if (failure === 'body unavailable') return Promise.resolve(null);
                    if (failure === 'slice rejects') return Promise.resolve({size: 40,
                        slice: () => ({arrayBuffer: () => Promise.reject(new Error('slice'))})});
                    return Promise.resolve(new Blob([pdf]));
                }}));
            }, failure === 'allocation' ? {Blob: function () { throw new Error('allocation'); }} : {});
            await rejected(h.load()); assert.equal(h.timers.size, 0);
            assert.equal(h.calls[0].options.signal.aborted, true);
        });
    }
    await check('waits for the full delayed body', async () => {
        const body = deferred(); const h = harness(() => Promise.resolve(response(pdf, '', {blob: () => body.promise})));
        const r = h.load(); await flush(); assert.equal(r.state, 'pending');
        h.tick(30999); await flush(); assert.equal(r.state, 'pending');
        body.resolve(new Blob([pdf])); await fulfilled(r); assert.equal(h.timers.size, 0);
    });
    for (const phase of ['fetch', 'body', 'header', 'tail']) {
        for (const reason of ['timeout', 'cancel']) {
            await check(reason + ' settles stalled ' + phase + ' even when abort is ignored', async () => {
                const late = deferred(), abort = new AbortController();
                let bodyReads = 0, sliceReads = 0;
                const body = new Blob([pdf]);
                body.slice = (start, end) => {
                    sliceReads++;
                    if ((phase === 'header' && sliceReads === 1) || (phase === 'tail' && sliceReads === 2)) {
                        return {arrayBuffer: () => late.promise};
                    }
                    return Blob.prototype.slice.call(body, start, end);
                };
                const resp = response(pdf, '', {blob() { bodyReads++; return phase === 'body' ? late.promise : Promise.resolve(body); }});
                const h = harness(() => phase === 'fetch' ? late.promise : Promise.resolve(resp));
                const r = h.load('/printfile/a', {signal: abort.signal}); await flush();
                assert.equal(r.state, 'pending');
                if (reason === 'timeout') h.tick(31000); else abort.abort();
                await rejected(r, reason === 'timeout' ? 'timeout' : 'cancelled');
                assert.equal(h.calls[0].options.signal.aborted, true); assert.equal(h.timers.size, 0);
                const snapshot = [h.checks, bodyReads, sliceReads];
                late.resolve(phase === 'fetch' ? resp : phase === 'body' ? body : await Blob.prototype.slice.call(body, 0, 9).arrayBuffer());
                await flush();
                assert.deepEqual([h.checks, bodyReads, sliceReads], snapshot, 'late continuation has no later effects');
                assert.equal(r.state, 'rejected');
            });
        }
    }
    for (const phase of ['fetch', 'body', 'header', 'tail']) {
        await check('current-attempt guard after ' + phase, async () => {
            const late = deferred(); let reads = 0, slices = 0;
            const body = new Blob([pdf]);
            body.slice = (start, end) => {
                slices++;
                return (phase === 'header' && slices === 1) || (phase === 'tail' && slices === 2)
                    ? {arrayBuffer: () => late.promise} : Blob.prototype.slice.call(body, start, end);
            };
            const resp = response(pdf, '', {blob() { reads++; return phase === 'body' ? late.promise : Promise.resolve(body); }});
            const h = harness(() => phase === 'fetch' ? late.promise : Promise.resolve(resp));
            const r = h.load(); await flush(); h.current = false;
            const before = [reads, slices];
            late.resolve(phase === 'fetch' ? resp : phase === 'body' ? body : new ArrayBuffer(9));
            await rejected(r, 'cancelled'); assert.deepEqual([reads, slices], before);
            assert.equal(h.timers.size, 0);
        });
    }
    await check('initial inactivity deadline survives frozen timers and late headers', async () => {
        const late = deferred(); const h = harness(() => late.promise);
        const r = h.load('/printfile/a', {deadline: 5000});
        h.now = 5000; late.resolve(response()); await rejected(r, 'timeout');
        assert.equal(h.timers.size, 0);
    });
    await check('inactivity and validation deadlines are checked on thaw after body and slices', async () => {
        for (const phase of ['body', 'header', 'tail']) {
            const late = deferred(); let slices = 0;
            const body = new Blob([pdf]);
            body.slice = (start, end) => {
                slices++;
                return (phase === 'header' && slices === 1) || (phase === 'tail' && slices === 2)
                    ? {arrayBuffer: () => late.promise} : Blob.prototype.slice.call(body, start, end);
            };
            const h = harness(() => Promise.resolve(response(pdf, '', {blob: () => phase === 'body' ? late.promise : Promise.resolve(body)})));
            const r = h.load(); await flush(); h.now = 31000;
            late.resolve(phase === 'body' ? body : new ArrayBuffer(9)); await rejected(r, 'timeout');
        }
    });
    await check('expired, invalid or missing attempt contract never starts GET', async () => {
        for (const options of [{deadline: 1000}, {deadline: NaN}, {deadline: Infinity},
            {deadline: undefined}, {deadline: 31001}, {isCurrent: undefined}, {isCurrent: () => false},
            {isCurrent: () => { throw new Error('disposed'); }}, {signal: AbortSignal.abort()}]) {
            const h = harness(); await rejected(h.load('/printfile/a', options));
            assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
        }
    });
    await check('cancel removes only its listener and never aborts a successful or newer load', async () => {
        const signal = new EventTarget(); signal.aborted = false;
        const listeners = new Set();
        signal.addEventListener = (type, fn) => { assert.equal(type, 'abort'); listeners.add(fn); };
        signal.removeEventListener = (type, fn) => { assert.equal(type, 'abort'); listeners.delete(fn); };
        const late = deferred(); let index = 0;
        const h = harness(() => ++index === 1 ? late.promise : Promise.resolve(response()));
        const old = h.load('/printfile/a', {signal}); const cancel = [...listeners][0];
        cancel(); cancel(); await rejected(old, 'cancelled'); assert.equal(listeners.size, 0);
        const next = h.load('/printfile/b'); await fulfilled(next);
        const checks = h.checks;
        late.reject(new Error('late failure')); h.allTimers.forEach(fn => fn()); cancel(); await flush();
        assert.equal(h.checks, checks); assert.equal(next.state, 'fulfilled');
        assert.equal(h.calls[1].options.signal.aborted, false);
    });
    await check('late old success, rejection and timer leave a newer pending load untouched', async () => {
        for (const outcome of ['resolve', 'reject']) {
            const oldFetch = deferred(), nextFetch = deferred(), abort = new AbortController();
            let index = 0;
            const h = harness(() => ++index === 1 ? oldFetch.promise : nextFetch.promise);
            const old = h.load('/printfile/a', {signal: abort.signal});
            const oldTimer = h.allTimers[0];
            abort.abort(); await rejected(old, 'cancelled');
            const next = h.load('/printfile/b');
            const checks = h.checks;
            if (outcome === 'resolve') oldFetch.resolve(response());
            else oldFetch.reject(new Error('late network failure'));
            oldTimer(); await flush();
            assert.equal(h.checks, checks); assert.equal(next.state, 'pending');
            assert.equal(h.timers.size, 1); assert.equal(h.calls[1].options.signal.aborted, false);
            nextFetch.resolve(response()); await fulfilled(next); assert.equal(h.timers.size, 0);
        }
    });
    await check('deadline and currentness apply to rejected async continuations too', async () => {
        for (const phase of ['fetch', 'body', 'header', 'tail']) {
            for (const reason of ['timeout', 'cancelled']) {
                const late = deferred(); let slices = 0;
                const body = new Blob([pdf]);
                body.slice = (start, end) => {
                    slices++;
                    return (phase === 'header' && slices === 1) || (phase === 'tail' && slices === 2)
                        ? {arrayBuffer: () => late.promise} : Blob.prototype.slice.call(body, start, end);
                };
                const resp = response(pdf, '', {blob: () => phase === 'body' ? late.promise : Promise.resolve(body)});
                const h = harness(() => phase === 'fetch' ? late.promise : Promise.resolve(resp));
                const r = h.load(); await flush();
                if (reason === 'timeout') h.now = 31000; else h.current = false;
                late.reject(new Error('transport failure'));
                await rejected(r, reason); assert.equal(h.timers.size, 0);
            }
        }
    });
    await check('nonempty streamed bytes keep a download alive beyond 30 seconds without changing bytes', async () => {
        const body = stream(), h = harness(() => Promise.resolve(response(pdf, '', {body: body.body})));
        const r = h.load(); await flush();
        for (const [time, bytes] of [[20000, pdf.subarray(0, 9)], [40000, pdf.subarray(9, 20)], [60000, pdf.subarray(20)]]) {
            h.tick(time); body.chunk(bytes); await flush(); assert.equal(r.state, 'pending');
        }
        body.end(); await fulfilled(r);
        assert.equal(h.calls.length, 1); assert.equal(body.cancelled, 0); assert.equal(body.released, 1);
        assert.equal(h.timers.size, 0);
    });
    await check('headers alone do not extend inactivity while a streamed body stalls', async () => {
        const headers = deferred(), body = stream(), h = harness(() => headers.promise), r = h.load();
        h.tick(30000); headers.resolve(response(pdf, '', {body: body.body})); await flush();
        h.tick(31000); await rejected(r, 'timeout');
        assert.equal(body.cancelled, 1); assert.equal(body.released, 1);
    });
    await check('empty streamed chunks do not postpone inactivity timeout', async () => {
        const body = stream(), h = harness(() => Promise.resolve(response(pdf, '', {body: body.body})));
        const r = h.load(); await flush(); h.tick(30000); body.chunk(new Uint8Array()); await flush();
        h.tick(31000); await rejected(r, 'timeout'); assert.equal(body.cancelled, 1);
        assert.equal(h.calls[0].options.signal.aborted, true);
    });
    for (const failure of ['stall', 'cancel', 'reader-error', 'owner']) {
        await check(failure + ' after stream progress cancels the reader once and ignores its late bytes', async () => {
            const body = stream(), abort = new AbortController();
            const h = harness(() => Promise.resolve(response(pdf, '', {body: body.body})));
            const r = h.load('/printfile/a', {signal: abort.signal}); await flush();
            h.tick(20000); body.chunk(pdf.subarray(0, 9)); await flush();
            if (failure === 'stall') h.tick(50000);
            if (failure === 'cancel') abort.abort();
            if (failure === 'reader-error') body.reads.shift().reject(new Error('stream failed'));
            if (failure === 'owner') { h.current = false; body.chunk(pdf.subarray(9)); }
            await rejected(r, failure === 'stall' ? 'timeout' : failure === 'reader-error' ? undefined : 'cancelled');
            assert.equal(body.cancelled, 1); assert.equal(body.released, 1);
            assert.equal(h.calls[0].options.signal.aborted, true); assert.equal(h.timers.size, 0);
            if (body.reads.length) body.chunk(pdf.subarray(9));
            abort.abort(); h.allTimers.forEach(fn => fn()); await flush();
            assert.equal(r.state, 'rejected'); assert.equal(body.cancelled, 1);
        });
    }
    await check('nonempty bytes arriving after a frozen inactivity deadline cannot revive the stream', async () => {
        const body = stream(), h = harness(() => Promise.resolve(response(pdf, '', {body: body.body})));
        const r = h.load(); await flush(); h.now = 20000; body.chunk(pdf.subarray(0, 9)); await flush();
        h.now = 50000; body.chunk(pdf.subarray(9)); await rejected(r, 'timeout');
        assert.equal(body.cancelled, 1); assert.equal(h.timers.size, 0);
    });
    await check('body completion starts a bounded validation window without extending on slices', async () => {
        const pending = deferred(), header = deferred(), body = new Blob([pdf]);
        body.slice = () => ({arrayBuffer: () => header.promise});
        const deadlines = [], h = harness(() => Promise.resolve(response(pdf, '', {blob: () => pending.promise})));
        const r = h.load('/printfile/a', {onDeadline: value => deadlines.push(value)}); await flush();
        h.tick(20000); pending.resolve(body); await flush();
        assert.deepEqual(deadlines, [50000]);
        h.tick(31000); await flush(); assert.equal(r.state, 'pending');
        h.tick(50000); await rejected(r, 'timeout');
        header.resolve(new ArrayBuffer(9)); await flush(); assert.equal(h.timers.size, 0);
    });
    await check('success removes its cancellation listener', async () => {
        const signal = new EventTarget(); signal.aborted = false; let listener, removed;
        signal.addEventListener = (type, fn) => { listener = fn; };
        signal.removeEventListener = (type, fn) => { removed = fn; };
        const h = harness(); await fulfilled(h.load('/printfile/a', {signal}));
        assert.equal(listener, removed); listener(); assert.equal(h.calls[0].options.signal.aborted, false);
    });
    if (process.argv[3]) {
        await check('actual generator PDF roundtrip: all bytes preserved', async () => {
            const bytes = fs.readFileSync(process.argv[3]);
            assert.ok(bytes.length > 1024);
            const h = harness(() => Promise.resolve(response(bytes, 'application/pdf')));
            await fulfilled(h.load(), bytes); assert.equal(h.calls.length, 1);
            console.log('Fixture bytes:', bytes.length);
        });
    } else {
        console.log('NOT RUN actual generator PDF: pass an external real.pdf as the second argument');
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
