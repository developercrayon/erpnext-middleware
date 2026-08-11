import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { AmazonConnector } from './src/modules/connectors/amazon/amazon.connector';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const amazonConnector = app.get(AmazonConnector);

  await (amazonConnector as any).ensureAuthenticated();
  
  const endpoint = (amazonConnector as any).endpoint;
  const spApiHeaders = (amazonConnector as any).spApiHeaders;
  
  const results: any = {};

  try {
    const res1 = await (amazonConnector as any).http.get(
      endpoint + '/listings/2021-08-01/items/A1CFKR1P3UFLY6/WW-SLF-N-COM-walnut-5x5%20Inch',
      {
        headers: spApiHeaders,
        params: {
          marketplaceIds: 'A21TJRUUN4KGV',
          includedData: 'attributes,issues,relationships,summaries'
        }
      }
    );
    results.call1 = res1.data;
  } catch (err: any) {
    results.call1 = err.response?.data || err.message;
  }

  try {
    const res2 = await (amazonConnector as any).http.get(
      endpoint + '/listings/2021-08-01/items/A1CFKR1P3UFLY6/WW-SLF-N-COM-walnut-5.5x5.5%20Inch',
      {
        headers: spApiHeaders,
        params: {
          marketplaceIds: 'A21TJRUUN4KGV',
          includedData: 'attributes,issues,relationships,summaries'
        }
      }
    );
    results.call2 = res2.data;
  } catch (err: any) {
    results.call2 = err.response?.data || err.message;
  }

  fs.writeFileSync('amazon-verification.json', JSON.stringify(results, null, 2));
  console.log('Saved to amazon-verification.json');
  await app.close();
  process.exit(0);
}
bootstrap();
