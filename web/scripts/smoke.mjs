/**
 * Render check: start the production build and request every page × range.
 *
 *   npm run smoke      (builds first; needs ../garmin.db or GARMIN_DB_PATH)
 *
 * Type checks and the build don't catch render-time errors such as passing a
 * function from a Server Component to a Client Component. Those still answer
 * 200, because the page shell streams before the failing part, so this also
 * fails on anything the server logs as an error and on pages whose content
 * never replaced the loading fallback.
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");
const RANGES = ["30d", "90d", "1y", "All"]; // src/lib/range.ts
const REDIRECTS = { "/recovery": "/sleep", "/training": "/load", "/activities": "/load" }; // next.config.ts

/** Every page route under src/app (a directory holding page.tsx). */
function pageRoutes(dir = path.join(WEB, "src/app"), route = "") {
  const entries = readdirSync(dir, { withFileTypes: true });
  const here = entries.some((e) => e.name === "page.tsx") ? [route || "/"] : [];
  return here.concat(
    entries
      .filter((e) => e.isDirectory() && !/^[_([@]/.test(e.name))
      .flatMap((e) => pageRoutes(path.join(dir, e.name), `${route}/${e.name}`)),
  );
}

function freePort() {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitUntilUp(base, server) {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode != null) throw new Error("next start exited early");
    try {
      await fetch(base);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("next start didn't come up within 20s");
}

const port = await freePort();
const base = `http://localhost:${port}`;
const server = spawn("npx", ["next", "start", "-p", String(port)], { cwd: WEB, env: process.env });
let log = "";
server.stdout.on("data", (b) => (log += b));
server.stderr.on("data", (b) => (log += b));

const failures = [];
let checked = 0;
try {
  await waitUntilUp(base, server);

  for (const route of pageRoutes()) {
    for (const range of RANGES) {
      const url = `${route}?range=${range}`;
      const res = await fetch(base + url);
      const html = await res.text();
      checked++;
      if (res.status !== 200) failures.push(`${url}: HTTP ${res.status}`);
      else if (html.includes("data-dgst")) failures.push(`${url}: a component threw while rendering`);
      else if (!html.includes("panel-card")) failures.push(`${url}: content never replaced the loading fallback`);
    }
  }

  for (const [from, to] of Object.entries(REDIRECTS)) {
    const res = await fetch(base + from, { redirect: "manual" });
    checked++;
    if (res.status !== 308 || res.headers.get("location") !== to) {
      failures.push(`${from}: expected 308 → ${to}, got ${res.status} → ${res.headers.get("location")}`);
    }
  }

  const errors = log.split("\n").filter((l) => /⨯|\bError\b/.test(l));
  if (errors.length) failures.push(`server logged errors:\n    ${errors.slice(0, 10).join("\n    ")}`);
} finally {
  server.kill();
}

if (failures.length) {
  console.error(`smoke: ${failures.length} problem(s) in ${checked} requests\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`smoke: ${checked} requests OK`);
