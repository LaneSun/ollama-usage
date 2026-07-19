import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Cairo from 'gi://cairo';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const MARGIN = 2;
const OLLAMA_URL = 'https://ollama.com/settings';
const CHART_BAR_PX = 160;
const MIN_BAR_FILL_PX = 2;

const IndicatorDrawingArea = GObject.registerClass(
class IndicatorDrawingArea extends St.DrawingArea {
    _init(settings) {
        this._settings = settings;
        super._init({ reactive: false });
        this._usageData = {
            weekly: 0.0,
            fiveHour: 0.0,
            timeFraction: 0.0,
        };
        this._fetchOk = false;
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

        cr.setLineWidth(ringThickness);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setSourceRGBA(ringColor.r, ringColor.g, ringColor.b, ringColor.a * 0.2);
        cr.arc(cx, cy, ringRadius, 0, 2 * Math.PI);
        cr.stroke();

        const sessionAngle = this._usageData.fiveHour * 2 * Math.PI;
        cr.setSourceRGBA(ringColor.r, ringColor.g, ringColor.b, ringColor.a);
        cr.arc(cx, cy, ringRadius, -Math.PI / 2, -Math.PI / 2 + sessionAngle);
        cr.stroke();

        const circleColor = this._parseColor(this._settings.get_string('circle-color'));

        cr.setSourceRGBA(circleColor.r, circleColor.g, circleColor.b, circleColor.a * 0.15);
        cr.arc(cx, cy, circleRadius, 0, 2 * Math.PI);
        cr.fill();

        const weeklyAngle = this._usageData.weekly * 2 * Math.PI;
        cr.setSourceRGBA(circleColor.r, circleColor.g, circleColor.b, circleColor.a);
        cr.moveTo(cx, cy);
        cr.arc(cx, cy, circleRadius, -Math.PI / 2, -Math.PI / 2 + weeklyAngle);
        cr.fill();

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

    setUsageData(data, fetchOk) {
        this._usageData = data;
        this._fetchOk = fetchOk;
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
    _init(extension, settings) {
        super._init(0.5, 'Ollama Cloud Indicator', false);
        this._extension = extension;
        this._settings = settings;

        this._drawingArea = new IndicatorDrawingArea(settings);
        this._drawingArea.set_y_align(Clutter.ActorAlign.CENTER);
        this._drawingArea.set_x_align(Clutter.ActorAlign.CENTER);
        this.add_child(this._drawingArea);

        this._titleItem = new PopupMenu.PopupMenuItem(_('Ollama Cloud'));
        this._titleItem.setSensitive(false);
        this.menu.addMenuItem(this._titleItem);

        this._refreshItem = new PopupMenu.PopupMenuItem(_('Refresh Now'));
        this._refreshItem.connectObject('activate', () => {
            this._extension.fetchData();
        }, this);
        this.menu.addMenuItem(this._refreshItem);

        this._statusItem = new PopupMenu.PopupMenuItem(_('Not fetched yet'));
        this._statusItem.setSensitive(false);
        this.menu.addMenuItem(this._statusItem);

        this._menuSep = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._menuSep);

        this._weeklyItem = new PopupMenu.PopupMenuItem('');
        this._weeklyItem.setSensitive(false);
        this.menu.addMenuItem(this._weeklyItem);

        this._sessionItem = new PopupMenu.PopupMenuItem('');
        this._sessionItem.setSensitive(false);
        this.menu.addMenuItem(this._sessionItem);

        this._chartSep = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._chartSep);

        this._chartTitleItem = new PopupMenu.PopupMenuItem(_('Calls per 1% weekly usage'));
        this._chartTitleItem.setSensitive(false);
        this._chartTitleItem.actor.add_style_class_name('ollama-cloud-chart-title');
        this.menu.addMenuItem(this._chartTitleItem);

        this._chartSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._chartSection);

        this._timeoutId = null;
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
                this._tickCount++;
                if (this._tickCount >= this._settings.get_int('update-interval')) {
                    this._tickCount = 0;
                    this._extension.fetchData();
                }
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    updateMenu(data, fetchOk) {
        if (!fetchOk) {
            this._statusItem.label.set_text(_('Fetch failed — check cookie'));
            this._weeklyItem.label.set_text(_('Weekly: —'));
            this._sessionItem.label.set_text(_('Session: —'));
            this._renderChart(null);
            return;
        }
        const weeklyPct = Math.round(data.weekly * 100);
        const sessionPct = Math.round(data.fiveHour * 100);
        this._statusItem.label.set_text(_('Last fetch: OK'));

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

        this._renderChart(data);
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
        }).filter(r => r.value > 0);
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
        const empty = new PopupMenu.PopupMenuItem(_('No model breakdown available'));
        empty.setSensitive(false);
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
        this._retryTimerId = null;
        this._lastData = null;
        this._inFlight = false;
        this._httpSession = null;
        this._httpSessionGen = 0;
        this._watchdogId = null;
        this._createIndicator();
        this._addToPanel();

        this._settings.connectObject(
            'changed::panel-position', () => this._recreateIndicator(),
            'changed::panel-index', () => this._recreateIndicator(),
            this
        );

        this._ensureHttpSession();
        this.fetchDataWithRetry(3);
    }

    _createIndicator() {
        this._indicator = new OllamaIndicator(this, this._settings);
    }

    _recreateIndicator() {
        this._removeFromPanel();
        this._indicator.destroy();
        this._indicator = null;
        this._createIndicator();
        this._addToPanel();
    }

    _addToPanel() {
        Main.panel.addToStatusArea(
            'ollama-cloud-indicator',
            this._indicator,
            this._settings.get_int('panel-index'),
            this._settings.get_string('panel-position')
        );
    }

    _removeFromPanel() {
        const parent = this._indicator.get_parent();
        if (parent) {
            parent.remove_child(this._indicator);
        }
    }

    _ensureHttpSession() {
        if (this._httpSession)
            return;
        const session = new Soup.Session();
        session.timeout = 30;
        session.idle_timeout = 30;
        this._httpSession = session;
        this._httpSessionGen++;
    }

    _recreateHttpSession() {
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
        if (this._watchdogId !== null) {
            GLib.source_remove(this._watchdogId);
            this._watchdogId = null;
        }
        this._inFlight = false;
        this._ensureHttpSession();
    }

    fetchData() {
        // Drop a stuck in-flight request and rebuild the session before
        // retrying, so a deadlocked connection pool recovers without reloading.
        if (this._inFlight)
            this._recreateHttpSession();
        this.fetchDataWithRetry(3);
    }

    fetchDataWithRetry(maxRetries) {
        this._fetchData((ok) => {
            if (!ok && maxRetries > 0) {
                const delay = Math.pow(2, 3 - maxRetries);
                if (this._retryTimerId !== null)
                    GLib.source_remove(this._retryTimerId);
                this._retryTimerId = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT,
                    delay,
                    () => {
                        this._retryTimerId = null;
                        this.fetchDataWithRetry(maxRetries - 1);
                        return GLib.SOURCE_REMOVE;
                    }
                );
            }
        });
    }

    _fetchData(retryCallback) {
        const sessionValue = this._settings.get_string('ollama-cookie');
        if (!sessionValue) {
            this._applyData({ weekly: 0, fiveHour: 0, timeFraction: 0 }, false);
            if (retryCallback) retryCallback(false);
            return;
        }

        // Never overlap two requests on the same session — a pending request
        // means the previous callback never fired (stuck socket I/O).
        if (this._inFlight)
            this._recreateHttpSession();

        this._ensureHttpSession();
        const gen = this._httpSessionGen;

        // Guarantee retryCallback runs exactly once even if the async callback
        // is dropped (GNOME/libsoup#256); the watchdog below is the fallback.
        let settled = false;
        const settle = (ok) => {
            if (settled)
                return;
            settled = true;
            if (this._watchdogId !== null) {
                GLib.source_remove(this._watchdogId);
                this._watchdogId = null;
            }
            if (retryCallback) retryCallback(ok);
        };

        try {
            const cookie = `__Secure-session="${sessionValue}"`;
            const msg = Soup.Message.new('GET', OLLAMA_URL);
            msg.request_headers.append('Cookie', cookie);
            msg.request_headers.append('User-Agent', 'Mozilla/5.0');

            this._inFlight = true;

            // Watchdog: if the callback hasn't fired within 35s (5s past the
            // 30s socket timeout), the libsoup HTTP/2 callback-dropping bug
            // has struck (GNOME/libsoup#256). Force-settle + rebuild the
            // connection pool via a plain GLib timeout, unaffected by the bug.
            this._watchdogId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                35,
                () => {
                    this._watchdogId = null;
                    if (gen !== this._httpSessionGen)
                        return GLib.SOURCE_REMOVE;
                    if (!this._inFlight)
                        return GLib.SOURCE_REMOVE;
                    console.debug('[ollama-usage] fetch watchdog: callback never fired, rebuilding session');
                    this._inFlight = false;
                    this._recreateHttpSession();
                    settle(false);
                    return GLib.SOURCE_REMOVE;
                }
            );

            this._httpSession.send_and_read_async(
                msg,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    // Stale callback: session was aborted/recreated mid-flight
                    // (watchdog or competing fetch). The recreating caller
                    // already settled and started its own fetch.
                    if (gen !== this._httpSessionGen) {
                        settle(false);
                        return;
                    }
                    this._inFlight = false;
                    try {
                        const bytes = session.send_and_read_finish(result);
                        const text = new TextDecoder().decode(bytes.get_data());
                        const data = this._parseHtml(text);
                        const ok = data.fiveHour > 0 || data.weekly > 0;
                        this._applyData(data, ok);
                        settle(ok);
                    } catch (e) {
                        console.debug(`[ollama-usage] fetch error: ${e}`);
                        this._applyData({ weekly: 0, fiveHour: 0, timeFraction: 0 }, false);
                        settle(false);
                    }
                }
            );
        } catch (e) {
            console.debug(`[ollama-usage] fetch setup error: ${e}`);
            this._inFlight = false;
            if (this._watchdogId !== null) {
                GLib.source_remove(this._watchdogId);
                this._watchdogId = null;
            }
            this._applyData({ weekly: 0, fiveHour: 0, timeFraction: 0 }, false);
            settle(false);
        }
    }

    _parseHtml(html) {
        const data = {
            weekly: 0.0,
            fiveHour: 0.0,
            timeFraction: 0.0,
            sessionResetTs: null,
            weeklyResetTs: null,
            models: [],
        };

        let m = html.match(/aria-label="Session usage\s+([\d.]+)%\s*used"/);
        if (m) {
            data.fiveHour = Math.min(parseFloat(m[1]) / 100, 1.0);
        }

        m = html.match(/aria-label="Weekly usage\s+([\d.]+)%\s*used"/);
        if (m) {
            data.weekly = Math.min(parseFloat(m[1]) / 100, 1.0);
        }

        const sessionIdx = html.indexOf('Session usage');
        if (sessionIdx >= 0) {
            const afterSession = html.substring(sessionIdx);
            m = afterSession.match(/data-time="([^"]+)"/);
            if (m) {
                const dt = new Date(m[1]);
                data.sessionResetTs = dt.getTime() / 1000;
            }
        }

        const weeklyIdx = html.indexOf('Weekly usage');
        if (weeklyIdx >= 0) {
            const afterWeekly = html.substring(weeklyIdx);
            m = afterWeekly.match(/data-time="([^"]+)"/);
            if (m) {
                const dt = new Date(m[1]);
                data.weeklyResetTs = dt.getTime() / 1000;
            }
        }

        data.models = this._parseModels(html, weeklyIdx);
        return data;
    }

    _parseModels(html, weeklyIdx) {
        if (weeklyIdx < 0)
            return [];
        // Anchor on the weekly track's aria-label, not the visible "Weekly
        // usage" span (which can appear earlier in the DOM).
        const ariaIdx = html.indexOf('aria-label="Weekly usage', weeklyIdx);
        if (ariaIdx < 0)
            return [];
        const nextMeter = html.indexOf('data-usage-meter', ariaIdx);
        const blockEnd = nextMeter >= 0 ? nextMeter : html.length;
        const block = html.substring(ariaIdx, blockEnd);

        const segRe = /<button[^>]*data-usage-segment[^>]*>/g;
        const widthRe = /width:\s*([\d.]+)%/;
        const modelRe = /data-model="([^"]+)"/;
        const reqRe = /data-requests="([^"]+)"/;

        const byName = new Map();
        let sm;
        while ((sm = segRe.exec(block)) !== null) {
            const tag = sm[0];
            const mm = tag.match(modelRe);
            const rm = tag.match(reqRe);
            if (!mm || !rm)
                continue;
            const name = mm[1];
            const requests = parseInt(rm[1], 10);
            const wm = tag.match(widthRe);
            const widthPct = wm ? parseFloat(wm[1]) : 0;
            const existing = byName.get(name);
            if (existing) {
                existing.requests += requests;
                existing.widthPct += widthPct;
            } else {
                byName.set(name, { name, requests, widthPct });
            }
        }
        return [...byName.values()];
    }

    _applyData(data, fetchOk) {
        if (!fetchOk) {
            if (this._lastData) {
                this._indicator?._drawingArea.setUsageData(this._lastData, true);
                this._indicator?.updateMenu(this._lastData, true);
                return;
            }
            data = { weekly: 0, fiveHour: 0, timeFraction: 0, sessionResetTs: null, weeklyResetTs: null, models: [] };
        } else {
            this._lastData = data;
        }
        if (this._indicator) {
            this._indicator._drawingArea.setUsageData(data, fetchOk);
            this._indicator.updateMenu(data, fetchOk);
        }
    }

    disable() {
        if (this._retryTimerId !== null) {
            GLib.source_remove(this._retryTimerId);
            this._retryTimerId = null;
        }
        if (this._watchdogId !== null) {
            GLib.source_remove(this._watchdogId);
            this._watchdogId = null;
        }
        if (this._settings) {
            this._settings.disconnectObject(this);
        }
        if (this._indicator) {
            this._removeFromPanel();
            this._indicator.destroy();
            this._indicator = null;
        }
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
            this._httpSessionGen++;
            this._inFlight = false;
        }
        this._settings = null;
    }
}
