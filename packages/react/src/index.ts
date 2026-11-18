export { PliEditor, type PaginationConfig, type PliEditorHandle, type PliEditorProps } from "./PliEditor";
export { PliDocument, type PliDocumentProps, type PliDownload } from "./PliDocument";
export { PageCanvas, regionHasContent, type PageCanvasProps, type RegionActions, type RegionEdit, type RegionPlace, type ViewMode } from "./PageCanvas";
export { EditorToolbar, FONT_FAMILIES, type EditorToolbarProps } from "./EditorToolbar";
export { DocumentView, type DocumentViewProps, type FieldValues } from "./render";
export { useDocumentSession, useSelectionState, useSessionRevision } from "./hooks";
export { imageBlockFromFile, imageBlockFromUrl, type ImageOptions } from "./images";
export { downloadFile, printDocument } from "./print";
export { exportPdf, type PdfExport, type PdfExportOptions } from "./pdf";
export { paginate, type BlockMetric, type Geometry, type Layout, type LineInfo, type Split } from "./layout/paginate";

export { MenuBar, type MenuDefinition } from "./ui/MenuBar";
export { extendMenus, type ExtraMenuItems, type ExtraMenus } from "./ui/extensions";
export { FileInput, FilePickerContext, FilePickerProvider, browseFiles, pickWith, useFilePicker, type FileInputProps, type FilePickPurpose, type FilePickRequest, type FilePicker, type PickOptions } from "./ui/file-picker";
export { Bar, barKey, scrollIntoBar, useBarScroll, type BarOverflow, type BarProps } from "./ui/bar";
export { ColorPicker, type ColorPickerProps } from "./ui/ColorPicker";
export { Dialog, Dropdown, MenuList, keepFocus, useDismiss, type DialogProps, type DropdownProps, type MenuEntry, type MenuItem } from "./ui/primitives";
export { ColumnsDialog, ImageDialog, LinkDialog, PageSetupDialog, ParagraphDialog, type ColumnsDialogProps, type ParagraphDialogProps } from "./ui/dialogs";
export { Ruler, type RulerProps } from "./ui/Ruler";
export { ListStartDialog, listMenuItems, type ListMenuOptions, type ListStartDialogProps } from "./ui/lists";
export { RowHeightDialog, TableDialog, TableGrid, tableMenuItems, type RowHeightDialogProps, type TableDialogProps, type TableMenuOptions } from "./ui/tables";
export { FindPanel, OutlinePanel, StatusBar, outlineOf, type OutlineEntry } from "./ui/panels";
export { Avatar, CommentBody, CommentsPanel, Composer, PresenceBar, RemoteCursors, ThreadCard, timeAgo, type CommentsPanelProps } from "./ui/comments";
export { SyncIndicator, type SyncIndicatorProps } from "./ui/SyncIndicator";
export { useSyncStatus, type SyncState } from "./sync";
// The rest of the shared interface (also available without the Documents editor as `@pli.dev/react/collab`).
export {
  ActivityList,
  ActivityToasts,
  AvatarStack,
  CollabIcons,
  CommentThreads,
  OfflineBanner,
  PeerCursor,
  PeerLayer,
  PeerOutline,
  Popover,
  RoleSelect,
  ShareButton,
  ShareDialog,
  ToastProvider,
  VersionHistoryPanel,
  VersionPreviewBar,
  useActivity,
  usePresentUsers,
  useRoomPeers,
  useShareSettings,
  useStore,
  useThreads,
  useToasts,
  useVersions,
  type AvatarStackProps,
  type CommentFilter,
  type CommentThreadsProps,
  type PopoverProps,
  type Rect,
  type ShareDialogProps,
  type ToastSpec,
  type VersionHistoryPanelProps,
  type VersionPreviewBarProps,
} from "./ui/collab/index";
export { Icons } from "./ui/icons";
export { ThemeContext, ThemedDiv, forcedTheme, useThemeAttr, type PliTheme } from "./theme";
export { FontPicker, FontsProvider, useDocumentFonts, useFonts, useFontsVersion, type FontPickerProps } from "./ui/fonts";
