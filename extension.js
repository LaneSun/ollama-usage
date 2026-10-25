import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Cairo from 'gi://cairo';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {additionalAccounts, PRIMARY_ACCOUNT} from './accounts.js';
import {UsageClient} from './client.js';
import {clampFraction, emptyUsage} from './usage.js';

const MARGIN = 2;
const CHART_BAR_PX = 160;
const MIN_BAR_FILL_PX = 2;

const IndicatorDrawingArea = GObject.registerClass(
class IndicatorDrawingArea extends St.DrawingArea {
    _init(settings) {
        this._settings = settings;
        super._init({ reactive: false });
        this._usageData = emptyUsage();
        this._updateSize();
        this._updateTimeFraction();
    }

    _updateSize() {
        const circleRadius = this._settings.get_double('circle-radius');
        const ringThickness = this._settings.get_double('ring-thickness');
        const ringGap = this._settings.get_double('ring-gap');
        const handLength = this._settings.get_double('hand-length');
        const outlineWidth = this._settings.get_double('hand-outline-width');
        const ringOuter = circleRadius + ringGap + ringThickness;
        const maxExtent = ringOuter + handLength / 2 + outlineWidth;
        this._size = Math.ceil((maxExtent + MARGIN) * 2);
        this.set_size(this._size, this._size);
    }

    vfunc_repaint() {
        const cr = this.get_context();
        try {
            this._onDraw(cr);
        } finally {
            cr.$dispose();
        }
    }

    _onDraw(cr) {
        const w = this._size;
        const cx = w / 2;
        const cy = w / 2;

        const circleRadius = this._settings.get_double('circle-radius');
        const ringThickness = this._settings.get_double('ring-thickness');
        const ringGap = this._settings.get_double('ring-gap');
        const ringRadius = circleRadius + ringGap + ringThickness / 2;

        const ringColor = this._parseColor(this._settings.get_string('ring-color'));

        const hasSession = this._usageData.hasSession !== false;

        if (hasSession) {
            cr.setLineWidth(ringThickness);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setSourceRGBA(ringColor.r, ringColor.g, ringColor.b, ringColor.a * 0.2);
            cr.arc(cx, cy, ringRadius, 0, 2 * Math.PI);
            cr.stroke();
            const sessionAngle = clampFraction(this._usageData.fiveHour) * 2 * Math.PI;
            cr.setSourceRGBA(ringColor.r, ringColor.g, ringColor.b, ringColor.a);
            cr.arc(cx, cy, ringRadius, -Math.PI / 2, -Math.PI / 2 + sessionAngle);
            cr.stroke();
        }

        const circleColor = this._parseColor(this._settings.get_string('circle-color'));

        cr.setSourceRGBA(circleColor.r, circleColor.g, circleColor.b, circleColor.a * 0.15);
        cr.arc(cx, cy, circleRadius, 0, 2 * Math.PI);
        cr.fill();

        const weeklyAngle = clampFraction(this._usageData.weekly) * 2 * Math.PI;
        cr.setSourceRGBA(circleColor.r, circleColor.g, circleColor.b, circleColor.a);
        cr.moveTo(cx, cy);
        cr.arc(cx, cy, circleRadius, -Math.PI / 2, -Math.PI / 2 + weeklyAngle);
        cr.fill();

        if (!hasSession)
            return;

        const handLength = this._settings.get_double('hand-length');
        const handThickness = this._settings.get_double('hand-thickness');
        const handColor = this._parseColor(this._settings.get_string('hand-color'));
        const outlineColor = this._parseColor(this._settings.get_string('hand-outline-color'));
        const outlineWidth = this._settings.get_double('hand-outline-width');

        const handAngle = -Math.PI / 2 + this._usageData.timeFraction * 2 * Math.PI;
        const cosA = Math.cos(handAngle);
        const sinA = Math.sin(handAngle);

        const innerR = ringRadius - handLength / 2;
        const outerR = ringRadius + handLength / 2;
        const x1 = cx + cosA * innerR;
        const y1 = cy + sinA * innerR;
        const x2 = cx + cosA * outerR;
        const y2 = cy + sinA * outerR;

        cr.setLineCap(Cairo.LineCap.ROUND);

        if (outlineWidth > 0) {
            cr.setLineWidth(handThickness + outlineWidth * 2);
            cr.setSourceRGBA(outlineColor.r, outlineColor.g, outlineColor.b, outlineColor.a);
            cr.moveTo(x1, y1);
            cr.lineTo(x2, y2);
            cr.stroke();
        }

        cr.setLineWidth(handThickness);
        cr.setSourceRGBA(handColor.r, handColor.g, handColor.b, handColor.a);
        cr.moveTo(x1, y1);
        cr.lineTo(x2, y2);
        cr.stroke();
    }

    _parseColor(str) {
        if (str.startsWith('#')) {
            const hex = str.substring(1);
            return {
                r: parseInt(hex.substring(0, 2), 16) / 255,
                g: parseInt(hex.substring(2, 4), 16) / 255,
                b: parseInt(hex.substring(4, 6), 16) / 255,
                a: hex.length >= 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1.0,
            };
        }
        const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            return {
                r: parseInt(match[1]) / 255,
                g: parseInt(match[2]) / 255,
                b: parseInt(match[3]) / 255,
                a: match[4] !== undefined ? parseFloat(match[4]) : 1.0,
            };
        }
        return { r: 1, g: 1, b: 1, a: 1 };
    }

    setUsageData(data) {
        this._usageData = data;
        this._updateTimeFraction();
        this.queue_repaint();
    }

    _updateTimeFraction() {
        const resetTs = this._usageData.sessionResetTs;
        if (resetTs) {
            const now = Date.now() / 1000;
            const remaining = resetTs - now;
            const total = 18000;
            this._usageData.timeFraction = Math.max(0, Math.min(1, 1 - remaining / total));
        } else {
            this._usageData.timeFraction = 0;
        }
    }

    refresh() {
        this._updateTimeFraction();
        this.queue_repaint();
    }
});

const OllamaIndicator = GObject.registerClass(
class OllamaIndicator extends PanelMenu.Button {
    _init(extension, settings, account, showName) {
        super._init(0.5, `${_('Ollama Cloud')} — ${account.name}`, false);
        this._account = account;
        this._settings = settings;
        this._data = null;
        this._error = null;

        const box = new St.BoxLayout({style_class: 'ollama-cloud-indicator'});
        this._drawingArea = new IndicatorDrawingArea(settings);
        this._drawingArea.set_y_align(Clutter.ActorAlign.CENTER);
        this._drawingArea.set_x_align(Clutter.ActorAlign.CENTER);
        box.add_child(this._drawingArea);
        if (showName) {
            const characters = Array.from(account.name);
            const text = characters.length > 12 ? `${characters.slice(0, 12).join('')}…` : account.name;
            box.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
        }
        this.add_child(box);

        this._titleItem = new PopupMenu.PopupMenuItem(`${_('Ollama Cloud')} — ${account.name}`, {reactive: false, can_focus: false});
        this.menu.addMenuItem(this._titleItem);

        this._refreshItem = new PopupMenu.PopupMenuItem(_('Refresh Now'));
        this._refreshItem.connectObject('activate', () => {
            this._account.client.refresh();
        }, this);
        this.menu.addMenuItem(this._refreshItem);

        this._statusItem = new PopupMenu.PopupMenuItem(_('Not fetched yet'), {reactive: false, can_focus: false});
        this.menu.addMenuItem(this._statusItem);

        this._menuSep = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._menuSep);

        this._weeklyItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this.menu.addMenuItem(this._weeklyItem);

        this._sessionItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this.menu.addMenuItem(this._sessionItem);

        this._chartSep = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._chartSep);

        this._chartTitleItem = new PopupMenu.PopupMenuItem(_('Calls per 1% usage'), {reactive: false, can_focus: false});
        this._chartTitleItem.actor.add_style_class_name('ollama-cloud-chart-title');
        this.menu.addMenuItem(this._chartTitleItem);

        this._chartSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._chartSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const preferences = new PopupMenu.PopupMenuItem(_('Preferences'));
        preferences.connectObject('activate', () => extension.openPreferences(), this);
        this.menu.addMenuItem(preferences);

        this._timeoutId = null;
        this._tickCount = 0;
        this._ensureTimeout();

        this._settings.connectObject(
            'changed::ring-color', () => this._onAppearanceChanged(),
            'changed::ring-thickness', () => this._onAppearanceChanged(),
            'changed::ring-gap', () => this._onAppearanceChanged(),
            'changed::circle-color', () => this._onAppearanceChanged(),
            'changed::circle-radius', () => this._onAppearanceChanged(),
            'changed::hand-color', () => this._onAppearanceChanged(),
            'changed::hand-length', () => this._onAppearanceChanged(),
            'changed::hand-thickness', () => this._onAppearanceChanged(),
            'changed::hand-outline-color', () => this._onAppearanceChanged(),
            'changed::hand-outline-width', () => this._onAppearanceChanged(),
            this
        );
    }

    _onAppearanceChanged() {
        this._drawingArea._updateSize();
        this._drawingArea.queue_repaint();
    }

    _ensureTimeout() {
        if (this._timeoutId !== null)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            1,
            () => {
                this._drawingArea.refresh();
                if (this.menu.isOpen)
                    this.updateMenu(this._data, this._error, false);
                this._tickCount++;
                if (this._tickCount >= this._settings.get_int('update-interval')) {
                    this._tickCount = 0;
                    this._account.client.refresh();
                }
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    updateMenu(data, error, renderChart = true) {
        this._data = data;
        this._error = error;
        if (renderChart) {
            this._drawingArea.setUsageData(data ?? emptyUsage());
            this._drawingArea.opacity = error ? 110 : 255;
            this._renderChart(data);
        }
        const status = this._statusText(data, error);
        this._statusItem.label.set_text(status);
        this.accessible_name = `${_('Ollama Cloud')} — ${this._account.name}: ${status}`;
        if (!data) {
            this._weeklyItem.label.set_text(_('Weekly: —'));
            this._sessionItem.label.set_text(_('Session: —'));
            return;
        }

        if (data.creditsUsed !== null && data.creditsTotal !== null) {
            const plan = data.planType ? ` (${data.planType})` : '';
            const used = data.creditsUsed.toFixed(2);
            const total = data.creditsTotal.toFixed(2);
            const remaining = Math.max(0, data.creditsTotal - data.creditsUsed).toFixed(2);
            this._weeklyItem.label.set_text(
                _('Used: %s%s / %s%s%s').format(
                    data.creditsCurrency, used, data.creditsCurrency, total, plan
                )
            );

            const refillReset = this._formatReset(data.weeklyResetTs, 'dh');
            this._sessionItem.label.set_text(
                refillReset
                    ? _('Remaining: %s%s (refills in %s)').format(data.creditsCurrency, remaining, refillReset)
                    : _('Remaining: %s%s').format(data.creditsCurrency, remaining)
            );
        } else {
            const weeklyPct = Math.round(data.weekly * 100);
            const sessionPct = Math.round(data.fiveHour * 100);

            const weeklyReset = this._formatReset(data.weeklyResetTs, 'dh');
            this._weeklyItem.label.set_text(
                weeklyReset
                    ? _('Weekly: %d%% (%s)').format(weeklyPct, weeklyReset)
                    : _('Weekly: %d%%').format(weeklyPct)
            );

            const sessionReset = this._formatReset(data.sessionResetTs, 'hm');
            this._sessionItem.label.set_text(
                sessionReset
                    ? _('Session: %d%% (%s)').format(sessionPct, sessionReset)
                    : _('Session: %d%%').format(sessionPct)
            );
        }

        this.accessible_name += `; ${this._weeklyItem.label.text}; ${this._sessionItem.label.text}`;
    }

    _statusText(data, error) {
        if (error && data)
            return _('Refresh failed — showing last successful data');
        if (error === 'cookie')
            return _('Set a valid session cookie in Preferences');
        if (error === 'auth')
            return _('Session expired — update the cookie in Preferences');
        if (error === 'format')
            return _('No usage data — check your cookie or Ollama plan');
        if (error)
            return _('Fetch failed — check your connection');
        return data ? _('Last fetch: OK') : _('Not fetched yet');
    }

    _formatReset(ts, unitSpec) {
        if (!ts)
            return '';
        const remaining = ts - Date.now() / 1000;
        if (remaining <= 0)
            return _('resetting…');
        const d = Math.floor(remaining / 86400);
        const h = Math.floor((remaining % 86400) / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        if (unitSpec === 'dh')
            return _('%dd %dh').format(d, h);
        return _('%dh %dm').format(h, m);
    }

    _renderChart(data) {
        this._chartSection.removeAll();
        if (!data || !data.models || data.models.length === 0 || data.weekly <= 0) {
            this._addEmptyChartRow();
            return;
        }

        const rows = data.models.map(m => {
            const actualPct = m.widthPct * data.weekly;
            const value = actualPct > 0 ? m.requests / actualPct : 0;
            return { name: m.name, value };
        }).filter(r => Number.isFinite(r.value) && r.value > 0);
        rows.sort((a, b) => b.value - a.value);

        if (rows.length === 0) {
            this._addEmptyChartRow();
            return;
        }

        const grid = new St.Widget({
            layout_manager: new Clutter.GridLayout({
                row_spacing: 1,
                column_spacing: 10,
            }),
        });
        const layoutManager = grid.layout_manager;

        const maxValue = rows[0].value;
        rows.forEach((row, i) => {
            const [label, bar, valueLabel] = this._createChartCells(row, maxValue);
            layoutManager.attach(label, 0, i, 1, 1);
            layoutManager.attach(bar, 1, i, 1, 1);
            layoutManager.attach(valueLabel, 2, i, 1, 1);
        });

        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        item.actor.add_style_class_name('ollama-cloud-chart-grid');
        item.actor.add_child(grid);
        this._chartSection.addMenuItem(item);
    }

    _addEmptyChartRow() {
        const empty = new PopupMenu.PopupMenuItem(_('No model breakdown available'), {reactive: false, can_focus: false});
        empty.actor.add_style_class_name('ollama-cloud-chart-empty');
        this._chartSection.addMenuItem(empty);
    }

    _createChartCells(row, maxValue) {
        const label = new St.Label({ text: row.name });
        label.add_style_class_name('ollama-cloud-chart-label');
        label.y_align = Clutter.ActorAlign.CENTER;

        const fraction = maxValue > 0 ? row.value / maxValue : 0;
        const fill = new St.Widget({
            style_class: 'ollama-cloud-chart-bar-fill',
            style: `width: ${Math.max(MIN_BAR_FILL_PX, Math.round(fraction * CHART_BAR_PX))}px;`,
        });

        const bar = new St.Widget({
            style_class: 'ollama-cloud-chart-bar',
            y_align: Clutter.ActorAlign.CENTER,
        });
        bar.add_child(fill);

        const valueLabel = new St.Label({ text: this._formatCount(row.value) });
        valueLabel.add_style_class_name('ollama-cloud-chart-value');
        valueLabel.y_align = Clutter.ActorAlign.CENTER;

        return [label, bar, valueLabel];
    }

    _formatCount(n) {
        const rounded = Math.round(n);
        const sign = rounded < 0 ? '-' : '';
        const digits = Math.abs(rounded).toString();
        const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return sign + grouped;
    }

    destroy() {
        if (this._timeoutId !== null) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._settings.disconnectObject(this);
        super.destroy();
    }
});

export default class OllamaCloudExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._accounts = new Map();
        this._settingsHandlers = [
            'accounts', 'ollama-cookie', 'account-name',
            'panel-position', 'panel-index',
        ].map(key => this._settings.connect(`changed::${key}`, () => this._syncAccounts()));
        this._syncAccounts();
    }

    _syncAccounts() {
        const definitions = [
            {
                id: PRIMARY_ACCOUNT,
                name: this._settings.get_string('account-name').trim() || _('Primary account'),
                cookie: this._settings.get_string('ollama-cookie'),
            },
            ...additionalAccounts(this._settings.get_value('accounts').deep_unpack())
                .map((account, index) => ({...account, name: account.name || _('Account %d').format(index + 2)})),
        ];
        // Preserve caches on layout edits; replace clients on credential edits.
        for (const account of this._accounts.values()) {
            account.indicator?.destroy();
            account.indicator = null;
            const next = definitions.find(definition => definition.id === account.id);
            if (!next || next.cookie !== account.cookie) {
                account.client.destroy();
                this._accounts.delete(account.id);
            }
        }
        definitions.forEach((definition, index) => {
            let account = this._accounts.get(definition.id);
            const isNew = !account;
            if (isNew) {
                account = {...definition, indicator: null};
                account.client = new UsageClient(account.cookie, (data, error) => {
                    account.indicator?.updateMenu(data, error);
                });
                this._accounts.set(account.id, account);
            }
            account.name = definition.name;
            account.indicator = new OllamaIndicator(this, this._settings, account, definitions.length > 1);
            Main.panel.addToStatusArea(
                `ollama-cloud-indicator-${account.id}`,
                account.indicator,
                this._settings.get_int('panel-index') + index,
                this._settings.get_string('panel-position')
            );
            account.indicator.updateMenu(account.client.data, account.client.error);
            if (isNew)
                account.client.refresh();
        });
    }

    disable() {
        for (const id of this._settingsHandlers ?? [])
            this._settings.disconnect(id);
        this._settingsHandlers = [];
        for (const account of this._accounts?.values() ?? []) {
            account.client.destroy();
            account.indicator?.destroy();
        }
        this._accounts = null;
        this._settings = null;
    }
}
