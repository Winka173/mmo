export default function Msg({ msg }: { msg?: string | string[] }) {
  const m = Array.isArray(msg) ? msg[0] : msg;
  if (!m) return null;
  const bad = /^(Lỗi|Không)/.test(m);
  return <p role="status" className={`rounded-md px-3 py-2 text-sm ${bad ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"}`}>{m}</p>;
}
