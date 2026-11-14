"""Wording guardrails for the Cloud Dive UI and case files (R9.1, R9.2, R9.3).

Scope: user-facing text only.
  * index.html: text nodes and the attributes title, alt, aria-label, placeholder, content, value.
    <script> bodies are scanned as JavaScript, <style> bodies are not text.
  * *.js: the contents of string and template literals (comments and identifiers are not scanned).
  * game.css: `content:` values only (class names, colours and `safe-area-inset` are not text).
  * cases/*.json: every string value (keys are not scanned).

Matching is case-insensitive on whole words, so `lightgray`, `Safely` and `safe-area-inset`
(a CSS token, never inside a string literal with spaces) are handled as follows: whole-word
`light`/`safe` inside a hyphenated or underscored token (CSS or code name such as
`light-dark`, `safe-area-inset`, `safe_mode`) is skipped by the token rule below, not by a blanket allowlist.
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "static" / "cloud-dive"
CASES = UI / "cases"

BANNED_R91 = [
    "no icing", "ice-free", "safe", "clear of ice", "light",
    "moderate", "severe", "likely", "unlikely",
]
# R9.2: absence is "Not indicated", missing data is "Not assessed". Other phrasings are banned
# in user-facing text. "Phase unknown" (GOES phase code 5, a satellite category, not evidence
# absence) is the single narrow allowance.
BANNED_R92 = [
    "unknown", "no evidence", "no data", "not detected", "none detected",
    "undetected", "absent", "data missing", "missing data", "no ice", "ice free",
]
ALLOWED_PHRASES = ["phase unknown"]

GAME_NOTE = ("Game model. Not a flight procedure, not an icing severity. "
             "Evidence from satellite cloud tops and an ECMWF forecast.")


def _word_re(term: str) -> re.Pattern:
    # Whole word; a hyphen or underscore joined token (safe-area-inset, light_mode) is a code name.
    return re.compile(r"(?<![\w-])" + re.escape(term).replace(r"\ ", r"\s+") + r"(?![\w-])", re.I)


_R91 = [(t, _word_re(t)) for t in BANNED_R91]
_R92 = [(t, _word_re(t)) for t in BANNED_R92]


def violations(text: str, terms=None) -> list[str]:
    cleaned = text
    for ok in ALLOWED_PHRASES:
        cleaned = re.sub(re.escape(ok), " ", cleaned, flags=re.I)
    out = []
    for term, rx in (terms or (_R91 + _R92)):
        if rx.search(cleaned):
            out.append(term)
    return out


# --------------------------------------------------------------------------- extraction

def js_strings(src: str) -> list[str]:
    """Contents of string and template literals; skips comments and ${...} expressions."""
    out: list[str] = []
    i, n = 0, len(src)

    def template(i: int) -> int:
        buf = []
        while i < n:
            c = src[i]
            if c == "\\":
                buf.append(src[i + 1:i + 2]); i += 2; continue
            if c == "`":
                out.append("".join(buf)); return i + 1
            if c == "$" and src[i + 1:i + 2] == "{":
                out.append("".join(buf)); buf = []
                i += 2; depth = 1
                while i < n and depth:
                    d = src[i]
                    if d == "`":
                        i = template(i + 1); continue
                    if d in "\"'":
                        i = quoted(i); continue
                    depth += (d == "{") - (d == "}")
                    i += 1
                continue
            buf.append(c); i += 1
        return i

    def quoted(i: int) -> int:
        q = src[i]; i += 1; buf = []
        while i < n and src[i] != q and src[i] != "\n":
            if src[i] == "\\":
                buf.append(src[i + 1:i + 2]); i += 2; continue
            buf.append(src[i]); i += 1
        out.append("".join(buf))
        return i + 1

    while i < n:
        two = src[i:i + 2]
        if two == "//":
            j = src.find("\n", i); i = n if j < 0 else j
        elif two == "/*":
            j = src.find("*/", i + 2); i = n if j < 0 else j + 2
        elif src[i] in "\"'":
            i = quoted(i)
        elif src[i] == "`":
            i = template(i + 1)
        elif src[i] == "/" and re.search(r"(^|[(,=:;!&|?{}\[]|return)\s*$", src[max(0, i - 40):i]):
            # regex literal: skip it so quotes inside are not read as strings
            j = i + 1; in_cls = False
            while j < n and src[j] != "\n":
                if src[j] == "\\": j += 2; continue
                if src[j] == "[": in_cls = True
                elif src[j] == "]": in_cls = False
                elif src[j] == "/" and not in_cls: break
                j += 1
            i = j + 1
        else:
            i += 1
    return out


class _Html(HTMLParser):
    ATTRS = {"title", "alt", "aria-label", "placeholder", "content", "value", "aria-description"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.texts: list[str] = []
        self.scripts: list[str] = []
        self._tag = ""

    def handle_starttag(self, tag, attrs):
        self._tag = tag
        for k, v in attrs:
            if k in self.ATTRS and v:
                self.texts.append(v)

    def handle_endtag(self, tag):
        self._tag = ""

    def handle_data(self, data):
        if self._tag == "script":
            self.scripts.append(data)
        elif self._tag in ("style",):
            return
        elif data.strip():
            self.texts.append(data)


def html_texts(src: str) -> list[str]:
    p = _Html()
    p.feed(src)
    return p.texts + [s for sc in p.scripts for s in js_strings(sc)]


def css_texts(src: str) -> list[str]:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return [m.group(2) for m in re.finditer(r"content\s*:\s*([\"'])(.*?)\1", src, flags=re.S)]


# Narrow allowlist: `viewerProfile.samples[].phase` is the frozen viewer.js contract enum
# (liquid / supercooled / mixed / ice / unknown). It is a machine code, not display text.
ENUM_KEYS = {"phase"}


def json_strings(obj) -> list[str]:
    if isinstance(obj, str):
        return [obj]
    if isinstance(obj, list):
        return [s for v in obj for s in json_strings(v)]
    if isinstance(obj, dict):
        return [s for k, v in obj.items() if k not in ENUM_KEYS for s in json_strings(v)]
    return []


def ui_texts() -> dict[str, list[str]]:
    res: dict[str, list[str]] = {}
    for p in sorted(UI.iterdir()):
        if p.suffix == ".html":
            res[p.name] = html_texts(p.read_text(encoding="utf-8"))
        elif p.suffix in (".js", ".mjs"):
            res[p.name] = js_strings(p.read_text(encoding="utf-8"))
        elif p.suffix == ".css":
            res[p.name] = css_texts(p.read_text(encoding="utf-8"))
    for p in sorted(CASES.glob("*.json")):
        res[f"cases/{p.name}"] = json_strings(json.loads(p.read_text(encoding="utf-8")))
    return res


# --------------------------------------------------------------------------- tests

def test_extractors_unit():
    assert js_strings('const a = "x light"; // "safe"\n/* "severe" */ const b = `n ${f("likely")} tail`;') == \
        ["x light", "n ", "likely", " tail"]
    assert js_strings('const r = /["\']light/; const s = "ok";') == ["ok"]
    assert css_texts('a{color:lightgray; padding:env(safe-area-inset-top)} b::after{content:"Observed"}') == ["Observed"]
    assert html_texts('<p title="Safely">Hi <span>there</span></p><style>.light{}</style>') == ["Safely", "Hi ", "there"]


def test_matcher_unit():
    assert violations("Light icing") == ["light"]
    assert violations("This is SAFE") == ["safe"]
    assert violations("lightgray Safely safe-area-inset light_mode") == []
    assert violations("Phase unknown") == []
    assert violations("Unknown") == ["unknown"]
    assert violations("no  icing here") == ["no icing"]


def test_scanned_files_are_found():
    texts = ui_texts()
    assert {"index.html", "render.js", "why.js", "game.css"} <= set(texts)
    assert sum(1 for k in texts if k.startswith("cases/")) >= 3
    assert any(texts[k] for k in ("index.html", "render.js", "why.js"))


def test_map_files_and_map_fields_are_scanned():
    """Task 11.6: the map code, the basemap and the `map` field of every case file are in scope."""
    texts = ui_texts()
    assert {"map.js", "view-helpers.js", "cases/basemap.json"} <= set(texts)
    assert texts["map.js"] and texts["view-helpers.js"]
    cases = [p for p in sorted(CASES.glob("[0-9]*.json"))]
    assert cases
    for p in cases:
        data = json.loads(p.read_text(encoding="utf-8"))
        assert isinstance(data.get("map"), dict), p.name
        map_strings = json_strings(data["map"])
        assert map_strings, p.name  # image names, projection id, attribution
        assert all(s in texts[f"cases/{p.name}"] for s in map_strings), p.name
        for s in map_strings:
            assert not violations(s), (p.name, s)


def test_r91_r92_no_banned_wording_in_user_facing_text():
    found = []
    for name, strings in ui_texts().items():
        for s in strings:
            for term in violations(s):
                found.append(f"{name}: {term!r} in {s[:90]!r}")
    assert not found, "\n".join(found)


def test_r93_game_note_in_index_html():
    html = (UI / "index.html").read_text(encoding="utf-8")
    notes = [t for t in html_texts(html) if GAME_NOTE in " ".join(t.split())]
    assert notes, "R9.3 game note text missing from index.html"
    # The note must sit in the page footer shown with every flight screen, not inside a hidden section.
    assert re.search(r'id="game-note"[^>]*>\s*' + re.escape(GAME_NOTE), html)


def test_r92_absence_and_missing_wordings_present_and_exclusive():
    texts = ui_texts()
    joined = " ".join(s for k in ("render.js", "why.js", "index.html") for s in texts[k])
    assert "Not indicated" in joined and "Not assessed" in joined
    # case files echo exactly the four evidence levels
    expected = ["Not assessed", "Not indicated", "Possible (forecast only)",
                "Observed supercooled layer at planned altitude"]
    for p in sorted(CASES.glob("[0-9]*.json")):
        data = json.loads(p.read_text(encoding="utf-8"))
        assert data["rule"]["levels"] == expected, p.name
        assert set(data["routeSummaryStartAltitude"]) == set(expected), p.name

def test_scene_strings_and_vendor_skip():
    """Task 14.5: scene.js (STRINGS table) is scanned, static/cloud-dive/vendor/ is not."""
    texts = ui_texts()
    assert "scene.js" in texts and any("Top of climb" == s for s in texts["scene.js"])
    assert not any(k.startswith("vendor") for k in texts)
    for s in texts["scene.js"]:
        assert not violations(s), s


def test_scene_panel_text_from_real_cases():
    """Task 14.5: panel text and notes produced by buildScene for every real case and phase."""
    import shutil
    import subprocess
    node = shutil.which("node")
    if node is None:
        import pytest
        pytest.skip("node not available")
    script = (
        "import * as E from './static/cloud-dive/engine.js';"
        "import * as S from './static/cloud-dive/scene.js';"
        "import {readFileSync,readdirSync} from 'node:fs';"
        "const out=[];const d='static/cloud-dive/cases/';"
        "for(const n of readdirSync(d).filter(x=>/^\\d.*\\.json$/.test(x))){"
        "const f=JSON.parse(readFileSync(d+n,'utf8'));const c=E.loadCase(f);"
        "for(const ph of ['ready','climb','cruise','gate','arrival','report']){"
        "for(const st of [E.initialState(c),{...E.initialState(c),ice:70,step:4}]){"
        "const s=S.buildScene(f,st,{phase:ph},{});"
        "out.push(s.panel.levelHere,s.panel.levelAhead,s.panel.textLine,s.panel.iceLabel,...s.panel.legend,"
        "...Object.values(s.notes),...s.airports.map(a=>a.label||''));}}}"
        "console.log(JSON.stringify(out));"
    )
    r = subprocess.run([node, "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    strings = json.loads(r.stdout)
    assert any("Not indicated" in s for s in strings)
    bad = [(s, violations(s)) for s in set(strings) if s and violations(s)]
    assert not bad, bad


def test_panel_strings_scanned_task_15_3():
    """Task 15.3: panel.js strings and cockpit.css content values are scanned; the game note matches R9.3."""
    texts = ui_texts()
    assert "panel.js" in texts and "cockpit.css" in texts
    assert GAME_NOTE in "".join(texts["panel.js"])
    assert "Ice index (game model)" in texts["panel.js"]
    for s in texts["panel.js"] + texts["cockpit.css"]:
        assert not violations(s), s


def test_hotseat_strings_scanned_task_18_1():
    """Task 18.1: hotseat.js strings are scanned and free of banned terms."""
    texts = ui_texts()
    assert "hotseat.js" in texts and "not ranked" in texts["hotseat.js"]
    for s in texts["hotseat.js"]:
        assert not violations(s), s


def test_chase_strings_scanned_task_19_2():
    """Task 19.2: chase.js strings, the chase button label and its html text are scanned."""
    texts = ui_texts()
    assert "chase.js" in texts and "Chase view (C)" in texts["chase.js"]
    assert "Cockpit view (C)" in texts["chase.js"]
    assert "Chase view (C)" in texts["index.html"]
    for s in texts["chase.js"] + texts["index.html"]:
        assert not violations(s), s


def _node_json(script: str):
    import shutil
    import subprocess
    import pytest
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    r = subprocess.run([node, "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_group21_strings_scanned_task_21_8():
    """Task 21.8 (R22.11, R9.1): gate labels, report headline, status texts and the panel legend strip."""
    script = (
        "import * as E from './static/cloud-dive/engine.js';"
        "import * as S from './static/cloud-dive/scene.js';"
        "import * as R from './static/cloud-dive/report.js';"
        "import * as T from './static/cloud-dive/takeoff.js';"
        "import {readFileSync,readdirSync} from 'node:fs';"
        "const out={gate:[],headline:[],status:[],strip:[]};const d='static/cloud-dive/cases/';"
        "for(const n of readdirSync(d).filter(x=>/^\\d.*\\.json$/.test(x))){"
        "const f=JSON.parse(readFileSync(d+n,'utf8'));const c=E.loadCase(f);"
        "for(let step=0;step<=c.nSteps;step+=2){const st={...E.initialState(c),step,targetAlt:step%c.nAlts};"
        "const s=S.buildScene(f,st,{phase:'gate'},{});"
        "for(const g of s.gates)out.gate.push(g.label,g.level);"
        "out.strip.push(...s.panel.legend,...S.legendNames(f));"
        "if(s.panel.gate)out.strip.push(JSON.stringify(s.panel.gate));}}"
        "for(const t of [-300,-1,0,0.4,1,250,5000])for(const sa of [1000,null])for(const b of [900,1000,null]){"
        "const h=R.reportHeadline({ranked:true,totalUsd:1000+t,references:{straight_ahead:sa,best:b}});"
        "if(h){if(h.vsStraight)out.headline.push(h.vsStraight.text);if(h.aboveBest)out.headline.push(h.aboveBest.text);}}"
        "for(const ph of ['ready','takeoff','climb','cruise','arrival','diversion'])for(const ic of ['','KJFK'])"
        "out.status.push(T.leadStatusText({phase:ph},ic),T.endingStatusText({phase:ph},ic));"
        "console.log(JSON.stringify(out));"
    )
    out = _node_json(script)
    assert out["gate"] and out["headline"] and out["status"] and out["strip"]
    assert any("more than Straight-ahead" in s for s in out["headline"])
    assert any("less than Straight-ahead" in s for s in out["headline"])
    # gate labels are exactly the four evidence levels
    assert set(out["gate"]) <= {"Not assessed", "Not indicated", "Possible (forecast only)",
                                "Observed supercooled layer at planned altitude"}
    for group, strings in out.items():
        bad = [(s, violations(s)) for s in set(strings) if s and violations(s)]
        assert not bad, (group, bad)
    # source files: scene.js, report.js, takeoff.js, panel.js strings are scanned and clean
    texts = ui_texts()
    for name in ("scene.js", "report.js", "report-view.js", "takeoff.js", "panel.js", "controls.js"):
        assert name in texts, name
        for s in texts[name]:
            assert not violations(s), (name, s)


# Commit before group 21 (task 21.1 "before" screenshots). Engine, cost model, solver and case files must not differ.
GROUP21_BASE = "1565153"
UNCHANGED = ["static/cloud-dive/engine.js", "src/analysis/game_core.py", "src/analysis/cost_model.py",
             "src/analysis/solver.py", "static/cloud-dive/cases/"]


def test_engine_costs_and_data_unchanged_since_group_21_base():
    """Task 21.8 (R22.11): git diff of the engine, cost model, solver and case files is empty."""
    import shutil
    import subprocess
    import pytest
    git = shutil.which("git")
    if git is None:
        pytest.skip("git not available")
    probe = subprocess.run([git, "cat-file", "-t", GROUP21_BASE], cwd=ROOT, capture_output=True, text=True)
    if probe.returncode != 0:
        pytest.skip(f"commit {GROUP21_BASE} not available (shallow clone)")
    r = subprocess.run([git, "diff", GROUP21_BASE, "--", *UNCHANGED], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert r.stdout == "", "R22.11: engine, costs or data changed:\n" + r.stdout[:2000]
