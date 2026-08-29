import { AuthPanel } from "@/components/AuthPanel";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const user = await getSessionUser();
  if (user) redirect("/app");

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-12 px-4 py-16 lg:grid-cols-2">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">Homestead Matrix</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl leading-tight">
          Grade listings against a matrix you built in chat.
        </h1>
        <p className="mt-4 max-w-md text-[var(--muted)]">
          Categories come from a knowledge base (structure, seller motivation, PITIA slack, school area).
          Search uses your Redfin favorites CSV. Chat builds the grader. One screen: chat, list, and map.
        </p>
      </div>
      <div className="rounded-3xl border border-[var(--line)] bg-[var(--paper-2)] p-6 shadow-sm">
        <AuthPanel />
      </div>
    </div>
  );
}
