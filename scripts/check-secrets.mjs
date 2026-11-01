import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/GOCSPX-[A-Za-z0-9_-]{20,}/,/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{40,}/];
const violations=[];
for(const file of files){
 if(/(^|\/)(\.env(?:\.local)?|client_secret_[^/]+\.json)$/.test(file)||/\.(pem|key)$/.test(file)){violations.push(file);continue;}
 const data=readFileSync(file);if(data.includes(0))continue;if(patterns.some(pattern=>pattern.test(data.toString('utf8'))))violations.push(file);
}
if(violations.length){console.error('Potential credential material in tracked files:',violations.join(', '));process.exit(1);}
console.log('Tracked files pass credential-pattern checks. This is a baseline check, not exhaustive secret detection.');
