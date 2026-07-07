import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { AmazonConnector } from './src/modules/connectors/amazon/amazon.connector';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const connector = app.get(AmazonConnector);
  const ac: any = connector;

  await ac.ensureAuthenticated();

  const sku = 'WW-WS-001';
  
  try {
    console.log(`\n\n--- Fetching details for SKU: ${sku} ---`);
    const response = await ac.http.get(
      `${ac.endpoint}/listings/2021-08-01/items/${ac.sellerId}/${encodeURIComponent(sku)}`,
      {
        headers: ac.spApiHeaders,
        params: { 
          marketplaceIds: ac.marketplaceId,
          includedData: 'attributes,summaries,issues,offers,fulfillmentAvailability' 
        },
      }
    );
    
    const outputPath = path.join(process.cwd(), `amazon-product-${sku}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(response.data, null, 2));
    console.log(`\nSuccessfully saved product details to ${outputPath}`);
    
  } catch (e: any) {
    console.error(`Failed to fetch ${sku}:`, e.response?.data || e.message);
  }

  await app.close();
}

bootstrap();
