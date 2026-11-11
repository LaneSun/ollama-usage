import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import {parseBalance, parseUsage} from './api.js';

const BALANCE_URL = 'https://ollama.com/api/balance';
const USAGE_URL = 'https://ollama.com/api/usage?range=7d&group_by=model';

// One instance owns one account's connection, cache, requests and timers.
export class UsageClient {
    constructor(key, onUpdate, {url = BALANCE_URL, watchdogSeconds = 35, reportUrl = url === BALANCE_URL ? USAGE_URL : null} = {}) {
        this._reportUrl = reportUrl;
        this._key = (key ?? '').trim();
        this._onUpdate = onUpdate;
        this._url = url;
        this._watchdogSeconds = watchdogSeconds;
        this._session = new Soup.Session({timeout: 30, idle_timeout: 30});
        this._request = null;
        this._retryId = null;
        this._destroyed = false;
        this.data = null;
        this.error = this._key ? null : 'key';
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
        if (!this._key) {
            this._publish(null, 'key');
            return;
        }

        const previous = this._request;
        if (previous) {
            this._finish(previous);
            previous.cancellable.cancel();
        }
        const request = {cancellable: new Gio.Cancellable(), watchdog: null};
        this._request = request;
        try {
            const message = Soup.Message.new('GET', this._url);
            // Never forward credentials to a redirect destination.
            message.flags |= Soup.MessageFlags.NO_REDIRECT;
            message.request_headers.append('Authorization', `Bearer ${this._key}`);
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
                if (status === 429) {
                    this._failed('network', 0);
                } else if ((status >= 300 && status < 400) || status === 401 || status === 403) {
                    this._failed('auth', 0);
                } else if (status < 200 || status >= 300) {
                    this._failed('network', retries);
                } else {
                    let data = null;
                    try {
                        data = parseBalance(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                    } catch {
                        // Handled as a format error below.
                    }
                    if (data) {
                        data.models = this.data?.models ?? [];
                        this._publish(data, null);
                        this._fetchModels(data);
                    }
                    else
                        this._failed('format', 0);
                }
            });
        } catch {
            if (this._finish(request))
                this._failed('network', retries);
        }
    }

    // Best effort: the per-model breakdown is optional, so failures are ignored.
    _fetchModels(data) {
        if (!this._reportUrl || this._destroyed)
            return;
        const message = Soup.Message.new('GET', this._reportUrl);
        message.flags |= Soup.MessageFlags.NO_REDIRECT;
        message.request_headers.append('Authorization', `Bearer ${this._key}`);
        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                if (this._destroyed || message.get_status() !== 200 || this.data !== data)
                    return;
                Object.assign(data, parseUsage(JSON.parse(new TextDecoder().decode(bytes.get_data()))));
                this._onUpdate(this.data, this.error);
            } catch {
                // Keep the data without a breakdown.
            }
        });
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
        if (this._retryId !== null) {
            GLib.source_remove(this._retryId);
            this._retryId = null;
        }
        if (retries > 0 && !this._destroyed) {
            this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2 ** (3 - retries), () => {
                this._retryId = null;
                this._fetch(retries - 1);
                return GLib.SOURCE_REMOVE;
            });
        }
        this._publish(null, error);
    }

    destroy() {
        this._destroyed = true;
        if (this._retryId !== null) {
            GLib.source_remove(this._retryId);
            this._retryId = null;
        }
        const request = this._request;
        this._request = null;
        if (request) {
            if (request.watchdog !== null) {
                GLib.source_remove(request.watchdog);
                request.watchdog = null;
            }
            request.cancellable.cancel();
        }
        this._session?.abort();
        this._session = null;
        this._onUpdate = null;
    }
}
