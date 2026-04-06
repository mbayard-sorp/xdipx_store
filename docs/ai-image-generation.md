# AI Image Generation in Sanity Studio

## Overview

Editors can generate AI lifestyle images directly inside Sanity Studio while editing any content block that includes an image field. The "Generate with AI" panel appears below the standard image picker whenever `withImageGenerator` is applied to a schema field.

## How it works

1. The editor types a prompt in the generation panel (pre-populated from the sibling `imagePrompt` field if filled in).
2. The Studio calls `POST /api/generate-image-studio` on the xdipx app, passing the prompt and a shared secret header.
3. The API route authenticates the request and forwards the prompt to Google Imagen via Vertex AI, returning up to 4 images as base64 JPEG.
4. The editor picks an image; the Studio uploads it as a Sanity asset and sets it on the document field.

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

Current Imagen settings in `app/routes/api.generate-image-studio.tsx` → `app/lib/imagen.server.ts`:

- `safetyFilterLevel: 'block_some'` — standard filter; blocks most explicit content
- `personGeneration: 'dont_allow'` — no people or faces are generated

To adjust, edit the `parameters` object in `generateMoodImage` inside [app/lib/imagen.server.ts](../app/lib/imagen.server.ts). Note that explicit content generation is prohibited by Google's Imagen Acceptable Use Policy regardless of safety settings.

## Rotating the service account key

1. Go to [GCP Console → IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) and select `xdipx-store@xdipx-store-image-gen.iam.gserviceaccount.com`
2. Open the **Keys** tab → **Add key → Create new key** (JSON format)
3. Download the new JSON file
4. Base64-encode it: `base64 -i ~/Downloads/new-key.json | tr -d '\n' | pbcopy`
5. Replace `GOOGLE_SERVICE_ACCOUNT_JSON` in root `.env` (and in Vercel environment variables for production)
6. Delete the old key from GCP Console
