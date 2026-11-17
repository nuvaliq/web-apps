/*
 * SlideSelection — classifier of the selection on a slide.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Kind of selection for the panel and the menu: 'none', 'text', 'shape', 'image',
 * 'table', 'chart', 'line', 'typing'. The source is the stock asc_onFocusObject,
 * parsed the same way the stock handlers parse it
 * (controller/Toolbar.js onApiFocusObject, controller/DocumentHolderExt.js
 * fillMenuProps): table; chart — a Chart element or the shape properties of its
 * frame (get_FromChart); image — an Image element or a shape made from an
 * image (get_FromImage); line — a shape of the line or connector type;
 * any other shape or group — text if the selection contains text, otherwise
 * a shape. The engine sends paragraph properties for any shape and group into
 * which text can be entered, even an empty one, so the text is read from the
 * selected objects themselves (hasText): a placeholder with a text body, a
 * text box, a shape or group with non-empty text. Text typing — the cursor in
 * the text of a shape or notes: the engine has no separate event for it, the
 * sign is a text target of the current slide controller.
 *
 * On every asc_onFocusObject — the vo:selection event {kind, props} in
 * Common.NotificationCenter; props are the stock values of the selection elements.
 * Before the event, the right-panel tabs "Shape", "Table" and "Image"
 * receive ChangeSettings with the object properties: the stock code builds their
 * fields on the first show of a tab and updates them only for the open panel,
 * while the toolbar buttons are counterparts of these fields even when the
 * panel is collapsed.
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES.
 */
define([], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    /* Lines and connectors — the same list by which the stock onApiFocusObject
       separates them from other shapes. */
    var LINES = {
        line: 1, straightConnector1: 1,
        bentConnector2: 1, bentConnector3: 1, bentConnector4: 1, bentConnector5: 1,
        curvedConnector2: 1, curvedConnector3: 1, curvedConnector4: 1, curvedConnector5: 1
    };

    /* Placeholders not meant for text: picture, chart, table, clip, diagram,
       media, slide thumbnail. An empty placeholder of this kind does not count as text. */
    var PH_NOT_TEXT = ['phType_pic', 'phType_chart', 'phType_tbl', 'phType_clipArt', 'phType_dgm', 'phType_media', 'phType_sldImg'];

    /* Right-panel tabs that are fed with the selection properties:
       field of the stock RightMenu → props key. */
    var TABS = [['shapeSettings', 'shape'], ['tableSettings', 'table'], ['imageSettings', 'image']];

    var warned = {};

    function types() {
        return (window.Asc && Asc.c_oAscTypeSelectElement) || {};
    }

    function read(o, name) {
        try { return o && typeof o[name] === 'function' ? o[name]() : undefined; } catch (e) { return undefined; }
    }

    function textPlaceholder(o) {
        if (!o.txBody || typeof o.isPlaceholder !== 'function' || !o.isPlaceholder()) return false;
        var F = window.AscFormat || {}, type = typeof o.getPlaceholderType === 'function' ? o.getPlaceholderType() : null;
        return !PH_NOT_TEXT.some(function (k) { return F[k] !== undefined && F[k] === type; });
    }

    /* Engine object with text: a placeholder with a text body (its prompt is
       the place for text), a text box, a shape with non-empty text, a group with such
       an object at any depth. Read only; a failure is thrown outward. */
    function textual(o) {
        if (!o) return false;
        if (Array.isArray(o.spTree)) return o.spTree.some(textual);
        if (textPlaceholder(o)) return true;
        if (typeof o.isTextBox === 'function' && o.isTextBox()) return true;
        var dc = typeof o.getDocContent === 'function' ? o.getDocContent() : null;
        return !!dc && /\S/.test(dc.GetText({Numbering: false}) || '');
    }

    PE.Views.SlideSelection = _.extend({

        shell: null,
        current: 'none',
        last: null,

        kind: function () { return this.current; },

        props: function () { return this.last || {}; },

        /* Selection composition → {kind, props}. typing — the cursor is in text; text —
           the selection contains text (true/false, undefined — unknown) or
           a function that will read it: called only when the shape kind
           depends on it. */
        classify: function (objects, typing, text) {
            var T = types(), p = {};
            (objects || []).forEach(function (o) {
                var type = read(o, 'get_ObjectType'), value = read(o, 'get_ObjectValue');
                if (type === undefined) return;
                if (type === T.Paragraph) p.paragraph = p.paragraph || value;
                else if (type === T.Slide) p.slide = value;
                else if (type === T.Table) p.table = p.table || value;
                else if (type === T.Image) p.image = p.image || value;
                else if (type === T.Chart) p.chart = p.chart || value;
                else if (type === T.Shape) p.shape = p.shape || value;
                else if (type === T.Hyperlink) p.hyperlink = value;
            });
            var kind = 'none', sh = p.shape;
            if (p.table) kind = 'table';
            else if (p.chart || (sh && read(sh, 'get_FromChart'))) kind = 'chart';
            else if (p.image || (sh && read(sh, 'get_FromImage'))) kind = 'image';
            else if (sh) {
                if (LINES[read(sh, 'asc_getType')] === 1) kind = 'line';
                else if (typing) kind = 'typing';
                else if (!p.paragraph) kind = 'shape';
                else kind = (typeof text === 'function' ? text() : text) === false ? 'shape' : 'text';
            } else if (p.paragraph) kind = typing ? 'typing' : 'text';
            return {kind: kind, props: p};
        },

        /* Cursor in text: the current slide controller (or notes) has
           a text target. Read without side effects; no document — no
           cursor either. */
        typing: function () {
            try {
                var c = this.controller();
                return !!(c && typeof c.getTargetDocContent === 'function' && c.getTargetDocContent());
            } catch (e) {
                return false;
            }
        },

        /* The selection contains text: the selected objects of the current slide
           controller, and inside a group — its selected parts. Read without side
           effects, like typing(). undefined — could not be read: the kind
           stays as it was (a shape with a paragraph — text). */
        hasText: function () {
            try {
                var c = this.controller();
                if (!c) return undefined;
                var g = c.selection && c.selection.groupSelection;
                var list = g && Array.isArray(g.selectedObjects) && g.selectedObjects.length ? g.selectedObjects : c.selectedObjects;
                return Array.isArray(list) && list.length ? list.some(textual) : undefined;
            } catch (e) {
                return undefined;
            }
        },

        /* Current slide or notes controller; no document — null. */
        controller: function () {
            var api = this.shell && this.shell.engineApi ? this.shell.engineApi() : null;
            var doc = api && api.WordControl && api.WordControl.m_oLogicDocument;
            return doc && typeof doc.GetCurrentController === 'function' ? doc.GetCurrentController() : null;
        },

        install: function (shell) {
            var me = this;
            this.shell = shell;
            shell.onApi('asc_onFocusObject', function (objects) { me.onFocus(objects); });
            /* Return from the "Stock interface": the tabs receive the properties
               of the selection that changed there without them. */
            var back = function (advanced) { if (!advanced) me.feedTabs(me.props()); };
            Common.NotificationCenter.on('shell:advanced',
                typeof shell.guarded === 'function' ? shell.guarded('selection: advanced', back) : back);
        },

        onFocus: function (objects) {
            var me = this;
            var r = this.classify(objects, this.typing(), function () { return me.hasText(); });
            this.current = r.kind;
            this.last = r.props;
            this.feedTabs(r.props);
            Common.NotificationCenter.trigger('vo:selection', {kind: r.kind, props: r.props});
        },

        /* ChangeSettings of the right-panel tabs with the object properties — like
           the stock RightMenu.onFocusObject for the open tab. A tab has two
           consumers: the properties card (SlideSections) and the row controls
           whose counterparts are its fields (CompactToolbar.usesTab: shape fill and
           outline, image crop, table). While the card is closed, the tab is fed
           only if the row shows its controls for the current selection: the card
           feeds the shown tab itself on opening with the stock RightMenu
           properties (SlideSections.showStock). Only with edit rights: without
           them there is no stock right panel. In the "Stock interface" and after
           a startup failure the stock code feeds the panel itself. A tab failure
           interferes with neither the neighbors nor the selection event; logged
           once per tab. */
        feedTabs: function (props) {
            var shell = this.shell;
            if (!shell || shell.advanced === true || shell.startupFailed === true) return;
            if (typeof shell.editRight === 'function' && !shell.editRight()) return;
            var ctl = PE.getController ? PE.getController('RightMenu') : null;
            var view = ctl && ctl.rightmenu;
            if (!view) return;
            props = props || {};
            var sections = PE.Views.SlideSections, bar = PE.Views.CompactToolbar, kind = this.current;
            var open = !!(sections && typeof sections.isOpen === 'function' && sections.isOpen());
            TABS.forEach(function (t) {
                var tab = view[t[0]], value = props[t[1]];
                if (!value || !tab || typeof tab.ChangeSettings !== 'function') return;
                /* Without the row module there is no way to decide — feed as before. */
                if (!open && bar && typeof bar.usesTab === 'function' && !bar.usesTab(t[0], kind)) return;
                try {
                    tab.ChangeSettings(value);
                } catch (e) {
                    if (!warned[t[0]] && window.console && console.warn) {
                        warned[t[0]] = true;
                        console.warn('Compact shell: the stock ' + t[0] + ' tab failed.', e);
                    }
                }
            });
        }

    }, PE.Views.SlideSelection || {});

    return PE.Views.SlideSelection;
});
