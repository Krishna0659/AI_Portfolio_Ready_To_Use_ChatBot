import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const directory='.local/foundation-test';await mkdir(directory,{recursive:true});
const admin=randomBytes(24).toString('hex'),runtime=randomBytes(24).toString('hex');
await writeFile(directory+'/database-password',admin,{mode:0o600});
await writeFile(directory+'/environment',[
 'APP_ORIGIN=http://localhost:3000','LOCAL_DEVELOPMENT_LOGIN=false',
 `ADMIN_DATABASE_URL=postgresql://portfolio_admin:${admin}@database:5432/postgres`,
 `DATABASE_URL=postgresql://portfolio_runtime:${runtime}@database:5432/postgres`,
 `RUNTIME_DB_PASSWORD=${runtime}`,`OIDC_FLOW_KEY=${randomBytes(32).toString('hex')}`,
 'PYTHON_PATH=/opt/parser/bin/python',''
].join('\n'),{mode:0o644});
// Disposable test credentials must be readable by the unprivileged container UID.
await chmod(directory+'/environment',0o644);
console.log('Isolated test credentials prepared. No user data or live provider credentials are used.');
