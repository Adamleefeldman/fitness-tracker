/**
 * Training plans live in their own SQLite file (plans.db, next to garmin.db),
 * so garmin.db keeps a single writer: the Python sync. The app and the MCP
 * server both read and write plans.db.
 */

import { existsSync } from "node:fs";

import Database from "better-sqlite3";

import type { Change, PlannedSession } from "./adapt.ts";
import { generatePlan } from "./generate.ts";
import { addDays } from "./profile.ts";
import type { Block, GeneratedPlan, PhaseSpan, PlanInput, Profile, Session } from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  event_date TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | archived
  input_json TEXT NOT NULL,               -- what was asked for
  profile_json TEXT NOT NULL,             -- the Garmin profile it was built from
  phases_json TEXT NOT NULL,
  notes_json TEXT NOT NULL,               -- why the plan looks the way it does
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_sessions (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  date TEXT NOT NULL,
  week INTEGER NOT NULL,
  phase TEXT NOT NULL,
  role TEXT NOT NULL,
  discipline TEXT NOT NULL,
  kind TEXT NOT NULL,
  intensity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  distance_km REAL,
  status TEXT NOT NULL DEFAULT 'planned', -- planned | done | skipped | removed
  source TEXT NOT NULL DEFAULT 'plan',    -- plan | adapt | edit: who last changed it
  note TEXT,
  original_json TEXT NOT NULL,            -- the session as generated
  blocks_json TEXT                        -- the workout in detail (warm-up, sets, reps…)
);
CREATE INDEX IF NOT EXISTS idx_plan_sessions ON plan_sessions(plan_id, date);

CREATE TABLE IF NOT EXISTS plan_changes (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  at TEXT NOT NULL,
  source TEXT NOT NULL,                   -- adapt | edit
  summary TEXT NOT NULL
);
`;

/**
 * Open plans.db. Reads pass `create: false` and get null when there's no file
 * yet, so looking at the Plan page never creates one.
 */
export function openPlans(file: string, { create }: { create: boolean }): Database.Database | null {
  if (!create && !existsSync(file)) return null;
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  const cols = db.prepare("PRAGMA table_info(plan_sessions)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "blocks_json")) {
    db.transaction(() => {
      db.exec("ALTER TABLE plan_sessions ADD COLUMN blocks_json TEXT");
      backfillBlocks(db);
    })();
  }
  return db;
}

/**
 * Plans saved before sessions had workout details: rebuild each one from what
 * was asked for and the profile it was built from (the generator is
 * deterministic), and give the details to every session whose original still
 * matches, and to the current version when it's unchanged. Anything that
 * doesn't match keeps just its description.
 */
function backfillBlocks(db: Database.Database) {
  const key = (s: Session) => `${s.date}|${s.title}|${s.description}`;
  const update = db.prepare("UPDATE plan_sessions SET original_json = ?, blocks_json = ? WHERE id = ?");
  for (const plan of listPlans(db)) {
    let blocks: Map<string, Block[] | undefined>;
    try {
      const again = generatePlan({ ...plan.input, startDate: plan.startDate }, plan.profile, addDays(plan.startDate, -1));
      blocks = new Map(again.sessions.map((s) => [key(s), s.blocks]));
    } catch {
      continue;
    }
    const rows = db.prepare("SELECT id, title, description, original_json FROM plan_sessions WHERE plan_id = ?")
      .all(plan.id) as { id: number; title: string; description: string; original_json: string }[];
    for (const r of rows) {
      const original: Session = JSON.parse(r.original_json);
      const b = blocks.get(key(original));
      if (!b) continue;
      const unchanged = r.title === original.title && r.description === original.description;
      update.run(JSON.stringify({ ...original, blocks: b }), unchanged ? JSON.stringify(b) : null, r.id);
    }
  }
}

export interface StoredPlan {
  id: number;
  name: string;
  goal: PlanInput["goal"];
  eventDate: string | null;
  startDate: string;
  endDate: string;
  status: "active" | "archived";
  input: PlanInput;
  profile: Profile;
  phases: PhaseSpan[];
  notes: string[];
  createdAt: string;
}

interface PlanRow {
  id: number; name: string; goal: string; event_date: string | null; start_date: string; end_date: string;
  status: string; input_json: string; profile_json: string; phases_json: string; notes_json: string; created_at: string;
}

const toPlan = (r: PlanRow): StoredPlan => ({
  id: r.id, name: r.name, goal: r.goal as PlanInput["goal"], eventDate: r.event_date,
  startDate: r.start_date, endDate: r.end_date, status: r.status as StoredPlan["status"],
  input: JSON.parse(r.input_json), profile: JSON.parse(r.profile_json),
  phases: JSON.parse(r.phases_json), notes: JSON.parse(r.notes_json), createdAt: r.created_at,
});

interface SessionRow {
  id: number; date: string; week: number; phase: string; role: string; discipline: string; kind: string;
  intensity: string; title: string; description: string; duration_min: number; distance_km: number | null;
  status: string; source: string; note: string | null; original_json: string; blocks_json: string | null;
}

const toSession = (r: SessionRow): PlannedSession => ({
  id: r.id, date: r.date, week: r.week, phase: r.phase as Session["phase"], role: r.role,
  discipline: r.discipline as Session["discipline"], kind: r.kind, intensity: r.intensity as Session["intensity"],
  title: r.title, description: r.description, durationMin: r.duration_min, distanceKm: r.distance_km,
  status: r.status as PlannedSession["status"], source: r.source as PlannedSession["source"], note: r.note,
  original: JSON.parse(r.original_json),
  ...(r.blocks_json ? { blocks: JSON.parse(r.blocks_json) } : {}),
});

const sessionValues = (s: Session) => ({
  date: s.date, week: s.week, phase: s.phase, role: s.role, discipline: s.discipline, kind: s.kind,
  intensity: s.intensity, title: s.title, description: s.description, duration_min: s.durationMin,
  distance_km: s.distanceKm, blocks_json: s.blocks ? JSON.stringify(s.blocks) : null,
});

/** Save a new plan as the active one; any other active plan is archived. */
export function savePlan(db: Database.Database, plan: GeneratedPlan, profile: Profile, now: Date): number {
  return db.transaction(() => {
    db.prepare("UPDATE plans SET status = 'archived' WHERE status = 'active'").run();
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO plans (name, goal, event_date, start_date, end_date, input_json, profile_json, phases_json, notes_json, created_at)
      VALUES (@name, @goal, @event_date, @start_date, @end_date, @input_json, @profile_json, @phases_json, @notes_json, @created_at)
    `).run({
      name: plan.input.name, goal: plan.input.goal, event_date: plan.input.eventDate ?? null,
      start_date: plan.startDate, end_date: plan.endDate, input_json: JSON.stringify(plan.input),
      profile_json: JSON.stringify(profile), phases_json: JSON.stringify(plan.phases),
      notes_json: JSON.stringify(plan.notes), created_at: now.toISOString(),
    });
    const id = Number(lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO plan_sessions (plan_id, date, week, phase, role, discipline, kind, intensity, title, description,
        duration_min, distance_km, blocks_json, original_json)
      VALUES (@plan_id, @date, @week, @phase, @role, @discipline, @kind, @intensity, @title, @description,
        @duration_min, @distance_km, @blocks_json, @original_json)
    `);
    for (const s of plan.sessions) insert.run({ plan_id: id, ...sessionValues(s), original_json: JSON.stringify(s) });
    return id;
  })();
}

export function activePlan(db: Database.Database): StoredPlan | null {
  const row = db.prepare("SELECT * FROM plans WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as PlanRow | undefined;
  return row ? toPlan(row) : null;
}

export function getPlan(db: Database.Database, id: number): StoredPlan | null {
  const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
  return row ? toPlan(row) : null;
}

export function listPlans(db: Database.Database): StoredPlan[] {
  return (db.prepare("SELECT * FROM plans ORDER BY id DESC").all() as PlanRow[]).map(toPlan);
}

export function archivePlan(db: Database.Database, id: number) {
  return db.prepare("UPDATE plans SET status = 'archived' WHERE id = ?").run(id).changes > 0;
}

/** A plan's sessions (removed ones left out), oldest first. */
export function planSessions(db: Database.Database, planId: number): PlannedSession[] {
  return (db.prepare("SELECT * FROM plan_sessions WHERE plan_id = ? AND status != 'removed' ORDER BY date, id")
    .all(planId) as SessionRow[]).map(toSession);
}

export function getSession(db: Database.Database, id: number): (PlannedSession & { planId: number }) | null {
  const row = db.prepare("SELECT * FROM plan_sessions WHERE id = ?").get(id) as (SessionRow & { plan_id: number }) | undefined;
  return row && row.status !== "removed" ? { ...toSession(row), planId: row.plan_id } : null;
}

/** Replace a session's details, recording who changed it and why. */
export function updateSession(db: Database.Database, id: number, s: Session, source: PlannedSession["source"], note: string | null) {
  db.prepare(`
    UPDATE plan_sessions SET date = @date, week = @week, phase = @phase, role = @role, discipline = @discipline,
      kind = @kind, intensity = @intensity, title = @title, description = @description, duration_min = @duration_min,
      distance_km = @distance_km, blocks_json = @blocks_json, source = @source, note = @note
    WHERE id = @id
  `).run({ id, ...sessionValues(s), source, note });
}

export function setSessionStatus(db: Database.Database, id: number, status: "planned" | "done" | "skipped" | "removed") {
  db.prepare("UPDATE plan_sessions SET status = ? WHERE id = ?").run(status, id);
}

export function addSession(db: Database.Database, planId: number, s: Session, note: string | null): number {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO plan_sessions (plan_id, date, week, phase, role, discipline, kind, intensity, title, description,
      duration_min, distance_km, blocks_json, source, note, original_json)
    VALUES (@plan_id, @date, @week, @phase, @role, @discipline, @kind, @intensity, @title, @description,
      @duration_min, @distance_km, @blocks_json, 'edit', @note, @original_json)
  `).run({ plan_id: planId, ...sessionValues(s), note, original_json: JSON.stringify(s) });
  return Number(lastInsertRowid);
}

export function logChange(db: Database.Database, planId: number, source: "adapt" | "edit", summary: string, now: Date) {
  db.prepare("INSERT INTO plan_changes (plan_id, at, source, summary) VALUES (?, ?, ?, ?)")
    .run(planId, now.toISOString(), source, summary);
}

export function recentChanges(db: Database.Database, planId: number, limit = 10) {
  return db.prepare("SELECT at, source, summary FROM plan_changes WHERE plan_id = ? ORDER BY id DESC LIMIT ?")
    .all(planId, limit) as { at: string; source: string; summary: string }[];
}

/** Apply adaptation changes in one transaction, logging a summary. */
export function applyChanges(db: Database.Database, planId: number, changes: Change[], now: Date) {
  if (!changes.length) return;
  db.transaction(() => {
    for (const c of changes) updateSession(db, c.id, c.session, c.source, c.source === "adapt" ? c.reason : null);
    logChange(db, planId, "adapt",
      changes.map((c) => `${c.date}: ${c.before} → ${c.after} (${c.reason})`).join("; "), now);
  })();
}
