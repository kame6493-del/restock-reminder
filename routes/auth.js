import { Router } from 'express';
import { shopify, saveShop } from '../lib/shopify.js';

const router = Router();

// Step 1: Begin OAuth - redirect to Shopify
router.get('/', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) {
    return res.status(400).send('Invalid shop domain');
  }

  // Build auth URL
  const redirectUri = `${process.env.HOST}/auth/callback`;
  const scopes = process.env.SHOPIFY_SCOPES || '';
  const nonce = crypto.randomUUID();

  // Store nonce in cookie for verification
  res.cookie('shopify_nonce', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600000, // 10 minutes
  });

  const authUrl = `https://${sanitizedShop}/admin/oauth/authorize?` +
    `client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${nonce}`;

  res.redirect(authUrl);
});

// Step 2: OAuth callback - exchange code for token
router.get('/callback', async (req, res) => {
  const { shop, code, state, hmac } = req.query;

  // Verify state/nonce
  const storedNonce = req.cookies?.shopify_nonce;
  if (!storedNonce || storedNonce !== state) {
    return res.status(403).send('Invalid state parameter');
  }

  // Verify HMAC
  const queryParams = { ...req.query };
  delete queryParams.hmac;
  delete queryParams.signature;

  const sortedParams = Object.keys(queryParams).sort()
    .map(key => `${key}=${queryParams[key]}`)
    .join('&');

  const crypto = await import('crypto');
  const generatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(sortedParams)
    .digest('hex');

  if (generatedHmac !== hmac) {
    return res.status(403).send('HMAC verification failed');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error('No access token received');
    }

    // Fetch shop info
    const shopResponse = await fetch(`https://${shop}/admin/api/2024-10/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });
    const shopData = (await shopResponse.json()).shop;

    // Save to database
    await saveShop(shop, accessToken, {
      name: shopData.name,
      email: shopData.email,
    });

    // Register webhooks
    await registerWebhooks(shop, accessToken);

    // Clear nonce cookie
    res.clearCookie('shopify_nonce');

    // Redirect to app inside Shopify admin
    const appHandle = process.env.SHOPIFY_API_KEY;
    res.redirect(`https://${shop}/admin/apps/${appHandle}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Authentication failed. Please try again.');
  }
});

// Register webhooks for order tracking
async function registerWebhooks(shop, accessToken) {
  const webhooks = [
    { topic: 'orders/create', address: `${process.env.HOST}/webhooks/orders-create` },
    { topic: 'app/uninstalled', address: `${process.env.HOST}/webhooks/app-uninstalled` },
  ];

  for (const webhook of webhooks) {
    try {
      await fetch(`https://${shop}/admin/api/2024-10/webhooks.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ webhook }),
      });
    } catch (err) {
      console.error(`Failed to register webhook ${webhook.topic}:`, err);
    }
  }
}

export default router;
