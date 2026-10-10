const fs=require('node:fs');const path=require('node:path');
const dir='D:/xiapi/store-audit/2026-10-06';
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
const num=v=>Number(String(v??'').split('\n')[0].replace(/[^0-9.\-]/g,''))||0;
const ads=read('advertisements.json');
const data={ads:{count:ads.length,status:{},expense:0,revenue:0,zeroRevenueExpense:0,zeroRevenueCount:0,activeZeroRevenue:[],topExpense:[],topRevenue:[]},vouchers:[],promotions:[]};
for(const a of ads){a.expense=num(a['花費']);a.revenue=num(a['銷售額']);a.roas=num(a['投入產出比']);a.status=a.name.split('\n').find(x=>['進行中','暫停中','已結束','已刪除','已排定'].includes(x));a.displayName=a.name.split('\n').filter(x=>x!=='...')[0];data.ads.status[a.status]=(data.ads.status[a.status]||0)+1;data.ads.expense+=a.expense;data.ads.revenue+=a.revenue;if(a.expense>0&&a.revenue===0){data.ads.zeroRevenueExpense+=a.expense;data.ads.zeroRevenueCount++;if(a.status==='進行中')data.ads.activeZeroRevenue.push(a)}}
data.ads.topExpense=[...ads].sort((a,b)=>b.expense-a.expense).slice(0,15);data.ads.topRevenue=[...ads].sort((a,b)=>b.revenue-a.revenue).slice(0,15);data.ads.activeZeroRevenue.sort((a,b)=>b.expense-a.expense);
for(const file of ['vouchers-full.json','vouchers-page2.json','vouchers-page3.json','vouchers-page4.json']){for(const t of read(file).tables){for(const r of t.rows){if(r.cells?.[0]?.includes('優惠券代碼 :')){const c=r.cells;const parts=c[0].split('\n');data.vouchers.push({status:parts[0],name:parts[1],code:parts[2],type:c[1],products:c[2],buyers:c[3],discount:c[4],quantity:c[5],used:c[6],period:c[7]})}}}}
for(const file of ['discount-full.json','discount-page2.json']){for(const t of read(file).tables){for(const r of t.rows){if(r.cells?.[0]?.match(/^(進行中的活動|已結束)/)){const c=r.cells;const parts=c[0].split('\n');data.promotions.push({status:parts[0],name:parts[1],type:c[1],products:c[2],period:c[3]})}}}}
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(data,null,2));
console.log(JSON.stringify({ads:{...data.ads,topExpense:data.ads.topExpense.slice(0,5),topRevenue:data.ads.topRevenue.slice(0,5),activeZeroRevenue:data.ads.activeZeroRevenue.slice(0,5)},vouchersCount:data.vouchers.length,voucherStatuses:data.vouchers.reduce((o,v)=>(o[v.status]=(o[v.status]||0)+1,o),{}),promotions:data.promotions},null,2));

