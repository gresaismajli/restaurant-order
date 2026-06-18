# Restaurant Orders

A restaurant ordering app with waiter order-taking, kitchen status control, payment closing, daily reporting, role-based login, menu administration, staff management, and audit history.

The app now stores data in Postgres, not JSON files. The backend is split so it can run locally with `server.js` and on Vercel through `api/index.js`.

## Requirements

- Node.js 18+
- A Postgres database
- `DATABASE_URL` environment variable

## Run Locally

```bash
npm install
set DATABASE_URL=postgres://user:password@host:5432/database
npm start
```

Open:

```text
http://localhost:3000
```

On PowerShell you can set the variable with:

```powershell
$env:DATABASE_URL="postgres://user:password@host:5432/database"
npm start
```

## Vercel Deploy

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add a Postgres database, for example Vercel Postgres, Neon, Supabase, or Railway.
4. Set `DATABASE_URL` in Vercel project environment variables.
5. Deploy.

The first request will create the database tables and seed the default users/products.

## Migrate Existing JSON Data

If you already have data in `data/store.json`, set `DATABASE_URL` and run:

```bash
npm run migrate:json
```

You can also pass a custom JSON file:

```bash
node scripts/migrate-json-to-postgres.js ./data/store.json
```

## Default Users

Change these immediately before real use.

| Role | Username | Password |
| --- | --- | --- |
| Admin/manager | `admin` | `admin123` |
| Kitchen | `kitchen` | `kitchen123` |
| Bartender | `bartender` | `bar123` |
| Pizzaman | `pizzaman` | `pizza123` |

## Main Workflows

- Waiter creates a table order and sends it to the correct preparation stations.
- Products are assigned to fixed menu categories. Pizza routes to the pizzaman dashboard, drinks and coctails route to the bartender dashboard, and all other food categories route to the kitchen dashboard.
- Kitchen, bartender, and pizzaman each confirm, prepare, and mark their assigned items done.
- Waiter closes done orders as paid with payment method, discount, and tip.
- Admin views daily reports, voids, payment-method totals, and waiter totals.
- Admin manages products in the Menu tab.
- Admin creates, edits, activates, and removes waiters in the Staff tab.
- Important actions are stored in the audit log.

## Environment Variables

```bash
DATABASE_URL=postgres://user:password@host:5432/database
DATABASE_URL_UNPOOLED=postgres://user:password@host:5432/database
POSTGRES_URL=postgres://user:password@host:5432/database
POSTGRES_URL_NON_POOLING=postgres://user:password@host:5432/database
POSTGRES_PRISMA_URL=postgres://user:password@host:5432/database
PGSSL=true
PORT=3000
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

The app accepts `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, or `POSTGRES_URL_NO_SSL`. Prefer the pooled `DATABASE_URL`/`POSTGRES_URL` on Vercel. Set `PGSSL=false` only for local Postgres instances that do not use SSL.

`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are required for background push notifications. Set them in Vercel environment variables, not in committed files.
