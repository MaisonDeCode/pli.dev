/**
 * The interface shared by every Pli editor: people and presence, comments, sharing, version history, sync status and
 * notifications. It imports `@pli.dev/core` and React only, never the Documents editor, so Sheets, Decks, PDF and the editors
 * to come can use it (as `@pli.dev/react/collab`) without pulling the Documents engine into their bundle.
 */
export { Avatar, AvatarStack, PresenceBar, type AvatarStackProps } from "./people";
export { PeerCursor, PeerLayer, PeerOutline, type Rect } from "./presence";
export { CommentBody, CommentThreads, Composer, ThreadCard, timeAgo, type CommentFilter, type CommentThreadsProps } from "./threads";
export { RoleSelect, ShareButton, ShareDialog, type ShareDialogProps } from "./share";
export { ActivityList, VersionHistoryPanel, type VersionHistoryPanelProps } from "./versions";
export { OfflineBanner, SyncIndicator, useSyncStatus, type SyncIndicatorProps, type SyncState } from "./status";
export { ActivityToasts, ToastProvider, useToasts, type ToastSpec } from "./toasts";
export { Popover, type PopoverProps } from "./popover";
export { useActivity, useRoomPeers, usePresentUsers, useShareSettings, useStore, useThreads, useVersions } from "./hooks";
export { CollabIcons } from "./icons";
// The primitives these are built from, so an editor can use one import for the shared interface.
export { Dialog, Dropdown, MenuList, keepFocus, useDismiss, type DialogProps, type DropdownProps, type MenuEntry, type MenuItem } from "../primitives";
