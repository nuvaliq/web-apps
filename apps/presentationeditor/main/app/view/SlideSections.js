/*
 * SlideSections — the presentation right-panel sections as an AIR popup panel.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * There is no right column: the body of the stock RightMenu (#view-right-menu) is a card
 * over the canvas, the canvas is full width (compact-panel.less). The sections are
 * "Slide Settings", "Theme", "Transition", "Animation" and "Object Settings";
 * the card is visible while a section is open (body.vo-right-open), when closed the
 * stock panel is collapsed. There is no header: the section is named by the calling button
 * or item, the section name is the card name for the screen reader (aria-label).
 *
 * Place (place): when opened by a toolbar button — under that button,
 * from the menu row and a right click — at the right edge of the canvas under the toolbar;
 * entirely within the window, the height by content, not below the status
 * bar, beyond that the body scrolls. It is closed by Esc (the shell Esc queue,
 * as the last layer), a click outside (on the canvas too), a repeat of the same button or
 * item. Clicks in stock menus, palettes, bridge galleries and windows
 * are not outside. Focus on opening goes into the card (Tab cycles
 * inside it), on closing — to the calling button, otherwise to the canvas.
 *
 *  — "Slide Settings" — the stock "Slide" tab (SlideSettings), under it
 *    the layout (gallery Toolbar:btnChangeSlide) and the slide size (menu
 *    Toolbar:btnSlideSize);
 *  — "Object Settings" — the stock tab of the selected object kind; for
 *    a chart — a cut-down "Shape" (there is no chart tab in 9.4);
 *  — "Theme", "Transition", "Animation" — own nodes in the body of the stock panel
 *    (.settings-panel next to the stock ones): the fields are counterparts of the stock controls
 *    of the ribbon tabs through StockBridge. Gallery tiles are records of the stores
 *    of the stock galleries (tiles), the choice goes the stock gallery way (pickTile);
 *    lists are a snapshot of the stock menu (mirror), the choice is a stock item click
 *    (pick); a field value is written into the stock control (setValue), its
 *    'change' reaches the stock controller.
 *
 * The stock panel switches the tab itself on every selection
 * (RightMenu.onFocusObject): while a section is open, the open section is returned
 * after it — a selection change from the keyboard switches to the object section.
 * The "Slide Settings" item of the thumbnail menu (the stock onSlideSettings)
 * opens the "Slide Settings" section.
 *
 * Shell commands: objectProperties(opts) — the object section, without an object —
 * "Slide Settings"; slideSection(name, opts) — a section ('slide' | 'theme' |
 * 'transition' | 'animation' | 'object'); a repeat of the same section closes it.
 * opts.anchor — the button under which the card stands. Without edit rights, in
 * "Viewing" and under the stock editing lock the panel does not open (an open one
 * is closed), as in the stock editor. The sections reread
 * CompactModes.reason() on vo:mode and the stock editing lock on
 * editing:disable, the fields — on vo:selection and a slide change.
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES.
 */
define([], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    /* Sections in order and their names — the card name for the screen reader. */
    var SECTIONS = [
        {k: 'slide', t: 'textSlideSettings'},
        {k: 'theme', t: 'textTheme'},
        {k: 'transition', t: 'textTransition'},
        {k: 'animation', t: 'textAnimation'},
        {k: 'object', t: 'textObjectSettings'}
    ];
    var OWN_PANES = ['theme', 'transition', 'animation'];

    var OPEN_CLASS = 'vo-right-open';
    var CARD_ID = 'view-right-menu';
    var SLIDE_MORE_ID = 'vo-rp-slide';

    /* Card place, px. Under a button — the gap as for the toolbar lists
       (#vo-tb .vo-pop); under the toolbar — the gap as
       between it and the canvas; to the window edge and to the status bar — margins. */
    var GAP_ANCHOR = 4;
    var GAP_EDGE = 8;
    var EDGE_IN = 20;          // right canvas edge without the toolbar — the panel card margin
    var MARGIN = 8;
    var GAP_STATUS = 12;       // to the status bar — as in the left area
    var MIN_H = 160;
    var CARD_W = 272;
    var FIT_GAP = 4;           // dropdown list of a stock tab — to the edge of the card body
    var FIT_NS = '.vo-rp-fit';

    /* A click in these layers is not "outside": stock menus, palettes and galleries
       (including bridge galleries from the hidden ribbon), windows and their mask,
       tooltips, the shell menu row (its item with the same command is a repeat),
       toolbar buttons with a section command (data-vo-panel). */
    var NOT_OUTSIDE = '.dropdown-menu, .asc-window, .modals-mask, .tooltip, #vo-menubar, [data-vo-panel], .vo-gallery-anchor';
    var FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';

    /* Remembering the collapsed state of the stock panel (view/RightMenu.js
       onBtnMenuClick): its own expansion does not touch it. */
    var COLLAPSED_KEY = 'pe-hide-right-settings';

    /* Counterparts. */
    var REF = {
        layout: 'Toolbar:btnChangeSlide',
        size: 'Toolbar:btnSlideSize',
        themes: 'Toolbar:listTheme',
        schemes: 'Toolbar:btnColorSchemas',
        effects: 'Transitions:listEffects',
        params: 'Transitions:btnParameters',
        duration: 'Transitions:numDuration',
        startOnClick: 'Transitions:chStartOnClick',
        delayOn: 'Transitions:chDelay',
        delay: 'Transitions:numDelay',
        applyAll: 'Transitions:btnApplyToAll',
        preview: 'Transitions:btnPreview',
        animations: 'Animation:listEffects',
        animationPane: 'Animation:btnAnimationPane',
        slideSettings: 'DocumentHolder:menuSlideSettings'
    };

    /* Tabs of the stock panel for a selection kind — by seniority; the first
       one that the stock code considered available (not hidden) is taken. Text Art in
       the lists is last: it is chosen by the stock priority (objectPane). */
    var OBJECT_PANES = {
        table: ['Table'],
        image: ['Image'],
        chart: ['Shape'],
        shape: ['Shape', 'TextArt'],
        line: ['Shape'],
        text: ['Shape', 'Paragraph', 'TextArt'],
        typing: ['Paragraph', 'Shape', 'TextArt']
    };
    /* Object section name — the stock tab tooltip. */
    var PANE_TITLES = {
        Table: 'RightMenu.txtTableSettings', Image: 'RightMenu.txtImageSettings', Shape: 'RightMenu.txtShapeSettings',
        Paragraph: 'RightMenu.txtParagraphSettings', TextArt: 'RightMenu.txtTextArtSettings'
    };

    function ctl(name) {
        try { return (PE.getController && PE.getController(name)) || null; } catch (e) { return null; }
    }

    function rightCtl() { return ctl('RightMenu'); }

    function rightView() {
        var c = rightCtl();
        return (c && (c.rightmenu || c.rightMenu)) || null;
    }

    function bridge() { return PE.Views.StockBridge; }

    function paneTypes() {
        return (window.Common && Common.Utils && Common.Utils.documentSettingsType) || {};
    }

    function byId(id) { return document.getElementById(id); }

    function fn(o, name) { return !!o && typeof o[name] === 'function'; }

    /* A stock string: the path from PE.Views, the text — from the view prototype. */
    function stock(path) {
        var parts = String(path).split('.'), key = parts.pop(), o = PE.Views;
        for (var i = 0; i < parts.length && o; i++) o = o[parts[i]];
        if (!o) return '';
        var v = o.prototype && typeof o.prototype[key] === 'string' ? o.prototype[key] : o[key];
        return typeof v === 'string' ? v : '';
    }

    function node(tag, cls, attrs, kids) {
        var e = document.createElement(tag);
        cls && e.setAttribute('class', cls);
        _.each(attrs || {}, function (v, k) {
            if (v === null || v === undefined || v === false) return;
            if (k === 'text') e.textContent = v;
            else e.setAttribute(k, v === true ? '' : v);
        });
        (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
        return e;
    }

    function icon(name, size) {
        var C = window.Common && Common.UI && Common.UI.Compact, I = C && C.Icons;
        try { return I && typeof I.svg === 'function' ? I.svg(name, size) : ''; } catch (e) { return ''; }
    }

    /* Value of a stock gallery store record. */
    function rec(r, key) {
        return r && typeof r.get === 'function' ? r.get(key) : (r ? r[key] : undefined);
    }

    /* Node rectangle on screen; null — there is no node or it has no box
       (hidden, outside the document). */
    function box(el) {
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        var r = el.getBoundingClientRect();
        return r && (r.width > 0 || r.height > 0) ? r : null;
    }

    function rtl() {
        try { return !!(Common.UI && typeof Common.UI.isRTL === 'function' && Common.UI.isRTL()); } catch (e) { return false; }
    }

    function within(t, sel) {
        var el = t && t.nodeType === 1 ? t : (t && t.parentNode) || null;
        return !!(el && typeof el.closest === 'function' && el.closest(sel));
    }

    function modalOpen() {
        var mw = window.Common && Common.Utils && Common.Utils.ModalWindow;
        try { return !!(mw && typeof mw.isVisible === 'function' && mw.isVisible()); } catch (e) { return false; }
    }

    PE.Views.SlideSections = _.extend({

        SECTIONS: SECTIONS,
        REF: REF,
        OPEN_CLASS: OPEN_CLASS,

        shell: null,
        opened: false,       // the section is open (the card is visible)
        want: 'slide',       // chosen section; 'object' without an object shows "Slide Settings"
        anchor: null,        // the button under which the card stands; null — at the right canvas edge
        returnTo: null,      // where to return focus on closing; null — to the canvas
        entered: false,      // listeners of the open card are set
        undo: null,          // undoing the stock overrides; null — no overrides
        boundMenu: false,    // the listener of the "Slide Settings" item of the thumbnail menu is set
        reasons: null,       // section name → reason of unavailability (CompactModes.reason)
        locks: null,         // section name → locked by the stock editing lock (without a reason)
        watched: null,       // gallery address → {store, fn}: the listener of its store
        pending: false,      // rereading the sections is deferred past a batch of store events
        queued: false,       // showing the section by selection is deferred to the end of event handling
        layoutShown: false,  // the layout gallery is shown by the section's "Change Layout" button

        install: function (shell) {
            var me = this, nc = Common.NotificationCenter;
            var guarded = shell.guarded;
            this.shell = shell;
            this.reasons = {};
            this.locks = {};

            /* Without the stock right panel (its view is created by the stock controller at
               startup) there is nothing to show: the commands have no owner, and the items with
               them are inactive. */
            if (!rightView()) return;

            shell.command('objectProperties', guarded('panel: object properties', function (opts) { return me.toggleObject(opts); }));
            shell.command('slideSection', guarded('panel: section', function (name, opts) { return me.toggle(name, opts); }));

            nc.on('vo:selection', guarded('panel: selection', function () { me.soon(); }));
            var modes = PE.Views.CompactModes;
            nc.on((modes && modes.MODE_EVENT) || 'vo:mode', guarded('panel: mode', function () { me.readReasons(); me.sync(); }));
            nc.on('editing:disable', guarded('panel: editing lock', function () { me.readReasons(); me.sync(); }));
            nc.on('shell:advanced', guarded('panel: advanced', function (advanced) { me.onAdvanced(advanced); }));
            /* Edit right revoked: the shell has already taken the right snapshot. */
            nc.on('collaboration:sharingdeny', guarded('panel: sharingdeny', function () { me.close('deny'); }));
            /* The slide show goes over everything — the card closes. */
            nc.on('preview:show', guarded('panel: show', function () { me.close('show'); }));
            /* The layout shifted (the toolbar is hidden or shown,
               the focus mode) — the card moves to the new place. */
            nc.on('layout:changed', guarded('panel: layout', function () { me.place(); }));
            shell.onApi('asc_onCurrentPage', function () { me.refresh(); });

            this.readReasons();
            this.bind();
            this.sync();
        },

        /* The shell is built and not in the "Stock interface". */
        active: function () {
            var s = this.shell;
            return !!s && s.advanced !== true && s.startupFailed !== true && !!byId('vo-shell') &&
                document.body.classList.contains('vo-compact');
        },

        /* The panel exists: the edit right and the stock panel that the integrator did not
           hide (the condition of the stock tryToShowRightMenu). */
        allowed: function () {
            var s = this.shell;
            if (!s || (typeof s.editRight === 'function' && !s.editRight())) return false;
            var v = rightView();
            if (!v || !fn(v, 'SetActivePane')) return false;
            var m = v.mode || {};
            if (m.canBrandingExt === true && m.customization && m.customization.rightMenu === false) return false;
            var LM = Common.UI && Common.UI.LayoutManager;
            return !(LM && typeof LM.isElementVisible === 'function' && LM.isElementVisible('rightMenu') === false);
        },

        /* --- State ----------------------------------------------------------- */

        kind: function () {
            var S = PE.Views.SlideSelection;
            try { return (S && typeof S.kind === 'function' && S.kind()) || 'none'; } catch (e) { return 'none'; }
        },

        hasObject: function () {
            return this.kind() !== 'none';
        },

        /* Sections in order that can be opened now ("Object
           Settings" — only with an object); without the edit right — none. */
        sections: function () {
            if (!this.allowed()) return [];
            var obj = this.hasObject();
            return SECTIONS.filter(function (s) { return s.k !== 'object' || obj; }).map(function (s) { return s.k; });
        },

        /* The section on screen; null — the panel is closed. */
        current: function () {
            if (!this.isOpen()) return null;
            return this.want === 'object' && !this.hasObject() ? 'slide' : this.want;
        },

        isOpen: function () {
            return !!this.opened && this.active() && this.allowed();
        },

        /* --- Commands ------------------------------------------------------------- */

        /* Open a section (an open card switches to it). opts —
           {anchor: button} or the button itself. An unavailable section (a mode
           reason, the stock editing lock) does not open. */
        open: function (name, opts) {
            if (!_.some(SECTIONS, function (s) { return s.k === name; })) return false;
            if (!this.active() || !this.allowed() || this.sectionOff(name)) return false;
            var was = this.isOpen() && this.entered;
            var anchor = opts && opts.nodeType === 1 ? opts : (opts && opts.anchor && opts.anchor.nodeType === 1 ? opts.anchor : null);
            this.want = name;
            this.opened = true;
            this.anchor = anchor;
            this.returnTo = anchor;
            this.apply(true);
            this.place();
            if (!was) this.enter();
            else this.focusIn();
            return true;
        },

        /* Section button and item: a repeat of an open section closes the card. */
        toggle: function (name, opts) {
            if (this.isOpen() && this.current() === name) return this.close('toggle');
            return this.open(name, opts);
        },

        /* The object section, without an object — "Slide Settings"; a repeat of the same
           section closes the panel. */
        toggleObject: function (opts) {
            if (!this.active() || !this.allowed()) return false;
            var target = this.hasObject() ? 'object' : 'slide';
            if (this.current() === target) return this.close('toggle');
            return this.open(target, opts);
        },

        /* how — by what it was closed: 'escape', 'toggle' (a repeat),
           'outside' (a click outside), other — an editor state (mode,
           lock, right revoked, show, "Stock interface"). */
        close: function (how) {
            var was = this.opened;
            var card = this.card(), act = document.activeElement;
            var had = !!(card && act && act !== card.ownerDocument.body && card.contains(act));
            this.opened = false;
            this.leave();
            this.deactivateOwn();
            document.body.classList.remove(OPEN_CLASS);
            var v = rightView();
            if (was && this.active() && v && fn(v, 'clearSelection')) v.clearSelection();
            this.sync();
            if (was) this.giveBack(how, had, card);
            return true;
        },

        /* Focus after closing. A click outside moves it away itself. Otherwise, if focus
           was in the card or lost, — to the calling button, and without it —
           to the canvas by the stock edit:complete. An engine with the keyboard enabled
           takes focus into its field itself, so for the button the engine keyboard
           is off — the first click on the canvas will return it, as after a window.
           Focus that left the card by itself (a stock tab after editing a field
           gives it to the canvas) is not touched. The keyboard returns to the engine,
           except when focus is in a shell input field outside the card (its
           keyboard is driven by the field itself). */
        giveBack: function (how, had, card) {
            var s = this.shell, to = this.returnTo;
            this.returnTo = null;
            this.anchor = null;
            var keys = function (on) { s && fn(s, 'engineKeys') && s.engineKeys(on); };
            var act = document.activeElement;
            var lost = had || !act || act === document.body;
            if (how !== 'outside' && lost) {
                if (to && box(to) && fn(to, 'focus')) {
                    keys(false);
                    to.focus();
                    return;
                }
                keys(true);
                Common.NotificationCenter.trigger('edit:complete');
                return;
            }
            var field = !!act && act !== document.body && !(card && card.contains(act)) && act.id !== 'area_id' &&
                (/^(INPUT|TEXTAREA|SELECT)$/i.test(act.tagName || '') || act.isContentEditable === true);
            if (!field) keys(true);
        },

        /* --- Show ----------------------------------------------------------------- */
        /* The open section — onto the screen: the panel class, a tab of the stock panel or
           an own node, the header. fresh — the stock tab is chosen anew
           (opening); otherwise — only if the stock code switched it itself.
           There is no column in the layout: the canvas is not recomputed. */
        apply: function (fresh) {
            if (!this.isOpen()) { this.sync(); return; }
            document.body.classList.add(OPEN_CLASS);
            var sec = this.current();
            if (OWN_PANES.indexOf(sec) >= 0) {
                this.showOwn(sec);
            } else {
                var type = sec === 'object' ? this.objectPane() : paneTypes().Slide;
                if (type === null || type === undefined) type = paneTypes().Slide;
                this.showStock(type, fresh);
            }
            this.sync();
        },

        /* Object tab: the first available one by the stock code for the selection kind;
           none — the senior available one (like the stock lastactive).

           Text Art — by the stock priority. The Text Art tab is available for any
           shape with text, and by its own order the stock panel never chooses it:
           "Shape" is senior to it (lastactive). Only the priority opens it
           (controller/RightMenu.js onFocusObject, _priorityArr):
           inserting Text Art from the gallery (onInsertTextArt) or a click on the tab
           puts it first. So Text Art is chosen when the first available tab
           of the stock priority is exactly it; other tabs — by their own order. */
        objectPane: function () {
            var T = paneTypes(), c = rightCtl();
            var settings = c && c._settings;
            var free = function (name) {
                var t = T[name];
                if (t === undefined) return false;
                if (!settings) return true;
                var s = settings[t];
                return !!s && s.hidden !== 1 && s.hidden !== true;
            };
            var list = OBJECT_PANES[this.kind()] || [];
            if (settings && list.indexOf('TextArt') >= 0 && this.stockPriority(free) === T.TextArt) return T.TextArt;
            for (var i = 0; i < list.length; i++) if (free(list[i])) return T[list[i]];
            var best = null;
            ['Paragraph', 'Table', 'TextArt', 'Shape', 'Image'].forEach(function (name) {
                if (settings && free(name) && (best === null || T[name] > best)) best = T[name];
            });
            return best;
        },

        /* The first available tab of the stock priority (its priorityactive);
           null — the priority is empty or has no available ones. */
        stockPriority: function (free) {
            var T = paneTypes(), c = rightCtl();
            var list = c && Array.isArray(c._priorityArr) ? c._priorityArr : [];
            for (var i = 0; i < list.length; i++) {
                var type = list[i];
                var name = _.findKey(T, function (v) { return v === type; });
                if (name && free(name)) return type;
            }
            return null;
        },

        objectTitle: function () {
            var T = paneTypes(), type = this.isOpen() || this.hasObject() ? this.objectPane() : null;
            var name = _.findKey(T, function (v) { return v === type; });
            return (name && PANE_TITLES[name] && stock(PANE_TITLES[name])) || this.textObjectSettings;
        },

        /* Stock tab: the stock SetActivePane (for a collapsed one — a press of its
           button: expansion and content by the selection properties). For an expanded one
           it only switches the tab — we give the content ourselves, like the stock
           onDoubleClickOnObject. */
        showStock: function (type, fresh) {
            var v = rightView(), c = rightCtl();
            if (!v) return;
            this.deactivateOwn();
            var minimized = v.minimizedMode === true;
            var panel = c && c._settings && c._settings[type];
            if (!fresh && !minimized && fn(v, 'GetActivePane') && panel && panel.panelId && v.GetActivePane() === panel.panelId) return;
            this.expand(function () { v.SetActivePane(type, true); });
            if (!minimized && panel && panel.panel && fn(panel.panel, 'ChangeSettings') && panel.props) {
                panel.panel.ChangeSettings(panel.props);
                fn(v, 'updateScroller') && v.updateScroller();
            }
        },

        /* Expansion of the stock panel — without writing "not collapsed" into the memory
           of the stock session: the shell automatics does not change the look of the "Stock
           interface" on this same origin. */
        expand: function (step) {
            var ls = window.Common && Common.localStorage;
            var was = ls && fn(ls, 'getItem') ? ls.getItem(COLLAPSED_KEY) : null;
            try {
                step();
            } finally {
                if (ls && fn(ls, 'setItem')) {
                    if (was === null || was === undefined) fn(ls, 'removeItem') && ls.removeItem(COLLAPSED_KEY);
                    else ls.setItem(COLLAPSED_KEY, was);
                }
            }
        },

        /* An own section — an own node in the body of the stock panel. A collapsed stock one
           is first expanded by its "Slide" tab. */
        showOwn: function (sec) {
            var v = rightView();
            var pane = this.pane(sec);
            if (!pane) return;
            if (v && v.minimizedMode === true) this.expand(function () { v.SetActivePane(paneTypes().Slide, true); });
            var host = pane.parentNode, was = pane.classList.contains('active');
            Array.prototype.forEach.call(host ? host.children : [], function (el) {
                if (el !== pane && el.classList.contains('active')) el.classList.remove('active');
            });
            pane.classList.add('active');
            this.renderPane(sec, !was);
            /* Scrolling to the start — only when a section is shown, not on every
               field reread. */
            if (!was && v && fn(v, 'updateScroller')) v.updateScroller();
        },

        deactivateOwn: function () {
            OWN_PANES.forEach(function (k) {
                var el = byId('vo-rp-' + k);
                el && el.classList.remove('active');
            });
        },

        /* --- Nodes -------------------------------------------------------------------- */

        /* The card is the body of the stock panel (#view-right-menu); without it —
           the parent of the tab body (.right-panel). */
        card: function () {
            var el = byId(CARD_ID);
            if (el) return el;
            var slide = byId('id-slide-settings');
            var body = slide && typeof slide.closest === 'function' ? slide.closest('.right-panel') : null;
            return body && body.parentNode && body.parentNode.nodeType === 1 ? body.parentNode : null;
        },

        /* The stock panel body — the parent of its "Slide" tab. */
        paneHost: function () {
            var slide = byId('id-slide-settings');
            return slide && slide.parentNode ? slide.parentNode : null;
        },

        pane: function (sec) {
            var id = 'vo-rp-' + sec, el = byId(id);
            if (el) return el;
            var host = this.paneHost();
            if (!host) return null;
            el = node('div', 'settings-panel vo-rp-pane', {id: id, 'data-vo-section': sec});
            host.appendChild(el);
            return el;
        },

        /* Layout and slide size — under the stock "Slide" tab. */
        slideMore: function () {
            var el = byId(SLIDE_MORE_ID);
            if (el) return el;
            var slide = byId('id-slide-settings');
            if (!slide || !slide.parentNode) return null;
            el = node('div', 'vo-rp-pane vo-rp-more', {id: SLIDE_MORE_ID, hidden: true});
            slide.parentNode.insertBefore(el, slide.nextSibling);
            return el;
        },

        /* Section name: own ones — shell captions, the object one — the stock tooltip
           of the tab of this object kind. */
        title: function (k) {
            if (k === 'object') return this.objectTitle();
            var s = _.findWhere(SECTIONS, {k: k});
            return s ? this[s.t] : '';
        },

        /* Card name, layout visibility — by state. */
        sync: function () {
            var on = this.isOpen();
            if (!on) {
                document.body.classList.remove(OPEN_CLASS);
                this.leave();
            }
            this.renderLabel();
            var more = this.active() ? this.slideMore() : byId(SLIDE_MORE_ID);
            if (more) {
                var show = on && this.current() === 'slide';
                if (show) this.renderSlideMore(more);
                if (show) more.removeAttribute('hidden'); else more.setAttribute('hidden', '');
            }
        },

        /* There is no header: the section is named by the calling button or item, the card name
           for the screen reader is the name of the open section. A closed card and
           outside the shell ("Stock interface", startup failure) has no name — the stock
           panel lives its own life. */
        renderLabel: function () {
            var card = this.card(), sec = this.active() && this.isOpen() ? this.current() : null;
            if (!card) return;
            if (sec) card.setAttribute('aria-label', this.title(sec));
            else card.removeAttribute('aria-label');
        },

        /* --- Place and closing ----------------------------------------------------------- */

        /* The card stands under the calling button (left edges level, in right-to-left —
           the right ones), and without a button — at the right canvas edge under the toolbar
           (level with the right edge of its card); entirely within the window,
           the height — to the status bar, beyond that the body scrolls. The place and
           the height ceiling are variables on the card (compact-panel.less):
           inline top and left would stay on the body in the "Stock interface". */
        place: function () {
            var card = this.card();
            if (!card || !this.isOpen() || !card.style || typeof card.style.setProperty !== 'function') return;
            var de = document.documentElement || {};
            var W = window.innerWidth || de.clientWidth || 0, H = window.innerHeight || de.clientHeight || 0;
            var cr = box(card), w = cr ? Math.round(cr.width) : CARD_W;
            var back = rtl();
            var a = box(this.anchor), tb = box(byId('vo-toolbar')), sdk = box(byId('editor_sdk')), st = box(byId('vo-status'));
            var top, left;
            if (a) {
                top = a.bottom + GAP_ANCHOR;
                left = back ? a.right - w : a.left;
            } else if (tb) {
                top = tb.bottom + GAP_EDGE;
                left = back ? tb.left : tb.right - w;
            } else {
                var ref = sdk || {top: 0, left: 0, right: W};
                top = ref.top + GAP_EDGE;
                left = back ? ref.left + EDGE_IN : ref.right - EDGE_IN - w;
            }
            var bottom = st ? st.top - GAP_STATUS : H - MARGIN;
            if (W) left = Math.max(MARGIN, Math.min(left, W - MARGIN - w));
            top = Math.max(MARGIN, Math.min(top, bottom - MIN_H));
            card.style.setProperty('--vo-rp-top', Math.round(top) + 'px');
            card.style.setProperty('--vo-rp-left', Math.round(left) + 'px');
            card.style.setProperty('--vo-rp-max-h', Math.max(MIN_H, Math.round(bottom - top)) + 'px');
            var v = rightView(), sc = v && v.scroller;
            sc && fn(sc, 'update') && sc.update();
        },

        /* Listeners of the open card: a press outside (capture — earlier than the canvas and
           the stock handlers; pointerdown — the engine cancels it on the canvas, and
           mousedown does not arrive there), Tab in a circle, the window size; the card is
           a dialog with the section name. */
        pressEvent: function () {
            return typeof window.PointerEvent === 'function' ? 'pointerdown' : 'mousedown';
        },

        enter: function () {
            var card = this.card();
            if (this.entered || !card) return;
            var me = this, guarded = this.shell.guarded;
            this.entered = true;
            this.onPress = this.onPress || guarded('panel: outside press', function (e) { me.outside(e); });
            this.onKeys = this.onKeys || guarded('panel: keys', function (e) { me.keys(e); });
            this.onResize = this.onResize || guarded('panel: resize', function () { me.place(); });
            this.press = this.pressEvent();
            document.addEventListener(this.press, this.onPress, true);
            card.addEventListener('keydown', this.onKeys);
            window.addEventListener('resize', this.onResize);
            var $ = window.jQuery;
            if (typeof $ === 'function') {
                $(card).on('shown.bs.dropdown' + FIT_NS, guarded('panel: fit menu', function (e) { me.fitMenu(e && e.target); }))
                    .on('hide.bs.dropdown' + FIT_NS, guarded('panel: unfit menu', function (e) { me.unfitMenu(e && e.target); }));
            }
            card.setAttribute('role', 'dialog');
            card.setAttribute('tabindex', '-1');
            this.focusIn();
        },

        leave: function () {
            if (!this.entered) return;
            this.entered = false;
            var card = this.card();
            document.removeEventListener(this.press || 'mousedown', this.onPress, true);
            window.removeEventListener('resize', this.onResize);
            if (card) {
                var $ = window.jQuery;
                typeof $ === 'function' && $(card).off(FIT_NS);
                card.removeEventListener('keydown', this.onKeys);
                card.removeAttribute('role');
                card.removeAttribute('aria-label');
                card.removeAttribute('tabindex');
            }
        },

        /* Focus — into the card, the keyboard — not to the engine. The calling menu
           closes after the command and gives focus to the canvas deferred (the stock
           edit:complete) — the card takes it again after it. */
        focusIn: function () {
            var me = this, card = this.card(), s = this.shell;
            if (!card || !fn(card, 'focus')) return;
            var take = function () {
                var act = document.activeElement;
                if (!me.isOpen() || (act && act !== card && card.contains(act))) return;
                s && fn(s, 'engineKeys') && s.engineKeys(false);
                card.focus();
            };
            take();
            setTimeout(this.shell.guarded('panel: focus', take), 60);
        },

        /* A dropdown list of a stock tab (ComboBox — a bootstrap menu inside the
           scrollable body) is clipped by the card bottom: the stock alignment
           computes the room to the window bottom. A list that does not fit — the body
           scrolls to it; if the scroll is not enough — the list opens
           upward (the stock show-top) if it fits above the field, otherwise
           gets a height ceiling by the free space and its own scroll.
           Palettes and button menus stand fixed — the body does not clip them. */
        fitMenu: function (holder) {
            var card = this.card(), body = card && card.querySelector('.right-panel > .content-box');
            var menu = holder && holder.children ? _.find(holder.children, function (c) { return c.classList && c.classList.contains('dropdown-menu'); }) : null;
            if (!menu || !body || !body.contains(menu)) return;
            var cs = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(menu) : null;
            if (cs && cs.position === 'fixed') return;
            var b = box(body), m = box(menu), hr = box(holder);
            if (!b || !m || !hr) return;
            var over = m.bottom - (b.bottom - FIT_GAP);
            if (over <= 0) return;
            var room = Math.max(0, (body.scrollHeight || 0) - (body.clientHeight || 0) - (body.scrollTop || 0));
            var d = Math.min(over, room), top = hr.top;
            if (d > 0) {
                var v = rightView(), sc = v && v.scroller, to = (body.scrollTop || 0) + d;
                if (sc && fn(sc, 'scrollTop')) sc.scrollTop(to); else body.scrollTop = to;
                over -= d;
                top -= d;
            }
            if (over <= 0) return;
            var above = top - (b.top + FIT_GAP);
            menu.setAttribute('data-vo-fit', '');
            if (above >= m.height && !menu.classList.contains('show-top')) {
                menu.classList.add('show-top');
                menu.setAttribute('data-vo-fit', 'top');
                return;
            }
            menu.style.maxHeight = Math.max(0, Math.round(m.height - over)) + 'px';
            menu.style.overflowY = 'auto';
        },

        /* The list closes — the fitting is removed: the stock has its own calculation. */
        unfitMenu: function (holder) {
            var menu = holder && holder.children ? _.find(holder.children, function (c) { return c.hasAttribute && c.hasAttribute('data-vo-fit'); }) : null;
            if (!menu) return;
            if (menu.getAttribute('data-vo-fit') === 'top') menu.classList.remove('show-top');
            menu.removeAttribute('data-vo-fit');
            menu.style.maxHeight = '';
            menu.style.overflowY = '';
        },

        /* A press outside the card closes it. */
        outside: function (e) {
            var t = e && e.target, card = this.card();
            if (!this.isOpen() || !t) return;
            if (card && card.contains(t)) return;
            if (within(t, NOT_OUTSIDE) || modalOpen()) return;
            var B = bridge();
            if (B && fn(B, 'galleryOwns') && B.galleryOwns(t)) return;
            this.close('outside');
        },

        /* Tab and Shift+Tab cycle inside the card. */
        keys: function (e) {
            if (!e || e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
            var card = this.card(), list = this.focusables();
            var act = document.activeElement;
            if (!list.length) {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                return;
            }
            var i = list.indexOf(act), to = null;
            if (e.shiftKey && (i <= 0)) to = list[list.length - 1];
            else if (!e.shiftKey && (i === list.length - 1 || (i < 0 && act === card))) to = list[0];
            if (!to) return;
            if (typeof e.preventDefault === 'function') e.preventDefault();
            to.focus();
        },

        /* Card controls reached by Tab: visible, available, outside
           open stock menus. */
        focusables: function () {
            var card = this.card();
            if (!card) return [];
            return Array.prototype.filter.call(card.querySelectorAll(FOCUSABLE), function (el) {
                if (el.disabled || el.getAttribute('tabindex') === '-1' || el.getAttribute('aria-hidden') === 'true') return false;
                if (within(el, '.dropdown-menu') || within(el, '[hidden]')) return false;
                return !!box(el) || typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
            });
        },

        /* --- Update ---------------------------------------------------------------- */

        onSelection: function () {
            this.bindMenu();
            if (this.isOpen()) this.apply(false);
            else this.sync();
        },

        /* The selection changed: the stock panel has already chosen a tab
           (RightMenu.onFocusObject), the classifier — the kind (vo:selection).
           The section is shown once, when both have worked, — before the frame
           is drawn, so the stock tab does not flash instead of the section. */
        soon: function () {
            if (this.queued) return;
            var me = this;
            this.queued = true;
            var step = this.shell.guarded('panel: selection step', function () {
                me.queued = false;
                me.onSelection();
            });
            if (typeof window.queueMicrotask === 'function') window.queueMicrotask(step);
            else if (window.Promise) window.Promise.resolve().then(step);
            else setTimeout(step, 0);
        },

        /* Reread the section after a batch of stock code events — in one step. */
        later: function () {
            if (this.pending) return;
            var me = this;
            this.pending = true;
            setTimeout(this.shell.guarded('panel: refresh', function () {
                me.pending = false;
                me.refresh();
            }), 0);
        },

        /* A slide change and the rest, after which the fields are reread. */
        refresh: function () {
            if (!this.isOpen()) return;
            var sec = this.current();
            if (OWN_PANES.indexOf(sec) >= 0) this.renderPane(sec);
            this.sync();
        },

        /* Mode reasons (CompactModes.reason) and the stock editing lock: the stock
           disables its right panel (rightMenu.disable — RightMenu.SetDisabled),
           and the sections are locked together with it — without a reason, as in documents, where
           the right panel is stock for that time. The lock composition is
           CompactShell.lockState. An unavailable section does not open, a card
           open on it closes: in "Viewing" and under the lock there is no panel,
           the items and buttons that open it are disabled. */
        readReasons: function () {
            var modes = PE.Views.CompactModes, out = {}, locks = {};
            var shell = this.shell, st = shell && typeof shell.lockState === 'function' ? shell.lockState() : null;
            var stock = !!(st && st.on && st.options && st.options.rightMenu && st.options.rightMenu.disable);
            SECTIONS.forEach(function (s) {
                var why = null;
                try {
                    why = modes && typeof modes.reason === 'function'
                        ? modes.reason({k: 'section:' + s.k, section: s.k, panel: true, edit: true, needRight: true}) : null;
                } catch (e) { why = null; }
                if (why) out[s.k] = why;
                if (stock) locks[s.k] = true;
            });
            this.reasons = out;
            this.locks = locks;
            var sec = this.isOpen() ? this.current() : null;
            if (sec && this.sectionOff(sec)) { this.close('mode'); return; }
            if (sec && OWN_PANES.indexOf(sec) >= 0) this.renderPane(sec);
        },

        /* The section is unavailable: by a mode reason or the stock editing lock. */
        sectionOff: function (k) {
            return !!((this.reasons && this.reasons[k]) || (this.locks && this.locks[k]));
        },

        /* --- "Stock interface" -------------------------------------------------------- */

        /* Leaving for the "Stock interface" closes the card; the stock panel
           stays expanded on the tab that was in the card — there it is
           the stock column. Returning — the card is closed. */
        onAdvanced: function (advanced) {
            if (advanced) {
                this.unbind();
                /* The own node is hidden in the "Stock": the stock body without a tab would be empty. */
                var own = OWN_PANES.some(function (k) { var el = byId('vo-rp-' + k); return !!el && el.classList.contains('active'); });
                this.deactivateOwn();
                var v = rightView();
                if (own && v && v.minimizedMode !== true && fn(v, 'SetActivePane')) v.SetActivePane(paneTypes().Slide);
                if (this.opened) this.close('advanced');
                else this.sync();
                return;
            }
            this.bind();
            this.sync();
        },

        /* --- Stock overrides -------------------------------------------------------- */

        bind: function () {
            if (this.undo) return;
            var me = this, undo = [];
            var replace = function (obj, name, make) {
                if (!obj || typeof obj[name] !== 'function') return;
                var own = Object.prototype.hasOwnProperty.call(obj, name), orig = obj[name];
                var wrapped = make(orig);
                obj[name] = wrapped;
                undo.push(function () {
                    if (obj[name] !== wrapped) return;
                    if (own) obj[name] = orig; else delete obj[name];
                });
            };
            /* The stock panel chooses a tab itself on a selection; the open section
               returns after it in the same step as for vo:selection. It is called by
               Main.onFocusObject, _onChangeObjectLock and SetDisabled — by name,
               so the override is visible to all paths. */
            replace(rightCtl(), 'onFocusObject', function (orig) {
                return function () {
                    var r = orig.apply(this, arguments);
                    try {
                        if (me.isOpen()) me.soon();
                    } catch (e) { /* the stock panel choice matters more than the section */ }
                    return r;
                };
            });
            this.undo = undo;
            this.bindMenu();
        },

        unbind: function () {
            var undo = this.undo;
            this.undo = null;
            (undo || []).forEach(function (f) { f(); });
        },

        /* The "Slide Settings" item of the thumbnail menu: the stock onSlideSettings
           expands the "Slide" tab, the section opens after it. The item
           appears with the deferred editor menus — the listener is set when
           it exists. */
        bindMenu: function () {
            if (this.boundMenu) return;
            var me = this, B = bridge();
            var item = B && fn(B, 'twin') ? B.twin(REF.slideSettings) : null;
            if (!item || !fn(item, 'on')) return;
            this.boundMenu = true;
            item.on('click', this.shell.guarded('panel: thumbnail slide settings', function () {
                if (me.active()) me.open('slide');
            }));
        },

        /* --- Own sections ------------------------------------------------------------- */

        /* fresh — the section has just been shown: a long gallery scrolls to
           the selected tile; otherwise its scroll survives the rebuild. */
        renderPane: function (sec, fresh) {
            var pane = this.pane(sec);
            if (!pane) return;
            var focus = document.activeElement, key = null;
            if (focus && pane.contains(focus)) key = focus.getAttribute('data-vo');
            var scrolls = {};
            Array.prototype.forEach.call(pane.querySelectorAll('[data-vo-list]'), function (el) {
                scrolls[el.getAttribute('data-vo-list')] = el.scrollTop || 0;
            });
            while (pane.firstChild) pane.removeChild(pane.firstChild);
            var off = this.sectionOff(sec), why = this.reasons[sec];
            if (sec === 'theme') this.renderTheme(pane, off);
            else if (sec === 'transition') this.renderTransition(pane, off);
            else if (sec === 'animation') this.renderAnimation(pane, off);
            if (why) pane.setAttribute('title', why); else pane.removeAttribute('title');
            this.keepScroll(pane, scrolls, fresh);
            if (key) {
                var again = pane.querySelector('[data-vo="' + key + '"]');
                again && typeof again.focus === 'function' && again.focus();
            }
            /* The section height changed — the body scrollbar gets the new size, without
               scrolling to the start (that is done by the section show). */
            var v = rightView(), sc = v && v.scroller;
            sc && fn(sc, 'update') && sc.update();
        },

        /* A gallery longer than its window scrolls inside the card
           (compact-panel.less): the previous scroll goes back, and for a just
           shown section — to the selected tile, in the middle of the window. */
        keepScroll: function (pane, scrolls, fresh) {
            Array.prototype.forEach.call(pane.querySelectorAll('[data-vo-list]'), function (el) {
                var k = el.getAttribute('data-vo-list');
                if (!fresh && scrolls[k] !== undefined) { el.scrollTop = scrolls[k]; return; }
                var on = el.querySelector('.vo-rp-tile.vo-on');
                if (on) el.scrollTop = Math.max(0, Math.round(on.offsetTop - ((el.clientHeight || 0) - (on.offsetHeight || 0)) / 2));
            });
        },

        section: function (label, kids, cls) {
            var s = node('div', 'vo-rp-sec' + (cls ? ' ' + cls : ''));
            if (label) s.appendChild(node('div', 'vo-rp-label', {text: label}));
            (kids || []).forEach(function (k) { if (k) s.appendChild(k); });
            return s;
        },

        state: function (ref) {
            var B = bridge();
            return B && fn(B, 'state') ? B.state(ref) : {exists: false, disabled: true};
        },

        /* Tiles of a stock gallery by its groups: the group title is the caption
           of the stock group store. */
        tiles: function (ref, off, opts) {
            var me = this, B = bridge();
            opts = opts || {};
            var list = B && fn(B, 'tiles') ? B.tiles(ref) : [];
            var o = B && fn(B, 'twin') ? B.twin(ref) : null;
            var store = o && (o.store || (o.menuPicker && o.menuPicker.store));
            var locked = off || this.state(ref).disabled;
            var groups = opts.groups ? this.groupCaptions(ref) : null;
            var wrap = node('div', 'vo-rp-tiles' + (opts.cls ? ' ' + opts.cls : ''), {'data-vo-list': ref});
            var grid = null, group;
            list.forEach(function (t) {
                /* Caption — the record tooltip, for records without one — the title. */
                var caption = t.caption || String(rec(store && fn(store, 'at') ? store.at(parseInt(t.id, 10)) : null, 'title') || '');
                if (!grid || (groups && t.group !== group)) {
                    group = t.group;
                    if (groups && groups[group]) wrap.appendChild(node('div', 'vo-rp-group', {text: groups[group]}));
                    grid = node('div', 'vo-rp-grid');
                    wrap.appendChild(grid);
                }
                var tile = node('button', 'vo-rp-tile' + (t.selected ? ' vo-on' : ''), {
                    type: 'button', 'data-vo': ref + '#' + t.id, title: caption, 'aria-pressed': t.selected ? 'true' : 'false',
                    disabled: locked || t.disabled
                });
                if (opts.picture) tile.appendChild(opts.picture(t));
                tile.appendChild(node('span', 'vo-rp-tile-t', {text: caption}));
                tile.addEventListener('click', me.shell.guarded('panel: tile', function () {
                    if (B.pickTile(ref, t.id)) me.refresh();
                }));
                grid.appendChild(tile);
            });
            this.watchStore(ref);
            return wrap;
        },

        /* The tile mark is set by the stock code itself (a theme — by the engine after
           loading, an effect — on a slide change): the section is reread on
           the gallery store events. */
        watchStore: function (ref) {
            var me = this, B = bridge();
            var o = B && fn(B, 'twin') ? B.twin(ref) : null;
            var store = o && (o.store || (o.menuPicker && o.menuPicker.store));
            var events = 'change:selected reset add remove';
            this.watched = this.watched || {};
            var w = this.watched[ref];
            if (w && w.store === store) return;
            if (w && fn(w.store, 'off')) w.store.off(events, w.fn);
            delete this.watched[ref];
            if (!store || !fn(store, 'on')) return;
            var cb = this.shell.guarded('panel: gallery store', function () { me.later(); });
            store.on(events, cb);
            this.watched[ref] = {store: store, fn: cb};
        },

        /* Group captions of a stock gallery: the group store of ComboDataView/DataView. */
        groupCaptions: function (ref) {
            var B = bridge(), o = B && fn(B, 'twin') ? B.twin(ref) : null, out = {};
            var store = o && ((o.menuPicker && o.menuPicker.groups) || o.groups || (o.options && o.options.groups));
            if (!store) return out;
            var list = Array.isArray(store) ? store : (Array.isArray(store.models) ? store.models : []);
            list.forEach(function (g) {
                var id = rec(g, 'id'), cap = rec(g, 'caption');
                if (id != null && cap) out[id] = String(cap);
            });
            return out;
        },

        /* A list from a snapshot of the stock menu: the chosen item is the marked one. */
        mirrorSelect: function (ref, label, off) {
            var me = this, B = bridge();
            var rows = B && fn(B, 'mirror') ? B.mirror(ref) : [];
            var sel = node('select', 'vo-rp-select', {'data-vo': ref, 'aria-label': label,
                disabled: off || this.state(ref).disabled || !rows.length});
            var any = false;
            var add = function (r, prefix) {
                if (r.sep) return;
                if (r.sub) { r.sub.forEach(function (x) { add(x, r.caption + ' — '); }); return; }
                var o = node('option', '', {value: r.id, text: (prefix || '') + r.caption, disabled: r.disabled});
                if (r.checked) { o.selected = true; any = true; }
                sel.appendChild(o);
            };
            rows.forEach(function (r) { add(r, ''); });
            if (!any) {
                var none = node('option', '', {value: '', text: '', disabled: true, hidden: true});
                none.selected = true;
                sel.insertBefore(none, sel.firstChild);
            }
            sel.addEventListener('change', this.shell.guarded('panel: list', function () {
                var id = sel.value;
                if (id !== '') B.pick(ref, id);
                me.refresh();
            }));
            /* The list arrow is the AIR chevron, as in the lists of the stock tabs nearby. */
            var chevron = node('span', 'vo-rp-chevron');
            chevron.innerHTML = icon('chevron', 16);
            return node('span', 'vo-rp-field', {}, [sel, chevron]);
        },

        button: function (ref, text, off, cls) {
            var me = this, B = bridge();
            var st = this.state(ref);
            var b = node('button', 'vo-rp-btn' + (cls ? ' ' + cls : '') + (st.pressed ? ' vo-on' : ''), {
                type: 'button', 'data-vo': ref, disabled: off || st.disabled, text: text,
                'aria-pressed': cls === 'vo-rp-toggle' ? (st.pressed ? 'true' : 'false') : null
            });
            b.addEventListener('click', this.shell.guarded('panel: button', function () {
                if (B.run(ref)) me.refresh();
            }));
            return b;
        },

        /* A checkbox is a counterpart of the stock CheckBox: the value is written into the stock
           control, its 'change' reaches the tab controller. */
        checkbox: function (ref, text, off) {
            var me = this, B = bridge();
            var o = B.twin(ref), st = this.state(ref);
            var checked = !!o && (fn(o, 'isChecked') ? !!o.isChecked() : o.value === true || o.value === 'checked');
            var input = node('input', '', {type: 'checkbox', 'data-vo': ref, disabled: off || st.disabled});
            input.checked = checked;
            input.addEventListener('change', this.shell.guarded('panel: checkbox', function () {
                var tw = B.twin(ref);
                if (tw && fn(tw, 'setValue') && !me.state(ref).disabled) tw.setValue(!!input.checked);
                me.refresh();
            }));
            /* The checkbox box is our own, as for the checkboxes of the stock tabs nearby. */
            return node('label', 'vo-rp-check', {}, [input, node('span', 'vo-rp-box', {'aria-hidden': 'true'}), node('span', '', {text: text})]);
        },

        /* A number is a counterpart of the stock MetricSpinner (seconds). */
        number: function (ref, label, off) {
            var me = this, B = bridge();
            var o = B.twin(ref), st = this.state(ref);
            var v = !o ? NaN : fn(o, 'getNumberValue') ? o.getNumberValue() : parseFloat(fn(o, 'getValue') ? o.getValue() : o.value);
            var input = node('input', 'form-control vo-rp-num', {type: 'number', min: '0', step: '0.25', 'data-vo': ref,
                'aria-label': label, disabled: off || st.disabled});
            input.value = isNaN(v) ? '' : String(v);
            input.addEventListener('focus', this.shell.guarded('panel: number focus', function () {
                var s = me.shell;
                s && fn(s, 'engineKeys') && s.engineKeys(false);
            }));
            input.addEventListener('change', this.shell.guarded('panel: number', function () {
                var n = parseFloat(input.value), tw = B.twin(ref);
                if (!isNaN(n) && tw && fn(tw, 'setValue') && !me.state(ref).disabled) tw.setValue(n);
                me.refresh();
            }));
            return node('span', 'vo-rp-num-wrap', {}, [input, node('span', 'vo-rp-unit', {text: this.textSeconds})]);
        },

        renderTheme: function (pane, off) {
            var B = bridge(), o = B.twin(REF.themes);
            var store = o && (o.store || (o.menuPicker && o.menuPicker.store));
            var picture = function (t) {
                var r = store && fn(store, 'at') ? store.at(parseInt(t.id, 10)) : null;
                var pic = node('span', 'vo-rp-pic item-theme');
                var url = rec(r, 'imageUrl'), dy = rec(r, 'offsety');
                pic.style.backgroundPosition = '0 -' + (parseFloat(dy) || 0) + 'px';
                if (url) pic.style.backgroundImage = 'url(' + url + ')';
                return pic;
            };
            /* The "Theme" title is in the card header: there is no caption above the tiles. */
            pane.appendChild(this.section('', [this.tiles(REF.themes, off, {picture: picture, cls: 'vo-rp-themes'})]));
            pane.appendChild(this.section(this.textColorScheme, [this.mirrorSelect(REF.schemes, this.textColorScheme, off)]));
            pane.appendChild(this.section('', [node('div', 'vo-rp-note', {text: this.textThemeHint})]));
        },

        renderTransition: function (pane, off) {
            var dur = this.textDuration, delay = stock('Transitions.strDelay') || this.textDelay;
            pane.appendChild(this.section(this.textEffect, [this.tiles(REF.effects, off, {groups: true, cls: 'vo-rp-effects'})]));
            pane.appendChild(this.section(stock('Transitions.txtParameters') || this.textParameters,
                [this.mirrorSelect(REF.params, stock('Transitions.txtParameters') || this.textParameters, off)]));
            pane.appendChild(this.section(dur, [this.number(REF.duration, dur, off)]));
            pane.appendChild(this.section('', [
                this.checkbox(REF.startOnClick, stock('Transitions.strStartOnClick') || this.textStartOnClick, off),
                node('div', 'vo-rp-row', {}, [this.checkbox(REF.delayOn, delay, off), this.number(REF.delay, delay, off)]),
                node('div', 'vo-rp-row', {}, [this.button(REF.applyAll, stock('Transitions.txtApplyToAll') || this.textApplyToAll, off)]),
                node('div', 'vo-rp-row', {}, [this.button(REF.preview, stock('Transitions.txtPreview') || this.textPreview, off)])
            ]));
        },

        renderAnimation: function (pane, off) {
            if (this.hasObject()) {
                pane.appendChild(this.section(this.textAnimationEffects,
                    [this.tiles(REF.animations, off, {groups: true, cls: 'vo-rp-effects'})]));
            } else {
                pane.appendChild(this.section('', [node('div', 'vo-rp-note', {text: this.textAnimationHint})]));
            }
            pane.appendChild(this.section('', [this.button(REF.animationPane,
                stock('Animation.txtAnimationPane') || this.textAnimationPane, off, 'vo-rp-toggle')]));
        },

        /* Layout — the stock layout gallery at the button; size — the menu of the stock button. */
        renderSlideMore: function (more) {
            var me = this, B = bridge();
            while (more.firstChild) more.removeChild(more.firstChild);
            var off = this.sectionOff('slide');
            var st = this.state(REF.layout);
            var layout = node('button', 'vo-rp-btn vo-rp-drop', {type: 'button', 'data-vo': REF.layout,
                disabled: off || st.disabled, 'aria-haspopup': 'true', 'aria-expanded': this.layoutShown ? 'true' : 'false'});
            var chevron = node('span', 'vo-rp-chevron');
            chevron.innerHTML = icon('chevron', 16);
            layout.appendChild(node('span', '', {text: stock('DocumentHolder.txtChangeLayout') || this.textChangeLayout}));
            layout.appendChild(chevron);
            /* The click does not reach the document: the stock click-outside handler of the
               menu (bootstrap clearMenus) would close the just shown
               gallery, like the toolbar gallery buttons. The open
               stock menus of the tab are closed; a repeat closes the gallery. */
            layout.addEventListener('click', this.shell.guarded('panel: layout', function (e) {
                if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                if (me.layoutShown && fn(B, 'galleryOpen') && B.galleryOpen()) { B.closeGallery('toggle'); return; }
                var mm = Common.UI && Common.UI.Menu && Common.UI.Menu.Manager;
                mm && fn(mm, 'hideAll') && mm.hideAll();
                var shown = B.gallery(REF.layout, layout, {align: 'tr-br', onClose: function () {
                    me.layoutShown = false;
                    var b = more.querySelector('[data-vo="' + REF.layout + '"]');
                    b && b.setAttribute('aria-expanded', 'false');
                }});
                if (!shown) { B.run(REF.layout); return; }
                me.layoutShown = true;
                layout.setAttribute('aria-expanded', 'true');
            }));
            more.appendChild(this.section(this.textLayout, [layout]));
            var size = stock('Toolbar.txtSlideSize') || this.textSlideSize;
            more.appendChild(this.section(size, [this.mirrorSelect(REF.size, size, off)]));
            return more;
        },

        /* --- Texts ---------------------------------------------------------------------- */

        textSlideSettings: 'Slide settings',
        textTheme: 'Theme',
        textTransition: 'Transition',
        textAnimation: 'Animation',
        textObjectSettings: 'Object settings',
        textColorScheme: 'Color scheme',
        textThemeHint: 'The theme changes the background, fonts and colors of all slides. Create your own theme in View → Slide master.',
        textEffect: 'Effect',
        textParameters: 'Options',
        textDuration: 'Duration',
        textDelay: 'Delay',
        textSeconds: 's',
        textStartOnClick: 'Start on click',
        textApplyToAll: 'Apply to all slides',
        textPreview: 'Preview',
        textAnimationEffects: 'Object animation',
        textAnimationHint: 'Select an object on the slide to add an animation.',
        textAnimationPane: 'Animation pane',
        textLayout: 'Layout',
        textChangeLayout: 'Change layout',
        textSlideSize: 'Slide size'

    }, PE.Views.SlideSections || {});

    return PE.Views.SlideSections;
});
