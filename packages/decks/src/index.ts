export * from "./model";
export * from "./animation";
export { adjust, contrastOn, hslToRgb, parseHex, resolveColor, resolveHex, rgbToHsl, rgbaCss, slotHex, toHex, type Rgba } from "./color";
export * from "./text";
export { deckReducer, elementIds, findLayout, layoutOf, type DeckOp, type LayoutPatch, type MasterPatch, type SlidePatch } from "./ops";
export {
  cssColor,
  radialExtent,
  matchPlaceholder,
  numberLabel,
  placeholderFamily,
  resolveFill,
  resolveLine,
  resolveSlide,
  resolveTemplate,
  resolveText,
  styleKindOf,
  type ResolvedBullet,
  type ResolvedCell,
  type ResolvedElement,
  type ResolvedFill,
  type ResolvedLine,
  type ResolvedParagraph,
  type ResolvedRun,
  type ResolvedShadow,
  type ResolvedTable,
  type ResolvedText,
  type Scene,
  type SceneContext,
} from "./resolve";
export { LEVEL_PROMPTS, LIGHT_THEME, MASTER_TITLE_PROMPT, buildMaster, createDeck, levelPromptParagraphs, newId, withLevelPrompts, paragraphs, placeholder, shape, slideFromLayout, type CreateDeckOptions, type MasterSpec } from "./build";
export { DeckSession, cloneSlide, boundsOf, tableCellOrigin, withNewIds, allElementIds, type AlignTo, type Arrange, type Box, type DeckChangeEvent, type DeckSelection, type DeckSessionOptions, type ElementClip, type FindHit } from "./session";
export { parseDeck, serializeDeck, validateDeck } from "./serialize";
export { PRESET_GEOMETRIES, PRESET_GROUPS, hasPreset, presetAdjustDefaults, presetPath, presetPdfPath, presetTextRect, type PresetGroup, type PresetPath, type PresetPdfPath, type PresetShade } from "./presets";
export { fromPptx, type PptxImport, type PptxImportOptions } from "./pptx/read";
export { importTemplate, scaleMaster, withFreshIds, type TemplateImport } from "./pptx/template";
export { BUILTIN_THEMES, builtinTheme, type BuiltinTheme } from "./themes";
export { toPptx, toPotx, type PptxOptions } from "./pptx/write";
export { usedFonts } from "./fonts";
export { defaultMeasure, fontFaces, fontMeasurer, fontWidthFactor, layoutText, type FontFaces, type LaidBullet, type LaidLine, type LaidSegment, type TextLayout, type TextMeasurer } from "./textlayout";
export { deckToPdf, toPdf, type DeckPdfOptions, type DeckPdfResult } from "./pdf";
export { customIsOpen, customPath, customPdfPath, customTextRect, guideResolver, unresolvedGuides } from "./custgeom";
export { CHART_TYPE_LABELS, sampleChartData } from "./charts";
export { chartScene, circlePath, defaultSeriesColor, formatNumber, generalNumber, niceScale, pathData, sectorPath, smoothPathCmds, stackValues, type ChartItem, type ChartPaint, type ChartScene, type ChartStroke, type PathCmd, type Scale } from "./chartscene";
export { deckSyncModel, hashDeck, mapDeckPresence, mapDeckSelection, transformDeckOps, type DeckPresence } from "./sync";
export { deckEditorSession } from "./editor-session";
export { normalizeOps } from "./normalize";
export { elementsOfOwner, findElementDeep, type PathStep, type PathTarget } from "./ops";
export { applyDelta, canonicalJson, diffDocs, docToParagraphs, invertDelta, mapIndex, paragraphsToDoc, transformDelta, type Delta, type DeltaOp } from "./delta";
export { CommentCommands, commentIdsIn, documentCommentStore, flatOffset, markCommentedText, markParagraphs, stripCommentMarks, textPosition, type AnchorState, type DeckCommentsOptions } from "./comments";
export { type CommentsMode } from "./pptx/comments";
export { imageSources, inlineImages, loadDeck, loadTemplate, missingFonts, replaceImageSources, resolveImages, saveDeck, storageFontSource, storeFont, storeImages, storeTemplate, type FileFailure, type PreparedDeck, type StoredFont } from "./storage";
