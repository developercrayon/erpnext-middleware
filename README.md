# ERPNext Integration Middleware

A production-ready NestJS application that acts as a robust, asynchronous middleware between **ERPNext** and marketplace APIs (**Amazon Seller API**, **Flipkart Seller API**).

## Features

- **Orders**: Bidirectional sync (Marketplace Webhooks -> Local DB -> ERPNext)
- **Inventory**: Real-time sync (ERPNext -> Local DB -> Amazon/Flipkart)
- **Products**: Catalog sync
- **Pricing**: Dynamic price pushes
- **Shipments**: Sync tracking data to ERPNext Delivery Notes
- **Resilience**: BullMQ-based background jobs with exponential backoff and retry mechanisms
- **Modularity**: Easy to add more marketplaces extending the `BaseConnector`

## Technology Stack

- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL (TypeORM)
- **Queueing / Cache**: Redis + BullMQ
- **Scheduling**: `@nestjs/schedule` (Cron jobs)
- **Documentation**: Swagger API Docs
- **Deployment**: Docker Compose ready

---

## Prerequisites

- Node.js v20+
- PostgreSQL v15+
- Redis v7+
- Docker and Docker Compose (Optional but recommended)

---

## Getting Started

### 1. Clone & Install

```bash
git clone <repo-url>
cd erpnext-middleware
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in the details.

```bash
cp .env.example .env
```

Key blocks to fill out:
- `DB_*`: PostgreSQL connection credentials
- `REDIS_*`: Redis connection credentials
- `ERPNEXT_*`: ERPNext Base URL, API Key, and Secret
- `AMAZON_*`: SP-API Credentials
- `FLIPKART_*`: Flipkart Seller API Credentials
- `JWT_SECRET` & `WEBHOOK_SECRET`: Security keys

### 3. Run Locally

```bash
# Start required backing services
docker-compose up -d postgres redis

# Run migrations (TypeORM will sync automatically on dev if DB_SYNCHRONIZE=true)
# To run production migrations: npm run migration:run

# Start the application
npm run start:dev
```

### 4. Run with Docker Compose

To run the entire stack (App, DB, Redis) using Docker:

```bash
docker-compose up -d --build
```

---

## API Documentation

Once the app is running, navigate to:
[http://localhost:3000/api/docs](http://localhost:3000/api/docs)

Swagger provides an interactive UI for all endpoints.

---

## Architecture

This middleware is NOT a SaaS application. It is designed to run for a **single company**, linking one ERPNext instance to one or multiple marketplace accounts.

```
Incoming Webhook
      |
      v
[ OrdersController ] -> Validates Signature -> Stores in DB
      |
      v
[ BullMQ (Orders Queue) ] -> Queues job
      |
      v
[ OrdersProcessor ] -> Worker picks up job
      |
      v
[ ERPNextConnector ] -> Pushes order to ERPNext via Frappe API
```

### Queues

- `orders`: High-priority webhook ingestion and ERPNext order creation
- `inventory`: Syncing available stock to Amazon/Flipkart
- `products`: Catalog syncing
- `pricing`: Price updates
- `shipments`: Tracking data propagation
- `retry`: Handling failed jobs with exponential backoff

---

## Adding a New Connector

To add a new marketplace (e.g., Shopify):

1. Create a folder: `src/modules/connectors/shopify`
2. Create `shopify.connector.ts` that extends `BaseConnector`
3. Implement required methods: `fetchOrders`, `updateInventory`, `normalizeOrder`, etc.
4. Export it in `shopify.module.ts`
5. Inject it into the queue processors.

---

## License

MIT License.
