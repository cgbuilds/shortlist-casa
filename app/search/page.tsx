import { AppShell } from "@/components/AppShell";
import { SearchClient } from "@/components/SearchClient";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function SearchPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return (
    <AppShell email={user.email}>
      <SearchClient />
    </AppShell>
  );
}
