import { NextResponse } from "next/server";
import { getSessionUser, loadActiveMatrix, saveActiveMatrix } from "@/lib/session";
import { ensureMatrix, previewMatrix } from "@/lib/matrix-tools";
import type { UserMatrix } from "@/lib/types";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const matrix = await loadActiveMatrix(user);
  return NextResponse.json({ matrix, preview: previewMatrix(matrix) });
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { matrix: UserMatrix };
  const matrix = ensureMatrix(body.matrix);
  await saveActiveMatrix(user, matrix);
  return NextResponse.json({ matrix, preview: previewMatrix(matrix) });
}
