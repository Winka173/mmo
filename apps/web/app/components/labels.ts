// Shared VI/EN labels for machine states shown in the Studio pages. Unknown values are shown as-is.
const RUN_STATE: Record<string, [string, string]> = {
  queued: ["Đang chờ", "Queued"], running: ["Đang chạy", "Running"], needs_input: ["Cần xử lý", "Needs input"],
  failed: ["Lỗi", "Failed"], ready: ["Sẵn sàng", "Ready"], cancelled: ["Đã hủy", "Cancelled"],
  passed: ["Đạt", "Passed"], flagged: ["Cần xem", "Flagged"], skipped: ["Bỏ qua", "Skipped"], blocked: ["Bị chặn", "Blocked"],
  uploading: ["Đang tải lên", "Uploading"], processing: ["Nền tảng đang xử lý", "Processing"], available: ["Đã có trên nền tảng", "Available"], reserved: ["Đã giữ chỗ", "Reserved"],
};
const STAGE: Record<string, [string, string]> = {
  intake: ["Nhận đầu vào", "Intake"], research: ["Nghiên cứu", "Research"], script: ["Kịch bản", "Script"], storyboard: ["Storyboard", "Storyboard"],
  media: ["Media", "Media"], voice: ["Giọng đọc", "Voice"], captions: ["Phụ đề", "Captions"], preview: ["Preview", "Preview"],
  quality: ["Kiểm tra chất lượng", "Quality"], repair: ["Sửa lỗi", "Repair"], render: ["Dựng video", "Render"], eligibility: ["Điều kiện đăng", "Eligibility"],
  delivery: ["Giao bản", "Delivery"], analytics: ["Số liệu", "Analytics"],
};
const GATE: Record<string, [string, string]> = {
  NEEDS_REVIEW: ["Chờ duyệt", "Needs review"], APPROVED: ["Đã duyệt", "Approved"], REJECTED: ["Từ chối", "Rejected"], DEFERRED: ["Để sau", "Deferred"], BLOCKED: ["Bị chặn", "Blocked"],
};
const GATE_REASON: Record<string, [string, string]> = {
  editorial: ["Xem hook, mạch kể, hình khớp lời, phụ đề và thương hiệu.", "Review hook, narrative, visual agreement, captions and brand."],
  voice: ["Nghe phát âm, ngôn ngữ, nhịp đọc và độ khớp.", "Listen to pronunciation, language, pacing and synchronization."],
  facts: ["Đối chiếu tuyên bố với bằng chứng độc lập; khớp chữ không chứng minh là đúng.", "Check claims against independent evidence; matching text does not establish truth."],
  rights: ["Xem quyền sở hữu nguồn, nền tảng, phạm vi, thời hạn và quyền giọng/hình.", "Review source ownership, platforms, scope, expiry and voice/graphic rights."],
};
const pick = (map: Record<string, [string, string]>, key: string, en: boolean) => map[key]?.[en ? 1 : 0] ?? key;
export const runStateLabel = (state: string, en: boolean) => pick(RUN_STATE, state, en);
export const stageLabel = (id: string, en: boolean) => pick(STAGE, id, en);
export const gateLabel = (status: string, en: boolean) => pick(GATE, status, en);
export function gateReason(category: string, status: string, en: boolean, fallback = "") {
  if (status === "BLOCKED") return en ? "A cited quote is absent from retrieved evidence; revise the script or source first." : "Một trích dẫn không có trong bằng chứng đã tải; sửa kịch bản hoặc nguồn trước.";
  return GATE_REASON[category]?.[en ? 1 : 0] ?? fallback;
}
/** Server-side schedule reasons are English; translate the known ones. */
export function scheduleReason(reason: string, en: boolean) {
  if (en) return reason;
  const backlog = /^Backlog cap: (\d+)\/(\d+)/.exec(reason);
  if (backlog) return `Đã đạt giới hạn tác vụ chờ ${backlog[1]}/${backlog[2]}; hãy tiếp tục hoặc xử lý các tác vụ đang có trước.`;
  return ({
    "Advanced production schedule disabled": "Chưa bật lịch sản xuất nâng cao",
    "Topic / campaign has expired": "Chủ đề / chiến dịch đã hết hạn",
    "Inside owner-configured production window and limits": "Trong khung giờ và giới hạn đã cấu hình",
    "Simulation only: no jobs, uploads or account actions": "Chỉ mô phỏng: không tạo tác vụ, không tải lên, không thao tác tài khoản",
    "Future production is assumed completed for quota simulation; actual backlog may defer work": "Giả định các lượt tương lai đều hoàn tất khi tính hạn mức; tồn đọng thực tế có thể làm dời lịch",
    "Source novelty/rights/quality/available GPU are rechecked at execution; projections do not promise output": "Nguồn mới, quyền, chất lượng và GPU được kiểm tra lại khi chạy; dự kiến không cam kết có sản phẩm",
    "Production timing does not authorize or schedule public posting": "Lịch sản xuất không cho phép và không lên lịch đăng công khai",
  } as Record<string, string>)[reason] ?? reason;
}
export const shortTime = (iso: string, en: boolean) => { try { return new Intl.DateTimeFormat(en ? "en-GB" : "vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; } };
