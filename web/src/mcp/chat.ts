/**
 * The Plan page's chat: Claude answers questions about the training plan and
 * the Garmin data by calling this server's own tools, so its answers use the
 * same numbers as the dashboard and Claude Desktop. The app's
 * /api/plan-chat route runs it.
 *
 * Read-only on purpose: no tool here writes to plans.db. Plan summaries and
 * Garmin readings are sent to the Claude API to answer, so this needs an
 * ANTHROPIC_API_KEY (web/.env.local) and costs a little per question.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

import { localToday } from "../lib/plans/profile.ts";
import * as PT from "./plan-tools.ts";
import * as T from "./tools.ts";

// Sonnet at medium effort: plenty for looking up and explaining a plan, at half Opus's per-token price
const MODEL = "claude-sonnet-5-5";

/** What the page streams back, one JSON object per line. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** The read-only tools the chat can call. */
export function chatTools(ctx: PT.PlanCtx) {
  const json = (v: unknown) => JSON.stringify(v);
  return [
    betaZodTool({
      name: "get_training_plan",
      description:
        "The active plan against what was done: verdict, body state, phases, and the sessions in a date range " +
        "(default: last 7 to next 14 days), each with its workout in detail (blocks of steps with sets, reps, " +
        "target pace/effort/load and rest) and whether it was done, missed, skipped or is upcoming; planned vs " +
        "done volume for every week, suggested adaptations and recent changes. Widen from/to for later weeks.",
      inputSchema: z.object(PT.getPlanInput),
      run: (a) => json(PT.getTrainingPlan(ctx, a)),
    }),
    betaZodTool({
      name: "get_training_profile",
      description:
        "What the Garmin data says the athlete can do now: weekly minutes and running km (last 4 and 12 weeks), " +
        "longest recent run, activity mix, VO₂max and trend, training paces, and body state with reasons.",
      inputSchema: z.object({}),
      run: () => json(PT.getTrainingProfile(ctx)),
    }),
    betaZodTool({
      name: "get_overview",
      description:
        "The dashboard's four verdicts (train hard today? overtraining? getting fitter? sleep improving?), " +
        "today's readiness, and the latest resting HR, HRV, sleep, VO₂max, Body Battery and steps.",
      inputSchema: z.object(T.overviewInput),
      run: (a) => json(T.getOverview(ctx, a)),
    }),
    betaZodTool({
      name: "get_activities",
      description: "Recorded workouts, newest first: type, duration, distance, pace, heart rate, load and intensity.",
      inputSchema: z.object(T.activitiesInput),
      run: (a) => json(T.getActivities(ctx, a)),
    }),
    betaZodTool({
      name: "get_weekly_summary",
      description: "Training per Monday–Sunday week next to that week's readiness, resting HR, HRV, sleep and stress.",
      inputSchema: z.object(T.weeklySummaryInput),
      run: (a) => json(T.getWeeklySummary(ctx, a)),
    }),
    betaZodTool({
      name: "explain_verdict",
      description: "Why one of the dashboard's verdicts says what it does: the numbers, rules and thresholds.",
      inputSchema: z.object(T.explainInput),
      run: (a) => json(T.explainVerdict(ctx, a)),
    }),
  ];
}

const SYSTEM = `You answer questions on the Plan page of a personal Garmin health dashboard: about the athlete's
training plan, its sessions, and how their training and recovery are going. Talk to the athlete as "you".

- Look things up with the tools before answering; never guess dates, sessions, paces or numbers.
  get_training_plan has every session's workout (sets, reps, targets, rest) and today's date.
- Before you compare anything (longest, biggest, first, more or less than, up or down), check it
  against the numbers from the tools: 8.5 km is not longer than 9.3 km. If the numbers don't back
  a comparison, leave it out.
- When asked about a session, give its day, what it's for in a few words, then the workout:
  each part (warm-up, main set, cool-down) with sets × reps, target and rest.
- You can't change the plan from here. If asked to, say what you'd change and that they can mark
  sessions done or skipped on this page, or ask Claude Desktop or Claude Code (which can edit the plan).
- The verdicts are simple published rules, not medical advice; suggest a professional for pain or illness.
- Keep answers short and easy to read on a phone. Plain sentences and "- " bullet lists; **bold** for
  key words is fine. No headings, tables or code blocks.`;

/** The cheapest way to say what went wrong, for the page. */
function explain(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) {
    return "Claude didn't accept the API key. Check ANTHROPIC_API_KEY in web/.env.local and restart the app.";
  }
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the internet connection.";
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status ?? "unknown"}). Try again.`;
  if (e instanceof Anthropic.AnthropicError) {
    return "There's no Claude API key. Add ANTHROPIC_API_KEY to web/.env.local and restart the app.";
  }
  return "Something went wrong answering that. Try again.";
}

/** Answer the last user turn, yielding text as it streams and the tools Claude looks things up with. */
export async function* answer(ctx: PT.PlanCtx, history: ChatTurn[], signal: AbortSignal,
  client?: Anthropic): AsyncGenerator<ChatEvent> {
  const today = localToday(ctx.now());
  const messages: BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));
  try {
    client ??= new Anthropic();
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: `${SYSTEM}\n\nToday is ${today}.`,
      tools: chatTools(ctx),
      messages,
      max_iterations: 6,
      stream: true,
    }, { signal });
    for await (const turn of runner) {
      for await (const event of turn) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          yield { type: "tool", name: event.content_block.name };
        }
      }
      const message = await turn.finalMessage();
      if (message.stop_reason === "refusal") {
        yield { type: "text", text: "\n\nSorry, I can't help with that one." };
        break;
      }
    }
    yield { type: "done" };
  } catch (e) {
    if (signal.aborted) return;
    console.error("[plan-chat]", e);
    yield { type: "error", message: explain(e) };
  }
}
