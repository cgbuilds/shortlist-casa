import { AppShell } from "@/components/AppShell";
import { PropertyClient } from "@/components/PropertyClient";
import { grade } from "@/lib/grade";
import { getSessionUser, loadActiveMatrix, loadListing } from "@/lib/session";
import { notFound, redirect } from "next/navigation";

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { id } = await params;
  const listing = await loadListing(user, id);
  if (!listing) notFound();
  const matrix = await loadActiveMatrix(user);
  const g = grade(listing, matrix);
  return (
    <AppShell email={user.email}>
      <PropertyClient initialListing={listing} initialGrade={g} />
    </AppShell>
  );
}
