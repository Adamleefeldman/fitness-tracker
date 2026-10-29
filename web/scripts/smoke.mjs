/**
 * Render check: start the production build and request every page × range.
 *
 *   npm run smoke      (builds first; needs ../garmin.db or GARMIN_DB_PATH)
 *
 * Type checks and the build don't catch render-time errors such as passing a
 * function from a Server Component to a Client Component. Those still answer
 * 200, because the page shell streams before the failing part, so this also
 * fails on anything the server logs as an error and on pages whose content
 * never rendered as HTML (only inside the page's script data).
 *
 * The Plan page is checked twice against a throwaway plans.db: with no plan
 * (the form), then with one built from the real Garmin data: its sessions'
 * workouts and the chat must render. The chat route is only sent a bad
 * request, so the smoke run never calls (or pays for) the Claude API.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
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
const plansFile = path.join(mkdtempSync(path.join(os.tmpdir(), "smoke-")), "plans.db");
const server = spawn("npx", ["next", "start", "-p", String(port)], { cwd: WEB, env: { ...process.env, PLANS_DB_PATH: plansFile } });
let log = "";
server.stdout.on("data", (b) => (log += b));
server.stderr.on("data", (b) => (log += b));

const failures = [];
let checked = 0;

/** Request `url` and check it rendered: 200, nothing threw, and `marker` in the HTML outside scripts. */
async function check(url, marker = "panel-card") {
  const res = await fetch(base + url);
  const html = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, "");
  checked++;
  if (res.status !== 200) failures.push(`${url}: HTTP ${res.status}`);
  else if (html.includes("data-dgst")) failures.push(`${url}: a component threw while rendering`);
  else if (!html.includes(marker)) failures.push(`${url}: "${marker}" never rendered as HTML`);
}

/** Build a plan into the throwaway plans.db from the real Garmin data. */
async function createPlan() {
  const Q = await import("../src/lib/queries.ts");
  const St = await import("../src/lib/plans/store.ts");
  const Sv = await import("../src/lib/plans/service.ts");
  const garmin = Q.openReadOnly(process.env.GARMIN_DB_PATH ?? path.resolve(WEB, "..", "garmin.db"));
  const db = St.openPlans(plansFile, { create: true });
  const now = new Date();
  const event = new Date(now.getTime() + 12 * 7 * 86_400_000).toLocaleDateString("en-CA");
  Sv.createPlan(db, { daily: Q.dailyRows(garmin), activities: Q.activityRows(garmin) },
    { goal: "half_marathon", name: "Smoke Half", eventDate: event, daysPerWeek: 5 }, now);
  db.close();
  garmin.close();
}
try {
  await waitUntilUp(base, server);

  for (const route of pageRoutes()) {
    for (const range of RANGES) await check(`${route}?range=${range}`);
  }
  await check("/plan", "Build a training plan");
  await createPlan();
  await check("/plan", "Why the plan looks like this");
  await check("/plan", "workout-step");
  await check("/plan", "Ask about your plan");

  const chat = await fetch(`${base}/api/plan-chat`, { method: "POST", body: "{}" });
  checked++;
  if (chat.status !== 400) failures.push(`/api/plan-chat with a bad request: expected 400, got ${chat.status}`);

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
