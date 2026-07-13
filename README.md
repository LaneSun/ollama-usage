# Ollama Cloud Indicator

A GNOME Shell extension that displays your [Ollama Cloud](https://ollama.com) subscription usage as a compact circular indicator in the top panel.

![Screenshot](screenshot.png)

## Features

- **Outer Ring** — Session usage (5-hour rolling window)
- **Inner Circle** — Weekly usage
- **Clock Hand** — A pointer rotating around the ring, indicating how far through the current session window you are (0% at start → 100% at reset)
- **Popup Menu** — Click the indicator to see exact percentages with time-to-reset in parentheses (e.g. `Weekly: 95% (0d 21h)`), a horizontal bar chart ranking models by calls per 1% of weekly usage, and a manual refresh button
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
| Ring Color / Thickness / Gap | Outer ring appearance (session usage) |
| Circle Color / Radius | Inner circle appearance (weekly usage) |
| Hand Color / Length / Thickness | Clock hand appearance |
| Hand Outline Color / Width | Hand border for visibility |
| Panel Position | Left / Center / Right |
| Position Index | Sort order within the panel |
| Update Interval | Auto-refresh interval in seconds (default: 60) |

## Data Source

The extension sends an authenticated GET request to `https://ollama.com/settings` and parses the HTML for:

- `Session usage X% used` — session (5h) percentage
- `Weekly usage X% used` — weekly percentage
- `data-time="..."` — session reset timestamp (used for clock hand position)

If the fetch fails or returns no usage data, all indicators show 0% and the popup menu displays "Fetch failed — check cookie".

## License

MIT