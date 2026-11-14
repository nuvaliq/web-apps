/*
 * CompactTopScroll — when the header and the menu row of the compact shell go away on
 * document scroll and when they come back.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Here is only the rule: the scroll position on input, the answer "hide" or
 * "show" on output. No DOM, no engine api: the position on every frame is provided by
 * the shell (CompactShell.onDocScroll), which also decides what to do with the answer.
 *
 * create({threshold}) -> {feed(pos, max, blocked), skip(), state()}:
 *  - threshold — height of the rows that go away, px; a shorter path does not switch the top;
 *  - feed(pos, max, blocked) -> null | {act: 'hide'|'show', why: 'path'|'start'}:
 *    pos — current scroll position, max — its limit, blocked — the top currently
 *    must not be touched (a menu, list or window is open, focus is in the header);
 *  - skip() — the next position is only a reference point: its shift was made by the
 *    layout itself (rows going away or coming back, zoom, window size), not by the person;
 *  - state() -> {path, dir, skipping} — the accumulated path, its direction
 *    (1 down, -1 up, 0 none) and whether the rule is waiting for a reference point.
 *
 * Rules:
 *  - the path accumulates in one direction; a change of direction resets it. Down by
 *    the threshold — "hide", up by the threshold — "show" (why: 'path');
 *  - a position closer than the threshold to the start of the document — "show" (why: 'start'), and
 *    going away does not begin there;
 *  - a short document does not move the top away: if after the rows go away the scroll
 *    limit would become smaller than the threshold (max − threshold < threshold), the engine
 *    would clamp the position to the start, the start rule would bring the top back, and it would flicker;
 *  - blocked — the path is reset, there is no answer.
 */
define([], function () {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    function create(opts) {
        var threshold = Math.max(1, Number(opts && opts.threshold) || 0);
        var s = {last: null, path: 0, dir: 0, skipping: true};

        function reset() {
            s.path = 0;
            s.dir = 0;
        }

        function feed(pos, max, blocked) {
            if (typeof pos !== 'number' || !isFinite(pos)) return null;
            if (s.skipping || s.last === null) {
                s.last = pos;
                s.skipping = false;
                reset();
                return null;
            }
            var delta = pos - s.last;
            s.last = pos;
            if (blocked) {
                reset();
                return null;
            }
            if (pos < threshold) {
                reset();
                return {act: 'show', why: 'start'};
            }
            if (!delta) return null;
            var dir = delta > 0 ? 1 : -1;
            if (dir !== s.dir) {
                s.dir = dir;
                s.path = 0;
            }
            s.path += Math.abs(delta);
            if (s.path < threshold) return null;
            if (dir < 0) return {act: 'show', why: 'path'};
            if (typeof max === 'number' && max - threshold < threshold) return null;
            return {act: 'hide', why: 'path'};
        }

        return {
            feed: feed,
            skip: function () { s.skipping = true; },
            state: function () { return {path: s.path, dir: s.dir, skipping: s.skipping}; }
        };
    }

    DE.Views.CompactTopScroll = {create: create};

    return DE.Views.CompactTopScroll;
});
