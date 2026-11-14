/*
 * CompactWatermark — the "Watermark settings" window in the compact shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Its own window on the Air template: a subclass of the stock WatermarkSettingsDialog.
 * The watermark properties, image loading and getSettings are stock, so
 * "Apply" passes to asc_SetWatermarkProps exactly what the stock "OK" does;
 * only one thing is its own — an empty view goes out as the type "None".
 * The markup and rendering are its own: parameters on the left, a page preview on the right.
 * The look is drawn by the template (compact-windows.less, the vo-win mark) and
 * compact-watermark.less under the vo-win--watermark mark.
 *
 * Window design: the view is chosen by buttons "Image watermark · Text
 * watermark", there is no separate "None" view. "No watermark" is an empty
 * open view: the image is removed by the X button at the zone, the text is erased in the field, and
 * "Apply" then removes the watermark. A document without a watermark opens
 * in the image view with an empty zone and a disabled "Apply"; the loader is only
 * a click, there is no drag-and-drop or hint about it; "From URL" is a field in the
 * window itself instead of a separate window; "Scale" and "Layout" are small
 * text with an arrow; the page preview is our layer, the watermark gets into the
 * document only through "Apply".
 *
 * The stock _setDefaults, getSettings, disableControls, loadLanguages,
 * onSelectLang, loadWMText, _handleInput and onPrimary work as is: the
 * window has members with the interface of the stock controls. radioImage and radioText are
 * the view buttons, radioNone is a radio without a button, radioDiag and radioHor are
 * "Layout", cmbScale is "Scale", btnOk is "Apply"; the rest are the same
 * stock components with the same names. On top of the stock code disableControls
 * hides the section of the other view, _setDefaults gives the engine its own preview node and
 * replaces "None" with the image view, getSettings gives an empty view as the type
 * "None".
 *
 * The window is opened by DocumentActions.watermark() — only in compact. In Advanced
 * the ribbon opens the untouched stock class.
 *
 * The class is built lazily: the stock WatermarkSettingsDialog arrives through
 * postLaunchScripts (app_dev.js:260), later than this module. The module does not import
 * the shell and DocumentActions — it is their dependency, that would make a
 * loop; CompactWindows and Icons are already loaded by the shell's define
 * by the first call.
 */
define([], function () {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    var LABEL = 'vo-win vo-win--watermark';

    /* The engine texture nodes: drawTexture finds a node by id and draws the watermark
       image in it (sdkjs/word/apiCommon.js:2256). */
    var ZONE_ID = 'vo-wm-thumb',
        PAGE_IMG_ID = 'vo-wm-page-img';

    /* An A4 sheet in pixels at 96 dpi and the text field with the editor's default
       margins: 3 and 1.5 cm at the sides, 2 cm at the top and bottom. By the text
       field the engine computes the picture's "Auto" (GraphicObjects.js:527–562), by the sheet
       the window computes the preview font size (paintText). */
    var PAGE_W = 794, PAGE_H = 1123,
        TEXT_W = 624, TEXT_H = 971,
        PAGE_MM_W = 210, PAGE_MM_H = 297;

    /* The side of the preview canvas is no more than this: at 500 % of a large picture
       the engine would create a canvas of tens of megapixels. */
    var MAX_SIDE = 4096;

    var Dialog = null;      // the built class, one per session
    var opening = null;     // the window whose rendering has not finished yet (abort)

    function enc(s) {
        return Common.Utils.String.htmlEncode(s == null ? '' : String(s));
    }

    function icon(name, size) {
        return (DE.Views.Icons && DE.Views.Icons.svg(name, size)) || '';
    }

    /* A failure in code that is called from outside (the engine, component events) must not
       bring down the window: it will keep working without the preview. */
    function guarded(label, fn) {
        var M = DE.Views.CompactWindows, shell = M && M.shell;
        return shell && shell.guarded ? shell.guarded(label, fn) : fn;
    }

    /* A button with a menu (choice by text, color): Enter, Space and ↓ open
       the list. The handler is on the button itself, earlier than bootstrap and the window on
       document: bootstrap closes all menus on Enter (Menu.js:470), and the window
       would press "Apply". Space is suppressed here too, otherwise releasing
       the key would click the button once more and close the open list. ↓ with
       an open list is not ours — bootstrap moves through the items with it. */
    function bindMenuKeys(btn) {
        var K = Common.UI.Keys;
        btn.cmpEl.find('button').first().on('keydown', function (e) {
            var key = e.keyCode, open = btn.isMenuOpen();
            if (key !== K.RETURN && key !== K.SPACE && !(key === K.DOWN && !open)) return;
            e.preventDefault();
            e.stopPropagation();
            if (btn.isDisabled() || !btn.menu) return;
            if (open)
                btn.menu.hide();
            else
                this.click();
        });
    }

    /* A choice by small text with an arrow — "Scale" and "Layout":
       a plain sm button — a gray caption, the value, a chevron; the list is
       an Air menu from the right edge of the button, the selected one with a checkmark. Where the stock code
       calls it, the interface is like ComboBox: setValue(value, display),
       getValue(), setDisabled, isDisabled.
       o: {label, items: [{value, caption}], onPick, extra(value) → caption} —
       extra gives a caption to a foreign value from the document; without it a foreign
       value is not set. */
    function Pick(win, el, o) {
        var me = this;
        this.label = o.label;
        this.extraCaption = o.extra || null;
        this.value = null;

        this.menu = new Common.UI.Menu({
            cls: 'vo-wm-pick-menu',
            menuAlign: 'tr-br',
            additionalAlign: win.menuAddAlign,
            items: _.map(o.items, function (it) {
                return {caption: it.caption, value: it.value, checkable: true, checkmark: false};
            })
        });
        this.btn = new Common.UI.Button({
            parentEl: el,
            cls: 'vo-wm-pick',
            caption: this.caption(''),
            menu: this.menu,
            takeFocusOnClose: true
        });
        /* The item toggles its own checkmark itself before the event (MenuItem.js:359),
           setValue arranges them anew. */
        this.menu.on('item:click', function (menu, item) {
            me.setValue(item.value);
            o.onPick && o.onPick(item.value);
        });
        bindMenuKeys(this.btn);
    }

    Pick.prototype = {
        caption: function (text) {
            return '<span class="vo-wm-pick-lbl">' + enc(this.label) + '</span>' +
                   '<span class="vo-wm-pick-val">' + enc(text) + '</span>';
        },

        find: function (value) {
            return _.find(this.menu.items, function (it) { return it.value === value; });
        },

        /* A foreign value from the document (in the stock code — the text in the ComboBox field,
           _setDefaults :528) — as a list item, in descending order, like the stock
           percentages, and with a caption in the same format. The previous foreign item leaves. */
        addExtra: function (value) {
            var caption = this.extraCaption && this.extraCaption(value);
            if (!caption) return null;
            if (this.extra) {
                this.menu.removeItem(this.extra);
                this.extra = null;
            }
            var items = this.menu.items, at = -1;
            for (var i = 0; i < items.length; i++) {
                if (items[i].value > 0 && items[i].value < value) {
                    at = i;
                    break;
                }
            }
            this.menu.insertItem(at, {caption: caption, value: value, checkable: true, checkmark: false});
            this.extra = this.find(value) || null;
            return this.extra;
        },

        setValue: function (value, display) {
            var item = this.find(value) || (display !== undefined ? this.addExtra(value) : null);
            if (!item) return;
            this.value = value;
            _.each(this.menu.items, function (it) {
                var on = it === item;
                it.setChecked(on, true);
                it.cmpEl && it.cmpEl.find('> a').attr({role: 'menuitemradio', 'aria-checked': on ? 'true' : 'false'});
            });
            this.btn.setCaption(this.caption(item.caption));
        },

        getValue: function () { return this.value; },
        setDisabled: function (off) { this.btn.setDisabled(off); },
        isDisabled: function () { return this.btn.isDisabled(); },
        isMenuOpen: function () { return this.btn.isMenuOpen(); },
        focus: function () { this.btn.focus(); }
    };

    function build(Base) {
        var T = Asc.c_oAscWatermarkType;

        var paint = guarded('подложка компакта: образец страницы', function () { this.paint(); });

        return Base.extend({

            /* Our own options object, not the stock one from the prototype: the stock
               initialize appends to this.options (WatermarkSettingsDialog.js:86),
               and without our own object the write would go into the stock Advanced window.
               The instance also gets a copy (initialize), so nothing is carried over
               between openings of compact either. */
            options: {
                width: 720,             // a window with a page preview, per the template; centering takes it too (Window.js:274)
                contentWidth: 672,      // 720 − body margins 2 × 24
                id: 'vo-window-watermark',
                cls: LABEL,
                separator: false
            },

            initialize: function (options) {
                var me = this;
                options = options || {};

                this.options = _.extend({}, this.options);

                /* The window is dressed by itself: the CompactWindows recipes (modal:show) skip it,
                   even if a recipe for the stock class ever appears —
                   this one inherits from it. */
                this._voWin = 'watermark';

                /* The view before _setDefaults — "Text", like the stock radio (:147). */
                this.wmType = T.Text;

                /* "Apply" instead of "OK" — by the caption of its own button: the shared text
                   "OK" is not touched, it is also used outside compact. What is passed last
                   wins over the stock values (:86–90):
                   our own markup without the padding of the stock panel and our own key
                   handling. */
                Base.prototype.initialize.call(this, _.extend({}, options, {
                    buttons: [{value: 'ok', caption: DE.Views.CompactWindows.textApply, primary: true}, 'cancel'],
                    contentStyle: '',
                    contentTemplate: this.markup(),
                    keydowncallback: function (e) { return me.onKeys(e); }
                }));

                /* The stock code calls onPrimary on Enter, regardless of whether "Apply"
                   is disabled. guardEnter wraps keydowncallback, which
                   Window reads at the moment of the press (Window.js:209). */
                DE.Views.CompactWindows.guardEnter(this);
            },

            /* Markup: the view, the sections of the two views in one cell, on the right
               the page preview. */
            markup: function () {
                var M = DE.Views.CompactWatermark;
                return '<div class="vo-wm">' +
                        '<div class="vo-wm-set">' +
                            '<div class="vo-wm-seg" role="radiogroup">' +
                                            '<div id="vo-wm-type-image"></div>' +
                                '<div id="vo-wm-type-text"></div>' +
                            '</div>' +
                            '<div class="vo-wm-subs">' +
                                '<div class="vo-wm-sub vo-wm-sub--text">' +
                                    '<div class="vo-wm-langrow">' +
                                        '<div class="vo-wm-field">' +
                                            '<label class="input-label">' + enc(this.textLanguage) + '</label>' +
                                            '<div id="vo-wm-lang"></div>' +
                                        '</div>' +
                                        '<div class="vo-wm-field">' +
                                            '<label class="input-label">' + enc(this.textText) + '</label>' +
                                            '<div id="vo-wm-text"></div>' +
                                        '</div>' +
                                    '</div>' +
                                    '<div class="vo-wm-field">' +
                                        '<div class="input-label">' + enc(this.textFont) + '</div>' +
                                        '<div class="vo-wm-fontrow">' +
                                            '<div id="vo-wm-fonts" class="vo-wm-fonts"></div>' +
                                            '<div id="vo-wm-size" class="vo-wm-size"></div>' +
                                            '<div id="vo-wm-color" class="vo-wm-color"></div>' +
                                            '<div class="vo-wm-tgl">' +
                                                '<div id="vo-wm-bold"></div>' +
                                                '<div id="vo-wm-italic"></div>' +
                                                '<div id="vo-wm-underline"></div>' +
                                                '<div id="vo-wm-strike"></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                    '<div class="vo-wm-semirow">' +
                                        '<div id="vo-wm-semi"></div>' +
                                        '<div id="vo-wm-layout" class="vo-wm-pick-slot"></div>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="vo-wm-sub vo-wm-sub--image vo-wm-sub--hid">' +
                                    '<div class="vo-wm-dropbox">' +
                                        '<div id="vo-wm-drop" class="vo-wm-drop" role="button" tabindex="0" aria-label="' + enc(M.textUpload) + '">' +
                                            '<span class="vo-wm-drop-empty">' +
                                                icon('image', 32) +
                                                '<span class="vo-wm-drop-title">' + enc(M.textUpload) + '</span>' +
                                            '</span>' +
                                            '<div id="' + ZONE_ID + '" class="vo-wm-thumb"></div>' +
                                        '</div>' +
                                        '<div id="vo-wm-clear" class="vo-wm-clear"></div>' +
                                    '</div>' +
                                    '<div class="vo-wm-srcrow">' +
                                        '<div id="vo-wm-from-url"></div>' +
                                        '<div id="vo-wm-scale" class="vo-wm-pick-slot"></div>' +
                                    '</div>' +
                                    '<div id="vo-wm-urlrow" class="vo-wm-urlrow vo-wm-off">' +
                                        '<div class="vo-wm-field">' +
                                            '<label class="input-label">' + enc(M.textImageUrl) + '</label>' +
                                            '<div id="vo-wm-url"></div>' +
                                        '</div>' +
                                        '<div id="vo-wm-load" class="vo-wm-load"></div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="vo-wm-prev">' +
                            '<div class="input-label">' + enc(M.textPreview) + '</div>' +
                            '<div class="vo-wm-page" aria-hidden="true">' +
                                '<div class="vo-wm-lines"></div>' +
                                '<div class="vo-wm-mark">' +
                                    '<span class="vo-wm-mark-text"></span>' +
                                    '<div id="' + PAGE_IMG_ID + '" class="vo-wm-mark-img"></div>' +
                                    '<span class="vo-wm-none">' + enc(M.textNoImage) + '</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
            },

            /* We do not call the stock render: it builds the controls of the stock window by
               global ids (radio, the "Select image" menu, the scale field).
               The box, header and footer are rendered by the base. The composition and settings
               of the stock components are as in the stock code (:204–336), only the nodes
               and widths change: the width is set by the template layout. */
            render: function () {
                Common.Views.AdvancedSettingsWindow.prototype.render.call(this);

                var me = this, $w = this.$window, M = DE.Views.CompactWatermark,
                    U = (Common.Views.ImageFromUrlDialog && Common.Views.ImageFromUrlDialog.prototype) || {};
                var refresh = function () { me.refresh(); };
                opening = this;

                /* --- View: buttons with an outline instead of radio ------------------- */
                this.segs = [];
                var seg = function (id, type, text) {
                    var btn = new Common.UI.Button({
                        parentEl: $w.find(id),
                        cls: 'vo-wm-seg-btn',
                        caption: enc(text)
                    });
                    btn.cmpEl.attr({role: 'radio', 'aria-checked': 'false'});
                    btn.on('click', function () { me.chooseType(type); });
                    me.segs.push({type: type, btn: btn});
                    return btn;
                };
                this.btnTypeImage = seg('#vo-wm-type-image', T.Image, this.textImageW);
                this.btnTypeText = seg('#vo-wm-type-text', T.Text, this.textTextW);

                /* The stock radio for its own _setDefaults and loadLanguages.
                   There is no "None" button: the type "None" comes only from a document
                   without a watermark, and _setDefaults immediately changes it to
                   the image one. */
                var choice = function (type) {
                    return {
                        getValue: function () { return me.wmType === type; },
                        setValue: function (on, silent) { on && me.setType(type, silent); }
                    };
                };
                this.radioNone = choice(T.None);
                this.radioImage = choice(T.Image);
                this.radioText = choice(T.Text);

                /* --- Text watermark ------------------------------------ */
                this.cmbLang = new Common.UI.ComboBox({
                    el: $w.find('#vo-wm-lang'),
                    cls: 'input-group-nr',
                    editable: false,
                    menuStyle: 'min-width: 100%; max-height: 288px;',
                    scrollAlwaysVisible: true,
                    data: [],
                    ariaLabel: this.textLanguage,
                    takeFocusOnClose: true
                }).on('selected', _.bind(this.onSelectLang, this));
                this.cmbLang.setValue(Common.util.LanguageInfo.getLocalLanguageName(9)[1]);//en
                this.cmbLang.on('selected', refresh);
                /* Languages load asynchronously (loadLanguages :445–450): the list and
                   the text arrive without events to the window. The redraw is after the entire
                   load handler. */
                this.cmbLang.store.on('reset', function () { _.defer(refresh); });
                this.textControls.push(this.cmbLang);

                this.cmbText = new Common.UI.ComboBox({
                    el: $w.find('#vo-wm-text'),
                    cls: 'input-group-nr',
                    menuStyle: 'min-width: 100%; max-height: 288px;',
                    scrollAlwaysVisible: true,
                    displayField: 'value',
                    focusWhenNoSelection: false,
                    data: [{value: "ASAP"}, {value: "CONFIDENTIAL"}, {value: "COPY"}, {value: "DO NOT COPY"}, {value: "DRAFT"}, {value: "ORIGINAL"}, {value: "PERSONAL"}, {value: "SAMPLE"}, {value: "TOP SECRET"}, {value: "URGENT"} ],
                    ariaLabel: this.textText,
                    takeFocusOnClose: true
                });
                this.cmbText.setValue(this.cmbText.options.data[0].value);
                this.cmbText.on('selected', refresh).on('changing', refresh).on('changed:after', refresh);
                this.textControls.push(this.cmbText);

                this.cmbFonts = new Common.UI.ComboBoxFonts({
                    el: $w.find('#vo-wm-fonts'),
                    cls: 'input-group-nr',
                    menuCls: 'scrollable-menu',
                    menuStyle: 'min-width: 100%; max-height: 270px;',
                    store: new Common.Collections.Fonts(),
                    recent: 0,
                    hint: this.tipFontName,
                    takeFocusOnClose: true
                }).on('selected', function (combo, record) {
                    me.fontName = record.name;
                    me.refresh();
                });
                this.textControls.push(this.cmbFonts);

                /* The font size list is the stock "Auto, 36…144": the engine reads a watermark
                   smaller than 36 as "Auto" (Shape.js:6721, getWatermarkProps). */
                this.cmbFontSize = new Common.UI.ComboBox({
                    el: $w.find('#vo-wm-size'),
                    cls: 'input-group-nr',
                    menuCls: 'scrollable-menu',
                    menuStyle: 'min-width: 100%; max-height: 288px;',
                    hint: this.tipFontSize,
                    data: [
                        { value: -1, displayValue: this.textAuto },
                        { value: 36, displayValue: "36" },
                        { value: 40, displayValue: "40" },
                        { value: 44, displayValue: "44" },
                        { value: 48, displayValue: "48" },
                        { value: 54, displayValue: "54" },
                        { value: 60, displayValue: "60" },
                        { value: 66, displayValue: "66" },
                        { value: 72, displayValue: "72" },
                        { value: 80, displayValue: "80" },
                        { value: 90, displayValue: "90" },
                        { value: 96, displayValue: "96" },
                        { value: 105, displayValue: "105" },
                        { value: 120, displayValue: "120" },
                        { value: 144, displayValue: "144" }
                    ],
                    takeFocusOnClose: true
                });
                this.cmbFontSize.setValue(-1);
                this.cmbFontSize.on('selected', refresh).on('changing', refresh).on('changed:after', refresh);
                this.textControls.push(this.cmbFontSize);

                /* The color is a field button with a color sample, the palette
                   and "Auto" are stock. */
                this.btnTextColor = new Common.UI.ButtonColored({
                    parentEl: $w.find('#vo-wm-color'),
                    cls: 'vo-wm-color-btn',
                    iconCls: '',
                    hint: this.textColor,
                    additionalAlign: this.menuAddAlign,
                    auto: true,
                    color: 'c0c0c0',
                    colorLine: 'box',
                    menu: true,
                    takeFocusOnClose: true
                });
                this.btnTextColor.setMenu();
                this.mnuTextColorPicker = this.btnTextColor.getPicker();
                this.btnTextColor.currentColor = 'c0c0c0';
                this.textControls.push(this.btnTextColor);

                this.btnTextColor.on('color:select', _.bind(this.onColorSelect, this));
                this.btnTextColor.on('auto:select',  _.bind(this.onAutoColor, this));
                this.btnTextColor.on('color:select', refresh).on('auto:select', refresh);
                bindMenuKeys(this.btnTextColor);

                /* The style — AIR icons as one group, the pressed one is tinted. */
                var style = function (id, name, hint) {
                    var btn = new Common.UI.Button({
                        parentEl: $w.find(id),
                        cls: 'vo-wm-tgl-btn',
                        caption: icon(name, 24),
                        enableToggle: true,
                        hint: hint,
                        ariaLabel: hint
                    });
                    btn.on('toggle', refresh);
                    me.textControls.push(btn);
                    return btn;
                };
                this.btnBold = style('#vo-wm-bold', 'bold', this.textBold);
                this.btnItalic = style('#vo-wm-italic', 'italic', this.textItalic);
                this.btnUnderline = style('#vo-wm-underline', 'underline', this.textUnderline);
                this.btnStrikeout = style('#vo-wm-strike', 'strike', this.textStrikeout);

                this.chTransparency = new Common.UI.CheckBox({
                    el: $w.find('#vo-wm-semi'),
                    labelText: this.textTransparency,
                    value: true
                });
                this.chTransparency.on('change', refresh);
                this.textControls.push(this.chTransparency);

                /* "Layout" — a choice by text opposite "Semitransparent".
                   radioDiag and radioHor are for the stock
                   _setDefaults (:531) and getSettings (:594). */
                var layout = this.pickLayout = new Pick(this, $w.find('#vo-wm-layout'), {
                    label: this.textLayout,
                    items: [{value: 'diag', caption: this.textDiagonal}, {value: 'hor', caption: this.textHor}],
                    onPick: refresh
                });
                layout.setValue('diag');
                this.radioDiag = {
                    getValue: function () { return layout.getValue() !== 'hor'; },
                    setValue: function (on) { on && layout.setValue('diag'); }
                };
                this.radioHor = {
                    getValue: function () { return layout.getValue() === 'hor'; },
                    setValue: function (on) { on && layout.setValue('hor'); }
                };
                this.textControls.push(layout);

                /* --- Image watermark ---------------------------------- */
                /* The upload zone is only a click: the engine's file choice,
                   showFileDialog. With a picture in the zone — the engine's preview texture in
                   its own node (put_DivId in _setDefaults), a click replaces it with the same
                   choice. The zone is a node, not a component: for FocusManager and
                   the stock disableControls it has a component interface. */
                var $zone = this.$zone = $w.find('#vo-wm-drop');
                this.zone = {
                    $el: $zone,
                    disabled: false,
                    tabindex: '0',
                    setDisabled: function (off) {
                        off = !!off;
                        this.disabled = off;
                        $zone.toggleClass('disabled', off);
                        off ? $zone.attr('aria-disabled', 'true') : $zone.removeAttr('aria-disabled');
                        $zone.attr('tabindex', off ? '-1' : this.tabindex);
                    },
                    isDisabled: function () { return this.disabled; },
                    setTabIndex: function (index) {
                        this.tabindex = String(index);
                        if (!this.disabled) $zone.attr('tabindex', this.tabindex);
                    },
                    isVisible: function () { return $zone.is(':visible') && $zone.css('visibility') !== 'hidden'; },
                    focus: function () { $zone.focus(); }
                };
                $zone.on('click', function () { me.pickFile(); });
                this.imageControls.push(this.zone);

                /* "Remove image" — next to the zone, not in it: the zone is itself
                   a button (role=button), a nested button would not be read
                   separately. Visible while there is a picture in the zone; after it the view is empty,
                   and "Apply" removes the watermark. */
                this.btnClear = new Common.UI.Button({
                    parentEl: $w.find('#vo-wm-clear'),
                    cls: 'vo-wm-clear-btn',
                    caption: icon('close', 20),
                    hint: M.textRemoveImage
                });
                this.btnClear.cmpEl.attr('aria-label', M.textRemoveImage);
                this.btnClear.on('click', function () { me.clearImage(); });
                this.imageControls.push(this.btnClear);

                this.btnFromUrl = new Common.UI.Button({
                    parentEl: $w.find('#vo-wm-from-url'),
                    cls: 'vo-wm-src',
                    caption: icon('link', 20) + '<span>' + enc(this.textFromUrl) + '</span>'
                });
                this.btnFromUrl.cmpEl.attr({'aria-expanded': 'false', 'aria-controls': 'vo-wm-urlrow'});
                this.btnFromUrl.on('click', function () {
                    if (me.showUrlRow()) me.txtUrl.focus();
                });
                this.imageControls.push(this.btnFromUrl);

                /* "Scale" — a choice by text on the right in the row.
                   The values are stock (:183–190), a foreign one from the document
                   is added as an item. */
                this._arrScale = [
                    {displayValue: this.textAuto,   value: -1},
                    {displayValue: '500%', value: 500},
                    {displayValue: '200%', value: 200},
                    {displayValue: '150%', value: 150},
                    {displayValue: '100%', value: 100},
                    {displayValue: '50%', value: 50}
                ];
                this.cmbScale = new Pick(this, $w.find('#vo-wm-scale'), {
                    label: this.textScale,
                    items: _.map(this._arrScale, function (it) { return {value: it.value, caption: it.displayValue}; }),
                    onPick: refresh,
                    extra: function (value) { return value > 0 ? value + '%' : null; }
                });
                this.cmbScale.setValue(this._arrScale[0].value);
                this.imageControls.push(this.cmbScale);

                /* "From URL" — a field in the window instead of ImageFromUrlDialog, the check is
                   its own (TextInputDialog.js:164–170): empty — txtEmpty, not
                   a link — txtNotUrl. The error is text on the edge. */
                this.txtUrl = new Common.UI.InputField({
                    el: $w.find('#vo-wm-url'),
                    allowBlank: false,
                    blankError: U.txtEmpty,
                    validateOnBlur: false,
                    hideErrorOnInput: true,
                    placeHolder: 'https://',
                    ariaLabel: M.textImageUrl,
                    /* Empty — only txtEmpty (allowBlank): a link check
                       on an empty value would add a second error, and InputField
                       joins all of them (InputField.js:332–341). */
                    validation: function (value) {
                        if (_.isEmpty(value)) return true;
                        return (/((^https?)|(^ftp)):\/\/.+/i.test(value)) ? true : U.txtNotUrl;
                    }
                });
                DE.Views.CompactWindows.edgeError(this.txtUrl);
                this.imageControls.push(this.txtUrl);

                /* Buttons inside the window — without the dlg-btn class: getFooterButtons and
                   the footer handler take all .dlg-btn of the window. */
                this.btnLoad = new Common.UI.Button({
                    parentEl: $w.find('#vo-wm-load'),
                    cls: 'vo-wm-load-btn',
                    caption: enc(M.textLoad)
                });
                this.btnLoad.on('click', function () { me.loadUrl(); });
                this.imageControls.push(this.btnLoad);

                /* --- Page preview and layout nodes --------------------- */
                this.$page = $w.find('.vo-wm-page');
                this.$markText = $w.find('.vo-wm-mark-text');
                this.$markImg = $w.find('#' + PAGE_IMG_ID);
                this.$markNone = $w.find('.vo-wm-none');
                this.$thumb = $w.find('#' + ZONE_ID);
                this.$urlRow = $w.find('#vo-wm-urlrow');
                this.$subText = $w.find('.vo-wm-sub--text');
                this.$subImage = $w.find('.vo-wm-sub--image');

                this.btnOk = _.find(this.getFooterButtons(), function (item) {
                    return (item.$el && item.$el.find('.primary').addBack().filter('.primary').length>0);
                }) || new Common.UI.Button({ el: this.$window.find('.primary') });
                this.btnOk.setDisabled(true);

                this.setType(this.wmType, true);

                /* The sheet — by the column height, while the window is rendered (it is rendered
                   visible): the column and zone widths depend on its width, and
                   the engine creates the preview canvas once by the node size
                   (drawTexture, apiCommon.js:2273–2279). Hence — before
                   _setDefaults, which gives the engine the preview node. */
                this._built = true;
                this.sizePage();

                this.afterRender();
                opening = null;
            },

            /* The stock code after rendering (:396–421): fonts, theme colors,
               _setDefaults, subscriptions to the image load and the storage and their
               removal. On top — its own subscription to the load: after it the preview in the
               zone and the page preview. */
            afterRender: function () {
                var me = this;
                Base.prototype.afterRender.call(this);

                var onLoaded = guarded('подложка компакта: картинка загружена', function () { me.onImageLoaded(); });
                this.api.asc_registerCallback('asc_onWatermarkImageLoaded', onLoaded);
                this.on('close', function () {
                    me._closed = true;
                    me.api.asc_unregisterCallback('asc_onWatermarkImageLoaded', onLoaded);
                });
                this.refresh();
            },

            /* The stock code gives the engine the node of its own markup (:517) — it is absent here,
               drawTexture without a node silently returns. The preview node is our own, in the zone;
               without DivId showFileDialog is also silent (apiCommon.js:2190). */
            _setDefaults: function (props) {
                /* A watermark is already in the document — an empty view removes it, and
                   "Apply" is lit; no — an empty view changes nothing. */
                this.hadWm = !!props && props.get_Type() !== T.None;
                Base.prototype._setDefaults.call(this, props);
                props && props.put_DivId(ZONE_ID);
                if (props && !this.hadWm) this.setType(T.Image);
            },

            /* An empty view is the type "None": that is how the stock "OK" removed the watermark with the
               radio "None". The rest is the stock getSettings. */
            getSettings: function () {
                if (this.isEmpty()) {
                    this.props.put_Type(T.None);
                    return this.props;
                }
                return Base.prototype.getSettings.call(this);
            },

            /* The picture in the zone is the picture in the window properties: the X button removes
               it from there, loading puts it there. */
            hasImage: function () {
                return !!this.props && !!this.props.get_ImageUrl();
            },

            /* The text is what is typed in the field, without spaces at the edges. */
            hasText: function () {
                return !!String(this.cmbText.getRawValue() || '').trim();
            },

            isEmpty: function () {
                return this.wmType === T.Text ? !this.hasText() : !this.hasImage();
            },

            /* The X button: the zone empties, focus goes to it, to choose another. */
            clearImage: function () {
                if (this.btnClear.isDisabled()) return;
                this.props.put_ImageUrl2(null);
                this.isImageLoaded = false;
                this.refresh();
                this.zone.focus();
            },

            /* The stock disabling (:625–637) and on top the compact layout: the section of
               the selected view is visible; with the type "None" (a moment before _setDefaults) —
               the image section, entirely disabled by the stock code. A hidden section is
               visibility hidden, and its controls are disabled by the stock code: FocusManager
               skips them. Without a network "From URL" is always disabled, like the stock menu
               item (:180). */
            disableControls: function (type) {
                Base.prototype.disableControls.call(this, type);
                if (this.options.disableNetworkFunctionality) {
                    this.btnFromUrl.setDisabled(true);
                }
                var text = type === T.Text;
                this.$subText.toggleClass('vo-wm-sub--hid', !text);
                this.$subImage.toggleClass('vo-wm-sub--hid', text);
                if (type === T.None) this.showUrlRow(false);
                this.refresh();
            },

            /* The view buttons. silent — only the look of the buttons: that is how the stock
               _setDefaults sets the document type (setValue(true, true)), and
               it calls the disabling itself at the end. */
            setType: function (type, silent) {
                this.wmType = type;
                _.each(this.segs, function (s) {
                    var on = s.type === type;
                    s.btn.cmpEl.toggleClass('on', on).attr('aria-checked', on ? 'true' : 'false');
                });
                if (silent) return;
                this.props.put_Type(type);
                this.disableControls(type);
            },

            chooseType: function (type) {
                if (type !== this.wmType) this.setType(type);
            },

            /* The engine's file choice. Focus stays on the zone: the file loads
               asynchronously, the result is asc_onWatermarkImageLoaded. */
            pickFile: function () {
                if (this.zone.isDisabled() || !this.props) return;
                this.props.showFileDialog();
            },

            /* The "Image link" row — opens and closes "From URL".
               Only the window grows downward, the zone shrinks to its minimum;
               the sheet and the column widths stay as before (sizePage). */
            showUrlRow: function (open) {
                var was = !this.$urlRow.hasClass('vo-wm-off');
                if (open === undefined) open = !was;
                this.$urlRow.toggleClass('vo-wm-off', !open);
                this.btnFromUrl.cmpEl.attr('aria-expanded', open ? 'true' : 'false');
                if (!open && was) this.txtUrl.showError();
                if (open !== was) this.refresh();
                return open;
            },

            /* "Load": the ImageFromUrlDialog check and the same call as the stock code
               makes after it (:498–500). The value is taken from the field as is:
               InputField updates its own on blur, and Enter arrives earlier. */
            loadUrl: function () {
                var field = this.txtUrl;
                if (!field || field.isDisabled() || this.btnLoad.isDisabled()) return;
                field.setValue(field._input.val());
                if (field.checkValidate() !== true) {
                    field.focus();
                    return;
                }
                var url = (field.getValue() || '').replace(/ /g, '');
                if (!_.isEmpty(url)) this.props.put_ImageUrl(url);
            },

            /* The picture is loaded (a file, a link, the storage). The engine then
               itself sets the properties' type to "Image" (apiCommon.js:2137,
               :2214): if the person moved to another view during the loading, the type
               returns to the selected one, the disabling of "Apply" follows.
               The event is shared and carries no data: it also arrives from the load of a window
               closed earlier — that one ends on its own properties. So
               from here only a redraw: what is in the zone is decided by the properties of this
               window. */
            onImageLoaded: function () {
                if (this._closed) return;
                if (this.wmType !== T.Image) {
                    this.props.put_Type(this.wmType);
                    this.disableControls(this.wmType);
                } else
                    this.refresh();
            },

            /* --- Page preview ------------------------------------------ */

            /* Recalculation on every edit in the window. A preview failure does not bring down the window.
               "Apply" is disabled when the view is empty and there is nothing to remove. */
            refresh: function () {
                if (!this._built || this._closed || !this.props) return;
                this.btnOk.setDisabled(this.isEmpty() && !this.hadWm);
                paint.call(this);
            },

            paint: function () {
                if (this.sizePage()) this.redrawZone();
                var img = this.hasImage();
                this.$zone.toggleClass('has-img', img);
                this.btnClear.setVisible(img);

                var page = this.$page[0], W = page.clientWidth, H = page.clientHeight;
                if (!W || !H) return;
                this.paintText(this.wmType === T.Text, W, H);
                this.paintImage(this.wmType === T.Image, W, H);
            },

            /* The A4 sheet by the height of the parameters column, there is no empty space before the
               footer. true — the size changed.
               The height is to the bottom of the text section, the tallest one, not
               of the whole column: an expanded link row lengthens the image section,
               and the sheet and the column must not change because of it. The measure is as in
               rendering with the row closed, and it is repeated when languages
               arrive asynchronously. The text section is not
               stretched across the cell (align-self in compact-watermark.less),
               so its height is its own.
               offset*, not getBoundingClientRect: the window is scaled in the show
               animation, the layout is not. The section and the sheet have one
               offsetParent — there are no positioned nodes between them and .vo-wm. */
            sizePage: function () {
                var sub = this.$subText[0], page = this.$page[0];
                if (!sub || !page || sub.offsetParent !== page.offsetParent) return false;
                var h = Math.round(sub.offsetTop + sub.offsetHeight - page.offsetTop);
                if (!(h > 0)) return false;
                var w = Math.round(h * PAGE_MM_W / PAGE_MM_H);
                if (page.style.height === h + 'px' && page.style.width === w + 'px') return false;
                page.style.height = h + 'px';
                page.style.width = w + 'px';
                return true;
            },

            /* The sheet changed width (the text section changed height) — the zone
               width changed too: the engine creates the canvas
               once by the node size, so we remove the old one, and it draws
               a new one at the new size. */
            redrawZone: function () {
                this.$thumb.children('canvas').remove();
                this.props.put_DivId(ZONE_ID);
            },

            /* The text — with the font, font size, color, style, semitransparency
               and a tilt along the sheet diagonal. The "Auto" font size — by the sheet size;
               a number — pt in sheet pixels. */
            paintText: function (show, W, H) {
                var sp = this.$markText[0], st = sp.style;
                if (!show) {
                    st.display = 'none';
                    return;
                }
                var size = parseFloat(this.cmbFontSize.getRawValue()),
                    diag = this.pickLayout.getValue() !== 'hor',
                    color = this.isAutoColor ? '000' : this.btnTextColor.currentColor,
                    lines = [];
                if (color && typeof color === 'object') color = color.color;
                this.btnUnderline.pressed && lines.push('underline');
                this.btnStrikeout.pressed && lines.push('line-through');

                sp.textContent = this.cmbText.getRawValue() || '';
                st.display = '';
                st.fontFamily = '"' + String(this.fontName || '').replace(/["\\]/g, '') + '"';
                st.color = color ? '#' + color : '';
                st.fontWeight = this.btnBold.pressed ? '700' : '400';
                st.fontStyle = this.btnItalic.pressed ? 'italic' : 'normal';
                st.textDecoration = lines.length ? lines.join(' ') : 'none';
                st.opacity = this.chTransparency.getValue() === 'checked' ? '.5' : '1';

                var fs;
                if (isNaN(size) || size <= 0) {
                    st.fontSize = '100px';
                    var target = diag ? Math.sqrt(W * W + H * H) * 0.72 : W * 0.85;
                    fs = Math.min(100 * target / Math.max(1, sp.offsetWidth), H * 0.4);
                } else
                    fs = size * 96 / 72 * W / PAGE_W;
                st.fontSize = fs + 'px';
                st.transform = diag ? 'rotate(' + (-Math.atan2(H, W) * 180 / Math.PI) + 'deg)' : 'none';
            },

            /* The picture — with the scale, by the same public engine path as the preview
               in the zone: a second texture node in a sheet of the computed size,
               drawTexture fits the picture into it preserving proportions.
               "Auto" — by the width of the text field, no higher than its height; percentages —
               of the original size (that is how the engine computes,
               GraphicObjects.js:527–562). DivId is immediately returned to the zone: it is
               awaited by the loading and showFileDialog. */
            paintImage: function (show, W, H) {
                var node = this.$markImg[0], url = show && this.hasImage() && this.props.get_ImageUrl();
                $(node).children('canvas').remove();
                /* "No image" — only for the "Image" view without a picture
                   (the same criterion as has-img of the zone); for "Text" and with
                   a picture — hidden. */
                this.$markNone[0].style.display = (show && !url) ? '' : 'none';
                if (!url) {
                    node.style.display = 'none';
                    return;
                }
                var size = this.originSize(url),
                    scale = parseInt(this.cmbScale.getValue(), 10),
                    mm = W / PAGE_MM_W,
                    tw = W * TEXT_W / PAGE_W,
                    th = H * TEXT_H / PAGE_H,
                    w, h;
                if (size && scale > 0) {
                    w = size.w * scale / 100 * mm;
                    h = size.h * scale / 100 * mm;
                } else if (size) {
                    w = tw;
                    h = size.h * tw / size.w;
                    if (h > th) {
                        h = th;
                        w = size.w * th / size.h;
                    }
                } else {
                    /* The original size is unknown — the text field: the engine
                       will fit the picture into it with its proportions. */
                    w = tw;
                    h = th;
                }
                var over = Math.max(w, h) / MAX_SIDE;
                if (over > 1) {
                    w /= over;
                    h /= over;
                }
                node.style.display = '';
                node.style.width = Math.max(1, Math.round(w)) + 'px';
                node.style.height = Math.max(1, Math.round(h)) + 'px';
                this.props.put_DivId(PAGE_IMG_ID);
                this.props.put_DivId(ZONE_ID);
            },

            /* The original picture size in mm — only by the public path
               (sdkjs/common/apiCommon.js:5505): Asc.asc_CImgProperty →
               get_OriginSize. Unknown — null. */
            originSize: function (url) {
                if (!Asc.asc_CImgProperty) return null;
                var ip = new Asc.asc_CImgProperty();
                ip.put_ImageUrl(url);
                var s = ip.get_OriginSize(this.api);
                return (s && s.asc_getIsCorrect()) ? {w: s.asc_getImageWidth(), h: s.asc_getImageHeight()} : null;
            },

            /* --- Keyboard and focus ---------------------------------------- */

            /* Keys before the stock code (Window.js:209). true — the press is handled. */
            onKeys: function (e) {
                var K = Common.UI.Keys, $t = $(e.target), key = e.keyCode;

                /* Esc with an open choice list closes the list, not the window.
                   When focus is on the list button or in the list itself, Esc is caught earlier than the
                   window by bootstrap (Bootstrap.js:61–69) — it does not
                   reach here. Here is the case when focus went elsewhere. */
                if (key === K.ESC) {
                    var open = _.find([this.cmbScale, this.pickLayout, this.btnTextColor], function (c) {
                        return c && c.isMenuOpen();
                    });
                    if (!open) return false;
                    open.menu.hide();
                    open.focus();
                    return true;
                }

                /* The zone is a button: Enter and Space choose a file. */
                if ((key === K.RETURN || key === K.SPACE) && this.$zone && $t.is(this.$zone)) {
                    e.preventDefault();
                    this.pickFile();
                    return true;
                }
                if (key !== K.RETURN) return false;

                /* Enter inside an open list is its key. */
                if ($t.closest('.dropdown-menu').length) return false;

                /* "Apply" is disabled exactly when "Load" is needed
                   (the image view without a picture), and guardEnter suppresses Enter
                   together with it. So Enter at the link field and on a button inside
                   the window is handled here. */
                if (this.txtUrl && $t.is(this.txtUrl._input)) {
                    this.loadUrl();
                    return true;
                }
                /* A button inside the window (view, "From URL", "Load",
                   style) — its action. Buttons with a list
                   are opened by their own handler (bindMenuKeys); the ComboBox list arrow
                   does not take Enter — and "Apply" is not pressed by it. */
                if ($t.is('button') && !$t.hasClass('dlg-btn')) {
                    if (!e.target.disabled && !$t.is('[data-toggle]')) e.target.click();
                    return true;
                }
                /* A list with input ("Text", font size): what is typed gets into the
                   ComboBox value on change, and the window's Enter arrives earlier —
                   without this "Apply" would take the previous value. */
                if ($t.is('input') && $t.closest('.combobox').length) $t.trigger('change');
                return false;
            },

            /* The Tab order is the markup order: the view, the text section,
               the image one, the footer. Disabled and hidden ones are skipped by
               FocusManager: the controls of the invisible section are disabled by the stock code. */
            getFocusedComponents: function () {
                return [
                    this.btnTypeImage, this.btnTypeText,
                    this.cmbLang, this.cmbText, this.cmbFonts, this.cmbFontSize, this.btnTextColor,
                    this.btnBold, this.btnItalic, this.btnUnderline, this.btnStrikeout,
                    this.chTransparency, this.pickLayout.btn,
                    {cmp: this.zone, selector: '.vo-wm-drop'}, this.btnClear,
                    this.btnFromUrl, this.cmbScale.btn,
                    this.txtUrl, this.btnLoad
                ].concat(this.getFooterButtons());
            },

            /* The first focus — per the stock code's meaning (:366–373): the language in the text
               view (until the languages arrive — the text), the zone in the image view. */
            getDefaultFocusableComponent: function () {
                if (this.wmType === T.Text)
                    return this.cmbLang.isDisabled() ? this.cmbText : this.cmbLang;
                return this.zone;
            }
        });
    }

    DE.Views.CompactWatermark = _.extend({

        /* The compact window class or null if the stock class does not exist yet. */
        ensure: function () {
            if (Dialog) return Dialog;
            if (!DE.Views.WatermarkSettingsDialog || !DE.Views.CompactWindows ||
                !(window.Common && Common.Views && Common.Views.AdvancedSettingsWindow)) return null;

            Dialog = DE.Views.CompactWatermarkDialog = build(DE.Views.WatermarkSettingsDialog);
            return Dialog;
        },

        /* A show failure: a window whose rendering broke off is closed so that a second mask
           does not remain under the stock one. An already open window is not touched —
           the failure is not its. Best effort. */
        abort: function () {
            var win = opening;
            opening = null;
            if (win && win.$window) {
                try { win.close(); } catch (ignore) {}
            }
        },

        /* --- Texts ------------------------------------------------------------ */
        /* The default is English, the locale overrides it with the keys
           DE.Views.CompactWatermark.*. The other window captions are the stock
           texts of WatermarkSettingsDialog (inherited) and
           Common.Views.ImageFromUrlDialog (link errors). */

        textRemoveImage: 'Remove image',
        textUpload: 'Upload image',
        textImageUrl: 'Image link',
        textLoad: 'Upload',
        textNoImage: 'No image',
        textPreview: 'Preview'

    }, DE.Views.CompactWatermark || {});

    return DE.Views.CompactWatermark;
});
