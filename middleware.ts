import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const { pathname } = request.nextUrl;
  const protectedPath =
    pathname.startsWith("/matrix") ||
    pathname.startsWith("/search") ||
    pathname.startsWith("/property");
  if (!protectedPath) return response;

  const hasDemo = request.cookies.get("pm_demo")?.value === "1";
  const hasSb = request.cookies.getAll().some((c) => c.name.includes("-auth-token"));
  if (!hasDemo && !hasSb) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
