import OpenAI from "openai";
import { publicCatalog, SCHOOL_AREA_OPTIONS } from "@/kb/catalog";
import { applyTool, CHAT_TOOLS, previewMatrix } from "@/lib/matrix-tools";
import type { UserMatrix } from "@/lib/types";

export const SYSTEM_PROMPT = `You are a home-buy rating-matrix coach for a primary residence.
You ONLY configure scoring via tools. Never invent dimensions that are not in the knowledge-base catalog.
You may add a manual rubric for qualitative items (layout vibe, backyard, etc.) that cannot be computed.
Ask one cluster at a time: must-haves → structure → money → location → weights.
Keep replies short. After each tool change, summarize what changed.
When the user is happy, call commit_matrix.
Location allowlist must use these labels only: ${SCHOOL_AREA_OPTIONS.join(", ")}.
Catalog version is fixed; do not output free-form JSON for the database.`;

export type ChatMessage = { role: "user" | "assistant"; content: string };

export async function runMatrixChat(
  matrix: UserMatrix,
  history: ChatMessage[],
  userText: string
): Promise<{ reply: string; matrix: UserMatrix; commit: boolean; usedModel: boolean }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return heuristicChat(matrix, userText);
  }

  const client = new OpenAI({ apiKey: key });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `Current matrix preview: ${JSON.stringify(previewMatrix(matrix))}`,
    },
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content }) as const),
    { role: "user", content: userText },
  ];

  let working = matrix;
  let commit = false;
  let guard = 0;

  while (guard < 6) {
    guard += 1;
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      tools: CHAT_TOOLS,
      tool_choice: "auto",
    });
    const msg = completion.choices[0]?.message;
    if (!msg) break;
    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        const args = safeJson(call.function.arguments);
        const applied = applyTool(working, call.function.name, args);
        working = applied.matrix;
        if (applied.commit) commit = true;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(applied.result),
        });
      }
      continue;
    }
    return {
      reply: msg.content || "Updated.",
      matrix: working,
      commit,
      usedModel: true,
    };
  }

  return { reply: "I updated your matrix draft.", matrix: working, commit, usedModel: true };
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function heuristicChat(matrix: UserMatrix, userText: string) {
  const text = userText.toLowerCase();
  let working = matrix;
  const notes: string[] = [];
  let commit = false;

  const price =
    userText.match(/\$?\s*(\d{3,4})\s*k\b/i) ||
    userText.match(/\$(\d{3,3}(?:,\d{3})+)/) ||
    userText.match(/\b(\d{3}(?:,\d{3}){1,2}|\d{6,7})\b/);
  if (text.includes("budget") || text.includes("max price") || text.includes("cap") || price) {
    let maxPrice = working.budget.maxPrice;
    if (price) {
      const n = Number(price[1].replace(/,/g, ""));
      maxPrice = n < 10_000 ? n * 1000 : n;
    }
    const applied = applyTool(working, "set_budget", { maxPrice });
    working = applied.matrix;
    notes.push(`Max price set to $${maxPrice?.toLocaleString()}.`);
  }

  if (/\b(2500|2,500)\b/.test(text) || text.includes("sq ft") || text.includes("sqft")) {
    const applied = applyTool(working, "set_dimension", { id: "sqft", enabled: true, min: 2500 });
    working = applied.matrix;
    notes.push("Living area floor set to 2500 sf.");
  }

  if (text.includes("block")) {
    const applied = applyTool(working, "set_dimension", {
      id: "construction",
      enabled: true,
      mustHave: text.includes("must"),
      prefs: { prefer: "block" },
    });
    working = applied.matrix;
    notes.push("Prefer block construction.");
  }

  if (text.includes("bloomingdale") || text.includes("river hills") || text.includes("fishhawk")) {
    const allow: string[] = [];
    if (text.includes("bloomingdale")) allow.push("Bloomingdale HS");
    if (text.includes("river hills")) allow.push("River Hills");
    if (text.includes("fishhawk") || text.includes("lithia")) allow.push("FishHawk / Lithia");
    const applied = applyTool(working, "set_budget", { locationAllowlist: allow.length ? allow : working.locationAllowlist });
    working = applied.matrix;
    notes.push(`Location allowlist: ${working.locationAllowlist.join(", ")}.`);
  }

  if (text.includes("slack") || text.includes("payment") || text.includes("pitia")) {
    const num = userText.match(/\$?(\d{3,4})\b/);
    const applied = applyTool(working, "set_budget", {
      minMonthlySlack: 1000,
      maxPitia: num ? Number(num[1]) : working.budget.maxPitia,
    });
    working = applied.matrix;
    notes.push("Updated PITIA / monthly slack targets.");
  }

  if (text.includes("commit") || text.includes("save") || text.includes("looks good") || text.includes("done")) {
    commit = true;
    notes.push("Matrix committed as your active grader.");
  }

  if (notes.length === 0) {
    const cats = publicCatalog()
      .slice(0, 6)
      .map((c) => c.defaultLabel)
      .join(", ");
    notes.push(
      `Demo chat (no OPENAI_API_KEY). I can only tune catalog items such as ${cats}. Tell me budget, min sqft, block vs frame, school areas, or say "commit".`
    );
  }

  return { reply: notes.join(" "), matrix: working, commit, usedModel: false };
}
