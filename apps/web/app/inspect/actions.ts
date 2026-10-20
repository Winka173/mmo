"use server";
import { OriginalityEngine } from "@ttm/discovery";
import { redirect } from "next/navigation";
import { getStore } from "../lib/data";

export async function overrideOriginality(projectId: string, formData: FormData) {
  let msg = "Đã ghi nhận xác nhận (audit)";
  try {
    await new OriginalityEngine(await getStore()).override(projectId, "web-ui (localhost)", String(formData.get("reason") ?? ""));
  } catch (e: any) {
    msg = `Lỗi: ${e.message}`;
  }
  redirect(`/inspect/${projectId}?msg=${encodeURIComponent(msg)}`);
}
