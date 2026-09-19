# Chrome Web Store assets

All files are **24-bit RGB PNG with no alpha channel**, at the exact dimensions
the store requires. Upload in numeric order.

## Screenshots — 1280 x 800 (store allows up to 5)

| # | File | Shows |
|---|---|---|
| 1 | `1-popup-1280x800.png` | Toolbar popup — provider, model, both presets, Keep my voice |
| 2 | `2-ask-better-presets-1280x800.png` | Ask Better presets — all four categories plus custom presets |
| 3 | `3-phrase-better-1280x800.png` | Phrase Better presets and the stackable adjustments |
| 4 | `4-reports-1280x800.png` | Local 30-day usage dashboard with the cost estimate |
| 5 | `5-models-1280x800.png` | Provider and model picker, key verified, live model list |

## Promo tiles

| File | Size |
|---|---|
| `promo-small-440x280.png` | 440 x 280 |
| `promo-marquee-1400x560.png` | 1400 x 560 |

## alternates/

Extra 1280x800 renders (`mode`, `history`) if you would rather swap one into a
screenshot slot — the store caps you at five.

## archive-2026-04/

The previous set, kept for reference. It predates the amber rebrand, the Manrope
type, and the grouped options sidebar.

## Regenerating

`render.sh` drives headless Chrome over the **real** `ui/popup.html` and
`ui/options.html` with a mock `chrome.*` API supplying realistic settings,
usage and history, then flattens every capture to alpha-free 24-bit PNG and
asserts the dimensions. It expects the staging directory built alongside it
(a copy of `ui/` + `assets/` with the mock and tile pages added), so re-run it
from that scratch directory rather than from here.

Re-shoot these whenever the UI theme or the options layout changes.
