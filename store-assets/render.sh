#!/usr/bin/env bash
# Render every Chrome Web Store asset from the REAL extension UI (ui/popup.html
# and ui/options.html, driven by a mock chrome.* API), then flatten to 24-bit
# RGB PNG — the store rejects images with an alpha channel.
set -euo pipefail
SHOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$SHOT/out"
rm -rf "$OUT" && mkdir -p "$OUT/alternates"

shoot() { # name  width  height  url
  google-chrome --headless=new --disable-gpu --no-sandbox \
    --allow-file-access-from-files --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$2,$3" \
    --run-all-compositor-stages-before-draw \
    --disable-new-content-rendering-timeout \
    --default-background-color=ff0f0d0b \
    --virtual-time-budget=9000 \
    --screenshot="$OUT/$1.png" "$4" >/dev/null 2>&1
  [ -s "$OUT/$1.png" ] || { echo "FAILED: $1"; exit 1; }
}

U="file://$SHOT/ui"

# ── Screenshots: 1280x800, store allows max 5 ───────────────────────────────
shoot 1-popup-1280x800            1280 800 "$U/popup-frame.html"
shoot 2-ask-better-presets-1280x800 1280 800 "$U/options.html?zoom=0.8#ask-better-presets"
shoot 3-phrase-better-1280x800    1280 800 "$U/options.html#phrase-better-presets"
shoot 4-reports-1280x800          1280 800 "$U/options.html#reports"
shoot 5-models-1280x800           1280 800 "$U/options.html#models"

# ── Promo tiles ─────────────────────────────────────────────────────────────
shoot promo-small-440x280     440  280 "$U/tile-small.html"
shoot promo-marquee-1400x560 1400  560 "$U/tile-marquee.html"

# ── Alternates (swap into a slot if preferred) ──────────────────────────────
shoot alternates/mode-1280x800    1280 800 "$U/options.html#mode"
shoot alternates/history-1280x800 1280 800 "$U/options.html#history"

python3 - "$OUT" <<'PY'
import pathlib, sys
from PIL import Image

EXPECTED = {
    "1-popup-1280x800": (1280, 800),
    "2-ask-better-presets-1280x800": (1280, 800),
    "3-phrase-better-1280x800": (1280, 800),
    "4-reports-1280x800": (1280, 800),
    "5-models-1280x800": (1280, 800),
    "promo-small-440x280": (440, 280),
    "promo-marquee-1400x560": (1400, 560),
    "alternates/mode-1280x800": (1280, 800),
    "alternates/history-1280x800": (1280, 800),
}
out = pathlib.Path(sys.argv[1])
ok = True
for name, size in EXPECTED.items():
    p = out / f"{name}.png"
    im = Image.open(p)
    # Flatten onto the brand background, then drop alpha entirely.
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (15, 13, 11))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    if im.size != size:
        im = im.resize(size, Image.LANCZOS)
    im.save(p, "PNG", optimize=True)

    chk = Image.open(p)
    good = chk.mode == "RGB" and chk.size == size and chk.getbbox() is not None
    ok &= good
    print(f"{'ok  ' if good else 'BAD '} {name+'.png':40} {chk.size[0]}x{chk.size[1]}  "
          f"{chk.mode} (no alpha)  {p.stat().st_size//1024}KB")
sys.exit(0 if ok else 1)
PY
