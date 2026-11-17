/*
 * Icons — icon set of the "Compact" shell, shared by the editors.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Icons come from the AIR design system: files in apps/common/main/resources/img/air, one
 * per name. There are no outlines of our own in the code. AIR glyphs are 24x24, the main size is 24px.
 * The exception is the border menu items (border*): AIR has no drawings for them, the file is
 * the stock icon of the same item (20x20), in the same directory and with the same mask.
 *
 * Names are drawn with a mask plus currentColor, so coloring and hover states belong
 * to the consumer's styles. The file is stored under OUR name — there is intentionally no name map
 * at runtime: otherwise a typo in an AIR name would give an empty spot without an error, while this way
 * a missing file is visible right away when copying.
 *
 * The checkmark of a selected menu item has its own name, checkMenu (the AIR menu check-l, without
 * a circle). `accept` is taken by the checkmark in a circle: it is a status badge — "all changes
 * saved", "accept the change". And `check` is left for the checkbox tick, which is different in AIR
 * (check-m) — one cannot be substituted for the other.
 *
 * The base goes to --vo-air-src, and a relative url() inside var() is resolved against the
 * stylesheet of the variable's CONSUMER, not against the place of declaration. So the base
 * is computed as an absolute URL from the editor document (apps/<editor>/main/index.html):
 * the resolution stops depending on where the rule is located — including in dev mode,
 * where less.js puts the styles into the document. There is no <base> tag in index.html, so
 * document.baseURI is the URL of the document itself, and the DS versioned prefix
 * is taken into account automatically.
 */
define([], function () {
    'use strict';

    if (window.Common === undefined) window.Common = {};
    if (Common.UI === undefined) Common.UI = {};
    if (Common.UI.Compact === undefined) Common.UI.Compact = {};

    var AIR_BASE = '../../common/main/resources/img/air/';

    /* Computed lazily and once: svg() is called for every panel button. */
    var airBaseUrl = '';

    function airBase() {
        if (!airBaseUrl) airBaseUrl = new URL(AIR_BASE, document.baseURI).href;
        return airBaseUrl;
    }

    var AIR = {
        access:1, accept:1, alignC:1, alignJ:1, alignL:1, alignR:1, autoCorrect:1, bold:1,
        blankPage:1, contentControl:1, field:1, horizontalLine:1, hourglass:1, keyboard:1,
        sectionBreak:1, trackAll:1, unlock:1,
        bookmark:1, bullet:1, chart:1, chat:1, chevron:1, chevronL:1,
        clear:1, close:1, coauth:1, collapse:1, color:1, columns:1,
        comment:1, compare:1, crossRef:1, dark:1, download:1, focus:1,
        formula:1, h1:1, h2:1, h3:1, header:1, help:1,
        highlight:1, history:1, image:1, info:1, italic:1, language:1,
        layers:1,
        caption:1, case:1, checkMenu:1, colDel:1, colLeft:1, colRight:1,
        fitPage:1, fitWidth:1, footnote:1, hyphen:1, indentIn:1, indentOut:1,
        landscape:1, margins:1, marks:1, merge:1, multilevel:1, multipage:1,
        outline:1, pageCount:1, pageNumber:1, panel:1, pastePlain:1, portrait:1, protect:1,
        rights:1, rowAbove:1, rowBelow:1, rowDel:1, ruler:1, save:1,
        shape:1, spell:1, symbol:1, text:1, textbox:1, textToTable:1,
        toBack:1, toc:1, toFront:1, toolbar:1, wrapInline:1, wrapSquare:1,
        wrapTop:1,
        lineh:1, link:1, ltr:1, menu:1, more:1, numbered:1,
        pageBreak:1, pageSize:1, paint:1, print:1, redo:1, reject:1, rename:1,
        rtl:1, search:1, selectAll:1, settings:1, share:1, strike:1,
        sub:1, sup:1, table:1, trash:1, underline:1, undo:1, watermark:1,
        zoom:1,

        /* Table commands that documents do not have. Source — AIR ui.icon-set:
             outline — filter = filter-funnel, sort = a-letter-sort-down, sum = sigma-summ,
               validate = shield-checked, condfmt = condition, valignT = text-format-top,
               minus = minus-m, plus = plus-m, copy = copy, chevronR = chevron-right-m,
               freeze = pin;
             older sets (outline has no pair) — fill = editor/paint-bucket, paste = main/paste.
           AIR has no drawing of its own — the name is drawn by the closest file in meaning: currency =
           outline/money (AIR has no ₽), percent = outline/discount, borders = editor/table-editor
           (outline/table is taken by "Table"), rotate = outline/device-rotate, cut = main/cut
           (AIR has no scissors). The other table commands take the names above: decimal places — rtl
           and ltr, cell merging — merge, middle and bottom alignment — alignC and caption,
           text wrapping — hyphen. */
        borders:1, chevronR:1, condfmt:1, copy:1, currency:1, cut:1, fill:1, filter:1, freeze:1,
        minus:1, paste:1, percent:1, plus:1, rotate:1, sort:1, sum:1, validate:1, valignT:1,

        /* Border menu items: sides, sets and line style. AIR has no such drawings, nor a closest
           one in meaning. The file is the stock ONLYOFFICE icon of the same item, an unmodified copy
           (img/toolbar/2.5x/btn-border-*.svg): the build does not put those files into img, they go into
           the ribbon sprite. Drawn with the same mask: a black line is the solid color of the line, the dotted grid
           with opacity 0.4 is semi-transparent. Where the name differs from the stock one: borderNone —
           btn-border-no, borderOuter — btn-border-out, borderInner — btn-border-inside, borderInnerH —
           btn-border-insidehor, borderInnerV — btn-border-insidevert. */
        borderBottom:1, borderTop:1, borderLeft:1, borderRight:1, borderNone:1, borderAll:1,
        borderOuter:1, borderInner:1, borderInnerH:1, borderInnerV:1, borderStyle:1,

        /* Presentation commands that documents and tables do not have. Source — AIR ui.icon-set:
             outline — borderDash = dots, dateTime = calendar, duplicate = duplicate,
               eyeOff = crossed-eye, filmstrip = columns-sidebar-pending-left, newSlide = plus-l,
               notes = note, pause = pause-l, play = play-l, replaceImg = image-plus,
               smartart = three-squares, theme = palette;
             actions — borderWeight = lines, pencil = pencil-draw, resetImg = collapse-diagonal,
               rotateCcw = image-rotate-left, rotateCw = image-rotate-right, transition = swap;
             older sets — group = main/group, textart = editor/text-color.
           AIR has no drawing of its own — the name is drawn by the closest file in meaning: background =
           outline/image-small, layout = outline/crm-form, flipV = outline/top-bottom-expand-l,
           ungroup = actions/4-cubes-2. textAdd ("Text box") is assembled from AIR glyphs: the letter "T" from
           outline/text without the lines on the right and a plus the thickness of the letter stroke in place of the lines. The other
           presentation commands take the names above: "Crop" — cut, "Flip horizontal" —
           compare, aligning objects and to the middle — alignC, to the bottom — caption, "Animation" —
           autoCorrect, "Order" — toFront, slide number — pageNumber, symbol — symbol, slide
           size — pageSize, "Fit to slide" — fitPage, line and border color — pencil,
           slideshow full screen — focus. */
        background:1, borderDash:1, borderWeight:1, dateTime:1, duplicate:1, eyeOff:1, filmstrip:1,
        flipV:1, group:1, layout:1, newSlide:1, notes:1, pause:1, pencil:1, play:1, replaceImg:1,
        resetImg:1, rotateCcw:1, rotateCw:1, smartart:1, textAdd:1, textart:1, theme:1, transition:1,
        ungroup:1,

        /* PDF viewer commands that the other editors do not have. Source — AIR ui.icon-set:
             outline — demonstration = demonstration-on (the viewer "Full screen" button),
               moreV = more-vertical-m (the "⋮" menu);
             fitLandscape ("Fit to width") — the landscape drawing above with a ↔ arrow inside, from edge to edge.
               AIR has no such drawing.
           The other viewer commands take the names above: navigation — outline and chevronL, pages —
           chevronL and chevronR, fit to page — fitPage. */
        demonstration:1, fitLandscape:1, moreV:1
    };

    Common.UI.Compact.Icons = {

        has: function (name) {
            return AIR[name] === 1;
        },

        /* An empty string, not a placeholder: a missing icon should not show up
           — better the item stays without it. */
        svg: function (name, size) {
            /* The main size is 24px. Arrows and checkmarks pass their size
               explicitly, it does not affect them. */
            if (AIR[name] !== 1) return '';
            return '<span class="vo-air" aria-hidden="true" style="' +
                   '--vo-air-size:' + (size || 24) + 'px;' +
                   '--vo-air-src:url(' + airBase() + name + '.svg)"></span>';
        }
    };

    return Common.UI.Compact.Icons;
});
