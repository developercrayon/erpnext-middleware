export default () => ({
  app: {
    name: process.env.APP_NAME || 'erpnext-middleware',
    port: parseInt(process.env.APP_PORT, 10) || 3000,
    url: process.env.APP_URL || 'http://localhost:3000',
    env: process.env.NODE_ENV || 'development',
  },

  database: {
    ...(process.env.DB_URL
      ? { url: process.env.DB_URL }
      : {
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT, 10) || 5432,
          username: process.env.DB_USERNAME || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          name: process.env.DB_NAME || 'erpnext_middleware',
        }),
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',
  },

  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  security: {
    internalApiKey: process.env.INTERNAL_API_KEY || 'change-me',
    webhookSecret: process.env.WEBHOOK_SECRET || 'change-me',
  },

  erpnext: {
    baseUrl: process.env.ERPNEXT_BASE_URL || '',
    apiKey: process.env.ERPNEXT_API_KEY || '',
    apiSecret: process.env.ERPNEXT_API_SECRET || '',
    company: process.env.ERPNEXT_COMPANY || '',
    defaultWarehouse: process.env.ERPNEXT_DEFAULT_WAREHOUSE || '',
    defaultPriceList: process.env.ERPNEXT_DEFAULT_PRICE_LIST || 'Standard Selling',
  },

  amazon: {
    clientId: process.env.AMAZON_CLIENT_ID || '',
    clientSecret: process.env.AMAZON_CLIENT_SECRET || '',
    refreshToken: process.env.AMAZON_REFRESH_TOKEN || '',
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'A21TJRUUN4KGV',
    sellerId: process.env.AMAZON_SELLER_ID || '',
    region: process.env.AMAZON_REGION || 'eu-west-1',
    endpoint: process.env.AMAZON_ENDPOINT || 'https://sellingpartnerapi-eu.amazon.com',
    awsAccessKey: process.env.AMAZON_AWS_ACCESS_KEY || '',
    awsSecretKey: process.env.AMAZON_AWS_SECRET_KEY || '',
    awsRoleArn: process.env.AMAZON_AWS_ROLE_ARN || '',
  },

  flipkart: {
    appId: process.env.FLIPKART_APP_ID || '',
    appSecret: process.env.FLIPKART_APP_SECRET || '',
    accessToken: process.env.FLIPKART_ACCESS_TOKEN || '',
    apiUrl: process.env.FLIPKART_API_URL || 'https://api.flipkart.net/sellers',
    affiliateId: process.env.FLIPKART_AFFILIATE_ID || '',
  },

  queues: {
    ordersConcurrency: parseInt(process.env.QUEUE_ORDERS_CONCURRENCY, 10) || 5,
    inventoryConcurrency: parseInt(process.env.QUEUE_INVENTORY_CONCURRENCY, 10) || 3,
    productsConcurrency: parseInt(process.env.QUEUE_PRODUCTS_CONCURRENCY, 10) || 3,
    pricingConcurrency: parseInt(process.env.QUEUE_PRICING_CONCURRENCY, 10) || 3,
    shipmentsConcurrency: parseInt(process.env.QUEUE_SHIPMENTS_CONCURRENCY, 10) || 5,
    retryConcurrency: parseInt(process.env.QUEUE_RETRY_CONCURRENCY, 10) || 2,
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES, 10) || 3,
    retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY, 10) || 5000,
  },

  scheduler: {
    fetchOrders: process.env.CRON_FETCH_ORDERS || '*/15 * * * *',
    syncInventory: process.env.CRON_SYNC_INVENTORY || '*/30 * * * *',
    syncPrices: process.env.CRON_SYNC_PRICES || '0 * * * *',
    retryFailed: process.env.CRON_RETRY_FAILED || '*/10 * * * *',
    cleanupLogs: process.env.CRON_CLEANUP_LOGS || '0 0 * * *',
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL, 10) || 60,
    limit: parseInt(process.env.THROTTLE_LIMIT, 10) || 100,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    dir: process.env.LOG_DIR || './logs',
    maxFiles: process.env.LOG_MAX_FILES || '14d',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
  },
});
