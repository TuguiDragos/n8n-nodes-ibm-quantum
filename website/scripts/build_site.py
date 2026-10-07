"""Builds the website of n8n-nodes-ibm-quantum from the repository it sits in: the operations the built node declares,
the gate palette, the test run, and the hardware record. Every figure is read here, on every build, so the page grows
with the project; a sentence the page quotes from the docs is checked against them, and a build whose claim no longer
holds stops rather than publishing it."""
import datetime
import html
import json
import re
import subprocess
import urllib.request
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
repo = WEB.parent
WORK, out_dir = WEB / "_build", WEB / "_site"
THEME = WEB / "theme/quantum-dark.json"

SITE = "https://n8n-nodes-ibm-quantum.tuguidragos.com/"
REPO = "https://github.com/TuguiDragos/n8n-nodes-ibm-quantum"
NPM = "https://www.npmjs.com/package/n8n-nodes-ibm-quantum"
VIDEO = "https://youtu.be/6ppR6uCt1_o"
N8N_INSTALL = "https://docs.n8n.io/integrations/community-nodes/installation/"
SPONSOR = "https://github.com/sponsors/TuguiDragos"
PACKAGE = "n8n-nodes-ibm-quantum"
TITLE = "n8n-nodes-ibm-quantum: IBM Quantum Circuits in n8n"
DESCRIPTION = ("A verified n8n community node for IBM Quantum. Build OpenQASM 3 circuits, run them on real IBM "
               "hardware, and start workflows when jobs finish. Unofficial.")

esc = lambda s: html.escape(s, quote=True)
WORDS = "zero one two three four five six seven eight nine ten eleven twelve".split()
word = lambda n: WORDS[n] if n < len(WORDS) else str(n)
series = lambda items: items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]
AMERICAN = {"Characterise": "Characterize", "characterise": "characterize"}
american = lambda s: re.sub(r"\b(" + "|".join(AMERICAN) + r")\b", lambda m: AMERICAN[m.group(1)], s)

# What the built node declares about itself, read by extract_ops.cjs from dist.
ops = json.loads((WORK / "ops.json").read_text())
resources = ops["resources"]
op_count = sum(len(r["operations"]) for r in resources)
RESOURCES = word(len(resources))
resource_names = series([r["name"] for r in resources])
assert ops["IbmQuantumErrorTrigger"]["hidden"] and not ops["IbmQuantumTrigger"].get("hidden")
assert ops["usableAsTool"], "the page says the action node is an AI Agent tool"
by_name = {(r["name"], o["name"]) for r in resources for o in r["operations"]}

# The gate palette, read from descriptions.ts, and which of its entries IBM hardware runs as written.
source = (repo / "nodes/IbmQuantum/descriptions.ts").read_text()
palette_block = source[source.index("const GATE_OPTIONS = ["):]
palette_block = palette_block[:palette_block.index("\n];")]
palette = re.findall(r"value: '([a-z]+)'", palette_block)
NATIVE = ["x", "sx", "rx", "rz", "rzz", "cz", "measure", "reset", "delay", "barrier"]
TRANSPILE = ["y", "z", "h", "s", "sdg", "t", "tdg", "ry", "p", "u", "cx", "swap", "crx", "cry", "crz", "ccx"]
DROPPED = ["id"]
assert sorted(palette) == sorted(NATIVE + TRANSPILE + DROPPED), sorted(set(palette) ^ set(NATIVE + TRANSPILE + DROPPED))
readme = (repo / "README.md").read_text()
assert "Gates that are safe to use this way: **X, SX, RX, RZ, RZZ, CZ, Delay, Reset, Barrier, Measure**" in readme

# The unit suite, as it ran on this checkout with coverage, and the hardware record.
vitest = json.loads((WORK / "vitest.json").read_text())
tests, test_files = vitest["numTotalTests"], len(vitest["testResults"])
assert vitest["success"] and vitest["numPassedTests"] == tests
coverage = json.loads((WORK / "coverage/coverage-summary.json").read_text())["total"]
assert all(coverage[k]["pct"] == 100 for k in ("statements", "branches", "functions", "lines")), coverage
assert "thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 }" in (repo / "vitest.config.mts").read_text()
assert "- run: npm run test:coverage" in (repo / ".github/workflows/ci.yml").read_text()
testing = (repo / "TESTING.md").read_text()
totals = re.search(r"\| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \((\d+\.\d) minutes\) \| (\d{4}-\d\d-\d\d) [\d:]+ \| (\d{4}-\d\d-\d\d) [\d:]+ \|", testing)
JOBS, COMPLETED, FAILED, CANCELED, QPU_S, QPU_MIN, FIRST, LAST = totals.groups()
assert int(COMPLETED) + int(FAILED) + int(CANCELED) == int(JOBS) and f"{int(QPU_S) / 60:.1f}" == QPU_MIN
FIRST, LAST = datetime.date.fromisoformat(FIRST), datetime.date.fromisoformat(LAST)
SPAN = (f"{FIRST:%B} {FIRST.day} and {LAST:%B} {LAST.day}, {LAST.year}" if FIRST.year == LAST.year
        else f"{FIRST:%B} {FIRST.day}, {FIRST.year} and {LAST:%B} {LAST.day}, {LAST.year}")
by_backend = re.search(r"By backend: (.+?), all (\w+) Heron r2 devices with (\d+) qubits\.", " ".join(testing.split()))
DEVICES = [name for _, name in re.findall(r"(\d+) on `(ibm_\w+)`", by_backend.group(1))]
assert sum(int(n) for n, _ in re.findall(r"(\d+) on `(ibm_\w+)`", by_backend.group(1))) == int(JOBS)
assert by_backend.group(2) == word(len(DEVICES)), "the record names every device it counts"
QUBITS = by_backend.group(3)
RUN_JOB = "da45jem1vhnc73fkj6t0"
assert re.search(rf"\| 2026-08-21 \| 13:59:22 \| `{RUN_JOB}` \| ibm_marrakesh \| sampler \| 4096 \| 1 \| Completed \|  \| 3 \|", testing)
assert "2066 <code>00</code> and 1950 <code>11</code> out of 4096 shots" in readme and "<b>3 QPU seconds</b>" in readme
assert "Measured on `ibm_fez` over 2048 shots: 48.7% `00` and 46.2% `11`" in readme
assert "the Open allowance is 600 seconds per rolling 28 days" in readme
assert "came back carrying `cost: 600`" in readme
assert "a write raised the limit from 600 to 2000 seconds and read back 2000, Clear Limit read back 600, the plan default" in readme

COUNTS = [("00", 2066), ("01", 27), ("10", 53), ("11", 1950)]
assert sum(n for _, n in COUNTS) == 4096
NOISE = 4096 - 2066 - 1950
fmt = lambda n: f"{int(n):,}"

# Code samples, colored by Tapetum Quantum. OpenQASM has no grammar in the highlighter, so it is tokenized here into the
# same classes: keywords, gate calls, numbers, the include string, brackets and punctuation.
TRANSPILE_PY = '''from qiskit import QuantumCircuit, qasm3
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
from qiskit_ibm_runtime.fake_provider import FakeFez  # mirrors ibm_fez

backend = FakeFez()

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure(0, 0)
qc.measure(1, 1)

isa = generate_preset_pass_manager(optimization_level=1, backend=backend).run(qc)
print(qasm3.dumps(isa))  # paste this into the node'''
assert TRANSPILE_PY in readme, "the transpile snippet is the README's own"
snippets = WORK / "snippets.json"
snippets.write_text(json.dumps([{"id": "transpile", "code": TRANSPILE_PY, "lang": "python"}]))
subprocess.run(["node", str(WEB / "scripts/highlight.mjs"), str(THEME), str(snippets), str(WORK / "colored.json")],
               check=True)
COLORED = json.loads((WORK / "colored.json").read_text())

BELL = (WORK / "bell.qasm").read_text()
assert BELL.count(";") == 16 and "cz q[0], q[1];" in BELL


def qasm_html(text):
    keywords = {"OPENQASM", "include", "qubit", "bit", "measure"}
    out = []
    for token in re.findall(r'"[^"]*"|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|\s+|.', text):
        if token.startswith('"'):
            out.append(f'<span class="s">{esc(token)}</span>')
        elif token in keywords:
            out.append(f'<span class="k">{token}</span>')
        elif re.fullmatch(r"\d+(?:\.\d+)?", token):
            out.append(f'<span class="n">{token}</span>')
        elif token in NATIVE:
            out.append(f'<span class="f">{token}</span>')
        elif token in "[]":
            out.append(f'<span class="x">{token}</span>')
        elif token in ";,()=":
            out.append(f'<span class="p">{esc(token)}</span>')
        else:
            out.append(esc(token))
    return "".join(out)


bell_html = qasm_html(BELL)

# The workflow of the run in the hero, named as it was in n8n, and drawn as one set of line icons on a 24 px grid.
ICON = lambda body: f'<svg viewBox="0 0 24 24" aria-hidden="true">{body}</svg>'
DOT = 'fill="currentColor" stroke="none"'
ICONS = {
    "click": '<path d="M9 9 19.6 13l-4.9 1.7L13 19.6z"/><path d="M9 3.6v1.9M3.6 9h1.9M5.2 5.2l1.3 1.3"/>',
    "circuit": ('<path d="M3 8h3M12 8h9M3 16h18M16 8v11"/><rect x="6" y="5" width="6" height="6" rx="1.5"/>'
                f'<circle cx="16" cy="16" r="3"/><circle cx="16" cy="8" r="1.7" {DOT}/>'),
    "chip": ('<rect x="6" y="6" width="12" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.2"/>'
             '<path d="M10 3.5V6M14 3.5V6M10 18v2.5M14 18v2.5M3.5 10H6M3.5 14H6M18 10h2.5M18 14h2.5"/>'),
    "send": '<path d="M20.5 3.5 3.6 10.3l7.2 2.9 2.9 7.2z"/><path d="m10.8 13.2 4.6-4.6"/>',
    "wait": ('<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M8 3.5v2.4c0 1.4.6 2.6 1.6 3.4L12 12l-2.4 2.7c-1 .8-1.6 2-1.6 '
             '3.4v2.4M16 3.5v2.4c0 1.4-.6 2.6-1.6 3.4L12 12l2.4 2.7c1 .8 1.6 2 1.6 3.4v2.4"/>'
             f'<path d="M9.6 20.5c0-1.5 1-2.5 2.4-3 1.4.5 2.4 1.5 2.4 3z" {DOT}/>'),
    "metrics": '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5 14.6 10.9M10 3.5h4M12 3.5v3M17.6 7.9l1.2-1.2"/>',
    "edit": '<path d="M16 5a2.1 2.1 0 0 1 3 3L9 18l-4.5 1.5L6 15z"/><path d="m14.3 6.7 3 3M13 19.5h7"/>',
    "trigger": '<path d="M13.2 3 5.8 13.2h5.6L10.8 21l7.4-10.2h-5.6z"/>',
    "qubit": ('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12a8.5 3 0 0 1 17 0" stroke-opacity="0.4"/>'
              f'<path d="M3.5 12a8.5 3 0 0 0 17 0M12 12l3.2-4.6"/><circle cx="12" cy="12" r="1.2" {DOT}/>'
              f'<circle cx="15.8" cy="6.5" r="1.7" {DOT}/>'),
    "results": '<path d="M3.5 20.5h17M6.5 17.5V6.5M10.2 17.5v-2M13.8 17.5v-2M17.5 17.5V7.5"/>',
    "tool": '<path d="M10.5 4.5 12.3 9l4.5 1.8-4.5 1.8-1.8 4.5-1.8-4.5-4.5-1.8L8.7 9z"/><path d="M17.5 14.5v5M15 17h5"/>',
}
FLOW = [
    ("When clicking ‘Execute workflow’", ICON(ICONS["click"])),
    ("Build an ISA Bell circuit", ICON(ICONS["circuit"])),
    ("Pick the least busy QPU", ICON(ICONS["chip"])),
    ("Submit to Sampler", ICON(ICONS["send"])),
    ("Wait for the result", ICON(ICONS["wait"])),
    ("Read the metrics", ICON(ICONS["metrics"])),
    ("Summary", ICON(ICONS["edit"])),
]
TICK = '<i class="tick"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 10.2 2.8 2.8 5.2-5.6"/></svg></i>'
flow_html = "".join(
    f'<li><span class="node">{icon}{TICK}</span><span class="node-name">{esc(name)}</span></li>' for name, icon in FLOW)
peak = max(n for _, n in COUNTS)
LOW = ' class="low"'
hist_html = "".join(
    f'<div><b>{fmt(n)}</b><i style="--h: {max(n / peak * 100, 3):.1f}"{LOW if n < 1000 else ""}></i><span>{k}</span></div>'
    for k, n in COUNTS)

resource_html = []
panel_html = []
FIRST_RESOURCE = "Job"
for r in resources:
    slug = "ops-" + r["value"]
    pressed = "true" if r["name"] == FIRST_RESOURCE else "false"
    resource_html.append(f'<li><button type="button" data-tab="{slug}" aria-pressed="{pressed}" aria-controls="{slug}">'
                         f'{esc(r["name"])} <span>{len(r["operations"])}</span></button></li>')
    items = "".join(f'<li><h3>{esc(o["name"])}</h3><p>{esc(american(o["description"]))}</p></li>' for o in r["operations"])
    active = " active" if r["name"] == FIRST_RESOURCE else ""
    panel_html.append(f'<section class="panel{active}" id="{slug}" aria-label="{esc(r["name"])} operations">'
                      f'<ul class="op-list">{items}</ul></section>')

gate_chips = lambda names: "".join(f"<li><code>{n}</code></li>" for n in names)

TRIGGER_ON = ["Any Terminal (Completed, Failed or Canceled)", "Completed", "Failed", "Canceled", "Failed or Canceled"]
trigger_source = (repo / "nodes/IbmQuantum/IbmQuantumTrigger.node.ts").read_text()
assert all(f"name: '{t}'" in trigger_source or f"'{t}'" in trigger_source for t in TRIGGER_ON)
assert "default: 50," in trigger_source
assert "the first poll after the restart fires exactly the jobs that finished in between" in readme

AGENT = [
    ("Which QPU has the shortest queue right now?", "Backend › Get Least Busy"),
    ("Which Heron device will start my job soonest?", "Backend › Get Least Busy, Rank By an estimated wait, Processor Family Heron"),
    ("How much runtime is left on my instance?", "Account › Get Usage"),
    ("Which backends and session limits does my plan allow?", "Account › Get Account Configuration"),
    ("Did job d1abc finish?", "Job › Get Status, with Include Circuit Params off"),
]
for q, _ in AGENT:
    assert q in readme, q
agent_html = "".join(f'<li><p class="ask">{esc(q)}</p><p class="answer">{esc(a)}</p></li>' for q, a in AGENT)

HOSTS = [
    ("iam.cloud.ibm.com", "Exchanging the API key for a short-lived token"),
    ("quantum.cloud.ibm.com", "Qiskit Runtime, US East instances"),
    ("eu-de.quantum.cloud.ibm.com", "Qiskit Runtime, EU (Germany) instances"),
    ("resource-controller.cloud.ibm.com", "IBM Cloud Resource Controller, only for Get Many Instances and Set Cost Limit"),
]
security = (repo / "SECURITY.md").read_text()
assert all(f"| `{h}` |" in security for h, _ in HOSTS) and "Four hosts, and no others:" in security
assert "Every request the node itself issues carries a 30 second timeout." in security
hosts_html = "".join(f"<tr><td><code>{h.replace('.', '.<wbr>')}</code></td><td>{esc(u)}</td></tr>" for h, u in HOSTS)

GALLERY = [
    ("Build a circuit", "10-circuit-build", 1920,
     "The Build operation with its gate list, and the generated OpenQASM 3 in the output panel",
     "Gates go in one row at a time; the OpenQASM 3 program comes out, with its qubit, bit, gate and instruction counts."),
    ("Connect your account", "05-credentials", 1547,
     "The IBM Quantum API credential in n8n reporting a successful connection test",
     "Four fields: the API key, the instance CRN, the region and the API version. Test checks all four at once."),
    ("Read the result", "08-run-summary", 1920,
     "The final summary showing 4096 shots split between 00 and 11, and 3 QPU seconds charged",
     "The run from the top of this page, as n8n showed it: the counts, the backend, and 3 QPU seconds charged."),
    ("Give it to an agent", "04-ai-tool", 1547,
     "The IBM Quantum Tool attached to an OpenAI node, both showing a successful run",
     "Attached to a model node as IBM Quantum (Unofficial) Tool. The model called Get Instance Details and answered from the result."),
]
for _, name, width, alt, _ in GALLERY:
    assert alt in readme, alt
shot_tabs, shot_panels = [], []
for i, (label, name, width, alt, caption) in enumerate(GALLERY):
    slug = "shot-" + name.split("-", 1)[1]
    widths = sorted({800, 1200, min(1600, width)})
    srcset = ", ".join(f"images/{name}-{w}.webp {w}w" for w in widths)
    h = round(1050 * 1200 / width)
    shot_tabs.append(f'<li><button type="button" data-tab="{slug}" aria-pressed="{"true" if i == 0 else "false"}" aria-controls="{slug}">{esc(label)}</button></li>')
    shot_panels.append(f'''<figure class="panel shot{" active" if i == 0 else ""}" id="{slug}">
            <a href="images/{name}-{max(widths)}.webp"><img src="images/{name}-1200.webp" srcset="{srcset}" sizes="(max-width: 640px) calc(100vw - 32px), (max-width: 1124px) calc(100vw - 44px), 1080px" width="1200" height="{h}" loading="lazy" decoding="async" alt="{esc(alt)}"></a>
            <figcaption>{esc(caption)}</figcaption>
          </figure>''')

ARTICLES = [
    ("My IBM Quantum node for n8n is now live", "https://tuguidragos.com/ibm-quantum-node-for-n8n/",
     "The launch, the n8n verification, and what the three nodes do."),
    ("Running Quantum Circuits on Real IBM Hardware from n8n", "https://tuguidragos.com/quantum-circuits-ibm-hardware-n8n/",
     "An end-to-end Bell state on a real QPU, including the transpilation step that trips up most first attempts."),
    ("Six defects in a verified n8n node for IBM Quantum", "https://tuguidragos.com/six-defects-verified-n8n-node-ibm-quantum/",
     "What 121 seconds of real QPU time found that green tests and 98 percent coverage could not."),
    ("One circuit, two IBM Quantum error codes: 1506 and 1603", "https://tuguidragos.com/ibm-quantum-error-code-1506-1603/",
     "The same rejected program, submitted twenty times, came back as one code eleven times and as the other nine."),
]
for title, url, _ in ARTICLES:
    assert f"[{title}]({url})" in readme, title
articles_html = "".join(f'<li><a href="{u}"><h3>{esc(t)}</h3><p>{esc(d)}</p></a></li>' for t, u, d in ARTICLES)

FAQ = [
    ("What is n8n-nodes-ibm-quantum?",
     "An unofficial, community-maintained n8n node for the IBM Quantum Platform. It builds OpenQASM 3 circuits, submits "
     "them to Qiskit Runtime on real IBM hardware, reads the results, and starts workflows when jobs finish. n8n has "
     "verified it."),
    ("Is it made by IBM?",
     "No. It is unofficial and community-maintained, and it is not affiliated with, endorsed by, or sponsored by IBM. "
     "Every node carries an (Unofficial) marker in the n8n picker."),
    ("Does it work on n8n Cloud?",
     "Yes. It is verified by n8n, so it installs on n8n Cloud as well as on self-hosted n8n: open the community nodes "
     "screen and enter the package name, <code>n8n-nodes-ibm-quantum</code>."),
    ("What do I need to use it?",
     "An IBM Cloud account with access to the IBM Quantum Platform, an IBM Cloud API key, and the Cloud Resource Name "
     "(CRN) of your Qiskit Runtime instance. Self-hosted n8n needs Node.js 24 from n8n 2.36 on; Node.js 22 is enough "
     "for n8n 2.35 and older."),
    ("Do I need Qiskit?",
     "Not to run the node: it has zero runtime dependencies. Real hardware accepts only transpiled circuits, though, so "
     "for anything beyond the native gates you transpile locally with Qiskit, free on any plan, and pass the result in."),
    ("Why did my job fail with reason code 1517?",
     "The circuit was not transpiled to the backend’s native gates, or a two-qubit gate landed on a pair the chip does "
     "not connect. Build it from native gates, or transpile it for the exact device you submit to. The node warns "
     "about both before the job is queued."),
    ("Is there a simulator?",
     "No. IBM retired its cloud simulators on May 15, 2024, so every backend is real hardware. To try a circuit without "
     "spending quota, simulate it locally with Qiskit first."),
    ("Can an AI Agent use it?",
     "Yes. The action node is usable as an n8n AI Agent tool, and on n8n 1.85.0 or newer nothing extra is needed. It "
     "fits questions best, such as which QPU has the shortest queue or how much runtime is left."),
    ("Is it free?",
     "The node is free and open source under the MIT License. Jobs use your IBM Quantum plan: the Open plan gives 600 "
     "seconds of QPU time per rolling 28 days, and a failed job still spends some of it."),
]
assert "IBM retired its cloud simulators on 15 May 2024" in readme
assert "on n8n 1.85.0 or newer nothing extra is needed for the tool" in readme
assert "n8n has required Node 24 since 2.36 (August 2026); Node.js 22 (22.22 or newer) is enough only for n8n 2.35 and older" in readme
faq_html = "\n".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in FAQ)
plain = lambda text: html.unescape(re.sub(r"<[^>]+>", "", text))

PERSON = "https://tuguidragos.com/#person"
SAME_AS = [
    "https://www.linkedin.com/in/tuguidragos/", "https://github.com/TuguiDragos", "https://x.com/TuguiDragos",
    "https://www.facebook.com/TuguiDragos/", "https://www.instagram.com/tuguidragos/",
    "https://n8n.io/creators/tuguidragos/", "https://www.credly.com/users/tuguidragos",
    "https://tuguidragos.gumroad.com", "https://bsky.app/profile/tuguidragos.com", "https://mastodon.social/@tuguidragos",
    "https://www.threads.com/@tuguidragos", "https://www.tiktok.com/@tuguidragos", "https://www.youtube.com/@TuguiDragos",
]
PROFILES = [
    ("GitHub", "https://github.com/TuguiDragos"), ("LinkedIn", "https://www.linkedin.com/in/tuguidragos/"),
    ("X", "https://x.com/TuguiDragos"), ("n8n", "https://n8n.io/creators/tuguidragos/"),
    ("Bluesky", "https://bsky.app/profile/tuguidragos.com"), ("Mastodon", "https://mastodon.social/@tuguidragos"),
    ("Instagram", "https://www.instagram.com/tuguidragos/"), ("YouTube", "https://www.youtube.com/@TuguiDragos"),
]
MIT = "https://spdx.org/licenses/MIT.html"
version = json.loads((repo / "package.json").read_text())["version"]
ld = {
    "@context": "https://schema.org",
    "@graph": [
        {"@type": "WebSite", "@id": SITE + "#website", "url": SITE, "name": PACKAGE, "inLanguage": "en-US",
         "publisher": {"@id": PERSON}},
        {"@type": "WebPage", "@id": SITE + "#webpage", "url": SITE, "name": TITLE, "description": DESCRIPTION,
         "inLanguage": "en-US", "isPartOf": {"@id": SITE + "#website"}, "about": {"@id": SITE + "#app"},
         "mainEntity": {"@id": SITE + "#app"}, "primaryImageOfPage": SITE + "images/social.png",
         "dateModified": datetime.date.today().isoformat()},
        {"@type": "Person", "@id": PERSON, "name": "Țugui Dragoș",
         "alternateName": ["Tugui Dragos", "Țugui Dragoș-Constantin", "Tugui Dragos-Constantin", "Dragoș Țugui",
                           "Dragos Tugui"],
         "url": "https://tuguidragos.com/", "image": "https://tuguidragos.com/content/images/2026/06/Dragos-Tugui.webp",
         "jobTitle": "Automation & AI Systems Builder", "sameAs": SAME_AS},
        {"@type": "SoftwareApplication", "@id": SITE + "#app", "name": PACKAGE, "alternateName": "IBM Quantum (Unofficial)",
         "url": SITE, "sameAs": [REPO, NPM],
         "description": "A verified n8n community node for IBM Quantum: build OpenQASM 3 circuits, submit "
                                     "them to Qiskit Runtime on real IBM hardware, and trigger workflows on job "
                                     "completion or failure. Unofficial, and not affiliated with IBM.",
         "applicationCategory": "DeveloperApplication", "applicationSubCategory": "Workflow automation node",
         "operatingSystem": "n8n Cloud or self-hosted n8n",
         "softwareRequirements": "n8n with community nodes; an IBM Cloud API key and a Qiskit Runtime instance",
         "softwareVersion": version, "releaseNotes": f"{REPO}/blob/main/CHANGELOG.md",
         "downloadUrl": NPM, "installUrl": N8N_INSTALL, "isAccessibleForFree": True,
         "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}, "license": MIT,
         "author": {"@id": PERSON}, "image": SITE + "images/social.png",
         "featureList": [
             f"{op_count} operations across {len(resources)} resources: {resource_names}",
             "A polling trigger that fires when a job completes, fails or is canceled, with the failure reason",
             "Usable as an n8n AI Agent tool",
             "Circuits built from a gate list as OpenQASM 3, with symbolic parameters",
             "Warnings before submission for gates or qubit pairs the chosen backend cannot run",
             "Sessions and batches, cost caps, and usage analytics",
             "Zero runtime dependencies"]},
        {"@type": "SoftwareSourceCode", "@id": "https://tuguidragos.com/#n8n-nodes-ibm-quantum", "name": PACKAGE,
         "url": NPM, "codeRepository": REPO, "programmingLanguage": "TypeScript", "runtimePlatform": "Node.js",
         "license": MIT, "dateCreated": "2026-06-24", "author": {"@id": PERSON}, "maintainer": {"@id": PERSON},
         "targetProduct": {"@id": SITE + "#app"},
         "subjectOf": [{"@type": "Article", "headline": t, "url": u} for t, u, _ in ARTICLES]},
        {"@type": "FAQPage", "@id": SITE + "#questions", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": plain(a)}} for q, a in FAQ]},
    ],
}
ld_json = json.dumps(ld, ensure_ascii=False, indent=2).replace("</", "<\\/")

GITHUB_MARK = ('<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"/></svg>')
HEART = ('<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.655 14.916v-.001h-.002l-.006-.003-.018-.01a22.066 22.066 0 0 1-3.744-2.584C2.045 10.731 0 8.35 0 5.5 0 2.836 2.086 1 4.25 1 5.797 1 7.153 1.802 8 3.02 8.847 1.802 10.203 1 11.75 1 13.914 1 16 2.836 16 5.5c0 2.85-2.044 5.231-3.886 6.818a22.094 22.094 0 0 1-3.433 2.414 7.152 7.152 0 0 1-.31.17l-.018.01-.008.004a.75.75 0 0 1-.69 0Z"/></svg>')
PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.4-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z"/></svg>'
profile_items = "\n".join(f'          <li><a href="{u}">{n}</a></li>' for n, u in PROFILES)
run_label = (f"A seven-node n8n workflow, from a manual trigger through Build an ISA Bell circuit, Pick the least busy QPU, "
             f"Submit to Sampler, Wait for the result and Read the metrics to Summary, and its result: a Bell state on "
             f"ibm_marrakesh, {fmt(2066)} shots of 00 and {fmt(1950)} of 11 out of {fmt(4096)}, for 3 QPU seconds.")

page = f"""<!DOCTYPE html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{TITLE}</title>
  <meta name="description" content="{esc(DESCRIPTION)}">
  <link rel="canonical" href="{SITE}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <meta name="author" content="Țugui Dragoș">
  <meta name="application-name" content="{PACKAGE}">
  <meta name="apple-mobile-web-app-title" content="IBM Quantum">
  <meta name="theme-color" content="#10121c">
  <meta name="color-scheme" content="dark">

  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/favicon-96x96.png" type="image/png" sizes="96x96">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">

  <script>document.documentElement.classList.add("js")</script>
  <link rel="stylesheet" href="style.css">
  <script src="main.js" defer></script>

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="{PACKAGE}">
  <meta property="og:locale" content="en_US">
  <meta property="og:url" content="{SITE}">
  <meta property="og:title" content="IBM Quantum, inside n8n">
  <meta property="og:description" content="A verified n8n community node: build circuits, run them on real IBM quantum hardware, and act on the result. Unofficial.">
  <meta property="og:image" content="{SITE}images/social.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="The words “IBM Quantum, inside n8n” beside the counts of a Bell state measured on ibm_marrakesh">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="IBM Quantum, inside n8n">
  <meta name="twitter:description" content="A verified n8n community node: build circuits, run them on real IBM quantum hardware, and act on the result. Unofficial.">
  <meta name="twitter:image" content="{SITE}images/social.png">
  <meta name="twitter:image:alt" content="The words “IBM Quantum, inside n8n” beside the counts of a Bell state measured on ibm_marrakesh">

  <script type="application/ld+json">
{ld_json}
  </script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>

  <header class="nav">
    <div class="wrap">
      <a class="brand" href="#top" aria-label="n8n-nodes-ibm-quantum, back to the top">{PACKAGE}</a>
      <nav aria-label="Sections">
        <ul class="nav-links">
          <li><a href="#operations">Operations</a></li>
          <li><a href="#hardware">Hardware</a></li>
          <li><a href="#triggers">Triggers</a></li>
          <li><a href="#agent">AI Agent</a></li>
          <li><a href="#tested">Tested</a></li>
          <li><a href="#questions">Questions</a></li>
        </ul>
      </nav>
      <div class="nav-actions">
        <a class="pill pill-small pill-ghost" href="{SPONSOR}" aria-label="Sponsor n8n-nodes-ibm-quantum on GitHub">{HEART}<span class="label">Sponsor</span></a>
        <a class="pill pill-small" href="{REPO}">{GITHUB_MARK}GitHub</a>
      </div>
    </div>
  </header>

  <main id="main">
    <section class="hero" id="top">
      <div class="wrap">
        <p class="badge">Verified n8n community node</p>
        <h1>IBM Quantum, inside&nbsp;n8n.</h1>
        <p class="tagline"><span class="gradient">Build a circuit. Run it on a real QPU. Act on the result.</span></p>
        <p class="lede">Build, run and retrieve quantum circuits on the IBM Quantum Platform, straight from n8n. Verified by n8n, so it installs on n8n Cloud as well as self-hosted.</p>
        <p class="install-label" id="install-label">On n8n’s community nodes screen, enter</p>
        <div class="command" role="group" aria-labelledby="install-label">
          <code>{PACKAGE}</code>
          <button class="copy" type="button" data-copy="{PACKAGE}">Copy</button>
        </div>
        <div class="actions">
          <a class="pill pill-large" href="{REPO}">{GITHUB_MARK}View on GitHub</a>
          <a class="more" href="{VIDEO}">Watch the setup and first run</a>
        </div>
        <p class="requirements">n8n Cloud or self-hosted · Free, MIT License · Unofficial, not affiliated with IBM</p>
        <figure class="run">
          <div class="run-card" role="img" aria-label="{esc(run_label)}">
            <div class="run-head" aria-hidden="true"><span>IBM Quantum: build, submit, read results</span><span class="run-meta">ibm_marrakesh · Aug 21, 2026</span></div>
            <ol class="flow" aria-hidden="true">{flow_html}</ol>
            <div class="result" aria-hidden="true">
              <div class="hist">{hist_html}</div>
              <dl class="summary">
                <div><dt>Backend</dt><dd>ibm_marrakesh</dd></div>
                <div><dt>Shots</dt><dd>{fmt(4096)}</dd></div>
                <div><dt>QPU seconds</dt><dd>3</dd></div>
                <div><dt>Gates</dt><dd>12</dd></div>
              </dl>
            </div>
          </div>
          <figcaption>A real run, job <code>{RUN_JOB}</code>: {fmt(2066)} shots read <code>00</code> and {fmt(1950)} read <code>11</code>, the two outcomes a Bell state should give. The other {NOISE} are device error.</figcaption>
        </figure>
      </div>
    </section>

    <section class="statement" aria-label="What the node needs">
      <div class="wrap reveal">
        <p><strong>Zero runtime dependencies.</strong> No Qiskit, no quantum library, nothing to compile. Circuits travel as OpenQASM 3 text, and <strong>your API key becomes a short-lived token that n8n refreshes on its own.</strong></p>
      </div>
    </section>

    <section class="section" aria-labelledby="highlights-title">
      <div class="wrap">
        <h2 class="headline center reveal" id="highlights-title">Get the highlights.</h2>
        <div class="highlights">
          <article class="tile span-3 reveal">
            <div class="tile-art" aria-hidden="true"><span class="figure gradient">{op_count}</span></div>
            <h3>{op_count} operations.</h3>
            <p>Across {RESOURCES} resources: {resource_names}.</p>
          </article>
          <article class="tile span-3 reveal">
            <div class="tile-art" aria-hidden="true"><span class="trio"><i>{ICON(ICONS['qubit'])}</i><i>{ICON(ICONS['trigger'])}</i><i>{ICON(ICONS['tool'])}</i></span></div>
            <h3>Three entries.</h3>
            <p>In the n8n picker: an action, a trigger for finished jobs, and an AI Agent tool that n8n builds from the action.</p>
          </article>
          <article class="tile reveal">
            <div class="tile-art" aria-hidden="true"><span class="figure gradient">{JOBS}</span></div>
            <h3>Hardware jobs.</h3>
            <p>Run through the node on {word(len(DEVICES))} IBM Heron devices, every one listed in the testing record.</p>
          </article>
          <article class="tile reveal">
            <div class="tile-art" aria-hidden="true"><span class="figure gradient">{fmt(tests)}</span></div>
            <h3>Tests.</h3>
            <p>With 100% coverage of the node’s logic, enforced by CI rather than reported.</p>
          </article>
          <article class="tile reveal">
            <div class="tile-art" aria-hidden="true"><span class="figure gradient">0</span></div>
            <h3>Dependencies.</h3>
            <p>At runtime. No Qiskit, no quantum library, nothing to compile.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="operations" aria-labelledby="operations-title">
      <div class="wrap center">
        <div class="feature-head center reveal">
          <p class="eyebrow">Operations</p>
          <h2 class="headline" id="operations-title">{RESOURCES.capitalize()} resources. {op_count} operations.</h2>
          <p class="lede">Pick a resource to see what it does, in the words n8n shows. <strong>Backend fields are dropdowns filled from your own account,</strong> labeled like <code>ibm_kingston (Heron r2, online, 290 queued)</code>.</p>
        </div>
        <div class="ops reveal">
          <ul class="chips tabs" data-tabs aria-label="Resources">{''.join(resource_html)}</ul>
          {''.join(panel_html)}
        </div>
      </div>
    </section>

    <hr class="divider">

    <section class="section" id="hardware" aria-labelledby="hardware-title">
      <div class="wrap center">
        <div class="feature-head center reveal">
          <p class="eyebrow">Real hardware</p>
          <h2 class="headline" id="hardware-title">A real chip runs only its own gates.</h2>
          <p class="lede">The Qiskit Runtime REST API does not transpile. <strong>A textbook <code>h</code> or <code>cx</code> is queued, then fails with reason code 1517,</strong> and a failed job still spends quota.</p>
        </div>
        <div class="gates reveal">
          <div class="gate-group native"><h3>Runs as-is on Heron <span>{len(NATIVE)}</span></h3><ul>{gate_chips(NATIVE)}</ul></div>
          <div class="gate-group transpile"><h3>Transpile first <span>{len(TRANSPILE)}</span></h3><ul>{gate_chips(TRANSPILE)}</ul></div>
          <div class="gate-group dropped"><h3>Accepted, writes nothing <span>{len(DROPPED)}</span></h3><ul>{gate_chips(DROPPED)}</ul><p>IBM lists <code>id</code> as native, yet a job carrying it fails, so the node leaves it out of the program.</p></div>
        </div>
        <p class="note reveal">The {len(palette)} entries of the Circuit › Build palette. Every OpenQASM 3 Submit reads the chosen backend’s basis gates and coupling map first, and warns about an instruction or a qubit pair the device cannot run before the job is queued.</p>
        <div class="recipe reveal">
          <div class="recipe-text">
            <h3>Build it native.</h3>
            <p>Two identities turn a Bell state into gates the chip runs, with no transpiler at all:</p>
            <p class="identity"><code>H = rz(π/2) · sx · rz(π/2)</code><code>CNOT = H · cz · H</code></p>
            <p>Measured on <code>ibm_fez</code> over 2,048 shots: <strong>48.7% <code>00</code> and 46.2% <code>11</code>.</strong></p>
          </div>
          <figure class="code"><figcaption>Circuit › Build, 12 gates</figcaption><pre><code>{bell_html}</code></pre></figure>
        </div>
        <div class="recipe reveal">
          <div class="recipe-text">
            <h3>Or transpile it, free.</h3>
            <p>Transpile locally with Qiskit, on any plan, then paste the result into the node. A fake backend carries the real device’s topology and gates, so no credentials are needed.</p>
            <p>Pin the Submit to the device you transpiled for.</p>
          </div>
          <figure class="code"><figcaption>Python, with Qiskit</figcaption><pre><code>{COLORED['transpile']}</code></pre></figure>
        </div>
      </div>
    </section>

    <section class="section" id="triggers" aria-labelledby="triggers-title">
      <div class="wrap center">
        <div class="feature-head center reveal">
          <p class="eyebrow">Long-running jobs</p>
          <h2 class="headline" id="triggers-title">Submit now. React when it’s done.</h2>
          <p class="lede">A hardware job can sit in the queue for hours, and IBM offers no push or callback, so something has to poll. <strong>The trigger polls on n8n’s scheduler, not inside a held-open execution.</strong></p>
        </div>
        <div class="patterns">
          <article class="pattern reveal">
            <h3 class="pattern-name">Workflow one</h3>
            <ol class="mini-flow" aria-label="Workflow one: Build, then Submit to Sampler">
              <li><span class="node">{ICON(ICONS['circuit'])}</span><span class="node-name">Build</span></li>
              <li><span class="node">{ICON(ICONS['send'])}</span><span class="node-name">Submit to Sampler</span></li>
            </ol>
            <p>Submits and finishes at once, with the <code>jobId</code>. Nothing blocks.</p>
          </article>
          <article class="pattern reveal">
            <h3 class="pattern-name">Workflow two, active</h3>
            <ol class="mini-flow" aria-label="Workflow two: the IBM Quantum trigger, then Get Results">
              <li class="trigger"><span class="node">{ICON(ICONS['trigger'])}</span><span class="node-name">IBM Quantum Trigger</span></li>
              <li><span class="node">{ICON(ICONS['results'])}</span><span class="node-name">Get Results</span></li>
            </ol>
            <p>Fires when a job reaches a terminal state. Get Results returns at once, because the job is already done.</p>
          </article>
        </div>
        <div class="trigger-facts reveal">
          <h3>Trigger On</h3>
          <ul class="chips static">{''.join(f'<li>{esc(t)}</li>' for t in TRIGGER_ON)}</ul>
          <ul class="facts">
            <li><strong>Failed or Canceled</strong> is for alerting: every event carries <code>reason</code>, <code>reasonCode</code> and <code>reasonSolution</code>, so a workflow can page someone or resubmit elsewhere.</li>
            <li><strong>Restarts are safe.</strong> The jobs already fired live in the workflow’s static data, so a restart repeats none of them, and its first poll fires the ones that finished while n8n was down, up to Jobs to Scan.</li>
            <li><strong>Tags keep workflows apart.</strong> Set them on Submit and filter on them in the trigger, and each workflow reacts only to its own jobs.</li>
          </ul>
        </div>
      </div>
    </section>

    <hr class="divider">

    <section class="section" id="agent" aria-labelledby="agent-title">
      <div class="wrap center">
        <div class="feature-head center reveal">
          <p class="eyebrow">AI Agent tool</p>
          <h2 class="headline" id="agent-title">Ask it in plain words.</h2>
          <p class="lede">Attach the node to an n8n AI Agent and the model calls its operations directly. <strong>It fits questions best,</strong> where the agent asks and gets a structured answer.</p>
        </div>
        <ul class="asks reveal">{agent_html}</ul>
        <p class="note reveal">Submission works too, but on hardware the agent has to supply a transpiled circuit, so pair it with a circuit built beforehand rather than asking the model to write one.</p>
      </div>
    </section>

    <section class="section" id="quota" aria-labelledby="quota-title">
      <div class="wrap center">
        <div class="feature-head center reveal">
          <p class="eyebrow">Quota</p>
          <h2 class="headline" id="quota-title">QPU seconds are the budget.</h2>
          <p class="lede">The Open plan gives 600 seconds of QPU time per rolling 28 days, <strong>and a failed job still spends some of it.</strong> The node gives you the brakes.</p>
        </div>
        <ul class="cards">
          <li class="reveal"><h3>Max Cost</h3><p>Caps what one job may spend. Left at zero, IBM stamps the job with the plan maximum, on the Open plan all 600 seconds, so set a real number.</p></li>
          <li class="reveal"><h3>Set Cost Limit</h3><p>A ceiling for every job on the instance, written through IBM Cloud’s Resource Controller and read back from it. Clear Limit returns the instance to the plan default, on the Open plan 600 seconds.</p></li>
          <li class="reveal"><h3>Sessions and batches</h3><p>Keep the jobs of a hybrid loop together instead of sending each back to the general queue. Batch is the only mode the Open plan allows.</p></li>
          <li class="reveal"><h3>Usage</h3><p>Get Usage compares seconds consumed with the limit; the analytics operations break the spend down by backend, plan, user or date.</p></li>
        </ul>
      </div>
    </section>

    <hr class="divider">

    <section class="section" id="editor" aria-labelledby="editor-title">
      <div class="wrap center">
        <div class="feature-head center reveal">
          <p class="eyebrow">In the editor</p>
          <h2 class="headline" id="editor-title">What it looks like in n8n.</h2>
        </div>
        <div class="gallery reveal">
          <ul class="chips tabs" data-tabs aria-label="Screenshots">{''.join(shot_tabs)}</ul>
          {''.join(shot_panels)}
        </div>
      </div>
    </section>

    <section class="section" id="tested" aria-labelledby="tested-title">
      <div class="wrap center">
        <div class="feature-head center reveal">
          <p class="eyebrow">Tested</p>
          <h2 class="headline" id="tested-title">Run on real hardware, and written down.</h2>
          <p class="lede">Every job this project has run on IBM hardware through the node is in its testing record, <strong>failed and canceled ones included:</strong> most of those were sent to measure exactly how IBM refuses something.</p>
        </div>
        <div class="stats">
          <div class="stat reveal"><h3>{JOBS} jobs</h3><p>{COMPLETED} completed, {FAILED} failed and {CANCELED} canceled, between {SPAN}.</p></div>
          <div class="stat reveal"><h3>{fmt(QPU_S)} QPU seconds</h3><p>{QPU_MIN} minutes of real device time, as IBM charged it.</p></div>
          <div class="stat reveal"><h3>{len(DEVICES)} Heron r2 devices</h3><p>{series([f"<code>{d}</code>" for d in DEVICES])}, {QUBITS} qubits each.</p></div>
          <div class="stat reveal"><h3>{fmt(tests)} unit tests</h3><p>In {test_files} files, holding the node’s logic at 100% of statements, branches, functions and lines, a gate CI enforces.</p></div>
        </div>
        <p class="note reveal"><a class="more" href="{REPO}/blob/main/TESTING.md">The testing record, job by job</a></p>
      </div>
    </section>

    <hr class="divider">

    <section class="section" id="security" aria-labelledby="security-title">
      <div class="wrap center">
        <div class="feature-head center reveal">
          <p class="eyebrow">Security</p>
          <h2 class="headline" id="security-title">Four hosts, and no others.</h2>
          <p class="lede">n8n keeps your API key as an encrypted credential. <strong>The node reads it in one place,</strong> to exchange it with IBM for a short-lived token, and every API call it makes after that has a 30-second timeout.</p>
        </div>
        <div class="table-wrap reveal">
          <table>
            <thead><tr><th scope="col">Host</th><th scope="col">Used for</th></tr></thead>
            <tbody>{hosts_html}</tbody>
          </table>
        </div>
        <p class="note reveal"><a class="more" href="{REPO}/blob/main/SECURITY.md">Read the security policy</a></p>
      </div>
    </section>

    <section class="section" id="learn" aria-labelledby="learn-title">
      <div class="wrap center">
        <div class="feature-head center reveal">
          <p class="eyebrow">Watch and read</p>
          <h2 class="headline" id="learn-title">From setup to the first result.</h2>
        </div>
        <a class="video reveal" href="{VIDEO}"><span class="play">{PLAY}</span><span><strong>Setting up and running the IBM Quantum node</strong><span>A full walkthrough on YouTube: the credential, the nodes, and a circuit run end to end.</span></span></a>
        <ul class="articles">{articles_html.replace('<li>', '<li class="reveal">')}</ul>
      </div>
    </section>

    <hr class="divider">

    <section class="section" id="questions" aria-labelledby="questions-title">
      <div class="wrap">
        <h2 class="headline center reveal" id="questions-title">Questions.</h2>
        <div class="faq reveal">
{faq_html}
        </div>
      </div>
    </section>

    <section class="closing" aria-labelledby="get-title">
      <div class="wrap reveal">
        <h2 class="headline" id="get-title">Put IBM Quantum in a workflow.</h2>
        <p class="lede">Free and open source, under the MIT License.</p>
        <div class="command" role="group" aria-label="The package name to enter in n8n">
          <code>{PACKAGE}</code>
          <button class="copy" type="button" data-copy="{PACKAGE}">Copy</button>
        </div>
        <div class="actions">
          <a class="more" href="{NPM}">npm</a>
          <a class="more" href="{N8N_INSTALL}">Installing community nodes</a>
          <a class="more" href="{REPO}/blob/main/CHANGELOG.md">What’s new in {version}</a>
        </div>
        <a class="pill pill-ghost sponsor" href="{SPONSOR}">{HEART}Sponsor on GitHub</a>
      </div>
    </section>
  </main>

  <footer>
    <div class="wrap">
      <nav aria-label="More about n8n-nodes-ibm-quantum">
        <ul>
          <li><a href="{REPO}">Source code</a></li>
          <li><a href="{NPM}">npm</a></li>
          <li><a href="{REPO}/blob/main/TESTING.md">Testing record</a></li>
          <li><a href="{REPO}/blob/main/CHANGELOG.md">Changelog</a></li>
          <li><a href="{REPO}/issues">Report an issue</a></li>
          <li><a href="{SPONSOR}">Sponsor</a></li>
        </ul>
      </nav>
      <p class="maker">Made by <a href="https://tuguidragos.com/">Țugui Dragoș</a>.</p>
      <nav aria-label="Țugui Dragoș elsewhere">
        <ul>
{profile_items}
        </ul>
      </nav>
      <p>Copyright © 2026 Țugui Dragoș. n8n-nodes-ibm-quantum is free software under the <a href="{REPO}/blob/main/LICENSE">MIT License</a>.</p>
      <p>Unofficial and community-maintained. Not affiliated with, endorsed by, or sponsored by IBM. IBM Quantum and Qiskit are trademarks of International Business Machines Corporation.</p>
    </div>
  </footer>
</body>
</html>
"""
page = "\n".join(line.rstrip() for line in page.split("\n"))
# The page is dated by what it says, not by when it was built. When the published page says exactly the same, its date
# stands, so a push that changes nothing here does not tell search engines that the page changed.
DATED = re.compile(r'"dateModified": "\d{4}-\d\d-\d\d"')
modified = datetime.date.today().isoformat()
try:
    with urllib.request.urlopen(SITE, timeout=20) as response:
        published = response.read().decode()
    if DATED.sub("", published) == DATED.sub("", page):
        modified = re.search(r'"dateModified": "(\d{4}-\d\d-\d\d)"', published).group(1)
except (OSError, ValueError, AttributeError):
    pass
page = DATED.sub(f'"dateModified": "{modified}"', page)
(WORK / "modified.txt").write_text(modified)
out_dir.mkdir(parents=True, exist_ok=True)
(out_dir / "index.html").write_text(page, encoding="utf-8")
british = sorted(set(re.findall(r"\b(analyse|analysed|analyser\w*|behaviour|colour\w*|licence|modell\w*|labell\w*|cancell(?!ation)\w*|recognis\w*|organis\w*|optimis\w*|summaris\w*|initialis\w*|normalis\w*|characteris\w*)\b", re.sub(r"<[^>]+>", " ", re.sub(r"<pre.*?</pre>", "", page, flags=re.S)))))
assert not british, f"American English on the page, but it reads {british}"
print(f"index.html: {tests:,} tests, {op_count} operations, {JOBS} hardware jobs, version {version}")
