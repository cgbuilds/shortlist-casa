import { AppShell } from "@/components/AppShell";
import { MatrixClient } from "@/components/MatrixClient";
import { getSessionUser, loadActiveMatrix } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function MatrixPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const matrix = await loadActiveMatrix(user);
  return (
    <AppShell email={user.email}>
      <MatrixClient initial={matrix} />
    </AppShell>
  );
}
