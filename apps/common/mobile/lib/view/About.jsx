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

import React, { Fragment } from 'react';
import { Page, Navbar } from "framework7-react";
import { useTranslation } from "react-i18next";

// LICENSE of the repository, copied to the common resources by the build
const LICENSE_URL = '../../common/LICENSE.txt';
const CC_URL = 'https://creativecommons.org/licenses/by-sa/4.0/legalcode';

// Legal notice of the modified version. English is the default, the "About" section of the editor locale overrides it
const EN = {
    textProductName: 'VibeOffice',
    textVersionLine: 'Version %1',
    textModified: 'VibeOffice is a modified version, changes since 27 August 2026.',
    textCopyright: '© 2026 Bitrix LLC, with respect to modifications.',
    textBasedOn: 'Based on ONLYOFFICE Docs software developed by Ascensio System SIA.',
    textAscensio: '© 2009–2026 Ascensio System SIA.',
    textTrademark: 'ONLYOFFICE is a trademark of Ascensio System SIA.',
    textLicense: 'License: %1',
    textLicenseLink: 'GNU Affero General Public License v3.0 (AGPLv3) + Additional Terms',
    textSource: 'Source code: %1',
    textNonCode: 'Certain elements of the original non-code content of ONLYOFFICE Docs retained in or distributed with the program, including but not limited to illustrations, icon sets, technical and documentation materials, are provided under the Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0): %1.'
};

// puts a link opening in a new tab in place of %1 of the text
const withLink = (text, href, label) => {
    const at = text.indexOf('%1');
    return at < 0 ? text : (
        <Fragment>
            {text.slice(0, at)}
            <a className="external" href={href} target="_blank" rel="noopener">{label}</a>
            {text.slice(at + 2)}
        </Fragment>
    );
};

// Product name, version, the lines of the legal notice and the paragraph about non-code content.
// No publisher, contacts or licensee block: the notice is the same for everyone.
const PageAbout = () => {
    const { t } = useTranslation();
    const _t = About.text(t);
    const url = About.sourceUrl();

    return (
        <Page className="about">
            <Navbar title={_t.textAbout} backLink={_t.textBack} />
            <div className="about__content">
                <div className="about__head">
                    <h2 className="about__name">{_t.textProductName}</h2>
                    <div className="about__version">{_t.textVersionLine.replace('%1', About.displayVersion())}</div>
                </div>
                <div className="about__lines">
                    <p className="about__line">{_t.textModified}</p>
                    <p className="about__line">{_t.textCopyright}</p>
                    <p className="about__line">{_t.textBasedOn}</p>
                    <p className="about__line">{_t.textAscensio}</p>
                    <p className="about__line">{_t.textTrademark}</p>
                    <p className="about__line">{withLink(_t.textLicense, LICENSE_URL, _t.textLicenseLink)}</p>
                    {url && <p className="about__line">{withLink(_t.textSource, url, url)}</p>}
                </div>
                <p className="about__cc">{withLink(_t.textNonCode, CC_URL, CC_URL)}</p>
            </div>
        </Page>
    );
};

const About = PageAbout;
About.appVersion = () => (__PRODUCT_VERSION__).match(/\d+.\d+.\d+/)[0];     // skip build number
About.compareVersions = () => /d$/.test(__PRODUCT_VERSION__);
About.developVersion = () => /(?:d|debug)$/.test(__PRODUCT_VERSION__);
// source code of the release: the build sets the address, an unset or non-https value means no source line
About.sourceUrl = () => /^https:\/\//.test(__SOURCE_URL__) ? __SOURCE_URL__ : '';
// full release number from the build, the three numbers of the product version without it
About.displayVersion = () => __RELEASE_VERSION__ || About.appVersion();
// strings of the page: the "About" section of the locale over the English defaults, once the locale is loaded
About.text = t => {
    const _t = t('About', { returnObjects: true });
    return Object.assign({}, EN, _t && typeof _t === 'object' ? _t : null);
};
// help is the product helpdesk by the interface language: Russian goes to .ru, the other languages to .com
About.helpUrl = lang => /^ru(?:[-_]|$)/i.test(lang || '') ? 'https://helpdesk.bitrix24.ru/' : 'https://helpdesk.bitrix24.com/';


export default About;
