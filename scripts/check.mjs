import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['src','public','client','scripts','tests'].flatMap(dir=>readdirSync(dir).filter(x=>/\.(js|mjs)$/.test(x)).map(x=>dir+'/'+x));
let failed=false;
for(const file of files){
  const run=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(run.status!==0){console.error(run.stderr);failed=true;}
}
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(config.assets.run_worker_first!==true)throw new Error('All private assets must pass authentication.');
if(config.workers_dev!==false||config.preview_urls!==false)throw new Error('Unprotected default domains must remain disabled.');
console.log(`Syntax and private routing checks: ${files.length} files`);
if(failed)process.exit(1);
