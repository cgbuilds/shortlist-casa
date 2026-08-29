import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DEMO_COOKIE } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const jar = await cookies();
  jar.delete(DEMO_COOKIE);
  const supabase = await createSupabaseServer();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
