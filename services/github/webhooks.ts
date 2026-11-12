import {createHmac, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';

/**
 * TR12 GitHub App Webhook Verification and Revocation Handling
 */

// Bounded in-memory deduplication set for webhook delivery IDs (prevents replay attacks)
const SEEN_DELIVERIES = new Set<string>();
const MAX_SEEN_DELIVERIES = 1000;

export function recordDelivery(deliveryId: string): boolean {
  if (!deliveryId || typeof deliveryId !== 'string') return false;
  if (SEEN_DELIVERIES.has(deliveryId)) {
    return false; // Duplicate delivery
  }
  if (SEEN_DELIVERIES.size >= MAX_SEEN_DELIVERIES) {
    // Evict oldest entries
    const it = SEEN_DELIVERIES.values();
    for (let i = 0; i < 200; i++) {
      const val = it.next().value;
      if (val) SEEN_DELIVERIES.delete(val);
    }
  }
  SEEN_DELIVERIES.add(deliveryId);
  return true;
}

export function clearDeliveries(): void {
  SEEN_DELIVERIES.clear();
}

/**
 * Validates GitHub X-Hub-Signature-256 header using timing-safe comparison.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  secret: string,
  signatureHeader: string | null | undefined
): boolean {
  if (!signatureHeader || !secret) return false;
  if (!signatureHeader.startsWith('sha256=')) return false;

  const expectedSignature = 'sha256=' + createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');

  const sigBuffer = Buffer.from(signatureHeader, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(sigBuffer, expectedBuffer);
}

const webhookSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number().int().positive()
  }).optional(),
  repositories_removed: z.array(z.object({
    id: z.number().int().positive().optional(),
    full_name: z.string()
  })).optional(),
  repository: z.object({
    full_name: z.string()
  }).optional()
}).passthrough();

export type GitHubWebhookPayload = z.infer<typeof webhookSchema>;

/**
 * Processes incoming GitHub webhook events and revokes/detaches affected repository sources.
 */
export async function processWebhookEvent(
  event: string,
  payload: unknown,
  db: PoolClient
): Promise<{action: string; affectedSources: number}> {
  const parsed = webhookSchema.parse(payload);
  let affectedSources = 0;

  if (event === 'installation' && (parsed.action === 'deleted' || parsed.action === 'suspend')) {
    // An entire installation was deleted or suspended:
    // Detach all active GitHub sources and cancel their running/queued jobs
    const res = await db.query(
      "UPDATE sources SET status = 'detached' WHERE kind = 'github' AND status = 'active' RETURNING id"
    );
    affectedSources = res.rowCount ?? 0;

    if (affectedSources > 0) {
      const sourceIds = res.rows.map((r: {id: string}) => r.id);
      await db.query(
        "UPDATE jobs SET status = 'cancelled', lease = NULL WHERE source_id = ANY($1::uuid[]) AND status IN ('queued', 'running')",
        [sourceIds]
      );
    }
    return {action: `installation_${parsed.action}`, affectedSources};
  }

  if (event === 'installation_repositories' && parsed.action === 'removed' && parsed.repositories_removed?.length) {
    // Specific repositories were removed from the installation
    for (const repo of parsed.repositories_removed) {
      const pattern = `%github.com/${repo.full_name}%`;
      const res = await db.query(
        "UPDATE sources SET status = 'detached' WHERE kind = 'github' AND status = 'active' AND locator ILIKE $1 RETURNING id",
        [pattern]
      );
      const count = res.rowCount ?? 0;
      affectedSources += count;

      if (count > 0) {
        const sourceIds = res.rows.map((r: {id: string}) => r.id);
        await db.query(
          "UPDATE jobs SET status = 'cancelled', lease = NULL WHERE source_id = ANY($1::uuid[]) AND status IN ('queued', 'running')",
          [sourceIds]
        );
      }
    }
    return {action: 'repositories_removed', affectedSources};
  }

  return {action: 'ignored', affectedSources: 0};
}

