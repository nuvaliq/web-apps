/*
 * CompactModes — the "Editing" and "Viewing" modes.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * mode() is the current mode, setMode(mode) switches it, reason(item) is the
 * reason an item is unavailable in the current mode. The zone announces a mode
 * change with the MODE_EVENT notification ('vo:mode', {mode}) in
 * Common.NotificationCenter.
 *
 * "Viewing" is the stock editing lock with its own reason type (VIEW_TYPE) and
 * its own viewOptions set, plus an engine restriction: OnlyComments when the
 * user may comment, otherwise View. The ribbon, the right panel, the status
 * bar and the left menu are disabled by the stock code itself; the reason
 * stack (Main.stackDisableActions) pushes and pops them by type. Returning
 * removes its own reason and its own restriction bit: the other reasons in the
 * stack and the other engine restrictions stay.
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES.
 */
define([], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    var VIEW_TYPE = 'vo-view';

    /* Shell commands that open a right-panel section (SlideSections). */
    var PANEL_COMMANDS = ['slideSection', 'objectProperties'];

    function ctl(name) {
        try { return (PE.getController && PE.getController(name)) || null; } catch (e) { return null; }
    }

    function stockOptions() {
        var main = ctl('Main');
        return (main && main.appOptions) || {};
    }

    PE.Views.CompactModes = _.extend({

        MODE_EVENT: 'vo:mode',
        VIEW_TYPE: VIEW_TYPE,

        shell: null,
        current: 'edit',
        bit: 0,             // own engine restriction bit in "Viewing"; 0 — not set

        install: function (shell) {
            var me = this, nc = Common.NotificationCenter;
            this.shell = shell;
            this.current = 'edit';
            this.bit = 0;
            /* The "Stock interface" does not know its own "Viewing", and there is
               nothing to clear it with there: switching to it restores "Editing". */
            nc.on('shell:advanced', shell.guarded('modes: stock interface', function (advanced) {
                if (advanced && me.current === 'view') me.leave();
            }));
        },

        mode: function () { return this.current; },

        /* Switching is possible with edit rights in a built shell. */
        setMode: function (mode) {
            var s = this.shell;
            if (mode !== 'edit' && mode !== 'view') return false;
            if (!s || s.advanced || s.startupFailed || !document.getElementById('vo-shell')) return false;
            if (typeof s.editRight !== 'function' || !s.editRight()) return false;
            if (mode === this.current) return false;
            var api = this.api(), R = window.Asc && Asc.c_oAscRestrictionType;
            if (!api || !R || typeof api.asc_addRestriction !== 'function' || typeof api.asc_removeRestriction !== 'function') return false;
            if (mode === 'view') this.enter(); else this.leave();
            return true;
        },

        api: function () {
            var s = this.shell;
            return s && typeof s.engineApi === 'function' ? s.engineApi() : null;
        },

        canComment: function () {
            var o = stockOptions();
            return !!o.canCoAuthoring && !!o.canComments;
        },

        /* Shortcuts that the stock ribbon mask suspends
           (Toolbar.DisableToolbar) but that stay alive in "Viewing": presenting and
           commenting. The keys are the same as in the stock DocumentHolder. */
        hotkeys: function () {
            var mac = !!(Common.Utils && Common.Utils.isMac);
            return {preview: mac ? 'command+shift+enter' : 'ctrl+f5', comment: mac ? 'command+alt+a' : 'alt+h'};
        },

        enter: function () {
            var open = this.openPanel();
            var R = Asc.c_oAscRestrictionType;
            this.current = 'view';
            this.bit = this.canComment() ? R.OnlyComments : R.View;
            this.engineBit(this.bit, true);
            Common.NotificationCenter.trigger('editing:disable', true, this.viewOptions(true), VIEW_TYPE);
            var keys = this.hotkeys(), sc = Common.util && Common.util.Shortcuts;
            if (sc && typeof sc.resumeEvents === 'function') {
                sc.resumeEvents(keys.preview);
                if (this.canComment()) sc.resumeEvents(keys.comment);
            }
            if (open) this.reopenPanel(open);
            this.viewerMenus();
            this.shell.setRow('toolbar', false, 'view');
            Common.NotificationCenter.trigger(this.MODE_EVENT, {mode: 'view'});
        },

        leave: function () {
            this.current = 'edit';
            if (this.bit) this.engineBit(this.bit, false);
            this.bit = 0;
            Common.NotificationCenter.trigger('editing:disable', false, this.viewOptions(false), VIEW_TYPE);
            this.shell.setRow('toolbar', true, 'view');
            Common.NotificationCenter.trigger(this.MODE_EVENT, {mode: 'edit'});
        },

        /* The lock set is a copy of Main.disableEditing for presentations (the same
           set of keys; viewMode follows disable, as in the stock one: when
           DisableToolbar is lifted it waits for viewMode false). Four values are
           our own: the context menu stays alive ("Undo", "Add comment" in the stock
           view menu), comments stay alive without preview, the chat stays alive. */
        viewOptions: function (disable) {
            disable = !!disable;
            return {
                viewMode: disable,
                allowSignature: false,
                rightMenu: {clear: true, disable: true},
                statusBar: true,
                leftMenu: {disable: true, previewMode: true},
                fileMenu: {protect: true, history: false},
                comments: {disable: false, previewMode: false},
                chat: false,
                review: true,
                viewport: true,
                documentHolder: {clear: true, disable: false},
                toolbar: true,
                header: {search: false},
                shortcuts: false,
                documentPreview: {draw: false}
            };
        },

        /* Own bit in the engine restrictions. While the engine has its own action
           with a restriction (connection loss, background opening), the current
           restrictions are its: it saved the previous ones in IsActionRestrictionPrev
           and will restore them at the end of the action. In that case the bit is
           set and cleared in the saved ones — cleared from the current ones, it
           would come back with the restore. */
        engineBit: function (bit, on) {
            var api = this.api();
            if (typeof api.isActionWithRestriction === 'function' && api.isActionWithRestriction() &&
                typeof api.IsActionRestrictionPrev === 'number') {
                api.IsActionRestrictionPrev = on ? (api.IsActionRestrictionPrev | bit) : (api.IsActionRestrictionPrev & ~bit);
                return;
            }
            if (on) api.asc_addRestriction(bit);
            else api.asc_removeRestriction(bit);
        },

        /* The stock view menus (viewModeMenu, viewModeMenuSlide) are built by the stock
           code at startup only for a reader, and for an editor lazily, on the first
           right click on an object; the thumbnail menu does not open without them. */
        viewerMenus: function () {
            var dh = ctl('DocumentHolder');
            var view = dh && (dh.documentHolder || (typeof dh.getView === 'function' && dh.getView()));
            if (view && typeof view.createDelayedElementsViewer === 'function') view.createDelayedElementsViewer();
        },

        /* The open panel of the left area: the stock lock closes it
           (LeftMenu.SetDisabled → close), but in "Viewing" one can read and write
           comments, search and chat. */
        openPanel: function () {
            var left = PE.Views.CompactLeft, open = null;
            if (!left || typeof left.isOpen !== 'function') return null;
            _.each(_.keys(left.STOCK_PANELS || {}), function (name) {
                if (!open && left.isOpen(name)) open = name;
            });
            return open;
        },

        reopenPanel: function (name) {
            var left = PE.Views.CompactLeft;
            if (left && typeof left.isOpen === 'function' && !left.isOpen(name) && typeof left.openPanel === 'function')
                left.openPanel(name);
        },

        /* Mode reason: in "Viewing" the items that edit the presentation and the
           right-panel sections are always disabled — the stock ribbon mask does not
           disable the buttons, and availability from the counterpart is good only
           outside "Viewing". A right-panel section is both the section itself (panel)
           and the item that opens it (the PANEL_COMMANDS commands): the stock right
           panel is disabled by the lock in "Viewing". Without edit rights the reason is
           named by the catalog (SlideActions.itemState). */
        reason: function (item) {
            if (this.current !== 'view' || !item) return null;
            var s = this.shell;
            if (s && typeof s.editRight === 'function' && !s.editRight()) return null;
            var panel = item.panel === true || _.contains(PANEL_COMMANDS, item.cmd);
            return (item.edit === true || panel) ? this.textModeLockedView : null;
        },

        textModeLockedView: 'Unavailable in viewing mode'

    }, PE.Views.CompactModes || {});

    return PE.Views.CompactModes;
});
