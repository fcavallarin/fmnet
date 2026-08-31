export type DeviceId = string;
export type NetworkId = string;
export type EventId = string;
export type EventType = string;
export type PairingPin = string;

export type MaybePromise<T> = T | PromiseLike<T>;

export type DataStoreType = "better-sqlite" | "expo-sqlite";

export interface DataStoreOptions<TDatabase = unknown> {
  type: DataStoreType;
  open: () => MaybePromise<TDatabase>;
  close?: (db: TDatabase) => MaybePromise<void>;
  clearDb?: boolean;
}

export type SecretKeyProvider = () => MaybePromise<Uint8Array>;

export interface SeptClientOptions<TDatabase = unknown> {
  dataStore: DataStoreOptions<TDatabase>;
  secretKeyProvider: SecretKeyProvider;
  restEndpoint?: string;
}

export interface RestCallOptions {
  method?: string;
  header?: string[];
  body?: unknown;
}

export interface RestCallResult<TJson = unknown> {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  json: TJson | undefined;
}

/** Device data exchanged before pairing. Public keys are serialized strings. */
export interface PairingDeviceData {
  deviceId: DeviceId;
  signPublicKey: string;
  cryptPublicKey: string;
}

export interface AddDeviceMetadata<
  TDeviceMetadata = Record<string, unknown>,
  TAdminMetadata = Record<string, unknown>,
> {
  /** Metadata delivered to the device joining the network. */
  deviceMetadata?: TDeviceMetadata;
  /** Metadata retained for the admin completing the pairing. */
  adminMetadata?: TAdminMetadata;
}

export type PairedHandler<TMetadata = Record<string, unknown>> = (
  deviceId: DeviceId,
  metadata: TMetadata,
) => MaybePromise<void>;

export type PairingTimeoutHandler = (
  deviceId: DeviceId,
) => MaybePromise<void>;

export type SeptEventHandler<TPayload = unknown> = (
  payload: TPayload,
  senderDeviceId: DeviceId,
  timestamp: number,
  eventId: EventId,
  sequence: number,
) => MaybePromise<void>;

export type SystemEventName =
  | "policy.update"
  | "admin.grant"
  | "admin.revoke"
  | "device.add"
  | "device.invalidate";

export type SeptSystemEventName = `sept.${SystemEventName}`;

export type ConnectionEventName =
  | "connection.open"
  | "connection.close"
  | "connection.error"
  | "connection.message";

export type UiEventName =
  | SystemEventName
  | SeptSystemEventName
  | ConnectionEventName;

export type UiEventHandler<TPayload = unknown> = (
  payload: TPayload,
) => MaybePromise<void>;

export type WebSocketStatus =
  | "disconnected"
  | "tickedRequested"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "reconnectingOnError"
  | "closing"
  | "closed"
  | "error";

export interface Policy {
  allowedEventTypes: EventType[];
}

export type DeviceRole = "admin" | "user";

/** Active device as returned by getDevices(). */
export interface Device {
  id: DeviceId;
  networkId: NetworkId;
  signPublicKey: Uint8Array;
  cryptPublicKey: Uint8Array | null;
  role: DeviceRole;
  revokedAt: number | null;
  createdAt: string;
}

export interface AdminDevice {
  deviceId: DeviceId;
  signPublicKey: Uint8Array;
  cryptPublicKey: Uint8Array | null;
}

export interface DeviceGraphEdge {
  id: number;
  srcDeviceId: DeviceId;
  dstDeviceId: DeviceId;
  policy: Policy;
  createdAt: string;
}

export type StoredBoolean = 0 | 1 | boolean;

export interface StoredEvent<TPayload = unknown> {
  id: EventId;
  type: EventType;
  senderDeviceId: DeviceId;
  payloadKey: Uint8Array;
  payload: TPayload;
  timestamp: number;
  deliveredAt: number | null;
  sequence: number | null;
  isSystem: StoredBoolean;
  isOutgoing: StoredBoolean;
  isIncoming: StoredBoolean;
  hasAttachment: StoredBoolean;
  createdAt: string;

  /**
   * Present when EventStore.filter() returns a row produced by the recipient
   * LEFT JOIN. An outgoing event with multiple recipients may currently appear
   * more than once with a different recipientDeviceId.
   */
  recipientDeviceId?: DeviceId | null;
}

export type FilterOperator =
  | "eq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "ne"
  | "in"
  | "notin"
  | "is"
  | "isnot";

/**
 * Store filters accept DB fields, optional `__<operator>` suffixes, and
 * nested `device` / `recipient` filters.
 */
export interface EventFilters {
  [key: string]: unknown;
  device?: Record<string, unknown>;
  recipient?: Record<string, unknown>;
}

export interface GrantAdminMetadata {
  adminMetadata?: Record<string, unknown>;
  devicesMetadata?: Record<string, unknown>;
}

export interface AppStorageEntry<T> {
  key: string;
  value: T;
}

export interface AppStorage<T = unknown> {
  get(key: string): Promise<T | null>;
  set(
    key: string,
    value: T | ((current: T | null) => MaybePromise<T>),
  ): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  all(): Promise<AppStorageEntry<T>[]>;
}

export class SeptClient {
  private constructor(options: SeptClientOptions<unknown>);

  static create<TDatabase = unknown>(
    options: SeptClientOptions<TDatabase>,
  ): Promise<SeptClient>;

  on: <TPayload = unknown>(
    eventName: UiEventName,
    handler: UiEventHandler<TPayload>,
  ) => void;

  startPolling: (time: number) => void;
  stopPolling: () => void;

  callRest: <TJson = unknown>(
    path: string,
    options?: RestCallOptions,
  ) => Promise<RestCallResult<TJson>>;

  bootstrap: () => Promise<NetworkId>;

  sendEvent: <TPayload = unknown>(
    type: EventType,
    payload: TPayload,
    dstDeviceIds: DeviceId[],
  ) => Promise<void>;

  addDevice: <
    TDeviceMetadata = Record<string, unknown>,
    TAdminMetadata = Record<string, unknown>,
  >(
    deviceData: PairingDeviceData,
    metadata?: AddDeviceMetadata<TDeviceMetadata, TAdminMetadata>,
    onPaired?: PairedHandler<TAdminMetadata>,
    onPairingTimeout?: PairingTimeoutHandler,
    pairingTimeout?: number,
  ) => Promise<PairingPin>;

  pairDevice: <TMetadata = Record<string, unknown>>(
    pin: PairingPin,
  ) => Promise<TMetadata>;

  initDevice: () => Promise<PairingDeviceData>;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  getWebsocketStatus: () => WebSocketStatus;

  getNetworkId: () => Promise<NetworkId | null>;
  getDeviceId: () => Promise<DeviceId | null>;
  getDeviceGraph: () => Promise<DeviceGraphEdge[]>;

  register: <TPayload = unknown>(
    eventType: EventType,
    handler: SeptEventHandler<TPayload>,
    serial?: boolean,
  ) => void;

  registerConcurrent: <TPayload = unknown>(
    eventType: EventType,
    handler: SeptEventHandler<TPayload>,
  ) => void;

  getPolicy: (
    srcDeviceId: DeviceId,
    dstDeviceId: DeviceId,
  ) => Promise<Policy | undefined>;

  isAdmin: (deviceId: DeviceId) => Promise<boolean | null>;
  isCurrentDeviceAdmin: () => Promise<boolean>;

  checkPolicy: (
    srcDeviceId: DeviceId,
    dstDeviceId: DeviceId,
    eventType: EventType,
  ) => Promise<boolean>;

  sync: () => Promise<void>;

  getStoredEvents: <TPayload = unknown>(
    filters?: EventFilters,
  ) => Promise<StoredEvent<TPayload>[]>;

  grant: (
    srcDeviceId: DeviceId,
    dstDeviceId: DeviceId,
    eventTypes: EventType[],
    metadata?: Record<string, unknown>,
  ) => Promise<void>;

  revoke: (
    srcDeviceId: DeviceId,
    dstDeviceId: DeviceId,
    eventTypes: EventType[],
    metadata?: Record<string, unknown>,
  ) => Promise<void>;

  grantAdmin: (
    deviceId: DeviceId,
    metadata?: GrantAdminMetadata,
  ) => Promise<void>;

  revokeAdmin: (deviceId: DeviceId) => Promise<void>;

  appStorage: <T = unknown>(namespace: string) => AppStorage<T>;

  resetDevice: () => Promise<void>;
  getDevices: () => Promise<Device[]>;
  invalidateDevice: (deviceId: DeviceId) => Promise<void>;
  getAdmins: () => Promise<AdminDevice[]>;
}
