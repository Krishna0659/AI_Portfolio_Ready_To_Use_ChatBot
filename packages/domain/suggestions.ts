import {randomUUID} from 'node:crypto';
import type {Fact, Profile} from '../contracts/profile';

/**
 * TR13 Deterministic Extraction and Evidence Suggestions
 * Preserves user edits, attaches strict provenance, and generates proposals.
 */

export type SuggestionResult = {
  retainedFacts: Fact[];
  proposedAdditions: Fact[];
  proposedDeletions: Fact[];
};

export function chunkTextToFacts(
  text: string,
  sourceId: string,
  snapshotId: string,
  maxFacts = 100
): Fact[] {
  if (!text || !text.trim()) return [];

  const rawChunks = text
    .split(/\r?\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  // Group short lines or clamp long lines to ensure facts are <= 10,000 chars
  const chunks: string[] = [];
  for (const line of rawChunks) {
    if (!chunks.length || chunks[chunks.length - 1].length + line.length > 4000) {
      chunks.push(line.slice(0, 10000));
    } else {
      chunks[chunks.length - 1] += '\n' + line;
    }
  }

  return chunks.slice(0, maxFacts).map(chunkText => ({
    id: randomUUID(),
    text: chunkText,
    sourceId,
    snapshotId
  }));
}

/**
 * Compares prior evidence, new evidence, and user-edited facts (TR13).
 * User manual edits are preserved and never overwritten.
 */
export function diffEvidenceFacts(
  existingSourceFacts: Fact[],
  priorEvidenceText: string,
  newEvidenceText: string,
  sourceId: string,
  newSnapshotId: string
): SuggestionResult {
  const priorLines = new Set(
    priorEvidenceText
      .split(/\r?\n+/)
      .map(s => s.trim())
      .filter(Boolean)
  );

  const newLines = new Set(
    newEvidenceText
      .split(/\r?\n+/)
      .map(s => s.trim())
      .filter(Boolean)
  );

  const retainedFacts: Fact[] = [];
  const proposedDeletions: Fact[] = [];

  for (const fact of existingSourceFacts) {
    // Check if user edited the fact text:
    // If the fact text was never in the prior evidence lines, the user modified it!
    const isUserEdited = !priorLines.has(fact.text);

    if (isUserEdited) {
      // User manual edit: MUST BE PRESERVED (TR13)
      retainedFacts.push(fact);
    } else if (newLines.has(fact.text)) {
      // Unchanged evidence: update snapshot reference to latest
      retainedFacts.push({
        ...fact,
        snapshotId: newSnapshotId
      });
    } else {
      // Disappeared from source in new capture: proposed deletion
      proposedDeletions.push(fact);
    }
  }

  // Find lines in new evidence that were not in prior evidence
  const addedLines: string[] = [];
  for (const line of newLines) {
    if (!priorLines.has(line)) {
      addedLines.push(line);
    }
  }

  const proposedAdditions: Fact[] = addedLines.slice(0, 100).map(text => ({
    id: randomUUID(),
    text: text.slice(0, 10000),
    sourceId,
    snapshotId: newSnapshotId
  }));

  return {
    retainedFacts,
    proposedAdditions,
    proposedDeletions
  };
}

/**
 * Creates or updates a profile section with newly imported evidence suggestions.
 */
export function applySuggestionsToProfile(
  profile: Profile,
  sectionTitle: string,
  suggestions: SuggestionResult
): Profile {
  const sections = profile.sections.map(sec => {
    if (sec.title.toLowerCase() !== sectionTitle.toLowerCase()) {
      return sec;
    }

    // Replace the existing facts for this source with retained facts and proposed additions
    const otherFacts = sec.facts.filter(f => f.sourceId !== suggestions.retainedFacts[0]?.sourceId);
    return {
      ...sec,
      facts: [...otherFacts, ...suggestions.retainedFacts, ...suggestions.proposedAdditions].slice(0, 100)
    };
  });

  // If section does not exist, append it (up to 20 sections limit)
  if (!sections.some(s => s.title.toLowerCase() === sectionTitle.toLowerCase())) {
    if (sections.length < 20) {
      sections.push({
        id: randomUUID(),
        title: sectionTitle,
        facts: [...suggestions.retainedFacts, ...suggestions.proposedAdditions].slice(0, 100)
      });
    }
  }

  return {
    ...profile,
    sections
  };
}

