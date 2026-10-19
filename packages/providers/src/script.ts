import { Storyboard, type Claim, type Format, type Scene } from "@ttm/core";
import { z } from "zod";

/** Structured, human/LLM-authored brief. The deterministic generator turns it into scenes. */
export const TopicBrief = z.object({
  projectId: z.string(),
  title: z.string(),
  hook: z.string(),
  hookNarration: z.string(),
  points: z
    .array(
      z.object({
        title: z.string(),
        narration: z.string(),
        bullets: z.array(z.string()).default([]),
        claimIds: z.array(z.string()).default([]),
        assetId: z.string().nullable().default(null),
        chapterTitle: z.string().nullable().default(null),
        kind: z.enum(["point", "evidence", "comparison"]).default("point"),
      }),
    )
    .min(1),
  cta: z.string(),
  ctaNarration: z.string(),
  disclosures: z.array(z.string()).default([]),
  credits: z.array(z.string()).default([]),
});
export type TopicBrief = z.infer<typeof TopicBrief>;

const TEMPLATES = {
  short_9x16: { FACT: "CuriosityFact", PRODUCT: "ProductSpotlight", ADAPT: "LicensedAdaptation", GAME: "GameDevlog" },
  long_16x9: { FACT: "StoryExplainer", PRODUCT: "TopNWithProof", ADAPT: "DeepDive", GAME: "GameDevlog" },
} as const;

/**
 * Deterministic script generator — no AI involved, so output is reproducible and honest.
 * Every scene that cites a claim gets a visible source caption built from the claim ledger.
 */
export function briefToStoryboard(brief: TopicBrief, format: Format, family: "FACT" | "PRODUCT" | "ADAPT" | "GAME", claims: Claim[], revision = 1): Storyboard {
  const cap = (ids: string[]) => {
    const pubs = [...new Set(ids.flatMap((id) => claims.find((c) => c.id === id)?.sources.map((s) => s.publisher) ?? []))];
    return pubs.length ? pubs.join(", ") : null;
  };
  const scenes: Scene[] = [
    {
      id: "s00-hook",
      kind: "hook",
      title: brief.hook,
      narration: brief.hookNarration,
      bullets: [],
      assetId: null,
      claimIds: [],
      minSeconds: 2.5,
      transition: "cut",
      sourceCaption: null,
      chapterTitle: format === "long_16x9" ? "Mở đầu" : null,
    },
    ...brief.points.map(
      (p, i): Scene => ({
        id: `s${String(i + 1).padStart(2, "0")}-${p.kind}`,
        kind: p.kind,
        title: p.title,
        narration: p.narration,
        bullets: p.bullets,
        assetId: p.assetId,
        claimIds: p.claimIds,
        minSeconds: 3,
        transition: "fade",
        sourceCaption: cap(p.claimIds),
        chapterTitle: format === "long_16x9" ? p.chapterTitle : null,
      }),
    ),
    {
      id: "s98-cta",
      kind: "cta",
      title: brief.cta,
      narration: brief.ctaNarration,
      bullets: brief.disclosures,
      assetId: null,
      claimIds: [],
      minSeconds: 2.5,
      transition: "fade",
      sourceCaption: null,
      chapterTitle: format === "long_16x9" ? "Tổng kết" : null,
    },
  ];
  if (brief.credits.length) {
    scenes.push({
      id: "s99-credits",
      kind: "credits",
      title: "Nguồn & ghi công",
      narration: "Nguồn tham khảo và ghi công có trong phần mô tả.",
      bullets: brief.credits.slice(0, 4),
      assetId: null,
      claimIds: [],
      minSeconds: 3,
      transition: "fade",
      sourceCaption: null,
      chapterTitle: null,
    });
  }
  return Storyboard.parse({
    schemaVersion: 1,
    projectId: brief.projectId,
    revision,
    format,
    template: TEMPLATES[format][family],
    title: brief.title,
    scenes,
    generatedBy: "deterministic_template",
  });
}

/** Platform-specific metadata variants (spec F). Links/disclosures placed per platform capability. */
export function platformMetadata(input: {
  title: string;
  summary: string;
  hashtags: string[];
  affiliateUrl?: string | null;
  disclosure?: string | null;
  sources: { title: string; url: string }[];
  credits: string[];
  chapters?: string | null;
  aiVoice: boolean;
}) {
  const tags = input.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  const sources = input.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n");
  const credits = input.credits.map((c) => `- ${c}`).join("\n");
  const disc = input.disclosure ? `${input.disclosure}\n` : "";
  const aiNote = input.aiVoice ? "Giọng đọc được tạo bằng TTS tổng hợp.\n" : "";
  return {
    youtube_shorts: {
      title: `${input.title} #shorts`.slice(0, 100),
      description: `${disc}${input.summary}\n\n${input.affiliateUrl ? `Link: ${input.affiliateUrl}\n\n` : ""}Nguồn:\n${sources}\n${credits ? `\nGhi công:\n${credits}\n` : ""}\n${aiNote}${tags}`.slice(0, 5000),
      linkNote: "Link trong mô tả Shorts có thể không click được tùy chính sách hiện hành — kiểm tra lại trên UI chính thức.",
    },
    youtube_long: {
      title: input.title.slice(0, 100),
      description: `${disc}${input.summary}\n\n${input.chapters ? `Chương:\n${input.chapters}\n\n` : ""}${input.affiliateUrl ? `Link: ${input.affiliateUrl}\n\n` : ""}Nguồn:\n${sources}\n${credits ? `\nGhi công:\n${credits}\n` : ""}\n${aiNote}${tags}`.slice(0, 5000),
      linkNote: "Link trong mô tả video dài thường click được.",
    },
    facebook: {
      caption: `${disc}${input.title}\n\n${input.summary}\n\n${input.affiliateUrl ? `👉 ${input.affiliateUrl}\n\n` : ""}Nguồn: ${input.sources.map((s) => s.url).join(" ")}\n${tags}`,
      linkNote: "Link trong caption Facebook có thể click; có thể thêm bình luận đầu tiên trên bài của chính mình nếu API cho phép.",
    },
    instagram: {
      caption: `${disc}${input.title}\n\n${input.summary}\n\n${input.affiliateUrl ? "🔗 Link ở bio / Story.\n\n" : ""}Nguồn: ${input.sources.map((s) => s.title).join("; ")}\n${tags}`.slice(0, 2200),
      linkNote: "Link trong caption Instagram KHÔNG click được — dùng link bio hoặc Story sticker (nhiệm vụ thủ công).",
    },
    tiktok: {
      caption: `${disc}${input.title} ${tags}`.slice(0, 2200),
      linkNote: "TikTok: link chỉ đặt ở bio/vị trí chính thức nếu tài khoản đủ điều kiện.",
    },
  };
}

/** Cutdown Short derived from our OWN long-form brief (spec D1: 2–5 cutdowns from own long video). */
export function deriveCutdownBrief(long: TopicBrief, pointIndexes: number[], projectId: string, title: string): TopicBrief {
  const points = pointIndexes.map((i) => long.points[i]).filter(Boolean).map((p) => ({ ...p, chapterTitle: null }));
  return TopicBrief.parse({
    ...long,
    projectId,
    title,
    hook: points[0]?.title ?? long.hook,
    hookNarration: `${points[0]?.title ?? long.hook}. Trích từ video dài của Tủ Tò Mò.`,
    points,
    cta: "Xem bản đầy đủ trên kênh",
    ctaNarration: "Xem video đầy đủ trên kênh Tủ Tò Mò để biết thêm.",
  });
}
