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
 *  About.js
 *
 *  Created on 3/06/14
 *
 */

define([
    'common/main/lib/component/BaseView',
    'common/main/lib/component/Scroller'
], function () { 'use strict';

    var LICENSE_URL = '../../common/LICENSE.txt',  // LICENSE of the repository, copied to the common resources by the build
        CC_URL = 'https://creativecommons.org/licenses/by-sa/4.0/legalcode',
        // the build puts the address of the release sources and the full release number here
        SOURCE_URL = '{{SOURCE_URL}}',
        RELEASE_VERSION = '{{RELEASE_VERSION}}';

    // a value left by the build as a placeholder (not built sources) counts as not set
    function sourceUrl() {
        return /^https:\/\//.test(SOURCE_URL) ? SOURCE_URL : '';
    }

    function releaseVersion() {
        return RELEASE_VERSION && RELEASE_VERSION.indexOf('{{') < 0 ? RELEASE_VERSION : '';
    }

    function link(href, text) {
        return '<a href="' + href + '" target="_blank" rel="noopener">' + text + '</a>';
    }

    // puts ready html in place of %1 of an already encoded string
    function insert(encoded, html) {
        return encoded.replace('%1', function () { return html; });
    }

    Common.Views.About = Common.UI.BaseView.extend(_.extend({
        menu: undefined,
        rendered: false,
        options: {
            alias: 'Common.Views.About'
        },

        // full version with the build number: Main.onServerVersion compares it with the server build
        txtVersionNum: '{{PRODUCT_VERSION}}',

        initialize: function(options) {
            Common.UI.BaseView.prototype.initialize.call(this,arguments);
            this.menu = options.menu;
        },

        // Legal notice of the modified version: product name, version, the lines of the notice and the paragraph
        // about non-code content. No logo, publisher, contacts or licensee block. Works without an instance
        // (`this` is the prototype carrying the locale strings), so any container can show the same content.
        contentHtml: function() {
            var encode = Common.Utils.String.htmlEncode,
                release = releaseVersion(),
                version = release ? [release] : /^\d+\.\d+\.\d+/.exec(this.txtVersionNum),
                url = sourceUrl(),
                lines = [
                    encode(this.txtModified),
                    encode(this.txtCopyright),
                    encode(this.txtBasedOn),
                    encode(this.txtAscensio),
                    encode(this.txtTrademark),
                    insert(encode(this.txtLicense), link(LICENSE_URL, encode(this.txtLicenseLink)))
                ];

            // without the address of the sources the line is not shown
            url && lines.push(insert(encode(this.txtSource), link(encode(url), encode(url))));

            return '<div class="about-content">' +
                    '<div class="about-head">' +
                        '<h2 class="about-name">' + encode(this.txtProductName) + '</h2>' +
                        '<div class="about-version">' + insert(encode(this.txtVersionLine), encode(version ? version[0] : this.txtVersionNum)) + '</div>' +
                    '</div>' +
                    '<div class="about-lines">' + lines.map(function(line) { return '<p class="about-line">' + line + '</p>'; }).join('') + '</div>' +
                    '<p class="about-cc">' + insert(encode(this.txtNonCode), link(CC_URL, CC_URL)) + '</p>' +
                '</div>';
        },

        render: function() {
            if ( !this.rendered ) {
                this.rendered = true;

                this.$el.html(this.contentHtml());
                this.$el.addClass('about-dlg');

                if (_.isUndefined(this.scroller)) {
                    this.scroller = new Common.UI.Scroller({
                        el: this.$el,
                        suppressScrollX: true
                    });
                }
            }

            return this;
        },

        // the licensee block is not shown: the legal notice is the same for everyone
        setLicInfo: function() {},

        show: function () {
            if ( !this.rendered ) this.render();

            Common.UI.BaseView.prototype.show.call(this,arguments);
            this.fireEvent('show', this );
        },

        hide: function () {
            Common.UI.BaseView.prototype.hide.call(this,arguments);
            this.fireEvent('hide', this );
        },

        // the version line does not depend on the edition
        setMode: function() {},

        txtProductName: 'VibeOffice',
        txtVersionLine: 'Version %1',
        txtModified: 'VibeOffice is a modified version, changes since 27 August 2026.',
        txtCopyright: '© 2026 Bitrix LLC, with respect to modifications.',
        txtBasedOn: 'Based on ONLYOFFICE Docs software developed by Ascensio System SIA.',
        txtAscensio: '© 2009–2026 Ascensio System SIA.',
        txtTrademark: 'ONLYOFFICE is a trademark of Ascensio System SIA.',
        txtLicense: 'License: %1',
        txtLicenseLink: 'GNU Affero General Public License v3.0 (AGPLv3) + Additional Terms',
        txtSource: 'Source code: %1',
        txtNonCode: 'Certain elements of the original non-code content of ONLYOFFICE Docs retained in or distributed with the program, including but not limited to illustrations, icon sets, technical and documentation materials, are provided under the Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0): %1.'

    }, Common.Views.About || {}));
});
