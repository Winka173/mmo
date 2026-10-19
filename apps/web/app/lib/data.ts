import "server-only";
import { FileQueue } from "@ttm/automation";
import { DataStore } from "@ttm/storage";

let store: DataStore | null = null;

/** Same file-only source of truth as the worker; the UI never owns state. */
export async function getStore(): Promise<DataStore> {
  if (!store) {
    store = new DataStore();
    await store.init();
  }
  return store;
}

export async function getQueue(): Promise<FileQueue> {
  return new FileQueue(await getStore());
}

export const STATUS_VI: Record<string, string> = {
  READY_FOR_REVIEW: "Chờ duyệt",
  HOLD_FACTS: "Giữ: cần kiểm chứng",
  HOLD_RIGHTS: "Giữ: quyền sử dụng",
  HOLD_AFFILIATE: "Giữ: affiliate",
  HOLD_POLICY: "Giữ: chính sách",
  CANDIDATE: "Ứng viên",
  PUBLISHED: "Đã đăng",
  NEEDS_USER: "Cần người dùng",
};
