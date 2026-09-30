#!/usr/bin/env python3
"""
KASOTI-Demo — capture REAL engine output from the real repo into this demo's data/ dir.

Run from the Kasoti-Demo directory:

    export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
    python3 tools/capture_real_output.py /mnt/Lay/Kasoti

Every number the demo shows is produced by this script running the actual
:app-desktop console and the actual :eval harness. Nothing here is hand-written.
Re-run it whenever the engine changes and commit the diff — the demo cannot
drift from the product without that diff showing up.

Outputs
  data/scenarios.json          structured verdicts + layer tables + EN/HI strings
  data/transcripts/<id>.txt    the raw, unedited console transcript for each
  data/corpus.txt              the 10,000-row MRZ mutation corpus from the eval run,
                               in a compact pipe-delimited form (see FORMAT below)
  data/evalrun.json            counters / measures / buckets / governance, verbatim
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(sys.argv[1] if len(sys.argv) > 1 else "/mnt/Lay/Kasoti").resolve()
HERE = Path(__file__).resolve().parent.parent
DATA = HERE / "data"
TRANSCRIPTS = DATA / "transcripts"

# The eval run this demo is built from. Stamped on the page; changing it means
# re-running the demo build and committing the diff.
RUN_ID = "eval-20260930-smoke-653a"

# --- the scenarios we replay -------------------------------------------------
# Each is a real sidecar + track fed to the real console. `expect` is asserted
# against what the engine actually printed, so this script fails loudly if the
# engine ever changes its mind.
BASE_SIDECAR = {
    "mrz": [
        "AB12345671IND9006083M3106073AB1234567<<<<<16",
        "SHARMA<<RAMESH<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
    ],
    "printName": "SHARMA RAMESH",
    "printDob": "1990-06-08",
    "issueDate": "2021-06-08",
    "expiry": "2031-06-07",
    "photoZone": {"x": 0.14, "y": 0.18, "w": 0.20, "h": 0.32},
    "textZone": {"x": 0.05, "y": 0.72, "w": 0.90, "h": 0.12},
    "presentation": "PHYSICAL",
    "trust": "VERIFY",
}

SCENARIOS = [
    {
        "id": "red-check-digit",
        "track": "PAPER_ID",
        "sidecar": {"mrz_tamper": "composite"},
        "title": "Altered passport, arithmetic still checks out — no",
        "titleHi": "बदला गया पासपोर्ट, गणित फिर भी सही — नहीं",
        "blurb": "One digit changed in the document number. The 7-3-1 check digit and the composite both catch it.",
        "blurbHi": "दस्तावेज़ संख्या में एक अंक बदला गया। 7-3-1 चेक डिजिट और कॉम्पोज़िट दोनों पकड़ लेते हैं।",
        "expect": "RED",
    },
    {
        "id": "amber-missing-layers",
        "track": "PAPER_ID",
        "sidecar": {"drop_macro": True},
        "title": "Genuine document, two layers never ran",
        "titleHi": "असली दस्तावेज़, दो परतें चली ही नहीं",
        "blurb": "Every check digit passes. The face and diary layers produced nothing, so the verdict is AMBER, not GREEN.",
        "blurbHi": "हर चेक डिजिट सही है। फेस और डायरी परतों ने कुछ नहीं दिया, इसलिए निर्णय AMBER है, GREEN नहीं।",
        "expect": "AMBER",
    },
    {
        "id": "grey-missing-capture",
        "track": "PASSPORT",
        "sidecar": {"drop_macro": True},
        "title": "Passport presented without the macro clip",
        "titleHi": "मैक्रो क्लिप के बिना पासपोर्ट",
        "blurb": "The check digits are fine. We still refuse to decide, because a required capture is missing.",
        "blurbHi": "चेक डिजिट सही हैं। फिर भी हम निर्णय नहीं लेते, क्योंकि एक आवश्यक कैप्चर नहीं है।",
        "expect": "GREY",
    },
    {
        "id": "amber-unknown-track",
        "track": "UNKNOWN",
        "sidecar": {"drop_macro": True},
        "title": "A document family we do not support",
        "titleHi": "एक असमर्थित दस्तावेज़ प्रकार",
        "blurb": "We do not know which checks are load-bearing, so we escalate instead of guessing.",
        "blurbHi": "हमें नहीं पता कि कौन-से जाँच महत्वपूर्ण हैं, इसलिए अनुमान लगाने के बजाय बढ़ा देते हैं।",
        "expect": "AMBER",
    },
    {
        "id": "red-screen-presentation",
        "track": "PASSPORT",
        "sidecar": {"presentation": "SCREEN"},
        "title": "A phone showing a passport",
        "titleHi": "पासपोर्ट दिखाने वाला फ़ोन",
        "blurb": "Presented as a physical document; the macro layer disagrees. Hard RED before any secondary check.",
        "blurbHi": "भौतिक दस्तावेज़ बताया गया; मैक्रो परत असहमत है। किसी भी द्वितीय जाँच से पहले सीधा RED।",
        "expect": "RED",
    },
]


def sidecar_for(spec):
    d = json.loads(json.dumps(BASE_SIDECAR))
    for k, v in spec.get("sidecar", {}).items():
        if k == "mrz_tamper":
            l1 = list(d["mrz"][0])
            # position 9 is the document-number check digit for TD3
            l1[9] = "0" if l1[9] != "0" else "1"
            d["mrz"] = ["".join(l1), d["mrz"][1]]
        elif k == "drop_macro":
            d.pop("photoZone", None)
            d.pop("textZone", None)
        else:
            d[k] = v
    return d


def run_console(sidecar_path, track):
    env = dict(os.environ)
    env["JAVA_HOME"] = env.get("JAVA_HOME", "/usr/lib/jvm/java-17-openjdk")
    args = [
        "./gradlew", "-q", ":app-desktop:run",
        "--args=screen --image demo-specimen/specimen.png "
        f"--fields {sidecar_path} --track {track} --demo",
    ]
    p = subprocess.run(
        args, cwd=REPO, env=env, capture_output=True, text=True, timeout=900
    )
    return p.stdout + p.stderr


# --- console output parsing --------------------------------------------------
RE_LAYER = re.compile(r"^  (\S[\w.]*)\s{2,}(RAN|SKIPPED|UNAVAILABLE)\s{2,}(.*)$")
RE_FIND = re.compile(r"^  (RED|AMBER|GREY|GREEN|INFO)\s{2,}(\S+)\s{2,}(\S+)\s+(.*)$")
RE_VERDICT = re.compile(r"^  VERDICT : (\w+)")
RE_ACTION = re.compile(r"^  ACTION  : (.+)$")
RE_EN = re.compile(r"^  EN      : (.+)$")
RE_HI = re.compile(r"^  HI      : (.+)$")
RE_WARN = re.compile(r"^    ! (.+)$")
RE_TIP = re.compile(r"^  auditTip\s+(\S+)")
RE_FUSION = re.compile(r"^  fusion rules\s+(\S+)\s*$")
# The console prints `thresholds      v1 (run console)`. A `\S+ \S+` pattern captures
# only `v1 (run` and silently truncates the value, so take the whole remainder.
RE_THRESH = re.compile(r"^  thresholds\s+(.+?)\s*$")


def parse(out):
    r = {
        "layers": [], "findings": [], "warnings": [],
        "verdict": None, "action": None, "en": None, "hi": None,
        "auditTip": None, "fusionRuleVersion": None, "thresholdVersion": None,
    }
    section = None
    for line in out.splitlines():
        s = line.strip()
        if s == "LAYERS":
            section = "layers"; continue
        if s.startswith("FINDINGS"):
            section = "findings"; continue
        if s == "WARNINGS":
            section = "warnings"; continue
        if s == "POLICY":
            section = "policy"; continue
        if s.startswith("case ") or s.startswith("DEMO RUN"):
            if section in ("layers", "findings", "warnings", "policy"):
                section = None

        m = RE_LAYER.match(line)
        if m and section == "layers":
            r["layers"].append({"layer": m.group(1), "state": m.group(2), "detail": m.group(3).strip()})
            continue
        m = RE_FIND.match(line)
        if m and section == "findings":
            r["findings"].append({
                "severity": m.group(1), "code": m.group(2),
                "evidence": m.group(3), "detail": m.group(4).strip(),
            })
            continue
        m = RE_WARN.match(line)
        if m and section == "warnings":
            r["warnings"].append(m.group(1).strip()); continue
        m = RE_VERDICT.match(line)
        if m: r["verdict"] = m.group(1); continue
        m = RE_ACTION.match(line)
        if m: r["action"] = m.group(1).strip(); continue
        m = RE_EN.match(line)
        if m: r["en"] = m.group(1).strip(); continue
        m = RE_HI.match(line)
        if m: r["hi"] = m.group(1).strip(); continue
        m = RE_TIP.match(line)
        if m: r["auditTip"] = m.group(1); continue
        m = RE_FUSION.match(line)
        if m: r["fusionRuleVersion"] = m.group(1); continue
        m = RE_THRESH.match(line)
        if m: r["thresholdVersion"] = m.group(1); continue
    return r


def corpus_compact(src: Path, dst: Path):
    """
    mrz_corpus.jsonl -> one compact line per row.

    id|format|mutation|expectedCaught|blindSpotReason|line1|line2|line3

    The browser re-derives caught/blind itself with its own 7-3-1 implementation
    and compares against expectedCaught. That is the self-check: if the numbers
    land on the eval run's numbers, the browser engine is correct.
    """
    n = 0
    with src.open() as fh, dst.open("w") as out:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            d = json.loads(raw)
            lines = d.get("lines") or []
            while len(lines) < 3:
                lines.append("")
            reason = (d.get("blindSpotReason") or "").replace("|", "/")
            out.write("|".join([
                d["id"], d["format"], d["mutation"],
                "1" if d.get("expectedCaught") else "0",
                reason, lines[0], lines[1], lines[2],
            ]) + "\n")
            n += 1
    return n


def main():
    DATA.mkdir(exist_ok=True)
    TRANSCRIPTS.mkdir(exist_ok=True)

    run_dir = REPO / "eval" / "runs" / RUN_ID
    if not run_dir.is_dir():
        sys.exit(f"no such eval run: {run_dir}")

    # 1. the eval run, verbatim
    metrics = json.loads((run_dir / "metrics.json").read_text())
    em = metrics["evalmetrics"]
    evalrun = {
        "runId": metrics["runId"],
        "suite": metrics["suite"],
        "commit": em.get("commit"),
        "startedAtUtc": metrics.get("startedAtUtc"),
        "finishedAtUtc": metrics.get("finishedAtUtc"),
        "split": em.get("split"),
        "counters": em.get("counters", {}),
        "measures": em.get("measures", {}),
        "buckets": em.get("buckets", {}),
        "notes": em.get("notes"),
        "governance": metrics.get("governance", {}),
    }
    (DATA / "evalrun.json").write_text(json.dumps(evalrun, indent=1))
    print(f"  evalrun.json          run={RUN_ID} commit={em.get('commit')}")

    # 2. the 10k corpus, compact
    n = corpus_compact(run_dir / "mrz_corpus.jsonl", DATA / "corpus.txt")
    size = (DATA / "corpus.txt").stat().st_size
    print(f"  corpus.txt            {n} rows, {size/1024:.0f} KiB")

    # 3. the scenarios
    results = []
    for sc in SCENARIOS:
        sc_path = DATA / f".sidecar-{sc['id']}.json"
        sc_path.write_text(json.dumps(sidecar_for(sc), indent=1))
        out = run_console(str(sc_path), sc["track"])
        (TRANSCRIPTS / f"{sc['id']}.txt").write_text(out)
        parsed = parse(out)
        if parsed["verdict"] != sc["expect"]:
            sys.exit(
                f"scenario {sc['id']}: expected {sc['expect']}, "
                f"engine said {parsed['verdict']} — the engine changed, re-read the demo copy"
            )
        if not parsed["layers"]:
            sys.exit(f"scenario {sc['id']}: parsed no layers, transcript parser is broken")
        parsed.update({
            "id": sc["id"], "title": sc["title"], "titleHi": sc["titleHi"],
            "blurb": sc["blurb"], "blurbHi": sc["blurbHi"],
            "track": sc["track"],
            "transcript": f"data/transcripts/{sc['id']}.txt",
            "sidecar": sidecar_for(sc),
        })
        results.append(parsed)
        print(f"  scenario {sc['id']:<24} {parsed['verdict']:<6} "
              f"{len(parsed['layers'])} layers, {len(parsed['findings'])} findings")

    (DATA / "scenarios.json").write_text(json.dumps({
        "runId": RUN_ID,
        "fusionRuleVersion": results[0]["fusionRuleVersion"],
        "thresholdVersion": results[0]["thresholdVersion"],
        "note": (
            "Replayed from the real :app-desktop console by tools/capture_real_output.py. "
            "The browser does not re-run fusion; these are its actual outputs."
        ),
        "scenarios": results,
    }, indent=1, ensure_ascii=False))

    for p in DATA.glob(".sidecar-*.json"):
        p.unlink()
    print("\ndone. every value above came from the engine, not from a human.")


if __name__ == "__main__":
    main()
