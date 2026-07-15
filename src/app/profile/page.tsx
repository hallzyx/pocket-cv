import { requireUser } from "@/lib/auth/session";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const user = await requireUser();

  return <ProfileClient user={user} />;
}
