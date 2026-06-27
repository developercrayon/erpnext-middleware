import { Module, DynamicModule } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SharedModule } from '../shared/shared.module';
import { HttpClientService } from '../shared/http-client.service';

import { Order, MarketplaceSource } from '../database/entities/order.entity';
import { OrderItem } from '../database/entities/order-item.entity';
import { Product } from '../database/entities/product.entity';
import { Inventory, InventorySync } from '../database/entities/inventory.entity';
import { PriceSync, ShipmentSync } from '../database/entities/sync.entity';
import { ConnectorLog, WebhookLog, ApiLog, ErrorLog } from '../database/entities/logs.entity';
import { SyncHistory, QueueJob, Settings } from '../database/entities/operational.entity';

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
          InventorySync,
          PriceSync,
          ShipmentSync,
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
                  filterBg: '#212529',
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
                  actions: { new: { isAccessible: false },
                    syncToERPNext: {
                      actionType: 'record',
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
                  actions: { new: { isAccessible: false },
                    syncToMarketplace: {
                      actionType: 'record',
                      icon: 'Share',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        const { record } = context;
                        const sku = record.param('sku');
                        try {
                          const jobId = await productsService.triggerSync(undefined, [sku]);
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Product ${sku} queued for sync to marketplaces (Job ID: ${jobId}).`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            record: record.toJSON(),
                            notice: {
                              message: `Failed to queue product sync: ${err.message}`,
                              type: 'error',
                            },
                          };
                        }
                      },
                    },
                    fetchFromERPNext: {
                      actionType: 'resource',
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
                    syncAllToMarketplaces: {
                      actionType: 'resource',
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
                  },
                },
              },
              {
                resource: Inventory,
                options: { navigation: null,
                  actions: { new: { isAccessible: false },
                    syncSkuInventory: {
                      actionType: 'record',
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
                resource: InventorySync,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: PriceSync,
                options: { navigation: null,
                  actions: { new: { isAccessible: false },
                    syncAllPrices: {
                      actionType: 'resource',
                      icon: 'Sync',
                      isVisible: true,
                      handler: async (request, response, context) => {
                        try {
                          const jobId = await pricingService.triggerSync();
                          return {
                            notice: {
                              message: `Job ${jobId} queued to sync all prices to marketplaces.`,
                              type: 'success',
                            },
                          };
                        } catch (err) {
                          return {
                            notice: {
                              message: `Failed to queue price sync: ${err.message}`,
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
                resource: ShipmentSync,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: SyncHistory,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: QueueJob,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: Settings,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: ConnectorLog,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: WebhookLog,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: ApiLog,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
              },
              {
                resource: ErrorLog,
                options: { navigation: null, actions: { new: { isAccessible: false } } },
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
