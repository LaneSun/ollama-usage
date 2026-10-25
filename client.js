import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {normalizeCookie} from './accounts.js';
import {parseUsage} from './usage.js';

const SETTINGS_URL = 'https://ollama.com/settings';

// One instance owns one account's connection, cache, requests and timers.
export class UsageClient {
    constructor(cookie, onUpdate, {url = SETTINGS_URL, watchdogSeconds = 35} = {}) {
        this._cookie = normalizeCookie(cookie);
        this._onUpdate = onUpdate;
        this._url = url;
        this._watchdogSeconds = watchdogSeconds;
        this._session = new Soup.Session({timeout: 30, idle_timeout: 30});
        this._request = null;
        this._retryId = null;
        this._destroyed = false;
        this.data = null;
        this.error = this._cookie ? null : 'cookie';
    }

    refresh() {
        // Polling must not abort a slow request or bypass retry backoff.
        if (this._destroyed || this._request || this._retryId !== null)
            return;
        this._fetch(3);
    }

    _fetch(retries) {
        if (this._destroyed)
            return;
        if (!this._cookie) {
            this._publish(null, 'cookie');
            return;
        }

        const request = {cancellable: new Gio.Cancellable(), watchdog: null};
        this._request = request;
        try {
            const message = Soup.Message.new('GET', this._url);
            // Never forward credentials to a redirect destination.
            message.flags |= Soup.MessageFlags.NO_REDIRECT;
            message.request_headers.append('Cookie', `__Secure-session=${this._cookie}`);
            message.request_headers.append('User-Agent', 'Mozilla/5.0');
            request.watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._watchdogSeconds, () => {
                request.watchdog = null;
                if (this._request !== request || this._destroyed)
                    return GLib.SOURCE_REMOVE;
                this._request = null;
                request.cancellable.cancel();
                this._session.abort();
                this._session = new Soup.Session({timeout: 30, idle_timeout: 30});
                this._failed('network', retries);
                return GLib.SOURCE_REMOVE;
            });
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, request.cancellable, (session, result) => {
                let bytes;
                try {
                    bytes = session.send_and_read_finish(result);
                } catch {
                    if (this._finish(request))
                        this._failed('network', retries);
                    return;
                }
                if (!this._finish(request))
                    return;
                const status = message.get_status();
                if ((status >= 300 && status < 400) || status === 401 || status === 403) {
                    this._failed('auth', 0);
                } else if (status < 200 || status >= 300) {
                    this._failed('network', retries);
                } else {
                    const data = parseUsage(new TextDecoder().decode(bytes.get_data()));
                    if (data.found)
                        this._publish(data, null);
                    else
                        this._failed('format', 0);
                }
            });
        } catch {
            if (this._finish(request))
                this._failed('network', retries);
        }
    }

    _finish(request) {
        // Ignore callbacks from cancelled requests without touching new timers.
        if (this._destroyed || this._request !== request)
            return false;
        this._request = null;
        if (request.watchdog !== null) {
            GLib.source_remove(request.watchdog);
            request.watchdog = null;
        }
        return true;
    }

    _publish(data, error) {
        if (data)
            this.data = data;
        this.error = error;
        this._onUpdate(this.data, this.error);
    }

    _failed(error, retries) {
        this._publish(null, error);
        if (retries > 0 && !this._destroyed) {
            this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2 ** (3 - retries), () => {
                this._retryId = null;
                this._fetch(retries - 1);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        if (this._retryId !== null) {
            GLib.source_remove(this._retryId);
            this._retryId = null;
        }
        const request = this._request;
        this._request = null;
        if (request) {
            if (request.watchdog !== null)
                GLib.source_remove(request.watchdog);
            request.cancellable.cancel();
        }
        this._session.abort();
        this._session = null;
        this._onUpdate = null;
    }
}
