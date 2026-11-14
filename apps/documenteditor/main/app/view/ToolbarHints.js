/*
 * ToolbarHints — hints for the buttons of the editor's compact panel.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Moves title into data-vo-hint while keeping the accessible name and description,
 * and shows a single hint with a delay within the editor window.
 */
define(['common/main/lib/util/utils'], function () {
    'use strict';

    var nextId = 0;

    function removeDescription(button, id) {
        var described = (button.getAttribute('aria-describedby') || '').split(/\s+/)
            .filter(function (value) { return value && value !== id; }).join(' ');
        if (described) button.setAttribute('aria-describedby', described);
        else button.removeAttribute('aria-describedby');
    }

    function ToolbarHints(root) {
        this.root = root;
        this.doc = root.ownerDocument;
        this.win = this.doc.defaultView;
        this.id = 'vo-toolbar-hint-' + (++nextId);
        this.listeners = [];
        this.descriptions = [];
        this.hide = this.hide.bind(this);
        var me = this;

        root.querySelectorAll('button.vo-ib[title]').forEach(function (button) { me.storeTitle(button); });
        this.listen(root, 'pointerover', function (event) {
            if (event.pointerType === 'touch') return;
            var button = event.target.closest('button.vo-ib');
            if (!button || !root.contains(button) || button === me.target || button === me.pressed) return;
            me.hide();
            me.storeTitle(button);
            if (!button.hasAttribute('data-vo-hint') || me.menuOpen(button)) return;
            me.target = button;
            me.timer = me.win.setTimeout(function () { me.show(); }, 500);
        });
        this.listen(root, 'pointerout', function (event) {
            if (me.pressed && !me.pressed.contains(event.relatedTarget)) me.pressed = null;
            if (me.target && !me.target.contains(event.relatedTarget)) me.hide();
        });
        function press(event) {
            var button = event.target.closest('button.vo-ib');
            if (button && root.contains(button) &&
                (event.type === 'pointerdown' || button.matches(':hover'))) me.pressed = button;
            me.hide();
        }
        this.listen(this.doc, 'pointerdown', press, true);
        this.listen(this.doc, 'click', press, true);
        this.listen(this.doc, 'keydown', function (event) { if (event.key === 'Escape') me.hide(); }, true);
        this.listen(this.doc, 'scroll', this.hide, true);
        this.listen(this.win, 'scroll', this.hide, true);
        this.listen(this.win, 'resize', this.hide);
        this.listen(this.win, 'blur', this.hide);

        this.titles = new MutationObserver(function (records) {
            records.forEach(function (record) {
                if (record.target.matches('button.vo-ib[title]')) me.storeTitle(record.target);
            });
            if (me.tip && me.target) {
                me.tip.firstChild.textContent = me.target.getAttribute('data-vo-hint');
                me.position();
            }
        });
        this.titles.observe(root, {attributes: true, subtree: true, attributeFilter: ['title']});
        this.menus = new MutationObserver(function () {
            if (me.target && me.menuOpen(me.target)) me.hide();
        });
        this.menus.observe(root, {attributes: true, subtree: true, attributeFilter: ['class', 'aria-expanded']});
        this.mode = new MutationObserver(this.hide);
        this.mode.observe(this.doc.body, {attributes: true, attributeFilter: ['class']});
    }

    ToolbarHints.prototype.listen = function (target, name, handler, capture) {
        target.addEventListener(name, handler, !!capture);
        this.listeners.push([target, name, handler, !!capture]);
    };

    ToolbarHints.prototype.storeTitle = function (button) {
        var title = button.getAttribute('title');
        if (title === null) return;
        button.setAttribute('data-vo-hint', title);
        if ((!button.hasAttribute('aria-label') && !button.textContent.trim()) ||
            button.hasAttribute('data-vo-hint-label')) {
            button.setAttribute('aria-label', title);
            button.setAttribute('data-vo-hint-label', '');
        } else {
            this.describe(button, title);
        }
        // Keep the accessible name while suppressing the browser's second tooltip.
        button.removeAttribute('title');
    };

    ToolbarHints.prototype.describe = function (button, title) {
        var entry = this.descriptions.find(function (item) { return item.button === button; });
        if (!entry) {
            if ((button.getAttribute('aria-describedby') || '').trim() || button.getAttribute('aria-description')) return;
            var node = this.doc.createElement('span');
            node.id = this.id + '-description-' + this.descriptions.length;
            node.className = 'vo-toolbar-hint-description';
            node.hidden = true;
            this.doc.body.appendChild(node);
            button.setAttribute('aria-describedby', node.id);
            entry = {button: button, node: node};
            this.descriptions.push(entry);
        }
        // A captioned control keeps its title-derived description for keyboard and screen-reader users.
        entry.node.textContent = title;
    };

    ToolbarHints.prototype.menuOpen = function (button) {
        var wrap = button.closest('.vo-pop-wrap, .vo-cb');
        return button.getAttribute('aria-expanded') === 'true' || !!(wrap && wrap.classList.contains('open')) ||
            (button.classList.contains('vo-more') && this.root.classList.contains('vo-of-open'));
    };

    ToolbarHints.prototype.show = function () {
        this.timer = null;
        var button = this.target, body = this.doc.body;
        if (!button || button === this.pressed || this.menuOpen(button) || !button.isConnected ||
            !button.getClientRects().length ||
            !body.classList.contains('vo-compact') || body.classList.contains('vo-tb-hidden')) {
            this.hide();
            return;
        }
        var title = button.getAttribute('data-vo-hint');
        if (!title) return;
        var tip = this.doc.createElement('div');
        tip.id = this.id;
        tip.className = 'tooltip in arrow-free vo-toolbar-hint';
        tip.setAttribute('role', 'tooltip');
        tip.style.cssText = 'position:fixed;pointer-events:none;z-index:1100;padding:0';
        var inner = this.doc.createElement('div');
        inner.className = 'tooltip-inner';
        inner.textContent = title;
        inner.style.boxSizing = 'border-box';
        inner.style.maxWidth = Math.max(1, Math.min(300, Common.Utils.innerWidth() - 16)) + 'px';
        tip.appendChild(inner);
        body.appendChild(tip);
        this.tip = tip;
        if (!(button.getAttribute('aria-describedby') || '').trim() && !button.getAttribute('aria-description')) {
            button.setAttribute('aria-describedby', this.id);
        }
        this.position();
    };

    ToolbarHints.prototype.position = function () {
        var box = Common.Utils.getBoundingClientRect(this.target), tip = this.tip;
        var left = box.left + (box.width - tip.offsetWidth) / 2;
        var top = box.bottom + 8;
        if (top + tip.offsetHeight > Common.Utils.innerHeight() - 8) top = box.top - tip.offsetHeight - 8;
        tip.style.left = Math.max(8, Math.min(left, Common.Utils.innerWidth() - tip.offsetWidth - 8)) + 'px';
        tip.style.top = Math.max(8, top) + 'px';
    };

    ToolbarHints.prototype.hide = function () {
        this.win.clearTimeout(this.timer);
        this.timer = null;
        if (this.tip) this.tip.remove();
        this.tip = null;
        if (this.target) removeDescription(this.target, this.id);
        this.target = null;
    };

    ToolbarHints.prototype.destroy = function () {
        this.hide();
        this.titles.disconnect();
        this.menus.disconnect();
        this.pressed = null;
        this.mode.disconnect();
        this.listeners.forEach(function (entry) { entry[0].removeEventListener(entry[1], entry[2], entry[3]); });
        this.listeners = [];
        this.descriptions.forEach(function (entry) {
            removeDescription(entry.button, entry.node.id);
            entry.node.remove();
        });
        this.descriptions = [];
        this.root.querySelectorAll('button.vo-ib[data-vo-hint]').forEach(function (button) {
            button.setAttribute('title', button.getAttribute('data-vo-hint'));
            button.removeAttribute('data-vo-hint');
            if (button.hasAttribute('data-vo-hint-label')) {
                button.removeAttribute('aria-label');
                button.removeAttribute('data-vo-hint-label');
            }
        });
    };

    return ToolbarHints;
});
