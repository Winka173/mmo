# AUTONOMOUS CREATIVE STUDIO
## Complete Implementation Master Prompt — Local AI, Multi-Language, Multi-Step UI, Automated Production & Publishing

**Document version:** 1.0 — 22 October 2026  
**Audience:** Claude Code working inside the EXISTING repository.  
**Language:** Implementation instructions in English. App UI, project content, narration, and captions must support **Vietnamese and English** independently. Engineering reports to owner in Vietnamese.  
**Scope:** One general-purpose creative/content/marketing desktop application; **not branded or restricted to one content channel**.

> **EXECUTION TASK:** Audit the existing application, preserve functioning architecture and data, and implement an automation-first creative studio. This is not a greenfield rewrite, documentation-only assignment, or mockup exercise. Work incrementally, test with actual source files and actual local model inference. Do not call a placeholder “implemented.” Keep logs of verified vs unverified steps.

---

# 1. PRODUCT VISION AND OPERATING PRINCIPLES

Build a Windows desktop application where the user can set up an ongoing **Autopilot** once, then the system autonomously discovers or ingests content, plans what to create, scripts, creates original or appropriately licensed visuals, narrates, edits, subtitles, performs QA, repairs, versions, schedules, publishes within authorized policy, verifies post status, analyzes performance, and plans the next batch.

**The primary design goals are:**

1. **Maximum practical automation; minimum repeated user input**. Require initial selection of project/content source, target channels, language, and publication authority; infer nonessential settings. `Auto` is the default. Ask only when essential missing data, significant rights/claims risk, a materially irreversible decision, or unavailable external authorization requires it.
2. **Local AI by default and no mandatory paid AI APIs**. All LLM, vision, embeddings, ASR, translation, TTS, image generation, and optional video generation run on local supported checkpoints. Never silently use cloud inference. External services remain necessary for discovery and publishing, and may impose their own requirements/costs.
3. **Separate content creation from public posting**. Produce drafts automatically. Auto-publish only for channels and content classes explicitly authorized under a persistent, revocable policy, with all factual, rights, identity, and platform gates passed. Do not create fake approvals.
4. **Preserve originals, source attribution, versions, editable timelines, and rights records**. A valid export is not equivalent to good editorial quality or permission to publish.
5. **Project-independent**. Support many games, brands, knowledge topics, partner creators, products, languages and channels. No hardcoded single-brand identity.
6. **Multi-step UI, not one giant form or overloaded monolithic page**. Make workflow stages visually explicit, individually inspectable and editable. The interface should be approachable for beginners and powerful for advanced users.
7. **Reliable over long unattended runs**. Durable queue, checkpoints, stage-specific repair, provider reconciliation, resource coordination, idempotency and exception-only notifications.

Do not introduce fake gameplay, fabricated product trials, invented facts, unauthorized reposts, misleading AI-generated evidence, impersonation, fake engagement, spam, or mass posts that bypass platform policy. Translation/dubbing by itself is not automatic permission to republish another creator's footage.

---

# 2. AUDIT EXISTING REPOSITORY BEFORE CHANGES

Read this spec alongside the actual repo, not in place of it. Existing project structure described in the reviewed document:

- `apps/web` — Next.js 16 / React 19 / TypeScript / Tailwind 4 control center.
- `apps/worker` — Node/TypeScript daemon, CLI, queue/orchestration.
- `packages/core` — Zod contracts, job state and policies.
- `packages/storage` — JSON/JSONL, atomic writes, file locks, backups, migrations and secrets.
- `packages/automation` — scheduler, queue, planning.
- `packages/media` — narration, gameplay processing, rendering, thumbnails, subtitles, GPU utilities.
- `packages/providers` — scripts, research/translation, local LLM adapters, fact checking, long-to-short.
- `packages/discovery` — source retrieval, provenance, duplicate prevention.
- `packages/games` — game registry, builds, asset intake, campaigns.
- `packages/quality` — quality judge, repair.
- `packages/governance` — rights, connected accounts, budgets, affiliates, comments.
- `packages/insights` — analytics, scheduling, variants and opportunity radar.
- `packages/platforms` — YouTube, Meta, TikTok, mock/manual export.
- `packages/telegram` — bot, outbox, commands and reporting.

**Do not assume any listed component is complete, and do not mark future Windows/local AI components as shipped.** The reviewed spec states the existing pipeline/dashboard/worker exist but Windows packaging and new AI integrations are plans pending implementation and benchmark.

Audit: versions, Git working tree, dependency locks, active Node services, Next server functions, queue persistence, storage invariants, existing automation, media pipeline, platform adapters, assets, permissions, tests, installation behavior and available Python runtimes. Record baseline commands/output, actual Windows executable smoke test status and unreconciled gaps.

**Preserve architecture:** Node/TypeScript worker and backend, Next.js UI, JSON/JSONL file storage (no forced SQLite migration), local Python AI engine in isolated `uv` environments, FFmpeg/FFprobe/Sharp/libass, DPAPI (or established secure local OS-backed equivalent) for credentials. Proposed Windows shell: Tauri 2 + WebView2 + controlled backend sidecars; audit how to package Next server rendering, never assume static Next export is sufficient. Do not substitute FastAPI simply because another application uses it.

Create/maintain project documentation: `docs/AUTOPILOT_AUDIT.md`, `docs/ARCHITECTURE.md`, `docs/WORKFLOW_MATRIX.md`, `docs/MODEL_COMPATIBILITY.md`, `docs/QUALITY_GATES.md`, `docs/RELEASE_QA.md`, `docs/KNOWN_ISSUES.md`. This documentation is subordinate to real working implementation.

---

# 3. MULTI-STEP, CLEAR AND EASY UI — MANDATORY

Do **not** collapse setup, source collection, script, storyboard, editing, QA, publish and analytics into one crowded page. Build separate **navigation destinations and a visible stepper/wizard** where tasks are naturally sequential; preserve drafts when navigating between steps.

## 3.1 Main navigation

1. **Home / Overview** — automation status, today's schedule, recent outputs, exceptions, GPU, connected accounts, opportunities.
2. **Projects & Brands** — games, campaigns, fact channels, affiliate brands, localization partners, assets, languages, profiles.
3. **Autopilots** — ongoing configured factories and content sources; add, pause, resume, change cadence, permissions and priority.
4. **Create** — guided one-off creation and previews, clearly separated from recurring Autopilot setup.
5. **Production** — queue, per-stage progress, logs, resources, retries and intermediate outputs.
6. **Editor** — transcript-based editing, multi-track timeline, prompt-based changes, versions and before/after comparison.
7. **Media Library** — searchable original footage, images, audio, references, generated exports, usage and licenses.
8. **Review & Approvals** — exception inbox with evidence and granular approval decisions.
9. **Planner / Calendar** — editorial plan, publish cadence, drafts, scheduled posts, channel timezone, embargo and quotas.
10. **Channels & Accounts** — permissions, platform capability, reconnect, channel identity, validation and secure credentials.
11. **Insights** — watch time, retention, engagement, traffic, attribution, experiments, uncertainty and learnings.
12. **Models & Tools** — local engine manager, GPU, model installation/validation, voices, benchmarks and dependency repair.
13. **Telegram & Notifications** — bot pairing, access policy, event levels and reports.
14. **Settings / Diagnostics** — backups, storage, CPU/GPU policy, logs, environment checks, security and localization.

Use progressive disclosure: most navigation destinations have a beginner-friendly default and a separate Expert details/Advanced settings view.

## 3.2 Create a new Autopilot: 7 distinct setup steps

**Step 1 — Choose Content Type:** Game Marketing / Knowledge & Facts / Product & Affiliate / Authorized Channel Localization / Long-to-Shorts / Custom. Show brief examples and prerequisites.

**Step 2 — Choose Sources:** game assets/gameplay/screenshots/changelog; topic and trusted sites; product categories and shops; creator/channel URL + authorization; existing media. Drag/drop, folder/watch folder, source URL when allowed. Auto-discover missing noncritical items; show rights state.

**Step 3 — Audience & Language:** audience, desired tone, output language(s) `vi-VN` and/or `en-US`/`en-GB`, caption languages, multilingual variants, pronunciation dictionary, brand voice. Auto-inherit project defaults. English and Vietnamese must each produce high-quality actual narration; not just translated subtitles.

**Step 4 — Platforms & Frequency:** connected channels, per-channel aspect ratio, cadence/targets, posting hours and timezones, auto-schedule strategy, per-day/week limits, alternative manual publishing path. Use grounded platform capabilities and avoid promising forbidden automation.

**Step 5 — Creative Preferences:** template/style, content length, hook, thumbnail, audio/voice preset, CTA, source mix, quality preset, allowed generative imagery, authenticity rules. Defaults require no manual settings.

**Step 6 — Automation & Safety:** three modes: Draft Only / Auto Produce + Review Before Publish / Policy-Authorized Auto Publish. Show actual required scopes, rights rules, disclosures and exception categories. Get explicit consent for auto-publishing policy, never per-video unnecessary approval once authorized. No implicit external account actions beyond granted policy.

**Step 7 — Review Plan & Activate:** display a concise plain-language summary, estimated resource ranges only if benchmark-based, preview of example outputs, rights/capabilities status, test-run button, then `Activate Autopilot`.

Wizard must show `Step X of 7`, Back/Next, progress, editable completed steps, inline validation, autosave partial drafts and shortcuts to expert config. Never reset state when changing step. Allow skipping optional steps. Initial activation should record snapshot + user approval policy.

## 3.3 One-off Create wizard: 6 separate steps

`1. Goal & Input → 2. Research / Content Plan → 3. Script & Storyboard → 4. Media / Voice → 5. Preview & Edit → 6. QA / Export or Publish`.

Auto mode may pass through steps automatically but UI must **visibly track each step**, permit drill-down and `Edit this Step`, and show its intermediate artifacts. User may refine any completed step via prompt. Avoid pop-ups for every step.

## 3.4 Per-video Production steps (visible timeline)

`Source Intake → Research/Verify → Script → Storyboard → Media Selection/Generation → Voice/Music/SFX → Captions → Edit/Preview → Technical & Editorial QA → Targeted Repair → Final Render → Rights/Channel Check → Approved / Scheduled / Published → Analytics`.

Render as a compact vertical or horizontal stepper with expanding individual stages, rather than cramming controls into a single video editor screen. Stage status: Queued/Running/Passed/Flagged/Needs Input/Failed/Skipped/Blocked. Make skipped stages intelligible.

## 3.5 Video Detail and Editor layout

- Workspace tabs: `Preview`, `Transcript`, `Timeline`, `Audio & Voice`, `Storyboard`, `Quality`, `Versions`, `Publish`.
- A persistent preview pane, selectable clips/time range, separate prompt-to-edit panel, undo/redo and compare.
- Exact operations like 'cut 00:05–00:08' should deterministically edit an existing timeline without AI generation.
- Audio tracks Music / Dialogue / SFX separate, and captions editable by language.
- `Make it more exciting` must produce a concrete edit plan and modify only affected clips; never silently rewrite approved factual claims.
- Project/version selector always visible; video editing and publish approval are separate steps.

## 3.6 Review and exception UX

One clear Inbox: `Needs Rights`, `Fact Unverified`, `Platform Permission`, `High-Risk Claim`, `Quality Review`, `Retry Exhausted`, `Publish Reconciliation`. Every item displays why, evidence, suggested fix, effect on schedule, buttons Fix/Approve With Scope/Reject/Defer. Do not spam the user for low-risk internal issues. Full Vietnamese and English UI localization, including errors and onboarding.

---

# 4. AUTONOMOUS OPERATING MODEL

Autopilot is a **persistent configuration that generates jobs over time**, not one video job.

`Source Watch / Opportunity Discovery → Idea Ranking → Content Brief → Source/Facts/Rights → Storyboard/Script → Media Assembly + Local AI → Preview → Quality Gates → Auto Repair → Publish Eligibility → Scheduler → Platform Reconciliation → Analytics → Next Cycle`.

Content Director should choose among legitimate opportunities using recency, relevance, audience, novelty, availability of permitted footage, strength of evidence, project goals, past coverage, creation cost and schedule. Avoid pure volume maximization. Store the rationale and provenance. If no useful safe content exists, skip that slot, log it and notify at configured severity rather than fabricating an output.

Scheduling: cadence goals, backlog, timezone, embargo, daylight/quiet hours, platform caps, resource budgets, catch-up limits, stale topic expiration, duplicate suppression. `5 videos/week` is a target, not license to publish low-quality filler. Support a dry-run calendar simulation.

Use durable job IDs, content identity hashes, project locks, one active authorization snapshot per execution, clear cancellation rules, safe retries and cross-stage cache invalidation. Workers and app may restart unattended without losing completed artifacts. Publishing jobs require idempotency/reconciliation and double-check account identity immediately before send.

**Autonomy policy:** default auto discovery, research, production and repair; auto-post only for authorized content category + connected channel + verified rights + passed gates + posting parameters. High-risk claims, missing permissions, unresolved licensing, unknown source ownership, account reconnect, policy changes and destructive operations require exception handling. No platform circumvention, fake engagement, or bypassing CAPTCHA/DRM/login restrictions.

---

# 5. ADAPTIVE CONTENT ROUTING — DISTINCT PIPELINES

## 5.1 Game Marketing Autopilot

User supplies game identity plus gameplay video, screenshots, logo, brand kit, optional build/changelog/store link. Automatically:
- Verify actual shipped functionality from approved project docs and build metadata; never invent mechanics, monsters, features or release dates.
- Analyze gameplay using scene detection, optional ASR/OCR, validated local multimodal model, event/highlight candidates and manual reference anchors.
- Create highlights, Shorts, teasers, explainers, devlogs, hero/boss introductions, features and milestone campaigns.
- Prefer real gameplay footage for gameplay claims. Visually label concept/cinematic footage if necessary; never present synthetic footage as genuine gameplay.
- Generate Vietnamese and/or English voiceover, captions, original graphics, controlled motion/zoom and audio. Export per-platform 9:16/16:9 variants with safe crop.
- Track game versions, asset/version provenance, wishlist/demo/install/store URLs, embargo and authorized launch milestones.
- Integrate with Asset Forge *via published file manifests, shared folders or versioned local API*, not direct mutation of its storage. Pin asset versions used by published videos.
- If source material is exhausted or no new verified content exists, reduce production or request more assets; do not endlessly remake identical clips.

## 5.2 Knowledge/Facts Autopilot

Discover topic → rank originality and value → gather reputable sources with timestamp → structure individual verifiable claims → write engaging script in selected language → storyboard → illustrations → original narration → captions → QA/repair → schedule. Distinguish evidence from model-generated explanation. When claims are contested, preserve caveats. Never treat an AI answer as a cited source.

Support themed series and episodic content memory. Verify current claims against sufficiently recent sources when they are time-sensitive. Respect publisher paywalls, copyright and terms.

## 5.3 Product/Affiliate Autopilot

Choose category/marketplace/price range and supported partner programs → discover eligible products via permitted APIs/pages → capture price/spec/date/availability/source → screen duplicate/low-evidence listings → choose comparison angle → generate original product explainer or research-based comparison → voice + visuals → disclosure/CTA + valid affiliate link → review and publish.

Do not claim firsthand testing or ownership unless explicitly evidenced. Pricing may be stale; label retrieval date and recheck before post. Do not generate fabricated product footage/reviews or purchase actions. Support per-marketplace licensing and platform disclosure policy.

## 5.4 Authorized Chinese Channel Localization Autopilot

Let user register a particular creator/channel on permitted sources (e.g. an authorized Bilibili/Douyin/Taobao creator feed) with defined rights. Periodically detect new items via allowed discovery surface. Record source URL, author, post ID, timestamp, rights documentation, usage scope and allowed platforms. Retrieve actual media only through creator-provided files, authorized export, documented API or other permitted methods. Do not bypass authentication, anti-bot systems, DRM, paywalls or redistribute without permission.

For authorized media: Mandarin ASR → segmentation → Vietnamese and/or English translation with style adaptation, names/glossary → selected TTS voices → dub timing/music/SFX → subtitles → original editing/additions → provenance + disclosure → QA → auto-publish according to authorized policy. If authorization is missing, use discovery for ideas only: produce a new independently authored explainer with cleared visuals, or hold as pending rights; do not repost footage simply by dubbing/cropping.

## 5.5 Long-to-Shorts Autopilot

Ingest permitted long video, detect segments, assess standalone meaning, attention hook, complete thought, visual framing, duplicate risk; produce multiple coherent short narratives with their own opening/ending/CTA. Reframe subject-aware, subtitle, trim, retime, and preserve speaker meaning. Never optimize only for dubious 'viral score'.

## 5.6 Custom content templates

Allow data-driven user templates combining existing stages while forbidding unsupported actions and avoiding arbitrary code execution from untrusted templates.

---

# 6. LOCAL MODEL STACK — VIETNAMESE AND ENGLISH VOICES REQUIRED

Build a **capability-based model registry**; installation alone is not evidence a model works. For each engine/checkpoint record source, license, hash, GPU/CPU memory, Windows compatibility, actual benchmark, supported languages, actual execution mode and known limitations. Use isolated Python `uv` environments, preserve version locks and avoid conflicting dependencies. Never download everything by default.

Candidate stack to evaluate against real hardware (RTX 5070 Ti ~16GB VRAM, ~62GB RAM available):

| Capability | Candidate(s) | Requirement / caveat |
|---|---|---|
| Script, research synthesis, creative director, translation, multimodal review | Qwen3.5-9B quantized and runtime verified locally | Benchmark specific weights, vision path, prompt correctness and licensing; no fictitious cloud fallback |
| ASR & footage voice transcription | Qwen3-ASR-1.7B | Validate Mandarin, English and Vietnamese WER; do not assume its companion forced aligner supports Vietnamese word timing |
| Embedding/retrieval/duplicate semantics | Qwen3-Embedding-0.6B | Versioned index alongside JSON/JSONL; source of truth remains existing storage |
| Vietnamese local TTS | VieNeu-TTS v3 Turbo | Benchmark actual Vietnamese voice checkpoints, rhythm, mixed English words and commercial rights |
| **English local TTS — default lightweight** | **Kokoro-82M** | Benchmark US/UK voices and long-form pronunciation; source model Apache-2.0, verify bundled dependencies and specific voices |
| **English local TTS — expressive alternative** | **Chatterbox English / Chatterbox-Turbo** | Benchmark expressive voice, available RAM/VRAM, model version, MIT license, pronunciation and voice provenance; optional authorized voice references |
| Optional English multilingual & additional languages | Chatterbox Multilingual | Use only languages genuinely supported by selected checkpoint; do **not** assume Vietnamese from generic multilingual label without confirmation |
| Image illustrations/thumbnail | FLUX.2 klein 4B or Z-Image-Turbo | Benchmark Windows 16GB, quality, reference consistency, license and text avoidance; render accurate captions/titles via font pipeline |
| OCR | PaddleOCR v5 components | Verify actual Chinese/English/Vietnamese language recognition and source build availability |
| VAD | Silero VAD | CPU use when possible |
| Optional short local AI footage | Wan local supported version after actual benchmark | GPU/OOM gated; never require for simple edits |
| Deterministic media | FFmpeg, FFprobe, Sharp, libass, optional NVENC | Mandatory reliable fallback for edit, animation/pan/zoom, captions, output |
| Optional music/SFX | Locally verified licensed generator or user-provided royalty-cleared library | Rights and quality verified; basic app must function without generative music |

**TTS Voice Studio requirements:**
- Per-project voice profile(s), Vietnamese and English independently. Support locale/accent and approved speaker voices, speech rate, pauses, style/emotion controls only when supported.
- Voice audition/preview, voice catalog with cached samples and `Verified on This Machine` tag.
- Automatic pronunciation dictionary for game names, product brands, acronyms, numbers and bilingual terms.
- Segment-based narration, text alignment, silence/VAD checks, ASR round-trip comparison, audio loudness normalization, de-essing where appropriate, breath/pause cleanup without unnatural chopping.
- Narration fallback between VERIFIED voices of same requested language if policy permits, clearly record change; NEVER silently substitute Chinese/English voice for Vietnamese or a paid/cloud voice.
- English subtitle grammar/punctuation and Vietnamese diacritics and phrasing must be correct. English and Vietnamese need **different scripts where localization demands it**, not mechanical word-for-word translation.
- Avoid cloning/imitating identifiable people's voices without appropriate permission; keep voice source/provenance and local storage policies.

**English voice references for implementer verification:**
- Kokoro official: https://huggingface.co/hexgrad/Kokoro-82M
- Chatterbox official: https://github.com/resemble-ai/chatterbox
- Chatterbox checkpoint card: https://huggingface.co/ResembleAI/chatterbox
- VieNeu project: https://github.com/pnnbao97/VieNeu-TTS

Only claim a language/voice works after synthesizing and listening/reviewing a real sample in that locale, then checking audio files and transcription.

---

# 7. STAGE-BASED QUALITY ENGINE AND REPAIR PLANNER

After important stages use **deterministic checks first**, then available local AI review where appropriate. Structured QA outputs: `criterion, status (pass/fail/unknown), evidence, confidence, severity, timestamp, modelVersion, relevantFiles, recommendedFix`. AI confidence is not proof. Unknown is not Pass. Claim verification and rights rely on evidence, not model opinion.

Quality gates:
1. **Input/Sources:** valid files, URLs, provenance, ownership/right-to-use, currentness; game feature evidence.
2. **Research:** backed claims, conflicting sources, dates, no invented citations, affiliate/product prices labeled with retrieval date.
3. **Script:** accuracy, compelling but non-deceptive hook, audience/tone, originality, length, clear CTA, language fluency.
4. **Storyboard:** each segment mapped to available or producible footage, visual–narration agreement, readability and aspect ratio.
5. **Media:** valid source footage, no missing rights, no fake gameplay, scene duplication and black/loading/debug/OCR flags.
6. **Voice:** phonetic dictionary, correct language and wording, ASR round-trip, speed/pauses and clipping.
7. **Captions:** accurate text, aligned phrases, reading speed, safe zone, diacritics, no dangerous overflow, supported font.
8. **Preview:** factual consistency, transitions, cut continuity, subject-aware 9:16 framing, audible mix, correct brand.
9. **Technical final:** file decode, codec, FPS, resolution, duration tolerance, black/freeze/silence, peak/loudness, caption burn-in and metadata.
10. **Publish eligibility:** rights by channel, current credentials/scopes, required disclosures, content approval policy, embargo, quota, correct destination.
11. **Post-publish:** platform ID, processing state, privacy status, video available, duplicate detection, analytics collection.

**Repair Planner** maps error to minimum invalidated stages: wrong hook → script/start shots; wrong single TTS line → that line plus dependent subtitles/timing; incorrect subtitle → align/caption only; wrong aspect → reframing/encode; audio mix → mix pass; corrupted MP4 → encode only; missing permission → hold for rights (NEVER fake a workaround). Record bounded retries, hashes and undoable version history. When retry budget exhausted, notify via exception inbox and continue unrelated jobs.

Split QA into **technical**, **editorial**, **facts**, **rights**, **platform eligibility**, and **human/policy approval**. Technical PASS must not imply permission or editorial excellence. Keep a curated small evaluation set of Vietnamese and English sample content with human-rated expected findings and measure false approvals/rejections after model upgrades.

---

# 8. CREATIVE PRODUCTION, TRANSCIPT EDITING, MEDIA TIMELINE

Store every stage artifact with IDs, source hashes, model settings and revision ancestry. Implement:
- Scene detection, highlight candidate selection, face/subject-aware cropping when validated.
- Original script → timed narration segments → structured shot list → media match/AI illustrations → track-based timeline → preview proxy → final render.
- **Transcript editor**: words/phrases tied to timestamps and clip references. Delete segment or rewrite TTS line and ripple dependencies; editing original recorded speech cannot magically synthesize the speaker's unrecorded words.
- **Prompt editing**: `cut 5–8 seconds`, `zoom into boss 12–15 seconds`, `make intro more suspenseful`, `change narration to US English`, `add 3 seconds to product comparison`, `change music under dialogue`, `replace footage where license expired`. Convert to typed edit operations, show change summary when high impact, execute only affected stages, generate new version.
- Separate video, overlay, titles, subtitles, narration, music, SFX tracks; native/resampled resolution labeled accurately.
- Export 9:16, 16:9 and other aspect presets, MP4 H.264 default; subtitles `.srt`/`.ass`, thumbnail, metadata, rights/source manifest, preview and platform-specific package.
- Product and game branding via stable logos/fonts/palette; accurate Vietnamese fonts drawn after rendering, not AI-generated text.
- Source-aware content deduplication by semantic script + footage fingerprint + visual similarity; maintain an episodic content memory.
- For a single provided static image, simple professional Ken Burns/2.5D parallax/text/shape animation is possible without a generative video model; only promise physically complex image animation when a validated suitable engine exists.

---

# 9. ACCOUNTS, RIGHTS, SOURCE DISCOVERY AND PUBLISHING

Build source adapters for user-authorized sites and connected APIs. Collect only information accessible under applicable terms. Do not automate CAPTCHA bypass, evasion, DRM circumvention, fake engagement, account farming or unauthorized downloading. Treat rights for translate, cut, dub and redistribute as separate permissions, ideally source-specific and platform-specific. Source channel watcher states: `AUTHORIZED_REUSE`, `DISCOVERY_ONLY`, `PERMISSION_PENDING`, `BLOCKED`.

Platform adapters: YouTube, Facebook/Instagram (Meta), TikTok, authorized manual export. Inspect actual current scopes and app-review/audit limitations when implementing. Maintain capability matrix **per account** (connected / permission verified / allowed format / publish eligible / manual-only / blocked), not a global claim of platform support.

Publishing workflow: freeze approved output version and policy snapshot → recheck rights, factual claims, source expiry, disclosure, embargo, destination, token/quota → create idempotent upload/publish record → upload → persist external ID → reconcile processing/privacy/publication status → notify with link. On network failure reconcile **before retry** to avoid duplicates. Manual export fallback is explicit; never fake auto-publish.

Support ad/affiliate disclosures and synthetic-content disclosures where platforms require them. Do not infer advertising performance or revenue from views alone. Product pricing and sales claims need timestamped source.

Telegram: authenticated chat/user allowlist, long-polling when appropriate, event outbox, notifications, short previews, `/status`, `/queue`, `/pause`, `/resume`, `/retry`, `/approve`, `/reject`, `/publish_status`, daily report, urgent errors. High-risk actions require explicit confirmation. No spamming users for every low-level job update.

---

# 10. ANALYTICS, AUTOPILOT LEARNING AND GAME CONVERSION

Track true per-platform video/channel metrics, keeping unsupported/missing data as `unknown`, not zero. Link content identity, version, caption/thumbnail variant, posted URL, source rights, audience, schedule and campaign.

For game marketing track Steam UTM when supported/authorized, store visits, wishlists and other accessible legitimate attribution from Steamworks or connected reporting. Differentiate impressions, clicks, visits, wishlists, purchases. Store/app installs need their own authorized data sources; no inference from clicks alone.

Content learning should recommend schedule, language, subject, hook style, thumbnail and pacing only with sufficient data. A/B tests must identify which variable differs. Track sample size, observation window, limits and confounders. Never guarantee virality or optimize unsafe repeated content. Respect policy rate limits and avoid mass posting just because automation can.

Build campaign lifecycle: awareness → interest → consideration → conversion → community/retention; update creative goals from actual project release state/embargo. Self-scheduling operates within owner-approved goals and availability.

---

# 11. RESOURCE COORDINATION WITH OTHER LOCAL AI APPLICATIONS

Windows machine has RTX 5070 Ti ~16GB VRAM and ~62GB available RAM. Multiple apps, including Asset Forge, may run locally. Implement a **cross-process GPU lease** backed by reliable inter-process locking, heartbeat, owner ID, lease timeout and cleanup. Never corrupt/modify Asset Forge's AI environment/model weights or assume both applications can fit heavy models simultaneously.

Default one heavy AI GPU inference at a time. Load/unload checkpoints between stages, overlap CPU/FFmpeg work where safe, cache model sessions based on memory availability, preflight RAM/disk/driver and cooldown before retries. Monitor nvidia-smi and real peak VRAM, process exit codes, temperatures where accessible. Preserve quality preset; if too large, ask for a new preset or continue later rather than silently downgrade.

Durable queue: prepare → run → checkpoint → validate → stage-complete. Pause at safe boundaries; Resume after Windows/app restart; cancelling doesn't delete completed artifacts. Circuit breaker for repeated environment errors, model-specific engine health, retry budget, job TTL, warnings and daily operation logs. No per-job fake progress or unsupported exact ETA.

---

# 12. DATA / SECURITY / PACKAGING

Keep existing JSON/JSONL source of truth + atomic write, lock, fsync/rename, backup, checksums, append-only audit and schema migrations. Use sidecar/isolated engines rather than giant monolithic Python installs. Save source, consent, role, file hashes, original prompt, effective spec, generated script, footage version, voice checkpoint, output and publish identifiers. Secrets stored through Windows DPAPI or existing secure adapter; never embed keys or tokens in plaintext logs.

Windows packaging requires correct Next.js server/Node worker lifecycle, Python engine discovery and process cleanup. Desktop UI must work in installed EXE, not merely dev localhost. Tray options: close window vs keep working vs quit, documented status, autostart optional and user-controlled. No secret exposure through webviews or public network bind. Test Windows path spaces, Unicode names and interrupted processes.

---

# 13. PRIORITIZED DELIVERY — REAL VERTICAL SLICES

**P0 Reliability + One End-to-End Factory**
- Audit and baseline; Windows package/lifecycle, source/rights model, durable queue, local LLM/TTS/ASR available.
- Complete 7-step Autopilot wizard plus Production stepper.
- Produce a **real game marketing clip from actual gameplay screenshots/video** with real Vietnamese voice, captions, thumbnail, MP4, QA and Library; edit one segment with a prompt; publish to a connected authorized test channel where permission exists, otherwise export honest manual package.
- Run real engine/GPU failure and resume tests.

**P1 Language + Multiple Content Families**
- Verify English voice via Kokoro and/or Chatterbox; make both Vietnamese and English selectable in Create, Autopilot and Editor.
- Knowledge/facts and legitimate product research-to-video end-to-end.
- Transcript editing, source matching, content memory, targeted QA repair.
- Authorized Chinese source watcher (with rights gate), Mandarin transcription → Vietnamese/English localization, background recurring discovery.

**P2 Autonomy, Governance, Scheduling and Analytics**
- Cross-project campaigns, automatic calendar slots, publishing reconciliation, platform eligibility, Telegram review by exception, analytics and game attribution.
- Advanced audience segmentation, A/B, retention insights and learning with controls/rollback.
- Optional local AI video/music only after genuine stability/quality/license benchmark.

Each phase must deliver a useful working slice with visible evidence, not only a roadmap. Do not inflate feature completion for tools absent in the environment.

---

# 14. MANDATORY ACCEPTANCE SCENARIOS

1. Windows app installed and launched: web UI, worker, model subprocess lifecycle and loopback security function without manual terminal commands.
2. Create an Autopilot using 7 distinct clear steps; step state persists, defaults reduce user input, stepper shows location, skips optional steps.
3. User imports a game's gameplay video, images and logo; app autonomously creates a valid 20–45 second **Vietnamese** video with local TTS, appropriate clips, subtitles, final MP4 and thumbnail.
4. Same sources, new content version in **English** with actual local English TTS (Kokoro or Chatterbox), English captions and independent script/localization.
5. Voice model tested on actual Windows GPU/CPU; report voice name/checkpoint, synthesized samples, duration, intelligibility and pronunciation checks.
6. Edit published-draft clip using prompt `Cut 00:05–00:08` with timeline duration changed, no AI video rerun and old version preserved.
7. Rewrite one Vietnamese sentence and re-narrate that segment; synchronize dependent subtitles/shot timing; leave unrelated shots untouched.
8. Generate a knowledge video with independently verifiable cited claims; unverified claim blocks safe publication.
9. Product video labels claims as sourced information (not firsthand testing), date-checks price and includes applicable affiliate disclosure.
10. Source watcher observes an **authorized** creator feed, avoids duplicates, receives eligible video, translates Mandarin to Vietnamese AND independently to English, dubs and stores rights provenance; a channel without redistribution rights never auto-reposts.
11. Schedule multiple channels with quotas/timezone/embargo; if no quality-safe clip available, no fake filler post.
12. Auto-publish only with channel-specific stored authorization and an eligible content policy; a missing permission produces a draft/manual export and explicit status.
13. Network interrupted during upload: reconcile external ID before retry, no duplicate post.
14. Crash/restart in mid-production: resume from valid checkpoints; no loss of completed TTS/footage/video segments.
15. Exhausted GPU VRAM or corrupted checkpoint triggers engine failure classification/circuit breaker without marking hundreds of jobs failed.
16. Two local apps contend for GPU lease: only one heavy workload executes; no deadlock after process crash.
17. Technical QA can pass while editorial/rights gate fails, and publication is properly blocked.
18. Telegram authenticated user can view a preview, job status and approve an eligible version; unknown user cannot execute commands.
19. Analytics missing fields display unknown; publication metrics tied to actual remote video ID; no invented revenue/wishlists.
20. All tracked outputs retain immutable parent version, provenance, settings and copyable paths.
21. Test app UX in Vietnamese and English, including onboarding, error labels, wizard navigation and subtitles.
22. Document real command output, screenshots, failure logs and genuine media file paths for every VERIFIED test.

**Statuses:** `VERIFIED`, `IMPLEMENTED_UNVERIFIED`, `BLOCKED`, `NOT_IMPLEMENTED`. No simulated successes. Include a measured benchmark matrix and a clear distinction between planned and working.

---

# 15. FINAL OWNER HANDOFF

Report in Vietnamese:
- What actually works in the existing repo after changes, grouped by UI wizard, local AI/voices, content family, editor/QA, publishers, Telegram and analytics.
- Real verified model versions and languages, speed/VRAM/disk tests.
- How to set up one fully automated game, one facts channel, one product campaign and one authorized translation source **through UI alone**.
- Local folders, backups, credentials setup via UI, activation/pause/disable actions, exception review and publication scope.
- Exact results of real Windows EXE smoke test and sample output files.
- Remaining blockers, platform account/API permissions, licensing unknowns and unsupported requests.

**FINAL EXECUTION DIRECTIVE:** Implement incrementally in the existing repo. Maximize automation while making every step *visible and individually editable*. Do not collapse all features into a single page. Support actual high-quality Vietnamese **and** English narration using locally verified voices. Never require paid AI APIs, and never bypass rights/terms to republish third-party footage. The intended user journey is:

**Set Up Once (clear stepper) → Discover → Plan → Create → Narrate in VI/EN → Edit → QA & Repair → Schedule → Publish Where Authorized → Verify → Learn → Repeat.**
