export const QUEUE_NAMES = {
  ORDERS: 'orders',
  INVENTORY: 'inventory',
  PRODUCTS: 'products',
  PRICING: 'pricing',
  SHIPMENTS: 'shipments',
  RETRY: 'retry',
} as const;

export const JOB_NAMES = {
  // Orders
  PROCESS_WEBHOOK_ORDER: 'process-webhook-order',
  SYNC_ORDER_TO_ERPNEXT: 'sync-order-to-erpnext',
  FETCH_MARKETPLACE_ORDERS: 'fetch-marketplace-orders',
  CANCEL_ORDER: 'cancel-order',

  // Inventory
  SYNC_INVENTORY_TO_MARKETPLACE: 'sync-inventory-to-marketplace',
  FETCH_INVENTORY_FROM_ERPNEXT: 'fetch-inventory-from-erpnext',

  // Products
  SYNC_PRODUCTS: 'sync-products',
  FETCH_PRODUCTS: 'fetch-products',

  // Pricing
  SYNC_PRICES_TO_MARKETPLACE: 'sync-prices-to-marketplace',
  FETCH_PRICES_FROM_ERPNEXT: 'fetch-prices-from-erpnext',

  // Shipments
  CREATE_SHIPMENT: 'create-shipment',
  SYNC_SHIPMENT_STATUS: 'sync-shipment-status',

  // Retry
  RETRY_FAILED_JOB: 'retry-failed-job',
} as const;

export const QUEUE_DEFAULT_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
  removeOnComplete: {
    age: 24 * 3600, // keep for 24 hours
    count: 1000,
  },
  removeOnFail: false,
};
