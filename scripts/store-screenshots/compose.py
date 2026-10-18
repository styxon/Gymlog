"""App Store screenshots from the raw simulator shots.

    python scripts/store-screenshots/compose.py <raw-dir> <out-dir>

<raw-dir> is what shoot.sh writes: <device>/<language>-<theme>/NN-name.png.
Every shot named in captions.json becomes a store image: the caption on the
theme's own ground (Manrope ExtraBold, one word in violet, a gold PRO pill on
a Pro feature) above the screen shown whole, never cut by the edge (the
owner's rule, 2026-09-30). The look is the Android set's (storeshots.py).

Written at exactly the sizes App Store Connect takes:
  6.9"  1320 x 2868  from the iPhone 17 Pro Max shots
  6.5"  1284 x 2778  from the same shots (the size the 1.1.0 listing uses)
  6.3"  1206 x 2622  from the iPhone 17 shots
as <out-dir>/<size>/<language>/<theme>/NN-name.png, and one header image per
language and theme, 3840 x 1646, at <out-dir>/header/.

Needs Pillow. Paths in, nothing read from anywhere else but the repo's font.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FONT = os.path.join(ROOT, "assets", "fonts", "Manrope-ExtraBold.ttf")
CAPTIONS = os.path.join(os.path.dirname(__file__), "captions.json")

# Store size -> (width, height, raw device folder)
TARGETS = {
    "6.9": (1320, 2868, "iphone-6.9"),
    "6.5": (1284, 2778, "iphone-6.9"),
    "6.3": (1206, 2622, "iphone-6.3"),
}
HEADER = (3840, 1646)

THEMES = {
    "light": dict(bg=(239, 234, 249), glow=(255, 255, 255), ink=(23, 19, 31), accent=(109, 40, 217), ring=(205, 190, 230), shadow=70),
    "dark": dict(bg=(13, 10, 32), glow=(42, 30, 78), ink=(244, 241, 255), accent=(155, 109, 255), ring=(60, 50, 95), shadow=200),
}
GOLD, GOLD_INK = (228, 177, 76), (42, 27, 5)


def ground(theme, size):
    w, h = size
    t = THEMES[theme]
    im = Image.new("RGB", size, t["bg"])
    glow = Image.new("L", size, 0)
    # The glow sits over the caption, sized to the width like the Android set.
    s = w / 1080
    ImageDraw.Draw(glow).ellipse((-200 * s, -520 * s, w + 200 * s, 820 * s), fill=150 if theme == "dark" else 120)
    glow = glow.filter(ImageFilter.GaussianBlur(160 * s))
    im.paste(t["glow"], (0, 0), glow)
    return im


def wrap(draw, text, font, max_w):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= max_w or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def bare(word):
    return word.strip(",.!?:;")


def caption(im, theme, text, accent, pro, box):
    """Draws the caption centred in box = (left, top, width); returns its bottom."""
    left, top, width = box
    s = im.width / 1080
    t = THEMES[theme]
    d = ImageDraw.Draw(im)
    size = round(86 * s)
    font = ImageFont.truetype(FONT, size)
    y = top
    if pro:
        pill_font = ImageFont.truetype(FONT, round(34 * s))
        pw = d.textlength("PRO", font=pill_font) + 44 * s
        cx = left + width / 2
        d.rounded_rectangle((cx - pw / 2, y, cx + pw / 2, y + 58 * s), 29 * s, fill=GOLD)
        d.text((cx, y + 29 * s), "PRO", font=pill_font, fill=GOLD_INK, anchor="mm")
        y += round(90 * s)
    for line in wrap(d, text, font, width - 180 * s):
        # Word by word, so the chosen word can carry the accent.
        words = line.split()
        x = left + (width - d.textlength(line, font=font)) / 2
        for i, word in enumerate(words):
            piece = word + (" " if i < len(words) - 1 else "")
            colour = t["accent"] if bare(word) == bare(accent) else t["ink"]
            d.text((x, y), piece, font=font, fill=colour)
            x += d.textlength(piece, font=font)
        y += int(size * 1.18)
    return y


def phone(im, theme, shot, x, y, width, radius):
    t = THEMES[theme]
    x, y = int(x), int(y)  # paste takes whole pixels; the caption's height may not be
    src = Image.open(shot).convert("RGB")
    h = round(src.height * width / src.width)
    src = src.resize((width, h), Image.LANCZOS)
    mask = Image.new("L", src.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, h - 1), radius, fill=255)
    pad = round(radius * 1.6)
    shadow = Image.new("L", (width + 2 * pad, h + 2 * pad), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((pad, pad + pad // 3, pad + width, pad + h + pad // 3), radius, fill=t["shadow"])
    im.paste((0, 0, 0), (x - pad, y - pad), shadow.filter(ImageFilter.GaussianBlur(pad // 2)))
    im.paste(src, (x, y), mask)
    ring = Image.new("L", src.size, 0)
    ImageDraw.Draw(ring).rounded_rectangle((0, 0, width - 1, h - 1), radius, outline=255, width=max(2, width // 260))
    im.paste(t["ring"], (x, y), ring)
    return h


def fit_width(shot, room_h, max_w):
    """The widest the screen can be with all of it inside room_h."""
    with Image.open(shot) as src:
        return min(max_w, int(room_h * src.width / src.height))


def store_image(size, theme, shot, text, accent, pro):
    w, h = size
    s = w / 1080
    im = ground(theme, size)
    bottom = caption(im, theme, text, accent, pro, (0, round(150 * s), w))
    top = bottom + round(60 * s)
    foot = round(90 * s)  # room under the screen for its shadow
    width = fit_width(shot, h - top - foot, round(800 * s))
    phone(im, theme, shot, (w - width) // 2, top, width, radius=round(58 * s))
    return im


def header_image(theme, shots, text, accent):
    w, h = HEADER
    im = ground(theme, HEADER)
    # The caption on the left third, the three screens on the right.
    text_w = round(w * 0.36)
    s = h / 1920
    font_size = round(86 * s * 1.5)
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(FONT, font_size)
    lines = wrap(d, text, font, text_w - 120)
    block = len(lines) * int(font_size * 1.18)
    y = (h - block) // 2
    t = THEMES[theme]
    for line in lines:
        x = 160
        for i, word in enumerate(line.split()):
            piece = word + (" " if i < len(line.split()) - 1 else "")
            d.text((x, y), piece, font=font, fill=t["accent"] if bare(word) == bare(accent) else t["ink"])
            x += d.textlength(piece, font=font)
        y += int(font_size * 1.18)
    margin = round(h * 0.08)
    gap = round(w * 0.025)
    room_w = w - text_w - 160
    width = min(fit_width(shots[0], h - 2 * margin, 10_000), (room_w - 2 * gap) // 3)
    x = text_w + (room_w - (3 * width + 2 * gap)) // 2
    for i, shot in enumerate(shots):
        with Image.open(shot) as src:
            ph = round(src.height * width / src.width)
        phone(im, theme, shot, x + i * (width + gap), (h - ph) // 2, width, radius=round(width * 0.075))
    return im


def theme_of_shot(path):
    """'dark' or 'light' by the screen's own ground: the mean of a thin strip
    at the left edge, inside the page margin where no card reaches."""
    with Image.open(path) as src:
        g = src.convert("L")
        strip = g.crop((0, g.height // 8, max(4, g.width // 60), g.height // 8 + g.height // 4))
        mean = ImageStat.Stat(strip).mean[0]
    return "dark" if mean < 110 else "light"


def main(raw, out):
    with open(CAPTIONS, encoding="utf-8") as f:
        captions = json.load(f)
    written = 0
    missing = set()
    mismatched = set()
    for size_name, (w, h, device) in TARGETS.items():
        device_dir = os.path.join(raw, device)
        if not os.path.isdir(device_dir):
            continue
        for variant in sorted(os.listdir(device_dir)):
            if "-" not in variant:
                continue
            language, theme = variant.split("-", 1)
            if theme not in THEMES:
                continue
            for index, entry in enumerate(captions["shots"], start=1):
                shot = os.path.join(device_dir, variant, entry["shot"] + ".png")
                if not os.path.isfile(shot):
                    missing.add(os.path.relpath(shot, raw))
                    continue
                # The theme reaches the app as a launch argument; one that was
                # lost leaves every "light" run dark, filed under light.
                seen = theme_of_shot(shot)
                if seen != theme:
                    mismatched.add(f"{os.path.relpath(shot, raw)} looks {seen}")
                words = entry[language]
                im = store_image((w, h), theme, shot, words["text"], words["accent"], entry.get("pro", False))
                assert im.size == (w, h), im.size
                dest = os.path.join(out, size_name, language, theme)
                os.makedirs(dest, exist_ok=True)
                im.save(os.path.join(dest, f"{index:02d}-{entry['shot'][3:]}.png"), optimize=True)
                written += 1
            if size_name == "6.9":
                head = captions["header"]
                shots = [os.path.join(device_dir, variant, name + ".png") for name in head["shots"]]
                if all(os.path.isfile(p) for p in shots):
                    words = head[language]
                    im = header_image(theme, shots, words["text"], words["accent"])
                    dest = os.path.join(out, "header")
                    os.makedirs(dest, exist_ok=True)
                    im.save(os.path.join(dest, f"header-{language}-{theme}-3840x1646.png"), optimize=True)
                    written += 1
    for path in sorted(missing):
        print(f"missing raw shot: {path}")
    for line in sorted(mismatched):
        print(f"wrong theme: {line}")
    print(f"wrote {written} images to {out}")
    return 0 if written > 0 and not mismatched else 1


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
