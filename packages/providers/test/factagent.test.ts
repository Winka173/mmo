import { Claim } from "@ttm/core";
import { describe, expect, it } from "vitest";
import { assertPublicHttps, diffClaims, exportCitations, isClaimStale, registrableDomain, verifyClaimAgent } from "../src/index.js";

const pages: Record<string, string> = {
  "https://science.nasa.gov/venus": "<p>Venus rotates very slowly: a day on Venus lasts 243 Earth days.</p>",
  "https://mirror.nasa.gov/venus": "<p>Venus rotates very slowly: a day on Venus lasts 243 Earth days.</p>",
  "https://www.britannica.com/place/Venus": "<p>Venus has a rotation period of 243 Earth days, retrograde.</p>",
  "https://blog.example.com/venus": "<p>A day on Venus lasts 117 days according to us.</p>",
};
const fakeFetch = async (url: string) => (pages[url] ? new Response(pages[url], { status: 200 }) : new Response("nf", { status: 404 }));
const claim = (sources: string[], risk: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM", text = "Một ngày trên Sao Kim dài khoảng 243 ngày Trái Đất") =>
  Claim.parse({ id: "claim-1", text, riskTier: risk, status: "SOURCED_UNFETCHED", topic: "science", sources: sources.map((u) => ({ url: u, title: "t", publisher: new URL(u).hostname.includes("nasa") ? "NASA" : new URL(u).hostname.includes("britannica") ? "Britannica" : "Blog", tier: u.includes("nasa") ? "primary" : "secondary", fetchedAt: null, excerpt: null })) });

describe("FactVerificationAgent (V2)", () => {
  it("two independent publishers (different domains) => VERIFIED; mirrors of one site count once", async () => {
    const ev = { "https://science.nasa.gov/venus": ["243 Earth days"], "https://mirror.nasa.gov/venus": ["243 Earth days"], "https://www.britannica.com/place/Venus": ["243 Earth days"] };
    const mirrorsOnly = await verifyClaimAgent(claim(["https://science.nasa.gov/venus", "https://mirror.nasa.gov/venus"]), ev, { fetchImpl: fakeFetch as any });
    expect(mirrorsOnly.outcome).toBe("INSUFFICIENT");
    expect(mirrorsOnly.independent.domains).toEqual(["nasa.gov"]);
    const ok = await verifyClaimAgent(claim(["https://science.nasa.gov/venus", "https://www.britannica.com/place/Venus"]), ev, { fetchImpl: fakeFetch as any });
    expect(ok.outcome).toBe("VERIFIED");
    expect(ok.claim.sources[0].excerpt).toMatch(/243 Earth days/);
  });
  it("two credible sources contradict (numbers differ) => CONTRADICTED with citations preserved", async () => {
    const r = await verifyClaimAgent(claim(["https://science.nasa.gov/venus", "https://blog.example.com/venus"]), { "https://science.nasa.gov/venus": ["243 Earth days"], "https://blog.example.com/venus": { phrases: ["A day on Venus lasts"] } }, { fetchImpl: fakeFetch as any });
    expect(r.outcome).toBe("CONTRADICTED");
    expect(r.claim.contradictionNotes.join()).toMatch(/117/);
    expect(r.claim.sources).toHaveLength(2);
  });
  it("unreachable sources => MISSING_EVIDENCE (never invented); HIGH risk needs a primary source", async () => {
    const r = await verifyClaimAgent(claim(["https://gone.example.org/x"]), {}, { fetchImpl: fakeFetch as any });
    expect(r.outcome).toBe("MISSING_EVIDENCE");
    expect(r.claim.status).toBe("SOURCED_UNFETCHED");
    const pages2 = { ...pages, "https://www.vnexpress.net/a": "<p>243 Earth days</p>" };
    const ff = async (u: string) => (pages2[u as keyof typeof pages2] ? new Response(pages2[u as keyof typeof pages2]) : new Response("", { status: 404 }));
    const hi = await verifyClaimAgent(claim(["https://www.britannica.com/place/Venus", "https://www.vnexpress.net/a"], "HIGH"), { "https://www.britannica.com/place/Venus": ["243 Earth days"], "https://www.vnexpress.net/a": ["243 Earth days"] }, { fetchImpl: ff as any });
    expect(hi.outcome).toBe("INSUFFICIENT");
    expect(hi.reasons.join()).toMatch(/primary/);
  });
  it("SSRF guard; registrable domains; TTL staleness; claim diff resets edited claims; citations export", () => {
    expect(() => assertPublicHttps("https://127.0.0.1/admin")).toThrow(/nội bộ/);
    expect(() => assertPublicHttps("http://example.com")).toThrow(/https/);
    expect(() => assertPublicHttps("https://192.168.1.5/")).toThrow();
    expect(registrableDomain("https://news.bbc.co.uk/x")).toBe("bbc.co.uk");
    expect(registrableDomain("https://www.thanhnien.com.vn/a")).toBe("thanhnien.com.vn");
    const c = Claim.parse({ id: "price-1", text: "Giá 199.000đ", riskTier: "MEDIUM", status: "VERIFIED", topic: "price", checkedAt: "2026-10-01T00:00:00Z", sources: [] });
    expect(isClaimStale(c, new Date("2026-10-03T00:00:00Z"))).toBe(true);
    const prev = [Claim.parse({ ...c, id: "claim-a", topic: "general" })];
    const d = diffClaims(prev, [{ ...prev[0], text: "Giá 249.000đ" }, Claim.parse({ ...c, id: "claim-b" })]);
    expect(d).toMatchObject({ changed: ["claim-a"], added: ["claim-b"], removed: [] });
    expect(d.claims[0].status).toBe("UNVERIFIED");
    expect(exportCitations([claim(["https://science.nasa.gov/venus"])]).markdown).toMatch(/NASA: t — https:\/\/science.nasa.gov\/venus \(chưa truy cập\)/);
  });
});
