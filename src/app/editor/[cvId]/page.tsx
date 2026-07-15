import { requireUser } from "@/lib/auth/session";
import { EditorClient } from "./editor-client";

export default async function EditorPage() {
  const user = await requireUser();
  return <EditorClient userId={user.id} email={user.email} name={user.name} />;
}
