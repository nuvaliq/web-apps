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

+function registerServiceWorker() {
    if ('serviceWorker' in navigator && !(window.location.origin.lastIndexOf('file://', 0) === 0)) {
        const serviceWorkerName = 'document_editor_service_worker.js';
        const sharedServiceWorkerName = 'document_editor_shared_service_worker.js';

        const registerDefault = function () {
            const serviceWorkerPath = '../../../../' + serviceWorkerName;
            let reg;
            navigator.serviceWorker.register(serviceWorkerPath)
                .then(function (registration) {
                    reg = registration;
                    return navigator.serviceWorker.getRegistrations();
                })
                .then(function (registrations) {
                    //delete stale service workers
                    // for (const registration of registrations) {
                    for (let r in registrations) {
                        const registration = registrations[r];
                        if (registration !== reg && registration.active && registration.active.scriptURL.endsWith(serviceWorkerName)) {
                            registration.unregister();
                        }
                    }
                })
                .catch(function (err) {
                    console.error('Registration failed with ' + err);
                });
        };

        // Hand over to the shared worker the static files the page requested before the worker took
        // it over: with no worker at the start they bypassed it, with a worker of another version they
        // passed through it uncached. The finished ones go at the takeover, the ones in flight at the
        // takeover go as they finish. A page under the shared worker of its own version from the
        // start has nothing to hand over.
        const precacheLoaded = function (version) {
            const isShared = function (worker) {
                return !!worker && worker.scriptURL.endsWith(sharedServiceWorkerName);
            };
            const initial = navigator.serviceWorker.controller;
            if (isShared(initial) && initial.scriptURL.indexOf('/' + version + '/') !== -1) return;
            if (!window.performance || !window.PerformanceObserver) return;
            navigator.serviceWorker.addEventListener('controllerchange', function () {
                const controller = navigator.serviceWorker.controller;
                if (!isShared(controller)) return;
                const send = function (entries) {
                    const urls = entries.map(function (entry) { return entry.name; });
                    urls.length && controller.postMessage({type: 'precache', urls: urls});
                };
                const takeover = performance.now();
                send(performance.getEntriesByType('resource'));
                new PerformanceObserver(function (list) {
                    send(list.getEntries().filter(function (entry) { return entry.startTime < takeover; }));
                }).observe({type: 'resource'});
            }, {once: true});
        };

        // Behind the document gateway every session has its own path prefix:
        // <prefix>/s/<session>/<version>/web-apps/... One worker registered for <prefix>/
        // serves the static files of all sessions of the same version from one cache.
        const sessionPath = /^(.*?)\/s\/[^\/]+\/(\d+\.\d+\.\d+[.-][^\/]+)\/web-apps\//.exec(window.location.pathname);
        if (!sessionPath) {
            registerDefault();
            return;
        }
        const scope = sessionPath[1] + '/';
        precacheLoaded(sessionPath[2]);
        navigator.serviceWorker.register('../../common/main/lib/util/' + sharedServiceWorkerName, {scope: scope, updateViaCache: 'none'})
            .then(function (registration) {
                return navigator.serviceWorker.getRegistrations()
                    .then(function (registrations) {
                        // Workers of other scopes would take the pages of their scope away from this one
                        for (let r in registrations) {
                            const other = registrations[r];
                            const scriptURL = other.active ? other.active.scriptURL : '';
                            if (other.scope !== registration.scope && (scriptURL.endsWith(serviceWorkerName) || scriptURL.endsWith(sharedServiceWorkerName))) {
                                other.unregister();
                            }
                        }
                    })
                    .catch(function (err) {
                        console.error('Service worker cleanup failed with ' + err);
                    });
            }, function (err) {
                // For example, the server does not allow this scope
                console.warn('Shared service worker registration failed with ' + err);
                registerDefault();
            });
    }
}();
