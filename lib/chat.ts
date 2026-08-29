import OpenAI from "openai";
import { publicCatalog, SCHOOL_AREA_OPTIONS } from "@/kb/catalog";
import { applyTool, CHAT_TOOLS, previewMatrix } from "@/lib/matrix-tools";
import type { UserMatrix } from "@/lib/types";

export const SYSTEM_PROMPT = `You are a home-buy rating-matrix coach for family members (primary residence or long-term hold).
Users will paste free-text gates (example: townhouse with garage or 3 floors or less, end unit, 2+ bed, 2+ bath, in-unit laundry, walkable, not high flood risk) and then grade a Redfin favorites CSV.
You ONLY configure scoring via tools. Never invent dimensions that are not in the knowledge-base catalog.
You may add a manual rubric for qualitative items that cannot be computed.
Ask one cluster at a time, but if they dump a full list of gates, apply all matching catalog items in one turn.
Keep replies short. After each tool change, summarize what changed.
Format every user-visible reply as markdown: **bold** labels, a blank line before lists, each list item on its own line starting with a dash. Do not wrap the whole message in a code fence.
When the user is happy, call commit_matrix.
Location allowlist can include cities or school areas such as: ${SCHOOL_AREA_OPTIONS.join(", ")}.
Catalog version is fixed; do not output free-form JSON for the database.
Map phrases:
- "3 floors or less" / special assessments → stories max 3, mustHave true
- townhouse → property_type prefer townhouse
- garage → garage enabled
- end unit / sunlight → end_unit
- washer/dryer → laundry
- walkable → walkable
- flood / not in a flood zone → flood
- long term → long_term`;

export type ChatMessage = { role: "user" | "assistant"; content: string };

type LlmClient = { client: OpenAI; model: string; provider: string };

function getLlmClient(): LlmClient | null {
  const openrouter = process.env.OPENROUTER_API_KEY;
  if (openrouter) {
    return {
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL || "openrouter/auto",
      client: new OpenAI({
        apiKey: openrouter,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
          "X-Title": "Homestead Matrix",
        },
      }),
    };
  }
  const groq = process.env.GROQ_API_KEY;
  if (groq) {
    return {
      provider: "groq",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      client: new OpenAI({ apiKey: groq, baseURL: "https://api.groq.com/openai/v1" }),
    };
  }
  const openai = process.env.OPENAI_API_KEY;
  if (openai) {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      client: new OpenAI({ apiKey: openai }),
    };
  }
  return null;
}

export function chatProviderInfo() {
  const llm = getLlmClient();
  if (!llm) {
    return { provider: "heuristic", model: "built-in", label: "Built-in coach" };
  }
  const labels: Record<string, string> = {
    openrouter: "OpenRouter",
    groq: "Groq",
    openai: "OpenAI",
  };
  return {
    provider: llm.provider,
    model: llm.model,
    label: labels[llm.provider] ?? llm.provider,
  };
}

export type ChatResult = {
  reply: string;
  matrix: UserMatrix;
  commit: boolean;
  usedModel: boolean;
  provider: string;
  model?: string;
  label?: string;
  toolRounds?: number;
  elapsedMs?: number;
};

export async function runMatrixChat(
  matrix: UserMatrix,
  history: ChatMessage[],
  userText: string
): Promise<ChatResult> {
  const started = Date.now();
  const info = chatProviderInfo();
  const llm = getLlmClient();
  if (!llm) {
    const fallback = heuristicChat(matrix, userText);
    return {
      ...fallback,
      provider: "heuristic",
      model: "built-in",
      label: "Built-in coach",
      toolRounds: 0,
      elapsedMs: Date.now() - started,
    };
  }

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
  let toolRounds = 0;

  try {
    while (guard < 6) {
      guard += 1;
      const completion = await llm.client.chat.completions.create({
        model: llm.model,
        messages,
        tools: CHAT_TOOLS,
        tool_choice: "auto",
      });
      const msg = completion.choices[0]?.message;
      if (!msg) break;
      if (msg.tool_calls?.length) {
        toolRounds += 1;
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
        provider: llm.provider,
        model: llm.model,
        label: info.label,
        toolRounds,
        elapsedMs: Date.now() - started,
      };
    }
    return {
      reply: "I updated your matrix draft.",
      matrix: working,
      commit,
      usedModel: true,
      provider: llm.provider,
      model: llm.model,
      label: info.label,
      toolRounds,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const fallback = heuristicChat(matrix, userText);
    const detail = err instanceof Error ? err.message : "LLM error";
    return {
      ...fallback,
      reply: `${fallback.reply}\n\n_(Provider ${info.label} failed: ${detail.slice(0, 140)}. Used built-in coach.)_`,
      provider: "heuristic",
      model: "built-in",
      label: "Built-in coach (fallback)",
      toolRounds,
      elapsedMs: Date.now() - started,
    };
  }
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
  if (text.includes("budget") || text.includes("max price") || text.includes("cap") || (price && (text.includes("price") || text.includes("$")))) {
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

  const bedMatch = text.match(/(\d)\s*\+?\s*bed/) || text.match(/bed(?:room)?s?\s*(\d)\s*\+?/);
  if (bedMatch) {
    const applied = applyTool(working, "set_dimension", { id: "beds", enabled: true, min: Number(bedMatch[1]), mustHave: true });
    working = applied.matrix;
    notes.push(`Beds min ${bedMatch[1]}.`);
  }

  const bathMatch = text.match(/(\d)\s*\+?\s*bath/);
  if (bathMatch) {
    const applied = applyTool(working, "set_dimension", { id: "baths", enabled: true, min: Number(bathMatch[1]), mustHave: true });
    working = applied.matrix;
    notes.push(`Baths min ${bathMatch[1]}.`);
  }

  if (text.includes("townhouse") || text.includes("townhome")) {
    const applied = applyTool(working, "set_dimension", {
      id: "property_type",
      enabled: true,
      prefs: { prefer: "townhouse" },
    });
    working = applied.matrix;
    notes.push("Prefer townhouse.");
  }

  if (text.includes("garage")) {
    const applied = applyTool(working, "set_dimension", { id: "garage", enabled: true, mustHave: text.includes("must") });
    working = applied.matrix;
    notes.push("Garage preferred.");
  }

  if (text.includes("end unit") || text.includes("sunlight") || text.includes("end-unit")) {
    const applied = applyTool(working, "set_dimension", { id: "end_unit", enabled: true });
    working = applied.matrix;
    notes.push("Prefer end unit for sunlight.");
  }

  if (text.includes("washer") || text.includes("dryer") || text.includes("laundry")) {
    const applied = applyTool(working, "set_dimension", { id: "laundry", enabled: true, mustHave: true });
    working = applied.matrix;
    notes.push("In-unit washer/dryer is a must.");
  }

  if (text.includes("3 floor") || text.includes("three floor") || text.includes("3 stor") || text.includes("special assess")) {
    const applied = applyTool(working, "set_dimension", { id: "stories", enabled: true, max: 3, mustHave: true });
    working = applied.matrix;
    notes.push("Cap at 3 stories to limit special-assessment risk.");
  }

  if (text.includes("walkable") || text.includes("walk-up") || text.includes("walk to")) {
    const applied = applyTool(working, "set_dimension", { id: "walkable", enabled: true });
    working = applied.matrix;
    notes.push("Walkable location preferred.");
  }

  if (text.includes("flood")) {
    const applied = applyTool(working, "set_dimension", { id: "flood", enabled: true, mustHave: true });
    working = applied.matrix;
    notes.push("Avoid high flood-risk zones (AE/VE).");
  }

  if (text.includes("long term") || text.includes("long-term") || text.includes("10 year")) {
    const applied = applyTool(working, "set_dimension", { id: "long_term", enabled: true, min: 1990 });
    working = applied.matrix;
    notes.push("Long-term hold: prefer homes built 1990+.");
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

  if (text.includes("bloomingdale") || text.includes("river hills") || text.includes("fishhawk") || text.includes("valrico") || text.includes("brandon")) {
    const allow: string[] = [];
    if (text.includes("bloomingdale")) allow.push("Bloomingdale HS");
    if (text.includes("river hills")) allow.push("River Hills");
    if (text.includes("fishhawk") || text.includes("lithia")) allow.push("FishHawk / Lithia");
    if (text.includes("valrico")) allow.push("Valrico");
    if (text.includes("brandon")) allow.push("Brandon");
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
      .filter((c) => c.defaultEnabled)
      .slice(0, 8)
      .map((c) => c.defaultLabel)
      .join(", ");
    notes.push(
      `No cloud LLM key — using the built-in coach. Paste Mom's gates in one message (townhouse, garage, 3 floors or less, 2+ bed/bath, laundry, walkable, flood). Catalog includes ${cats}. Add OPENROUTER_API_KEY for Auto mode. Say "commit" when ready.`
    );
  }

  return { reply: notes.join(" "), matrix: working, commit, usedModel: false };
}
