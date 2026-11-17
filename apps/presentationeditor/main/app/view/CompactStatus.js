/*
 * CompactStatus — the shell status bar.
 * Part of the web-apps fork, AGPL-3.0.
 *
 *     Slide N of M · language          Spell checking · Fit width · Fit slide
 *
 * The #vo-status row is as in documents: it lies over the bottom of the work area,
 * on the left the slide counter and the text language, on the right the text toggles.
 * There are no edge icons (view, edit, close) while they have no action.
 * There is no zoom or slide show here: there is a single zoom, on the panel.
 *
 * All of it are counterparts of the stock status bar (view/Statusbar.js): the counter is
 * the pageIndexText format driven by engine events, the language is btnLanguage and its menu,
 * spelling is the button that the stock bar controller puts there from
 * review (btnSpelling), fitting is btnZoomToWidth and btnZoomToPage.
 * Captions and availability come from the stock objects. No stock object — no
 * element either: without edit rights the stock code does not show the language and does not create
 * the spelling button.
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES.
 */
define([], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    var LANG = 'Statusbar:btnLanguage',
        FIT_WIDTH = 'Statusbar:btnZoomToWidth',
        FIT_SLIDE = 'Statusbar:btnZoomToPage';

    var POP_ID = 'vo-st-lang-pop';

    function ctl(name) {
        try { return (PE.getController && PE.getController(name)) || null; } catch (e) { return null; }
    }

    function bridge() {
        return PE.Views.StockBridge;
    }

    /* The stock status bar view and its prototype (texts, if there is no view). */
    function stockView() {
        var c = ctl('Statusbar');
        return (c && c.statusbar) || null;
    }

    function stockText(name) {
        var v = stockView();
        var s = v && v[name];
        if (typeof s !== 'string' || !s) {
            var proto = PE.Views.Statusbar && PE.Views.Statusbar.prototype;
            s = proto && proto[name];
        }
        return typeof s === 'string' ? s : '';
    }

    function isButton(o) {
        return !!o && typeof o === 'object' && typeof o.click === 'function';
    }

    function off(o) {
        return typeof o.isDisabled === 'function' ? !!o.isDisabled() : !!o.disabled;
    }

    /* A number from the stock page model; a foreign one — null. */
    function num(v) {
        return typeof v === 'number' && isFinite(v) ? v : null;
    }

    function el(tag, cls, attrs) {
        var n = document.createElement(tag);
        cls && n.setAttribute('class', cls);
        Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
        return n;
    }

    PE.Views.CompactStatus = _.extend({

        LANG: LANG,
        FIT_WIDTH: FIT_WIDTH,
        FIT_SLIDE: FIT_SLIDE,

        shell: null,
        host: null,
        nodes: null,         // own nodes of the bar: page, lang, spell, fitWidth, fitSlide
        pages: null,         // {current, count, start} — latest engine values

        install: function (shell) {
            var host = shell.rowEl('status');
            if (!host) return;
            this.shell = shell;
            this.host = host;
            this.pages = this.stockPages();
            this.build();
            this.bind();
            this.refresh();
        },

        /* --- Building ---------------------------------------------------------- */

        build: function () {
            var me = this, host = this.host, guarded = this.shell.guarded;
            var n = this.nodes = {};
            while (host.firstChild) host.removeChild(host.firstChild);

            n.page = el('span', 'vo-st-item vo-st-page');
            host.appendChild(n.page);

            /* Text language — only with edit rights: this is how the stock bar
               shows it (el-edit). Looks like a caption, on click — the stock list
               of languages. */
            if (this.shell.editRight() && this.langTwin()) {
                var tip = stockText('tipSetLang');
                n.lang = el('span', 'vo-st-item vo-st-lang', {role: 'button', tabindex: '0', 'aria-haspopup': 'menu'});
                tip && n.lang.setAttribute('title', tip);
                n.lang.addEventListener('click', guarded('status: language', function () { me.toggleLanguages(); }));
                n.lang.addEventListener('keydown', guarded('status: language key', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault && e.preventDefault();
                        me.toggleLanguages();
                    }
                }));
                host.appendChild(n.lang);
            }

            var spell = this.shell.editRight() && this.spellTwin();
            if (spell) {
                n.spell = this.button(this.spellCaption(), guarded('status: spelling', function () { me.runSpelling(); }));
                host.appendChild(n.spell);
            }

            [['fitWidth', FIT_WIDTH, 'tipFitWidth'], ['fitSlide', FIT_SLIDE, 'tipFitPage']].forEach(function (f) {
                if (!bridge().twin(f[1])) return;
                n[f[0]] = me.button(stockText(f[2]), guarded('status: ' + f[0], function () { bridge().run(f[1]); }));
                host.appendChild(n[f[0]]);
            });
        },

        button: function (caption, fn) {
            var b = el('button', 'vo-st-btn', {type: 'button'});
            b.textContent = caption;
            b.addEventListener('click', fn);
            return b;
        },

        /* --- Counterparts ------------------------------------------------------ */

        langTwin: function () {
            var o = bridge().twin(LANG);
            return isButton(o) && o.visible !== false && o.hidden !== true ? o : null;
        },

        /* The spelling button of the bar is put by the stock controller (getButton
           of review on app:face, only with edit rights); FeaturesManager
           may hide it. */
        spellTwin: function () {
            var c = ctl('Statusbar'), v = stockView();
            var o = (c && isButton(c.btnSpelling) && c.btnSpelling) || (v && isButton(v.btnSpelling) && v.btnSpelling) || null;
            return o && o.visible !== false && o.hidden !== true ? o : null;
        },

        spellCaption: function () {
            var review = ctl('Common.Controllers.ReviewChanges');
            var view = review && review.view;
            var s = view && view.txtSpelling;
            if (typeof s !== 'string' || !s) {
                var proto = Common.Views && Common.Views.ReviewChanges && Common.Views.ReviewChanges.prototype;
                s = proto && proto.txtSpelling;
            }
            if (typeof s !== 'string' || !s) {
                var o = this.spellTwin();
                s = o && o.options && o.options.hint;
            }
            return typeof s === 'string' ? s : '';
        },

        runSpelling: function () {
            var o = this.spellTwin();
            if (!o || off(o)) return false;
            o.click();
            this.refresh();
            return true;
        },

        /* --- Subscriptions ----------------------------------------------------- */

        bind: function () {
            var me = this, shell = this.shell;
            var refresh = function () { me.refresh(); };

            /* The counter — by engine events, like the stock page model: the number
               of the current slide from zero, their count and the number of the first slide. */
            shell.onApi('asc_onCountPages', function (count) { me.pages.count = num(count); me.refresh(); });
            shell.onApi('asc_onCurrentPage', function (index) { me.pages.current = num(index); me.refresh(); });
            shell.onApi('asc_onPresentationSize', function (w, h, type, first) {
                if (num(first) !== null) me.pages.start = first;
                me.refresh();
            });
            /* The language under the caret and its availability are recomputed by the stock bar
               on the same events — the subscription is later than the stock one, the values are already fresh. */
            shell.onApi('asc_onTextLanguage', refresh);
            shell.onApi('asc_onFocusObject', refresh);

            var b = bridge();
            [LANG, FIT_WIDTH, FIT_SLIDE].forEach(function (ref) { b.twin(ref) && b.watch(ref, refresh); });
            var spell = this.spellTwin();
            if (spell && typeof spell.on === 'function') spell.on('toggle disabled', shell.guarded('status: spelling state', refresh));

            Common.NotificationCenter.on('shell:advanced', shell.guarded('status: advanced', function () { me.closeLanguages(); }));
        },

        /* Current values of the stock bar page model — before the first engine events. */
        stockPages: function () {
            var v = stockView(), m = v && v.pages, get = m && m.get;
            var read = function (k) {
                try { return typeof get === 'function' ? num(get.call(m, k)) : null; } catch (e) { return null; }
            };
            return {current: read('current'), count: read('count'), start: read('start')};
        },

        /* "Slide N of M" — the format of the stock bar (_updatePagesCaption). */
        pageText: function () {
            var p = this.pages || {};
            if (p.count === null || p.count === undefined || p.count < 0 || p.current === null || p.current === undefined) return '';
            var start = p.start === null || p.start === undefined ? 1 : p.start;
            var total = start === 1 ? p.count : start + ' .. ' + (p.count + start - 1);
            return Common.Utils.String.format(stockText('pageIndexText'), p.current + start, total);
        },

        refresh: function () {
            var n = this.nodes;
            if (!n) return;
            var text = this.pageText();
            n.page.textContent = text;
            if (text) n.page.removeAttribute('hidden'); else n.page.setAttribute('hidden', '');

            if (n.lang) {
                var lang = this.langTwin();
                var cap = lang ? String(lang.caption !== undefined ? lang.caption : (lang.options && lang.options.caption) || '') : '';
                n.lang.textContent = cap;
                this.lock(n.lang, !lang || off(lang));
            }
            if (n.spell) {
                var sp = this.spellTwin();
                this.lock(n.spell, !sp || off(sp));
                this.press(n.spell, !!sp && sp.pressed === true);
            }
            [['fitWidth', FIT_WIDTH], ['fitSlide', FIT_SLIDE]].forEach(function (f) {
                var node = n[f[0]];
                if (!node) return;
                var st = bridge().state(f[1]);
                this.lock(node, st.disabled);
                this.press(node, st.pressed);
            }, this);
        },

        /* Disabled counterpart — the class and aria-disabled, as in the menu row:
           the caption stays visible. */
        lock: function (node, locked) {
            node.classList.toggle('vo-locked', !!locked);
            if (locked) node.setAttribute('aria-disabled', 'true'); else node.removeAttribute('aria-disabled');
        },

        press: function (node, on) {
            node.classList.toggle('on', !!on);
            node.setAttribute('aria-pressed', on ? 'true' : 'false');
        },

        /* --- Language ---------------------------------------------------------- */
        /* The language list is a snapshot of the stock btnLanguage menu at the moment of opening
           (StockBridge.mirror), the choice is a click on the stock item: it is
           handled by the stock menu, which passes it to the stock bar ('item:click'). */

        pop: null,

        toggleLanguages: function () {
            if (this.pop) { this.closeLanguages(); return; }
            var lang = this.langTwin();
            if (!lang || off(lang)) return;
            var menu = lang.menu, rows = bridge().mirror(LANG);
            if (!menu || !rows.length) return;
            this.openLanguages(menu, rows);
        },

        openLanguages: function (menu, rows) {
            var me = this, guarded = this.shell.guarded;
            var pop = el('div', 'vo-st-pop', {id: POP_ID, role: 'menu'});
            rows.forEach(function (row) {
                if (row.sep) return;
                var item = menu.items[parseInt(row.id, 10)];
                var checked = !!row.checked || !!(item && item.checked);
                var b = el('button', 'vo-st-pop-item' + (checked ? ' on' : ''), {type: 'button', role: 'menuitemradio',
                    'aria-checked': checked ? 'true' : 'false'});
                b.textContent = row.caption;
                if (row.disabled) { b.setAttribute('disabled', ''); b.classList.add('vo-locked'); }
                b.addEventListener('click', guarded('status: pick language', function () {
                    me.closeLanguages();
                    me.pickLanguage(row.id);
                    me.refresh();
                }));
                pop.appendChild(b);
            });
            document.body.appendChild(pop);
            this.pop = pop;
            this.placeLanguages();

            this.onKey = guarded('status: language keys', function (e) {
                if (e.key === 'Escape' || e.keyCode === 27) me.closeLanguages();
            });
            this.onDown = guarded('status: language outside', function (e) {
                var t = e && e.target;
                if (!me.pop || (t && (me.pop.contains(t) || (me.nodes.lang && me.nodes.lang.contains(t))))) return;
                me.closeLanguages();
            });
            document.addEventListener('keydown', this.onKey, true);
            document.addEventListener('mousedown', this.onDown, true);
            this.nodes.lang.setAttribute('aria-expanded', 'true');
            var on = pop.querySelector('.on');
            on && on.scrollIntoView && on.scrollIntoView({block: 'nearest'});
        },

        /* Above the language caption, from its left edge. */
        placeLanguages: function () {
            var a = this.nodes.lang, pop = this.pop;
            if (!a || !pop || typeof a.getBoundingClientRect !== 'function') return;
            var r = a.getBoundingClientRect();
            pop.style.left = Math.round(r.left) + 'px';
            pop.style.bottom = Math.round((window.innerHeight || 0) - r.top + 4) + 'px';
        },

        closeLanguages: function () {
            var pop = this.pop;
            if (!pop) return;
            this.pop = null;
            pop.parentNode && pop.parentNode.removeChild(pop);
            document.removeEventListener('keydown', this.onKey, true);
            document.removeEventListener('mousedown', this.onDown, true);
            this.nodes && this.nodes.lang && this.nodes.lang.setAttribute('aria-expanded', 'false');
        },

        /* The choice goes the stock menu way: a Common.UI.MenuItem item — through the bridge
           (onItemClick), a MenuSimple item — a click on its row in the drawn
           menu (MenuSimple.onItemClick: mark, recent, 'item:click'). */
        pickLanguage: function (id) {
            var lang = this.langTwin();
            var menu = lang && lang.menu;
            var item = menu && menu.items && menu.items[parseInt(id, 10)];
            if (!item || off(lang)) return false;
            if (bridge().pick(LANG, id)) return true;
            var a = item.id && menu.cmpEl && menu.cmpEl[0] && menu.cmpEl[0].querySelector('[id="' + item.id + '"]');
            var li = a && a.closest ? a.closest('li') : null;
            if (li) { li.click(); return true; }
            if (typeof item.click === 'function') { item.click(); return true; }
            return false;
        }

    }, PE.Views.CompactStatus || {});

    return PE.Views.CompactStatus;
});
