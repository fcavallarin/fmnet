/**
 * Public API for `@sept/client`.
 *
 * The runtime implementation is plain JavaScript. These declarations document
 * the public client surface and its current behavior; methods prefixed with `_`
 * in the implementation are internal and intentionally omitted.
 *
 * @remarks
 * SEPT is pre-1.0. The declarations describe the current API but should not be
 * interpreted as a permanently frozen TypeScript contract.
 */

export type DeviceId = string;
export type NetworkId = string;
export type EventId = string;
export type EventType = string;

/** Short-lived numeric PIN used to redeem a device pairing. */
export type PairingPin = string;

export type MaybePromise<T> = T | PromiseLike<T>;

export type DataStoreType = "better-sqlite" | "expo-sqlite";

/** Data-store adapter used by {@link SeptClient.create}. */
export interface DataStoreOptions<TDatabase = unknown> {
  type: DataStoreType;

  /** Opens and returns the underlying database instance. */
  open: () => MaybePromise<TDatabase>;

  /** Closes the underlying database instance. */
  close?: (db: TDatabase) => MaybePromise<void>;

  /** Requests clearing/resetting the database when supported by the adapter. */
  clearDb?: boolean;
}

/** Returns the secret key material used by the local SEPT client. */
export type SecretKeyProvider = () => MaybePromise<Uint8Array>;

/** Options used to create a {@link SeptClient}. */
export interface SeptClientOptions<TDatabase = unknown> {
  dataStore: DataStoreOptions<TDatabase>;
  secretKeyProvider: SecretKeyProvider;

  /**
   * SEPT relay REST endpoint.
   *
   * @defaultValue `http://localhost:8787`
   */
  restEndpoint?: string;
}

/** Options for {@link SeptClient.callRest}. */
export interface RestCallOptions {
  method?: string;
  header?: string[];
  body?: unknown;
}

/** Result returned by {@link SeptClient.callRest}. */
export interface RestCallResult<TJson = unknown> {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  json: TJson | undefined;
}

/**
 * Device data exchanged before pairing.
 *
 * Public keys are serialized strings suitable for transport.
 */
export interface PairingDeviceData {
  deviceId: DeviceId;
  signPublicKey: string;
  cryptPublicKey: string;
  metadata?: Record<string, unknown>;
}

/** Metadata supplied when an admin initiates device pairing. */
export interface AddDeviceMetadata<
  TDeviceMetadata = Record<string, unknown>,
  TAdminMetadata = Record<string, unknown>,
> {
  /** Metadata delivered to the device joining the network. */
  deviceMetadata?: TDeviceMetadata;

  /** Metadata retained for the admin completing the pairing. */
  adminMetadata?: TAdminMetadata;
}

/** Device information returned when admin-side pairing completes successfully. */
export interface PairedDevice<TMetadata = Record<string, unknown>> {
  deviceId: DeviceId;
  metadata: TMetadata;
}

/**
 * Result returned after pairing has been initiated.
 *
 * `pin` is available immediately after the server accepts the pairing request.
 * `pairing` settles later when the asynchronous pairing flow completes.
 */
export interface AddDeviceResult<TMetadata = Record<string, unknown>> {
  pin: PairingPin;
  pairing: Promise<PairedDevice<TMetadata>>;
}

/** Data passed to application event handlers registered with {@link SeptClient.register}. */
export interface SeptEventHandlerData<TPayload = unknown> {
  payload: TPayload;
  senderDeviceId: DeviceId;
  timestamp: number;
  eventId: EventId;
  sequence: number;
}

/**
 * Application event handler.
 *
 * The handler may return a value. After it settles, SEPT stores the result with
 * the event and marks the event as processed. If it throws or rejects, SEPT
 * stores the error string and marks handler processing as failed.
 */
export type SeptEventHandler<
  TPayload = unknown,
  TResult = unknown,
> = (
  event: SeptEventHandlerData<TPayload>,
) => MaybePromise<TResult>;

/** SEPT system events emitted locally after reserved protocol events are processed. */
export type SystemEventName =
  | "policy.update"
  | "admin.grant"
  | "admin.revoke"
  | "device.add"
  | "device.invalidate";

/** Reserved wire-event form corresponding to {@link SystemEventName}. */
export type SeptSystemEventName = `sept.${SystemEventName}`;

/** Local WebSocket lifecycle/activity events. */
export type ConnectionEventName =
  | "connection.open"
  | "connection.close"
  | "connection.error"
  | "connection.message";

/**
 * Events accepted by {@link SeptClient.on}.
 *
 * Client events are local notifications and are distinct from application events
 * registered through {@link SeptClient.register}.
 */
export type UiEventName =
  | SystemEventName
  | SeptSystemEventName
  | ConnectionEventName;

export type UiEventHandler<TPayload = unknown> = (
  payload: TPayload,
) => MaybePromise<void>;

/** Public connection states exposed by {@link SeptClient.getConnectionStatus}. */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "disconnecting";

export interface Policy {
  allowedEventTypes: EventType[];
}

export type DeviceRole = "admin" | "user";

/** Active locally known device as returned by {@link SeptClient.getDevices}. */
export interface Device {
  id: DeviceId;
  networkId: NetworkId;
  signPublicKey: Uint8Array;
  cryptPublicKey: Uint8Array | null;
  role: DeviceRole;
  revokedAt: number | null;
  createdAt: string;
}

/** Simplified admin-device record returned by {@link SeptClient.getAdmins}. */
export interface AdminDevice {
  deviceId: DeviceId;
  signPublicKey: Uint8Array;
  cryptPublicKey: Uint8Array | null;
}

/** One directed local authorization edge. */
export interface ACLItem {
  srcDeviceId: DeviceId;
  dstDeviceId: DeviceId;
  policy: Policy;
}

export type StoredBoolean = 0 | 1 | boolean;

/** Locally persisted SEPT event returned by {@link SeptClient.getStoredEvents}. */
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

  /** Time at which handler processing completed, or `null` while pending. */
  processedAt: number | null;

  /** Handler return value, stored error string, or `null`. */
  handlerResult: unknown | null;

  /** Whether handler processing failed. */
  handlerFailed: StoredBoolean;

  createdAt: string;

  /**
   * Present when the event store returns a row produced by the recipient LEFT JOIN.
   *
   * @remarks
   * An outgoing event with multiple recipients may currently appear more than
   * once with a different `recipientDeviceId`.
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
 * Filters accepted by {@link SeptClient.getStoredEvents}.
 *
 * Store filters accept DB fields, optional `__<operator>` suffixes, and nested
 * `device` / `recipient` filters.
 *
 * @remarks
 * This filtering surface is an SDK/query convenience rather than a SEPT
 * wire-protocol concept and may evolve independently.
 *
 * See `event-filtering.md` for supported fields, operators, relation filters and
 * current limitations.
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

/**
 * Namespaced persistent application storage returned by {@link SeptClient.appStorage}.
 *
 * @remarks
 * Operations are serialized through an async queue, so functional `set()`
 * performs a local read-modify-write in order relative to other operations in
 * the same returned namespace facade.
 */
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

  /**
   * Creates and initializes a SEPT client, database adapter and local stores.
   *
   * @example
   * ```ts
   * const sept = await SeptClient.create({
   *   restEndpoint,
   *   dataStore: {
   *     type: "better-sqlite",
   *     open,
   *     close,
   *     clearDb,
   *   },
   *   secretKeyProvider,
   * })
   * ```
   */
  static create<TDatabase = unknown>(
    options: SeptClientOptions<TDatabase>,
  ): Promise<SeptClient>;

  /**
   * Subscribes to events emitted locally by the SEPT client.
   *
   * Client events are different from application events registered with
   * {@link register}: their names and payloads are defined by SEPT.
   *
   * System events are emitted after the client successfully processes a
   * reserved SEPT protocol event and updates local state.
   *
   * Current system-event payloads:
   * - `policy.update`: `{ policies, metadata }`
   * - `admin.grant`: `{ deviceId, metadata }`
   * - `admin.revoke`: `{ deviceId, metadata }`
   * - `device.add`: `{ id, networkId, signPublicKey, cryptPublicKey, metadata }`
   * - `device.invalidate`: `{ deviceId }`
   *
   * Current connection-event payloads:
   * - `connection.open`: `{}` after the WebSocket opens
   * - `connection.close`: `{}` after the WebSocket closes
   * - `connection.error`: `{}` after a WebSocket error
   * - `connection.message`: raw WebSocket message before normal processing
   *
   * Most applications should not need `connection.message`.
   *
   * Reserved wire-event names corresponding to system events are documented in
   * `protocol.md#system-event-namespace`.
   */
  on: <TPayload = unknown>(
    eventName: UiEventName,
    handler: UiEventHandler<TPayload>,
  ) => void;

  /**
   * Starts periodic synchronization.
   *
   * @param time Polling interval in seconds.
   */
  startPolling: (time: number) => void;

  /** Stops the polling interval started by {@link startPolling}. */
  stopPolling: () => void;

  /**
   * Calls a custom relay endpoint using the SEPT signed-request client.
   *
   * Useful as an escape hatch for application-specific relay plugins, such as
   * push-token registration. Prefer protocol-level methods when they exist.
   *
   * @example
   * ```ts
   * await sept.callRest("register-push-token", {
   *   method: "POST",
   *   body: { token },
   * })
   * ```
   */
  callRest: <TJson = unknown>(
    path: string,
    options?: RestCallOptions,
  ) => Promise<RestCallResult<TJson>>;

  /**
   * Creates a new SEPT network and the first admin/root device.
   *
   * @returns The newly created network ID.
   */
  bootstrap: () => Promise<NetworkId>;

  /**
   * Sends an application event.
   *
   * SEPT checks policy, encrypts, signs and persists the event, then submits it
   * to the relay.
   *
   * @throws If no valid recipients remain or local authorization denies the
   * event for a recipient.
   *
   * @example
   * ```ts
   * await sept.send(
   *   "message.send",
   *   { text: "hello" },
   *   [deviceA, deviceB],
   * )
   * ```
   */
  send: <TPayload = unknown>(
    type: EventType,
    payload: TPayload,
    dstDeviceIds: DeviceId[],
  ) => Promise<void>;

  /**
   * Starts admin-side pairing for a new device.
   *
   * The initial REST request is awaited. Once accepted, this method returns a
   * short-lived PIN together with a `pairing` promise while completion polling
   * continues asynchronously.
   *
   * `metadata.deviceMetadata` is delivered to the device joining the network.
   * `metadata.adminMetadata` is retained for the admin completing the pairing.
   *
   * The returned `pairing` promise resolves with the paired device ID and the
   * admin-side metadata when pairing completes successfully. It rejects if
   * pairing fails, times out, or the asynchronous completion flow throws.
   *
   * Callers may ignore the `pairing` promise when they only need to initiate
   * pairing and display the PIN.
   *
   * @param pairingTimeout Pairing timeout in seconds.
   * @defaultValue `60`
   *
   * @example
   * ```ts
   * const { pin, pairing } = await sept.addDevice(deviceData, {
   *   deviceMetadata: { name: "server" },
   *   adminMetadata: { connection: "office" },
   * })
   *
   * console.log(pin)
   *
   * const { deviceId, metadata } = await pairing
   * ```
   */
  addDevice: <
    TDeviceMetadata = Record<string, unknown>,
    TAdminMetadata = Record<string, unknown>,
  >(
    deviceData: PairingDeviceData,
    metadata?: AddDeviceMetadata<TDeviceMetadata, TAdminMetadata>,
    pairingTimeout?: number,
  ) => Promise<AddDeviceResult<TAdminMetadata>>;

  /**
   * Redeems a pairing PIN on the joining-device side.
   *
   * Decrypts and installs the network/admin bootstrap state.
   *
   * @returns Pairing metadata intended for the joining device.
   */
  pairDevice: <TMetadata = Record<string, unknown>>(
    pin: PairingPin,
  ) => Promise<TMetadata>;

  /**
   * Initializes signing and encryption keys for a device that has not joined a
   * network yet.
   *
   * @returns Transport-safe device ID and serialized public keys.
   */
  initDevice: () => Promise<PairingDeviceData>;

  /**
   * Obtains a relay ticket, opens the WebSocket connection and synchronizes
   * pending events.
   *
   * @remarks
   * This method is bound as a public arrow function and can be passed as a
   * callback without losing `this`.
   */
  connect: () => Promise<void>;

  /** Closes the current WebSocket connection. */
  disconnect: () => Promise<void>;

  /** Returns the current public connection status. */
  getConnectionStatus: () => ConnectionStatus;

  /** Returns the current network ID, or `null` when no network is configured. */
  getNetworkId: () => Promise<NetworkId | null>;

  /** Returns the current local device ID, or `null` when uninitialized. */
  getDeviceId: () => Promise<DeviceId | null>;

  /**
   * Returns the locally stored directed device/policy graph.
   *
   * @example
   * ```ts
   * const graph = await sept.getDeviceGraph()
   * // [{
   * //   srcDeviceId: "dev_...",
   * //   dstDeviceId: "dev_...",
   * //   policy: { allowedEventTypes: ["message"] },
   * // }]
   * ```
   */
  getDeviceGraph: () => Promise<ACLItem[]>;

  /**
   * Registers an application event handler.
   *
   * The handler may return a value. After the handler settles, SEPT stores the
   * result with the event and marks it as processed. If the handler throws or
   * rejects, SEPT stores the error string and marks handler processing as failed.
   *
   * SEPT-reserved system event types cannot be registered through this API.
   *
   * @param serial When `true`, later event processing waits for the handler.
   * Defaults to `true`.
   *
   * @example
   * ```ts
   * sept.register("message.send", async ({
   *   payload,
   *   senderDeviceId,
   *   timestamp,
   *   eventId,
   *   sequence,
   * }) => {
   *   // ...
   * })
   * ```
   */
  register: <TPayload = unknown, TResult = unknown>(
    eventType: EventType,
    handler: SeptEventHandler<TPayload, TResult>,
    serial?: boolean,
  ) => void;

  /**
   * Registers an application handler that runs without blocking later event
   * processing.
   *
   * Equivalent to `register(eventType, handler, false)`.
   *
   * @remarks
   * Use only when the handler is safe to execute concurrently. Concurrent
   * handlers run in the background, so their failures are recorded on the
   * stored event but are not propagated by {@link sync}.
   */
  registerConcurrent: <TPayload = unknown, TResult = unknown>(
    eventType: EventType,
    handler: SeptEventHandler<TPayload, TResult>,
  ) => void;

  /** Returns the local directed policy, if present. */
  getPolicy: (
    srcDeviceId: DeviceId,
    dstDeviceId: DeviceId,
  ) => Promise<Policy | undefined>;

  /**
   * Returns whether a locally known device currently has role `admin`.
   *
   * May return `null` when the device is not locally known.
   */
  isAdmin: (deviceId: DeviceId) => Promise<boolean | null>;

  /** Returns whether the local device is currently an admin. */
  isCurrentDeviceAdmin: () => Promise<boolean>;

  /**
   * Returns whether `srcDeviceId` is locally authorized to send `eventType` to
   * `dstDeviceId`.
   *
   * @remarks
   * Admin devices currently return `true` without requiring an explicit edge
   * capability.
   */
  checkPolicy: (
    srcDeviceId: DeviceId,
    dstDeviceId: DeviceId,
    eventType: EventType,
  ) => Promise<boolean>;

  /**
   * Pulls pending events through REST and feeds them into the normal receive
   * pipeline.
   *
   * When `retry` is `true`, failed requests are retried every two seconds until
   * synchronization succeeds.
   *
   * @param retry Whether failed synchronization should retry indefinitely.
   * @defaultValue `false`
   */
  sync: (retry?: boolean) => Promise<void>;

  /**
   * Queries locally stored events using the current store filtering DSL.
   *
   * Stored events include handler-processing state through `processedAt`,
   * `handlerResult` and `handlerFailed`.
   *
   * @see EventFilters
   */
  getStoredEvents: <TPayload = unknown>(
    filters?: EventFilters,
  ) => Promise<StoredEvent<TPayload>[]>;

  /**
   * Adds event types to a directed policy and distributes a policy update.
   */
  grant: (
    srcDeviceId: DeviceId,
    dstDeviceId: DeviceId,
    eventTypes: EventType[],
    metadata?: Record<string, unknown>,
  ) => Promise<void>;

  /**
   * Removes event types from a directed policy and distributes a policy update.
   */
  revoke: (
    srcDeviceId: DeviceId,
    dstDeviceId: DeviceId,
    eventTypes: EventType[],
    metadata?: Record<string, unknown>,
  ) => Promise<void>;

  /**
   * Promotes a device to admin.
   *
   * Distributes `sept.admin.grant`, updates relay transport/admin state, and
   * sends current device/policy state to the promoted device.
   */
  grantAdmin: (
    deviceId: DeviceId,
    metadata?: GrantAdminMetadata,
  ) => Promise<void>;

  /**
   * Demotes an admin to a normal user.
   *
   * Distributes `sept.admin.revoke` and updates relay state.
   */
  revokeAdmin: (deviceId: DeviceId) => Promise<void>;

  /**
   * Returns namespaced persistent application storage.
   *
   * @example
   * ```ts
   * const store = sept.appStorage("fmnet")
   *
   * await store.set("value", 1)
   * await store.set("value", current => (current ?? 0) + 1)
   *
   * await store.get("value")
   * await store.keys()
   * await store.all()
   * await store.delete("value")
   * ```
   */
  appStorage: <T = unknown>(namespace: string) => AppStorage<T>;

  /** Resets the local SEPT database through the configured datastore adapter. */
  resetDevice: () => Promise<void>;

  /** Returns locally known non-revoked devices. */
  getDevices: () => Promise<Device[]>;

  /**
   * Invalidates a device.
   *
   * Distributes `sept.device.invalidate` to relevant peers/admins, updates relay
   * state and marks the device revoked locally.
   */
  invalidateDevice: (deviceId: DeviceId) => Promise<void>;

  /** Returns a simplified list of locally known admin devices. */
  getAdmins: () => Promise<AdminDevice[]>;
}
