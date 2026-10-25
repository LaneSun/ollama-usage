import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {additionalAccounts, normalizeCookie} from './accounts.js';

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

const RESET_KEYS = [
    'ring-color', 'ring-thickness', 'ring-gap',
    'circle-color', 'circle-radius',
    'hand-color', 'hand-length', 'hand-thickness',
    'hand-outline-color', 'hand-outline-width',
    'panel-position', 'panel-index',
    'update-interval',
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
            title: _('Primary account'),
            description: _('Each account has its own panel meter. Cookies are stored in your user settings.'),
        });
        const nameRow = new Adw.EntryRow({title: _('Account name'), show_apply_button: true});
        nameRow.text = settings.get_string('account-name');
        nameRow.connect('apply', () => settings.set_string('account-name', nameRow.text.trim()));
        cloudGroup.add(nameRow);
        cloudGroup.add(this._createCookieRow(settings.get_string('ollama-cookie'), cookie => {
            settings.set_string('ollama-cookie', cookie);
        }));
        page.add(cloudGroup);

        this._accountsGroup = new Adw.PreferencesGroup({title: _('Additional accounts')});
        this._accountRows = new Map();
        const addButton = new Gtk.Button({label: _('Add Account'), valign: Gtk.Align.CENTER});
        addButton.connect('clicked', () => {
            const entries = this._accountEntries();
            const id = GLib.uuid_string_random();
            entries.push([id, _('Account %d').format(entries.length + 2), '']);
            this._saveAccounts(entries);
            this._accountRows.get(id).expanded = true;
        });
        this._accountsGroup.header_suffix = addButton;
        this._rebuildAccountRows();
        const accountsChanged = settings.connect('changed::accounts', () => this._rebuildAccountRows());
        window.connect('close-request', () => {
            settings.disconnect(accountsChanged);
            return false;
        });
        page.add(this._accountsGroup);

        const ringGroup = new Adw.PreferencesGroup({
            title: _('Outer Ring (Session Usage)'),
        });
        ringGroup.add(this._createColorRow(settings, 'ring-color', _('Ring Color')));
        ringGroup.add(this._createSpinRow(settings, 'ring-thickness', _('Ring Thickness'), 0.5, 10.0, 0.5, 'double'));
        ringGroup.add(this._createSpinRow(settings, 'ring-gap', _('Ring Gap'), 0.0, 20.0, 0.5, 'double'));
        page.add(ringGroup);

        const circleGroup = new Adw.PreferencesGroup({
            title: _('Inner Circle (Weekly Usage / Monthly Credits)'),
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
            title: _('Reset Appearance and Refresh Settings'),
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
        for (const key of RESET_KEYS) {
            this._settings.reset(key);
        }
        for (const handler of this._syncHandlers) {
            handler.refresh();
        }
    }

    _createCookieRow(value, onApply) {
        const row = new Adw.PasswordEntryRow({
            title: _('__Secure-session'),
            show_apply_button: true,
            text: value,
        });

        row.connect('apply', () => {
            const cookie = normalizeCookie(row.text);
            if (row.text.trim() && !cookie) {
                row.add_css_class('error');
                return;
            }
            row.remove_css_class('error');
            onApply(cookie);
        });
        return row;
    }

    _accountEntries() {
        return additionalAccounts(this._settings.get_value('accounts').deep_unpack())
            .map(({id, name, cookie}) => [id, name, cookie]);
    }

    _saveAccounts(entries) {
        this._settings.set_value('accounts', new GLib.Variant('a(sss)', entries));
    }

    _updateAccount(id, field, value) {
        const entries = this._accountEntries();
        const entry = entries.find(account => account[0] === id);
        if (entry) {
            entry[field] = value;
            this._saveAccounts(entries);
        }
    }

    _rebuildAccountRows() {
        const expanded = new Set([...this._accountRows].filter(([, row]) => row.expanded).map(([id]) => id));
        for (const row of this._accountRows.values())
            this._accountsGroup.remove(row);
        this._accountRows.clear();
        this._accountEntries().forEach(([id, name, cookie], index) => {
            const row = new Adw.ExpanderRow({
                title: name || _('Account %d').format(index + 2),
                use_markup: false,
                expanded: expanded.has(id),
            });
            const nameRow = new Adw.EntryRow({title: _('Account name'), show_apply_button: true, text: name});
            nameRow.connect('apply', () => {
                this._updateAccount(id, 1, nameRow.text.trim());
            });
            row.add_row(nameRow);
            row.add_row(this._createCookieRow(cookie, value => this._updateAccount(id, 2, value)));
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: _('Remove Account'),
                valign: Gtk.Align.CENTER,
            });
            remove.add_css_class('flat');
            remove.connect('clicked', () => this._saveAccounts(this._accountEntries().filter(account => account[0] !== id)));
            row.add_suffix(remove);
            this._accountsGroup.add(row);
            this._accountRows.set(id, row);
        });
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
