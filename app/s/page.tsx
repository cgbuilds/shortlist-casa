import type { Metadata } from "next";
import { OpenShare } from "@/components/OpenShare";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Shared shortlist · ${BRAND_NAME}`,
  description: "Open a scored home shortlist someone sent you.",
};

export default function SharePage() {
  return <OpenShare />;
}
