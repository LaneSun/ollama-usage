# Ollama Cloud Indicator

A GNOME Shell extension that displays [Ollama Cloud](https://ollama.com) usage in the top panel. Supports multiple accounts, [monthly credit plans](https://ollama.com/blog/transparent-pricing), and legacy subscriptions on GNOME Shell 47–50.

## Usage display

For **monthly credit plans**, the circle shows the fraction of included credits consumed. The popup shows used and remaining included credits, the plan name, and the next refill date when available. These plans have no session ring or clock hand.

![Credit plan popup](screenshot-credits.png)

For **legacy subscriptions**, the outer ring shows session usage, the inner circle shows weekly usage, and the clock hand shows progress through the five-hour session. The popup includes percentages and reset countdowns.

![Legacy plan popup](screenshot.png)

Both formats include a model chart ranked by calls per 1% of usage. The chart is based on the model breakdown reported by Ollama, not a prediction of future cost.

## Installation

From source, with GNU Make, GLib development tools and gettext installed:

```bash
make install
```

This installs runtime files, compiled schemas and translations under `${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/ollama-usage@lanesun.anlbrain.com/`.

Alternatively, build and install a ZIP:

```bash
./package.sh
gnome-extensions install --force ollama-usage.zip
```

Log out and back in on Wayland, then enable the extension:

```bash
gnome-extensions enable ollama-usage@lanesun.anlbrain.com
```

The same `ollama-usage.zip` can be uploaded to GNOME Extensions. Packaging rebuilds translations and includes all runtime modules and the stylesheet; it excludes credentials, tests, repository metadata and compiled schemas. GNOME compiles the schema during installation.

## Accounts and cookies

1. Sign in to [Ollama settings](https://ollama.com/settings) in your browser.
2. Open developer tools, then **Application / Storage → Cookies → https://ollama.com**.
3. Copy the value of `__Secure-session`.
4. Open **Preferences** from the indicator menu, or run:

   ```bash
   gnome-extensions prefs ollama-usage@lanesun.anlbrain.com
   ```

5. Paste the value into the primary account's `__Secure-session` field and click its apply button. Fetching starts immediately.

To display another account, click **Add Account**, give it a name, and apply its own session cookie. Use a separate browser profile or sign into that account to obtain the correct cookie. Each account has an independent meter, refresh action, cache and error status. Names appear beside the meters when multiple accounts are configured. Additional accounts can be removed with the trash button.

Existing installations keep their original cookie as the primary account. Account names and cookies survive **Reset Appearance and Refresh Settings**. Cookie fields are hidden by default; their values are stored in your user GSettings, so treat your settings backups as sensitive.

## Appearance and refresh

Preferences provide ring, circle and hand colors and dimensions, panel position and index, and a refresh interval from 5 to 3,600 seconds (default: 60). Appearance settings apply to all accounts.

Each account requests `https://ollama.com/settings`. Transient network and HTTP failures retry three times with 1 / 2 / 4 second backoff. A stalled request is cancelled after 35 seconds. Polling does not interrupt an active request. Authentication redirects stop with a cookie error.

After a failed refresh, the last successful reading stays visible but is dimmed and explicitly marked stale. Changing a cookie clears the old reading. An empty or unrecognized page never appears as a successful 0% reading; genuine 0% usage is accepted.

Usage is parsed from Ollama's settings HTML, so website changes may require parser updates. Credit amounts refer to the monthly included pool; separately purchased balances are not inferred from that meter.

## Development

The extension has no npm dependencies. `make test` requires Node.js 22 or newer, GJS, libsoup 3, GLib tools and gettext.

```bash
make test
./package.sh
python3 tests/package.test.py
```

- `usage.js`: parsing and data validation for both pricing formats.
- `accounts.js`: account records and cookie normalization.
- `client.js`: per-account HTTP requests, cache and retry lifecycle.
- `extension.js`: panel drawing, menus and account orchestration.
- `prefs.js`: account management and appearance settings.

Tests use synthetic HTML and a local HTTP server, with no real credentials or requests to Ollama. GitHub Actions runs the same parser, account, request-lifecycle and archive checks.

## License

MIT
