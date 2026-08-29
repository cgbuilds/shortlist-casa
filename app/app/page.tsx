import { AppShell } from "@/components/AppShell";
import { Workspace } from "@/components/Workspace";
import { getSessionUser, loadActiveMatrix } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function AppPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const matrix = await loadActiveMatrix(user);
  return (
    <AppShell email={user.email} full>
      <Workspace initialMatrix={matrix} />
    </AppShell>
  );
}
