export type Role = 'inspector' | 'supervisor';
export type ItemResult = 'pass' | 'fail' | 'na';
export type InspectionStatus = 'draft' | 'submitted';

export type User = { id: string; email: string; name: string; role: Role };

export type Site = { id: string; name: string; address: string; createdAt: string };

export type ChecklistItem = {
  id: string;
  label: string;
  result: ItemResult | null;
  comment: string;
};

export type ChecklistTemplate = {
  id: string;
  name: string;
  items: Pick<ChecklistItem, 'id' | 'label'>[];
};

/** An inspection exactly as the server returns it. */
export type InspectionDto = {
  id: string;
  siteId: string;
  inspectorId: string;
  inspectorName: string;
  title: string;
  notes: string;
  status: InspectionStatus;
  items: ChecklistItem[];
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
};

/**
 * - `synced`: matches the last known server copy.
 * - `pending`: has local changes waiting in the outbox.
 * - `conflict`: the server changed it meanwhile; the user must choose (see `serverCopy`).
 * - `error`: the server rejected the change (see `syncError`).
 */
export type SyncState = 'synced' | 'pending' | 'conflict' | 'error';

/** The local (IndexedDB) copy of an inspection. */
export type LocalInspection = Omit<InspectionDto, 'version'> & {
  /** Last known server version. 0 = never reached the server. */
  version: number;
  syncState: SyncState;
  serverCopy: InspectionDto | null;
  syncError: ApiErrorBody | null;
};

export type EditableFields = Pick<InspectionDto, 'title' | 'notes' | 'status' | 'items'>;

export type OpType = 'create' | 'update' | 'delete';

export type OutboxOp = {
  /** Auto-increment key: the replay order. */
  seq?: number;
  opId: string;
  type: OpType;
  entity: 'inspection';
  entityId: string;
  /** Server version the change was based on; null for creates (and not-yet-rebased follow-ups). */
  baseVersion: number | null;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** Set the first time the op is sent. A sent op is never modified again (it may have landed). */
  sentAt: string | null;
  /** Set when the op hit a conflict: kept aside until the user resolves it. */
  parked: boolean;
};

export type OpResult =
  | { opId: string; status: 'applied'; record: InspectionDto }
  | { opId: string; status: 'duplicate'; appliedVersion: number; record: InspectionDto | null }
  | { opId: string; status: 'conflict'; serverCopy: InspectionDto }
  | { opId: string; status: 'rejected'; error: ApiErrorBody; serverCopy?: InspectionDto };
