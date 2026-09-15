import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fixtureEdition } from "../tests/fixtures";
import { browserScript } from "../src/rendering/page";

const edition = fixtureEdition("user-a", 42, Date.parse("2026-09-15T14:00:00Z"));
// Standalone preview only. Production Worker has no fixture route or auth bypass.
const html = edition.html.replace("<!--FRESHNESS-->", "").replace("<!--RENEW_AT-->", "0").replace('<script defer src="/assets/home.js"></script>', "");
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/fixture.html", html);
console.log(JSON.stringify({ fixture: true, htmlBytes: Buffer.byteLength(html), htmlGzipBytes: gzipSync(html).length, scriptBytes: Buffer.byteLength(browserScript), scriptGzipBytes: gzipSync(browserScript).length }));
// Measurement is confined to this fictional local server. This observer does
// not ship in the Worker and sends no metrics to another service.
const measurement = `<script>new PerformanceObserver(list=>{for(const entry of list.getEntries()){if(entry.name==='first-contentful-paint'){const nav=performance.getEntriesByType('navigation')[0];console.info('HOMEPAGE_LOCAL_METRICS '+JSON.stringify({fcpMs:entry.startTime,ttfbMs:nav.responseStart,width:innerWidth,height:innerHeight,userAgent:navigator.userAgent}));}}}).observe({type:'paint',buffered:true});</script>`;
createServer((req, res) => {
  if (req.url === "/assets/accuweather.svg") { res.setHeader("content-type", "image/svg+xml"); res.end(readFileSync(new URL("../src/rendering/accuweather.svg", import.meta.url))); return; }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store"); res.end(req.url === "/measure" ? html.replace("</body>", `${measurement}</body>`) : html);
}).listen(8788, "0.0.0.0", () => console.log("Fictional preview: http://localhost:8788"));
