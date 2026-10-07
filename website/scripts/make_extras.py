"""Writes the small files around the page: manifest, robots, sitemap, llms.txt, CNAME and .nojekyll."""
import json
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
site, ops = WEB / "_site", json.loads((WEB / "_build/ops.json").read_text())
SITE = "https://n8n-nodes-ibm-quantum.tuguidragos.com/"
RAW = "https://raw.githubusercontent.com/TuguiDragos/n8n-nodes-ibm-quantum/main/"
(site / "site.webmanifest").write_text(json.dumps({
    "name": "n8n-nodes-ibm-quantum", "short_name": "IBM Quantum",
    "description": "A verified n8n community node for IBM Quantum. Unofficial.",
    "start_url": "/", "display": "browser", "background_color": "#10121c", "theme_color": "#10121c",
    "icons": [{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
              {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}],
}, indent=2) + "\n")
(site / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE}sitemap.xml\n")
(site / "sitemap.xml").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/css" href="/sitemap.css"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{SITE}</loc>
    <lastmod>{(WEB / "_build/modified.txt").read_text()}</lastmod>
  </url>
</urlset>
""")
(site / "CNAME").write_text("n8n-nodes-ibm-quantum.tuguidragos.com\n")
(site / ".nojekyll").write_text("")
resource_lines = "\n".join(f"- {r['name']}: " + ", ".join(o["name"] for o in r["operations"]) for r in ops["resources"])
total = sum(len(r["operations"]) for r in ops["resources"])
(site / "llms.txt").write_text(f"""# n8n-nodes-ibm-quantum

> A verified n8n community node for IBM Quantum: build OpenQASM 3 circuits, submit them to real quantum hardware through the Qiskit Runtime REST API on IBM Cloud, read the results, and trigger workflows when jobs complete or fail. Unofficial and community-maintained; not affiliated with, endorsed by, or sponsored by IBM.

It installs from n8n's community nodes screen as `n8n-nodes-ibm-quantum`, on n8n Cloud as well as self-hosted, and has zero runtime dependencies. It needs an IBM Cloud API key and the CRN of a Qiskit Runtime instance. The Qiskit Runtime REST API does not transpile, so real hardware runs only ISA circuits: native gates on qubit pairs the backend connects. IBM queues a non-ISA circuit and then fails it with reason code 1517, and a failed job still spends quota. The free Open plan gives 600 seconds of QPU time per rolling 28 days and allows batch sessions only. It is free software under the MIT License, by Țugui Dragoș.

## Operations

{total} operations across {len(ops["resources"])} resources, plus a polling trigger that fires when a job reaches a terminal state. The action node is usable as an n8n AI Agent tool.

{resource_lines}

## Docs

- [Complete AI reference]({RAW}llms-full.txt): every node, operation, parameter (internal names), output shape, error code and workflow pattern, in one file
- [README]({RAW}README.md): the guide, with transpilation and troubleshooting
- [Testing record]({RAW}TESTING.md): every job run on IBM hardware through the node
- [Security policy]({RAW}SECURITY.md): what the node can access, and the four hosts it calls
- [Changelog]({RAW}CHANGELOG.md): release history

## Optional

- [npm](https://www.npmjs.com/package/n8n-nodes-ibm-quantum): the package
- [Setup walkthrough](https://youtu.be/6ppR6uCt1_o): the credential, the nodes, and a circuit run end to end
- [Source code](https://github.com/TuguiDragos/n8n-nodes-ibm-quantum)
- [Sponsor](https://github.com/sponsors/TuguiDragos): GitHub Sponsors
- [Author](https://tuguidragos.com/about/): Țugui Dragoș
""")
print("site.webmanifest, robots.txt, sitemap.xml, llms.txt, CNAME, .nojekyll")
