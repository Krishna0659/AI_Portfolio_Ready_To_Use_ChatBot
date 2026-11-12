import { z } from 'zod';
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';

export const factSchema = z.object({
  id: z.uuid(),
  text: z.string().trim().min(1).max(10000),
  sourceId: z.uuid().nullable(),
  snapshotId: z.uuid().nullable()
}).strict().refine(f => Boolean(f.sourceId) === Boolean(f.snapshotId), 'Source and snapshot must be paired');

export type Fact = z.infer<typeof factSchema>;

export const profileSchema = z.object({
  schemaVersion: z.literal(1),
  displayName: z.string().trim().max(120),
  headline: z.string().max(240),
  sections: z.array(z.object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    facts: z.array(factSchema).max(100)
  }).strict()).max(20)
}).strict().superRefine((p, c) => {
  const ids = p.sections.flatMap(s => [s.id, ...s.facts.map(f => f.id)]);
  if (new Set(ids).size !== ids.length) c.addIssue({ code: 'custom', message: 'Duplicate content IDs' });
  const totalFacts = p.sections.reduce((n, s) => n + s.facts.length, 0);
  if (totalFacts > 500) c.addIssue({ code: 'custom', message: 'Maximum 500 total facts allowed per profile' });
  const canonical = canonicalize(p);
  if (!canonical || Buffer.byteLength(canonical, 'utf8') > 1048576) c.addIssue({ code: 'custom', message: 'Profile canonical JSON exceeds 1 MB limit' });
});

export type Profile = z.infer<typeof profileSchema>;
export const emptyProfile: Profile = { schemaVersion: 1, displayName: '', headline: '', sections: [] };
export function hash(value: unknown) { return createHash('sha256').update(canonicalize(value)!).digest('hex'); }
export function markdown(p: Profile) {
  const escape = (s: string) => s.replace(/[\\`*_{}\[\]<>#+.!|~-]/g, '\\$&');
  return `# ${escape(p.displayName)}\n\n${escape(p.headline)}\n\n` + p.sections.map(s => `## ${escape(s.title)}\n\n` + s.facts.map(f => `- ${escape(f.text)}`).join('\n')).join('\n\n') + '\n';
}

export type ProfileDiff = {
  addedFacts: Array<{ sectionTitle: string; fact: Fact }>;
  modifiedFacts: Array<{ sectionTitle: string; before: string; after: string }>;
  removedFacts: Array<{ sectionTitle: string; fact: Fact }>;
  displayNameChanged: boolean;
  headlineChanged: boolean;
  totalChanges: number;
};

export function profileDiff(base: Profile, current: Profile): ProfileDiff {
  const baseFactMap = new Map<string, { sectionTitle: string; fact: Fact }>();
  for (const s of base.sections) {
    for (const f of s.facts) {
      baseFactMap.set(f.id, { sectionTitle: s.title, fact: f });
    }
  }

  const currentFactMap = new Map<string, { sectionTitle: string; fact: Fact }>();
  for (const s of current.sections) {
    for (const f of s.facts) {
      currentFactMap.set(f.id, { sectionTitle: s.title, fact: f });
    }
  }

  const addedFacts: ProfileDiff['addedFacts'] = [];
  const modifiedFacts: ProfileDiff['modifiedFacts'] = [];
  const removedFacts: ProfileDiff['removedFacts'] = [];

  for (const s of current.sections) {
    for (const f of s.facts) {
      const prior = baseFactMap.get(f.id);
      if (!prior) {
        addedFacts.push({ sectionTitle: s.title, fact: f });
      } else if (prior.fact.text !== f.text) {
        modifiedFacts.push({ sectionTitle: s.title, before: prior.fact.text, after: f.text });
      }
    }
  }

  for (const s of base.sections) {
    for (const f of s.facts) {
      if (!currentFactMap.has(f.id)) {
        removedFacts.push({ sectionTitle: s.title, fact: f });
      }
    }
  }

  const displayNameChanged = base.displayName !== current.displayName;
  const headlineChanged = base.headline !== current.headline;
  const totalChanges = addedFacts.length + modifiedFacts.length + removedFacts.length + (displayNameChanged ? 1 : 0) + (headlineChanged ? 1 : 0);

  return { addedFacts, modifiedFacts, removedFacts, displayNameChanged, headlineChanged, totalChanges };
}
