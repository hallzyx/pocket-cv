import { requireUser } from "@/lib/auth/session";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const user = await requireUser();
  return <DashboardClient user={user} />;
}
