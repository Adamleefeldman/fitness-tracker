/**
 * POST /api/plan-chat — the Plan page's chat. Takes the conversation so far
 * and streams the answer back as newline-delimited JSON (see ChatEvent in
 * mcp/chat.ts). Reads garmin.db and plans.db; writes nothing.
 */

import type Database from "better-sqlite3";
import { z } from "zod";

import { DB_PATH } from "@/lib/db";
import { PLANS_PATH } from "@/lib/plans-db";
import * as Q from "@/lib/queries";
import { answer } from "@/mcp/chat";

let garmin: Database.Database | undefined;

const body = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  })).min(1).max(40).refine((m) => m.at(-1)?.role === "user", "The last message must be the question"),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      garmin ??= Q.openReadOnly(DB_PATH);
      const ctx = { db: garmin, now: () => new Date(), plansFile: PLANS_PATH };
      for await (const event of answer(ctx, parsed.data.messages, req.signal)) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
