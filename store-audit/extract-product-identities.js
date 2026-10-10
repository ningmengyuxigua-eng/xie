(() => {
  const map = new Map();
  for (const link of document.querySelectorAll('a[href*="/portal/product/"]')) {
    const match = link.href.match(/\/portal\/product\/(\d+)/);
    if (!match || map.has(match[1])) continue;
    const row = link.closest('.eds-table__row');
    const text = row ? row.innerText : link.innerText;
    const sku = (text.match(/主商品貨號:\s*([^\n]+)/) || [])[1] || null;
    const sales30 = (text.match(/過去 30 天銷量\s*([^\n]+)/) || [])[1] || null;
    const views30 = (text.match(/過去 30 天瀏覽量\s*([^\n]+)/) || [])[1] || null;
    map.set(match[1], {
      productId: match[1],
      name: (link.innerText || '').trim(),
      sku: sku && sku.trim() !== '-' ? sku.trim() : null,
      sales30: sales30 ? sales30.trim() : null,
      views30: views30 ? views30.trim() : null,
      status: 'active',
      url: link.href,
    });
  }
  const totalText = (document.body.innerText.match(/([\d,]+)\s*件商品/) || [])[1] || null;
  return JSON.stringify({
    url: location.href,
    total: totalText ? Number(totalText.replace(/,/g, '')) : null,
    items: [...map.values()],
  });
})()
