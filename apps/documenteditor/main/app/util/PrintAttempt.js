/*
 * PrintAttempt — ownership of loading the PDF and handing it to the browser.
 * Part of the web-apps fork, AGPL-3.0.
 */
define(['documenteditor/main/app/util/PrintPdfLoader'], function (PrintPdfLoader) {
    'use strict';

    // One handed-over viewer per browser realm, including when the document changes.
    // Neither input, nor dispose, nor the return of print proves that the native preview was closed.
    var retained = null;

    function safely(fn) {
        try { if (fn) fn(); } catch (ignore) {}
    }

    function release(attempt) {
        if (!attempt) return;
        var frame = attempt.frame, url = attempt.objectUrl;
        attempt.frame = attempt.objectUrl = null;
        if (frame) {
            frame.onload = frame.onerror = null;
            safely(function () { if (frame.parentNode) frame.parentNode.removeChild(frame); });
        }
        if (url) safely(function () { URL.revokeObjectURL(url); });
    }

    window.addEventListener('unload', function () {
        release(retained);
        retained = null;
    });

    function PrintAttempt(options) {
        this.options = options;
        this.active = this.expected = this.dispatching = null;
        this.disposed = false;
        this.onUnload = this.dispose.bind(this);
        window.addEventListener('unload', this.onUnload);
    }

    PrintAttempt.prototype.currentOwner = function (owner) {
        try { return !this.disposed && this.options.isCurrent(owner); }
        catch (ignore) { return false; }
    };

    PrintAttempt.prototype.request = function (owner, dispatch) {
        if (this.active && !this.currentOwner(this.active.owner)) this.finish(this.active);
        if (!this.currentOwner(owner) || this.active || this.dispatching) return false;
        this.dispatching = {owner: owner};
        try {
            // The SDK keeps its own checks, conversion and errors. A silent return
            // does not create a wait and does not erase the permit of a previously accepted command.
            dispatch();
        } finally {
            this.dispatching = null;
        }
        return true;
    };

    PrintAttempt.prototype.observeStart = function () {
        if (this.dispatching) this.expected = this.dispatching;
    };

    PrintAttempt.prototype.stopWait = function (attempt) {
        clearTimeout(attempt.timer);
        clearTimeout(attempt.startTimer);
        var hide = attempt.hideWait;
        attempt.hideWait = null;
        safely(hide);
    };

    PrintAttempt.prototype.finish = function (attempt, error) {
        if (this.active !== attempt || attempt.terminal) return;
        var notify = error && this.currentOwner(attempt.owner);
        attempt.terminal = true;
        this.active = null;
        this.stopWait(attempt);
        safely(function () { if (attempt.abort) attempt.abort.abort(); });
        release(attempt);
        if (notify) this.report(error);
    };

    PrintAttempt.prototype.report = function (error) {
        var me = this;
        safely(function () { me.options.onError(error); });
    };

    PrintAttempt.prototype.check = function (attempt) {
        if (this.active !== attempt || attempt.terminal) return false;
        if (!this.currentOwner(attempt.owner)) {
            this.finish(attempt);
            return false;
        }
        if (Date.now() >= attempt.deadline) {
            this.finish(attempt, {code: 'timeout'});
            return false;
        }
        return true;
    };

    PrintAttempt.prototype.acceptUrl = function (url) {
        // This permit means only the synchronous StartAction inside asc_Print.
        // It is NOT a request ID and does not correlate SDK transport responses.
        if (this.disposed || this.active || !this.expected) return;
        var owner = this.expected.owner;
        this.expected = null;
        if (!this.currentOwner(owner)) return;
        var me = this, attempt = {owner: owner, deadline: Date.now() + 30000, terminal: false};
        this.active = attempt;
        // Do not interrupt the SDK dispatcher/EndAction with an exception or by starting a GET.
        // Even an invalid URL is handled after returning from the SDK callback.
        try {
            attempt.startTimer = setTimeout(function () { me.start(url, attempt); }, 0);
        } catch (error) {
            this.finish(attempt, error);
        }
    };

    PrintAttempt.prototype.start = function (url, attempt) {
        if (!this.check(attempt)) return;
        var me = this;
        try {
            attempt.abort = new AbortController();
            attempt.hideWait = this.options.showWait();
            if (!this.check(attempt)) return;
            function timeout() {
                if (me.check(attempt)) attempt.timer = setTimeout(timeout, attempt.deadline - Date.now());
            }
            attempt.timer = setTimeout(timeout, attempt.deadline - Date.now());
            PrintPdfLoader.loadValidatedPdf(url, {
                deadline: attempt.deadline,
                onDeadline: function (deadline) { attempt.deadline = deadline; },
                signal: attempt.abort.signal,
                isCurrent: function () { return me.check(attempt); }
            }).then(function (blob) {
                if (me.check(attempt)) me.attach(blob, attempt);
            }).catch(function (error) {
                if (me.check(attempt)) me.finish(attempt, error);
            });
        } catch (error) {
            if (this.check(attempt)) this.finish(attempt, error);
        }
    };

    PrintAttempt.prototype.attach = function (blob, attempt) {
        if (!this.check(attempt)) return;
        var me = this;
        try {
            if (attempt.owner.download) {
                // We pass only the verified Blob. The SDK helper itself owns the download URL;
                // its deferred revoke does not depend on dispose or the next attempt.
                attempt.terminal = true;
                this.stopWait(attempt);
                try {
                    this.options.download(blob, attempt.owner.filename);
                } catch (error) {
                    this.report(error);
                } finally {
                    this.active = null;
                }
                return;
            }
            // The new bytes are already verified. Replacement as in baseline, but only after
            // validation: at most one frame/URL. A failure after this point does not
            // restore the old preview, but cleans up the new frame that was not handed over.
            release(retained);
            retained = null;
            // The Blob was obtained only from PrintPdfLoader, without a second GET.
            attempt.objectUrl = URL.createObjectURL(blob);
            if (!this.check(attempt)) return;
            var frame = attempt.frame = document.createElement('iframe');
            frame.id = 'id-print-frame';
            frame.setAttribute('aria-hidden', 'true');
            frame.setAttribute('tabindex', '-1');
            frame.style.position = 'fixed';
            frame.style.right = frame.style.bottom = '0';
            frame.style.width = frame.style.height = '1px';
            frame.style.border = '0';
            frame.style.opacity = '0';
            frame.style.pointerEvents = 'none';
            frame.onload = function () {
                if (!me.check(attempt)) return;
                try {
                    if (frame !== attempt.frame || frame.src !== attempt.objectUrl) return;
                    var viewerUrl = null;
                    try {
                        viewerUrl = frame.contentWindow.location.href;
                    } catch (error) {
                        // Firefox PDF.js forbids reading location, but allows print.
                        // The exception is acceptable only for accessing the address of its own Blob frame.
                        if (!error || error.name !== 'SecurityError') throw error;
                    }
                    if (viewerUrl === 'about:blank') return;
                    if (viewerUrl !== null && viewerUrl !== attempt.objectUrl) throw new Error('Print viewer navigation');
                    frame.contentWindow.focus();
                    if (!me.check(attempt)) return;
                    // The new frame is ready to hand over; the return does not mean it was closed.
                    attempt.terminal = true;
                    frame.onload = frame.onerror = null;
                    me.stopWait(attempt);
                    retained = attempt;
                    try {
                        frame.contentWindow.print();
                    } catch (error) {
                        // The exception is ambiguous: the browser may have already opened the preview.
                        // Keep the frame/Blob, with no fallback and no repeated print.
                        me.report(error);
                    } finally {
                        me.active = null;
                    }
                    safely(function () { frame.contentWindow.blur(); window.focus(); });
                } catch (error) {
                    me.finish(attempt, error);
                }
            };
            frame.onerror = function () {
                if (me.check(attempt)) me.finish(attempt, {code: 'viewer'});
            };
            // src before insertion rules out an intentional intermediate blank navigation;
            // onload filters out a blank load by the available address and checks the assigned Blob src.
            frame.src = attempt.objectUrl;
            if (this.check(attempt)) document.body.appendChild(frame);
        } catch (error) {
            if (this.check(attempt)) this.finish(attempt, error);
        }
    };

    PrintAttempt.prototype.dispose = function () {
        if (this.disposed) return;
        this.disposed = true;
        this.expected = this.dispatching = null;
        if (this.active) this.finish(this.active);
        window.removeEventListener('unload', this.onUnload);
        // retained is released by the next successful handover or unload.
    };

    return PrintAttempt;
});
