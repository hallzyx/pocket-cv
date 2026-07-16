import { requireUser } from "@/lib/auth/session";
import { InterviewClient } from "./interview-client";

export const dynamic = "force-dynamic";

export default async function InterviewPage() {
  const user = await requireUser();
  return <InterviewClient user={user} />;
}
