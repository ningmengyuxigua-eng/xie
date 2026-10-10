(() => {
  const maxRows = 20;
  const seen = new Set();
  const rows = [];
  let excludedDelivered = 0;
  let excludedOther = 0;
  const links = Array.from(document.links).filter((link) =>
    link.href.includes('/portal/sale/order/')
  );

  for (const link of links) {
    const idMatch = link.href.match(/\/portal\/sale\/order\/([0-9]+)/);
    if (!idMatch || seen.has(idMatch[1])) continue;

    const text = link.innerText || '';
    const orderNumberMatch = text.match(/\b[0-9]{6}[A-Z0-9]{8}\b/);
    const statusText = link.querySelector('.order-status')?.innerText || '';
    let sourceStatus = 'unknown';
    if (statusText.includes('已送達')) sourceStatus = 'delivered';
    else if (statusText.includes('已出貨')) sourceStatus = 'shipped';

    seen.add(idMatch[1]);
    if (sourceStatus === 'delivered') {
      excludedDelivered += 1;
      continue;
    }
    if (sourceStatus !== 'shipped') {
      excludedOther += 1;
      continue;
    }
    if (rows.length >= maxRows) continue;

    rows.push({
      orderInternalId: idMatch[1],
      orderNumber: orderNumberMatch ? orderNumberMatch[0] : null,
      sourceStatus,
    });
  }

  return JSON.stringify({
    sourcePath: location.pathname,
    activeTab: document.querySelector('.eds-tabs__nav-tab.active')?.innerText?.trim() || '',
    rowCount: rows.length,
    excludedDelivered,
    excludedOther,
    rows,
  });
})()
