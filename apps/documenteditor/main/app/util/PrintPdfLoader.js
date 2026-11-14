/*
 * PrintPdfLoader — loading and checking the response before printing.
 * Part of the web-apps fork, AGPL-3.0.
 */
define([], function () {
    'use strict';

    function error(code, status) {
        var result = new Error('Print PDF: ' + code);
        result.code = code;
        if (status !== undefined) result.status = status;
        return result;
    }

    function sameOriginUrl(value) {
        if (typeof value !== 'string' || !value.trim() || /[\x00-\x20\x7f]/.test(value)) {
            throw error('url');
        }
        var url;
        try {
            url = new URL(value, location.origin + '/');
        } catch (ignore) {
            throw error('url');
        }
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') ||
            url.origin !== location.origin || url.username || url.password) {
            throw error('url');
        }
        return url.href;
    }

    function validHeader(bytes) {
        return bytes.length === 9 && bytes[0] === 37 && bytes[1] === 80 &&
            bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45 && bytes[6] === 46 &&
            ((bytes[5] === 49 && bytes[7] >= 48 && bytes[7] <= 55) ||
                (bytes[5] === 50 && bytes[7] === 48)) &&
            (bytes[8] === 10 || bytes[8] === 13);
    }

    function validEof(bytes) {
        // The extra byte preserves CR/LF before the marker at the window boundary.
        var first = Math.max(0, bytes.length - 1024);
        for (var i = bytes.length - 5; i >= first; i--) {
            if (bytes[i] !== 37 || bytes[i + 1] !== 37 || bytes[i + 2] !== 69 ||
                bytes[i + 3] !== 79 || bytes[i + 4] !== 70) continue;
            if (i === 0 || (bytes[i - 1] !== 10 && bytes[i - 1] !== 13)) return false;
            for (var j = i + 5; j < bytes.length; j++) {
                var b = bytes[j];
                if (b !== 0 && b !== 9 && b !== 10 && b !== 12 && b !== 13 && b !== 32) return false;
            }
            return true;
        }
        return false;
    }

    /* attempt.isCurrent() checks that it belongs to the current document/attempt.
     * attempt.deadline — the initial wait limit for headers/first bytes.
     * A non-empty chunk extends it by 30 seconds, only if the limit has not yet expired.
     * After the body — 30 seconds for validation and the viewer; onDeadline synchronizes the owner.
     * Without ReadableStream progress is unavailable: blob() is limited by the initial limit.
     * attempt.signal (optional) cancels only this load. For immediate
     * cancellation of a hung transport the owner calls abort, isCurrent alone is not enough.
     * The result is Promise<Blob>; error codes are not notification texts.
     * The SDK, UI waiting, frame and object URL remain the caller's responsibility.
     */
    function loadValidatedPdf(value, attempt) {
        return new Promise(function (resolve, reject) {
            var settled = false, timer, controller, signal, isCurrent, deadline, reader, chunks = [];

            function closeReader(cancelBody) {
                var activeReader = reader;
                reader = null;
                if (!activeReader) return;
                if (cancelBody) {
                    try { Promise.resolve(activeReader.cancel()).catch(function () {}); } catch (ignore) {}
                }
                try { activeReader.releaseLock(); } catch (ignore) {}
            }

            function finish(reason, blob) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                chunks = [];
                closeReader(!!reason);
                if (signal) signal.removeEventListener('abort', cancel);
                if (reason) {
                    reject(reason);
                    if (controller) controller.abort();
                } else {
                    resolve(blob);
                }
            }

            function cancel() {
                finish(error('cancelled'));
            }

            function current() {
                if (settled) return false;
                try {
                    if (!isCurrent()) throw error('cancelled');
                    if (Date.now() >= deadline) throw error('timeout');
                } catch (reason) {
                    finish(reason);
                    return false;
                }
                return true;
            }

            function fail(reason) {
                if (current()) finish(reason);
            }

            function timeout() {
                if (current()) timer = setTimeout(timeout, deadline - Date.now());
            }

            function extendDeadline() {
                deadline = Date.now() + 30000;
                if (attempt.onDeadline) attempt.onDeadline(deadline);
            }

            function readBody(response) {
                if (!response.body || typeof response.body.getReader !== 'function') {
                    return response.blob().then(function (blob) {
                        if (!current()) return;
                        extendDeadline();
                        return blob;
                    });
                }
                reader = response.body.getReader();
                function read() {
                    return reader.read().then(function (part) {
                        // The old limit first: late bytes after thaw do not revive the load.
                        if (!current()) return;
                        if (part.done) {
                            extendDeadline(); // The shared limit for Blob assembly, validation and the viewer.
                            closeReader(false);
                            var body = new Blob(chunks);
                            chunks = [];
                            return body;
                        }
                        if (part.value && part.value.byteLength) {
                            chunks.push(part.value);
                            extendDeadline();
                        }
                        return read();
                    });
                }
                return read();
            }

            try {
                if (!attempt || typeof attempt.isCurrent !== 'function' ||
                    typeof attempt.deadline !== 'number' || !isFinite(attempt.deadline) ||
                    attempt.deadline > Date.now() + 30000 ||
                    attempt.onDeadline !== undefined && typeof attempt.onDeadline !== 'function') throw error('attempt');
                isCurrent = attempt.isCurrent;
                deadline = attempt.deadline;
                signal = attempt.signal;
                if (!current()) return;
                if (signal && signal.aborted) { cancel(); return; }
                var url = sameOriginUrl(value);
                controller = new AbortController();
                if (signal) signal.addEventListener('abort', cancel);
                timer = setTimeout(timeout, deadline - Date.now());
                if (!current()) return;

                Promise.resolve(fetch(url, {
                    method: 'GET',
                    mode: 'same-origin',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    redirect: 'error',
                    signal: controller.signal
                })).then(function (response) {
                    if (!current()) return;
                    if (response.status !== 200) throw error('http', response.status);
                    if (response.redirected || response.type === 'opaqueredirect') throw error('redirect');
                    if (response.url) sameOriginUrl(response.url);
                    var mime = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
                    if (mime !== '' && mime !== 'application/pdf' && mime !== 'application/octet-stream') {
                        throw error('mime');
                    }
                    return readBody(response);
                }).then(function (blob) {
                    if (!current()) return;
                    if (!blob || !blob.size) throw error('pdf');
                    return blob.slice(0, 9).arrayBuffer().then(function (header) {
                        if (!current()) return;
                        if (!validHeader(new Uint8Array(header))) throw error('pdf');
                        return blob.slice(Math.max(0, blob.size - 1025)).arrayBuffer();
                    }).then(function (tail) {
                        if (!current()) return;
                        if (!validEof(new Uint8Array(tail))) throw error('pdf');
                        var pdf = new Blob([blob], {type: 'application/pdf'});
                        if (current()) finish(null, pdf);
                    });
                }).catch(fail);
            } catch (reason) {
                finish(reason);
            }
        });
    }

    return {loadValidatedPdf: loadValidatedPdf};
});
