import { Module, DynamicModule } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SharedModule } from '../shared/shared.module';
import { HttpClientService } from '../shared/http-client.service';

import { Order, MarketplaceSource } from '../database/entities/order.entity';
import { OrderItem } from '../database/entities/order-item.entity';
import { Product } from '../database/entities/product.entity';
import { Inventory } from '../database/entities/inventory.entity';
import { ConnectorLog, WebhookLog, ApiLog, ErrorLog } from '../database/entities/logs.entity';
import { SyncHistory, QueueJob, Settings, ItemSyncLog } from '../database/entities/operational.entity';

import { OrdersModule } from '../modules/orders/orders.module';
import { ProductsModule } from '../modules/products/products.module';
import { InventoryModule } from '../modules/inventory/inventory.module';
import { PricingModule } from '../modules/pricing/pricing.module';

import { OrdersService } from '../modules/orders/orders.service';
import { ProductsService } from '../modules/products/products.service';
import { InventoryService } from '../modules/inventory/inventory.service';
import { PricingService } from '../modules/pricing/pricing.service';

@Module({})
export class AdminModule {
  static async register(): Promise<DynamicModule> {
    // Dynamic import to bypass CommonJS static import checks
    const { AdminModule: AdminJSModule } = await eval('import("@adminjs/nestjs")');
    const { default: AdminJS, ComponentLoader } = await eval('import("adminjs")');

    const componentLoader = new ComponentLoader();
    const Components = {
      Dashboard: componentLoader.add('Dashboard', './components/dashboard.jsx'),
      ImageThumbnail: componentLoader.add('ImageThumbnail', './components/image-thumbnail.jsx'),
      // IST timezone date components — override AdminJS default datetime rendering globally
      DateIstList: componentLoader.override('DefaultDatetimeListProperty', './components/date-ist.jsx'),
      DateIstShow: componentLoader.override('DefaultDatetimeShowProperty', './components/date-ist.jsx'),
    };
    const AdminJSTypeorm = await eval('import("@adminjs/typeorm")');

    AdminJS.registerAdapter({
      Resource: AdminJSTypeorm.Resource,
      Database: AdminJSTypeorm.Database,
    });

    const dynamicAdminModule = AdminJSModule.createAdminAsync({
      imports: [OrdersModule, ProductsModule, InventoryModule, PricingModule, SharedModule],
      inject: [OrdersService, ProductsService, InventoryService, PricingService, DataSource, ConfigService, HttpClientService],
      useFactory: (
        ordersService: OrdersService,
        productsService: ProductsService,
        inventoryService: InventoryService,
        pricingService: PricingService,
        dataSource: DataSource,
        configService: ConfigService,
        http: HttpClientService,
      ) => {
        // Dynamically assign getRepository method to entities
        const entities = [
          Order,
          OrderItem,
          Product,
          Inventory,
          ItemSyncLog,
          ConnectorLog,
          WebhookLog,
          ApiLog,
          ErrorLog,
          SyncHistory,
          QueueJob,
          Settings,
        ];

        const patchEntity = (target: any) => {
          if (typeof target !== 'function' || target.getRepository) return;
          const repo: any = dataSource.getRepository(target);
          
          // Static methods
          target.getRepository = () => repo;
          target.find = (...args) => repo.find(...args);
          target.findOneBy = (...args) => repo.findOneBy(...args);
          target.findBy = (...args) => repo.findBy(...args);
          target.count = (...args) => repo.count(...args);
          target.create = (...args) => repo.create(...args);
          target.save = (...args) => repo.save(...args);
          target.remove = (...args) => repo.remove(...args);

          // Instance methods
          target.prototype.save = function(options) { return repo.save(this, options); };
          target.prototype.remove = function(options) { return repo.remove(this, options); };
        };

        for (const entity of entities) patchEntity(entity);
        for (const meta of dataSource.entityMetadatas) patchEntity(meta.target);

        return {
          adminJsOptions: {
            databases: [dataSource],
            rootPath: '/admin',
            componentLoader,
            dashboard: {
              component: Components.Dashboard,
            },
            branding: {
              companyName: 'Inkreatix Admin',
              logo: '/i_logo.avif',
              favicon: '/favicon.png',
              withMadeWithLove: false,
              theme: {
                colors: {
                  primary100: '#ff5e62',
                  primary80: '#ff5e62',
                  primary60: '#ff5e62',
                  primary40: '#ff5e62',
                  primary20: '#ff5e62',
                  accent: '#ff5e62',
                  grey100: '#212529',
                  grey80: '#212529',
                  grey60: '#212529',
                  grey40: '#212529',
                  grey20: '#212529',
                  filterBg: '#ffffff',
                  text: '#212529',
                  bg: '#ffffff', // Background (if required)
                },
              },
            },
            locale: {
              language: 'en',
              translations: {
                en: { labels: { navigation: '' }, components: {
                    Login: {
                      welcomeMessage: "From customized printing to premium office gifts and modern corporate packaging, we create products that add value to your brand and everyday life. Whether you're designing items for internal use or building your online merchandise store, our high-quality, fully customizable goods help your brand stand out with style and purpose.",
                    },
                  },
                },
              },
            },
            resources: [
              {
                resource: Order,
                options: { navigation: null,
                  sort: { sortBy: 'createdAt', direction: 'desc' },
                  actions: { new: { isAccessible: false },
                    syncToERPNext: {
                      actionType: 'record',
                      component: false,
                      icon: 'Sync',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        const { record } = context;
                        const orderId = record.param('id');
                        try {
                          await ordersService.requeueOrder(orderId);
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Order ${record.param('marketplaceOrderId')} successfully queued for ERPNext sync.`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Failed to queue order: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    fetchAmazonOrders: {
                      actionType: 'resource',
                      component: false,
                      icon: 'Download',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        try {
                          const jobId = await ordersService.triggerFetchOrders(MarketplaceSource.AMAZON);
                          return {
                            notice: {
                              message: `Successfully queued job ${jobId} to fetch Amazon orders for the last 24 hours.`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            notice: {
                              message: `Failed to queue fetch Amazon orders: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                  },
                },
              },
              {
                resource: OrderItem,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: Product,
                options: { navigation: null,
                  properties: {
                    description: {
                      isVisible: { list: false, show: true, edit: true, filter: true }
                    },
                    amazonProductType: {
                      isVisible: { list: true, show: true, edit: true, filter: true },
                      position: 5,
                    },
                    upc: {
                      isVisible: { list: true, show: true, edit: true, filter: true },
                      position: 6,
                    },
                    thumbnailUrl: {
                      isVisible: { list: false, show: true, edit: true, filter: false },
                      components: {
                        show: Components.ImageThumbnail,
                      }
                    },
                    attributes: {
                      isVisible: { list: false, show: true, edit: false, filter: false },
                    },
                    images: {
                      isVisible: { list: false, show: true, edit: false, filter: false },
                    },
                    availableQty: {
                      isVisible: { list: true, show: true, edit: false, filter: true },
                      position: 7,
                    }
                  },
                  actions: { new: { isAccessible: false },
                    syncToAmazon: {
                      actionType: 'record',
                      component: false,
                      icon: 'Amazon',
                      isVisible: (context) => {
                        const { record } = context;
                        return record && (record.params.customAmazon === true || record.params.customAmazon === 1 || record.params.customAmazon === 'true');
                      },
                      handler: async (request, response, context) => {
                        const { record } = context;
                        const sku = record.param('sku');
                        try {
                          const jobId = await productsService.triggerSync(MarketplaceSource.AMAZON, [sku]);
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Product ${sku} queued for sync to Amazon (Job ID: ${jobId}).`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Failed to queue product sync to Amazon: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    syncToFlipkart: {
                      actionType: 'record',
                      component: false,
                      icon: 'ShoppingBag',
                      isVisible: (context) => {
                        const { record } = context;
                        return record && (record.params.customFlipkart === true || record.params.customFlipkart === 1 || record.params.customFlipkart === 'true');
                      },
                      handler: async (request, response, context) => {
                        const { record } = context;
                        const sku = record.param('sku');
                        try {
                          const jobId = await productsService.triggerSync(MarketplaceSource.FLIPKART, [sku]);
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Product ${sku} queued for sync to Flipkart (Job ID: ${jobId}).`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Failed to queue product sync to Flipkart: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    bulkSyncToAmazon: {
                      actionType: 'bulk',
                      component: false,
                      icon: 'Amazon',
                      label: 'Sync into Amazon',
                      handler: async (request, response, context) => {
                        const { records } = context;
                        const skus = (records || [])
                          .filter(r => r.params.customAmazon === true || r.params.customAmazon === 1 || r.params.customAmazon === 'true')
                          .map(r => r.params.sku);
                        
                        if (skus.length === 0) {
                          return {
                            records: context.records || [],
                            notice: {
                              message: 'None of the selected products are configured for Amazon sync.',
                              type: 'error',
                            },
                          };
                        }
                        
                        try {
                          const jobId = await productsService.triggerSync(MarketplaceSource.AMAZON, skus);
                          return {
                            records: context.records || [],
                            notice: {
                              message: `Successfully queued ${skus.length} products for Amazon sync (Job ID: ${jobId}).`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            records: context.records || [],
                            notice: {
                              message: `Failed to queue bulk Amazon sync: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    bulkSyncToFlipkart: {
                      actionType: 'bulk',
                      component: false,
                      icon: 'ShoppingBag',
                      label: 'Sync into Flipkart',
                      handler: async (request, response, context) => {
                        const { records } = context;
                        const skus = (records || [])
                          .filter(r => r.params.customFlipkart === true || r.params.customFlipkart === 1 || r.params.customFlipkart === 'true')
                          .map(r => r.params.sku);
                        
                        if (skus.length === 0) {
                          return {
                            records: context.records || [],
                            notice: {
                              message: 'None of the selected products are configured for Flipkart sync.',
                              type: 'error',
                            },
                          };
                        }

                        try {
                          const jobId = await productsService.triggerSync(MarketplaceSource.FLIPKART, skus);
                          return {
                            records: context.records || [],
                            notice: {
                              message: `Successfully queued ${skus.length} products for Flipkart sync (Job ID: ${jobId}).`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            records: context.records || [],
                            notice: {
                              message: `Failed to queue bulk Flipkart sync: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    bulkSyncToBoth: {
                      actionType: 'bulk',
                      component: false,
                      icon: 'Sync',
                      label: 'Sync into Both',
                      handler: async (request, response, context) => {
                        const { records } = context;
                        const amazonSkus = (records || [])
                          .filter(r => r.params.customAmazon === true || r.params.customAmazon === 1 || r.params.customAmazon === 'true')
                          .map(r => r.params.sku);
                        const flipkartSkus = (records || [])
                          .filter(r => r.params.customFlipkart === true || r.params.customFlipkart === 1 || r.params.customFlipkart === 'true')
                          .map(r => r.params.sku);
                        
                        if (amazonSkus.length === 0 && flipkartSkus.length === 0) {
                          return {
                            records: context.records || [],
                            notice: {
                              message: 'None of the selected products are configured for Amazon or Flipkart sync.',
                              type: 'error',
                            },
                          };
                        }

                        try {
                          let msg = '';
                          if (amazonSkus.length > 0) {
                            const jobIdAmz = await productsService.triggerSync(MarketplaceSource.AMAZON, amazonSkus);
                            msg += `Amazon: ${amazonSkus.length} products (Job: ${jobIdAmz}). `;
                          }
                          if (flipkartSkus.length > 0) {
                            const jobIdFlp = await productsService.triggerSync(MarketplaceSource.FLIPKART, flipkartSkus);
                            msg += `Flipkart: ${flipkartSkus.length} products (Job: ${jobIdFlp}).`;
                          }
                          return {
                            records: context.records || [],
                            notice: {
                              message: `Successfully queued sync. ${msg}`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            records: context.records || [],
                            notice: {
                              message: `Failed to queue bulk sync: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    fetchFromERPNext: {
                      actionType: 'resource',
                      component: false,
                      icon: 'Download',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        try {
                          const jobId = await productsService.triggerFetchFromERPNext();
                          return {
                            notice: {
                              message: `Job ${jobId} queued to fetch/sync products from ERPNext.`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            notice: {
                              message: `Failed to queue ERPNext product fetch: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    fetchLatestStock: {
                      actionType: 'resource',
                      component: false,
                      icon: 'Download',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        try {
                          const jobId = await inventoryService.triggerFetch();
                          return {
                            notice: {
                              message: `Job ${jobId} queued to fetch all latest quantities from ERPNext.`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            notice: {
                              message: `Failed to queue ERPNext inventory fetch: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    syncAllToMarketplaces: {
                      actionType: 'resource',
                      component: false,
                      icon: 'Share',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        try {
                          const jobId = await productsService.triggerSync();
                          return {
                            notice: {
                              message: `Job ${jobId} queued to sync all products to marketplaces.`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            notice: {
                              message: `Failed to queue sync of all products: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    pushAllStockToMarketplaces: {
                      actionType: 'resource',
                      component: false,
                      icon: 'CloudUpload',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        try {
                          const jobId = await inventoryService.triggerSync();
                          return {
                            notice: {
                              message: `Job ${jobId} queued to push all stock to marketplaces.`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            notice: {
                              message: `Failed to queue stock push: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    syncStockOnly: {
                      actionType: 'record',
                      component: false,
                      icon: 'Box',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        const { record } = context;
                        const sku = record.param('sku');
                        try {
                          const jobId = await inventoryService.triggerSync(undefined, [sku]);
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Inventory sync for SKU ${sku} queued (Job ID: ${jobId}).`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Failed to queue inventory sync: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                  },
                },
              },
              {
                resource: Inventory,
                options: { navigation: false,
                  sort: { sortBy: 'createdAt', direction: 'desc' },
                  actions: { new: { isAccessible: false },
                    syncSkuInventory: {
                      actionType: 'record',
                      component: false,
                      icon: 'Sync',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        const { record } = context;
                        const sku = record.param('sku');
                        try {
                          const jobId = await inventoryService.triggerSync(undefined, [sku]);
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Inventory sync for SKU ${sku} queued (Job ID: ${jobId}).`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Failed to queue inventory sync: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    syncAllInventory: {
                      actionType: 'resource',
                      component: false,
                      icon: 'Sync',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        try {
                          const jobId = await inventoryService.triggerSync();
                          return {
                            notice: {
                              message: `Job ${jobId} queued to sync all inventory to marketplaces.`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            notice: {
                              message: `Failed to queue sync of all inventory: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                  },
                },
              },
              {
                resource: ItemSyncLog,
                options: {
                  navigation: { name: 'Logs', icon: 'Activity' },
                  sort: { sortBy: 'createdAt', direction: 'desc' },
                  actions: { new: { isAccessible: false } },
                  listProperties: ['resourceType', 'source', 'referenceId', 'syncStatus', 'syncedAt'],
                  filterProperties: ['resourceType', 'source', 'referenceId', 'syncStatus'],
                },
              },
              {
                resource: SyncHistory,
                options: { navigation: { name: 'Logs', icon: 'Activity' }, sort: { sortBy: 'createdAt', direction: 'desc' }, actions: { new: { isAccessible: false } } },
              },
              {
                resource: QueueJob,
                options: { 
                  navigation: null, 
                  actions: { new: { isAccessible: false } },
                  listProperties: ['id', 'queueName', 'jobName', 'status', 'attempts', 'createdDate', 'completedAt'],
                  sort: {
                    sortBy: 'createdDate',
                    direction: 'desc',
                  },
                },
              },
              {
                resource: Settings,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: ConnectorLog,
                options: { 
                  navigation: { name: 'Logs', icon: 'Activity' }, 
                  listProperties: ['id', 'connector', 'action', 'level', 'message', 'createdAt'],
                  sort: { sortBy: 'createdAt', direction: 'desc' }, 
                  actions: { new: { isAccessible: false } } 
                },
              },
              {
                resource: WebhookLog,
                options: { 
                  navigation: { name: 'Logs', icon: 'Activity' }, 
                  listProperties: ['id', 'source', 'eventType', 'processed', 'createdAt'],
                  sort: { sortBy: 'createdAt', direction: 'desc' }, 
                  actions: { new: { isAccessible: false } } 
                },
              },
              {
                resource: ApiLog,
                options: { 
                  navigation: { name: 'Logs', icon: 'Activity' }, 
                  listProperties: ['id', 'service', 'method', 'url', 'responseStatus', 'createdAt'],
                  sort: { sortBy: 'createdAt', direction: 'desc' }, 
                  actions: { new: { isAccessible: false } } 
                },
              },
              {
                resource: ErrorLog,
                options: { 
                  navigation: { name: 'Logs', icon: 'Activity' }, 
                  listProperties: ['id', 'source', 'context', 'message', 'createdAt'],
                  sort: { sortBy: 'createdAt', direction: 'desc' }, 
                  actions: { new: { isAccessible: false } } 
                },
              },
            ],
          },
          auth: {
            authenticate: async (email, password) => {
              try {
                const erpNextUrl = configService.get<string>('erpnext.baseUrl');
                const response = await http.post(`${erpNextUrl}/api/method/login`, {
                  usr: email,
                  pwd: password,
                });

                if (response.data && response.data.message === 'Logged In') {
                  // Returning an object tells AdminJS the login was successful
                  return { email, title: 'ERPNext Admin' };
                }
              } catch (err) {
                console.error('AdminJS ERPNext Login failed:', err.message);
              }
              return null; // Return null to reject login
            },
            cookiePassword: configService.get<string>('app.cookieSecret') || 'super-secret-cookie-password-replace-me',
            cookieName: 'adminjs_session',
          },
          sessionOptions: {
            resave: false,
            saveUninitialized: false,
            secret: configService.get<string>('app.sessionSecret') || 'super-secret-session-password-replace-me',
          },
        };
      },
    });

    return {
      module: AdminModule,
      imports: [dynamicAdminModule],
      exports: [dynamicAdminModule],
    };
  }
}
