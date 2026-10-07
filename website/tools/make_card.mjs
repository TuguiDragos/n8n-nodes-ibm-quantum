// Renders the share image at the two sizes needed: 1200x630 for the site, 1280x640 for GitHub's social preview. It sets
// the page's promise beside the counts of the real run on ibm_marrakesh. Run it again only when the wording changes:
// npm install --no-save --prefix website playwright@1, npx --prefix website playwright install chromium, then
// node website/tools/make_card.mjs from the repository root.
import { chromium } from "playwright";
const counts = [["00", 2066], ["01", 27], ["10", 53], ["11", 1950]];
const peak = Math.max(...counts.map(([, n]) => n));
const card = (w, h) => `<!DOCTYPE html><html><head><style>
  body { margin: 0; width: ${w}px; height: ${h}px; display: grid; grid-template-columns: 1.15fr 1fr; align-items: center; gap: 40px; box-sizing: border-box; padding: 0 80px;
    background: radial-gradient(ellipse 70% 80% at 80% 50%, rgba(145,132,217,.22), rgba(145,132,217,0)), #10121c; color: #eeeef4;
    font-family: Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .badge { display: inline-block; padding: 8px 16px; border-radius: 999px; background: rgba(168,156,228,.14); box-shadow: inset 0 0 0 1.5px rgba(168,156,228,.35); color: #cbc3f3; font-size: 22px; font-weight: 600; }
  h1 { margin: 26px 0 0; font-size: 76px; line-height: 1.02; letter-spacing: -0.03em; font-weight: 700; }
  p { margin: 22px 0 0; color: #a9abc0; font-size: 26px; line-height: 1.35; }
  code { color: #eeeef4; font-family: "DejaVu Sans Mono", monospace; font-size: 24px; }
  .chart { padding: 30px 34px 26px; border-radius: 26px; background: linear-gradient(180deg,#161a2c,#10131f); box-shadow: 0 0 0 1.5px rgba(210,212,236,.14), 0 30px 70px rgba(0,0,0,.5); }
  .head { display: flex; justify-content: space-between; color: #a9abc0; font-size: 20px; font-weight: 600; }
  .head span:last-child { font-family: "DejaVu Sans Mono", monospace; font-weight: 400; }
  .bars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; height: 260px; margin-top: 26px; align-items: end; }
  .bars div { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  b { font-family: "DejaVu Sans Mono", monospace; font-size: 20px; font-weight: 500; }
  i { display: block; width: 64px; margin-top: 8px; border-radius: 8px 8px 3px 3px; background: linear-gradient(180deg,#b3a8ee,#9184d9); }
  i.low { background: #4a4f75; }
  span.k { margin-top: 10px; color: #a9abc0; font-family: "DejaVu Sans Mono", monospace; font-size: 20px; }
  .foot { margin-top: 18px; color: #a9abc0; font-size: 19px; text-align: center; }
</style></head><body>
  <div>
    <span class="badge">Verified n8n community node</span>
    <h1>IBM Quantum, inside n8n.</h1>
    <p>Build a circuit, run it on a real QPU, act on the result.</p>
    <p><code>n8n-nodes-ibm-quantum</code> · Unofficial</p>
  </div>
  <div class="chart">
    <div class="head"><span>Bell state</span><span>ibm_marrakesh</span></div>
    <div class="bars">${counts.map(([k, n]) => `<div><b>${n.toLocaleString("en-US")}</b><i class="${n < 1000 ? "low" : ""}" style="height:${Math.max(n / peak * 200, 6)}px"></i><span class="k">${k}</span></div>`).join("")}</div>
    <div class="foot">4,096 shots · 3 QPU seconds</div>
  </div>
</body></html>`;
const browser = await chromium.launch();
for (const [w, h, out] of [[1200, 630, new URL("../static/images/social.png", import.meta.url)], [1280, 640, new URL("../_build/github-social-preview.png", import.meta.url)]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(card(w, h));
  await page.screenshot({ path: out.pathname });
  await page.close();
}
await browser.close();
console.log("cards made");
