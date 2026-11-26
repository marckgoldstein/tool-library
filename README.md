# Tool Library

Repository for the distributed co-operative tool library website.

An invite-only, trust-based web app for lending tools and gear within a group: list items, request dates, owner approves, hand off, return, owner confirms. No money changes hands. This repo is the v0.1 friends-and-family pilot.

- **Requirements:** PRD v1.0 (signed off Nov 25, 2026) — stories S1–S24, decisions D1–D36.
- **Status:** M1 Foundation scaffolded. Hosting (T1) deliberately not chosen yet; email and photo storage run on local stand-ins.

## Stack

| Part | Choice | Decision |
| --- | --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript | D25 |
| Database | PostgreSQL 16 via Drizzle ORM; SQL migrations in `drizzle/` | D36 (replaces Prisma in D25) |
| Sign-in | Auth.js v5 email magic link, database sessions, invite-only | D27, D7 |
| Email | `dev` transport writes to `email_log` and `/dev/mailbox`; Resend later | T5 |
| Photos | `local` driver under `.data/uploads`, resized and EXIF-stripped with sharp; Cloudflare R2 later | D32 |
| Tests | Vitest (rules and services against real Postgres), Playwright (desktop and mobile) | D35 |

## Run it locally

Requires Node 22+ and PostgreSQL 16.

```bash
cp .env.example .env            # then set AUTH_SECRET (openssl rand -base64 32)
createuser -P toollib           # password: toollib (or change DATABASE_URL)
createdb -O toollib toollib_dev
createdb -O toollib toollib_test
npm install
npm run db:migrate
npm run db:seed                 # pilot group, admin, members, categories, sample loans
npm run dev
```

Sign in as `olivia@example.test`, `ben@example.test`, `oscar@example.test`, or `admin@example.test`. No email is sent in development: open **http://localhost:3000/dev/mailbox** and click the link.

## Test

```bash
npm test          # unit and service tests (uses toollib_test, resets it)
npm run test:e2e  # browser tests: builds, starts on :3100, seeds toollib_test
npm run lint && npm run typecheck
```

CI runs all of these on every push and pull request (`.github/workflows/ci.yml`).

## Layout

```
src/
  app/                 pages and route handlers (sign-in, loan view, notices, dev mailbox)
  auth.ts              Auth.js config: magic link, invite-only, rate limit
  db/                  schema.ts (all 17 tables), migrate, seed
  content/             canned message tree, categories, excluded items
  server/loans/        rules.ts (pure) and service.ts (the only code that changes loan status)
  server/email/        transport and loan notification emails
  server/storage/      photo processing and storage
drizzle/               SQL migrations (committed)
tests/unit/            Vitest
tests/e2e/             Playwright
```

## What's built (M1 Foundation)

- Full v0.1 schema, migrated and seeded (T3, T10).
- Loan service with every transition, guard and audit event from PRD section 5 (S22), including overlap auto-decline, the contact-share pickup gate, listing lock, not-returned delisting, admin close for removed members (S23), and admin notices that skip a party-admin (R5).
- Magic-link sign-in, invite-only, 15-minute single-use links, 5 links per 15 minutes per address (T4).
- Email logging and local mailbox (T5), photo processing and local storage (T6), canned message catalog (T11).
- Required notices page and footer (T8 draft), read-only loan page with derived overdue state in the viewer's timezone.

Not yet: hosting and production email/storage (T1, T7), invite flows and profiles (M2), listings and search (M3), threads (M4), loan-loop screens (M5).
