"use server";
import { revalidatePath } from "next/cache";
import { approveGameVideo } from "@ttm/games";
import { getQueue, getStore } from "./lib/data";

const ACTOR = "web-ui (localhost)";

export async function toggleSetting(key: "killSwitch" | "paused" | "externalPostingEnabled") {
  const store = await getStore();
  await store.updateSettings((s) => ({ ...s, [key]: !s[key] }), ACTOR);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function approveJob(jobId: string) {
  const q = await getQueue();
  const j = await q.get(jobId);
  if (j?.state !== "needs_review") return;
  // The worker re-validates every rights/fact gate before publishing; approval is editorial only.
  await q.transition(jobId, "queued", `approve by ${ACTOR}`, (x) => ({ ...x, attempts: 0, payload: { ...x.payload, approvedBy: ACTOR, approvedAt: new Date().toISOString() } }));
  const project = j.payload.projectId ? await (await getStore()).getProject(String(j.payload.projectId)) : null;
  if (project?.gameId) await approveGameVideo(await getStore(), project.gameId, project.id, ACTOR);
  revalidatePath("/jobs");
  revalidatePath("/review");
}

export async function rejectJob(jobId: string) {
  const q = await getQueue();
  const j = await q.get(jobId);
  if (!j || !["needs_review", "manual_action"].includes(j.state)) return;
  await q.transition(jobId, "failed", `reject by ${ACTOR}`);
  revalidatePath("/jobs");
  revalidatePath("/review");
}
