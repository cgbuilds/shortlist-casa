import OpenAI from "openai";
import { baselineStatus } from "@/kb/catalog";
import { adviseLiveSearch, grantCourtesySearch, getLiveQuota, isPoliteExtraSearchAsk } from "@/lib/listing-cache";
import { applyTool, CHAT_TOOLS, previewMatrix } from "@/lib/matrix-tools";
import { WHY_GRADE_INSTRUCTIONS } from "@/lib/grade";
import { queryFromMatrix } from "@/lib/rentcast";
import { applyChatPatch, parseChatPatchJson } from "@/lib/chat-patch";
import { INTERPRET_PROMPT } from "@/lib/chat-prompt";
import { wantsRescore } from "@/lib/chat-intent";
import { parseSearchLocation } from "@/lib/search-location";
import type { ChatMessage, UserMatrix } from "@/lib/types";

export const SYSTEM_PROMPT = `You are a home-buying coach for Shortlist (default: they want to **buy**, not rent). Users score listings against their must-haves (also called their home profile). You ONLY configure scoring via tools. Never invent dimensions outside the catalog.
Never say "matrix" to the user — say must-haves or home profile. Never say Homestead.

You may add a manual rubric for qualitative extras.

LOOKING TO BUY vs RENT: Default intent is buy. Live search uses for-sale listings. Only call set_budget intent "rent" if they clearly want to rent. Switching buy↔rent needs a new live pull (confirm first). Recap "Looking to buy" or "Looking to rent". For rent, maxPrice is monthly rent, not a purchase price.

BASELINE FIRST — do not skip this, and do not commit until baseline is complete:
1. General area. If they name cities (St. Petersburg, Clearwater, Valrico), put those in locationAllowlist and set searchArea to the primary city + state (e.g. "St. Petersburg, FL") — not Tampa — unless they actually asked for Tampa. Live search follows the named cities. Only use searchArea "Tampa, FL" with an empty allowlist when they want the whole Tampa metro. Never copy a default neighborhood list.
If they give a ZIP, set searchZip (replacing any previous ZIP) and search live by that ZIP. If they name a school or landmark as a point (Berkeley Prep, a high school), set searchPoint to that name and do **not** put the school in locationAllowlist — it is a radius center. Neighborhoods like Town N Country belong in searchArea, not as leftover Valrico/Brandon filters. Changing area, ZIP, or school point must replace the previous geography in the same set_budget call (pass empty strings/lists to clear).
2. Minimum bedrooms (set_dimension id beds, enabled true, min, mustHave true)
3. Minimum bathrooms (set_dimension id baths)
4. Property type (set_dimension id property_type, prefs.prefer one of townhouse | sfr | condo | multi)

After baseline is saved, ask: "Any custom must-haves?" and only then enable add-ons.

SOFT / SUBJECTIVE GATES (score these — do not set mustHave unless the user says must / dealbreaker / hard no):
- neighborhood_vibe prefs.prefer local_center = walkable local city-center (not sleepy, not a busy strip). mustHave false by default.
- local_amenities prefs.requireCoffee / requireShops. mustHave false by default so missing OSM café data does not hide the whole list.
- walkable: enabled, mustHave false.
- flood vs flood_resilience: if they accept FEMA AE/VE, set flood prefs.acceptSfha true and mustHave false. Enable flood_resilience as the must-have. If they want to avoid flood zones, keep flood mustHave true.
- add_manual_rubric for taste items (a *great* coffee shop)
- Never set school_area mustHave true. set_budget already enables location scoring. Named cities filter the live search; they are not a silent cut on the list.

If they dump everything in one message, apply baseline first, then add-ons.

Do not keep Valrico, Brandon, Bloomingdale, or River Hills unless the user said those places.
Format replies as markdown with **bold** labels and dash lists.
Keep replies short. After tools, recap what is set and what baseline is still missing.
When baseline is complete AND the user confirms, call commit_matrix. Tell them their must-haves are saved — never say matrix.

${WHY_GRADE_INSTRUCTIONS}

LIVE SEARCH QUOTA (beta): 3 live searches per user this month. Never mention account-wide API request totals, HTTP call counts, or a 50-call/month cap. If live search is unavailable, tell them to rescore the cache, upload a Redfin CSV, or wait until next month. The listing cache never expires. Tightening beds/price or changing coffee/vibe/drainage re-scores the cache for free. Widening area, type, beds, baths, or max price needs a new pull. Always call preview_live_search before recommending a new pull. Quote coveragePct (e.g. 90% of cached homes still match) and the workarounds. Recommend NOT spending a pull when coverage is high. Only call run_live_search with confirm true after they explicitly agree (e.g. "confirm live pull" / "use one of the three"). Show used/userLimit in your recap (never an account API counter).
If they ask to score / rescore / run scoring the current list without a new live pull, say you will rescore now. After a live pull, the list is scored automatically — do not ask them to tap a score button.
If they want more than 3 live searches, tell them to run scoring on the cache, upload a Redfin CSV, or wait until next month. Do not invent exceptions to the cap.`;

export { INTERPRET_PROMPT } from "@/lib/chat-prompt";
export type { ChatMessage } from "@/lib/types";

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
        timeout: 12_000,
        maxRetries: 0,
        defaultHeaders: {
          "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://shortlist.casa",
          "X-Title": "Shortlist",
        },
      }),
    };
  }
  const groq = process.env.GROQ_API_KEY;
  if (groq) {
    return {
      provider: "groq",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      client: new OpenAI({ apiKey: groq, baseURL: "https://api.groq.com/openai/v1", timeout: 8_000, maxRetries: 0 }),
    };
  }
  const openai = process.env.OPENAI_API_KEY;
  if (openai) {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      client: new OpenAI({ apiKey: openai, timeout: 8_000, maxRetries: 0 }),
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

function usesToolCalling(model: string) {
  return !/auto/i.test(model);
}

function recapProfile(matrix: UserMatrix) {
  const enabled = Object.entries(matrix.dimensions)
    .filter(([, d]) => d.enabled)
    .slice(0, 12)
    .map(([id, d]) => ({
      id,
      min: d.min,
      max: d.max,
      mustHave: d.mustHave,
      prefs: d.prefs,
    }));
  return {
    searchArea: matrix.searchArea,
    searchZip: matrix.searchZip,
    searchPoint: matrix.searchPoint,
    searchRadiusMiles: matrix.searchRadiusMiles,
    intent: matrix.intent,
    places: matrix.locationAllowlist,
    maxPrice: matrix.budget.maxPrice,
    enabled,
  };
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await run(ac.signal);
  } finally {
    clearTimeout(timer);
  }
}

export type ChatResult = {
  reply: string;
  matrix: UserMatrix;
  commit: boolean;
  livePull?: boolean;
  liveSearch?: boolean;
  rescore?: boolean;
  matrixChanged?: boolean;
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
  try {
    return await runMatrixChatInner(matrix, history, userText, opts);
  } catch {
    const started = Date.now();
    const applied = heuristicChat(matrix, userText, history, opts?.userId);
    return {
      ...applied,
      provider: "heuristic",
      model: "built-in",
      label: "Built-in coach",
      toolRounds: 0,
      elapsedMs: Date.now() - started,
    };
  }
}

async function runMatrixChatInner(
  matrix: UserMatrix,
  history: ChatMessage[],
  userText: string,
  opts?: { userId?: string }
): Promise<ChatResult> {
  const started = Date.now();
  const info = chatProviderInfo();
  if (opts?.userId && isPoliteExtraSearchAsk(userText)) {
    const fallback = heuristicChat(matrix, userText, history, opts.userId);
    return {
      ...fallback,
      provider: "heuristic",
      model: "built-in",
      label: "Built-in coach",
      toolRounds: 0,
      elapsedMs: Date.now() - started,
    };
  }
  const liveAdvice = opts?.userId ? adviseLiveSearch(opts.userId, queryFromMatrix(matrix)) : null;
  const llm = getLlmClient();
  if (!llm) {
    const applied = heuristicChat(matrix, userText, history, opts?.userId);
    return {
      ...applied,
      provider: "heuristic",
      model: "built-in",
      label: "Built-in coach",
      usedModel: false,
      toolRounds: 0,
      elapsedMs: Date.now() - started,
    };
  }

  // OpenRouter (including Auto): raw text + template → JSON crib. No keyword parser first.
  if (!usesToolCalling(llm.model)) {
    try {
      const interpreted = await withTimeout(12_000, (signal) =>
        llm.client.chat.completions.create(
          {
            model: llm.model,
            messages: [
              { role: "system", content: INTERPRET_PROMPT },
              {
                role: "system",
                content: `Current home profile: ${JSON.stringify(recapProfile(matrix))}${
                  liveAdvice
                    ? `\nLive searches ${liveAdvice.used}/${liveAdvice.userLimit} used, ${liveAdvice.remaining} left.`
                    : ""
                }`,
              },
              ...history.slice(-8).map((m) => ({ role: m.role, content: m.content }) as const),
              { role: "user", content: userText },
            ],
          },
          { signal }
        )
      );
      const raw = interpreted.choices[0]?.message?.content?.trim() || "";
      const parsed = parseChatPatchJson(raw);
      const next = parsed?.patch ? applyChatPatch(matrix, parsed.patch) : matrix;
      const matrixChanged = JSON.stringify(previewMatrix(next)) !== JSON.stringify(previewMatrix(matrix));
      const reply = parsed?.reply || (raw && !raw.trim().startsWith("{") ? raw : "") || "Updated your must-haves.";
      return {
        reply,
        matrix: next,
        commit: Boolean(parsed?.commit),
        livePull: Boolean(parsed?.livePull),
        liveSearch: Boolean(parsed?.livePull),
        matrixChanged,
        rescore: (wantsRescore(userText) || matrixChanged) && !parsed?.livePull,
        usedModel: Boolean(raw),
        provider: llm.provider,
        model: llm.model,
        label: info.label,
        toolRounds: parsed?.patch ? 1 : 0,
        elapsedMs: Date.now() - started,
      };
    } catch {
      const applied = heuristicChat(matrix, userText, history, opts?.userId);
      return {
        ...applied,
        provider: "heuristic",
        model: "built-in",
        label: "Built-in coach",
        usedModel: false,
        toolRounds: 0,
        elapsedMs: Date.now() - started,
      };
    }
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `Current home profile (must-haves) preview: ${JSON.stringify(previewMatrix(matrix))}`,
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
  const before = JSON.stringify(previewMatrix(matrix));

  try {
    while (guard < 4) {
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
      const matrixChanged = JSON.stringify(previewMatrix(working)) !== before;
      return {
        reply: msg.content || "Updated.",
        matrix: working,
        commit,
        livePull,
        liveSearch,
        matrixChanged,
        rescore: (wantsRescore(userText) || matrixChanged) && !livePull,
        usedModel: true,
        provider: llm.provider,
        model: llm.model,
        label: info.label,
        toolRounds,
        elapsedMs: Date.now() - started,
      };
    }
    const matrixChanged = JSON.stringify(previewMatrix(working)) !== before;
    return {
      reply: "I updated your must-haves.",
      matrix: working,
      commit,
      livePull,
      liveSearch,
      matrixChanged,
      rescore: (wantsRescore(userText) || matrixChanged) && !livePull,
      usedModel: true,
      provider: llm.provider,
      model: llm.model,
      label: info.label,
      toolRounds,
      elapsedMs: Date.now() - started,
    };
  } catch {
    const applied = heuristicChat(matrix, userText, history, opts?.userId);
    return {
      ...applied,
      provider: "heuristic",
      model: "built-in",
      label: "Built-in coach",
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

export { wantsRescore } from "@/lib/chat-intent";

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
  const before = JSON.stringify(previewMatrix(matrix));

  const wantsRent =
    /\b(for rent|to rent|looking to rent|want to rent|want rentals|rental search|rent a (condo|home|townhouse|apartment))\b/.test(
      text
    ) && !/\b(buy|buying|purchase|for sale|to own)\b/.test(text);
  const wantsBuy = /\b(buy|buying|purchase|for sale|to own|not rent)\b/.test(text);
  if (wantsRent && working.intent !== "rent") {
    working = applyTool(working, "set_budget", { intent: "rent" }).matrix;
    notes.push("Switched to rent. A new live search is needed for rental listings.");
  } else if (wantsBuy && working.intent !== "buy") {
    working = applyTool(working, "set_budget", { intent: "buy" }).matrix;
    notes.push("Switched back to buy (homes for sale).");
  }

  const monthlyAsk =
    working.intent === "rent" || /\/\s*mo|per month|a month|monthly rent|rent cap/.test(text);
  const price =
    userText.match(/\$?\s*(\d{3,4})\s*k\b/i) ||
    userText.match(/\$(\d{3,3}(?:,\d{3})+)/) ||
    userText.match(/\b(\d{3}(?:,\d{3}){1,2}|\d{6,7})\b/) ||
    (monthlyAsk ? userText.match(/\$(\d{3,5})\b/) || userText.match(/(\d{3,5})\s*(?:\/\s*mo|a month)/i) : null);
  if (text.includes("budget") || text.includes("max price") || text.includes("max rent") || text.includes("cap") || (price && (text.includes("price") || text.includes("$") || text.includes("rent")))) {
    let maxPrice = working.budget.maxPrice;
    if (price) {
      const n = Number(price[1].replace(/,/g, ""));
      maxPrice = monthlyAsk || working.intent === "rent" ? n : n < 10_000 ? n * 1000 : n;
    }
    const applied = applyTool(working, "set_budget", { maxPrice });
    working = applied.matrix;
    notes.push(
      working.intent === "rent"
        ? `Max rent set to $${maxPrice?.toLocaleString()}/mo.`
        : `Max price set to $${maxPrice?.toLocaleString()}.`
    );
  }

  const sqftMatch =
    userText.match(/(\d{1,2},?\d{3})\s*(?:sq\.?\s*ft|sqft|sf|square feet)\b/i) ||
    userText.match(/\b(\d{3,4})\s*(?:sq\.?\s*ft|sqft|sf)\b/i);
  if (sqftMatch || /\b(2500|2,500)\b/.test(text)) {
    const minSqft = sqftMatch ? Number(sqftMatch[1].replace(/,/g, "")) : 2500;
    const applied = applyTool(working, "set_dimension", { id: "sqft", enabled: true, min: minSqft });
    working = applied.matrix;
    notes.push(`Living area floor set to ${minSqft.toLocaleString()} sf.`);
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
    /\b(?:want a |prefer a |looking for a )houses?\b/.test(text)
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
      mustHave: Boolean(wantCoffee && (text.includes("must") || text.includes("need") || text.includes("deal"))),
      prefs: { requireCoffee: wantCoffee, requireShops: wantShops || !wantCoffee },
    });
    working = amenities.matrix;
    if (wantCoffee) notes.push("Café nearby is scored (not a hard cut unless you say must).");
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

  const place = parseSearchLocation(userText);
  if (place) {
    const applied = applyTool(working, "set_budget", {
      searchArea: place.searchArea,
      locationAllowlist: place.locationAllowlist,
      searchZip: place.searchZip,
      searchPoint: place.searchPoint,
      ...(place.searchRadiusMiles ? { searchRadiusMiles: place.searchRadiusMiles } : {}),
    });
    working = applied.matrix;
    const bits = [
      place.searchArea ? `area ${place.searchArea}` : "",
      place.searchPoint ? `centered on ${place.searchPoint}` : "",
      place.searchRadiusMiles ? `${place.searchRadiusMiles} miles` : "",
      place.searchZip ? `ZIP ${place.searchZip}` : "",
      place.locationAllowlist.length ? `focus ${place.locationAllowlist.join(", ")}` : "",
    ].filter(Boolean);
    notes.push(`Search updated: ${bits.join(" · ")}.`);
  }

  const rating = userText.match(/\brated\s+(\d(?:\.\d)?)\s*or\s*higher|\b(\d)\s*\+\s*(?:on\s+)?(?:great ?schools|rating)/i);
  if (rating && /school|elementary|district/i.test(text)) {
    const min = Number(rating[1] || rating[2] || 8);
    const applied = applyTool(working, "set_dimension", {
      id: "school_rating",
      enabled: true,
      min,
      mustHave: true,
    });
    working = applied.matrix;
    notes.push(
      `Elementary district ${min}+ is a must-have. Live listings do not include GreatSchools ratings — check it on the property; this does not move the map.`
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

  if (userId && isPoliteExtraSearchAsk(userText)) {
    grantCourtesySearch(userId);
    const quota = getLiveQuota(userId);
    if (quota.remaining > 0 && quota.globalRemaining > 0) {
      livePull = true;
      notes.push("Running another live search.");
    } else {
      const applied = applyTool(working, "preview_live_search", {}, { userId });
      const advice = applied.result as { advice?: string };
      notes.push(advice.advice ?? "Live search is at the monthly cap.");
    }
  } else if (userId && wantsLiveConfirm(text, history)) {
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
  } else if (userId && wantsRescore(text)) {
    notes.push("Scoring the current list now.");
  } else if (userId && /search (&|and )grade/.test(text)) {
    liveSearch = true;
    const applied = applyTool(working, "preview_live_search", {}, { userId });
    const advice = applied.result as { advice?: string };
    notes.push(advice.advice ?? "Scoring the current set.");
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
      notes.push("Must-haves saved as your home profile.");
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

  const matrixChanged = JSON.stringify(previewMatrix(working)) !== before;
  const recap = mustHaveLine(working);
  if (recap && !notes.some((n) => n.includes("Must-haves:"))) notes.push(recap);
  return {
    reply: notes.join(" "),
    matrix: working,
    commit,
    livePull,
    liveSearch,
    matrixChanged,
    rescore: (wantsRescore(userText) || matrixChanged) && !livePull,
    usedModel: false,
  };
}

function mustHaveLine(matrix: UserMatrix) {
  const enabled = Object.entries(matrix.dimensions).filter(([, d]) => d.enabled);
  const bits = [
    matrix.searchArea ? `Area: ${matrix.searchArea}` : "",
    matrix.searchPoint ? `Near: ${matrix.searchPoint}` : "",
    matrix.searchRadiusMiles ? `${matrix.searchRadiusMiles} mi radius` : "",
    matrix.searchZip ? `ZIP: ${matrix.searchZip}` : "",
    matrix.locationAllowlist.length ? `Places: ${matrix.locationAllowlist.join(", ")}` : "",
    matrix.budget.maxPrice ? `Cap: $${matrix.budget.maxPrice.toLocaleString()}` : "",
    ...enabled.slice(0, 6).map(([id, d]) => `${d.label ?? id}${d.min != null ? ` ≥ ${d.min}` : ""}`),
  ].filter(Boolean);
  return bits.length ? `**Must-haves:** ${bits.join(" · ")}.` : "";
}
