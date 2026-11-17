export { createId, setIdGenerator } from "./ids";
export { decodeBase64, encodeBase64 } from "./base64";
export { PliError, type PliErrorCode } from "./errors";
export {
  Session,
  type ChangeEvent,
  type ChangeOrigin,
  type Reducer,
  type TransactOptions,
} from "./session";
export {
  StorageClient,
  createAbortHandle,
  dataUriStorage,
  type AbortSignalLike,
  type BlobLike,
  type StorageAdapter,
  type StorageClientOptions,
  type StorageLimits,
  type UploadInfo,
  type UploadOptions,
  type UploadResult,
} from "./storage-client";
export { activeMention, insertMention, mentionText, mentionsIn, splitMentions, type MentionPart, type MentionQuery } from "./mentions";
export { Users, userColor, userInitials, type PliUser, type Role, type UserDirectory } from "./users";
export {
  CommentClient,
  applyCommentChange,
  changeThreadId,
  memoryCommentStore,
  type Comment,
  type CommentAction,
  type CommentChange,
  type CommentClientOptions,
  type CommentStore,
  type PermissionContext,
  type Thread,
} from "./comments";
export {
  CollabRoom,
  broadcastChannelTransport,
  memoryHub,
  socketTransport,
  webSocketTransport,
  type CollabRoomOptions,
  type Envelope,
  type Peer,
  type PresenceState,
  type RoomMessage,
  type RoomStatus,
  type SocketLike,
  type SocketTransportOptions,
  type Transport,
  type WebSocketLike,
} from "./collab";
export {
  SERVER_CLIENT,
  SYNC_KIND,
  isSyncMessage,
  rebaseWith,
  type ClientSync,
  type LogEntry,
  type ServerSync,
  type StoredDocument,
  type SyncMessage,
  type SyncModel,
} from "./sync";
export { memoryDocumentStore, type DocumentStore } from "./document-store";
export { createAuthority, type Authority, type AuthorityOptions } from "./authority";
export { SyncClient, type SyncClientOptions, type SyncStatus } from "./sync-client";
export { attr, child, childrenNamed, elements, parseXml, textOf, type XmlElement } from "./xml";
export { canonicalJson, hashState, hashText } from "./hash";
export {
  applyTextOp,
  applyTextOps,
  applyTextToString,
  mapPosition,
  mapRange,
  normalizeTextRuns,
  runsLength,
  runsText,
  transformText,
  type TextAttrs,
  type TextOp,
  type TextRun,
} from "./text-ops";
export {
  IdleTracker,
  PRESENCE_PALETTE,
  bindActivity,
  peerActivity,
  presenceColors,
  presencePublisher,
  presentUsers,
  throttle,
  type ActivityThresholds,
  type EventSourceLike,
  type IdleTrackerOptions,
  type PresenceActivity,
  type PresenceCursor,
  type PresencePayload,
  type PresencePublisherOptions,
  type PresenceSelection,
  type PresentUser,
} from "./presence";
export { attachSync, trackSocket, type AttachSyncOptions, type AttachedSync } from "./attach-sync";
export { commentsPart, createEditorSession, defaultHash, type EditorCommentsOptions, type EditorSession, type EditorSessionParts } from "./editor-session";
export { EditorRegistry, parseRoom, roomName, type EditorDefinition } from "./editors";
export { ScriptHost, type ScriptCapability, type ScriptContext, type ScriptOptions, type ScriptableSession } from "./scripting";
export { AnchorTracker, textRangeResolver, type AnchorResolver, type AnchorTrackerOptions, type TextRangeAnchor } from "./anchors";
export {
  VersionHistory,
  currentFromStore,
  memoryVersionStorage,
  stateAtVersion,
  versionFromStore,
  versionJson,
  type DiffSummary,
  type NamedVersion,
  type VersionHistoryOptions,
  type VersionStorage,
  type VersionSupport,
} from "./versions";
export {
  ActivityFeed,
  describeActivity,
  memoryActivityStore,
  type ActivityEvent,
  type ActivityFeedOptions,
  type ActivityKind,
  type ActivityStore,
} from "./activity";
export {
  NOBODY,
  ShareClient,
  applyShareChange,
  memorySharingStore,
  type Grant,
  type LinkAccess,
  type ShareAction,
  type ShareChange,
  type ShareClientOptions,
  type ShareSettings,
  type SharingStore,
} from "./sharing";
export { commentStoreInFile, reloadCommentsOnHistory } from "./comments-in-document";
export * from "./fonts/index";
