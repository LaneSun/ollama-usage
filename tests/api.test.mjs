import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBalance, parseUsage} from '../api.js';

test('parseBalance maps the current plan', () => {
    const d = parseBalance({
        included: {balance_usd: 12.5, allowance_usd: 50, period: {from: '2026-11-01T00:00:00Z', until: '2026-12-01T00:00:00Z'}},
        purchased: {balance_usd: 3},
    });
    assert.equal(d.creditsTotal, 50);
    assert.equal(d.creditsRemaining, 12.5);
    assert.equal(d.creditsUsed, 37.5);
    assert.equal(d.weekly, 0.75);
    assert.equal(d.purchased, 3);
    assert.equal(d.weeklyResetTs, Date.parse('2026-12-01T00:00:00Z') / 1000);
});

test('parseBalance maps legacy session/weekly percentages', () => {
    const d = parseBalance({
        included: {session: {remaining_percent: 80, resets_at: '2026-11-11T15:00:00Z'}, weekly: {remaining_percent: 40, resets_at: '2026-11-15T00:00:00Z'}},
        purchased: {balance_usd: 0},
    });
    assert.equal(d.hasSession, true);
    assert.ok(Math.abs(d.fiveHour - 0.2) < 1e-9);
    assert.ok(Math.abs(d.weekly - 0.6) < 1e-9);
});

test('parseBalance rejects unexpected payloads', () => {
    assert.equal(parseBalance({}), null);
    assert.equal(parseBalance(null), null);
});

test('parseUsage maps per-model groups and cost share', () => {
    const d = parseUsage({
        totals: {request_count: 3, usage_usd: 4, input_tokens: 10, cached_input_tokens: 5, output_tokens: 2, groups: [
            {model: 'a', request_count: 2, usage_usd: 3, input_tokens: 6, output_tokens: 1},
            {model: 'remainder', request_count: 1, usage_usd: 1, input_tokens: 4, output_tokens: 1},
        ]},
        buckets: [{request_count: 3, usage_usd: 4}],
    });
    assert.equal(d.models[0].name, 'a');
    assert.equal(d.models[0].tokens, 7);
    assert.equal(d.models[0].widthPct, 75);
    assert.equal(d.buckets.length, 1);
});

test('parseUsage handles legacy plans without groups', () => {
    const d = parseUsage({totals: {request_count: 5}});
    assert.deepEqual(d.models, []);
    assert.equal(parseUsage({}), null);
});

test('parseBalance rejects a credit payload without numbers', () => {
    assert.equal(parseBalance({included: {balance_usd: null, allowance_usd: 50}}), null);
    assert.equal(parseBalance({included: {}}), null);
});

test('parseBalance prefers credit fields over empty legacy objects', () => {
    const d = parseBalance({included: {session: {}, allowance_usd: 60, balance_usd: 20}});
    assert.equal(d.creditsTotal, 60);
    assert.equal(d.hasSession, false);
});
