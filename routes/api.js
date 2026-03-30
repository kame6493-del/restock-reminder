import { Router } from 'express';
import { prisma, verifyRequest, PLANS } from '../lib/shopify.js';

const router = Router();

// All API routes require authentication
router.use(verifyRequest);

// GET /api/dashboard - Dashboard stats
router.get('/dashboard', async (req, res) => {
  const shop = req.shop;

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalReminders,
      monthReminders,
      pendingReminders,
      recentReminders,
      productCount,
      openedCount,
      clickedCount,
    ] = await Promise.all([
      prisma.reminder.count({ where: { shopId: shop.id } }),
      prisma.reminder.count({
        where: { shopId: shop.id, sentAt: { gte: firstOfMonth } },
      }),
      prisma.orderRecord.count({
        where: { shopId: shop.id, reminded: false, reminderDue: { lte: now } },
      }),
      prisma.reminder.findMany({
        where: { shopId: shop.id },
        orderBy: { sentAt: 'desc' },
        take: 10,
      }),
      prisma.productReminder.count({ where: { shopId: shop.id, enabled: true } }),
      prisma.reminder.count({ where: { shopId: shop.id, opened: true } }),
      prisma.reminder.count({ where: { shopId: shop.id, clicked: true } }),
    ]);

    const plan = PLANS[shop.plan] || PLANS.free;
    const remainingThisMonth = Math.max(0, plan.remindersPerMonth - monthReminders);

    res.json({
      stats: {
        totalReminders,
        monthReminders,
        pendingReminders,
        trackedProducts: productCount,
        openRate: totalReminders > 0 ? ((openedCount / totalReminders) * 100).toFixed(1) : '0',
        clickRate: totalReminders > 0 ? ((clickedCount / totalReminders) * 100).toFixed(1) : '0',
      },
      plan: {
        name: plan.name,
        limit: plan.remindersPerMonth === Infinity ? 'unlimited' : plan.remindersPerMonth,
        used: monthReminders,
        remaining: plan.remindersPerMonth === Infinity ? 'unlimited' : remainingThisMonth,
      },
      recentReminders,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/products - List products with reminder settings
router.get('/products', async (req, res) => {
  const shop = req.shop;

  try {
    // Fetch products from Shopify
    const shopifyProducts = await fetchShopifyProducts(shop);

    // Get local reminder settings
    const reminderSettings = await prisma.productReminder.findMany({
      where: { shopId: shop.id },
    });

    const settingsMap = new Map(reminderSettings.map(s => [s.productId, s]));

    // Merge
    const products = shopifyProducts.map(p => ({
      id: p.id.toString(),
      title: p.title,
      imageUrl: p.image?.src || '',
      interval: settingsMap.get(p.id.toString())?.interval || shop.defaultInterval,
      enabled: settingsMap.get(p.id.toString())?.enabled ?? true,
    }));

    res.json({ products, defaultInterval: shop.defaultInterval });
  } catch (err) {
    console.error('Products error:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// PUT /api/products/:productId - Update product reminder settings
router.put('/products/:productId', async (req, res) => {
  const shop = req.shop;
  const { productId } = req.params;
  const { interval, enabled, title, imageUrl } = req.body;

  try {
    const updated = await prisma.productReminder.upsert({
      where: {
        shopId_productId: { shopId: shop.id, productId },
      },
      create: {
        shopId: shop.id,
        productId,
        title: title || '',
        imageUrl: imageUrl || '',
        interval: interval || shop.defaultInterval,
        enabled: enabled ?? true,
      },
      update: {
        interval: interval || undefined,
        enabled: enabled ?? undefined,
        title: title || undefined,
        imageUrl: imageUrl || undefined,
      },
    });

    res.json({ product: updated });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// GET /api/settings - Get shop settings
router.get('/settings', async (req, res) => {
  const shop = req.shop;
  res.json({
    defaultInterval: shop.defaultInterval,
    emailEnabled: shop.emailEnabled,
    emailSubject: shop.emailSubject,
    emailBody: shop.emailBody || getDefaultEmailBody(),
    plan: shop.plan,
  });
});

// PUT /api/settings - Update shop settings
router.put('/settings', async (req, res) => {
  const shop = req.shop;
  const { defaultInterval, emailEnabled, emailSubject, emailBody } = req.body;

  try {
    const updated = await prisma.shop.update({
      where: { id: shop.id },
      data: {
        defaultInterval: defaultInterval || undefined,
        emailEnabled: emailEnabled ?? undefined,
        emailSubject: emailSubject || undefined,
        emailBody: emailBody || undefined,
      },
    });

    res.json({
      defaultInterval: updated.defaultInterval,
      emailEnabled: updated.emailEnabled,
      emailSubject: updated.emailSubject,
      emailBody: updated.emailBody,
    });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// GET /api/reminders - Reminder history
router.get('/reminders', async (req, res) => {
  const shop = req.shop;
  const page = parseInt(req.query.page || '1');
  const limit = 20;

  try {
    const [reminders, total] = await Promise.all([
      prisma.reminder.findMany({
        where: { shopId: shop.id },
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.reminder.count({ where: { shopId: shop.id } }),
    ]);

    res.json({
      reminders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Reminders error:', err);
    res.status(500).json({ error: 'Failed to load reminders' });
  }
});

// Helper: Fetch products from Shopify API
async function fetchShopifyProducts(shop) {
  try {
    const response = await fetch(
      `https://${shop.domain}/admin/api/2024-10/products.json?limit=250&fields=id,title,image`,
      {
        headers: { 'X-Shopify-Access-Token': shop.accessToken },
      }
    );
    const data = await response.json();
    return data.products || [];
  } catch (err) {
    console.error('Failed to fetch Shopify products:', err);
    return [];
  }
}

function getDefaultEmailBody() {
  return `Hi {customer_name},

It's been {days} days since you purchased {product_title}. Running low?

Reorder now and keep your supply stocked:
{product_url}

Thanks for being a loyal customer!

{shop_name}`;
}

export default router;
