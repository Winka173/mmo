import {z} from "zod";
/** Safe deterministic typography and overlays; profiles convey no source or publication authority. */
export const BrandStyle=z.object({
 name:z.string().trim().max(100).default(""),font:z.enum(["Arial","Segoe UI","Tahoma","Verdana"]).default("Arial"),
 voices:z.object({vi:z.string().trim().max(100).default(""),enUs:z.string().regex(/^$|^a[fm]_[a-z]+$/).default(""),enGb:z.string().regex(/^$|^b[fm]_[a-z]+$/).default("")}).default({}),
 accent:z.string().regex(/^#[a-fA-F0-9]{6}$/).default("#7358e8"),captionColor:z.string().regex(/^#[a-fA-F0-9]{6}$/).default("#ffffff"),
 captionScale:z.number().min(.7).max(1.4).default(1),captionMargin:z.number().min(.08).max(.3).default(.12),
 cta:z.string().trim().max(150).default(""),ctaSeconds:z.number().min(1).max(8).default(3),
 logo:z.object({file:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),rightsEvidence:z.string().trim().min(12).max(6000)}).nullable().default(null),
 logoCorner:z.enum(["top_left","top_right"]).default("top_right"),logoWidth:z.number().min(.05).max(.25).default(.12),
}).strict();
export type BrandStyle=z.infer<typeof BrandStyle>;
