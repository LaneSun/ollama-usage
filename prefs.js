import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function rgbaToHex(rgba) {
    const r = Math.round(rgba.red * 255).toString(16).padStart(2, '0');
    const g = Math.round(rgba.green * 255).toString(16).padStart(2, '0');
    const b = Math.round(rgba.blue * 255).toString(16).padStart(2, '0');
    const a = Math.round(rgba.alpha * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}${a}`;
}

function hexToRGBA(hex) {
    const rgba = new Gdk.RGBA();
    rgba.parse(hex);
    return rgba;
}

const ALL_KEYS = [
    'ring-color', 'ring-thickness', 'ring-gap',
    'circle-color', 'circle-radius',
    'hand-color', 'hand-length', 'hand-thickness',
    'hand-outline-color', 'hand-outline-width',
    'panel-position', 'panel-index',
    'update-interval',
    'ollama-cookie',
];

export default class OllamaCloudPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        this._settings = settings;
        this._syncHandlers = [];

        const page = new Adw.PreferencesPage({
            title: _('Ollama Cloud Indicator'),
            icon_name: 'preferences-system-symbolic',
        });

        const cloudGroup = new Adw.PreferencesGroup({
            title: _('Ollama Cloud'),
        });
        cloudGroup.add(this._createCookieRow(settings, 'ollama-cookie', _('__Secure-session')));
        page.add(cloudGroup);

        const ringGroup = new Adw.PreferencesGroup({
            title: _('Outer Ring (Session Usage)'),
        });
        ringGroup.add(this._createColorRow(settings, 'ring-color', _('Ring Color')));
        ringGroup.add(this._createSpinRow(settings, 'ring-thickness', _('Ring Thickness'), 0.5, 10.0, 0.5, 'double'));
        ringGroup.add(this._createSpinRow(settings, 'ring-gap', _('Ring Gap'), 0.0, 20.0, 0.5, 'double'));
        page.add(ringGroup);

        const circleGroup = new Adw.PreferencesGroup({
            title: _('Inner Circle (Weekly Usage)'),
        });
        circleGroup.add(this._createColorRow(settings, 'circle-color', _('Circle Color')));
        circleGroup.add(this._createSpinRow(settings, 'circle-radius', _('Circle Radius'), 2.0, 28.0, 0.5, 'double'));
        page.add(circleGroup);

        const handGroup = new Adw.PreferencesGroup({
            title: _('Clock Hand (Time to Reset)'),
        });
        handGroup.add(this._createColorRow(settings, 'hand-color', _('Hand Color')));
        handGroup.add(this._createSpinRow(settings, 'hand-length', _('Hand Length'), 1.0, 24.0, 0.5, 'double'));
        handGroup.add(this._createSpinRow(settings, 'hand-thickness', _('Hand Thickness'), 0.5, 6.0, 0.5, 'double'));
        handGroup.add(this._createColorRow(settings, 'hand-outline-color', _('Hand Outline Color')));
        handGroup.add(this._createSpinRow(settings, 'hand-outline-width', _('Hand Outline Width'), 0.0, 5.0, 0.5, 'double'));
        page.add(handGroup);

        const positionGroup = new Adw.PreferencesGroup({
            title: _('Position'),
        });
        positionGroup.add(this._createComboRow(settings, 'panel-position', _('Panel Position'),
            [_('Left'), _('Center'), _('Right')], ['left', 'center', 'right']));
        positionGroup.add(this._createSpinRow(settings, 'panel-index', _('Position Index'), 0, 100, 1, 'int'));
        page.add(positionGroup);

        const dataGroup = new Adw.PreferencesGroup({
            title: _('Data'),
        });
        dataGroup.add(this._createSpinRow(settings, 'update-interval', _('Update Interval (seconds)'), 5, 3600, 1, 'int'));
        page.add(dataGroup);

        const resetGroup = new Adw.PreferencesGroup();
        const resetRow = new Adw.ButtonRow({
            title: _('Reset to Defaults'),
        });
        resetRow.add_css_class('destructive-action');
        resetRow.connect('activated', () => {
            this._resetToDefaults();
        });
        resetGroup.add(resetRow);
        page.add(resetGroup);

        window.add(page);
    }

    _resetToDefaults() {
        for (const key of ALL_KEYS) {
            this._settings.reset(key);
        }
        for (const handler of this._syncHandlers) {
            handler.refresh();
        }
    }

    _createCookieRow(settings, key, title) {
        const row = new Adw.EntryRow({
            title: title,
            show_apply_button: true,
        });

        const sync = () => { row.text = settings.get_string(key); };
        sync();

        row.connect('apply', () => {
            settings.set_string(key, row.text);
        });

        this._syncHandlers.push({ refresh: sync });
        return row;
    }

    _createColorRow(settings, key, title) {
        const row = new Adw.ActionRow({ title: title });
        const dialog = new Gtk.ColorDialog({ with_alpha: true });
        const button = new Gtk.ColorDialogButton({ dialog: dialog });

        const sync = () => { button.rgba = hexToRGBA(settings.get_string(key)); };
        sync();

        button.connect('notify::rgba', (btn) => {
            settings.set_string(key, rgbaToHex(btn.rgba));
        });

        row.add_suffix(button);
        row.activatable_widget = button;
        this._syncHandlers.push({ refresh: sync });
        return row;
    }

    _createSpinRow(settings, key, title, lower, upper, step, type) {
        const adjustment = new Gtk.Adjustment({
            lower: lower,
            upper: upper,
            step_increment: step,
        });

        const row = new Adw.SpinRow({
            title: title,
            adjustment: adjustment,
        });

        const sync = () => {
            if (type === 'double')
                row.value = settings.get_double(key);
            else
                row.value = settings.get_int(key);
        };
        sync();

        if (type === 'double') {
            row.digits = 1;
            row.connect('notify::value', (r) => {
                settings.set_double(key, r.value);
            });
        } else {
            row.connect('notify::value', (r) => {
                settings.set_int(key, Math.round(r.value));
            });
        }

        this._syncHandlers.push({ refresh: sync });
        return row;
    }

    _createComboRow(settings, key, title, labels, values) {
        const model = new Gtk.StringList();
        for (const label of labels) {
            model.append(label);
        }

        const row = new Adw.ComboRow({
            title: title,
            model: model,
        });

        const sync = () => {
            const idx = values.indexOf(settings.get_string(key));
            if (idx >= 0)
                row.selected = idx;
        };
        sync();

        row.connect('notify::selected', (r) => {
            settings.set_string(key, values[r.selected]);
        });

        this._syncHandlers.push({ refresh: sync });
        return row;
    }
}