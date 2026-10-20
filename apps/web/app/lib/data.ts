import "server-only";
import { FileQueue } from "@ttm/automation";
import { GameRegistry } from "@ttm/games";
import { MultiAccountManager } from "@ttm/governance";
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

export async function getGames(): Promise<GameRegistry> {
  return new GameRegistry(await getStore());
}

export async function getAccounts(): Promise<MultiAccountManager> {
  return new MultiAccountManager(await getStore());
}

/** URL for a game media file stored at games/<gameId>/media/<rest>. */
export function gameMediaUrl(relPath: string): string {
  const m = /^games\/([^/]+)\/media\/(.+)$/.exec(relPath);
  return m ? `/api/game-media/${m[1]}/${m[2]}` : "";
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

export const GAME_STATUS_VI: Record<string, string> = { prototype: "Prototype", pre_alpha: "Pre-alpha", alpha: "Alpha", beta: "Beta", early_access: "Early access", released: "Đã phát hành" };
export const KIND_VI: Record<string, string> = { gameplay: "Gameplay", screenshot: "Ảnh chụp", thumbnail: "Thumbnail", key_art: "Key art", character: "Nhân vật", logo: "Logo", icon: "Icon", render: "Render 3D", audio: "Âm thanh", music: "Nhạc", trailer: "Trailer", ai_concept: "Concept/AI", before_after: "Trước/sau", document: "Tài liệu" };
