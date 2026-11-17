export { PliPdf, type PliPdfHandle, type PliPdfProps } from "./PliPdf";
export { PageView, TextLayer, textWidth, type PageHighlight, type PageViewProps } from "./PageView";
export { Thumbnails, thumbSize, THUMB_HEIGHT, THUMB_WIDTH, type ThumbnailsProps } from "./Thumbnails";
export { Outline, outlineFromDoc, outlineFromRendered, type OutlineNode, type OutlineProps } from "./Outline";
export { PdfToolbar, VIEW_MODES, type PdfToolbarProps } from "./Toolbar";
export { PdfStatusBar, PageNumberBox, ZoomDropdown, zoomEntries, type PdfStatusBarProps, type PageNumberBoxProps } from "./StatusBar";
export { CommandButton, MENU_NAMES, commandItem, commandTitle, flattenMenu, menuGroups, mergeMenus, weaveMenus, type PdfCommand, type PdfCommands, type PdfMenuName, type PdfMenus } from "./commands";
export { LAYOUTS, LiveMenuBar, TitleBar, buildCommands, buildMenus, type ChromeDeps, type PdfTheme } from "./chrome";
export { PropertiesDialog, ShortcutsDialog, WordCountDialog, describeSize } from "./HelpDialogs";
export { ReplaceDialog, ReplaceRow, skippedText, useReplace, type ReplaceState } from "./replace";
export { FormatBar, formatMenu } from "./FormatBar";
export { annotCommands, annotMenus, toolCommand } from "./annotMenus";
export { FindBar, findStatus, useFind, type FindBarProps, type FindState } from "./find";
export { usePdfView, PdfViewContextValue, type PageContext, type PagePointerEvent, type PdfPanel, type PdfTool, type PdfViewContext } from "./extensions";

export type { OpenOptions, PdfRenderer, RenderedDocument, RenderedOutlineItem, RenderedPage, RenderOptions, TextRun } from "./renderer";
export { abortError, isAbort, runBounds, runSlice } from "./renderer";
export { PageSources, SourceMissing, blankPage, type PageLease, type PageSourcesOptions } from "./engine";
export { RenderQueue, type QueueJob } from "./renderQueue";

export { searchDocument, findInRuns, pageText, normalize, type SearchHit, type SearchOptions, type SearchRequest } from "./search";
export {
  CSS_UNITS,
  MAX_CANVAS_PIXELS,
  MAX_ZOOM,
  MIN_ZOOM,
  TEXT_LAYER_CLASS,
  ZOOM_MENU,
  ZOOM_STEPS,
  canvasScale,
  clampZoom,
  fitZoom,
  layerTransform,
  mergeLines,
  normRotation,
  pageToScreen,
  pageToTurned,
  rectToScreen,
  screenToPage,
  screenToPageRect,
  selectionRects,
  stepZoom,
  textLayerRuns,
  turnedSize,
  turnedToPage,
  type PageFrame,
  type Rot,
  type SelectedText,
  type Zoom,
} from "./geometry";
export { PAGE_GAP, PAGE_PAD, boxesBetween, currentFromScroll, layoutPages, rowOf, rowRanges, zoomToScale, type LayoutOptions, type LayoutPage, type PageBox, type PdfLayout, type Row, type ViewMode } from "./layout";
export { getPageSelection, setPageSelection, setSelection, useElementBox, usePageSelection, useSessionEffect, useSessionRevision } from "./hooks";
export { PdfIcons } from "./icons";
export { ShellState, shellOf, sizeOf, clampSidebar, sidebarMax, NARROW_WIDTH, PHONE_WIDTH, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, type ShellSize } from "./shell";
export { SidebarResizer, type SidebarResizerProps } from "./Resizer";

// ---- annotation tools (stage 2) ----
export { AnnotatedPdf, useAnnotationKit, type AnnotatedPdfProps, type AnnotationKit, type AnnotationKitOptions } from "./useAnnotations";
export { AnnotController, ALL_TOOLS, describeType, presenceFromPeers, type AnnotControllerOptions, type Draft, type Placing, type Popover as AnnotPopover, type PresenceInfo, type ToolId } from "./annotController";
export { AnnotationLayer, AnnotShape, BlendLayer, draftAnnotation, placedAnnotation, type ShapeProps } from "./AnnotationLayer";
export { createTools, TOOL_INFO, TOOL_KEYS, pointsOf } from "./annotTools";
export { handleAnnotKey, shortcutTable, type Shortcut } from "./annotKeys";
export { AnnotRibbon } from "./AnnotRibbon";
export { PropertiesPanel, propertiesKey } from "./PropertiesPanel";
export { AnnotationsTab, CommentsTab, annotLabel } from "./AnnotTabs";
export { ApplyRedactionsDialog, SignatureDialog, StampTextDialog, SIGNATURE_FONTS } from "./AnnotDialogs";
export { CommentPopover, CompactBar, LinkPopover, SelectionBar, cleanUrl } from "./AnnotPopovers";
export { TextEditor } from "./TextEditor";
export { AnnotIcons } from "./annotIcons";
export {
  HANDLES,
  MIN_SIZE,
  NOTE_SIZE,
  annotBounds,
  annotsInRect,
  boundsOfAll,
  canMove,
  canResize,
  centredRect,
  clampRect,
  constrainAngle,
  constrainSquare,
  finishStroke,
  fitInside,
  fitTo,
  geometryBounds,
  hitTest,
  inflate,
  isMarkup,
  moveBy,
  moveVertex,
  normRect,
  rectContains,
  rectFromPoints,
  rectsIntersect,
  resizeBy,
  resizeRect,
  selectionBox,
  simplifyStroke,
  smoothPathData,
  smoothStroke,
  squigglyPathData,
  thinPoints,
  topAnnotAt,
  unionRects,
  vertices,
  type Handle,
  type ResizeOptions,
} from "./annotGeometry";
export { cssFont, dashArray, endShapes, lineEndShape, measurer, noteIconShape, wrapText, NOTE_ICONS, type EndShape } from "./annotSvg";
export { colorOf, fillOf, supports, withColor, withDash, withEnds, withFill, withText, withWidth } from "./annotProps";
export { DEFAULT_STYLES, DASHES, LINE_ENDS, SWATCHES, loadStyles, saveStyles, styleKeyOf, type StyleKey, type ToolStyle } from "./annotStyles";
export { STANDARD_STAMPS, customStamp, dateStamp, stampDate, type StampDef } from "./stamps";
export {
  cleanPicture,
  fileToPicture,
  imageSizeOf,
  loadSignatures,
  normaliseStrokes,
  removeSignature,
  saveSignature,
  scaleStrokes,
  trimBounds,
  whiteToTransparent,
  type SavedSignature,
  type SignatureValue,
} from "./signatures";

// ---- page tools, file menu, organise view, outline editing (stage 3) ----
export { PageTools, describePlan, rangeText, sniffFile, type KeyInfo, type NumberingStyle, type PageDialog, type PageToolsOptions } from "./pageTools";
export { FileActions, printBytes, saveOptionsFor, type ExportRequest, type FileDialog, type FileHooks, type SaveChoice } from "./fileActions";
export { exportPageImages, IMAGE_MIME, type ExportImagesOptions, type PageImage } from "./exportImages";
export { createOutlineEdit, type OutlineEdit, type OutlineHere } from "./outlineEdit";
export { usePageTools, usePageToolsKit, PageToolsProvider, type PageToolsKit, type PageToolsKitOptions } from "./usePageTools";
export { OrganiseGrid, type OrganiseGridProps } from "./OrganiseGrid";
export { PageContextMenu, PageToolbar, Toasts, pageMenuItems } from "./PageMenu";
export { PageDialogs, FileDialogs, formatSize } from "./PdfDialogs";
export { FileMenu, SaveButton, DocumentTitle } from "./FileMenu";
export { Notices, Store, useStore, type Toast } from "./store";
export { crc32, documentName, downloadBytes, downloadFiles, fileStem, makeZip, pickFiles, readZip, safeName, type NamedFile } from "./download";
export { PROPERTIES_KEYS, SIDEBAR_KEYS, claimKey, formShortcutTable, pageShortcutTable, registerShortcuts, shortcutGroups, viewerShortcutTable, MOD as SHORTCUT_MOD } from "./shortcuts";

// ---- forms: fill, Prepare form, data, flatten (stage 4) ----
export { FormsPdf, useFormsKit, type FormsKit, type FormsKitOptions, type FormsPdfProps } from "./useForms";
export { FormController, useFormController, type FormControllerOptions, type FormDialog, type FormDraft, type Notice as FormNotice, type RadioDraft } from "./formController";
export { FormLayer } from "./FormLayer";
export { FieldControl, lookOf, widgetLabel, type ControlProps } from "./FormControls";
export { FormBanner, FormsHost, FormsToolbar, FlattenDialog, formMenuItems, formMenus } from "./FormBanner";
export { FieldProperties } from "./FieldProperties";
export { createFormTools, FORM_TOOL_PREFIX } from "./formTools";
export { FormIcons } from "./formIcons";
export {
  CHECK_STYLES,
  DRAG_PIXELS,
  FIELD_FONTS,
  GRID,
  KINDS as FIELD_KINDS,
  MARKS,
  MIN_FIELD,
  copyName,
  dragRect,
  fieldLabel,
  fontCss,
  fontSizeOf,
  freeName,
  isFillable,
  kindInfo,
  kindOf,
  moveRect,
  optionLabel,
  placeRect,
  readingOrder,
  snap as snapToGrid,
  snapRect,
  tabStops,
  typeLabel,
  type FieldKind,
  type KindInfo,
  type OrderedWidget,
} from "./formsGeometry";

// ---- edit text and pictures ----
export { useContentEditKit, createEditTool, editCommand, editShortcutTable, EditGroup, type ContentEditKit } from "./useEdit";
export { EditController, EDIT_KEY, EDIT_TOOL, styleOfEdit, type ContentEditOptions, type EditStyle, type EditTarget, type Editing, type PendingEdit } from "./editController";
export { EditPreviewLayer, EditToolOverlay, EditDomLayer } from "./EditLayer";
export { EditPanel, EditsTab } from "./EditPanel";
export { EditIcons } from "./editIcons";
export { editorFrame, editorPoint, hitContent, hitImage, hitRun, pageContent, runLength, shrinkScale, type EditImage, type EditRun, type EditorFrame, type PageContent } from "./editGeometry";

/**
 * The full editor: the viewer with page tools, annotation tools and forms, all on. Same as `FormsPdf`; this is the name
 * to use when you want "the PDF editor" and not the pieces.
 */
export { FormsPdf as PdfEditor, type FormsPdfProps as PdfEditorProps } from "./useForms";
