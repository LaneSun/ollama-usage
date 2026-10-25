export const PRIMARY_ACCOUNT = 'primary';

export function normalizeCookie(value) {
    let cookie = value.trim();
    if (cookie.startsWith('__Secure-session='))
        cookie = cookie.slice('__Secure-session='.length).trim();
    if (cookie.startsWith('"') && cookie.endsWith('"'))
        cookie = cookie.slice(1, -1);
    // Reject extra cookies and header injection.
    return /^[\x21-\x7e]+$/.test(cookie) && !/[";,\\]/.test(cookie) ? cookie : '';
}

export function additionalAccounts(entries) {
    const ids = new Set([PRIMARY_ACCOUNT]);
    return entries.filter(entry => {
        if (!Array.isArray(entry) || entry.length !== 3 || entry.some(value => typeof value !== 'string'))
            return false;
        const [id] = entry;
        if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id))
            return false;
        ids.add(id);
        return true;
    }).map(([id, name, cookie]) => ({id, name: name.trim(), cookie}));
}
