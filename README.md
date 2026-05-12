# WFUMC Pastoral Records

Private pastoral directory and ministry record-keeping app for the
pastor at Wedowee First UMC. PWA, React + Vite, deployed to GitHub Pages.

## Phase 1 scope

This is the foundation. It ships with:

- Pastor-only sign-in (UI gate + RLS)
- People directory: list, search, filter by status, add, edit, delete
- Per-person fields: name (first/middle/last/preferred), cell + home phones,
  email, multiple social media profile links, primary address, secondary
  "house in Wedowee but resides elsewhere" address, birthdate, anniversary,
  baptism (yes/no/unknown + date), date joined church, church roles
  (multi), Christmas card list flag, free-form notes, deceased flag
- Bulk CSV import (paste flow) for moving the existing church directory in

## Coming in later phases

- Document & screenshot archive with Claude summarization
- End-of-life workflow: deceased details, obituary, eulogy notes,
  Claude-assisted eulogy synthesis tool
- Direct Plaud API integration (see "Plaud integration" below)

## Plaud integration

**Status (May 2026):** Plaud has a Developer Platform with OAuth + webhook
APIs, but the OAuth API is currently in private beta. The recommended path
is to sign up for the waitlist at
https://www.plaud.ai/pages/developer-platform — when approved, we can build
a proper Supabase Edge Function endpoint that ingests webhook events,
verifies signatures, and matches incoming transcripts to people in the
directory.

**In the meantime:** the app supports two import paths that work today:

1. **Paste flow** (desktop): copy the transcript Plaud's app generates,
   open the person's record, paste into a new transcript.
2. **Web Share Target** (mobile, PWA-installed): tap "share" on Plaud's
   transcript, pick "WFUMC Pastoral Records" from the share sheet, the
   app opens at `/share` with the text pre-filled. Pick a person, save.

After import, "✨ Summarize" and "✂ Trim" buttons let Claude clean up
the transcript, and "✨ Suggest issues" promotes pastoral concerns to
core issues.

## Setup

1. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_ANON_KEY` — same values as the other WFUMC apps,
   since this app shares the existing Supabase project.
2. Run the migration `0046_pastoral_records.sql` (in the WFUMC Bulletin
   App repo's `supabase/migrations/` folder) against your project.
3. `npm install`
4. `npm run dev` — opens at http://localhost:5176
5. Sign in with the pastor account.

## Deploy

GitHub Actions workflow (`.github/workflows/deploy.yml`) deploys to
GitHub Pages on every push to `main`. Set repo secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`VITE_BASE_PATH` is set automatically to `/{repo-name}/`.

## Security model

- **UI gate**: `ProtectedRoute` redirects non-pastor accounts to a
  "Not authorized" screen. Other staff roles never see the app.
- **RLS gate**: every `pastoral_people` row is scoped to its
  `owner_user_id`. Even an `is_staff()` query from another account
  returns no rows. The migration uses `auth.uid() = owner_user_id`
  with **no** `is_staff()` escape hatch.
- **Indexing**: `noindex, nofollow` meta on every page; `robots.txt`
  disallows crawling at the site level.

If a future co-pastor needs their own private directory, they sign in
with their own account and start fresh — they cannot see your records.
