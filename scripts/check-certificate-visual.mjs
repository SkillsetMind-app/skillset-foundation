import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdtemp, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep, extname } from "node:path";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import postcss from "postcss";

// CI regenerates synthetic documents; never expose a workstation or production session.
assert(process.env.GITHUB_ACTIONS === "true" && process.platform === "linux", "GitHub Linux runner only");
const run = promisify(execFile);
const root = await realpath(join(process.cwd(), ".next/static"));
const directories = (await readdir(tmpdir())).filter((name) => name.startsWith("skillsetmind-certificate-ssr-"));
assert.equal(directories.length, 1, "Expected exactly one synthetic fixture directory");
const directory = join(tmpdir(), directories[0]);
const profile = await mkdtemp(join(tmpdir(), "certificate-chrome-"));
const cssFiles = [];
async function findCss(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await findCss(join(path, entry.name));
    else if (entry.isFile() && entry.name.endsWith(".css")) cssFiles.push(join(path, entry.name));
  }
}
await findCss(root);
assert(cssFiles.length > 0, "Build CSS missing");
const fontClasses = new Map();
for (const file of cssFiles) {
  postcss.parse(await readFile(file, "utf8")).walkDecls((decl) => {
    if (["--font-manrope", "--font-cormorant", "--font-inter"].includes(decl.prop)) {
      assert(/^\.[a-zA-Z0-9_-]+$/.test(decl.parent.selector), "Unexpected generated font selector");
      fontClasses.set(decl.prop, decl.parent.selector.slice(1));
    }
  });
}
assert.equal(fontClasses.size, 3, "Actual Next font bindings missing");
const audit = `addEventListener("load", async () => {
  const out = document.createElement("output"); out.id = "qa-metrics"; out.hidden = true;
  document.body.append(out);
  try {
  await document.fonts.ready;
  const box = document.querySelector(".cert-doc")?.getBoundingClientRect();
  const sections = [...document.querySelectorAll(".cert-doc-header,.cert-doc-award,.cert-doc-footer")].map(e => e.getBoundingClientRect());
  const headings = [...document.querySelectorAll(".cert-doc h1,.cert-doc h2")];
  out.textContent = JSON.stringify({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    images: [...document.images].every(i => i.complete && i.naturalWidth > 0),
    fonts: [...document.fonts].filter(f => f.status === "loaded").length,
    displayFont: headings.every(e => { const s = getComputedStyle(e); return /cormorant/i.test(s.fontFamily) && document.fonts.check(s.fontWeight + " " + s.fontSize + " " + s.fontFamily, e.textContent); }),
    visible: (!box || (document.querySelectorAll(".cert-doc h1").length === 1 && document.querySelectorAll(".cert-doc h2").length === 1 && sections.length === 3)) && headings.every(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility === "visible"),
    sections: sections.every((r,i) => r.width > 0 && r.height > 0 && (!i || r.top >= sections[i-1].bottom - 1)),
    documentWidth: box?.width, documentHeight: box?.height,
    overflow: [...document.querySelectorAll(".cert-doc h1,.cert-doc h2,.cert-doc p")].some(e => e.scrollWidth > e.clientWidth + 1) });
  } catch (error) { out.textContent = JSON.stringify({ error: error.message }); }
});`;
const hash = createHash("sha256").update(audit).digest("base64");
const pages = new Map();
for (const file of (await readdir(directory)).filter((name) => /^(standard|long|images|whitelabel|seal)-(light|dark)\.html$/.test(name))) {
  const dom = new JSDOM(await readFile(join(directory, file), "utf8"));
  const doc = dom.window.document;
  doc.documentElement.classList.add(...fontClasses.values());
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((node) => node.remove());
  for (const css of cssFiles) {
    const link = doc.createElement("link"); link.rel = "stylesheet";
    link.href = `/_next/static/${css.slice(root.length + 1).split(sep).join("/")}`;
    doc.head.append(link);
  }
  const script = doc.createElement("script"); script.textContent = audit; doc.body.append(script);
  pages.set(`/${file}`, dom.serialize());
  dom.window.close();
}
assert.equal(pages.size, 10, "Eight certificates and two seal fixtures required");
const types = { ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
const server = createServer(async (req, res) => {
  res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:; script-src 'sha256-${hash}'; connect-src 'none'; base-uri 'none'; form-action 'none'`);
  try {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    if (pages.has(path)) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(pages.get(path)); return; }
    assert(path.startsWith("/_next/static/"));
    const file = await realpath(resolve(root, decodeURIComponent(path.slice("/_next/static/".length))));
    assert(file.startsWith(root + sep) && types[extname(file)]);
    res.setHeader("Content-Type", types[extname(file)]); res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
const childEnv = { PATH: process.env.PATH, HOME: profile, TMPDIR: tmpdir(), LANG: "en_US.UTF-8" };
async function chrome(args, url) {
  return run("google-chrome", ["--headless", "--disable-gpu", "--disable-background-networking",
    "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--virtual-time-budget=3000", ...args, url],
  { env: childEnv, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
}
const report = [];
let driver;
let mobileSession;
let driverPort;
async function webdriver(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${driverPort}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert(response.ok && !data.value?.error, `WebDriver: ${data.value?.message || response.status}`);
  return data.value;
}
async function mobile(url, name) {
  if (!mobileSession) {
    assert(!driver, "Mobile browser initialization failed; not retrying");
    const socket = createServer();
    await new Promise((done) => socket.listen(0, "127.0.0.1", done));
    driverPort = socket.address().port;
    await new Promise((done) => socket.close(done));
    driver = spawn(process.env.CHROMEWEBDRIVER ? join(process.env.CHROMEWEBDRIVER, "chromedriver") : "chromedriver",
      [`--port=${driverPort}`, "--allowed-ips=127.0.0.1", "--log-level=SEVERE"], { env: childEnv, stdio: "ignore" });
    let startError;
    driver.on("error", (error) => { startError = error; });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (startError) throw startError;
      try { await webdriver("GET", "/status"); break; }
      catch { await new Promise((done) => setTimeout(done, 100)); }
    }
    const session = await webdriver("POST", "/session", { capabilities: { alwaysMatch: {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
        mobileEmulation: { deviceMetrics: { width: 390, height: 1600, pixelRatio: 1 }, clientHints: { platform: "Android", mobile: true } },
      },
    } } });
    mobileSession = session.sessionId;
  }
  await webdriver("POST", `/session/${mobileSession}/url`, { url });
  let source;
  for (let attempt = 0; attempt < 50; attempt++) {
    source = await webdriver("GET", `/session/${mobileSession}/source`);
    const dom = new JSDOM(source);
    const ready = dom.window.document.querySelector("#qa-metrics")?.textContent;
    dom.window.close();
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  const png = await webdriver("GET", `/session/${mobileSession}/screenshot`);
  await writeFile(join(directory, `${name}-390.png`), Buffer.from(png, "base64"));
  return source;
}
async function inspect(name, check) {
  try { await check(); }
  catch (error) { report.push({ name, error: error.message }); }
}
try {
  for (const path of pages.keys()) {
    const name = path.slice(1, -5);
    const url = `http://127.0.0.1:${port}${path}`;
    for (const width of [1280, 390]) {
      await inspect(`${name}-${width}`, async () => {
      const stdout = width === 390 ? await mobile(url, name) : (await chrome([`--window-size=${width},1600`, "--dump-dom"], url)).stdout;
      const dom = new JSDOM(stdout);
      const metrics = JSON.parse(dom.window.document.querySelector("#qa-metrics")?.textContent || "null");
      dom.window.close();
      await writeFile(join(directory, `${name}-${width}-dom.html`), stdout);
      if (width !== 390) await chrome([`--window-size=${width},1600`, `--screenshot=${join(directory, `${name}-${width}.png`)}`], url);
      assert(metrics && !metrics.error && metrics.images && metrics.fonts > 0, `${name}: images/fonts not loaded (${JSON.stringify(metrics)})`);
      assert(metrics.displayFont && metrics.visible && metrics.sections, `${name}: missing display font or invisible/overlapping content`);
      assert.equal(metrics.width, width, `${name}: browser did not honor requested viewport`);
      assert(metrics.scroll <= metrics.width + 1 && !metrics.overflow, `${name}: text or viewport overflow`);
      report.push({ name, requestedWidth: width, ...metrics });
      });
    }
    if (!name.startsWith("seal-")) {
      await inspect(`${name}-print`, async () => {
      const pdf = join(directory, `${name}.pdf`);
      await chrome(["--no-pdf-header-footer", `--print-to-pdf=${pdf}`], url);
      await run("pdftoppm", ["-scale-to", "1400", "-singlefile", "-png", pdf, join(directory, `${name}-print`)], { env: childEnv, timeout: 10000 });
      const { stdout } = await run("pdfinfo", [pdf], { env: childEnv, timeout: 10000 });
      assert(/^Pages:\s+1\s*$/m.test(stdout), `${name}: PDF is not exactly one page`);
      const dimensions = stdout.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts \(A4\)/m);
      assert(dimensions && Math.abs(Number(dimensions[1]) - 595.276) < 1 && Math.abs(Number(dimensions[2]) - 841.89) < 1, `${name}: PDF is not A4 portrait`);
      const { stdout: text } = await run("pdftotext", [pdf, "-"], { env: childEnv, timeout: 10000 });
      assert(text.includes("SK-SYNTHETIC-ONLY") && text.includes("Taylor Rivera"), `${name}: PDF missing verification or instructor`);
      assert(name.startsWith("long-") ? text.replace(/\s/g, "").includes("A".repeat(120)) : text.includes("Alex Morgan"), `${name}: PDF missing learner name`);
      const course = name.startsWith("long-") ? "Emotional intelligence and professional development ".repeat(6) : "Emotional Intelligence: Foundations and Practice";
      assert(text.replace(/\s/g, "").includes(course.replace(/\s/g, "")), `${name}: PDF missing course title`);
      report.push({ name, pages: 1, paper: "A4 portrait" });
      });
    }
  }
} finally {
  if (mobileSession) await webdriver("DELETE", `/session/${mobileSession}`).catch(() => {});
  if (driver) driver.kill();
  await writeFile(join(directory, "visual-report.json"), JSON.stringify(report, null, 2));
  await new Promise((done) => server.close(done));
}
assert(!report.some((item) => item.error), JSON.stringify(report.filter((item) => item.error)));
console.info(`Certificate visual QA passed: ${report.length} checks; synthetic artifacts only.`);
