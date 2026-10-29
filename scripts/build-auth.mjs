import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await build({entryPoints:['client/auth-client.js'],outfile:'public/auth-client.js',bundle:true,format:'esm',platform:'browser',target:'es2020',legalComments:'eof',minify:true});
await copyFile('licenses/firebase-Apache-2.0.txt','public/firebase-license.txt');
