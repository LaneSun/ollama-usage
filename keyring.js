import Secret from 'gi://Secret';

// DONT_MATCH_NAME lets entries stored with `secret-tool store` be found.
const SCHEMA = Secret.Schema.new(
    'com.anlbrain.ollama-usage',
    Secret.SchemaFlags.DONT_MATCH_NAME,
    {account: Secret.SchemaAttributeType.STRING}
);

export function lookupKey(account) {
    try {
        return Secret.password_lookup_sync(SCHEMA, {account}, null) ?? '';
    } catch {
        return '';
    }
}

export function storeKey(account, key) {
    if (!key)
        return Secret.password_clear_sync(SCHEMA, {account}, null);
    return Secret.password_store_sync(
        SCHEMA, {account}, Secret.COLLECTION_DEFAULT, "ollama.com API key", key, null);
}
