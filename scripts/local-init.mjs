import {mkdir,writeFile,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
await mkdir('.local/objects',{recursive:true});
try{await access('.env.local');console.log('Existing local configuration preserved');process.exit(0);}catch{}
const password=randomBytes(24).toString('hex'),runtime=randomBytes(24).toString('hex'),identity=randomBytes(24).toString('hex');
await writeFile('.local/db-password.txt',password);
const bin='C:/Program Files/PostgreSQL/16/bin/';
execFileSync(bin+'initdb.exe',['-D',path.resolve('.local/postgres'),'-U','portfolio_admin','-A','scram-sha-256','--encoding=UTF8','--locale=C','--pwfile='+path.resolve('.local/db-password.txt')],{stdio:'inherit',windowsHide:true});
execFileSync(bin+'pg_ctl.exe',['-D',path.resolve('.local/postgres'),'-l',path.resolve('.local/postgres.log'),'-o','-p 55432 -h 127.0.0.1','start'],{stdio:'inherit',windowsHide:true});
const python=execFileSync('uv',['--cache-dir','.local/uv-cache','python','find'],{encoding:'utf8',windowsHide:true}).trim();
await writeFile('.env.local',`ADMIN_DATABASE_URL=postgresql://portfolio_admin:${password}@127.0.0.1:55432/postgres\nDATABASE_URL=postgresql://portfolio_runtime:${runtime}@127.0.0.1:55432/postgres\nIDENTITY_DATABASE_URL=postgresql://portfolio_identity:${identity}@127.0.0.1:55432/postgres\nRUNTIME_DB_PASSWORD=${runtime}\nPYTHON_PATH=${python.replaceAll('\\','/')}\nAPP_ORIGIN=http://localhost:3000\nLOCAL_DEVELOPMENT_LOGIN=true\nOIDC_FLOW_KEY=${randomBytes(32).toString('hex')}\n`);
console.log('Local PostgreSQL initialized on port 55432. Configuration stored privately in .env.local.');
