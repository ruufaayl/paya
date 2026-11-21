"""WCAG 2.2 contrast check for every text pairing in web/src/ds/tokens.css (both themes).

    python docs/revamp/tools/contrast_check.py  -> writes docs/revamp/contrast-report.md, exits 1 on a failure
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
css = (ROOT / "web/src/ds/tokens.css").read_text()


def theme(selector: str) -> dict:
    block = re.search(re.escape(selector) + r"\s*\{(.*?)\n\}", css, re.S).group(1)
    return {k: tuple(int(x) for x in v.split()) for k, v in re.findall(r"--([a-z0-9-]+):\s*(\d+ \d+ \d+);", block)}


def lum(rgb):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (c(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


# (foreground, background, minimum): 4.5 = normal text (AA), 3.0 = large text / UI components (AA)
PAIRS = [("fg", "canvas", 4.5), ("fg", "surface", 4.5), ("fg-2", "surface", 4.5), ("fg-2", "canvas", 4.5),
         ("fg-muted", "surface", 4.5), ("fg-muted", "canvas", 4.5), ("brand-fg", "brand", 4.5),
         ("brand-accent", "surface", 4.5), ("brand-accent", "canvas", 4.5), ("night-fg", "night", 4.5),
         ("focus", "surface", 3.0), ("focus", "canvas", 3.0), ("control-line", "surface", 3.0), ("control-line", "canvas", 3.0)]
for s in ("success", "processing", "review", "warning", "danger", "info", "neutral"):
    PAIRS += [(s, f"{s}-soft", 4.5), (s, "surface", 4.5)]

lines = ["# Colour contrast report (generated)", "",
         "WCAG 2.2 AA: 4.5:1 for normal text, 3:1 for large text and UI components. Source: `web/src/ds/tokens.css`.", ""]
failed = 0
for name, sel in (("Wallet (light)", '[data-theme="wallet"]'), ("Console (dark)", '[data-theme="console"]')):
    t = theme(sel)
    lines += [f"## {name}", "", "| Foreground | Background | Ratio | Needs | Result |", "|---|---|---|---|---|"]
    for fg, bg, need in PAIRS:
        r = ratio(t[fg], t[bg])
        ok = r >= need
        failed += not ok
        lines.append(f"| `{fg}` | `{bg}` | {r:.2f}:1 | {need}:1 | {'PASS' if ok else '**FAIL**'} |")
    lines.append("")
(ROOT / "docs/revamp/contrast-report.md").write_text("\n".join(lines))
print(f"{failed} failing pairs")
sys.exit(1 if failed else 0)
