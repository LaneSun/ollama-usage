import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {clampFraction, parseUsage} from '../usage.js';
import {additionalAccounts, normalizeCookie} from '../accounts.js';

const fixture = name => readFileSync(new URL(`fixtures/${name}.html`, import.meta.url), 'utf8');

test('legacy session and weekly meters have separate resets and model totals', () => {
    const data = parseUsage(fixture('legacy'));
    assert.equal(data.found, true);
    assert.equal(data.hasSession, true);
    assert.equal(data.fiveHour, 0.4);
    assert.equal(data.weekly, 0.5);
    assert.equal(data.sessionResetTs, Date.parse('2026-11-01T05:00:00Z') / 1000);
    assert.equal(data.weeklyResetTs, Date.parse('2026-11-07T00:00:00Z') / 1000);
    assert.deepEqual(data.models, [
        {name: 'model-a', requests: 300, widthPct: 50},
        {name: 'model-b', requests: 1000, widthPct: 50},
    ]);
});

test('monthly credit plan reads amounts, plan, refill and breakdown', () => {
    const data = parseUsage(fixture('credits'));
    assert.equal(data.found, true);
    assert.equal(data.hasSession, false);
    assert.equal(data.creditsUsed, 2.33);
    assert.equal(data.creditsTotal, 60);
    assert.equal(data.planType, 'Pro');
    assert.equal(data.weekly, 2.33 / 60);
    assert.equal(data.weeklyResetTs, Date.parse('November 21, 2026') / 1000);
    assert.equal(data.models.length, 2);
});

test('credit meters take precedence on pages containing both formats', () => {
    const data = parseUsage(fixture('legacy') + fixture('credits'));
    assert.equal(data.creditsUsed, 2.33);
    assert.equal(data.models[0].requests, 50);
});

test('zero use is valid, including zero-credit plans', () => {
    for (const label of ['Weekly usage 0% used', 'Session usage 0% used', 'Monthly credits used: $0 of $0']) {
        const data = parseUsage(`<div aria-label="${label}"></div>`);
        assert.equal(data.found, true);
        assert.equal(data.weekly, 0);
    }
});

test('single-quoted, reordered attributes and HTML entities are supported', () => {
    const data = parseUsage(`<div aria-label='Monthly credits used: &#36;1,250.50 of $2,000' data-usage-meter>
      <button data-model='a&amp;b' style='color: red; width: 100%' data-usage-segment data-requests='1,234'></button></div>`);
    assert.equal(data.creditsUsed, 1250.5);
    assert.equal(data.creditsTotal, 2000);
    assert.deepEqual(data.models, [{name: 'a&b', requests: 1234, widthPct: 100}]);
});

test('overages remain accurate for efficiency calculations but drawings clamp', () => {
    const data = parseUsage('<div aria-label="Monthly credits used: $75 of $60"></div>');
    assert.equal(data.weekly, 1.25);
    assert.equal(clampFraction(data.weekly), 1);
    assert.equal(clampFraction(NaN), 0);
});

test('malformed numbers and login pages do not claim a successful fetch', () => {
    for (const label of ['Monthly credits used: $. of $60', 'Monthly credits used: $2 of $1,23',
        'Monthly credits used: $1..2 of $60', 'Weekly usage .% used', 'Session usage -10% used', 'Sign in']) {
        assert.equal(parseUsage(`<div aria-label="${label}"></div>`).found, false, label);
    }
});

test('a missing session reset never borrows the weekly reset', () => {
    const html = fixture('legacy').replace('<span data-time="2026-11-01T05:00:00Z"></span>', '');
    assert.equal(parseUsage(html).sessionResetTs, null);
    assert.equal(parseUsage(html.replace('2026-11-07T00:00:00Z', 'invalid')).weeklyResetTs, null);
});

test('meters sharing a wrapper still keep their model data and reset times separate', () => {
    const html = fixture('legacy').replace('<section data-usage-meter="weekly">', '<section>');
    const data = parseUsage(html);
    assert.equal(data.weeklyResetTs, Date.parse('2026-11-07T00:00:00Z') / 1000);
    assert.deepEqual(data.models.map(model => model.name), ['model-a', 'model-b']);
});

test('invalid segment counts do not poison valid model totals', () => {
    const data = parseUsage(`<div aria-label="Weekly usage 20% used">
      <button data-usage-segment data-model="bad" data-requests="NaN" style="width: 20%"></button>
      <button data-usage-segment data-model="good" data-requests="50" style="width: 80%"></button></div>`);
    assert.deepEqual(data.models, [{name: 'good', requests: 50, widthPct: 80}]);
});

test('cookie input accepts a copied name or quoted value and rejects headers', () => {
    assert.equal(normalizeCookie('  __Secure-session="token-value"  '), 'token-value');
    assert.equal(normalizeCookie('token-value'), 'token-value');
    for (const value of ['', 'token; other=x', 'token\r\nInjected: x', 'token value'])
        assert.equal(normalizeCookie(value), '');
});

test('additional account IDs are unique and never override the primary account', () => {
    assert.deepEqual(additionalAccounts([
        ['a', ' Work ', 'cookie-a'], ['b', 'Personal', 'cookie-b'],
        ['a', 'Duplicate', 'wrong'], ['primary', 'Override', 'wrong'], ['../invalid', '', 'wrong'],
    ]), [{id: 'a', name: 'Work', cookie: 'cookie-a'}, {id: 'b', name: 'Personal', cookie: 'cookie-b'}]);
});
