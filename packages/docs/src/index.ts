export type {
  Align,
  Block,
  CellBlock,
  CodeBlock,
  Doc,
  DocAnchor,
  DocStyle,
  StyleMarks,
  Suggestion,
  DividerBlock,
  FormattableBlock,
  HeadingBlock,
  ImageBlock,
  ImageCrop,
  ListItemBlock,
  ListMarker,
  MarkPatch,
  Marks,
  NonTextBlock,
  PageBreakBlock,
  SectionBreakBlock,
  SectionPage,
  Columns,
  PageSetup,
  RegionName,
  PageSize,
  ParagraphBlock,
  ParagraphFormat,
  ParagraphFormatPatch,
  QuoteBlock,
  Run,
  SubtitleBlock,
  TableBlock,
  TableCell,
  TableRow,
  TextBlock,
  TitleBlock,
  TocBlock,
} from "./model";
export { isFormattable, isTextBlock } from "./model";

export { resolveSuggestionOps, stripSuggestions, suggestionIds, suggestionsIn, suggestDelete, suggestInsert, type Suggester, type SuggestionInfo } from "./suggestions";
export { STYLE_MARK_KEYS, effectiveMarks, newStyleId, resolveStyle, styleList, styleOfBlock, stylesUsed, withParagraphStyle, type ResolvedStyle } from "./styles";
export { BULLET_MARKERS, MAX_LIST_START, NUMBER_MARKERS, defaultMarker, listLabels, listNumbers, markerOf, numberText, type ListLabel } from "./lists";
export { DEFAULT_PAGE, PAGE_SIZES, PX_PER_INCH, pageDimensions, pageSetupOf } from "./page";

export { docReducer, type BlockPatch, type DocOp } from "./ops";
export { canonicalOps, diffBlock } from "./canonical";
export { rebase, transformOps, transformPair } from "./transform";
export { docSyncModel, hashDoc } from "./sync";
export { documentEditorSession } from "./editor-session";
export { docVersionSupport, documentVersionHistory, restoreDocOps, summarizeDocDiff, type DocumentVersionHistoryOptions } from "./versions";
export { marksSegments, restoreMarks, type MarkSegment } from "./runs";
export { DocumentSession, emptyDoc, type DocumentSessionOptions, type UploadOutcome, type UploadState } from "./session";
export { normalizeRuns, plainText, textLength } from "./runs";

export * as commands from "./commands";
export type { BlockSpec, Command, CommandResult, ToggleMarkKey } from "./commands";
export {
  blockLength,
  caret,
  clampSelection,
  comparePoints,
  isCollapsed,
  mapSelection,
  selectAll,
  cellRect,
  cellsInRect,
  coveredBlocks,
  selectedBlocks,
  selectionRange,
  type CellRect,
  type Point,
  type Selection,
} from "./selection";

export { parseDoc, serializeDoc, validateDoc } from "./serialize";
export { createTable, normalizeColumns } from "./tables";
export { flattenBlocks, locate } from "./tree";
export {
  activeAlign,
  activeBlockSpec,
  activeMarks,
  markValue,
  selectionState,
  type MarkKey,
  type ListState,
  type TableState,
  type MarkValue,
  type SelectionState,
} from "./queries";
export { selectionToPlainText, sliceSelection } from "./clipboard";
export {
  documentStats,
  findAll,
  matchSelection,
  replaceMatches,
  type DocumentStats,
  type FindOptions,
  type Match,
} from "./find";

export {
  bold,
  code,
  codeBlock,
  createDoc,
  divider,
  heading,
  image,
  italic,
  link,
  listItem,
  pageBreak,
  sectionBreak,
  paragraph,
  quote,
  spaced,
  subtitle,
  table,
  text,
  title,
  toc,
  type Inline,
} from "./build";

export { usedFonts } from "./fonts";
export { generateDocument, pathLabel, type Answers, type GenerateOptions, type GenerateResult, type TemplateIssue } from "./template/generate";
export { describePlaceholder, placeholderSnippet, placeholdersIn, type Placeholder, type PlaceholderNames, type PlaceholderKind, type PlaceholderSnippet } from "./template/placeholders";
export { templateFields, type FieldType, type FieldUse, type TemplateAnalysis, type TemplateField } from "./template/fields";
export { TemplateError, type FilterContext, type TemplateFilter } from "./template/expression";
export { BUILT_IN_FILTERS } from "./template/filters";
export { toDocx, type DocxOptions } from "./export/docx";
export { toPdf, type PdfClip, type PdfFont, type PdfGradient, type PdfImage, type PdfItem, type PdfLink, type PdfOpacity, type PdfOptions, type PdfPage, type PdfPathCommand, type PdfRotation } from "./export/pdf";
export { parseTrueType, type TrueTypeFont } from "./export/truetype";
export { fromDocx, type DocxImportOptions, type DocxImportResult } from "./import/docx";
export { fromMarkdown, inlineMarkdown, type MarkdownImportOptions } from "./import/markdown";
export { headingAnchor, toHtml, type HtmlOptions } from "./export/html";
export { htmlToFragment, type Fragment, type ImportOptions } from "./html/import";
export { rtfToBlocks } from "./rtf/import";
export { toMarkdown } from "./export/markdown";
export {
  FRAGMENT_MIME,
  cloneBlocks,
  fragmentToJson,
  parseFragment,
  parseFragmentJson,
  parseTabSeparated,
  readPaste,
  type PasteContent,
  type PasteInput,
} from "./paste";
export type { PasteResult } from "./session";
export { embedImages, imagesIn, resolveImages, withImageSources, type FileFailure, type PreparedDoc } from "./files";

// Storage and errors come from the core package; they are repeated here so an app needs only this one import.
export {
  PliError,
  StorageClient,
  setIdGenerator,
  createAbortHandle,
  dataUriStorage,
  type AbortSignalLike,
  type BlobLike,
  type PliErrorCode,
  type StorageAdapter,
  type StorageClientOptions,
  type StorageLimits,
  type UploadInfo,
  type UploadResult,
  // Users, comments and live rooms are shared by every editor.
  CollabRoom,
  SyncClient,
  createAuthority,
  isSyncMessage,
  memoryDocumentStore,
  CommentClient,
  Users,
  VersionHistory,
  memoryVersionStorage,
  applyCommentChange,
  commentNotices,
  broadcastChannelTransport,
  memoryCommentStore,
  memoryHub,
  socketTransport,
  userColor,
  activeMention,
  insertMention,
  mentionText,
  mentionsIn,
  splitMentions,
  type MentionPart,
  type MentionQuery,
  userInitials,
  webSocketTransport,
  type Comment,
  type CommentAction,
  type CommentChange,
  type CommentClientOptions,
  type CommentNotice,
  type CommentNoticeType,
  type CommentStore,
  type AutoSaveOptions,
  type NamedVersion,
  type VersionStorage,
  type NoticeReason,
  type UserSearchContext,
  type Authority,
  type AuthorityOptions,
  type DocumentStore,
  type LogEntry,
  type Peer,
  type PliUser,
  type PresenceState,
  type Role,
  type SocketLike,
  type StoredDocument,
  type SyncModel,
  type SyncStatus,
  type Thread,
  type Transport,
  type UserDirectory,
  type WebSocketLike,
} from "@pli.dev/core";
export {
  addCommentToRuns,
  anchorFor,
  commentIdsIn,
  commentOrder,
  commentRanges,
  commentsAt,
  documentCommentStore,
  reanchorOps,
  removeCommentFromRuns,
  stripComments,
} from "./comments";
export type { DocumentCommentsOptions } from "./session";
export {
  REGION_NAMES,
  activeRegionNames,
  regionBlocksFor,
  regionKeyFor,
  regionKind,
  regionLabel,
  regionName,
  regionVariant,
  type RegionVariant,
} from "./regions";
export {
  FOOTNOTE_CHAR,
  cleanNoteBlocks,
  copyFootnotes,
  footnoteIds,
  footnoteNumbers,
  isNoteBlock,
  isNoteName,
  noteIdOf,
  noteName,
  type NoteName,
  pruneFootnotes,
  stripFootnoteRefs,
  type Footnotes,
} from "./footnotes";
export {
  DEFAULT_COLUMN_GAP,
  MAX_COLUMNS,
  columnRuns,
  columnSetup,
  columnsAt,
  columnsValue,
  hasFirstPageRegions,
  isRegionLinked,
  resolveRegion,
  sameShape,
  sectionShape,
  startsOnNewPage,
  sectionAt,
  sectionIndexAt,
  sectionsOf,
  type ColumnRun,
  type ColumnSetup,
  type ResolvedRegion,
  type SectionShape,
  type Section,
} from "./sections";
