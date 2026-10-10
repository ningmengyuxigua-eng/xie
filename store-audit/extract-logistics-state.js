(() => {
  const latest = document.querySelector('.status-log');
  const text = latest?.innerText?.trim() || '';
  const dateMatch = text.match(/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\s+[0-9]{2}:[0-9]{2}/);
  const pickupLocationTerms = ['取件門市', '取貨門市', '取件據點', '取貨據點'];
  const arrivalTerms = ['配達', '抵達', '到達', '送達'];
  const isPickupReady =
    pickupLocationTerms.some((term) => text.includes(term)) &&
    arrivalTerms.some((term) => text.includes(term));

  let latestEventCode = 'other';
  if (text.includes('買家取件成功')) latestEventCode = 'picked_up';
  else if (isPickupReady) latestEventCode = 'pickup_ready';
  else if (text.includes('退回')) latestEventCode = 'returned';
  else if (text.includes('取消')) latestEventCode = 'cancelled';

  return JSON.stringify({
    sourcePath: location.pathname,
    latestEventCode,
    latestEventAt: dateMatch ? dateMatch[0] : null,
  });
})()
