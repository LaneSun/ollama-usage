import Secret from 'gi://Secret';

// DONT_MATCH_NAME lets entries stored with `secret-tool store` be found.
const SCHEMA = Secret.Schema.new(
    'com.anlbrain.ollama-usage',
    Secret.SchemaFlags.DONT_MATCH_NAME,
    {account: Secret.SchemaAttributeType.STRING}
);

// The sync API blocks the main loop and deadlocks on the unlock prompt.
export function lookupKey(account) {
    return new Promise(resolve => {
        Secret.password_lookup(SCHEMA, {account}, null, (source, result) => {
            try {
                resolve(Secret.password_lookup_finish(result) ?? '');
            } catch {
                resolve('');
            }
        });
    });
}

export function storeKey(account, key) {
    return new Promise((resolve, reject) => {
        const done = (source, result) => {
            try {
                if (key)
                    Secret.password_store_finish(result);
                else
                    Secret.password_clear_finish(result);
                resolve();
            } catch (error) {
                reject(error);
            }
        };
        if (key)
            Secret.password_store(SCHEMA, {account}, Secret.COLLECTION_DEFAULT, 'ollama.com API key', key, null, done);
        else
            Secret.password_clear(SCHEMA, {account}, null, done);
    });
}
