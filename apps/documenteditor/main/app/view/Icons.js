/*
 * Icons — icon set of the compact document shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The AIR set is shared across editors: the list of names, the files and the icon
 * markup are in common/main/lib/view/compact/Icons.js, the files are in apps/common/main/resources/img/air.
 * Here is only the former module name that the shell views request it by.
 */
define([
    'common/main/lib/view/compact/Icons'
], function (Icons) {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    DE.Views.Icons = Icons || Common.UI.Compact.Icons;

    return DE.Views.Icons;
});
