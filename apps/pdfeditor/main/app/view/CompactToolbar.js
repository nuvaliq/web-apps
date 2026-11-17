/*
 * CompactToolbar — the only bar of the PDF viewer.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The white card #vo-tb in the #vo-toolbar row. The shell has no separate header
 * and menu bar: everything is on this bar, in three zones:
 *
 *     PDF icon · name  |  ‹ [N] / M ›  [N% ▾] ↔  |
 *                         full screen · search · print · download · access · ⋮
 *
 * The middle zone is the pages and zoom group (data-group="nav"). The
 * "Navigation" panel opens with its own button over the document (NavigationPanel).
 *
 *  - The name and the access button are built by the frame (CompactShell): their rights,
 *    renaming and the lock without connection live there.
 *  - Pages — the stock "previous" and "next" of the ribbon and the number field; the number and
 *    the page count come from engine events, navigation is the stock goToPage.
 *  - Zoom — the "N% ▾" field: a click on the field selects the number and opens the list of
 *    values; an own number and Enter set the zoom (PdfActions.parseZoom), Esc
 *    restores the current one; ▾ opens and closes the list.
 *  - "Fit to width ↔ page" — one button: at the fit-to-width zoom it sets the
 *    whole page, otherwise — fit to width; the icon and the tooltip say what will happen.
 *  - "Full screen" — the full-screen mode of the editor window; there is no button if
 *    the browser does not allow it.
 *  - Search opens and closes the stock search bar (Ctrl+F).
 *  - "Print" — the stock print, "Download" — the original PDF in one click; without
 *    connection both are dimmed, like the download items of the menu bar.
 *  - "⋮" — the shared menu bar (Common.UI.Compact.MenuBar) as a single section; it is
 *    built by the frame.
 *
 * The frame (CompactShell) installs the bar by calling install(shell).
 */
define([
    'pdfeditor/main/app/view/StockBridge',
    'pdfeditor/main/app/view/PdfActions'
], function () {
    'use strict';

    if (window.PDFE === undefined) window.PDFE = {};
    if (PDFE.Views === undefined) PDFE.Views = {};

    var BAR_ID = 'vo-tb', END_ID = 'vo-tb-end';
    var PREV = 'Toolbar:btnPrevPage', NEXT = 'Toolbar:btnNextPage', PRINT = 'Toolbar:btnPrint';

    /* The PDF icon at the name — an editor file, the path is relative to the editor document. */
    var FILE_ICON = 'resources/img/compact/pdf.svg';

    /* The "fit to width" zoom in the engine event asc_onZoomChange(percent, type). */
    var FIT_WIDTH = 1;

    function icon(name, size) {
        var C = window.Common && Common.UI && Common.UI.Compact, I = C && C.Icons;
        try { return I && typeof I.svg === 'function' ? I.svg(name, size) || '' : ''; } catch (e) { return ''; }
    }

    function bridge() { return PDFE.Views.StockBridge; }
    function actions() { return PDFE.Views.PdfActions; }

    function ctl(name) {
        try { return (PDFE.getController && PDFE.getController(name)) || null; } catch (e) { return null; }
    }

    function el(tag, cls, attrs) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        Object.keys(attrs || {}).forEach(function (k) {
            if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
        });
        return n;
    }

    /* A click that puts the focus into a field keeps its whole value selected, so typing
       replaces it. The focus handler of the field selects the value; on mouseup the browser
       would put the caret at the click point instead (Chrome does so when select() changes
       nothing, as with the selection a field keeps from its last visit). A click into a field
       that already has the focus places the caret as usual. */
    function keepSelectionOnFocusClick(input) {
        var focusing = false;
        input.addEventListener('mousedown', function () { focusing = document.activeElement !== input; });
        input.addEventListener('mouseup', function (e) {
            if (focusing && e) e.preventDefault();
            focusing = false;
        });
    }

    /* A caption of the stock code — a locale string on the view prototype. */
    function stock(path) {
        var parts = path.split('.'), key = parts.pop(), o = window;
        for (var i = 0; i < parts.length && o; i++) o = o[parts[i]];
        if (!o) return '';
        var v = o.prototype && typeof o.prototype[key] === 'string' ? o.prototype[key] : o[key];
        return typeof v === 'string' ? v : '';
    }

    function format(text, args) {
        return String(text || '').replace(/\{(\d+)\}/g, function (m, i) { return args[i] === undefined ? m : args[i]; });
    }

    PDFE.Views.CompactToolbar = _.extend({

        shell: null,
        el: null,
        nav: null,           // the pages and zoom group
        pops: null,          // the wrappers of the bar lists
        unwatch: null,       // the unsubscribers from the stock buttons
        percent: null,       // the current engine zoom
        zoomType: 0,         // 0 custom, 1 fit to width, 2 fit to page size
        page: 0,             // the current engine page, zero-based
        pages: 0,            // the page count

        install: function (shell) {
            var me = this, nc = Common.NotificationCenter;
            this.shell = shell;
            var g = function (label, fn) { return me.guard(label, fn); };
            if (typeof shell.onApi === 'function') {
                shell.onApi('asc_onZoomChange', function (percent, type) { me.setZoom(percent, type); });
                shell.onApi('asc_onCountPages', function (count) { me.setPages(me.page, count); });
                shell.onApi('asc_onCurrentPage', function (page) { me.setPages(page, me.pages); });
            }
            /* The stock search:show handler is subscribed earlier: by the time of our call
               the bar is already created and shown. */
            nc.on('search:show', g('search:show', function () { me.watchSearchBar(); me.syncSearch(); }));
            nc.on('api:disconnect', g('api:disconnect', function () { me.syncNet(); }));
            if (typeof shell.command === 'function') shell.command('goToPage', g('go to page', function () { me.focusPage(); }));
            if (!this.onFullscreen) {
                this.onFullscreen = g('fullscreen state', function () { me.syncFullscreen(); });
                document.addEventListener('fullscreenchange', this.onFullscreen);
                document.addEventListener('webkitfullscreenchange', this.onFullscreen);
            }
            var host = typeof shell.rowEl === 'function' ? shell.rowEl('toolbar') : null;
            if (host && host.nodeType === 1) this.render(host);
        },

        unbind: function () {
            (this.unwatch || []).forEach(function (off) { off(); });
            this.unwatch = null;
            if (this.onDocClick) {
                document.removeEventListener('click', this.onDocClick);
                this.onDocClick = null;
            }
            if (this.onFullscreen) {
                document.removeEventListener('fullscreenchange', this.onFullscreen);
                document.removeEventListener('webkitfullscreenchange', this.onFullscreen);
                this.onFullscreen = null;
            }
        },

        guard: function (label, fn) {
            var shell = this.shell;
            return shell && typeof shell.guarded === 'function' ? shell.guarded('toolbar: ' + label, fn) : fn;
        },

        api: function () {
            var shell = this.shell;
            return shell && typeof shell.engineApi === 'function' ? shell.engineApi() : null;
        },

        /* --- Markup ------------------------------------------------------------- */

        render: function (host) {
            var me = this, a = actions(), shell = this.shell;
            if (this.el && this.el.parentNode === host) return this.el;
            this.pops = [];

            var bar = el('div', null, {id: BAR_ID, role: 'toolbar', 'aria-label': this.textToolbar_ARIA});
            this.el = bar;

            var start = el('div', 'vo-tb-start', {'data-zone': 'start'});
            start.appendChild(el('img', 'vo-file-icon', {src: FILE_ICON, alt: '', 'aria-hidden': 'true', draggable: 'false'}));
            if (shell && typeof shell.buildTitle === 'function') start.appendChild(shell.buildTitle());
            bar.appendChild(start);

            var mid = el('div', 'vo-tb-mid', {'data-zone': 'mid'});
            this.nav = this.buildNav();
            mid.appendChild(this.nav);
            bar.appendChild(mid);

            var end = el('div', 'vo-tb-end', {id: END_ID, 'data-zone': 'end'});
            if (a && a.fullscreenAvailable()) {
                end.appendChild(this.button('fullscreen', 'demonstration', a.textFullscreen, true,
                    function () { a.toggleFullscreen(); }));
            }
            end.appendChild(this.button('search', 'search', stock('PDFE.Views.LeftMenu.tipSearch'), true,
                function () { actions().toggleSearchBar(); }));
            if (a && a.canPrint()) {
                end.appendChild(this.button('print', 'print', stock('Common.Views.Header.tipPrint') || this.tipPrint,
                    false, function () { me.runNet('print', function () { a.print(); }); }));
            }
            if (a && a.canDownload()) {
                end.appendChild(this.button('download', 'download', stock('Common.Views.Header.tipDownload') || this.tipDownload,
                    false, function () { me.runNet('download', function () { a.download(undefined); }); }));
            }
            if (shell && typeof shell.buildCollabButton === 'function' && shell.canSharing()) {
                end.appendChild(shell.buildCollabButton('sharing'));
            }
            if (shell && typeof shell.buildMenu === 'function') {
                var more = el('div', 'vo-more', {'data-vo-wrap': 'more'});
                more.appendChild(shell.buildMenu());
                end.appendChild(more);
            }
            bar.appendChild(end);

            host.appendChild(bar);

            if (!this.onDocClick) {
                this.onDocClick = this.guard('outside click', function (e) { me.outside(e); });
                document.addEventListener('click', this.onDocClick);
            }
            this.watchTwins();
            this.readZoom();
            this.readPages();
            this.syncSearch();
            this.syncFullscreen();
            this.syncNet();
            return bar;
        },

        /* The pages and zoom group: ‹ [N] / M › | [N% ▾] ↔. */
        buildNav: function () {
            var me = this;
            var nav = el('div', 'vo-nav', {'data-group': 'nav'});
            var pages = el('div', 'vo-g', {'data-group': 'pages'});
            pages.appendChild(this.button('pagePrev', 'chevronL', stock('PDFE.Views.Toolbar.tipPrevPage'), false,
                function () { me.press(PREV); }));
            pages.appendChild(this.pagesControl());
            pages.appendChild(this.button('pageNext', 'chevronR', stock('PDFE.Views.Toolbar.tipNextPage'), false,
                function () { me.press(NEXT); }));
            var zoom = el('div', 'vo-g', {'data-group': 'zoom'});
            zoom.appendChild(this.zoomControl());
            zoom.appendChild(this.button('fit', 'fitLandscape', '', false, function () { me.toggleFit(); }));
            nav.appendChild(pages);
            nav.appendChild(zoom);
            return nav;
        },

        button: function (key, name, tip, toggle, run) {
            var b = el('button', 'vo-ib', {type: 'button', 'data-vo': key, title: tip || null, 'aria-label': tip || null});
            b.insertAdjacentHTML('beforeend', icon(name));
            if (toggle) b.setAttribute('aria-pressed', 'false');
            b.addEventListener('click', this.guard('click ' + key, function () { run(); }));
            return b;
        },

        /* A control of the bar or of its pages and zoom group (wherever that group stands). */
        btn: function (key) {
            var q = '[data-vo="' + key + '"]';
            return (this.el && this.el.querySelector(q)) || (this.nav && this.nav.querySelector(q)) || null;
        },

        /* The stock button through the bridge; the keyboard goes back to the engine. */
        press: function (ref) {
            var b = bridge();
            if (b && typeof b.run === 'function') b.run(ref);
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* --- Zoom --------------------------------------------------------------- */
        /* The field with a list of values and input of an own number. While the focus is in the field,
           the keyboard is not with the engine. */
        zoomControl: function () {
            var me = this, tip = stock('PDFE.Views.ViewTab.textZoom');
            var wrap = el('span', 'vo-pop-wrap vo-value vo-w-zoom', {'data-vo-wrap': 'zoom'});
            var box = el('span', 'vo-value-btn vo-zoom-box');
            var input = el('input', 'vo-zoom-input', {type: 'text', inputmode: 'decimal', autocomplete: 'off',
                spellcheck: 'false', 'data-vo': 'zoom', title: tip, 'aria-label': tip, role: 'combobox',
                'aria-haspopup': 'menu', 'aria-expanded': 'false'});
            var caret = el('button', 'vo-value-caret', {type: 'button', 'data-vo': 'zoomList', tabindex: '-1',
                title: tip, 'aria-label': tip, 'aria-haspopup': 'menu', 'aria-expanded': 'false'});
            caret.innerHTML = icon('chevron', 16);
            box.appendChild(input);
            box.appendChild(caret);
            var pop = el('div', 'vo-pop vo-pop-list', {role: 'menu', 'aria-label': tip, hidden: ''});
            ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach(function (name) {
                pop.addEventListener(name, function (e) { e.stopPropagation(); }, {passive: true});
            });
            wrap.appendChild(box);
            wrap.appendChild(pop);
            this.pops.push(wrap);

            var open = function (on) {
                if (on && pop.hasAttribute('hidden')) me.fillZoom(pop);
                me.setOpen(wrap, on);
            };
            input.addEventListener('focus', this.guard('zoom field focus', function () {
                me.engineKeys(false);
                input.select();
                open(true);
            }));
            keepSelectionOnFocusClick(input);
            input.addEventListener('blur', this.guard('zoom field blur', function (e) {
                var to = e && e.relatedTarget;
                if (to && wrap.contains(to)) return;
                open(false);
                me.syncZoomField();
                me.engineKeys(true);
            }));
            input.addEventListener('keydown', this.guard('zoom field key', function (e) {
                if (!e || e.ctrlKey || e.metaKey || e.altKey) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    me.zoomTyped();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    open(false);
                    me.leaveZoomField();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    open(true);
                    var first = pop.querySelector('.vo-pop-item.on') || pop.querySelector('.vo-pop-item');
                    first && first.focus();
                }
            }));
            /* ▾ does not take the focus from the field. */
            caret.addEventListener('mousedown', function (e) { e.preventDefault(); });
            caret.addEventListener('click', this.guard('zoom list', function () {
                open(pop.hasAttribute('hidden'));
            }));
            pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
            pop.addEventListener('click', function (e) { e.stopPropagation(); });
            pop.addEventListener('keydown', this.guard('zoom list keys', function (e) {
                if (!e) return;
                var rows = Array.prototype.slice.call(pop.querySelectorAll('.vo-pop-item'));
                var i = rows.indexOf(document.activeElement);
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    open(false);
                    input.focus();
                    return;
                }
                if (i < 0) return;
                if (e.key === 'ArrowDown') rows[(i + 1) % rows.length].focus();
                else if (e.key === 'ArrowUp') rows[(i - 1 + rows.length) % rows.length].focus();
                else return;
                e.preventDefault();
            }));
            return wrap;
        },

        fillZoom: function (pop) {
            var me = this, a = actions();
            while (pop.firstChild) pop.removeChild(pop.firstChild);
            var zooms = (a && a.ZOOMS) || [];
            var z = a && typeof a.zoomState === 'function' ? a.zoomState() : {percent: this.percent, type: 0};
            zooms.forEach(function (v) {
                var on = z.type === 0 && z.percent === v;
                var row = el('button', 'vo-pop-item' + (on ? ' on' : ''),
                    {type: 'button', role: 'menuitemradio', tabindex: '-1', 'aria-checked': on ? 'true' : 'false'});
                row.textContent = v + '%';
                row.addEventListener('click', me.guard('pick zoom', function () { me.applyZoom(v); }));
                pop.appendChild(row);
            });
        },

        applyZoom: function (v) {
            var a = actions();
            this.closePopovers();
            if (a && typeof a.zoomTo === 'function') a.zoomTo(v);
            this.leaveZoomField();
        },

        /* An own number from the field. Not a number — the field restores the current zoom and
           selects it again. */
        zoomTyped: function () {
            var a = actions(), input = this.btn('zoom');
            if (!input) return false;
            var v = a && typeof a.parseZoom === 'function' ? a.parseZoom(input.value) : null;
            if (v === null) {
                this.syncZoomField(true);
                input.select();
                return false;
            }
            this.applyZoom(v);
            return true;
        },

        leaveZoomField: function () {
            var input = this.btn('zoom');
            this.syncZoomField(true);
            if (input && document.activeElement === input) input.blur();
            Common.NotificationCenter.trigger('edit:complete');
        },

        syncZoomField: function (force) {
            var input = this.btn('zoom');
            if (!input || (!force && document.activeElement === input)) return;
            input.value = this.percent ? this.percent + '%' : '';
        },

        /* --- Pages -------------------------------------------------------------- */
        /* The number field and "/ count" in one box. The input is a one-based number; Enter
           goes to it, Esc restores the current number. The field does not accept a number outside
           the document (like the stock status bar field): the text gets selected, the field
           is marked as an error. While the focus is in the field, the keyboard is not with the engine. */
        pagesControl: function () {
            var me = this, tip = stock('PDFE.Views.Statusbar.goToPageText');
            var wrap = el('span', 'vo-page', {'data-vo-wrap': 'pages'});
            var box = el('span', 'vo-value-btn vo-page-box');
            var input = el('input', 'vo-page-input', {type: 'text', inputmode: 'numeric', autocomplete: 'off',
                spellcheck: 'false', 'data-vo': 'page', title: tip, 'aria-label': tip});
            box.appendChild(input);
            box.appendChild(el('span', 'vo-page-total', {'data-vo': 'pageTotal', 'aria-hidden': 'true'}));
            wrap.appendChild(box);

            /* A click on "/ count" is a click in the field. */
            box.addEventListener('mousedown', this.guard('page box click', function (e) {
                if (!e || e.target === input) return;
                e.preventDefault();
                input.focus();
            }));
            /* A click in the field selects the whole number, so typing replaces it. */
            input.addEventListener('focus', this.guard('page field focus', function () {
                me.engineKeys(false);
                input.select();
            }));
            keepSelectionOnFocusClick(input);
            input.addEventListener('blur', this.guard('page field blur', function () {
                me.engineKeys(true);
                me.setInvalid(false);
                me.syncPages();
            }));
            input.addEventListener('input', this.guard('page field input', function () {
                me.setInvalid(false);
                me.fitPages();
            }));
            input.addEventListener('keydown', this.guard('page field key', function (e) {
                if (!e || e.ctrlKey || e.metaKey || e.altKey) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    me.goToTyped();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    me.setInvalid(false);
                    input.value = String(me.page + 1);
                    input.blur();
                    Common.NotificationCenter.trigger('edit:complete');
                }
            }));
            return wrap;
        },

        goToTyped: function () {
            var input = this.btn('page'), api = this.api();
            if (!input) return false;
            var text = String(input.value || '').trim();
            var n = /^\d+$/.test(text) ? parseInt(text, 10) : NaN;
            if (!(n >= 1 && n <= this.pages) || !api || typeof api.goToPage !== 'function') {
                this.setInvalid(true);
                input.select();
                return false;
            }
            api.goToPage(n - 1);
            input.blur();
            Common.NotificationCenter.trigger('edit:complete');
            return true;
        },

        setInvalid: function (on) {
            var input = this.btn('page');
            if (!input) return;
            input.parentNode.classList.toggle('vo-invalid', !!on);
            if (on) {
                input.setAttribute('aria-invalid', 'true');
                input.title = stock('PDFE.Views.Statusbar.txtPageNumInvalid');
            } else {
                input.removeAttribute('aria-invalid');
                input.title = stock('PDFE.Views.Statusbar.goToPageText');
            }
        },

        /* "Go to page" of the "⋮" menu: the focus goes to the number field. */
        focusPage: function () {
            var input = this.btn('page');
            if (!input) return;
            input.focus();
            input.select();
        },

        engineKeys: function (on) {
            var shell = this.shell;
            if (shell && typeof shell.engineKeys === 'function') shell.engineKeys(on);
        },

        /* --- Lists -------------------------------------------------------------- */

        setOpen: function (wrap, open) {
            if (!wrap) return;
            if (open) {
                this.closePopovers(wrap);
                var shell = this.shell;
                if (shell && shell.menu && typeof shell.menu.close === 'function') shell.menu.close();
            }
            var pop = wrap.querySelector('.vo-pop');
            if (pop) { if (open) pop.removeAttribute('hidden'); else pop.setAttribute('hidden', ''); }
            wrap.classList.toggle('open', !!open);
            Array.prototype.forEach.call(wrap.querySelectorAll('[aria-expanded]'), function (n) {
                n.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        },

        closePopovers: function (except) {
            var me = this;
            (this.pops || []).forEach(function (w) {
                if (w === except) return;
                if (w.classList.contains('open')) me.setOpen(w, false);
            });
        },

        /* Whether a bar list is open — for the Esc of the frame. */
        isOpen: function () {
            return (this.pops || []).some(function (w) { return w.classList.contains('open'); });
        },

        outside: function (e) {
            var me = this, t = e && e.target;
            (this.pops || []).forEach(function (w) {
                if (w.classList.contains('open') && !w.contains(t)) me.setOpen(w, false);
            });
        },

        /* --- State --------------------------------------------------------------- */

        setPressed: function (key, on) {
            var b = this.btn(key);
            if (!b) return;
            b.classList.toggle('on', !!on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        },

        /* The value is what the engine has already given (asc_getZoom), after that — its
           callback asc_onZoomChange. */
        readZoom: function () {
            var a = actions(), z = a && typeof a.zoomState === 'function' ? a.zoomState() : null;
            if (z && z.percent) this.setZoom(z.percent, z.type);
            else this.syncFit();
        },

        setZoom: function (percent, type) {
            if (type !== undefined) this.zoomType = Number(type) || 0;
            this.syncFit();
            var v = Math.round(Number(percent));
            if (!isFinite(v) || v <= 0) return;
            this.percent = v;
            this.syncZoomField();
        },

        /* Fit to width now — the button will show and set the whole page, and
           vice versa. */
        toggleFit: function () {
            var a = actions();
            if (!a || typeof a.zoomFit !== 'function') return;
            a.zoomFit(this.zoomType === FIT_WIDTH ? 'page' : 'width');
            Common.NotificationCenter.trigger('edit:complete');
        },

        syncFit: function () {
            var b = this.btn('fit');
            if (!b) return;
            var wide = this.zoomType === FIT_WIDTH, want = wide ? 'fitPage' : 'fitLandscape';
            var tip = stock(wide ? 'PDFE.Views.ViewTab.tipFitToPage' : 'PDFE.Views.ViewTab.tipFitToWidth');
            if (b.getAttribute('data-icon') !== want) {
                while (b.firstChild) b.removeChild(b.firstChild);
                b.insertAdjacentHTML('beforeend', icon(wide ? 'fitPage' : 'fitLandscape'));
                b.setAttribute('data-icon', want);
            }
            b.title = tip;
            b.setAttribute('aria-label', tip);
        },

        /* The page number and count — what the engine gives now, after that — its
           callbacks asc_onCurrentPage and asc_onCountPages. */
        readPages: function () {
            var api = this.api(), page = this.page, count = this.pages;
            try {
                if (api && typeof api.getCurrentPage === 'function') page = api.getCurrentPage();
                if (api && typeof api.getCountPages === 'function') count = api.getCountPages();
            } catch (e) { /* the previous ones remain */ }
            this.setPages(page, count);
        },

        setPages: function (page, count) {
            this.page = Math.max(0, Number(page) || 0);
            this.pages = Math.max(0, Number(count) || 0);
            this.syncPages();
        },

        syncPages: function () {
            var input = this.btn('page'), total = this.btn('pageTotal');
            if (input && document.activeElement !== input)
                input.value = this.pages ? String(this.page + 1) : '';
            this.fitPages();
            if (total) total.textContent = '/ ' + this.pages;
            var box = input && input.parentNode;
            if (box) box.title = format(stock('PDFE.Views.Statusbar.pageIndexText'), [this.page + 1, this.pages]);
        },

        /* The field is as wide as the number (the digits are of one width); the digits missing up to
           the longest number of the document are room to the left of "‹". The number is pressed to "/",
           "‹" stands at the number, and "/ count" and "›" do not shift from page to page. A number longer
           than the longest one cannot be typed into the field: the document has no such number, and
           the field would not fit it. */
        fitPages: function () {
            var input = this.btn('page'), group = input && input.closest('[data-group="pages"]');
            if (!input) return;
            var most = String(this.pages || 1).length;
            input.maxLength = most;
            var digits = Math.min(Math.max(String(input.value).length, 1), most);
            input.style.setProperty('--vo-page-digits', String(digits));
            if (group) group.style.setProperty('--vo-page-room', String(most - digits));
        },

        syncTwin: function (key, ref) {
            var b = bridge(), st = b && typeof b.state === 'function' ? b.state(ref) : {exists: false};
            var btn = this.btn(key);
            if (!btn) return;
            btn.disabled = !st.exists || !!st.disabled;
        },

        /* The stock buttons the bar takes its availability from. */
        watchTwins: function () {
            var me = this, b = bridge();
            (this.unwatch || []).forEach(function (off) { off(); });
            this.unwatch = [];
            [['pagePrev', PREV], ['pageNext', NEXT]].forEach(function (w) {
                if (!me.btn(w[0])) return;
                if (b && typeof b.watch === 'function')
                    me.unwatch.push(b.watch(w[1], me.guard(w[0] + ' state', function () { me.syncTwin(w[0], w[1]); })));
                me.syncTwin(w[0], w[1]);
            });
            if (this.btn('print') && b && typeof b.watch === 'function')
                this.unwatch.push(b.watch(PRINT, this.guard('print state', function () { me.syncNet(); })));
        },

        /* Without connection "Download" and "Print" are dimmed (like the download items of the menu
           row); "Print" — also together with the stock print button. By a class and
           aria-disabled: on a press the availability is checked once more. */
        offline: function (key) {
            var shell = this.shell, ad = shell && shell.menuAdapter;
            var ctx = ad && typeof ad.context === 'function' ? ad.context() : null;
            if (ctx && typeof ctx.net === 'function' && ctx.net('download')) return true;
            if (key === 'print') {
                var a = actions();
                return !!(a && typeof a.twinOff === 'function' && a.twinOff(PRINT));
            }
            return false;
        },

        syncNet: function () {
            var me = this;
            ['download', 'print'].forEach(function (key) {
                var b = me.btn(key);
                if (!b) return;
                var off = me.offline(key);
                b.classList.toggle('vo-locked', off);
                b.setAttribute('aria-disabled', off ? 'true' : 'false');
            });
        },

        runNet: function (key, fn) {
            this.syncNet();
            if (this.offline(key)) return;
            fn();
            Common.NotificationCenter.trigger('edit:complete');
        },

        syncFullscreen: function () {
            var a = actions();
            this.setPressed('fullscreen', !!(a && typeof a.fullscreenOn === 'function' && a.fullscreenOn()));
        },

        /* The search bar is the stock Common.UI.SearchBar window of the Viewport controller:
           its showing and hiding (by the cross, Esc) give the pressed state of the magnifier. */
        watchSearchBar: function () {
            var me = this, vp = ctl('Viewport'), bar = vp && vp.searchBar;
            if (!bar || bar._voWatched || typeof bar.on !== 'function') return;
            bar._voWatched = true;
            var sync = this.guard('search bar state', function () { me.syncSearch(); });
            bar.on('show', sync);
            bar.on('hide', sync);
        },

        syncSearch: function () {
            var a = actions();
            this.setPressed('search', !!(a && typeof a.searchBarShown === 'function' && a.searchBarShown()));
        },

        /* --- Texts -------------------------------------------------------------- */

        textToolbar_ARIA: 'Toolbar',
        tipDownload: 'Download file',
        tipPrint: 'Print file'

    }, PDFE.Views.CompactToolbar || {});

    return PDFE.Views.CompactToolbar;
});
