# Ollama Cloud Indicator

A GNOME Shell extension that displays your [Ollama Cloud](https://ollama.com) subscription usage as a compact circular indicator in the top panel.

Ollama now bills most accounts through [credit-based pricing](https://ollama.com/blog/transparent-pricing); the extension supports that model as well as the older percentage-based subscriptions, auto-detected from your account.

## Credit-based plans

![Credit plan popup](screenshot-credits.png)

This is what most accounts see today. The panel icon is a single circle, filled according to the fraction of your monthly credits consumed — there's no outer ring or clock hand, since credit plans don't have a 5-hour session window to show.

| Element | Meaning |
|---------|---------|
| Circle fill | Monthly credits used, as a fraction of your plan's total |
| `Used: $2.33 / $60.00 (Pro)` | Credits consumed this month / plan total, and plan name |
| `Remaining: $57.67 (refills in 28d 13h)` | Credits left and countdown to the next monthly refill |
| `Calls per 1% usage` chart | Models ranked by number of calls per 1% of monthly credits they consumed |

## Legacy subscriptions (percentage-based)

![Legacy plan popup](screenshot.png)

| Element | Meaning |
|---------|---------|
| Outer ring | Session usage (5-hour rolling window) |
| Inner circle | Weekly usage |
| Clock hand | Rotates around the ring, showing how far through the current 5-hour session you are (top = just reset, full turn = next reset) |
| `Weekly: 95% (0d 21h)` | Weekly quota used, with time to reset |
| `Session: 40% (2h 15m)` | 5-hour session quota used, with time to reset |
| `Calls per 1% usage` chart | Models ranked by number of calls per 1% of weekly usage they consumed |

## Features

Both pricing models share:
- **Manual refresh button**
- **Auto Refresh** — Fetches data every 60 seconds (configurable)
- **Retry on Failure** — If the initial fetch fails, retries 3 times with 1s / 2s / 4s backoff

## Installation

```bash
make all
cp -r . ~/.local/share/gnome-shell/extensions/ollama-usage@lanesun.anlbrain.com/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/ollama-usage@lanesun.anlbrain.com/schemas/
```

Restart GNOME Shell (log out and back in on Wayland), then enable the extension:

```bash
gnome-extensions enable ollama-usage@lanesun.anlbrain.com
```

## Cookie Setup

The extension fetches usage data from `https://ollama.com/settings`, which requires authentication. You need to provide your `__Secure-session` cookie value.

### How to get the cookie

1. Log in to [ollama.com](https://ollama.com) in your browser
2. Navigate to **Settings** (`https://ollama.com/settings`)
3. Open browser DevTools (**F12** or **Ctrl+Shift+I**)
4. Go to **Application** → **Cookies** → `https://ollama.com`
5. Find the cookie named `__Secure-session`
6. Copy its **value** (the long string, not the name)

### Configure the extension

1. Open the extension settings (via **Extensions** app or `gnome-extensions prefs ollama-usage@lanesun.anlbrain.com`)
2. Under **Ollama Cloud**, paste the cookie value into the `__Secure-session` field
3. The indicator will fetch data immediately on next enable, and refresh every 60 seconds

> **Note:** Only paste the cookie **value** — do not include the cookie name or surrounding quotes. The extension wraps it automatically.

## Customization

All visual parameters are configurable in the settings:

| Setting | Description |
|---------|-------------|
| Ring Color / Thickness / Gap | Outer ring appearance (session usage, legacy plans only) |
| Circle Color / Radius | Inner circle appearance (weekly usage, or monthly credits used) |
| Hand Color / Length / Thickness | Clock hand appearance (legacy plans only) |
| Hand Outline Color / Width | Hand border for visibility (legacy plans only) |
| Panel Position | Left / Center / Right |
| Position Index | Sort order within the panel |
| Update Interval | Auto-refresh interval in seconds (default: 60) |

## Data Source

The extension sends an authenticated GET request to `https://ollama.com/settings` and parses the HTML. It tries the new credit-based format first, then falls back to the legacy percentage format if the credit markers aren't found.

### New credit-based plans
- The plan badge next to the "Usage credits" heading (e.g. `pro`)
- `aria-label="Monthly credits used: $X.XX of $Y.YY"` on the usage bar — the single source for both used and total credits
- `Refills to $Y.YY on <date>` from the balance tooltip — used for the refill countdown
- `data-model="..." data-requests="..."` segments inside the same usage bar — model breakdown

### Legacy percentage-based plans
- `Session usage X% used` — session (5h) percentage
- `Weekly usage X% used` — weekly percentage
- `data-time="..."` — session reset timestamp (used for clock hand position)
- `data-model="..." data-requests="..."` segments in the weekly usage bar — model breakdown

If the fetch fails or returns no usage data, all indicators show 0% and the popup menu displays "Fetch failed — check cookie".

## License

MIT