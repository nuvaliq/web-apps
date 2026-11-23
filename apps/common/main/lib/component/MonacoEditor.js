/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

if (Common === undefined)
    var Common = {};

define(['common/main/lib/component/BaseView'], function () {
    'use strict';

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function owns(value, key) {
        return Object.prototype.hasOwnProperty.call(value, key);
    }

    function isPosition(value) {
        return isObject(value) && owns(value, 'row') && owns(value, 'column') &&
            Number.isSafeInteger(value.row) && value.row >= 0 &&
            Number.isSafeInteger(value.column) && value.column >= 0;
    }

    function isCommand(cmd, id) {
        if (!isObject(cmd) || !owns(cmd, 'referer') || cmd.referer !== 'monaco-editor-' + id ||
            !owns(cmd, 'command')) return false;

        if (cmd.command === 'monacoEditorReady') {
            return !owns(cmd, 'data') || (isObject(cmd.data) && Object.keys(cmd.data).length === 0);
        }
        return cmd.command === 'changeValue' && owns(cmd, 'data') && isObject(cmd.data) &&
            owns(cmd.data, 'value') && typeof cmd.data.value === 'string' &&
            owns(cmd.data, 'pos') && isPosition(cmd.data.pos);
    }

    Common.UI.MonacoEditor = Common.UI.BaseView.extend({
        initialize : function(options) {
            Common.UI.BaseView.prototype.initialize.call(this, options);

            this.id = _.uniqueId();
            this.parentEl = options.parentEl;
            this.language = options.language || 'javascript';
            this.parentEl && this.render(this.parentEl);
        },

        render: function (parentEl) {
            this.parentEl = typeof parentEl === 'string' ? $(parentEl) : parentEl;
            this._active = false;

            var src = '../../../vendor/monaco/MonacoEditor.html';
            src += '?editorType=' + (window.SSE ? 'cell' : window.PE ? 'slide' : window.PDFE ? 'pdf' : 'word');
            src += '&language=' + this.language;
            src += '&id=' + this.id;

            var url;
            try {
                url = new URL(src, document.baseURI);
            } catch (e) {
                return;
            }
            if ((url.protocol !== 'https:' && url.protocol !== 'http:') ||
                url.origin !== window.location.origin) return;

            this.iframe = document.createElement("iframe");
            this.iframe.width        = '100%';
            this.iframe.height       = '100%';
            this.iframe.align        = "top";
            this.iframe.frameBorder  = 0;
            this.iframe.scrolling    = "no";
            this.iframe.onload       = _.bind(this._onLoad,this);
            this.parentEl.append(this.iframe);

            this.loadMask = new Common.UI.LoadMask({owner: this.parentEl});
            this.loadMask.show();

            this._frameWindow = this.iframe.contentWindow;
            if (!this._frameWindow) {
                this.loadMask.hide();
                return;
            }
            this._origin = url.origin;
            this._active = true;

            var me = this;
            this._eventfunc = function(msg) {
                me._onMessage(msg);
            };
            this._updatebind = function() {
                me.updateTheme();
            };
            this._bindWindowEvents.call(this);
            this.iframe.src = url.href;
        },

        _bindWindowEvents: function() {
            if (window.addEventListener) {
                window.addEventListener("message", this._eventfunc, false)
            } else if (window.attachEvent) {
                window.attachEvent("onmessage", this._eventfunc);
            }
            Common.NotificationCenter.on('uitheme:changed', this._updatebind);
        },

        _unbindWindowEvents: function() {
            if (window.removeEventListener) {
                window.removeEventListener("message", this._eventfunc)
            } else if (window.detachEvent) {
                window.detachEvent("onmessage", this._eventfunc);
            }
            Common.NotificationCenter.off('uitheme:changed', this._updatebind);
        },

        _postMessage: function(wnd, msg) {
            if (this._active && wnd === this._frameWindow && wnd.postMessage && window.JSON) {
                msg.referer = 'monaco-editor-' + this.id;
                wnd.postMessage(window.JSON.stringify(msg), this._origin);
            }
        },

        _onMessage: function(msg) {
            if (!this._active || !msg || msg.source !== this._frameWindow || msg.origin !== this._origin) {
                return;
            }
            var data = msg.data;
            if (typeof data !== 'string' || !window.JSON) {
                return;
            }
            var cmd;

            try {
                cmd = window.JSON.parse(data)
            } catch(e) {
                cmd = '';
            }

            if (isCommand(cmd, this.id)) {
                switch (cmd.command) {
                    case 'changeValue':
                        data = cmd.data;
                        this.fireEvent('change', data.value, data.pos);
                        break;
                    case 'monacoEditorReady':
                        this.fireEvent('ready');
                        break;
                }
            }
        },

        _onLoad: function() {
            if (!this._active) return;
            this.updateTheme();
            if (this.loadMask)
                this.loadMask.hide();
        },

        setValue: function(value, currentPos, readonly) {
            this._postMessage(this.iframe && this.iframe.contentWindow, {
                command: 'setValue',
                data: {
                    value: value,
                    readonly: readonly,
                    currentPos: currentPos
                }
            });
        },

        updateTheme: function() {
            this._postMessage(this.iframe && this.iframe.contentWindow, {
                command: 'setTheme',
                data: Common.UI.Themes.getThemeColors()
            });
        },

        disableDrop: function(disable) {
            this._postMessage(this.iframe && this.iframe.contentWindow, {
                command: 'disableDrop',
                data: disable
            });
        },

        revealPositionInCenter: function() {
            this._postMessage(this.iframe && this.iframe.contentWindow, {
                command: 'revealPositionInCenter',
                data: {}
            });
        },

        undo: function() {
            this._postMessage(this.iframe && this.iframe.contentWindow, {
                command: 'undo',
                data: {}
            });
        },

        redo: function() {
            this._postMessage(this.iframe && this.iframe.contentWindow, {
                command: 'redo',
                data: {}
            });
        },

        enablePointerEvents: function(enable) {
            this.iframe && (this.iframe.style.pointerEvents = enable ? "" : "none");
        },

        destroyEditor: function() {
            this._active = false;
            if (this._eventfunc) this._unbindWindowEvents();
            this._eventfunc = null;
            this._updatebind = null;
            this._frameWindow = null;
        }
    });
});
