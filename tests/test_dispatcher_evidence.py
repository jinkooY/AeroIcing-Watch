"""Dispatcher view: evidence levels and kilometres per level replace the risk badge (D1, R11.2)."""
from __future__ import annotations

import re
from pathlib import Path

from src.analysis.evidence import LEVELS
from src.analysis.icing_profile import attach_evidence

ROOT = Path(__file__).resolve().parents[1]


def _sample(distance, state, top=None, base=None, supercooled=None, ctt=None):
    return {"distanceKm": distance, "retrievalState": state, "topFt": top, "baseFt": base,
            "supercooled": supercooled, "cloudTopTemperatureC": ctt}


def test_synthetic_profile_km_per_level_sums_to_distance():
    samples = [
        _sample(0, "clear"),
        _sample(100, "observed", top=30000, base=20000, supercooled=True, ctt=-15.0),
        _sample(200, "outside_domain"),
        _sample(300, "clear"),
    ]
    profile = attach_evidence({"flightAlt_ft": 25000, "samples": samples, "icingRisk": "HIGH"})
    km = profile["evidenceKm"]
    assert set(km) == set(LEVELS)
    assert sum(km.values()) == 300
    assert km["Not indicated"] == 100 and km["Not assessed"] == 100
    assert samples[1]["evidenceLevel"] == "Observed supercooled layer at planned altitude"
    assert samples[2]["evidenceLevel"] == "Not assessed"
    assert profile["icingRisk"] == "HIGH"  # legacy field kept for compatibility (R11.1)


def test_synthetic_single_sample_has_all_level_keys():
    profile = attach_evidence({"flightAlt_ft": 30000, "samples": [_sample(0, "clear")]})
    assert profile["evidenceKm"] == {name: 0.0 for name in LEVELS}


def test_dispatcher_ui_has_no_risk_badge_or_altitude_suggestions():
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    js = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    assert "risk-badge" not in html + js and "alt-suggestions" not in html + js
    assert "evidence-list" in html
    banned = r"\b(no icing|ice-free|safe|clear of ice|light|moderate|severe|likely|unlikely)\b"
    literals = re.findall(r'"([^"\n]*)"|`([^`\n]*)`', js)
    text = " ".join(a or b for a, b in literals) + re.sub(r"<style.*?</style>|<script.*?</script>|<[^>]+>", " ", html, flags=re.S)
    assert not re.search(banned, text, re.I)
