import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Product } from './src/database/entities/product.entity';

const ds = new DataSource({
  type: 'postgres',
  url: process.env.DB_URL,
  entities: [Product],
});

async function run() {
  await ds.initialize();
  const product = await ds.getRepository(Product).findOne({ where: { sku: 'ww-ws-007' } });
  console.log(JSON.stringify(product, null, 2));
  await ds.destroy();
}
run();
