// @ts-nocheck
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { AmazonConnector } from './src/modules/connectors/amazon/amazon.connector';
import * as fs from 'fs';

// simple flat function since 'flat' may not be installed
function flattenObj(ob) {
  let result = {};
  for (const i in ob) {
    if ((typeof ob[i]) === 'object' && !Array.isArray(ob[i]) && ob[i] !== null) {
      const temp = flattenObj(ob[i]);
      for (const j in temp) {
        result[i + '.' + j] = temp[j];
      }
    } else {
      result[i] = ob[i];
    }
  }
  return result;
}

// Convert Array of Objects to CSV
function toCsv(arr) {
  if (arr.length === 0) return '';
  const headers = Array.from(new Set(arr.flatMap(Object.keys)));
  const csvRows = [headers.join(',')];

  for (const row of arr) {
    const values = headers.map(header => {
      let val = row[header];
      if (val === null || val === undefined) {
         val = '';
      } else if (typeof val === 'object') {
         val = JSON.stringify(val);
      } else {
         val = String(val);
      }
      val = val.replace(/"/g, '""');
      if (val.search(/("|,|\n)/g) >= 0) {
         val = `"${val}"`;
      }
      return val;
    });
    csvRows.push(values.join(','));
  }
  return csvRows.join('\n');
}

const skus = [
  'WW-FL-001-BLK',
  'WW-WS-0015',
  'WW-WS-0012',
  'WW-WS-002',
  'WW-WS-005',
  'WW-WS-003',
  'WW-WS-004',
  'WW-WS-006',
  'WW-WS-BJ-001',
  'WW-WS-0011',
  'WW-WS-0014',
  'WW-WS-0013',
  'W-WS-008',
  'WW-WS-0010',
  'WW-WS-009',
  'WW-MH-001-NC',
  'W-SR-001-NC',
  'WW-MG-002-WR',
  'WW-WC-001'
];

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const amazonConnector = app.get(AmazonConnector);
  const results = [];

  for (const sku of skus) {
    try {
      console.log(`Fetching ${sku}...`);
      const res = await amazonConnector.getListingItem(sku);
      if (res) {
        const flattened = flattenObj(res);
        flattened['SKU'] = sku;
        results.push(flattened);
      } else {
        results.push({ SKU: sku, Error: 'No data returned' });
      }
    } catch (error) {
      console.error(`Error fetching details for ${sku}:`, error.message || error);
      results.push({ SKU: sku, Error: error.message || 'Error fetching data' });
    }
    
    // Add a slight delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  if (results.length > 0) {
    try {
      const csv = toCsv(results);
      const csvPath = 'C:/Users/jalpa/.gemini/antigravity-ide/brain/f8f655fa-8e6f-4b57-90ec-dc727314a80a/scratch/amazon_skus_part2.csv';
      fs.writeFileSync(csvPath, csv);
      console.log(`Successfully wrote CSV to ${csvPath}`);
    } catch (err) {
      console.error('Error writing CSV', err);
    }
  }

  await app.close();
}
bootstrap();
