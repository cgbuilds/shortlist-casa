import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DEMO_COOKIE } from "@/lib/session";

export async function POST() {
  const jar = await cookies();
  jar.set(DEMO_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(DEMO_COOKIE);
  return NextResponse.json({ ok: true });
}
