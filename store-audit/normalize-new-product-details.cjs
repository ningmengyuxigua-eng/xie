const fs = require('node:fs');
const path = require('node:path');

const identityPath = path.resolve(process.argv[2]);
const detailDir = path.resolve(process.argv[3]);
const outputPath = path.resolve(process.argv[4] || path.join(detailDir, 'normalized-new-products.json'));
const identities = JSON.parse(fs.readFileSync(identityPath, 'utf8'));

function numberValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    const promotion = numberValue(value.promotion_price ?? value.input_promotion_price);
    if (promotion != null && promotion > 0) return promotion;
    return numberValue(value.current_price ?? value.currentPrice ?? value.price ?? value.normal_price ?? value.input_normal_price ?? value.value);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 1e7 ? n / 100000 : n;
}

const normalized = identities.map((identity) => {
  const raw = JSON.parse(fs.readFileSync(path.join(detailDir, `${identity.productId}.json`), 'utf8'));
  const product = raw.data?.product_info ?? raw.product_info ?? raw.data ?? raw;
  const models = product.model_list ?? product.models ?? [];
  const prices = models.map((model) => numberValue(model.price_info ?? model.price ?? model.current_price)).filter((value) => value != null);
  return {
    productId: String(product.id ?? product.product_id ?? identity.productId),
    name: product.name ?? identity.name ?? null,
    sku: product.parent_sku ?? product.parentSku ?? identity.sku ?? null,
    status: product.status ?? identity.status ?? null,
    is_unlisted: Boolean(product.is_unlisted),
    first_publish_time: product.first_publish_time ?? null,
    create_time: product.create_time ?? null,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    variationCount: models.length,
    sales30: identity.sales30 ?? null,
    views30: identity.views30 ?? null,
    url: identity.url ?? `https://seller.shopee.tw/portal/product/${identity.productId}`,
    detailComplete: true,
  };
});

fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2));
console.log(JSON.stringify({ inputProducts: identities.length, normalized: normalized.length, outputPath }));
