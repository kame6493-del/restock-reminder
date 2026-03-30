import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: (process.env.SHOPIFY_SCOPES || '').split(','),
  hostName: (process.env.HOST || '').replace(/^https?:\/\//, ''),
  hostScheme: 'https',
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});

// Session storage using Prisma
export const sessionStorage = {
  sessions: new Map(),

  async storeSession(session) {
    this.sessions.set(session.id, session.toObject());
    return true;
  },

  async loadSession(id) {
    const data = this.sessions.get(id);
    if (!data) return undefined;
    return new Session(data);
  },

  async deleteSession(id) {
    this.sessions.delete(id);
    return true;
  },

  async deleteSessions(ids) {
    ids.forEach(id => this.sessions.delete(id));
    return true;
  },

  async findSessionsByShop(shop) {
    const results = [];
    for (const [, data] of this.sessions) {
      if (data.shop === shop) {
        results.push(new Session(data));
      }
    }
    return results;
  },
};

// Get shop's access token from database
export async function getShopToken(shopDomain) {
  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
  });
  return shop?.accessToken || null;
}

// Save or update shop
export async function saveShop(shopDomain, accessToken, shopData = {}) {
  return prisma.shop.upsert({
    where: { domain: shopDomain },
    create: {
      domain: shopDomain,
      accessToken,
      name: shopData.name || '',
      email: shopData.email || '',
    },
    update: {
      accessToken,
      name: shopData.name || undefined,
      email: shopData.email || undefined,
      uninstalledAt: null,
    },
  });
}

// Verify Shopify session token (JWT from App Bridge)
async function verifySessionToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    // Extract shop domain from the "dest" field
    const dest = payload.dest || '';
    const shop = dest.replace(/^https?:\/\//, '');
    if (!shop) return null;
    return { shop, payload };
  } catch (e) {
    return null;
  }
}

// Middleware: verify request is from authenticated shop
export function verifyRequest(req, res, next) {
  const authHeader = req.headers['authorization'];
  const shopDomain = req.query.shop || req.headers['x-shop-domain'];

  // Try session token first
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    verifySessionToken(token).then(result => {
      if (result) {
        const shop = result.shop;
        return prisma.shop.findUnique({ where: { domain: shop } })
          .then(shopRecord => {
            if (!shopRecord || !shopRecord.accessToken) {
              return res.status(401).json({ error: 'Shop not authenticated', redirect: `/auth?shop=${shop}` });
            }
            req.shop = shopRecord;
            next();
          });
      }
      // Fall through to shop domain check
      return checkShopDomain(shopDomain, req, res, next);
    }).catch(() => checkShopDomain(shopDomain, req, res, next));
    return;
  }

  checkShopDomain(shopDomain, req, res, next);
}

function checkShopDomain(shopDomain, req, res, next) {
  if (!shopDomain) {
    return res.status(401).json({ error: 'Shop domain required' });
  }

  prisma.shop.findUnique({ where: { domain: shopDomain } })
    .then(shop => {
      if (!shop || !shop.accessToken) {
        return res.status(401).json({ error: 'Shop not authenticated', redirect: `/auth?shop=${shopDomain}` });
      }
      req.shop = shop;
      next();
    })
    .catch(err => {
      console.error('Auth check failed:', err);
      res.status(500).json({ error: 'Internal error' });
    });
}

// FREE plan limits
export const PLANS = {
  free: {
    name: 'Free',
    remindersPerMonth: 50,
    price: 0,
  },
  pro: {
    name: 'Pro',
    remindersPerMonth: Infinity,
    price: 9.99,
  },
};

export function shopifyApp() {
  return { shopify, prisma, sessionStorage };
}
