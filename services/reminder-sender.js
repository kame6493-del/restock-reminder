import { prisma, PLANS } from '../lib/shopify.js';
import nodemailer from 'nodemailer';

// Create email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Process all due reminders across all shops
 */
export async function processDueReminders() {
  const now = new Date();

  console.log(`[${now.toISOString()}] Processing due reminders...`);

  // Find all due, unsent reminders
  const dueOrders = await prisma.orderRecord.findMany({
    where: {
      reminded: false,
      reminderDue: { lte: now },
    },
    include: {
      shop: true,
    },
    take: 500, // Process in batches
  });

  console.log(`Found ${dueOrders.length} due reminders`);

  // Group by shop for rate limit tracking
  const byShop = new Map();
  for (const order of dueOrders) {
    if (!byShop.has(order.shopId)) {
      byShop.set(order.shopId, []);
    }
    byShop.get(order.shopId).push(order);
  }

  let sent = 0;
  let skipped = 0;

  for (const [shopId, orders] of byShop) {
    const shop = orders[0].shop;

    // Skip if email disabled or uninstalled
    if (!shop.emailEnabled || shop.uninstalledAt) {
      skipped += orders.length;
      continue;
    }

    // Check monthly limit
    const plan = PLANS[shop.plan] || PLANS.free;
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthCount = await prisma.reminder.count({
      where: { shopId, sentAt: { gte: firstOfMonth } },
    });

    let remaining = plan.remindersPerMonth === Infinity
      ? Infinity
      : plan.remindersPerMonth - monthCount;

    for (const order of orders) {
      if (remaining <= 0) {
        skipped++;
        continue;
      }

      try {
        await sendReminderEmail(shop, order);

        // Log reminder
        await prisma.reminder.create({
          data: {
            shopId,
            email: order.email,
            productId: order.productId,
            productTitle: order.productTitle,
          },
        });

        // Mark as reminded
        await prisma.orderRecord.update({
          where: { id: order.id },
          data: { reminded: true },
        });

        sent++;
        remaining--;
      } catch (err) {
        console.error(`Failed to send reminder for order ${order.orderId}:`, err);
      }
    }
  }

  console.log(`Reminders sent: ${sent}, skipped: ${skipped}`);
  return { sent, skipped };
}

/**
 * Send a single reminder email
 */
async function sendReminderEmail(shop, order) {
  const daysSince = Math.round(
    (Date.now() - new Date(order.purchasedAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  const productUrl = `https://${shop.domain}/products`;

  // Build email from template
  const subject = (shop.emailSubject || 'Time to reorder {product}?')
    .replace('{product}', order.productTitle)
    .replace('{product_title}', order.productTitle);

  const bodyTemplate = shop.emailBody || getDefaultEmailBody();
  const body = bodyTemplate
    .replace(/{customer_name}/g, order.email.split('@')[0])
    .replace(/{product_title}/g, order.productTitle)
    .replace(/{product}/g, order.productTitle)
    .replace(/{days}/g, daysSince.toString())
    .replace(/{product_url}/g, productUrl)
    .replace(/{shop_name}/g, shop.name || shop.domain);

  // Build HTML email
  const html = buildEmailHtml(shop, order.productTitle, body, productUrl);

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || shop.name}" <${process.env.EMAIL_FROM}>`,
    to: order.email,
    subject,
    text: body,
    html,
  });
}

function buildEmailHtml(shop, productTitle, textBody, productUrl) {
  const paragraphs = textBody.split('\n\n').map(p =>
    `<p style="margin: 0 0 16px; color: #374151; font-size: 16px; line-height: 1.6;">${p.replace(/\n/g, '<br>')}</p>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 12px; padding: 40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h2 style="margin: 0 0 24px; font-size: 22px; color: #111827;">Time to restock?</h2>
      ${paragraphs}
      <a href="${productUrl}" style="display: inline-block; padding: 14px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin-top: 8px;">Reorder ${productTitle}</a>
    </div>
    <p style="text-align: center; margin-top: 24px; font-size: 12px; color: #9ca3af;">
      Sent by ${shop.name || shop.domain} via ReStock Reminder
    </p>
  </div>
</body>
</html>`;
}

function getDefaultEmailBody() {
  return `Hi {customer_name},

It's been {days} days since you purchased {product_title}. Running low?

Reorder now and keep your supply stocked:
{product_url}

Thanks for being a loyal customer!

{shop_name}`;
}
