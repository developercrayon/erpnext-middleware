import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Product } from './src/modules/products/entities/product.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo = app.get(getRepositoryToken(Product));
  const products = await repo.find({ where: [{ sku: 'B0H6J6Y2CV' }, { sku: 'B0H6JDNX73' }, { sku: 'B0H6JN2R8Q' }] });
  for (const p of products) {
    console.log(`SKU: ${p.sku}, isParent: ${p.isParent}, variantOf: ${p.variantOf}`);
    const sellerSkuObj = p.attributes?.identifiers?.[0]?.identifiers?.find(i => i.identifierType === 'SKU');
    console.log(`Seller SKU: ${sellerSkuObj?.identifier}`);
    console.log(`childAsins:`, p.attributes?.relationships?.[0]?.relationships?.[0]?.childAsins);
    console.log(`parentAsins:`, p.attributes?.relationships?.[0]?.relationships?.[0]?.parentAsins);
    console.log('---');
  }
  await app.close();
}
bootstrap();
