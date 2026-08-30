import OpenAI from "openai";
import { baselineStatus } from "@/kb/catalog";
import { adviseLiveSearch } from "@/lib/listing-cache";
import { applyTool, CHAT_TOOLS, previewMatrix } from "@/lib/matrix-tools";
import { queryFromMatrix } from "@/lib/rentcast";
import type { UserMatrix } from "@/lib/types";

export const SYSTEM_PROMPT = `You are a home-buy rating-matrix coach. Users will grade a Redfin favorites CSV against a matrix you build with tools.
You ONLY configure scoring via tools. Never invent dimensions outside the catalog.
You may add a manual rubric for qualitative extras.

BASELINE FIRST — do not skip this, and do not commit until baseline is complete:
1. General area. If they name cities (St. Petersburg, Clearwater, Valrico), put those in locationAllowlist and set searchArea to the primary city + state (e.g. "St. Petersburg, FL") — not Tampa — unless they actually asked for Tampa. Live search follows the named cities. Only use searchArea "Tampa, FL" with an empty allowlist when they want the whole Tampa metro. Never copy a default neighborhood list.
2. Minimum bedrooms (set_dimension id beds, enabled true, min, mustHave true)
3. Minimum bathrooms (set_dimension id baths)
4. Property type (set_dimension id property_type, prefs.prefer one of townhouse | sfr | condo | multi)

After baseline is saved, ask: "Any custom must-haves?" and only then enable add-ons.

SOFT / SUBJECTIVE GATES (these are first-class catalog dimensions — do not ignore them):
- neighborhood_vibe prefs.prefer local_center = not sleepy/laid-back, not a busy strip, walkable local city-center
- local_amenities prefs.requireCoffee true (mustHave if they need a café) and requireShops true for everyday shops
- walkable for a short walk to those places
- flood vs flood_resilience: if they accept living in FEMA AE/VE, set flood prefs.acceptSfha true and mustHave false. Enable flood_resilience (street ponding / sewage backup) as the must-have. If they simply want to avoid flood zones, keep flood mustHave true.
- add_manual_rubric for purely taste items (a *great* coffee shop vs just having one nearby)

If they dump everything in one message, apply baseline first, then add-ons.

Do not keep Valrico, Brandon, Bloomingdale, or River Hills unless the user said those places.
Format replies as markdown with **bold** labels and dash lists.
Keep replies short. After tools, recap what is set and what baseline is still missing.
When baseline is complete AND the user confirms, call commit_matrix.

LIVE SEARCH QUOTA (beta): 3 RentCast pulls per user, and a hard account cap of 50 RentCast HTTP calls per month (Developer plan). Never recommend a pull that would go over 50 — this app will not send overage requests ($0.20 each). The listing cache never expires. Tightening beds/price or changing coffee/vibe/drainage re-grades the cache for free. Widening area, type, beds, baths, or max price needs a new pull. Always call preview_live_search before recommending a new pull. Quote coveragePct (e.g. 90% of cached homes still match) and the workarounds. Recommend NOT spending a pull when coverage is high. Only call run_live_search with confirm true after they explicitly agree (e.g. "confirm live pull" / "use one of the three"). Show used/userLimit in your recap.`;

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
  livePull?: boolean;
  liveSearch?: boolean;
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
  userText: string,
  opts?: { userId?: string }
): Promise<ChatResult> {
  const started = Date.now();
  const info = chatProviderInfo();
  const liveAdvice = opts?.userId ? adviseLiveSearch(opts.userId, queryFromMatrix(matrix)) : null;
  const llm = getLlmClient();
  if (!llm) {
    const fallback = heuristicChat(matrix, userText, history, opts?.userId);
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
    ...(liveAdvice
      ? [
          {
            role: "system" as const,
            content: `Live search quota (do not skip): ${JSON.stringify(liveAdvice)}`,
          },
        ]
      : []),
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content }) as const),
    { role: "user", content: userText },
  ];

  let working = matrix;
  let commit = false;
  let livePull = false;
  let liveSearch = false;
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
          const applied = applyTool(working, call.function.name, args, { userId: opts?.userId });
          working = applied.matrix;
          if (applied.commit) commit = true;
          if (applied.livePull) livePull = true;
          if (applied.liveSearch) liveSearch = true;
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
        livePull,
        liveSearch,
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
      livePull,
      liveSearch,
      usedModel: true,
      provider: llm.provider,
      model: llm.model,
      label: info.label,
      toolRounds,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const fallback = heuristicChat(matrix, userText, history, opts?.userId);
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

function wantsLiveConfirm(text: string, history: ChatMessage[]) {
  if (
    /confirm( live)?( pull| search)|use (one|1)( of)?( my| the)?( remaining)?( live)?( search|pull)|spend (a |one )?(live )?(search|pull)|use another (live )?search|go ahead and (search|pull) live/i.test(
      text
    )
  ) {
    return true;
  }
  const last = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const askedLive = /confirm live|live search|remaining|of 3|of three/i.test(last);
  return askedLive && /^(yes|ok|okay|do it|please)\b/.test(text.trim());
}

function heuristicChat(matrix: UserMatrix, userText: string, history: ChatMessage[] = [], userId?: string) {
  const text = userText.toLowerCase();
  let working = matrix;
  const notes: string[] = [];
  let commit = false;
  let livePull = false;
  let liveSearch = false;

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
  } else if (
    text.includes("single family") ||
    text.includes("single-family") ||
    text.includes("sfr") ||
    /\bhouse\b/.test(text)
  ) {
    const applied = applyTool(working, "set_dimension", {
      id: "property_type",
      enabled: true,
      prefs: { prefer: "sfr" },
    });
    working = applied.matrix;
    notes.push("Prefer single-family.");
  } else if (text.includes("condo")) {
    const applied = applyTool(working, "set_dimension", {
      id: "property_type",
      enabled: true,
      prefs: { prefer: "condo" },
    });
    working = applied.matrix;
    notes.push("Prefer condo.");
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

  if (
    text.includes("walkable") ||
    text.includes("walk-up") ||
    text.includes("walk to") ||
    text.includes("coffee") ||
    text.includes("cafe") ||
    text.includes("café") ||
    text.includes("city center") ||
    text.includes("local shop") ||
    text.includes("laid back") ||
    text.includes("laid-back") ||
    text.includes("not too busy")
  ) {
    const wantCoffee = text.includes("coffee") || text.includes("cafe") || text.includes("café");
    const wantShops = text.includes("shop") || text.includes("city center") || text.includes("walk to");
    const vibe = applyTool(working, "set_dimension", {
      id: "neighborhood_vibe",
      enabled: true,
      mustHave: false,
      prefs: { prefer: "local_center" },
    });
    working = vibe.matrix;
    notes.push("Neighborhood feel: local city-center (not sleepy, not a busy strip).");
    const amenities = applyTool(working, "set_dimension", {
      id: "local_amenities",
      enabled: true,
      mustHave: wantCoffee,
      prefs: { requireCoffee: wantCoffee, requireShops: wantShops || !wantCoffee },
    });
    working = amenities.matrix;
    if (wantCoffee) notes.push("Must have at least one café within a short walk.");
    if (wantShops || !wantCoffee) notes.push("Everyday shops within a short walk.");
    const walk = applyTool(working, "set_dimension", { id: "walkable", enabled: true });
    working = walk.matrix;
    notes.push("Walkable location preferred.");
    if (text.includes("great coffee") || text.includes("great cafe") || text.includes("create coffee")) {
      const rub = applyTool(working, "add_manual_rubric", { label: "Great coffee shop (taste)", weight: 6 });
      working = rub.matrix;
      notes.push("Added a taste rubric for coffee-shop quality.");
    }
  }

  if (text.includes("flood")) {
    const nuance =
      text.includes("sewage") ||
      text.includes("backup") ||
      text.includes("ponding") ||
      text.includes("every time it rains") ||
      text.includes("drainage") ||
      text.includes("resistant") ||
      (text.includes("flood zone") && (text.includes("but") || text.includes("still") || text.includes("in a zone")));
    const flood = applyTool(working, "set_dimension", {
      id: "flood",
      enabled: true,
      mustHave: !nuance,
      prefs: { acceptSfha: nuance },
    });
    working = flood.matrix;
    if (nuance) {
      const drain = applyTool(working, "set_dimension", { id: "flood_resilience", enabled: true, mustHave: true });
      working = drain.matrix;
      notes.push("FEMA high zone is OK. Must-have is drainage: avoid streets that pond or back up sewage after ordinary rain.");
    } else {
      notes.push("Avoid high FEMA flood-risk zones (AE/VE).");
    }
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

  const namedPlaces: string[] = [];
  const placeMap: Array<[RegExp, string]> = [
    [/\bbloomingdale\b/i, "Bloomingdale HS"],
    [/\briver hills\b/i, "River Hills"],
    [/\bvalrico\b/i, "Valrico"],
    [/\bbrandon\b/i, "Brandon"],
    [/\bst\.?\s*pete(?:rsburg)?\b/i, "St. Petersburg"],
    [/\bclearwater\b/i, "Clearwater"],
    [/\blithia\b/i, "Lithia"],
    [/\briverview\b/i, "Riverview"],
  ];
  for (const [re, label] of placeMap) {
    if (re.test(userText)) namedPlaces.push(label);
  }

  let searchArea = "";
  const citySt = userText.match(/\b([A-Za-z][A-Za-z .]{1,40}),\s*(FL|Florida|TX|CA|GA|NC|SC|AL|TN)\b/i);
  if (citySt) {
    const st = citySt[2].toUpperCase() === "FLORIDA" ? "FL" : citySt[2].toUpperCase();
    searchArea = `${citySt[1].trim()}, ${st}`;
  } else if (namedPlaces.some((p) => /petersburg|clearwater/i.test(p))) {
    const primary = namedPlaces.find((p) => /petersburg/i.test(p)) ?? namedPlaces.find((p) => /clearwater/i.test(p)) ?? namedPlaces[0];
    searchArea = `${primary}, FL`;
  } else if (/\btampa\b/i.test(userText)) {
    searchArea = "Tampa, FL";
  } else if (namedPlaces.length) {
    searchArea = `${namedPlaces[0].replace(/ HS$/, "")}, FL`;
  }

  if (searchArea) {
    const metroCity = searchArea.split(",")[0]?.trim().toLowerCase() ?? "";
    const allow = namedPlaces.filter((p) => {
      const n = p.toLowerCase().replace(/ hs$/, "");
      return n !== metroCity;
    });
    const applied = applyTool(working, "set_budget", {
      searchArea,
      ...(allow.length ? { locationAllowlist: allow } : {}),
    });
    working = applied.matrix;
    notes.push(
      allow.length
        ? `Search area set to ${searchArea} (focus: ${allow.join(", ")}).`
        : `Search area set to ${searchArea}.`
    );
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

  if (userId && wantsLiveConfirm(text, history)) {
    const applied = applyTool(working, "run_live_search", { confirm: true }, { userId });
    livePull = Boolean(applied.livePull);
    liveSearch = Boolean(applied.liveSearch);
    const advice = applied.result as { advice?: string };
    notes.push(advice.advice ?? "Confirming a live search.");
  } else if (
    userId &&
    /how many (live )?search|live (search )?quota|pulls left|preview.?live/.test(text)
  ) {
    const applied = applyTool(working, "preview_live_search", {}, { userId });
    const advice = applied.result as { advice?: string };
    notes.push(advice.advice ?? "Checking live-search quota.");
  } else if (userId && /grade (the )?cache|re-?grade|search (&|and )grade/.test(text)) {
    liveSearch = true;
    const applied = applyTool(working, "preview_live_search", {}, { userId });
    const advice = applied.result as { advice?: string };
    notes.push(advice.advice ?? "Re-grading the cached list.");
  } else if (
    userId &&
    /live search|search live|new (live )?search|another search|rentcast/.test(text)
  ) {
    const applied = applyTool(working, "preview_live_search", {}, { userId });
    const advice = applied.result as { advice?: string };
    notes.push(advice.advice ?? "Checking whether a new live search is needed.");
  }

  if (
    !livePull &&
    (text.includes("commit") ||
      text.includes("save") ||
      text.includes("looks good") ||
      text.includes("done") ||
      (text === "yes" && !wantsLiveConfirm(text, history)))
  ) {
    const baseline = baselineStatus(working);
    if (!baseline.complete) {
      notes.push(
        `Still need baseline: ${baseline.gaps.filter((g) => !g.done).map((g) => g.label).join(", ")}.`
      );
    } else {
      commit = true;
      notes.push("Matrix committed as your active grader.");
    }
  }

  if (notes.length === 0) {
    const missing = baselineStatus(working)
      .gaps.filter((g) => !g.done)
      .map((g) => g.label);
    notes.push(
      missing.length
        ? `Need baseline first: ${missing.join(", ")}. Example: Tampa, FL · 3 bed · 2 bath · single-family. Then add custom must-haves.`
        : "Baseline is set. Add custom must-haves, or say commit when ready."
    );
  }

  return { reply: notes.join(" "), matrix: working, commit, livePull, liveSearch, usedModel: false };
}
