"use client";

/**
 * Ask about your plan: a small chat on the Plan page, answered by Claude with
 * the plan and Garmin tools (see mcp/chat.ts). The conversation lives in
 * this tab only (sessionStorage), so it survives moving between pages.
 */

import { ActionIcon, Box, Group, Stack, Text, Textarea, UnstyledButton } from "@mantine/core";
import { IconArrowUp, IconPlayerStopFilled, IconRefresh, IconSparkles } from "@tabler/icons-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { Card } from "@/components/Card";
import { SUBTLE } from "@/components/widgets";
import type { ChatEvent, ChatTurn } from "@/mcp/chat";
import * as T from "@/lib/theme";

const KEY = "plan-chat";
const SUGGESTIONS = [
  "Walk me through my next session",
  "What's my next hard workout?",
  "How does next week compare with this one?",
  "Why do the first weeks look so easy?",
];
const LOOKING: Record<string, string> = {
  get_training_plan: "Reading your plan",
  get_training_profile: "Checking your training profile",
  get_overview: "Checking today's readings",
  get_activities: "Looking at your workouts",
  get_weekly_summary: "Looking at recent weeks",
  explain_verdict: "Checking the verdict rules",
};

interface Shown extends ChatTurn {
  /** What Claude is looking up while the answer streams. */
  status?: string;
  error?: boolean;
}

/** **bold** inside a line. */
function inline(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <Text key={i} span fw={600} c={T.TEXT}>{part.slice(2, -2)}</Text>
      : <Fragment key={i}>{part}</Fragment>);
}

/** Paragraphs and "- " lists: all the formatting the answers are asked to use. */
function Answer({ text }: { text: string }) {
  const groups: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const item = /^\s*[-*•]\s+/.test(line);
    if (!line.trim()) { groups.push({ list: false, lines: [] }); continue; }
    const last = groups.at(-1);
    if (last && last.list === item && (item || last.lines.length)) last.lines.push(item ? line.replace(/^\s*[-*•]\s+/, "") : line);
    else groups.push({ list: item, lines: [item ? line.replace(/^\s*[-*•]\s+/, "") : line] });
  }
  return (
    <Stack gap={6}>
      {groups.filter((g) => g.lines.length).map((g, i) => g.list ? (
        <Box key={i} component="ul" m={0} pl={18} style={{ display: "grid", gap: 3 }}>
          {g.lines.map((l, j) => <Text key={j} component="li" size="sm" c={T.MUTED}>{inline(l)}</Text>)}
        </Box>
      ) : (
        <Text key={i} size="sm" c={T.MUTED}>{g.lines.flatMap((l, j) => (j ? [<br key={`b${j}`} />, ...inline(l)] : inline(l)))}</Text>
      ))}
    </Stack>
  );
}

export function PlanChat() {
  const [turns, setTurns] = useState<Shown[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) setTurns(JSON.parse(saved));
    } catch { /* storage blocked: start empty */ }
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    if (!busy) {
      try { sessionStorage.setItem(KEY, JSON.stringify(turns.filter((t) => !t.error))); } catch { /* not saved */ }
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns, busy]);

  const update = (fn: (last: Shown) => Shown) => setTurns((ts) => [...ts.slice(0, -1), fn(ts.at(-1)!)]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history: ChatTurn[] = [
      ...turns.filter((t) => !t.error && t.content).map(({ role, content }) => ({ role, content })),
      { role: "user", content: q },
    ];
    setTurns([...history, { role: "assistant", content: "", status: "Thinking" }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await fetch("/api/plan-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-40) }), signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "The chat isn't available.");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines.filter(Boolean)) {
          const e = JSON.parse(line) as ChatEvent;
          if (e.type === "text") update((t) => ({ ...t, content: t.content + e.text, status: undefined }));
          else if (e.type === "tool") update((t) => ({ ...t, status: LOOKING[e.name] ?? "Looking it up" }));
          else if (e.type === "error") update((t) => ({ ...t, content: e.message, status: undefined, error: true }));
        }
      }
      update((t) => ({ ...t, status: undefined }));
    } catch (err) {
      if (ctrl.signal.aborted) update((t) => ({ ...t, status: undefined, content: t.content || "Stopped.", error: !t.content }));
      else update((t) => ({ ...t, status: undefined, error: true, content: err instanceof Error ? err.message : "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card p={0} className="plan-chat">
      <Group justify="space-between" px="md" pt="sm" pb={6}>
        <Group gap={6}>
          <IconSparkles size={15} color={T.GREEN} />
          <Text size="sm" c={SUBTLE}>Ask about your plan</Text>
        </Group>
        {turns.length > 0 && (
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="New conversation" disabled={busy}
            onClick={() => { setTurns([]); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }}>
            <IconRefresh size={14} />
          </ActionIcon>
        )}
      </Group>

      <Box ref={scroller} className="plan-chat-log" px="md">
        {turns.length === 0 ? (
          <Stack gap={6} py="xs">
            <Text size="xs" c={T.FAINT}>Sessions, workouts, paces, how the weeks build. Claude reads your plan to answer.</Text>
            {SUGGESTIONS.map((s) => (
              <UnstyledButton key={s} className="plan-chat-suggestion" onClick={() => ask(s)}>
                <Text size="sm" c={T.MUTED}>{s}</Text>
              </UnstyledButton>
            ))}
          </Stack>
        ) : (
          <Stack gap="sm" py="xs">
            {turns.map((t, i) => t.role === "user" ? (
              <Box key={i} className="plan-chat-question"><Text size="sm" c={T.TEXT}>{t.content}</Text></Box>
            ) : (
              <Box key={i}>
                {t.content && (t.error ? <Text size="sm" c={T.AMBER}>{t.content}</Text> : <Answer text={t.content} />)}
                {t.status && <Text size="xs" c={T.FAINT} className="plan-chat-status">{t.status}…</Text>}
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      <Box component="form" p="sm" pt={6} onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <Group gap={6} align="flex-end" wrap="nowrap" className="plan-chat-input">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input); }
            }}
            placeholder="Ask about a session or the plan…"
            aria-label="Ask about your plan"
            autosize
            minRows={1}
            maxRows={5}
            maxLength={4000}
            variant="unstyled"
            style={{ flex: 1 }}
            styles={{ input: { color: T.TEXT, fontSize: 14, paddingLeft: 10 } }}
          />
          {busy ? (
            <ActionIcon size="md" radius="xl" variant="light" color="gray" aria-label="Stop" onClick={() => abort.current?.abort()} mb={4}>
              <IconPlayerStopFilled size={12} />
            </ActionIcon>
          ) : (
            <ActionIcon type="submit" size="md" radius="xl" color="vital" aria-label="Send" disabled={!input.trim()} mb={4}>
              <IconArrowUp size={16} />
            </ActionIcon>
          )}
        </Group>
      </Box>
    </Card>
  );
}
