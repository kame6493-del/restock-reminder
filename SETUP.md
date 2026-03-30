# ReStock Reminder - Setup Guide

## Prerequisites
- Node.js 18+
- Shopify Partners account (https://partners.shopify.com)
- ngrok (for local development)

## Step 1: Create Shopify App in Partners Dashboard

1. Go to https://partners.shopify.com
2. Apps > Create App > Create app manually
3. Set:
   - App name: `ReStock Reminder`
   - App URL: `https://your-ngrok.ngrok-free.app`
   - Allowed redirection URL(s): `https://your-ngrok.ngrok-free.app/auth/callback`
4. Copy API key and API secret key

## Step 2: Configure Environment

```bash
cd restock-reminder
cp .env.example .env
```

Edit `.env`:
```
SHOPIFY_API_KEY=your_api_key_from_step_1
SHOPIFY_API_SECRET=your_api_secret_from_step_1
SHOPIFY_SCOPES=read_products,read_orders,read_customers,write_customers
HOST=https://your-ngrok.ngrok-free.app
PORT=3000
DATABASE_URL="file:./dev.db"
```

## Step 3: Install Dependencies & Setup Database

```bash
npm install
npx prisma generate
npx prisma db push
```

## Step 4: Start ngrok

```bash
ngrok http 3000
```

Copy the https URL and update:
- `.env` HOST
- Partners Dashboard App URL & redirect URL

## Step 5: Start the App

```bash
# Terminal 1: Start web server
npm run dev

# Terminal 2: Start reminder worker (sends emails)
npm run worker
```

## Step 6: Install on Development Store

1. In Partners Dashboard, select your app
2. Click "Select store" and install on a development store
3. The OAuth flow will handle authentication automatically

## Step 7: Test

1. Open the app in your Shopify admin
2. Go to Products tab - your store's products should appear
3. Set reorder intervals for each product
4. Create a test order in your development store
5. The webhook will create a reminder record
6. The worker will send the reminder when the due date arrives

## Email Setup (Production)

For production, use SendGrid, Mailgun, or Amazon SES:

### SendGrid
1. Create account at https://sendgrid.com
2. Create API key
3. Set in `.env`:
```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your_sendgrid_api_key
EMAIL_FROM=noreply@yourdomain.com
```

## Deployment

### Recommended: Railway.app
1. Push to GitHub
2. Connect Railway to your repo
3. Set environment variables
4. Railway provides automatic SSL and hosting

### Alternative: Render.com, Fly.io, Heroku

For production, switch DATABASE_URL to PostgreSQL:
```
DATABASE_URL="postgresql://user:password@host:5432/restock_reminder"
```

Update `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

## App Store Submission

1. Partners Dashboard > Apps > Your App > Distribution
2. Choose "Shopify App Store"
3. Fill in listing details (see STORE_LISTING.md)
4. Submit for review
