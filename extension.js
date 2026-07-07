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

        this._refreshItem = new PopupMenu.PopupMenuItem(_('Refresh Now'));
        this._refreshItem.connect('activate', () => {
            this._extension.fetchData();
        });
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

        this._resetItem = new PopupMenu.PopupMenuItem('');
        this._resetItem.setSensitive(false);
        this.menu.addMenuItem(this._resetItem);

        this._tickCount = 0;
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

        this._settingsConnections = [];
        const appearanceKeys = [
            'ring-color', 'ring-thickness', 'ring-gap',
            'circle-color', 'circle-radius',
            'hand-color', 'hand-length', 'hand-thickness',
            'hand-outline-color', 'hand-outline-width',
        ];
        for (const key of appearanceKeys) {
            const id = this._settings.connect(`changed::${key}`, () => {
                this._drawingArea._updateSize();
                this._drawingArea.queue_repaint();
            });
            this._settingsConnections.push(id);
        }
    }

    updateMenu(data, fetchOk) {
        if (!fetchOk) {
            this._statusItem.label.set_text(_('Fetch failed — check cookie'));
            this._weeklyItem.label.set_text(_('Weekly: —'));
            this._sessionItem.label.set_text(_('Session: —'));
            this._resetItem.label.set_text(_('Resets: —'));
            return;
        }
        const weeklyPct = Math.round(data.weekly * 100);
        const sessionPct = Math.round(data.fiveHour * 100);
        this._statusItem.label.set_text(_('Last fetch: OK'));
        this._weeklyItem.label.set_text(_('Weekly: %d%%').format(weeklyPct));
        this._sessionItem.label.set_text(_('Session: %d%%').format(sessionPct));

        if (data.sessionResetTs) {
            const remaining = data.sessionResetTs - Date.now() / 1000;
            if (remaining > 0) {
                const h = Math.floor(remaining / 3600);
                const m = Math.floor((remaining % 3600) / 60);
                this._resetItem.label.set_text(_('Session resets in %dh %dm').format(h, m));
            } else {
                this._resetItem.label.set_text(_('Session resetting…'));
            }
        } else {
            this._resetItem.label.set_text(_('Resets: —'));
        }
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        for (const id of this._settingsConnections) {
            this._settings.disconnect(id);
        }
        this._settingsConnections = [];
        super.destroy();
    }
});

export default class OllamaCloudExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._createIndicator();
        this._addToPanel();

        this._posChangedId = this._settings.connect('changed::panel-position', () => {
            this._recreateIndicator();
        });
        this._indexChangedId = this._settings.connect('changed::panel-index', () => {
            this._recreateIndicator();
        });

        this._httpSession = new Soup.Session();
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

    fetchData() {
        this._fetchData(null);
    }

    fetchDataWithRetry(maxRetries) {
        this._fetchData((ok) => {
            if (!ok && maxRetries > 0) {
                const delay = Math.pow(2, 3 - maxRetries);
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

        try {
            const cookie = `__Secure-session="${sessionValue}"`;
            const msg = Soup.Message.new('GET', OLLAMA_URL);
            msg.request_headers.append('Cookie', cookie);
            msg.request_headers.append('User-Agent', 'Mozilla/5.0');

            this._httpSession.send_and_read_async(
                msg,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        const text = new TextDecoder().decode(bytes.get_data());
                        const data = this._parseHtml(text);
                        const ok = data.fiveHour > 0 || data.weekly > 0;
                        this._applyData(data, ok);
                        if (retryCallback) retryCallback(ok);
                    } catch (e) {
                        log(`[ollama-usage] fetch error: ${e}`);
                        this._applyData({ weekly: 0, fiveHour: 0, timeFraction: 0 }, false);
                        if (retryCallback) retryCallback(false);
                    }
                }
            );
        } catch (e) {
            log(`[ollama-usage] fetch setup error: ${e}`);
            this._applyData({ weekly: 0, fiveHour: 0, timeFraction: 0 }, false);
            if (retryCallback) retryCallback(false);
        }
    }

    _parseHtml(html) {
        const data = {
            weekly: 0.0,
            fiveHour: 0.0,
            timeFraction: 0.0,
            sessionResetTs: null,
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

        return data;
    }

    _applyData(data, fetchOk) {
        if (!fetchOk) {
            data = { weekly: 0, fiveHour: 0, timeFraction: 0, sessionResetTs: null };
        }
        if (this._indicator) {
            this._indicator._drawingArea.setUsageData(data, fetchOk);
            this._indicator.updateMenu(data, fetchOk);
        }
    }

    disable() {
        if (this._retryTimerId) {
            GLib.source_remove(this._retryTimerId);
            this._retryTimerId = null;
        }
        if (this._settings) {
            if (this._posChangedId) {
                this._settings.disconnect(this._posChangedId);
                this._posChangedId = null;
            }
            if (this._indexChangedId) {
                this._settings.disconnect(this._indexChangedId);
                this._indexChangedId = null;
            }
        }
        if (this._indicator) {
            this._removeFromPanel();
            this._indicator.destroy();
            this._indicator = null;
        }
        if (this._httpSession) {
            this._httpSession = null;
        }
        this._settings = null;
    }
}