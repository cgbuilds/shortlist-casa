import { NextResponse } from "next/server";
import { runMatrixChat, type ChatMessage } from "@/lib/chat";
import { getSessionUser, loadActiveMatrix, saveActiveMatrix } from "@/lib/session";
import { ensureMatrix } from "@/lib/matrix-tools";
import type { UserMatrix } from "@/lib/types";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    messages?: ChatMessage[];
    text?: string;
    draft?: UserMatrix;
  };
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });

  const saved = await loadActiveMatrix(user);
  const draft = ensureMatrix(body.draft ?? saved);
  const result = await runMatrixChat(draft, body.messages ?? [], text);
  if (result.commit) await saveActiveMatrix(user, result.matrix);

  return NextResponse.json({
    reply: result.reply,
    matrix: result.matrix,
    commit: result.commit,
    usedModel: result.usedModel,
  });
}
