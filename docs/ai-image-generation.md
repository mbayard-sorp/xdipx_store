# AI Image Generation in Sanity Studio

## Overview

Editors can generate AI lifestyle images directly inside Sanity Studio while editing any content block that includes an image field. The "Generate with AI" panel appears below the standard image picker whenever `withImageGenerator` is applied to a schema field.

## How it works

1. The editor types a prompt in the generation panel (pre-populated from the sibling `imagePrompt` field if filled in).
2. The Studio calls `POST /api/generate-image-studio` on the xdipx app, passing the prompt and a shared secret header.
3. The API route authenticates the request and forwards the prompt to `generateImage()`, which tries Atlas Cloud first (primary since 2026-08-15), then fal.ai, then Google Gemini image via Vertex AI, returning up to 4 images as base64 JPEG.
4. The editor picks an image; the Studio uploads it as a Sanity asset and sets it on the document field.

> **Changed 2026-08-10.** This route used to call Gemini image directly with no fallback, so a
> prompt Google refused simply failed, which is why tasteful sexual-wellness briefs so often came
> back blocked. It now goes through the same unified path the homepage team uses.
>
> **Changed 2026-08-15.** Atlas Cloud is now the primary provider in that path (owner
> direction; fal's failure rate on this vertical). fal and Imagen remain as fallbacks. See
> [media-model-routing.md](./media-model-routing.md).

## Environment variables

| Variable | Where used | Notes |
|---|---|---|
| `STUDIO_API_SECRET` | API route — server-side (root `.env`) | Shared secret; never expose publicly |
| `SANITY_STUDIO_API_SECRET` | Studio component — browser (`studio/.env`) | Must match `STUDIO_API_SECRET` |
| `SANITY_STUDIO_APP_URL` | Studio component — browser (`studio/.env`) | URL of the main app; default `http://localhost:3000` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | API route — server-side (root `.env`) | Base64-encoded Google service account JSON |
| `GOOGLE_CLOUD_PROJECT_ID` | API route — server-side (root `.env`) | `xdipx-store-image-gen` |

## Adding the generator to a schema type

```js
import { withImageGenerator } from '../lib/withImageGenerator'

export default {
  name: 'myDocument',
  type: 'document',
  fields: [
    // Spreads two fields: imagePrompt (string) + heroImage (image with AI picker)
    ...withImageGenerator('heroImage'),
    // other fields…
  ],
}
```

`withImageGenerator(imageFieldName)` returns two field definitions:
- `imagePrompt` — a plain string field where editors describe the desired image
- The named image field with `ImageGeneratorInput` attached as its custom input component

## How the imagePrompt field works

The `imagePrompt` string field persists with the document so editors can refine their prompt across sessions. When the generation panel opens, the prompt input is pre-populated from `imagePrompt` automatically. Editors can edit it before generating without overwriting the saved value — the save only happens when they click the document's Publish/Save button.

## Safety settings

The `safetyFilterLevel` and `personGeneration` parameters documented here previously are **not
in effect and cannot be set**: `gemini-2.5-flash-image` does not accept either one, and both are
marked deprecated-and-ignored in `generateMoodImage`. Gemini's image safety filter is a
non-configurable server-side output filter. There is no knob.

What actually governs generation now:

- **fal (primary)** runs open-weight FLUX endpoints with `enable_safety_checker: false`, set in
  [app/lib/fal.server.ts](../app/lib/fal.server.ts).
- **Gemini image (fallback)** applies Google's filter unconditionally. A prompt it refuses
  raises `Image blocked by safety filters`, and `generateImage()` returns an empty result so the
  caller can use an existing catalog photo.

Explicit content generation remains prohibited by Google's Acceptable Use Policy regardless, and
by the voice charter and design doctrine well before that. The reason for the fal-first ordering
is false positives on tasteful sexual-wellness imagery, not a wish to generate anything the
charter would not allow.

## Rotating the service account key

1. Go to [GCP Console → IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) and select `xdipx-store@xdipx-store-image-gen.iam.gserviceaccount.com`
2. Open the **Keys** tab → **Add key → Create new key** (JSON format)
3. Download the new JSON file
4. Base64-encode it: `base64 -i ~/Downloads/new-key.json | tr -d '\n' | pbcopy`
5. Replace `GOOGLE_SERVICE_ACCOUNT_JSON` in root `.env` (and in Vercel environment variables for production)
6. Delete the old key from GCP Console
