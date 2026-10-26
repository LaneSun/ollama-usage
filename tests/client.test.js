// Exercise real libsoup requests and GLib timers against an isolated server.
// All cookie values below are synthetic. No Ollama account is contacted.
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import System from 'system';
import {UsageClient} from '../client.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function until(predicate, message, timeout = 7000) {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeout)
            throw new Error(`Timed out: ${message}`);
        await sleep(20);
    }
}

const legacy = '<div aria-label="Weekly usage 25% used"></div>';
const credits = '<div aria-label="Monthly credits used: $2.33 of $60"></div>';
const server = new Soup.Server();
const context = GLib.MainContext.default();
const requests = new Map();
const clients = [];
let failA = false;
let redirected = false;
let userAgent;
server.add_handler(null, (_server, message, path) => {
    const cookie = message.get_request_headers().get_one('Cookie');
    userAgent = message.get_request_headers().get_one('User-Agent');
    const key = `${path}:${cookie}`;
    requests.set(key, (requests.get(key) ?? 0) + 1);
    if (path === '/redirect-target')
        redirected = true;
    if (path === '/auth') {
        message.set_status(302, null);
        message.get_response_headers().append('Location', '/redirect-target');
        return;
    }
    if (path === '/format') {
        message.set_status(200, null);
        message.set_response('text/html', Soup.MemoryUse.COPY, '<h1>Sign in</h1>');
        return;
    }
    if (path === '/watchdog' && requests.get(key) === 1) {
        message.pause();
        return;
    }
    message.set_status(failA && cookie === '__Secure-session=a' ? 503 : 200, null);
    message.set_response('text/html', Soup.MemoryUse.COPY, cookie === '__Secure-session=b' ? credits : legacy);
    if (path === '/slow') {
        message.pause();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            message.unpause();
            return GLib.SOURCE_REMOVE;
        });
    }
});
server.listen_local(0, 0);
const base = server.get_uris()[0].to_string().replace(/\/$/, '');

function client(cookie, path = '/settings', options = {}) {
    const updates = [];
    const instance = new UsageClient(cookie, (data, error) => updates.push({data, error}), {url: base + path, ...options});
    clients.push(instance);
    return {instance, updates};
}

async function run() {
    const a = client('a');
    const b = client('b');
    a.instance.refresh();
    b.instance.refresh();
    await until(() => a.updates.length && b.updates.length, 'two independent accounts');
    assert(a.instance.data.weekly === 0.25 && a.instance.data.hasSession, 'legacy account data');
    assert(b.instance.data.creditsUsed === 2.33 && !b.instance.data.hasSession, 'credit account data');
    assert(userAgent === 'Mozilla/5.0', 'preserve the existing settings-page user agent');
    print('PASS: independent cookies, caches and pricing formats');

    failA = true;
    a.instance.refresh();
    b.instance.refresh();
    await until(() => a.updates.length === 2 && b.updates.length === 2, 'cached failure');
    assert(a.instance.data.weekly === 0.25 && a.instance.error === 'network', 'cached data must be marked stale');
    assert(b.instance.error === null, 'one account failure must not affect another');
    const firstRetry = a.instance._retryId;
    assert(context.find_source_by_id(firstRetry), 'HTTP failure must schedule a retry');
    a.instance._failed('network', 2);
    assert(!context.find_source_by_id(firstRetry), 'replacing a retry must remove its previous source');
    const pendingRetry = a.instance._retryId;
    assert(context.find_source_by_id(pendingRetry), 'replacement retry must be scheduled');
    a.instance.destroy();
    a.instance.destroy();
    a.instance.refresh();
    assert(!context.find_source_by_id(pendingRetry), 'destroy must immediately remove the retry source');
    clients.splice(clients.indexOf(a.instance), 1);
    await sleep(2200);
    assert(requests.get('/settings:__Secure-session=a') === 2, 'destroy must cancel pending retries');
    print('PASS: HTTP errors retain visibly stale data; disposal cancels retries');

    const auth = client('auth', '/auth');
    const format = client('format', '/format');
    const missing = client('');
    auth.instance.refresh();
    format.instance.refresh();
    missing.instance.refresh();
    await until(() => auth.updates.length && format.updates.length, 'auth and page errors');
    assert(auth.instance.error === 'auth' && !redirected, 'credentials must not follow redirects');
    assert(format.instance.error === 'format', 'login HTML is not valid usage');
    assert(missing.instance.error === 'cookie', 'missing cookie is actionable');
    assert(!requests.has('/settings:null'), 'missing cookie must not make a request');
    print('PASS: redirect, invalid-page and missing-cookie handling');

    const slow = client('slow', '/slow');
    slow.instance.refresh();
    slow.instance.refresh();
    await until(() => slow.updates.length, 'slow request');
    assert(requests.get('/slow:__Secure-session=slow') === 1, 'overlapping refresh must coalesce');
    const removed = client('removed', '/slow');
    removed.instance.refresh();
    await until(() => requests.has('/slow:__Secure-session=removed'), 'request before removing account');
    const pendingRequest = removed.instance._request;
    const pendingWatchdog = pendingRequest.watchdog;
    assert(context.find_source_by_id(pendingWatchdog), 'pending request must have a watchdog');
    removed.instance.destroy();
    removed.instance.destroy();
    removed.instance.refresh();
    assert(!context.find_source_by_id(pendingWatchdog), 'destroy must immediately remove the watchdog source');
    assert(pendingRequest.watchdog === null && pendingRequest.cancellable.is_cancelled(), 'destroy must clear and cancel the request');
    clients.splice(clients.indexOf(removed.instance), 1);
    await sleep(500);
    assert(removed.updates.length === 0, 'late callbacks must not update a removed account');
    assert(requests.get('/slow:__Secure-session=removed') === 1, 'refresh after destroy must do nothing');
    print('PASS: slow requests survive polling; removed accounts ignore late callbacks');

    const replaced = client('replaced', '/slow');
    replaced.instance.refresh();
    await until(() => requests.has('/slow:__Secure-session=replaced'), 'request before replacement');
    const firstRequest = replaced.instance._request;
    const firstWatchdog = firstRequest.watchdog;
    replaced.instance._fetch(3);
    assert(!context.find_source_by_id(firstWatchdog), 'replacing a request must remove its previous watchdog');
    assert(firstRequest.watchdog === null && firstRequest.cancellable.is_cancelled(), 'replacement must clear and cancel the old request');
    const replacementWatchdog = replaced.instance._request.watchdog;
    await until(() => requests.get('/slow:__Secure-session=replaced') === 2, 'replacement request');
    assert(context.find_source_by_id(replacementWatchdog), 'cancelled callbacks must not remove the new watchdog');
    await until(() => replaced.updates.length, 'replacement response');
    assert(replaced.updates.length === 1 && replaced.instance.error === null, 'only the replacement request may publish an update');
    assert(!context.find_source_by_id(replacementWatchdog), 'completed request must remove its watchdog');
    print('PASS: replacing requests removes old watchdogs without affecting the new request');

    const watchdog = client('watchdog', '/watchdog', {watchdogSeconds: 1});
    watchdog.instance.refresh();
    await until(() => watchdog.instance.data !== null, 'watchdog recovery');
    assert(watchdog.updates.length === 2 && watchdog.updates[0].error === 'network' && watchdog.instance.error === null,
        'watchdog failure must retry once and publish a fresh success');
    assert(requests.get('/watchdog:__Secure-session=watchdog') === 2, 'cancelled callbacks must not spawn duplicate retries');
    print('PASS: watchdog cancellation and recovery without duplicate requests');
}

const loop = new GLib.MainLoop(null, false);
let failed = false;
run().catch(error => {
    console.error(error);
    failed = true;
}).finally(() => {
    for (const instance of clients)
        instance.destroy();
    server.disconnect();
    loop.quit();
});
loop.run();
System.exit(failed ? 1 : 0);
