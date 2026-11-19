"""Screens for the Kiro part and the limits of the submission video (lines k1, k2b, k3b, k4, k5, c1).

Each screen shows real content of this repository, read from the files at build time: the spec, a correctness
property, the usage log, the steering file, a hook, the custom agent, a saved Kiro CLI review and an MCP
screenshot. No third-party logo or product name is drawn (video rule); tools are named by their Kiro role.
Fonts: Noto Sans and DejaVu Sans Mono (both free licences). Output: data/video/assets/kiro-*.png, limits-c1.png.

Usage (repository root): python tools/video/make_kiro_screens.py [--cli-review <saved kiro-cli output>]
"""
from __future__ import annotations

import argparse
import json
import re
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "video" / "assets"
W, H = 1920, 1080
SAFE_BOTTOM = 760  # two caption lines start about 780 px down (make_final.py MarginV), so panels end above
BG, PANEL, LINE, TEXT, MUTED, ORANGE, BLUE = (11, 18, 32), (18, 28, 51), (52, 66, 96), (235, 240, 248), (169, 184, 214), (255, 180, 84), (116, 212, 255)
SANS = "C:/Windows/Fonts/NotoSans-Regular.ttf"
SANS_BOLD = "C:/Windows/Fonts/NotoSans-Bold.ttf"


def mono_path() -> str:
    import matplotlib  # ships DejaVu Sans Mono (Bitstream Vera licence)
    return str(Path(matplotlib.__file__).parent / "mpl-data" / "fonts" / "ttf" / "DejaVuSansMono.ttf")


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def base(kicker: str, title: str, source: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((96, 54), kicker, font=font(SANS_BOLD, 30), fill=ORANGE)
    d.text((96, 96), title, font=font(SANS_BOLD, 52), fill=TEXT)
    d.text((96, H - 58), f"From the repository: {source}", font=font(SANS, 24), fill=MUTED)
    return img, d


def panel(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], heading: str, lines: list[str], size: int = 25,
          mono: bool = True, highlight: tuple[str, ...] = ()) -> None:
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=14, fill=PANEL, outline=LINE, width=2)
    d.text((x0 + 24, y0 + 16), heading, font=font(SANS_BOLD, 28), fill=BLUE)
    f = font(mono_path() if mono else SANS, size)
    y = y0 + 66
    max_w = x1 - x0 - 48

    def wrap(raw: str) -> list[str]:
        # wrap by measured pixel width, so proportional and monospaced text both fill the panel
        words, out, cur = raw.split(" "), [], ""
        for w in words:
            trial = w if not cur else f"{cur} {w}"
            if f.getlength(trial) <= max_w or not cur:
                cur = trial
            else:
                out.append(cur)
                cur = "  " + w
        out.append(cur)
        return out

    for raw in lines:
        for part in (wrap(raw) if raw else [""]):
            if y + size > y1 - 18:
                return
            colour = ORANGE if any(h in part for h in highlight) else TEXT
            d.text((x0 + 24, y), part, font=f, fill=colour)
            y += int(size * 1.42)


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def spec_counts() -> dict:
    tasks = read(".kiro/specs/cloud-dive/tasks.md")
    req = read(".kiro/specs/cloud-dive/requirements.md")
    design = read(".kiro/specs/cloud-dive/design.md")
    done = len(re.findall(r"^\s*- \[x\] \d+\.\d+", tasks, re.M))
    total = len(re.findall(r"^\s*- \[[ x]\] \d+\.\d+", tasks, re.M))
    groups = len(re.findall(r"^- \[[ x]\] \d+\. ", tasks, re.M))
    reqs = len(re.findall(r"^### R\d+ ", req, re.M))
    decisions = len(re.findall(r"^\| G\d+ \|", req, re.M))
    props = max(int(n) for n in re.findall(r"CD-P(\d+)", design))
    return dict(done=done, total=total, groups=groups, reqs=reqs, decisions=decisions, props=props)


def k1() -> Image.Image:
    c = spec_counts()
    img, d = base("KIRO  ·  SPEC-DRIVEN DEVELOPMENT", "One spec for the whole game", ".kiro/specs/cloud-dive/")
    panel(d, (96, 200, 820, SAFE_BOTTOM), ".kiro/specs/cloud-dive/", [
        "requirements.md", f"  {c['reqs']} requirement groups (R1 to R{c['reqs']})", f"  {c['decisions']} recorded decisions",
        "", "design.md", f"  {c['props']} correctness properties", "", "tasks.md",
        f"  {c['done']} of {c['total']} sub-tasks done", f"  {c['groups']} groups, dependency waves"], size=28)
    tasks = read(".kiro/specs/cloud-dive/tasks.md")
    m = re.search(r"^- \[[ x]\] 25\. .*?(?=^- \[[ x]\] 23\.4)", tasks, re.M | re.S)
    lines = [l.rstrip() for l in (m.group(0) if m else "").splitlines() if l.strip() and not l.strip().startswith("- _")][:12]
    panel(d, (860, 200, 1824, SAFE_BOTTOM), "tasks.md  (group 25, revision f)", lines, size=23, highlight=("[x]",))
    return img


def k2b() -> Image.Image:
    img, d = base("KIRO  ·  CORRECTNESS PROPERTIES", "Stating a property exposed gaps in our rules",
                  ".kiro/specs/cloud-dive/design.md, docs/kiro-usage-log.md")
    design = read(".kiro/specs/cloud-dive/design.md")
    row = next(l for l in design.splitlines() if l.startswith("| CD-P14 |"))
    cells = [x.strip() for x in row.strip("|").split("|")]
    panel(d, (96, 200, 1824, 420), "design.md, property CD-P14", [f"{cells[0]}: {cells[1]}  ({cells[2]})"], size=27, mono=False)
    log = read("docs/kiro-usage-log.md")
    gap_row = next(l for l in log.splitlines() if "exposed three gaps" in l)
    gaps = gap_row.split("exposed three gaps, now fixed in the spec:")[1].split("|")[0].strip().rstrip(".")
    items = [g.strip() for g in re.split(r";\s*(?:and\s+)?", gaps) if g.strip()]
    panel(d, (96, 450, 1824, SAFE_BOTTOM), "usage log, 2026-11-13: turning the evidence table into code exposed three gaps",
          [f"{i + 1}. {g}" for i, g in enumerate(items)], size=27, mono=False)
    return img


def k3b() -> Image.Image:
    img, d = base("KIRO  ·  STEERING AND HOOKS", "The wording rules load with the code, and a hook tests them",
                  ".kiro/steering/science-guardrails.md, .kiro/hooks/wording-on-cloud-dive-save.json")
    g = read(".kiro/steering/science-guardrails.md").splitlines()
    i = next(n for n, l in enumerate(g) if l.startswith("## Evidence levels"))
    levels = [l for l in g[i:i + 12] if l.startswith("- `")][:4]
    levels = [re.sub(r"\s*\(rule.*", "", l) for l in levels]
    rule = next(l for l in g if "It must never be converted" in l or "must never be converted" in l)
    panel(d, (96, 200, 940, SAFE_BOTTOM), "steering: science-guardrails.md", ["## Evidence levels", "The only four levels are:"] + levels +
          ["", "`Not assessed` ... " + rule.strip()], size=24, highlight=("never",))
    hook = json.loads(read(".kiro/hooks/wording-on-cloud-dive-save.json"))["hooks"][0]
    cmd = re.sub(r"^.*python(\.exe)?", "python", hook["action"]["command"])
    panel(d, (980, 200, 1824, SAFE_BOTTOM), "hook: wording-on-cloud-dive-save.json",
          [f'"name": "{hook["name"]}"', f'"trigger": "{hook["trigger"]}"', '"matcher": "static/cloud-dive/"',
           f'"command": "{cmd}"'], size=24, highlight=("PostFileSave",))
    return img


def k4(cli_review: Path | None) -> Image.Image:
    img, d = base("KIRO  ·  CUSTOM AGENT IN THE IDE AND THE CLI", "A read-only agent reviews every script line",
                  ".kiro/agents/wording-guardian.md, .kiro/agents/wording-guardian-cli.json")
    agent = json.loads(read(".kiro/agents/wording-guardian-cli.json"))
    panel(d, (96, 200, 900, SAFE_BOTTOM), "wording-guardian-cli.json", [
        f'"name": "{agent["name"]}"', f'"prompt": "{agent["prompt"]}"', f'"tools": {json.dumps(agent["tools"])}',
        "", "$ kiro-cli chat --no-interactive \\", "    --agent wording-guardian-cli \\", "    --trust-tools=fs_read \\",
        '    "Review revision f text ..."'], size=24, highlight=("kiro-cli",))
    out = []
    if cli_review and cli_review.exists():
        for l in cli_review.read_text(encoding="utf-8", errors="replace").splitlines():
            l = l.strip().replace("**", "")
            if not l or l.startswith("[tool]") or l.startswith("|"):
                continue
            out.append(l)
            if len(out) >= 6:
                break
    panel(d, (940, 200, 1824, SAFE_BOTTOM), "Kiro CLI output (2026-11-18)", out or ["(saved review not found)"], size=22,
          mono=False, highlight=("PASS",))
    return img


def k5(mcp_png: Path | None) -> Image.Image:
    img, d = base("KIRO  ·  MCP AND A POWER", "Browser tools found phone layout bugs",
                  "docs/kiro-usage-log.md (2026-11-17, 2026-11-18)")
    if mcp_png and mcp_png.exists():
        shot = Image.open(mcp_png).convert("RGB")
        h = SAFE_BOTTOM - 200
        shot = shot.resize((int(shot.width * h / shot.height), h))
        img.paste(shot, (120, 200))
        d.rectangle((120, 200, 120 + shot.width, 200 + h), outline=LINE, width=2)
        d.text((120, 200 + h + 8), "MCP screenshot, 390 x 844", font=font(SANS, 22), fill=MUTED)
        x = 120 + shot.width + 60
    else:
        x = 120
    panel(d, (x, 200, 1824, 500), "MCP browser server (390 x 844)", [
        "Gate buttons sat below the fold on a phone.", "Fix: phone layout and one scroll per gate (revision e)."], size=28, mono=False)
    panel(d, (x, 530, 1824, SAFE_BOTTOM), "Kiro power: a real phone", [
        "Viewport 697 px tall. After the climb, Continue sat 6 px below the fold.",
        "Fix in gate-panel.js; a second device session passed."], size=28, mono=False)
    return img


def c1() -> Image.Image:
    img, d = base("LIMITS", "What the game does not claim", "README.md (Cloud Dive, Limits)")
    readme = read("README.md").splitlines()
    i = next(n for n, l in enumerate(readme) if l.strip() == "Limits:")
    items, cur = [], ""
    for l in readme[i + 1:]:
        if l.startswith("- "):
            if cur:
                items.append(cur)
            cur = l[2:].strip()
        elif l.startswith("  ") and cur:
            cur += " " + l.strip()
        elif l.strip() == "" and cur:
            items.append(cur); cur = ""
            if len(items) >= 3:
                break
    if cur:
        items.append(cur)
    items = ["Game model. Not a flight procedure, not an icing severity."] + items[:3] + [
        "Costs are illustrative. The ice index is a game state, not an icing model.",
        "Frame rate measured on one desktop PC."]
    panel(d, (96, 200, 1824, SAFE_BOTTOM), "Limits", [f"- {x}" for x in items], size=29, mono=False)
    return img


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cli-review", type=Path, help="saved kiro-cli output to quote on the k4 screen")
    ap.add_argument("--mcp", type=Path, default=ROOT / "data" / "mcp-playwright" / "r24-gate1-390x844-d.png")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    screens = {"kiro-k1": k1(), "kiro-k2b": k2b(), "kiro-k3b": k3b(), "kiro-k4": k4(args.cli_review),
               "kiro-k5": k5(args.mcp), "limits-c1": c1()}
    for name, img in screens.items():
        img.save(OUT / f"{name}.png")
    print("wrote", ", ".join(f"{n}.png" for n in screens), "in", OUT.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
