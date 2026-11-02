# P0: grounded media selection

The worker matches narration against owner-supplied source descriptions using the already isolated local Qwen3-Embedding engine. It records exact source hashes, descriptions, scores, runtime fingerprint and assignments in `source-matching.json`. Text similarity does not certify source pixels, a game feature, facts, rights or publication approval. The selected scenes still require review.

Place an optional `acs-media.json` in the input media folder:

```json
{
  "version": 1,
  "assets": [
    {
      "file": "battle.mp4",
      "sha256": "the exact 64-character lowercase SHA-256 of the input file",
      "description": "Owner description of the footage, not an AI-generated assumption",
      "segments": [
        {
          "startSec": 12,
          "endSec": 18,
          "description": "Owner-confirmed description of this particular scene"
        }
      ]
    }
  ]
}
```

The example SHA string must be replaced with a real hash. Each source has at most eight scene annotations, at most forty sources. Timed annotations require video, finite ordered bounds and actual FFprobe duration validation. Known black/frozen intervals are excluded when measured footage analysis is available. The basename is a label: descriptions bind to exact pinned content SHA, never an arbitrary external path. Stale, duplicate, oversized or redirected metadata is rejected. Original annotations are copied once into `source-matching-input.json` with an identity hash; retry does not reinterpret edited source-folder metadata.

When no embedding runtime is configured, the report explicitly identifies lexical description matching. If there are no descriptions, the result remains unknown and uses balanced source selection; it does not call filename order semantic understanding. A configured embedding failure propagates to the existing engine health/retry policy instead of silently switching models. Repeated content hashes are deduplicated. Selection penalizes repeated intervals and avoids three consecutive assignments from the same source, or the same scene when other sources/scenes exist. Reuse is recorded when alternatives are exhausted. Scores are ranking signals, not calibrated confidence.

Integration owned by the main worker: import `matchStudioShots` from `./studio-matching.js`, then call it after sources and script exist, before storyboard/media stages. Preserve explicit continuing plans and edit versions. Save the run after matching, and include both report files in derivative provenance copies. Declare the optional embedding engine/GPU resource in new production queue jobs. No annotation or report confers posting authorization.

Verification on 23 October 2026:

- `apps/worker/test/studio-matching.test.ts`: source SHA pinning, stale/unsafe metadata rejection, immutable annotation retry, deterministic fallback, controlled embedding identities and repetition/exclusion constraints. Embedding responses in these unit tests are explicitly labelled test doubles.
- `scripts/media-matching-benchmark.ts`: actual local CPU Qwen embeddings, three paraphrased narratives matched to three supplied descriptions, **3/3 expected matches**, **22.429 seconds** including repeat-cache validation. Full runtime/checkpoint/source identity is in [evidence](evidence/acs-media-matching.json). Inputs are owner-generated solid-color cards with artificial labels; this measures text matching and provenance only. It supplies no real gameplay or visual-semantic acceptance.

Remaining scope: automatically obtaining trustworthy visual/ASR/OCR scene descriptions, a human-rated genuine-game evaluation set, visual meaning validation and owner approval. No source annotations, credentials or authority were invented for the owner's projects.
