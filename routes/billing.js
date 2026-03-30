import { Router } from 'express';
import { prisma, verifyRequest, PLANS } from '../lib/shopify.js';

const router = Router();

// POST /billing/subscribe - Create recurring charge
router.post('/subscribe', verifyRequest, async (req, res) => {
  const shop = req.shop;

  if (shop.plan === 'pro') {
    return res.json({ message: 'Already on Pro plan' });
  }

  try {
    const chargeResponse = await fetch(
      `https://${shop.domain}/admin/api/2024-10/recurring_application_charges.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': shop.accessToken,
        },
        body: JSON.stringify({
          recurring_application_charge: {
            name: 'ReStock Reminder Pro',
            price: PLANS.pro.price,
            return_url: `${process.env.HOST}/billing/confirm?shop=${shop.domain}`,
            trial_days: 7,
            test: process.env.NODE_ENV !== 'production', // Test charges in dev
          },
        }),
      }
    );

    const data = await chargeResponse.json();
    const charge = data.recurring_application_charge;

    if (!charge) {
      throw new Error('Failed to create charge');
    }

    res.json({ confirmationUrl: charge.confirmation_url });
  } catch (err) {
    console.error('Billing subscribe error:', err);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// GET /billing/confirm - Confirm charge after merchant approves
router.get('/confirm', async (req, res) => {
  const { shop: shopDomain, charge_id } = req.query;

  if (!shopDomain || !charge_id) {
    return res.status(400).send('Missing parameters');
  }

  try {
    const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
    if (!shop) {
      return res.status(404).send('Shop not found');
    }

    // Verify charge status
    const chargeResponse = await fetch(
      `https://${shopDomain}/admin/api/2024-10/recurring_application_charges/${charge_id}.json`,
      {
        headers: { 'X-Shopify-Access-Token': shop.accessToken },
      }
    );

    const data = await chargeResponse.json();
    const charge = data.recurring_application_charge;

    if (charge?.status === 'accepted') {
      // Activate the charge
      await fetch(
        `https://${shopDomain}/admin/api/2024-10/recurring_application_charges/${charge_id}/activate.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': shop.accessToken,
          },
        }
      );

      // Update shop plan
      await prisma.shop.update({
        where: { domain: shopDomain },
        data: { plan: 'pro', chargeId: charge_id },
      });

      console.log(`${shopDomain} upgraded to Pro`);
    }

    // Redirect back to app
    const appHandle = process.env.SHOPIFY_API_KEY;
    res.redirect(`https://${shopDomain}/admin/apps/${appHandle}`);
  } catch (err) {
    console.error('Billing confirm error:', err);
    res.status(500).send('Failed to confirm subscription');
  }
});

// GET /billing/status - Check current plan
router.get('/status', verifyRequest, async (req, res) => {
  const shop = req.shop;
  const plan = PLANS[shop.plan] || PLANS.free;

  res.json({
    plan: shop.plan,
    name: plan.name,
    price: plan.price,
    chargeId: shop.chargeId,
  });
});

export default router;
