# xdipx Review System

Customer review management system built into xdipx.com.

## Required Environment Variables

```env
# Review system secrets
REVIEWS_INVITE_SECRET=<random 32-byte hex>      # Used to sign invite tokens
REVIEWS_SPAM_THRESHOLD=0.75                      # Default AI spam threshold (0-1)
REVIEWS_AUTO_APPROVE=false                       # Auto-approve non-spam reviews
REVIEWS_MEDIA_MAX_MB=10                          # Max media file size per upload
REVIEWS_MEDIA_MAX_FILES=5                        # Max number of media files per review

# Media uploads (optional — skipped gracefully if not set)
VERCEL_BLOB_TOKEN=<from Vercel dashboard>        # Get from vercel.com/account/tokens
```

## Database Migration

Run the migration against your Neon database:

```bash
psql $DATABASE_URL < db/migrations/004_reviews.sql
```

Or use the Drizzle migration runner if configured for raw SQL migrations.

## Features

### Customer-facing
- `/review?token=X` — Review submission via invite link
- `/review?productId=X` — Open review submission
- Reviews display on `/products/:slug` (rating summary + paginated list)
- Helpful votes on individual reviews
- Seller replies visible on product pages

### Admin
- `/admin/reviews` — KPI dashboard (pending count, avg rating, charts)
- `/admin/reviews/queue` — Full moderation queue with bulk actions
- `/admin/reviews/products` — Reviews grouped by product
- `/admin/reviews/invites` — Invite management + funnel stats
- `/admin/reviews/settings` — Configuration panel
- `/admin/reviews/export` — CSV/JSON export

### Automation
- AI analysis on every review (sentiment, spam score, suggested status)
- Auto-approve and auto-spam based on configurable thresholds
- Review invite sent automatically on order fulfillment (via webhook)
- Reminder emails via `/cron/review-reminders` (add to Vercel Cron at 9am)

## Shopify Webhook Setup

Register the `orders/fulfilled` webhook in Shopify Admin:
```
URL: https://xdipx.com/webhooks/order-fulfilled
Topic: orders/fulfilled
Format: JSON
```

## Vercel Cron Configuration

Add to `vercel.json`:
```json
{
  "crons": [
    { "path": "/cron/review-reminders", "schedule": "0 9 * * *" }
  ]
}
```

## Media Uploads

Media uploads require `@vercel/blob` (not currently in `package.json`). Install when ready:
```bash
npm install @vercel/blob
```

Until then, media file fields are accepted but not stored. Implement the upload in `app/routes/api.reviews.tsx` where the TODO comment is located.

## Klaviyo Flows

Four events are tracked — set up corresponding flows in Klaviyo:

| Event | Trigger |
|---|---|
| `Review Submitted` | Customer submits a review |
| `Review Approved` | Admin approves a review |
| `Review Invite Sent` | Invite email sent after order fulfillment |
| `Review Reminder Sent` | Reminder email sent to non-responders |
