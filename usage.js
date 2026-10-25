const NUMBER = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const CREDITS = new RegExp(`^Monthly credits used:\\s*\\$(${NUMBER})\\s*of\\s*\\$(${NUMBER})$`, 'i');
const PERCENT = /^(Session|Weekly) usage\s+(\d+(?:\.\d+)?)%\s*used$/i;
const TAG = /<[a-z][a-z\d:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;

export function emptyUsage() {
    return {
        weekly: 0, fiveHour: 0, timeFraction: 0,
        sessionResetTs: null, weeklyResetTs: null, models: [],
        found: false, hasSession: true, planType: null,
        creditsTotal: null, creditsUsed: null, creditsCurrency: '$',
    };
}

export function clampFraction(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0;
}

function decodeEntities(value) {
    const named = {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' '};
    return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code) => {
        if (code[0] !== '#')
            return named[code.toLowerCase()];
        const point = code[1].toLowerCase() === 'x'
            ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
}

function attribute(tag, name) {
    const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
    return match ? decodeEntities(match[1] ?? match[2]) : null;
}

function timestamp(block) {
    for (const tag of block.matchAll(TAG)) {
        const value = attribute(tag[0], 'data-time');
        if (!value)
            continue;
        const ts = Date.parse(value) / 1000;
        if (Number.isFinite(ts))
            return ts;
    }
    return null;
}

function segments(block) {
    const byName = new Map();
    for (const match of block.matchAll(TAG)) {
        const tag = match[0];
        if (!/^<button\b/i.test(tag) || !/\sdata-usage-segment(?:\s|=|>)/i.test(tag))
            continue;
        const name = attribute(tag, 'data-model');
        const count = attribute(tag, 'data-requests');
        const width = attribute(tag, 'style')?.match(/(?:^|;)\s*width:\s*(\d+(?:\.\d+)?)%/i);
        if (!name || !count || !/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(count) || !width)
            continue;
        const requests = Number(count.replace(/,/g, ''));
        const widthPct = Number(width[1]);
        if (!Number.isSafeInteger(requests) || !Number.isFinite(widthPct) || widthPct <= 0)
            continue;
        const entry = byName.get(name) ?? {name, requests: 0, widthPct: 0};
        entry.requests += requests;
        entry.widthPct += widthPct;
        byName.set(name, entry);
    }
    return [...byName.values()];
}

export function parseUsage(html) {
    const data = emptyUsage();
    const meters = [];
    const boundaries = [];
    for (const match of html.matchAll(TAG)) {
        if (/\sdata-usage-meter(?:\s|=|>)/i.test(match[0]))
            boundaries.push(match.index);
        const label = attribute(match[0], 'aria-label')?.trim();
        if (label && (/^Monthly credits used:/i.test(label) || PERCENT.test(label)))
            meters.push({index: match.index, label});
    }

    function blockFor(meter) {
        const previousMeter = meters.filter(other => other.index < meter.index).at(-1)?.index ?? -1;
        const previous = boundaries.filter(index => index <= meter.index && index > previousMeter).at(-1);
        const nextBoundary = boundaries.find(index => index > meter.index) ?? html.length;
        const nextMeter = meters.find(other => other.index > meter.index)?.index ?? html.length;
        return html.slice(previous ?? meter.index, Math.min(nextBoundary, nextMeter));
    }

    for (const meter of meters) {
        const match = meter.label.match(CREDITS);
        if (!match)
            continue;
        const used = Number(match[1].replace(/,/g, ''));
        const total = Number(match[2].replace(/,/g, ''));
        if (!Number.isFinite(used) || !Number.isFinite(total))
            continue;
        data.creditsUsed = used;
        data.creditsTotal = total;
        // Only the drawing clamps overages; chart calculations use actual usage.
        data.weekly = total > 0 ? used / total : 0;
        data.hasSession = false;
        data.found = true;
        const plan = html.match(/Usage credits\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/i);
        if (plan) {
            const name = decodeEntities(plan[1]).trim();
            data.planType = name.charAt(0).toUpperCase() + name.slice(1);
        }
        const refill = html.match(/Refills to \$[\d,.]+ on ([A-Za-z]+ \d{1,2},?\s*\d{4})/i);
        if (refill) {
            const ts = Date.parse(refill[1]) / 1000;
            if (Number.isFinite(ts))
                data.weeklyResetTs = ts;
        }
        data.models = segments(blockFor(meter));
        return data;
    }

    for (const meter of meters) {
        const match = meter.label.match(PERCENT);
        if (!match)
            continue;
        const fraction = Number(match[2]) / 100;
        if (!Number.isFinite(fraction))
            continue;
        const block = blockFor(meter);
        data.found = true;
        if (match[1].toLowerCase() === 'session') {
            data.fiveHour = fraction;
            data.sessionResetTs = timestamp(block);
        } else {
            data.weekly = fraction;
            data.weeklyResetTs = timestamp(block);
            data.models = segments(block);
        }
    }
    return data;
}
