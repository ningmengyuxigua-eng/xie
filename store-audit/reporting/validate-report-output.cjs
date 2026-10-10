const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { root, fileHash } = require('./report-utils.cjs');

const db = new DatabaseSync(path.join(root,'db','store-audit.sqlite'));
const runs = db.prepare(`SELECT * FROM report_run WHERE run_status='complete' ORDER BY report_key,period_end`).all();
const artifactQuery = db.prepare('SELECT * FROM report_artifact WHERE run_id=? ORDER BY artifact_type,artifact_path');
const errors=[];
for(const run of runs){
  const artifacts=artifactQuery.all(run.run_id);
  if(artifacts.length<3) errors.push(`${run.run_id}: fewer than three artifacts`);
  for(const artifact of artifacts){
    const absolute=path.join(root,artifact.artifact_path);
    if(!fs.existsSync(absolute)){errors.push(`${run.run_id}: missing ${artifact.artifact_path}`);continue;}
    if(fileHash(absolute)!==artifact.sha256) errors.push(`${run.run_id}: hash mismatch ${artifact.artifact_path}`);
  }
  const reportArtifact=artifacts.find(x=>x.artifact_type==='json'&&x.artifact_path.endsWith('/report.json'));
  if(reportArtifact){
    const report=JSON.parse(fs.readFileSync(path.join(root,reportArtifact.artifact_path),'utf8'));
    if(report.identity.storeDisplayName!=='拾味廚房雜貨鋪') errors.push(`${run.run_id}: wrong display name`);
    if(report.actions.length>20||report.opportunities.length>20) errors.push(`${run.run_id}: detail limit exceeded`);
    if(report.traceability.runId!==run.run_id) errors.push(`${run.run_id}: traceability mismatch`);
  }
}
db.close();
if(errors.length){console.error(JSON.stringify({ok:false,runs:runs.length,errors},null,2));process.exit(1);}
console.log(JSON.stringify({ok:true,runs:runs.length,validatedArtifacts:runs.reduce((n,x)=>n+artifactQuerySafe(x.run_id),0)}));

function artifactQuerySafe(runId){
  const db2=new DatabaseSync(path.join(root,'db','store-audit.sqlite'));
  try{return db2.prepare('SELECT COUNT(*) n FROM report_artifact WHERE run_id=?').get(runId).n;}
  finally{db2.close();}
}
