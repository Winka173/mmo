# Media catalog, keyframe suggestions and repetition checks

Implemented in the existing Node/TypeScript, Next.js and JSON storage architecture on 23 October 2026. No additional inference provider, database or paid service is required.

## Source descriptions through UI

`MediaCatalog` previews images and videos, displays available original import names, retains local edit drafts, and edits a friendly name, description and up to eight timed source intervals. The API validates timed intervals against actual FFprobe duration. Video playback supports HTTP ranges through the existing authenticated local web boundary.

Saving creates a SHA-keyed immutable annotation revision and an atomic head pointer under `studio/media-catalog`. Concurrent stale edits, modified source bytes, foreign source paths and corrupt metadata hashes are rejected. The original media and source-folder `acs-media.json` are never rewritten. A downloadable manifest is generated from accepted descriptions.

Fresh shot matching consumes accepted app descriptions by source SHA. Existing runs keep their original immutable `source-matching-input.json`; later catalog changes affect only future matching. Owner descriptions remain separate from factual claims, licensing and publication approval.

## Local keyframe suggestions

`STUDIO_MEDIA_VISION` is a durable job with frozen configuration, source identity, bounded keyframe positions and queue resource keys. The worker extracts requested real frames, calls the existing managed local multimodal Qwen runtime, validates structured output, and records frame/source hashes and actual model execution metadata. Paused or occupied GPU resources return the task to queued state; malformed responses and changed sources fail explicitly.

The UI shows extracted frames and unreviewed descriptions. The owner can copy a suggestion into an editable draft and explicitly save it; the model cannot overwrite accepted annotations. Loading/debug/black-frame labels are uncertain suggestions. This is not a separate OCR implementation or whole-video action recognition.

**Actual measured evidence:** [acs-media-vision.json](evidence/acs-media-vision.json). Qwen3.5:9b Q4_K_M ran on CUDA, digest `56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90`; reported GPU residency 5,862,210,928 bytes; 7.666 seconds model call / 13.122 seconds executor wall time. The owned geometric fixture contained a blue circle and orange rectangle. The model described the rectangle as a square, so `fixtureMatch` is **false** and visual validation is **FLAGGED_FIXTURE_SHAPE_MISMATCH_REVIEW_REQUIRED**. This proves real inference and evidence capture, not general visual quality. No description was automatically accepted. Owner gameplay and listening review remain unavailable.

## Repetition evidence and grounded suggestions

`ContentInsights` compares a selected version with up to 100 independent completed productions, excluding revisions of its own lineage. It reports normalized script matches, lexical phrase overlap, hook token overlap, shared exact source hashes and overlapping selected video intervals. Overlapping intervals are merged to avoid double-counting repeated shots. Suggested changes link to actual prior run IDs; the app does not block legitimate logo reuse or certify originality.

Performance suggestions require matching actual publication/remote/channel/run identities, public visibility, compatible content family/format/language, at least seven days between public metric observations, and a latest metric snapshot no more than three days old. Missing data remain excluded. Only a channel with at least five observations in each hook-length group receives a proposed single-variable experiment. Medians and sample IDs remain inspectable; associations are explicitly descriptive and never change policy automatically. No live account was connected for this work; metric rule tests use labeled controlled fixtures.

## Verification

19 selected tests pass across four files, with root TypeScript passing:

- `packages/automation/test/studio-media-catalog.test.ts` — immutable metadata, optimistic concurrency, tampering, source containment and request deduplication.
- `packages/automation/test/studio-content-insights.test.ts` — script/source evidence, interval union, lineage exclusion and conservative metric qualification.
- `apps/worker/test/studio-matching.test.ts` — source matching plus fresh catalog consumption and unchanged retry inputs.
- `apps/worker/test/studio-media-vision.test.ts` — validated output, replay behavior, malformed model responses, GPU contention and changes during inference. Model responses in these contract tests are explicitly test doubles.

Raw test report: `.local/acs-media-intelligence-tests.json`; durable summary: [acs-media-intelligence-tests.json](evidence/acs-media-intelligence-tests.json). Browser and packaged-app acceptance belong to the combined release checks; these unit and inference results alone do not establish Windows release acceptance.

## Limits retained in UI

Lexical checks can miss translated or paraphrased duplication. Different re-encodes are not recognized as the same footage when their exact source hashes differ. Visual suggestions can be wrong, as the real fixture demonstrates. The app does not infer permissions, product tests, causal performance, revenue or game features from model descriptions or view counts.
