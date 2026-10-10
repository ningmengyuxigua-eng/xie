const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const args=process.argv.slice(2);
if(args[0]==='execfile') { const script=fs.readFileSync(args[1],'utf8'); args.splice(0,2,'page','exec','--store-id','27857268786685','--script',script); }
const r=spawnSync('C:/Users/Administrator/AppData/Roaming/npm/node_modules/@ziniao-open/cli/bin/ziniao-cli.exe',args,{encoding:'utf8',maxBuffer:32*1024*1024});
if(r.error) throw r.error;
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status||0;
