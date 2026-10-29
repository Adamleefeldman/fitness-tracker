/**
 * The Plan page's chat end to end against a fake Claude API: it asks for the
 * plan, the tool runs over the synthetic fixture, and the answer streams back.
 * No network and no API key.
 */

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { writeFixtureDb } from "../lib/fixture";
import * as Q from "../lib/queries";
import * as Sv from "../lib/plans/service";
import * as St from "../lib/plans/store";
import { answer, chatTools, type ChatEvent } from "./chat";

const dir = mkdtempSync(path.join(os.tmpdir(), "chat-"));
const garminFile = path.join(dir, "garmin.db");
writeFixtureDb(garminFile);
const db = Q.openReadOnly(garminFile);
const plansFile = path.join(dir, "plans.db");
// the fixture's data runs to 2026-07-23
const NOW = new Date("2026-07-20T08:00:00");
const ctx = { db, now: () => NOW, plansFile };

const plans = St.openPlans(plansFile, { create: true })!;
Sv.createPlan(plans, { daily: Q.dailyRows(db), activities: Q.activityRows(db) },
  { goal: "10k", name: "Autumn 10K", eventDate: "2026-10-04", daysPerWeek: 4 }, NOW);
plans.close();

/** A streamed Messages API reply, as server-sent events. */
function sse(content: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: object })[],
  stop: string): Response {
  const events: object[] = [{
    type: "message_start",
    message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null,
      stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
  }];
  content.forEach((b, index) => {
    if (b.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      for (const piece of b.text.match(/[\s\S]{1,12}/g)!) {
        events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
      }
    } else {
      events.push({ type: "content_block_start", index, content_block: { ...b, input: {} } });
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } });
  events.push({ type: "message_stop" });
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** A client whose API replies in turn with `replies`, recording each request. */
function fakeClient(replies: (() => Response)[]) {
  const requests: { body: Record<string, unknown>; headers: Headers }[] = [];
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (_url, init) => {
      requests.push({ body: JSON.parse(String(init!.body)), headers: new Headers(init!.headers) });
      return replies[requests.length - 1]();
    },
  });
  return { client, requests };
}

async function collect(gen: AsyncGenerator<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("plan chat", () => {
  it("looks up the plan with the tools, then streams the answer", async () => {
    const { client, requests } = fakeClient([
      () => sse([{ type: "tool_use", id: "tu_1", name: "get_training_plan", input: {} }], "tool_use"),
      () => sse([{ type: "text", text: "Next up is your **long run** on Saturday:\n- 8 km easy" }], "end_turn"),
    ]);
    const events = await collect(answer(ctx, [{ role: "user", content: "What's next?" }], new AbortController().signal, client));

    expect(events[0]).toEqual({ type: "tool", name: "get_training_plan" });
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join(""))
      .toBe("Next up is your **long run** on Saturday:\n- 8 km easy");
    expect(events.at(-1)).toEqual({ type: "done" });

    const first = requests[0].body;
    expect(first).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default", output_config: { effort: "medium" }, stream: true });
    expect(first.system).toContain("Today is 2026-07-20.");
    expect(requests[0].headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect((first.tools as { name: string }[]).map((t) => t.name)).toEqual([
      "get_training_plan", "get_training_profile", "get_overview", "get_activities", "get_weekly_summary", "explain_verdict",
    ]);

    // the tool ran over the fixture and its result, with each session's workout, went back to Claude
    const messages = requests[1].body.messages as { role: string; content: { type: string; content?: string }[] }[];
    const result = messages.at(-1)!.content.find((b) => b.type === "tool_result")!;
    const plan = JSON.parse(result.content!);
    expect(plan.plan.name).toBe("Autumn 10K");
    expect(plan.sessions.length).toBeGreaterThan(0);
    expect(plan.sessions.every((s: { workout: unknown[] | null }) => s.workout?.length)).toBe(true);
  });

  it("explains a missing or rejected API key instead of failing", async () => {
    const { client } = fakeClient([() => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }), { status: 401 })]);
    const events = await collect(answer(ctx, [{ role: "user", content: "Hi" }], new AbortController().signal, client));
    expect(events).toEqual([{ type: "error", message: expect.stringMatching(/didn't accept the API key/) }]);
  });

  it("only offers tools that read", () => {
    const names = chatTools(ctx).map((t) => t.name);
    for (const write of ["create_training_plan", "edit_training_sessions", "adapt_training_plan", "archive_training_plan", "run_sql"]) {
      expect(names).not.toContain(write);
    }
  });
});
