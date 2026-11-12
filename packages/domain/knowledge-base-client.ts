import type {Profile} from '../contracts/profile';

/**
 * TR15 Website KnowledgeBaseClient and Integration Boundary
 *
 * Implements the website-side contract with disabled and mock adapters.
 * Strictly decoupled from ChromaDB and retrieval until later plugged in.
 */

export type OperationType = 'publish' | 'purge';

export type BaseEvent = {
  eventId: string;
  contractVersion: 'approved-profile-v1';
  generation: number;
};

export type PublishEvent = BaseEvent & {
  type: 'publish';
  profileVersion: number;
  content: Profile;
  contentHash: string;
  publishConsent: boolean;
};

export type PurgeEvent = BaseEvent & {
  type: 'purge';
};

export type OperationEvent = PublishEvent | PurgeEvent;

export type OperationStatus =
  | 'blocked_configuration'
  | 'pending'
  | 'mock_succeeded'
  | 'succeeded'
  | 'failed'
  | 'superseded';

export type OperationReceipt = {
  eventId: string;
  tenantId: string;
  profileId: string;
  status: OperationStatus;
  generation: number;
  message?: string;
};

export type ProfileState = {
  tenantId: string;
  profileId: string;
  generation: number;
  status: 'empty' | 'mock_indexed' | 'indexed' | 'purged';
  lastOperationId?: string;
};

export interface KnowledgeBaseAdapter {
  submit(tenantId: string, profileId: string, event: OperationEvent): Promise<OperationReceipt>;
  getOperation(tenantId: string, profileId: string, eventId: string): Promise<OperationReceipt | null>;
  getProfileState(tenantId: string, profileId: string): Promise<ProfileState>;
}

/**
 * Disabled Adapter: Default state where integration is disabled.
 * Events stay blocked_configuration and cannot proceed without configuration.
 */
export class DisabledKnowledgeBaseAdapter implements KnowledgeBaseAdapter {
  async submit(tenantId: string, profileId: string, event: OperationEvent): Promise<OperationReceipt> {
    return {
      eventId: event.eventId,
      tenantId,
      profileId,
      status: 'blocked_configuration',
      generation: event.generation,
      message: 'Knowledge base integration is disabled for this workspace.'
    };
  }

  async getOperation(tenantId: string, profileId: string, eventId: string): Promise<OperationReceipt | null> {
    return null;
  }

  async getProfileState(tenantId: string, profileId: string): Promise<ProfileState> {
    return {
      tenantId,
      profileId,
      generation: 0,
      status: 'empty'
    };
  }
}

/**
 * Mock Adapter: Local contract testing adapter.
 * Verifies event schema, requires publication consent for publish events,
 * and acknowledges events with mock_succeeded without live indexing.
 */
export class MockKnowledgeBaseAdapter implements KnowledgeBaseAdapter {
  private operations = new Map<string, OperationReceipt>();
  private profileStates = new Map<string, ProfileState>();

  async submit(tenantId: string, profileId: string, event: OperationEvent): Promise<OperationReceipt> {
    const key = `${tenantId}:${profileId}`;

    if (event.type === 'publish' && !event.publishConsent) {
      throw Object.assign(Error('Publication requires explicit user consent'), {status: 400});
    }

    const currentState = this.profileStates.get(key);
    if (currentState && event.generation <= currentState.generation) {
      throw Object.assign(Error('Stale generation rejected: event generation must be strictly increasing'), {status: 409});
    }

    const receipt: OperationReceipt = {
      eventId: event.eventId,
      tenantId,
      profileId,
      status: 'mock_succeeded',
      generation: event.generation,
      message: 'Event accepted by mock adapter for local contract testing.'
    };

    this.operations.set(event.eventId, receipt);
    this.profileStates.set(key, {
      tenantId,
      profileId,
      generation: event.generation,
      status: event.type === 'purge' ? 'purged' : 'mock_indexed',
      lastOperationId: event.eventId
    });

    return receipt;
  }

  async getOperation(tenantId: string, profileId: string, eventId: string): Promise<OperationReceipt | null> {
    return this.operations.get(eventId) ?? null;
  }

  async getProfileState(tenantId: string, profileId: string): Promise<ProfileState> {
    const key = `${tenantId}:${profileId}`;
    return this.profileStates.get(key) ?? {
      tenantId,
      profileId,
      generation: 0,
      status: 'empty'
    };
  }
}

/**
 * KnowledgeBaseClient: Dispatches operations using the configured adapter.
 */
export class KnowledgeBaseClient {
  private adapter: KnowledgeBaseAdapter;

  constructor(mode: 'disabled' | 'mock' = 'disabled') {
    this.adapter = mode === 'mock' ? new MockKnowledgeBaseAdapter() : new DisabledKnowledgeBaseAdapter();
  }

  setAdapter(adapter: KnowledgeBaseAdapter): void {
    this.adapter = adapter;
  }

  async submit(tenantId: string, profileId: string, event: OperationEvent): Promise<OperationReceipt> {
    return this.adapter.submit(tenantId, profileId, event);
  }

  async getOperation(tenantId: string, profileId: string, eventId: string): Promise<OperationReceipt | null> {
    return this.adapter.getOperation(tenantId, profileId, eventId);
  }

  async getProfileState(tenantId: string, profileId: string): Promise<ProfileState> {
    return this.adapter.getProfileState(tenantId, profileId);
  }
}

export const defaultKnowledgeBaseClient = new KnowledgeBaseClient();

