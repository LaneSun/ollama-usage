const round = value => Math.round(value * 100) / 100;
const seconds = iso => Math.floor(Date.parse(iso) / 1000) || 0;

// Maps GET /api/balance onto the shape the panel already renders.
export function parseBalance(json) {
    const included = json?.included;
    if (!included)
        return null;
    const data = {
        found: true, creditsCurrency: '$', weekly: 0, fiveHour: 0, hasSession: false,
        purchased: json.purchased?.balance_usd ?? 0, models: [],
    };
    if (included.session || included.weekly) {
        data.hasSession = !!included.session;
        data.fiveHour = 1 - (included.session?.remaining_percent ?? 100) / 100;
        data.sessionResetTs = seconds(included.session?.resets_at);
        data.weekly = 1 - (included.weekly?.remaining_percent ?? 100) / 100;
        data.weeklyResetTs = seconds(included.weekly?.resets_at);
        return data;
    }
    data.creditsTotal = included.allowance_usd;
    data.creditsRemaining = included.balance_usd;
    data.creditsUsed = Math.max(0, round(included.allowance_usd - included.balance_usd));
    data.weekly = included.allowance_usd > 0 ? Math.min(1, data.creditsUsed / included.allowance_usd) : 0;
    data.weeklyResetTs = seconds(included.period?.until);
    return data;
}

// Maps GET /api/usage?group_by=model; widthPct is each model's cost share.
export function parseUsage(json) {
    const totals = json?.totals;
    if (!totals)
        return null;
    const groups = totals.groups ?? [];
    const cost = groups.reduce((sum, group) => sum + (group.usage_usd ?? 0), 0);
    const models = groups.map(group => ({
        name: group.model,
        requests: group.request_count,
        usd: group.usage_usd ?? 0,
        tokens: (group.input_tokens ?? 0) + (group.output_tokens ?? 0),
        widthPct: cost ? (group.usage_usd ?? 0) / cost * 100 : 0,
    }));
    return {models, totals, buckets: json.buckets ?? []};
}
