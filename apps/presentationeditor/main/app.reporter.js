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
/**
 *    app.js
 *
 *    Created on 17 July 2017
 *
 */

'use strict';
var reqerr;
require.config({
    // The shim config allows us to configure dependencies for
    // scripts that do not call define() to register a module
    baseUrl: '../../',
    paths: {
        jquery          : '../vendor/jquery/jquery.min',
        underscore      : '../vendor/underscore/underscore-min',
        xregexp         : '../vendor/xregexp/xregexp-all-min',
        socketio        : '../vendor/socketio/socket.io.min',
        allfonts        : '../../sdkjs/common/AllFonts',
        sdk             : '../../sdkjs/slide/sdk-all-min'
    },
    shim: {
        sdk: {
            deps: [
                'jquery',
                'allfonts',
                'xregexp',
                'socketio'
            ]
        }
    }
});

require([
    'underscore',
    'sdk',
    'presentationeditor/main/reporter-ready'
], function (_, sdk, repeatPresenterReady) {
    window._ = _

    var metadataAccepted = false;
    var loadingCancelled = false;
    var readyLoop;
    var loadingEnd;
    var _msg_func = function(msg) {
        if (loadingCancelled || metadataAccepted) return;
        if (!window.AscDesktopEditor && (!window.opener || msg.source !== window.opener || msg.origin !== window.location.origin)) return;
        var data = msg.data, cmd;

        try {
            cmd = window.JSON.parse(data)
        } catch(e) {}

        if ( cmd ) {
            if ( cmd.type == 'file:open' && (window.AscDesktopEditor || (cmd.data && typeof cmd.data === 'object' && typeof cmd.data.key === 'string' && cmd.data.key.length > 0 && (cmd.data.tokenType === 'open' || cmd.data.tokenType === 'session')))) {
                metadataAccepted = true;
                if (readyLoop) readyLoop.stop();
                load_document(cmd.data);
            }
        }
    };

    if ( window.attachEvent )
        window.attachEvent('onmessage', _msg_func); else
        window.addEventListener('message', _msg_func, false);

    var lang = (/(?:&|^)lang=([^&]+)&?/i).exec(window.location.search.substring(1));
    lang = lang && lang[1] ? lang[1].split(/[\-\_]/)[0].toLowerCase() : '';

    var api = new Asc.asc_docs_api({
        'id-view'  : 'editor_sdk',
        using      : 'reporter',
        skin       : localStorage.getItem("ui-theme-id"),
        'isRtlInterface': lang && (lang.lastIndexOf('ar', 0) === 0 || lang.lastIndexOf('he', 0) === 0)
    });

    if (!window.AscDesktopEditor) {
        loadingEnd = document.createElement('button');
        loadingEnd.id = 'reporter_loading_end';
        loadingEnd.type = 'button';
        loadingEnd.className = 'btn-text-default';
        loadingEnd.style.position = 'fixed';
        loadingEnd.style.right = '10px';
        loadingEnd.style.bottom = '10px';
        loadingEnd.style.zIndex = '10001';
        loadingEnd.textContent = new URLSearchParams(window.location.search).get('reporterEndLabel');
        loadingEnd.addEventListener('click', function() {
            if (loadingCancelled) return;
            loadingCancelled = true;
            if (readyLoop) readyLoop.stop();
            api.EndDemonstration();
        });
        document.body.appendChild(loadingEnd);
    }

    var setDocumentTitle = function(title) {
        (title) && (window.document.title += (' - ' + title));
    };

    function load_document(data) {
        var docInfo = {};

        if ( data ) {
            docInfo = new Asc.asc_CDocInfo();
            docInfo.put_Id(data.key);
            docInfo.put_Url(data.url);
            docInfo.put_DirectUrl(data.directUrl);
            docInfo.put_Title(data.title);
            docInfo.put_Format(data.fileType);
            docInfo.put_VKey(data.vkey);
            docInfo.put_Options(data.options);
            docInfo.put_Token(data.token);
            if (!window.AscDesktopEditor) {
                docInfo.put_TokenType(data.tokenType);
                docInfo.put_Mode('view');
                api.asc_setViewMode(true);
            }
            docInfo.put_Permissions(data.permissions || {});
            setDocumentTitle(data.title);
        }

        api.preloadReporter(data);
        api.SetThemesPath("../../../../sdkjs/slide/themes/");
        api.asc_setDocInfo( docInfo );
        api.asc_getEditorPermissions();
        if (window.AscDesktopEditor) api.asc_setViewMode(true);
    }

    var onDocumentContentReady = function() {
        if (loadingCancelled) return;
        if (loadingEnd) {
            loadingEnd.parentNode.removeChild(loadingEnd);
            loadingEnd = null;
        }
        api.SetDrawingFreeze(false);
        $('#loading-mask').hide().remove();
    };

    var onOpenDocument = function(progress) {
        var proc = (progress.asc_getCurrentFont() + progress.asc_getCurrentImage())/(progress.asc_getFontsCount() + progress.asc_getImagesCount());
        console.log('progress: ' + proc);
    };

    var onEditorPermissions = function(params) {
        api.asc_LoadDocument();
    };

    api.asc_registerCallback('asc_onDocumentContentReady', onDocumentContentReady);
    // api.asc_registerCallback('asc_onOpenDocumentProgress', onOpenDocument);
    api.asc_registerCallback('asc_onGetEditorPermissions', onEditorPermissions);

    readyLoop = repeatPresenterReady({
        send: function() { api.sendFromReporter('i:am:ready'); },
        firstDelay: 500,
        interval: 500
    });
    window.addEventListener('pagehide', function() {
        loadingCancelled = true;
        readyLoop.stop();
    });

}, function(err) {
    if (err.requireType == 'timeout' && !reqerr && window.requireTimeourError) {
        reqerr = window.requireTimeourError();
        window.alert(reqerr);
        window.location.reload();
    }
});