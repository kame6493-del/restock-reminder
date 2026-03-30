import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/shopify.js';

const router = Router();

// Verify Shopify webhook HMAC
function verifyWebhook(req) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac) return false;

  const body = req.body; // raw Buffer from express.raw()
  const generated = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(body)
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(generated));
}

// POST /webhooks/orders-create
router.post('/orders-create', async (req, res) => {
  if (!verifyWebhook(req)) {
    return res.status(401).send('Invalid HMAC');
  }

  res.status(200).send('OK'); // Respond quickly

  try {
    const order = JSON.parse(req.body.toString());
    const shopDomain = req.headers['x-shopify-shop-domain'];

    const shop = await prisma.shop.findUnique({
      where: { domain: shopDomain },
      include: { products: true },
    });

    if (!shop || !shop.emailEnabled) return;

    const customerEmail = order.email || order.customer?.email;
    const customerId = order.customer?.id?.toString() || '';

    if (!customerEmail) return;

    // Process each line item
    for (const item of order.line_items || []) {
      const productId = item.product_id?.toString();
      if (!productId) continue;

      // Find product reminder settings
      const productReminder = shop.products.find(p => p.productId === productId);
      const interval = productReminder?.enabled !== false
        ? (productReminder?.interval || shop.defaultInterval)
        : null;

      if (!interval) continue;

      // Calculate reminder date
      const purchasedAt = new Date(order.created_at);
      const reminderDue = new Date(purchasedAt);
      reminderDue.setDate(reminderDue.getDate() + interval);

      // Save order record
      await prisma.orderRecord.upsert({
        where: {
          shopId_orderId_productId: {
            shopId: shop.id,
            orderId: order.id.toString(),
            productId,
          },
        },
        create: {
          shopId: shop.id,
          orderId: order.id.toString(),
          customerId,
          email: customerEmail,
          productId,
          productTitle: item.title || item.name || 'Product',
          purchasedAt,
          reminderDue,
        },
        update: {
          reminderDue,
        },
      });
    }

    console.log(`Processed order ${order.id} for ${shopDomain}`);
  } catch (err) {
    console.error('Error processing order webhook:', err);
  }
});

// POST /webhooks/app-uninstalled
router.post('/app-uninstalled', async (req, res) => {
  if (!verifyWebhook(req)) {
    return res.status(401).send('Invalid HMAC');
  }

  res.status(200).send('OK');

  try {
    const shopDomain = req.headers['x-shopify-shop-domain'];

    await prisma.shop.update({
      where: { domain: shopDomain },
      data: {
        uninstalledAt: new Date(),
        accessToken: '', // Clear token
      },
    });

    console.log(`App uninstalled from ${shopDomain}`);
  } catch (err) {
    console.error('Error processing uninstall webhook:', err);
  }
});

export default router;
