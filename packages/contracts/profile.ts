import { z } from 'zod';
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
export const factSchema = z.object({id:z.uuid(),text:z.string().trim().min(1).max(10000),sourceId:z.uuid().nullable(),snapshotId:z.uuid().nullable()}).strict().refine(f=>Boolean(f.sourceId)===Boolean(f.snapshotId),'Source and snapshot must be paired');
export const profileSchema=z.object({schemaVersion:z.literal(1),displayName:z.string().trim().max(120),headline:z.string().max(240),sections:z.array(z.object({id:z.uuid(),title:z.string().trim().min(1).max(120),facts:z.array(factSchema).max(100)}).strict()).max(20)}).strict().superRefine((p,c)=>{const ids=p.sections.flatMap(s=>[s.id,...s.facts.map(f=>f.id)]);if(new Set(ids).size!==ids.length)c.addIssue({code:'custom',message:'Duplicate content IDs'});});
export type Profile=z.infer<typeof profileSchema>;
export const emptyProfile:Profile={schemaVersion:1,displayName:'',headline:'',sections:[]};
export function hash(value:unknown){return createHash('sha256').update(canonicalize(value)!).digest('hex');}
export function markdown(p:Profile){const escape=(s:string)=>s.replace(/[\\`*_{}\[\]<>#+.!|~-]/g,'\\$&');return `# ${escape(p.displayName)}\n\n${escape(p.headline)}\n\n`+p.sections.map(s=>`## ${escape(s.title)}\n\n`+s.facts.map(f=>`- ${escape(f.text)}`).join('\n')).join('\n\n')+'\n';}
