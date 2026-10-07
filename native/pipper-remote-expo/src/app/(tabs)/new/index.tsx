import { router } from "expo-router";

import { NewThreadForm } from "@/components/new-thread-form";
import { remoteSession, useRemoteSession } from "@/remote/session";

export default function NewThreadTab() {
  const { homeProjectId } = useRemoteSession();
  return (
    <NewThreadForm
      title="New thread"
      initialProjectId={homeProjectId || null}
      onCreated={(thread) => {
        // Land on Home for that project, with the new thread open on top.
        remoteSession.setHomeProjectId(thread.projectId);
        router.navigate("/");
        router.push({ pathname: "/thread/[id]", params: { id: thread.id } });
      }}
    />
  );
}
