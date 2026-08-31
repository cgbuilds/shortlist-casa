import { NextResponse } from "next/server";
import { chatProviderInfo, runMatrixChat, type ChatMessage } from "@/lib/chat";
import { getSessionUser, loadActiveMatrix, saveActiveMatrix } from "@/lib/session";
import { ensureMatrix } from "@/lib/matrix-tools";
import type { UserMatrix } from "@/lib/types";

export const maxDuration = 60;

function payload(result: Awaited<ReturnType<typeof runMatrixChat>>) {
  return {
    reply: result.reply,
    matrix: result.matrix,
    commit: result.commit,
    livePull: result.livePull,
    liveSearch: result.liveSearch,
    rescore: result.rescore,
    matrixChanged: result.matrixChanged,
    usedModel: result.usedModel,
    provider: result.provider,
    model: result.model,
    label: result.label,
    toolRounds: result.toolRounds,
    elapsedMs: result.elapsedMs,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(chatProviderInfo());
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      text?: string;
      draft?: UserMatrix;
    };
    const text = body.text?.trim();
    if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });

    const saved = await loadActiveMatrix(user);
    const draft = ensureMatrix(body.draft ?? saved);
    const result = await runMatrixChat(draft, body.messages ?? [], text, { userId: user.id });
    try {
      await saveActiveMatrix(user, result.matrix);
    } catch {
      /* still return the recap so chat does not look failed */
    }

    console.info("[homestead-chat]", {
      userId: user.id,
      provider: result.provider,
      model: result.model,
      label: result.label,
      usedModel: result.usedModel,
      toolRounds: result.toolRounds ?? 0,
      elapsedMs: result.elapsedMs,
      commit: result.commit,
      livePull: Boolean(result.livePull),
      liveSearch: Boolean(result.liveSearch),
      chars: text.length,
    });

    return NextResponse.json(payload(result));
  } catch (err) {
    console.error("[homestead-chat]", err);
    return NextResponse.json(
      {
        reply: "I could not finish that turn. Send it once more — your last message is still in the thread.",
      },
      { status: 200 }
    );
  }
}
