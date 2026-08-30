import { AppShell } from "@/components/AppShell";
import { Workspace } from "@/components/Workspace";
import { getSessionUser, loadActiveMatrix, saveActiveMatrix } from "@/lib/session";
import { isBlankProfile, starterMatrix } from "@/lib/starter-profile";
import { redirect } from "next/navigation";

export default async function AppPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  let matrix = await loadActiveMatrix(user);
  if (isBlankProfile(matrix)) {
    matrix = starterMatrix();
    await saveActiveMatrix(user, matrix);
  }
  return (
    <AppShell email={user.email} full>
      <Workspace initialMatrix={matrix} />
    </AppShell>
  );
}
