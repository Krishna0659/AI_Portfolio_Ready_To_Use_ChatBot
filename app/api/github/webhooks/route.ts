import {NextResponse} from 'next/server';
import {pool} from '../../../../packages/db';
import {
  verifyWebhookSignature,
  recordDelivery,
  processWebhookEvent
} from '../../../../services/github/webhooks';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({error: 'Webhook receiver is not configured'}, {status: 503});
  }

  const deliveryId = req.headers.get('x-github-delivery');
  if (!deliveryId) {
    return NextResponse.json({error: 'Missing X-GitHub-Delivery header'}, {status: 400});
  }

  // Delivery deduplication
  if (!recordDelivery(deliveryId)) {
    return NextResponse.json({ok: true, message: 'Duplicate delivery ignored'});
  }

  const signature = req.headers.get('x-hub-signature-256');
  const rawBody = await req.text();

  if (!verifyWebhookSignature(rawBody, secret, signature)) {
    return NextResponse.json({error: 'Invalid webhook signature'}, {status: 401});
  }

  const event = req.headers.get('x-github-event') ?? 'unknown';
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({error: 'Invalid JSON payload'}, {status: 400});
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await processWebhookEvent(event, payload, client);
    await client.query('COMMIT');
    return NextResponse.json({ok: true, ...result});
  } catch (err: any) {
    await client.query('ROLLBACK');
    return NextResponse.json({error: err.message || 'Webhook processing failed'}, {status: 500});
  } finally {
    client.release();
  }
}
