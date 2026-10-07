import { router } from "expo-router";

import { NewThreadForm } from "@/components/new-thread-form";

/** The connection check's end-to-end test: a read-only task on the Mac. */
export default function SampleTaskScreen() {
  return (
    <NewThreadForm
      title="Sample task"
      sampleTask
      onCreated={(thread) => {
        router.dismiss();
        router.push({ pathname: "/thread/[id]", params: { id: thread.id } });
      }}
    />
  );
}
