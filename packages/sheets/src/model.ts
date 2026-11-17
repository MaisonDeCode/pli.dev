/**
 * A workbook is plain JSON: no classes, no platform types. Cells are kept sparsely by their A1 address, so an
 * empty sheet costs nothing and a sheet that uses a million rows only pays for the cells it has.
 */

import type { Thread } from "@pli.dev/core";

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

/** The error values a formula can give, as Excel writes them. */
export type ErrorCode = "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A" | "#SPILL!" | "#CALC!";

export type Scalar = number | string | boolean;

/** How a border line is drawn. */
export type BorderStyle = "thin" | "medium" | "thick" | "dashed" | "dotted" | "double" | "hair";

export interface Border {
  style: BorderStyle;
  /** `#rrggbb`; black when missing. */
  color?: string;
}

/** The lines along the four sides of a cell. */
export interface CellBorders {
  top?: Border;
  right?: Border;
  bottom?: Border;
  left?: Border;
  /** A line from the bottom-left corner to the top-right one. */
  diagonalUp?: Border;
  /** A line from the top-left corner to the bottom-right one. */
  diagonalDown?: Border;
}

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** `#rrggbb` */
  color?: string;
  /** Background, `#rrggbb` */
  fill?: string;
  fontFamily?: string;
  /** Points */
  fontSize?: number;
  align?: "left" | "center" | "right";
  vAlign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  /** How far the text is moved in from the left (or right) edge, in steps of about one space and a half (1 to 15). */
  indent?: number;
  /** Lines around the cell. Where two cells meet, each keeps its own side; `SheetSession.setBorders` writes both. */
  border?: CellBorders;
  /**
   * Cells are locked unless this is `false`. Locking does nothing until the sheet is protected, then a locked cell can't be
   * changed. A cell that says nothing takes the lock of its row, then its column, then the sheet (see `Dimension.locked` and
   * `Sheet.unlocked`), so `true` is kept only where the cell sits in an unlocked row, column or sheet.
   */
  locked?: boolean;
  /**
   * Hides the cell's formula from the formula bar while the sheet is protected. Like `locked`, a cell that says nothing takes
   * the setting of its row, then its column, then the sheet (`Dimension.hideFormula`, `Sheet.hiddenFormulas`), so `false` is kept
   * only where the cell sits in a row, column or sheet that hides formulas.
   */
  hideFormula?: boolean;
}

/** One choice in a dropdown, or one thing a badge can stand for. */
export interface ChipOption {
  /** What is stored in the cell. */
  value: string;
  /** What is shown, if not the value itself. */
  label?: string;
  /** The badge's colour, `#rrggbb`. */
  color?: string;
  /** A line of detail, shown in the pick list. */
  description?: string;
  /** A picture to show beside the label, such as a person's photo: an address or a `data:` URI. */
  image?: string;
}

/**
 * What a cell is, besides its value. A `checkbox` shows true or false as a box you can tick (any two values can stand for
 * ticked and not ticked). A `dropdown` shows the value as a badge in the colour of its choice, and offers the choices. A
 * `badge` shows the value as a badge; with a `kind` an app supplies what the value means (a person, a project), so the
 * badge can show a name and a picture. Several choices in one cell are kept as text joined with `, `.
 */
export type CellControl =
  | { type: "checkbox"; checked?: Scalar; unchecked?: Scalar }
  | { type: "dropdown"; options: ChipOption[]; multiple?: boolean; /** What joins several choices in the cell (`, ` when missing). */ separator?: string; strict?: boolean }
  | { type: "badge"; kind?: string; color?: string; multiple?: boolean; /** What joins several choices in the cell (`, ` when missing). */ separator?: string };

/**
 * Where a cell leads when it is clicked: a web address or anything else that opens outside the sheet (`https://pli.dev`,
 * `mailto:ana@example.com`), or, starting with `#`, a place in the workbook (`#Sheet2!B4`, `#B4`, or the name of a range).
 */
export interface CellLink {
  to: string;
  /** Shown when the pointer rests on the cell. */
  tip?: string;
  /** The link has been followed: the cell takes the theme's followed-hyperlink colour (Excel's "Followed Hyperlink" style) instead of the hyperlink colour. */
  followed?: true;
}

/**
 * One cell. A cell holds a value (`v`), an error typed in as a value (`e`), or a formula (`f`, written without the
 * leading `=`), never more than one of them. A cell with none of the three only carries a format or style.
 * What a formula gives isn't saved: it is worked out from the formula whenever the workbook is opened or changed.
 */
export interface Cell {
  v?: Scalar;
  e?: ErrorCode;
  f?: string;
  /** Makes the cell a checkbox, dropdown or badge. */
  control?: CellControl;
  /** A number format such as `0.00`, `#,##0`, `0%`, `yyyy-mm-dd`. Without one the format is General. */
  fmt?: string;
  s?: CellStyle;
  /** Makes the cell a link. Typing new content into the cell takes the link off. */
  link?: CellLink;
  /** A note on the cell (a comment in Excel's older sense): plain text, shown beside the cell when the pointer is on it. */
  note?: string;
  /** The note's look, when parts of it have one: runs of text that add up to `note`. Without them the note is plain. */
  noteRuns?: NoteRun[];
  /** Who wrote the note (the text of the host's choosing; Pli never fills it with anything personal). */
  noteAuthor?: string;
  /** The note's box when it isn't the default one: its size, where it sits, and whether it stays showing. */
  noteBox?: NoteBox;
  /** A picture that is the cell's content ("Place in Cell"): drawn inside the cell, fitted to it, and moving and sizing with it. The cell's value is its description. */
  picture?: CellPicture;
  /**
   * The id of the comment thread (`Thread<CellAnchor>` of `@pli.dev/core`) that is attached to this cell: Excel's threaded comment, as
   * opposed to the classic `note`. Only the id is here, so the thread follows the cell wherever the cell goes (inserted and deleted
   * rows and columns, sorting, moving); the conversation itself is in `Workbook.comments` or in your comment store.
   */
  thread?: string;
}

/**
 * Where a comment thread is attached in a sheet: a cell of a sheet (by the sheet's id, so renaming the sheet changes nothing), and
 * the range it was made on when it covers more than that cell. Pli keeps the thread's real place on the cell (`Cell.thread`);
 * the anchor saved in the thread is where it was last seen, which is what a store, a file and a detached thread show.
 */
export interface CellAnchor {
  /** The id of the sheet. */
  sheet: string;
  /** The cell, such as `B3`: the top left cell of `range` when there is one. */
  cell: string;
  /** The range the thread was made on, such as `B3:C5`, when it is more than one cell. */
  range?: string;
  /** What the cell held when the thread was made, shown to give a detached thread some context. */
  quote?: string;
}

/** A stretch of a note's text with the look it was given. Only what differs from the note's own default (Tahoma 9, no emphasis) is kept. */
export interface NoteRun {
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  /** `#rrggbb`. */
  color?: string;
  /** In points. */
  size?: number;
  font?: string;
  /** Where the run leads (a web address, mail, or `#Sheet!A1`). A Pli-only link: Excel's notes can't hold links, so a file has the text alone. */
  link?: string;
}

/** How the line round a note's box is dashed (VML's `dashstyle`). */
export type NoteDash = "solid" | "dot" | "dash" | "dashDot" | "longDash" | "longDashDot" | "longDashDotDot" | "shortDash" | "shortDot" | "shortDashDot" | "shortDashDotDot";

/**
 * How a note's box sits and what size it is, in pixels. The box is placed from the cell: `dx` and `dy` are the distance of
 * its top left corner from the cell's top right corner (so it moves with the cell), and `show` keeps it on the sheet
 * instead of only when the pointer rests on the cell.
 */
export interface NoteBox {
  width?: number;
  height?: number;
  dx?: number;
  dy?: number;
  show?: true;
  /** The box's fill, `#rrggbb` (Excel's note yellow, `#ffffe1`, when left out). */
  fill?: string;
  /** How much of the fill (or picture) lets the sheet show through, 0 to 100 percent. */
  transparency?: number;
  /** A picture that fills the box instead of the colour (Excel's Fill Effects > Picture): a `data:` URI of a PNG, JPEG or GIF. */
  picture?: string;
  /** The colour of the line round the box (`#rrggbb`), or `"none"` for no line. Left out is Excel's thin black line. */
  line?: string;
  /** The line's weight in points (0.75 when left out). */
  lineWeight?: number;
  /** The line's dashes (solid when left out). */
  dash?: NoteDash;
  /** `false` takes the shadow off the box (Excel's notes have one). */
  shadow?: false;
}

/** A picture placed in a cell: a `data:` URI of a PNG, JPEG or GIF, and what it shows for people who can't see it. */
export interface CellPicture {
  src: string;
  alt?: string;
}

/** The sizes of paper a sheet can be printed on. */
export type PaperSize = "letter" | "legal" | "tabloid" | "executive" | "a3" | "a4" | "a5";

/** The text in the left, middle and right of a header or footer. It may hold Excel's codes: `&P` page, `&N` pages, `&D` date, `&T` time, `&F` file, `&A` sheet, `&B` bold, `&I` italic, `&U` underline, `&S` strikethrough, `&14` size, `&&` for an &. */
export interface HeaderFooterParts {
  left?: string;
  center?: string;
  right?: string;
}

/** The six places a header or footer can be: the usual ones, the first page's and the even pages'. */
export type HeaderFooterSection = "header" | "footer" | "firstHeader" | "firstFooter" | "evenHeader" | "evenFooter";

/** A picture in a header or footer: it sits where the `&G` code is in the text of its part (left, middle or right). */
export interface HeaderFooterPicture {
  /** A `data:` URI of a PNG, JPEG or GIF. */
  src: string;
  /** How big it prints, in points (a point is 1/72 of an inch). */
  width: number;
  height: number;
  /** The part of the picture left out, as fractions of it (0 to 1) from each side. */
  crop?: { left?: number; top?: number; right?: number; bottom?: number };
  /** Printed in shades of grey. */
  grayscale?: true;
  /** What it shows, for people who can't see it. */
  alt?: string;
}

/** The pictures of a sheet's headers and footers, by where each sits. */
export type HeaderFooterPictures = { [K in HeaderFooterSection]?: { left?: HeaderFooterPicture; center?: HeaderFooterPicture; right?: HeaderFooterPicture } };

/**
 * How a sheet prints. Everything is left out when it is what Excel starts with: portrait, letter paper, 100%, the normal
 * margins, down then over, no gridlines or headings, the whole used range.
 */
export interface PageSetup {
  /** Notes: not printed unless this says to print them after the sheet (`"end"`) or over it where they show (`"sheet"`). */
  comments?: "end" | "sheet";
  /** How a cell that holds an error prints: not as it shows, but empty, as `--` or as `#N/A`. */
  errors?: "blank" | "dash" | "na";
  /** Draft quality: no gridlines and none of the graphics (charts, pictures, sparklines) are printed. */
  draft?: true;
  /** The pictures in the header and footer; the `&G` code in a part's text says where. */
  pictures?: HeaderFooterPictures;
  orientation?: "landscape";
  paper?: PaperSize;
  /** Percent, 10 to 400; 100 when missing. Ignored when `fit` is set. */
  scale?: number;
  /** Shrink to this many pages across and down instead (0 for as many as needed); manual page breaks are then ignored. */
  fit?: { wide: number; tall: number };
  /** In inches. */
  margins?: { top?: number; bottom?: number; left?: number; right?: number; header?: number; footer?: number };
  centerHorizontally?: true;
  centerVertically?: true;
  /** Print the cells' gridlines. */
  gridlines?: true;
  /** Print the row numbers and column letters. */
  headings?: true;
  /** Pages go across before they go down. */
  order?: "over";
  /** Black and white: no colours or fills are printed, only black on white. */
  blackAndWhite?: true;
  /** The number of the first page (1 by default). */
  firstPageNumber?: number;
  /** Ranges to print instead of everything, each starting on its own page. */
  printArea?: string[];
  /** Rows and columns repeated on every page, first and last (1-based). */
  titleRows?: [number, number];
  titleCols?: [number, number];
  /** Page breaks you made: a break after this row, or after this column (1-based). */
  rowBreaks?: number[];
  colBreaks?: number[];
  header?: HeaderFooterParts;
  footer?: HeaderFooterParts;
  /** Used on the first page when `differentFirstPage` is set, and on even pages when `differentOddEven` is. */
  firstHeader?: HeaderFooterParts;
  firstFooter?: HeaderFooterParts;
  evenHeader?: HeaderFooterParts;
  evenFooter?: HeaderFooterParts;
  differentFirstPage?: true;
  differentOddEven?: true;
}

/** What people may still do on a protected sheet. Selecting cells is allowed unless taken out; everything else is allowed only when listed. */
export type Permission =
  | "selectLockedCells"
  | "selectUnlockedCells"
  | "formatCells"
  | "formatColumns"
  | "formatRows"
  | "insertColumns"
  | "insertRows"
  | "insertHyperlinks"
  | "deleteColumns"
  | "deleteRows"
  | "sort"
  | "autoFilter"
  | "pivotTables"
  | "objects"
  | "scenarios";

/** What is kept of a password: a salted SHA-512 that Excel checks the same way, or, from an old file, Excel's 16-bit hash. */
export type PasswordHash = { algorithm: "SHA-512"; salt: string; hash: string; spins: number } | { algorithm: "legacy"; hash: string };

/** A sheet that is protected: its locked cells can't be changed, and only what `allow` lists can be done. */
export interface SheetProtection {
  /** The password that takes the protection off; without one anyone can. */
  password?: PasswordHash;
  /** What everyone may do. */
  allow: Permission[];
  /**
   * Roles that may do more than everyone: for a permission, the roles of the session's user who may do it besides what `allow`
   * lists. Kept in the workbook; Excel has no counterpart, so it is written as a Pli extension (see the Protection page).
   */
  roles?: Partial<Record<Permission, string[]>>;
  /** Roles that may change locked cells without anything being unprotected. */
  editLocked?: string[];
}

/**
 * A range that may be edited on a protected sheet (Excel's Allow Edit Ranges). Cells in it can be changed by anyone when it has
 * neither a password nor permissions; otherwise by whoever has the password (given once, remembered for the session) or has one of
 * the roles in `permissions` (a role such as `finance`, or `user:` and a user's id). The ranges count even before the sheet is
 * protected, and are listed in Excel's `protectedRanges`.
 */
export interface EditRange {
  /** Its title; unique on the sheet, ignoring case. */
  name: string;
  /** A1 ranges on the same sheet, such as `B2:B9`. */
  ranges: string[];
  password?: PasswordHash;
  /** Who may edit without the password; left out, anyone who has the password (or anyone, without one). An empty list says nobody does. */
  permissions?: string[];
  /**
   * Who may not edit it without the password even when a role in `permissions` would let them (Excel's Deny): names as in
   * `permissions`. Deny wins over allow.
   */
  denied?: string[];
  /**
   * Excel's `securityDescriptor` for this range, as read from a file (SDDL, such as `O:WDG:WDD:(A;;CC;;;S-1-5-21-1-2-3-1001)`).
   * Kept as it was so that a file saved again says the same; `permissions` and `denied` hold the accounts it names as
   * `sid:S-1-5-21-…` (see `SheetUser.accounts`).
   */
  securityDescriptor?: string;
}

/** A workbook whose structure is protected: sheets can't be added, deleted, renamed, moved or hidden. */
export interface WorkbookProtection {
  structure: true;
  password?: PasswordHash;
  /** Roles that may change the structure all the same. */
  roles?: string[];
}

export interface Dimension {
  /** Column width in characters or row height in points. */
  size?: number;
  hidden?: boolean;
  /** How deep in groups this row or column is, 1 to 7 (a row of no group has none). */
  level?: number;
  /** On the row or column that sums a group (just below or right of it unless the sheet says otherwise): the group is collapsed. */
  collapsed?: true;
  /**
   * The lock that cells in this row or column take when they say nothing (Excel's whole-column and whole-row Locked). A row
   * wins over a column, a column over the sheet. `false` is kept always, `true` only where it overrules something unlocked.
   */
  locked?: boolean;
  /**
   * Whether formulas of cells in this row or column are hidden on a protected sheet when they say nothing (Excel's whole-column
   * and whole-row Hidden). A row wins over a column, a column over the sheet.
   */
  hideFormula?: boolean;
}

/** Where a group's summary row or column sits: below and to the right of it, as Excel starts, unless taken out. */
export interface OutlineSettings {
  summaryAbove?: true;
  summaryLeft?: true;
}

/**
 * A filter on a table of cells: the first row of `range` holds the headings, and the rows below it that don't match are
 * hidden (they are hidden rows like any other, so the file keeps them hidden). `columns` says, for the columns that are
 * filtered (by letters), which values are let through, as the cells show them (an empty cell is `""`).
 */
export interface SheetFilter {
  range: string;
  columns?: Record<string, FilterCriterion>;
}

/**
 * A filter view: a filter (and optionally a sort) saved under a name, so people can switch between ways of looking at a
 * sheet. It has the shape of `SheetFilter`, plus the name, and the column the data is sorted by (letters) when the view
 * is made the sheet's own.
 */
export interface FilterView {
  id: string;
  /** Unique on the sheet, without regard to capitals. */
  name: string;
  /** The range of the sheet's own filter the view holds; left out when the view holds only table filters. */
  range?: string;
  columns?: Record<string, FilterCriterion>;
  sort?: { column: string; descending?: true };
  /**
   * What the view makes of the tables on the sheet, by table id. When it is there it says it all: a table with no entry is
   * not filtered in the view, whatever the table's own filters are. Without it the tables keep their own filters while the
   * view shows (views saved before tables were part of them). Only filters and sorts are kept, never a table's cells.
   */
  tables?: Record<string, FilterViewTable>;
}

/** What a filter view holds for one table: the filters on its columns (by column name) and the column its rows are sorted by. */
export interface FilterViewTable {
  filters?: Record<string, FilterCriterion>;
  sort?: { column: string; descending?: true };
}

/** What one comparison in a filter does with a cell. The text ones ignore capitals; `equals` and `notEquals` understand `*` and `?` as Excel does (`~` takes one away). */
export type FilterTestOp =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "contains"
  | "notContains"
  | "beginsWith"
  | "notBeginsWith"
  | "endsWith"
  | "notEndsWith"
  | "blank"
  | "notBlank";

export interface FilterTest {
  op: FilterTestOp;
  /** What the cell is compared with: text, a number, or text that reads as a date or time. Not used by `blank` and `notBlank`. */
  value?: string | number;
}

/** The periods a date filter can name, counted from today (weeks start on Sunday), and the quarters and months of any year. */
export type FilterDatePeriod =
  | "today"
  | "yesterday"
  | "tomorrow"
  | "thisWeek"
  | "lastWeek"
  | "nextWeek"
  | "thisMonth"
  | "lastMonth"
  | "nextMonth"
  | "thisQuarter"
  | "lastQuarter"
  | "nextQuarter"
  | "thisYear"
  | "lastYear"
  | "nextYear"
  | "yearToDate"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "m1"
  | "m2"
  | "m3"
  | "m4"
  | "m5"
  | "m6"
  | "m7"
  | "m8"
  | "m9"
  | "m10"
  | "m11"
  | "m12";

/** How finely a picked date is told apart: the whole year, a month of it, a day, or an hour, minute or second of a day. */
export type DateGroupLevel = "year" | "month" | "day" | "hour" | "minute" | "second";

/**
 * One pick from Excel's tree of dates: the year, month, day, hour, minute or second that `by` names, with the parts above it
 * (a month needs its `year`, a day its `year` and `month`…). The parts below `by` are not kept.
 */
export interface DateGroup {
  by: DateGroupLevel;
  year: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/** A filter on a column that is a rule, not a list of values. */
export type FilterRule =
  /** One comparison, or two joined by and (the default) or or. */
  | { kind: "custom"; a: FilterTest; b?: FilterTest; or?: true }
  /** The `n` greatest (or least) numbers, or the greatest (least) `n` percent of the rows; ties come along. */
  | { kind: "top"; n: number; bottom?: true; percent?: true }
  /** The numbers above (or below) the average of the column. */
  | { kind: "average"; below?: true }
  /** The dates in a period. */
  | { kind: "date"; period: FilterDatePeriod }
  /** The dates picked in the tree of years, months and days (`groups`), and any other values let through as in a list (`values`, an empty cell being `""`). */
  | { kind: "dateGroups"; groups: DateGroup[]; values?: string[] }
  /** The cells with this fill (`#rrggbb`, or `"none"` for no fill) or this font colour (`"auto"` for the default one), as the cell's own style sets them. Only one of the two. */
  | { kind: "color"; fill?: string; font?: string };

/** What a filtered column lets through: the values it lists (as the cells show them, an empty cell being `""`), or what a rule says. */
export type FilterCriterion = string[] | FilterRule;

/** How a cell is compared in a "cell value" rule. */
export type CellRuleOperator = "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual" | "equal" | "notEqual" | "between" | "notBetween";

export type TextRuleOperator = "contains" | "notContains" | "beginsWith" | "endsWith";

/** Periods a "dates" rule can pick out, counted from today; weeks start on Sunday. */
export type DatePeriod = "yesterday" | "today" | "tomorrow" | "last7Days" | "lastWeek" | "thisWeek" | "nextWeek" | "lastMonth" | "thisMonth" | "nextMonth";

/**
 * What a conditional format can change in a cell: the font, the fill, the lines around it, and how a number shows
 * (`fmt`). Excel changes the font's style and colour in a rule, but not its name or size, so `fontFamily` and `fontSize`
 * are kept and drawn here and written to the file, where Excel leaves them out when it draws.
 */
export type ConditionalStyle = Pick<CellStyle, "bold" | "italic" | "underline" | "strike" | "color" | "fill" | "border" | "fontFamily" | "fontSize" | "align" | "vAlign" | "wrap" | "indent"> & {
  /** A number format such as `0.0%` or `[Red]#,##0`. */
  fmt?: string;
};

/**
 * A point on a colour scale, the ends of a data bar, or a step of an icon set. `min` and `max` are the lowest and highest
 * value in the cells; `num` is a number, `percent` a share of the way from lowest to highest, `percentile` a rank among the
 * values, and `formula` a formula (written without `=`).
 */
export interface CfValue {
  /** `auto` is for the ends of a data bar only (Excel's Automatic): zero, unless the lowest number is below it for the start, and zero, unless the highest is below it for the end. */
  type: "min" | "max" | "num" | "percent" | "percentile" | "formula" | "auto";
  value?: number | string;
}

export type IconSetName =
  | "3Arrows" | "3ArrowsGray" | "3Flags" | "3TrafficLights1" | "3TrafficLights2" | "3Signs" | "3Symbols" | "3Symbols2"
  | "4Arrows" | "4ArrowsGray" | "4RedToBlack" | "4Rating" | "4TrafficLights"
  | "5Arrows" | "5ArrowsGray" | "5Rating" | "5Quarters"
  /** Excel 2010's sets. */
  | "3Stars" | "3Triangles" | "5Boxes";

/** One icon of one set, to use in place of the icon a slot of an icon-set rule would show (`index` 0 is the lowest). */
export interface IconRef {
  set: IconSetName;
  index: number;
}

/** One step of an icon set after the first: values at or above it (above it, with `gte` false) get this icon. */
export interface IconThreshold extends CfValue {
  gte?: false;
}

/**
 * What a rule that belongs to a pivot table follows (Excel's "apply the rule to": all cells showing a value, for some
 * fields). Its `ranges` are kept in step with the pivot table whenever it is drawn again.
 */
export interface RulePivot {
  /** The id of the pivot table, which must be on the same sheet. */
  id: string;
  /** Only the cells showing this value (an index into the pivot table's `values`); all the values' cells when missing. */
  value?: number;
  /** Only the cells at the level of this row field (its items and their subtotals); every row, grand total included, when missing. */
  rows?: string;
  /** The same for a column field. */
  columns?: string;
  /**
   * Only the cells under some items of row or column fields (Excel's rule for selected cells): for each field, the labels of
   * the items it is limited to. A field not named has all its items.
   */
  items?: Record<string, string[]>;
}

interface RuleBase {
  id: string;
  /** Where the rule applies: ranges such as `B2:B20`. */
  ranges: string[];
  /** The rule follows the cells of a pivot table, and `ranges` are worked out from it. */
  pivot?: RulePivot;
  /** When this rule applies, rules after it are skipped. */
  stop?: true;
}

/** A rule that changes how the cell looks (`style`) when its condition holds. */
interface StyleRuleBase extends RuleBase {
  style: ConditionalStyle;
}

/**
 * A conditional format: it changes how cells look depending on what they hold. Rules are kept in order, the first one
 * having the most say. Formulas are written without `=`, and their references are relative to the top-left cell of the
 * rule's first range, as in Excel.
 */
export type ConditionalRule =
  | (StyleRuleBase & { kind: "cell"; op: CellRuleOperator; values: string[] })
  | (StyleRuleBase & { kind: "text"; op: TextRuleOperator; text: string })
  | (StyleRuleBase & { kind: "formula"; formula: string })
  | (StyleRuleBase & { kind: "blanks" | "noBlanks" | "errors" | "noErrors" | "duplicates" | "uniques" })
  | (StyleRuleBase & { kind: "top"; rank: number; percent?: true; bottom?: true })
  | (StyleRuleBase & { kind: "average"; above: boolean; equal?: true; stdDev?: number })
  | (StyleRuleBase & { kind: "dates"; period: DatePeriod })
  /** Fills each cell with a colour between the stops (two or three). */
  | (RuleBase & { kind: "colorScale"; stops: (CfValue & { color: string })[] })
  /**
   * Draws a bar in the cell as long as its value is. `negativeColor` colours the bars of negative numbers, `solid` fills
   * the bar with one colour instead of fading it, `border` outlines it, and `axis` says where the zero line goes:
   * `auto` (where zero falls between the lowest and highest, the default), `middle`, or `none` (every bar grows from the
   * left). `minLength` and `maxLength` are how much of the cell's width the shortest and the longest bar take, in percent
   * (0 and 100 unless said).
   */
  | (RuleBase & { kind: "dataBar"; min: CfValue; max: CfValue; color: string; negativeColor?: string; solid?: true; border?: true; /** The border's colour (the bar's own colour when missing), and that of negative bars (the same as the positive border when missing). */ borderColor?: string; negativeBorderColor?: string; axis?: "middle" | "none"; axisColor?: string; minLength?: number; maxLength?: number; /** Bars grow from the right. */ rtl?: true; hideValue?: true })
  /**
 * Puts an icon in the cell by how its value ranks. `thresholds` has one step for each icon after the first. `custom` picks
 * the icon of each step yourself, from any set (lowest first, `null` for no icon); without it the set's own icons show.
 */
  | (RuleBase & { kind: "iconSet"; set: IconSetName; thresholds: IconThreshold[]; reverse?: true; hideValue?: true; custom?: (IconRef | null)[] });

export type ValidationKind = "whole" | "decimal" | "date" | "time" | "textLength" | "list" | "custom";

/**
 * A rule for what may be typed into cells. `whole`, `decimal`, `date`, `time` and `textLength` compare the entry with
 * `values` using `op`; a `list` takes entries from a range (`source`: a reference or defined name, not typed choices,
 * which a dropdown cell holds); `custom` takes the entry when `formula` is true. Formulas are written without `=`, and
 * their references are relative to the top-left cell of the first range, as in Excel.
 */
export type Validation = {
  id: string;
  /** The cells the rule covers: ranges such as `B2:B20`. */
  ranges: string[];
  /** Entries that are empty are refused (the default is to let them through). */
  noBlank?: true;
  /**
   * What happens to an entry that breaks the rule: `stop` refuses it (the default), `warning` and `information` ask
   * first and let it through if the person says so, `none` lets it through without a word.
   */
  alert?: "stop" | "warning" | "information" | "none";
  errorTitle?: string;
  /** What is said about a refused entry; a plain description of the rule when missing. */
  error?: string;
  promptTitle?: string;
  /** Shown beside the cell while it is selected. */
  prompt?: string;
} & (
  | { kind: "whole" | "decimal" | "date" | "time" | "textLength"; op: CellRuleOperator; values: string[] }
  | {
      kind: "list";
      /** Cells to read the list from (`Lists!$A$1:$A$5`, a defined name), or a range in another workbook (`[Prices.xlsx]Sheet1!$A$1:$A$10`). */
      source: string;
      /** Leaves out the arrow that opens the list in the cell. */
      hideArrow?: true;
      /** The cell may hold several of the list's items, joined with `separator` (", " when missing); each one is checked. */
      multiple?: true;
      separator?: string;
      /** For a source in another workbook: the items as they were when last read, so the list works without the file. */
      snapshot?: ListSnapshot;
    }
  | { kind: "custom"; formula: string }
);

/** The items a list read from another workbook had when they were last read. Blank cells are kept as `""`, so the cells line up. */
export interface ListSnapshot {
  items: string[];
  /** The day it was read (`2026-11-09`), when known. */
  read?: string;
  /** The address of the workbook as the file named it (a path or web address), when the snapshot came from a file. */
  path?: string;
}

/**
 * A table: a block of cells with a header row, named so formulas can refer to its columns (`Sales[Amount]`). The
 * column names are the text of the header cells. It is styled in bands, and grows when something is typed under it.
 */
export interface Table {
  id: string;
  /** Unique among tables and defined names (without regard to capitals): letters, digits, `_` and `.`, starting with a letter or `_`. */
  name: string;
  /** The cells, header row and totals row included, such as `A1:D10`. */
  range: string;
  /** The last row of the range holds totals. */
  totals?: true;
  /**
   * Columns whose cells all hold the same formula, by column name: typing a formula into a column of an empty one fills it,
   * rows added to the table get the formula, and changing it in one cell changes it in all. The formula is written as it
   * reads in the first row of data (without `=`).
   */
  calculated?: Record<string, string>;
  /** An Excel table style name such as `TableStyleMedium2` (that is the default), or `none`. */
  style?: string;
  /** Without `bandedRows: false` every other row is shaded. */
  bandedRows?: false;
  bandedColumns?: true;
  /** Bold first and last columns. */
  firstColumn?: true;
  lastColumn?: true;
  /**
   * `false` for a table with no header row: its range is all data (and totals), and its columns are named by `columns`.
   * There are no filter buttons without a header row.
   */
  headerRow?: false;
  /** The names of the columns of a table with no header row (`Column1`, `Column2`… where this is short). */
  columns?: string[];
  /** `false` hides the filter buttons in the header row. */
  filterButtons?: false;
  /**
   * The filter: for the columns that are filtered (by name), which values are let through, as the cells show them (an
   * empty cell is `""`), or a rule. The rows that don't match are hidden, like any other hidden rows.
   */
  filters?: Record<string, FilterCriterion>;
  /**
   * The sort the data was last given from the header, shown by an arrow on the filter button of its first column. The first
   * level is here; `then` holds the levels after it (see `SortLevel`).
   */
  sort?: TableSort;
}

/**
 * One level of a sort: a column, and what it orders by. By value (`by` missing) `descending` is Z to A; by `cellColor`,
 * `fontColor` or `icon` the cells with `color` (`#rrggbb`, or `none` for no fill and `auto` for the default font colour) or
 * the `icon` (`null` for cells with no icon) go first, or last with `descending`. Rows a level doesn't tell apart go on to
 * the next level.
 */
export interface SortLevel {
  column: string;
  descending?: true;
  by?: "cellColor" | "fontColor" | "icon";
  color?: string;
  icon?: IconRef | null;
}

/** A table's sort: its first level, and the levels after it in `then`. */
export interface TableSort extends SortLevel {
  then?: SortLevel[];
}

/** The lines of a part of a table style: its edges, and the lines between its cells (`horizontal` between rows, `vertical` between columns). */
export interface TableStyleBorders extends CellBorders {
  horizontal?: Border;
  vertical?: Border;
}

/** The look of a part of a table style: a conditional style whose lines may also run between the part's cells. */
export type TableStylePart = Omit<ConditionalStyle, "border"> & { border?: TableStyleBorders };

/**
 * Colours and lines for the parts of a table of your own style. Each part is drawn over the ones before it in this order:
 * the whole table, the stripes, the first and last column, the header and totals rows, the corner cells.
 */
export interface TableStyleDef {
  wholeTable?: TableStylePart;
  /** The shaded and plain rows of the data, in turn, in runs of `rowStripeSize` rows (1 to 9). */
  firstRowStripe?: TableStylePart;
  secondRowStripe?: TableStylePart;
  rowStripeSize?: number;
  firstColumnStripe?: TableStylePart;
  secondColumnStripe?: TableStylePart;
  columnStripeSize?: number;
  /** Drawn when the table asks for a bold first or last column. */
  firstColumn?: TableStylePart;
  lastColumn?: TableStylePart;
  headerRow?: TableStylePart;
  totalRow?: TableStylePart;
  firstHeaderCell?: TableStylePart;
  lastHeaderCell?: TableStylePart;
  firstTotalCell?: TableStylePart;
  lastTotalCell?: TableStylePart;
}

/**
 * A slicer: a panel of buttons, one for each value in a column of a table, that filters the table. The filter is the
 * table's own (`Table.filters`), so the header buttons and the slicer always agree.
 */
export interface Slicer {
  id: string;
  /** The id of the table it filters (which may be on another sheet). Empty for a pivot table's slicer as the grid draws it (see `pivot`). */
  table: string;
  /** Set only on a pivot table's slicer as the grid draws it: the id of the pivot table. Those live in `Pivot.slicers`, not in `Sheet.slicers`. */
  pivot?: string;
  /** Set only on a pivot table's timeline as the grid draws it: the periods it counts in and the dates it keeps. */
  timeline?: { level: "years" | "quarters" | "months" | "days"; start?: number; end?: number };
  /** The name of the column. */
  column: string;
  /** The heading; the column's name when missing. */
  caption?: string;
  /** The cell the slicer's top-left corner is in (1-based), and how far into that cell. */
  from: { row: number; col: number; dx?: number; dy?: number };
  width: number;
  height: number;
  /** An Excel slicer style name such as `SlicerStyleLight1` (the default). */
  style?: string;
  /** How many columns of buttons (1 by default). */
  columns?: number;
}

/**
 * A slicer style of your own: a look for each part of a slicer, named as Excel names them. `wholeTable` is the slicer itself
 * and `headerRow` its heading; the others are the buttons, by whether the value is let through (selected) and whether any row
 * has it under the table's other filters (with data), and while the pointer is over them (hovered). Each look sets text colour,
 * fill, bold, italic and lines, as a conditional format's style does.
 */
export interface SlicerStyleDef {
  wholeTable?: ConditionalStyle;
  headerRow?: ConditionalStyle;
  unselectedItemWithData?: ConditionalStyle;
  selectedItemWithData?: ConditionalStyle;
  unselectedItemWithNoData?: ConditionalStyle;
  selectedItemWithNoData?: ConditionalStyle;
  hoveredUnselectedItemWithData?: ConditionalStyle;
  hoveredSelectedItemWithData?: ConditionalStyle;
  hoveredUnselectedItemWithNoData?: ConditionalStyle;
  hoveredSelectedItemWithNoData?: ConditionalStyle;
}

/** How coarse the periods of a timeline are. */
export type TimelineLevel = "years" | "quarters" | "months" | "days";

/**
 * A timeline: a strip of periods (years, quarters, months or days) over the dates of one column of a table, in which a range
 * is picked to show only the rows dated inside it. Like a slicer it works through the table's own filter
 * (`Table.filters`): the range picked is the dates the column's filter lets through, so the header buttons and the
 * timeline always agree. Excel has timelines for pivot tables only, so a timeline on a table is kept by Pli alone.
 */
export interface Timeline {
  id: string;
  /** The id of the table it filters (which may be on another sheet). */
  table: string;
  /** The name of a column of dates. */
  column: string;
  /** The heading; the column's name when missing. */
  caption?: string;
  /** The cell the timeline's top-left corner is in (1-based), and how far into that cell. */
  from: { row: number; col: number; dx?: number; dy?: number };
  width: number;
  height: number;
  /** The periods shown. */
  level: TimelineLevel;
  /** An Excel timeline style name such as `TimeSlicerStyleLight1` (the default). */
  style?: string;
}

/**
 * A picture over the grid. It sits where a chart does: in a cell, a little way into it, and a size in pixels, so it stays on
 * its cell when rows or columns are inserted above or to the left. The picture itself is kept in the workbook, as a `data:`
 * URI of a PNG, JPEG or GIF.
 */
export interface SheetImage {
  id: string;
  /** `data:image/png;base64,…` (or `jpeg`, `gif`). */
  src: string;
  /** The cell the picture's top-left corner is in (1-based), and how far into that cell. */
  from: { row: number; col: number; dx?: number; dy?: number };
  width: number;
  height: number;
  /** What the picture shows, for people who can't see it. */
  alt?: string;
  /**
   * How the picture follows its cells when rows and columns change. Left out, it moves with its cell and keeps its size;
   * `size` is "move and size with cells" (it stretches when rows or columns under it do, and `to` says where its
   * bottom right corner is); `free` stays where it is on the sheet whatever happens to the cells.
   */
  placement?: ImagePlacement;
  /** With `placement: "size"`: the cell the bottom right corner is in, and how far into it. */
  to?: { row: number; col: number; dx?: number; dy?: number };
  /** Degrees clockwise, from more than 0 up to less than 360, about the picture's centre. */
  rotation?: number;
  /** Mirrored left to right, or top to bottom (before it is rotated). */
  flipH?: true;
  flipV?: true;
  /** The part of the picture's own size cut off each side, from 0 up to but not including 1 (left and right together, and top and bottom together, stay under 1). `width` and `height` are the size of what is left. */
  crop?: ImageCrop;
  /** A line round the picture. */
  border?: ImageBorder;
  /** A shadow behind the picture. */
  shadow?: ImageShadow;
  /** Brighter (above 0) or darker (below 0), from -1 to 1: Excel's picture corrections. */
  brightness?: number;
  /** More contrast (above 0) or less (below 0), from -1 to 1. */
  contrast?: number;
  /** Drawn in shades of grey. */
  grayscale?: true;
  /** A coloured glow round the picture. */
  glow?: ImageGlow;
  /** The picture's edges fade out over this many pixels (Excel's soft edges). */
  softEdge?: number;
  /** A mirror image below the picture that fades away. */
  reflection?: ImageReflection;
  /** An artistic effect (blur, pencil sketch, mosaic…) applied to the picture's pixels. */
  artistic?: ImageArtistic;
  /** The picture is cropped to this shape (Excel's Crop to Shape); left out it is a rectangle. */
  shape?: ImageShape;
  /**
   * The shape's adjustments (the yellow handles of Excel: a corner radius, an arrow head, a callout's tail, a star's depth), by
   * Office's guide names (`adj`, `adj1`…) in Office's own units. Left out, a shape has its usual proportions; see `SHAPE_ADJUSTMENTS`.
   */
  shapeAdjust?: Record<string, number>;
}

/** The shapes a picture can be cropped to: Office's preset geometries (`a:prstGeom`), see `IMAGE_SHAPES`. */
export type ImageShape =
  | "roundRect" | "round1Rect" | "round2SameRect" | "round2DiagRect" | "snip1Rect" | "snip2SameRect" | "snip2DiagRect" | "snipRoundRect"
  | "ellipse" | "triangle" | "rtTriangle" | "diamond" | "parallelogram" | "trapezoid" | "pentagon" | "hexagon" | "octagon" | "plus" | "teardrop" | "heart"
  | "rightArrow" | "leftArrow" | "upArrow" | "downArrow" | "leftRightArrow" | "chevron" | "homePlate"
  | "star4" | "star5" | "star6" | "star8" | "star10" | "star12"
  | "wedgeRectCallout" | "wedgeRoundRectCallout" | "wedgeEllipseCallout";

/** A glow: `#rrggbb` (a blue by default), how far it reaches in pixels and how solid it is from 0 to 1. */
export interface ImageGlow {
  color?: string;
  radius?: number;
  opacity?: number;
}

/**
 * A reflection under the picture: how soft its edge is in pixels, how solid it is at the picture's edge (`startOpacity`) and
 * where it ends (`endOpacity`), how far below the picture it starts in pixels, and how much of the picture's height it
 * reaches before it has faded to `endOpacity` (`size`, from 0 up to 1).
 */
export interface ImageReflection {
  blur?: number;
  startOpacity?: number;
  endOpacity?: number;
  distance?: number;
  size?: number;
}

/** The artistic effects Pli can draw itself (Excel has more; see the Pictures page). */
export type ArtisticKind =
  | "blur" | "pencilGrayscale" | "pencilSketch" | "mosaic" | "glass" | "paintBrush" | "cutout" | "filmGrain" | "photocopy" | "glowDiffused" | "glowEdges" | "lineDrawing"
  | "marker" | "chalkSketch" | "cement" | "crisscrossEtching" | "lightScreen" | "pastelsSmooth" | "plasticWrap" | "texturizer" | "watercolorSponge" | "paintStrokes";

/** An artistic effect and how strong it is (`level`; each effect has its own range and usual value). */
export interface ImageArtistic {
  kind: ArtisticKind;
  level?: number;
}

/** A line round a picture: `#rrggbb`, a width in points (1 by default) and how it is drawn (solid by default). */
export interface ImageBorder {
  color: string;
  width?: number;
  dash?: "solid" | "dash" | "dot";
}

/** A shadow behind a picture: `#rrggbb` (black by default), how soft its edge is and how far from the picture it falls in pixels, the direction it falls in degrees clockwise from the right (45 is down and to the right), and how solid it is from 0 to 1. */
export interface ImageShadow {
  color?: string;
  blur?: number;
  distance?: number;
  angle?: number;
  opacity?: number;
}

export type ImagePlacement = "move" | "size" | "free";

export interface ImageCrop {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export type SparklineType = "line" | "column" | "winloss";

/** A colour of a sparkline: `#rrggbb`, or a colour of the workbook's theme (`theme` 0 to 11: light 1, dark 1, light 2, dark 2, accents 1 to 6, hyperlink, followed hyperlink) made lighter (`tint` above 0) or darker (below 0) by up to 1. */
export type SparklineColor = string | { theme: number; tint?: number };

/**
 * Small charts that sit in cells. A group shares one look; each of its items is a cell and the cells it draws (a row or a
 * column, written like a chart's references, `Sheet1!$A$2:$E$2`). Colours are `#rrggbb` or theme colours; those left out are Excel's.
 */
export interface SparklineGroup {
  id: string;
  type: SparklineType;
  items: { cell: string; source: string }[];
  /** The line or the bars (default `#376092`). */
  color?: SparklineColor;
  /** The bars below zero (default `#d00000`). */
  negativeColor?: SparklineColor;
  /** The dots on a line (default `#d00000`), and the points picked out by `first`, `last`, `high`, `low` and `negative`. */
  markerColor?: SparklineColor;
  firstColor?: SparklineColor;
  lastColor?: SparklineColor;
  highColor?: SparklineColor;
  lowColor?: SparklineColor;
  /** The line along zero (black by default). */
  axisColor?: SparklineColor;
  /** A dot on every point of a line. */
  markers?: true;
  first?: true;
  last?: true;
  high?: true;
  low?: true;
  /** Picks out the points below zero. */
  negative?: true;
  /** The thickness of a line in points (0.75 by default). */
  lineWeight?: number;
  /** What an empty cell in the data does to the line: leave a gap (the default), count as zero, or be joined across. */
  emptyAs?: "zero" | "span";
  /** Draws data in hidden rows and columns too. */
  showHidden?: true;
  /** Draws from right to left. */
  rightToLeft?: true;
  /** A line along zero. */
  showAxis?: true;
  /** The least and most the vertical axis shows: a number, or `"group"` for the least or most of the whole group (each sparkline's own by default). */
  min?: number | "group";
  max?: number | "group";
  /**
   * A date axis: a row or column of dates (written like a chart's references, `Sheet1!$A$2:$H$2`), one for each point of the
   * data. The points are placed by their dates, so a gap in time shows as a gap in the line (and between the bars).
   */
  dateAxis?: string;
}

export type PivotFunction = "sum" | "count" | "countNums" | "average" | "max" | "min" | "product" | "stdDev" | "stdDevp" | "var" | "varp" | "distinctCount";
export type PivotShowAs =
  | "percentOfTotal"
  | "percentOfRow"
  | "percentOfColumn"
  /** The share of the item's parent on the rows (or the grand total, for the outermost field). */
  | "percentOfParentRow"
  | "percentOfParentColumn"
  /** The difference from the previous item of the innermost column field (or, with no column fields, the innermost row field), as a number or a percent of that item. */
  | "differenceFromPrevious"
  | "percentDifferenceFromPrevious"
  /** Adds up along the innermost column field (or the innermost row field when there are no columns). */
  | "runningTotal"
  /** The place among the items of the innermost field (1 for the least or the greatest). */
  | "rankAscending"
  | "rankDescending"
  /** Excel's index: `(value × grand total) / (row total × column total)`. */
  | "index"
  /** The difference from a chosen item of `base.field` (or its previous or next item), as a number, as a percent of that item, or the share of it. */
  | "differenceFrom"
  | "percentDifferenceFrom"
  | "percentOf"
  /** Adds up along `base.field` as a share of what the whole field comes to (100% at its last item). */
  | "percentRunningTotal";

/**
 * How the items of a date or time field are grouped: by year, quarter, month (January of every year together), day (1 Jan of
 * every year together), or, for times, hour, minute or second (the same hour of every day together). Place the field once for
 * each part to group by several at once (years and months).
 */
export type PivotGroupBy = "years" | "quarters" | "months" | "days" | "hours" | "minutes" | "seconds";

/** Some items of a field gathered under a name of your choosing (East and West under "Coasts"). */
export interface PivotItemGroup {
  name: string;
  /** The items, by the text they show. */
  items: string[];
}

/**
 * Items you pick gathered under names; the items no group takes stay as they are. `name` is the heading of the grouped field
 * (the field's name and a 2 by default). `of` is a group this one groups again: a group inside a group, as when you group the
 * groups Excel made. The items of `groups` then name the items of `of` (its groups, and the items it left alone), and the
 * heading defaults to the field's name and a number one more than `of`'s.
 */
export interface PivotItemsGroup {
  by: "items";
  groups: PivotItemGroup[];
  name?: string;
  of?: PivotItemsGroup;
}

/** The items of a field gathered into groups: dates by a part of the date, or numbers in equal steps. */
export type PivotGroup =
  | { by: PivotGroupBy }
  /** Numbers in ranges `step` wide from `start` (the least number by default) to `end` (the greatest); the ones outside get a group of their own. */
  | { by: "number"; step: number; start?: number; end?: number }
  /** Dates in ranges `days` days long, from `start` (the earliest date by default) to `end` (the latest); dates outside get a group of their own. */
  | { by: "dayRange"; days: number; start?: number; end?: number }
  /** Items you pick gathered under names, perhaps in groups of groups (see `PivotItemsGroup`). */
  | PivotItemsGroup;

/** Leaves out items by what they are called, by what a value comes to for them, or all but the greatest or least. */
export type PivotFieldFilter =
  /** Items whose text passes one test, or two joined by and (the default) or or. */
  | { kind: "label"; a: FilterTest; b?: FilterTest; or?: true }
  /** Items whose total of a value (the number of the value in `values`) passes a test, or two. */
  | { kind: "value"; by: number; a: FilterTest; b?: FilterTest; or?: true }
  /** The `n` items with the greatest (or least) total of a value; or the ones that make up the first `n` percent, or `n` of the sum, of the whole. */
  | { kind: "top"; by: number; n: number; bottom?: true; unit?: "items" | "percent" | "sum" }
  /** Items that are dates inside a period counted from today (or any year's quarter or month), such as this month or last quarter. */
  | { kind: "date"; period: FilterDatePeriod }
  /** Records whose cell in the source has this fill (`#rrggbb`, or `"none"`) or this font colour (`"auto"` for the default one), as the sheet's filter by colour. Only one of the two. */
  | { kind: "color"; fill?: string; font?: string };

/** A field of the source data placed on the rows or the columns of a pivot table. */
export interface PivotAxisField {
  /** The field's name: the text of its header cell in the source. */
  field: string;
  /** Items from the greatest to the least (ascending by default). */
  descending?: true;
  /** Items left out (by the text they show), with the records that have them. */
  hidden?: string[];
  /** `false` leaves out the subtotal of each item of this field (when there is a field after it). */
  subtotal?: false;
  /** Groups the field's items. The same field may be placed more than once if each has a different group. */
  group?: PivotGroup;
  /** Orders the items by a value (the number of the value in `values`) instead of by their own order, within the item they are inside. */
  sortBy?: { value: number; descending?: true };
  filter?: PivotFieldFilter;
  /**
   * More filters on the same field, all of which must pass along with `filter` and the items left out in `hidden` (Excel's
   * "Allow multiple filters per field": a label filter, a value filter and a pick of items together). At most one of
   * the filters is a top or bottom filter, and at most one is by colour or by date.
   */
  filters?: PivotFieldFilter[];
  /** An empty row (or column) after each item of this field, in the outline and tabular layouts. */
  blankRow?: true;
  /** The items in an order you chose (by the text they show); items it doesn't name follow in their usual order. */
  order?: string[];
}

/** A field summed up in the body of a pivot table. */
export interface PivotValue {
  /** A field of the source, or a calculated field of the pivot table. */
  field: string;
  /** How the records are summed up: `sum` unless the field holds text, then `count`. A calculated field is always summed. */
  fn?: PivotFunction;
  /** The heading, `Sum of Sales` by default. */
  name?: string;
  /** A number format for the results. */
  fmt?: string;
  /** Shows each result as a share of the row's, the column's or the whole table's total, or compared with other items. */
  showAs?: PivotShowAs;
  /**
   * What a comparison runs along: the row or column field the items are compared in, and for "differenceFrom", "percentOf" and
   * "percentDifferenceFrom" the item to compare with (by the text it shows, or the `previous` or `next` item). Without it a
   * comparison, running total or rank runs along the innermost column field (the innermost row field when there are no columns).
   */
  base?: PivotBase;
}

export interface PivotBase {
  field: string;
  item?: string | { step: "previous" | "next" };
}

/** A field worked out from others: a formula over the sums of source fields, such as `Sales - Cost` or `'Unit price' * Qty`. */
export interface PivotCalculatedField {
  name: string;
  formula: string;
}

/** An item of a field worked out from others of the same field: `East + West`. The records of the source have no such item. */
export interface PivotCalculatedItem {
  /** The field the item belongs to. */
  field: string;
  /** What the item is called in the table. */
  name: string;
  /** A formula over the other items of the field (by the text they show; quote one with spaces, `'North East'`): numbers, + - * / ^ and brackets. */
  formula: string;
}

/** A range of a pivot table made from several ranges: a table of row labels, column labels and numbers. */
export interface PivotRange {
  /** Where it is, written like a pivot table's `source`. */
  source: string;
  /** What the first page field (Page1) calls the records of this range (Item1, Item2… by default). */
  name?: string;
  /** What the page fields Page1 to Page4 call this range, when the pivot table has `pageFields` of its own; `name` is the first. */
  names?: string[];
}

/** How the cells of a pivot table look: one of Excel's `PivotStyleLight1` to `28`, `PivotStyleMedium1` to `28`, `PivotStyleDark1` to `28`, a style of your own (`Workbook.pivotStyles`), or `none`. */
export interface PivotStyle {
  name: string;
  /** `false` leaves the row headings (the labels down the left) without their own look. */
  rowHeaders?: false;
  /** `false` leaves the column headings without their own look. */
  colHeaders?: false;
  /** Colours every other row (or column) of the body. */
  rowStripes?: true;
  colStripes?: true;
}

/**
 * A pivot table style of your own (`Workbook.pivotStyles`): the look of each part of a table, drawn over the ones before it.
 * The parts are Excel's: the whole table, the column headings (`headerRow`), the row labels (`firstColumn`), the grand total
 * row (`totalRow`) and column (`lastColumn`), stripes, the subtotal rows and columns by level, the row and column
 * sub-headings by level, the blank lines, the corner cells, and the filter area (`pageFieldLabels`, `pageFieldValues`).
 */
export interface PivotStyleDef {
  wholeTable?: TableStylePart;
  headerRow?: TableStylePart;
  totalRow?: TableStylePart;
  firstColumn?: TableStylePart;
  lastColumn?: TableStylePart;
  firstRowStripe?: TableStylePart;
  secondRowStripe?: TableStylePart;
  rowStripeSize?: number;
  firstColumnStripe?: TableStylePart;
  secondColumnStripe?: TableStylePart;
  columnStripeSize?: number;
  firstHeaderCell?: TableStylePart;
  lastHeaderCell?: TableStylePart;
  firstSubtotalColumn?: TableStylePart;
  secondSubtotalColumn?: TableStylePart;
  thirdSubtotalColumn?: TableStylePart;
  firstSubtotalRow?: TableStylePart;
  secondSubtotalRow?: TableStylePart;
  thirdSubtotalRow?: TableStylePart;
  blankRow?: TableStylePart;
  firstColumnSubheading?: TableStylePart;
  secondColumnSubheading?: TableStylePart;
  thirdColumnSubheading?: TableStylePart;
  firstRowSubheading?: TableStylePart;
  secondRowSubheading?: TableStylePart;
  thirdRowSubheading?: TableStylePart;
  pageFieldLabels?: TableStylePart;
  pageFieldValues?: TableStylePart;
}

/**
 * Data a pivot table reads that isn't on a sheet of the workbook: a range of another workbook (`[Prices.xlsx]Sheet1!$A$1:$D$20`),
 * or a named block the host supplies or a CSV file filled (`data:Sales`). The workbook keeps the rows as they were last read, so
 * the pivot table works without the host; a refresh asks the host again.
 */
export interface DataBlock {
  /** How a pivot table's `source` names it: `[Prices.xlsx]Sheet1!$A$1:$D$20` or `data:Sales`. */
  source: string;
  /** The rows, the first of which holds the field names. */
  rows: (Scalar | null)[][];
  /** The number format of each column (`""` for none), such as dates read from a CSV file. */
  formats?: string[];
  /** Where it came from. */
  from?: "csv" | "host" | "book";
  /** The path or address of the file, kept for the host and for XLSX files. */
  path?: string;
  /** The day it was last read, `yyyy-mm-dd`. */
  read?: string;
}

/** A table of the data model: a range, a table or a data block, under a name pivot fields are taken from. */
export interface ModelTable {
  name: string;
  /** A range with the column names in its first row (`Orders!$A$1:$E$40`), a table's name, or a data block (`data:Sales`). */
  source: string;
}

/** A relationship between two tables of the data model: the many side (a column of values that repeat) looks up the one side (a column of unique values). */
export interface ModelRelationship {
  from: { table: string; column: string };
  to: { table: string; column: string };
}

/** A measure of the data model, worked out for each cell of a pivot table. */
export interface ModelMeasure {
  name: string;
  /** The table it belongs to in the field list. */
  table: string;
  /** DAX-style: `SUM(Orders[Amount])`, `DISTINCTCOUNT(Orders[CustomerId])`, `[Total] / COUNTROWS(Orders)`. */
  expression: string;
  /** A number format for the cells. */
  fmt?: string;
}

/** Tables with relationships between them, and measures over them: pivot tables with the source `ThisWorkbookDataModel` read fields from any of the tables. */
export interface DataModel {
  tables: ModelTable[];
  relationships: ModelRelationship[];
  measures: ModelMeasure[];
}

/** A slicer on a field of a pivot table: a panel of buttons, one for each item, that filters it. It stays on the pivot table's sheet. */
export interface PivotSlicer {
  id: string;
  /** The field it filters. */
  field: string;
  caption?: string;
  from: { row: number; col: number; dx?: number; dy?: number };
  width: number;
  height: number;
  style?: string;
  columns?: number;
}

/** A timeline on a date field of a pivot table: a bar of periods to pick a stretch of dates from. It stays on the pivot table's sheet. */
export interface PivotTimeline {
  id: string;
  /** The date field it filters. */
  field: string;
  caption?: string;
  from: { row: number; col: number; dx?: number; dy?: number };
  width: number;
  height: number;
  style?: string;
  /** What the bar counts in (months by default). */
  level?: "years" | "quarters" | "months" | "days";
  /** The dates let through, as serial numbers, both ends included. Left out, every date passes. */
  start?: number;
  end?: number;
}

/**
 * A look you gave cells of a pivot table, kept when the table is drawn again (Excel's "Preserve cell formatting on update").
 * The cells are found by the items they stand for rather than by where they are, so the look follows the cell when the
 * layout changes, even when a field moves from the rows to the columns.
 */
export interface PivotFormat {
  /** The number cells, or the labels (row labels and column headings). */
  part: "data" | "label";
  /**
   * The items the cell stands for: each is a field (its heading, as the table shows it: the group's name for a grouped field)
   * and the item (the text it shows). A number cell stands for its row's items and its column's; the grand total's cells for
   * none. Without it, every cell of the part.
   */
  items?: { field: string; item: string }[];
  /** For `data`: which value (counting from 0). Without it, every value. */
  value?: number;
  /** For `data` without `items`: only the grand total row, or only the grand total column. */
  grand?: "row" | "column";
  /** The look; a field set to `null` takes that part of the table's look off. */
  style?: { [K in keyof CellStyle]?: CellStyle[K] | null };
  /** A number format for the cells (`General` takes the table's off). */
  fmt?: string;
}

/** A field that picks which records are summed up, shown above the table. */
export interface PivotFilter {
  field: string;
  /** The items let through, by the text they show; the others' records are left out. */
  items: string[];
  /** Not shown above the table: a slicer picked these items of a field the table doesn't use. */
  hidden?: true;
}

/**
 * A pivot table: the records of a range summed up by the items of some fields, drawn in cells. The cells are ordinary
 * cells of the sheet (so formulas can read them and files carry them), and the pivot table draws them again whenever
 * it is refreshed or changed. People can't edit them.
 */
export interface Pivot {
  id: string;
  /** Unique among the workbook's pivot tables (without regard to capitals). */
  name: string;
  /** Where the records are: a range with the field names in its first row, written like a chart's reference (`Data!$A$1:$F$200`), or a table's name. */
  source: string;
  /** The top-left cell of the pivot table, the filters above the table included. */
  anchor: string;
  rows: PivotAxisField[];
  columns: PivotAxisField[];
  values: PivotValue[];
  filters?: PivotFilter[];
  /** Fields worked out from others, which `values` can name. */
  calculated?: PivotCalculatedField[];
  /** Items worked out from others of one field, listed with that field's items. */
  calculatedItems?: PivotCalculatedItem[];
  /** Made from several ranges (Excel's multiple consolidation ranges): the fields are `Row`, `Column`, `Value` and `Page1`, with the range's name. `source` is the first. */
  ranges?: PivotRange[];
  /** The look of the cells; the default is a light blue heading. */
  style?: PivotStyle;
  slicers?: PivotSlicer[];
  timelines?: PivotTimeline[];
  /** A column for each row field, instead of one column with the items indented. */
  tabular?: true;
  /** A column for each row field with each outer item's subtotal on its own row, above the items inside it (Excel's outline form). */
  outline?: true;
  /** Writes the outer items again on every row, in the outline and tabular layouts. */
  repeatLabels?: true;
  /** With several values: lists them down the rows (one row for each) instead of across the columns. */
  valuesOnRows?: true;
  /** For a pivot table made from several ranges: how many page fields it has, 0 to 4 (1 by default: Page1, which names the range). */
  pageFields?: number;
  /** Looks you gave cells of the table, drawn again whenever it is. */
  formats?: PivotFormat[];
  /** `false` leaves out the grand total row at the bottom, or the grand total column at the right. */
  grandTotalRows?: false;
  grandTotalColumns?: false;
  /** Draws itself again whenever the cells it reads change (as part of the same undo step as the change). */
  autoRefresh?: true;
  /** The cells it was last drawn in, the filters included. */
  range: string;
}

/**
 * The kinds of chart. The first six are the classic ones; `doughnut`, `radar`, `bubble`, `stock`, `surface`, `pieOfPie` and
 * `barOfPie` are Excel's other classic kinds, and `waterfall`, `histogram`, `pareto`, `funnel`, `boxWhisker`, `treemap` and
 * `sunburst` are Excel 2016's "chartex" kinds, which Excel keeps in a part of their own.
 */
export type ChartType =
  | "column" | "bar" | "line" | "area" | "pie" | "scatter"
  | "doughnut" | "radar" | "bubble" | "stock" | "surface" | "pieOfPie" | "barOfPie"
  | "waterfall" | "histogram" | "pareto" | "funnel" | "boxWhisker" | "treemap" | "sunburst";

/** The kinds a series can have of its own in a combined chart (a chart of columns with a line over it). */
export type ChartSeriesKind = "column" | "line" | "area" | "scatter";

export type TrendlineType = "linear" | "exponential" | "logarithmic" | "polynomial" | "power" | "movingAverage";

/** A line fitted through a series, as Excel's trendlines are. */
export interface Trendline {
  type: TrendlineType;
  /** For `polynomial`: the highest power of x, from 2 to 6 (2 if left out). */
  order?: number;
  /** For `movingAverage`: how many points are averaged, from 2 (2 if left out). */
  period?: number;
  /** How far the line runs on past the last x, and back before the first (in periods; for scatter and bubble charts in x). */
  forward?: number;
  backward?: number;
  /** Forces the line through this y at x = 0 (linear, exponential and polynomial only). */
  intercept?: number;
  /** The name in the legend; the default is Excel's ("Linear (North)"). */
  name?: string;
  /** Shows the equation and the R squared on the chart. */
  equation?: boolean;
  rSquared?: boolean;
  /** `#rrggbb`; the series' colour is used when missing. */
  color?: string;
  /** The label that shows the equation and R squared: its number format, its own text, where it sits and its font. */
  label?: TrendlineLabel;
}

/** The label of a trendline (the equation and the R squared, when they are shown). */
export interface TrendlineLabel {
  /** The number format of the numbers in the equation and the R squared (`0.000`); left out, Excel's General (about five digits). */
  format?: string;
  /** Replaces the equation and the R squared with this text. */
  text?: string;
  /** How far the label has been moved from where it sits by itself, as a fraction of the chart's width and height (dragging the label sets these). */
  x?: number;
  y?: number;
  font?: ChartFont;
}

/** Where a pie-of-pie or bar-of-pie chart moves its smaller values to a second plot: the last `at` points, the points up to `at`, or the points under `at` percent. */
export interface ChartSplit {
  by: "position" | "value" | "percent" | "custom";
  at: number;
  /** For `by: "custom"`: the points (counting from 0) that move to the second plot. */
  points?: number[];
}

/** How a histogram cuts its values into bins (by default Excel's automatic bin width). */
export interface ChartBins {
  by?: "auto" | "width" | "count";
  /** The size of a bin with `by: "width"`, or the number of bins with `by: "count"`. */
  size?: number;
  /** Values above this go into one bin of their own at the end, and values at or below `underflow` go into one at the start. */
  overflow?: number;
  underflow?: number;
  /** Which end of a bin holds its limit (right by default: a bin is `(from, to]`). */
  closed?: "left" | "right";
}

/** What a box-and-whisker chart shows (the options Excel has for series). */
export interface ChartBox {
  /** `exclusive` (the default) works the quartiles out like QUARTILE.EXC, `inclusive` like QUARTILE.INC. */
  quartile?: "inclusive" | "exclusive";
  /** Mean marker (shown by default), a line joining the means of the boxes, every point beside its box, and the outliers (shown by default). */
  meanMarker?: boolean;
  meanLine?: boolean;
  innerPoints?: boolean;
  outliers?: boolean;
}

/** What the mark of a tick looks like on an axis. */
export type ChartTickMark = "none" | "in" | "out" | "cross";

/**
 * How one axis of a chart is scaled and drawn. `x` is the axis the categories run along (the vertical one on a bar chart; the
 * horizontal value axis of a scatter or bubble chart), `y` the value axis, and `x2` and `y2` the second axes of a combined chart.
 * Every field is optional and left out means "as Excel does it by itself".
 */
export interface ChartAxis {
  /** The ends of a value axis (only for value axes: `y`, `y2`, and `x` of a scatter or bubble chart). Left out, the axis fits the data. */
  min?: number;
  max?: number;
  /** The distance between labelled ticks, and between the small ticks and minor gridlines in between. */
  majorUnit?: number;
  minorUnit?: number;
  /** A logarithmic scale with this base (2 to 1000; 10 is the usual). Needs every value above 0. */
  log?: number;
  /** The axis runs from the high end to the low end (the first category at the right, or the top of a column chart's value axis at the bottom). */
  reverse?: boolean;
  /** Where the other axis crosses this one: at its `min` end, its `max` end, or at this value (a category number on a category axis). */
  crosses?: "min" | "max" | number;
  /** Gridlines from the major ticks (value axes have them unless switched off) and from the minor ticks (off unless switched on). */
  majorGridlines?: boolean;
  minorGridlines?: boolean;
  /** The marks beside the axis (`out` for major ticks if left out, none for minor). */
  majorTick?: ChartTickMark;
  minorTick?: ChartTickMark;
  /** Where the labels go: beside the axis (the default), at the low or high end of the plot, or not at all. */
  labels?: "nextTo" | "low" | "high" | "none";
  /** On a category axis: every how many categories a label (`labelEvery`) and a tick mark (`tickEvery`) is drawn; left out, Pli thins the labels to fit. */
  labelEvery?: number;
  tickEvery?: number;
  /** The number format of the labels on a value axis (`0.0%`, `$#,##0`); left out, the numbers are shortened (1.2M). */
  format?: string;
  /** Hides the axis: its line, marks and labels (gridlines stay unless switched off). */
  hidden?: boolean;
  /** The font of the axis' labels (the chart's font if left out). */
  font?: ChartFont;
  /** The font of the axis' title, and the title in pieces (each with a look of its own); the title's text is then the pieces joined and the chart's `xTitle` (`yTitle`, `x2Title`, `y2Title`) is set to it. */
  titleFont?: ChartFont;
  titleRuns?: ChartTitleRun[];
}

/** The axes of a chart that have settings; see `ChartAxis`. */
export interface ChartAxes {
  x?: ChartAxis;
  y?: ChartAxis;
  x2?: ChartAxis;
  y2?: ChartAxis;
}

export type ErrorBarKind = "fixed" | "percent" | "stdDev" | "stdErr" | "custom";

/** The error bars of a series in one direction, as Excel's Format Error Bars pane sets them. */
export interface ErrorBars {
  /** `fixed` is the same amount on every point, `percent` a share of each point's value, `stdDev` a number of standard deviations of the series, `stdErr` the standard error of the series, `custom` the amounts you give. */
  kind: ErrorBarKind;
  /** The fixed amount (1 if left out), the percentage (5), or the number of standard deviations (1). */
  value?: number;
  /** Which sides are drawn: both (the default), only above/right (`plus`), or only below/left (`minus`). */
  direction?: "both" | "plus" | "minus";
  /** `false` leaves the little cross-line off the end of each bar. */
  endCap?: boolean;
  /** For `custom`: a reference to cells with the amount for each point, or the amounts typed in (a single number is used for every point). */
  plus?: string | number[];
  minus?: string | number[];
  /** `#rrggbb`; dark grey (the text colour) if left out. */
  color?: string;
}

/** What a series draws as error bars: along the values (`y`; along the bars of a bar chart) and, in scatter and bubble charts, along x. */
export interface SeriesErrorBars {
  y?: ErrorBars;
  x?: ErrorBars;
}

/** How a stock chart is formatted (Excel's high-low lines and up/down bars). */
export interface ChartStockLook {
  /** `false` leaves out the lines from the high to the low (drawn by default). */
  hiLowLines?: boolean;
  hiLowColor?: string;
  /** `false` leaves out the bodies between open and close even when there is an open. */
  upDownBars?: boolean;
  /** Fills of the bodies where the close is above the open (white by default) and below it (black). */
  upColor?: string;
  downColor?: string;
  /** The gap between bodies, as a percentage of a body's width (0 to 500; 150 if left out). */
  gapWidth?: number;
}

/** A waterfall chart's connector lines. */
export interface ChartWaterfall {
  /** `false` leaves out the lines joining one bar's end to the next bar's start (drawn by default). */
  connectors?: boolean;
  /** The fills of the bars that go up, go down, and are totals (`#rrggbb`; the palette's first three colours if left out). A single bar's `pointColors` wins. */
  increaseColor?: string;
  decreaseColor?: string;
  totalColor?: string;
}

/** Fonts of a chart's text. `size` is in points. */
export interface ChartFont {
  family?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  /** `#rrggbb` */
  color?: string;
}

/** One piece of a chart title with a look of its own, as in a rich-text title. */
export interface ChartTitleRun extends ChartFont {
  text: string;
  underline?: boolean;
}

/** What a data label says (the value when left out). */
export type ChartLabelPart = "value" | "category" | "series" | "percent";

/** One set of values on a chart. Where the values come from is a reference such as `Budget!$C$2:$C$7`, so the chart follows the cells. */
export interface ChartSeries {
  /** In a chart of columns, lines or areas: draws this series as another of the three (a combined chart). */
  type?: ChartSeriesKind;
  /** Puts the series on a second value axis, drawn on the opposite side. */
  axis?: "secondary";
  /** Lines fitted through the series. */
  trendlines?: Trendline[];
  /** Error bars on every point of the series (column, bar, line, area, scatter and bubble charts that aren't stacked or 3-D). */
  errorBars?: SeriesErrorBars;
  /** Pie, doughnut and of-pie charts: how far the slices of this series are pulled out of the pie, as a percentage of the radius (0 to 400). */
  explosion?: number;
  /** The same for single slices, by point number (counting from 0); wins over `explosion`. */
  pointExplosion?: Record<string, number>;
  /** Fills of single points (a column, bar, slice, bubble, marker, waterfall step…) by point number counting from 0, as `#rrggbb`; wins over `color`. */
  pointColors?: Record<string, string>;
  /** For a bubble chart, a reference to the sizes of the bubbles. */
  size?: string;
  /** The name shown in the legend, as text. */
  name?: string;
  /** Or a reference to the cell that holds it, such as `Budget!$C$1`. */
  nameRef?: string;
  /** A reference to the values, one column or one row. */
  values: string;
  /** For a scatter chart, a reference to the x values. */
  x?: string;
  /** `#rrggbb`; the chart's own palette is used when missing. */
  color?: string;
}

/** How a 3-D chart is looked at, in degrees: `rotX` tilts it towards the viewer (0 to 90) and `rotY` turns it about its vertical axis (0 to 360). */
export interface ChartView3d {
  rotX: number;
  rotY: number;
  /** How strong the perspective is, as the angle of view in degrees (0 to 100; 15 if left out). 0 is a flat (parallel) projection. */
  perspective?: number;
  /** Right-angle axes: the front of the chart is drawn square on and the depth goes off at an angle, with no perspective. */
  rightAngle?: boolean;
  /** How deep the chart is, as a percentage of its width (20 to 2000; 100 if left out). */
  depth?: number;
}

/**
 * A chart sitting on a sheet. It is drawn from the cells it refers to, and `from` and the size place it over the grid, so it
 * moves with its cell when rows or columns are inserted. Sizes are in pixels at 100%.
 */
export interface Chart {
  id: string;
  type: ChartType;
  title?: string;
  /** What the chart shows, in words, for people who can't see it (Excel's alternative text). */
  alt?: string;
  /** The labels along the x axis (or the names of pie slices), as a reference. */
  categories?: string;
  series: ChartSeries[];
  /** How the series of a column, bar, line or area chart pile up: `stacked` adds them, `percent` shows each one's share. */
  grouping?: "stacked" | "percent";
  /** Where the legend goes (the default is `bottom`). */
  legend?: "top" | "bottom" | "left" | "right" | "none";
  /** Curves instead of straight lines, for line and scatter charts. */
  smooth?: boolean;
  /** Shows each value on its mark. */
  labels?: boolean;
  xTitle?: string;
  yTitle?: string;
  /** Draws the chart in three dimensions, seen from this angle. Only for column, bar, line, area and pie charts, and surface charts (which always are). */
  view3d?: ChartView3d;
  /** Titles of the second value axis and the second category axis (see `ChartSeries.axis`). */
  y2Title?: string;
  x2Title?: string;
  /** Shows a second category axis along the top (the second set of series use it). */
  secondaryCategoryAxis?: boolean;
  /** `false` leaves the marks off a line, radar or scatter chart. */
  markers?: boolean;
  /** Joins the points of a scatter chart with straight lines (`smooth` joins them with curves). */
  lines?: boolean;
  /** The hole of a doughnut, as a percentage of its width (10 to 90; 50 if left out). */
  holeSize?: number;
  /** A radar chart whose series are filled in. */
  filled?: boolean;
  /** The size of the biggest bubble as a percentage of the default (0 to 300; 100 if left out). */
  bubbleScale?: number;
  /** The series of a stock chart are, in order: high, low, close (`hlc`); open, high, low, close (`ohlc`); volume, high, low, close (`vhlc`); volume, open, high, low, close (`vohlc`). */
  stock?: "hlc" | "ohlc" | "vhlc" | "vohlc";
  /** A surface chart drawn as a mesh of lines instead of coloured bands. */
  wireframe?: boolean;
  /** Pie-of-pie and bar-of-pie: which points move to the second plot (the last 3 if left out), and how big it is compared with the first (5 to 200 percent; 75 if left out). */
  split?: ChartSplit;
  secondSize?: number;
  /** Waterfall: the points (counting from 0) that are totals, drawn from zero. */
  totals?: number[];
  /** Histogram: how the values are binned. */
  bins?: ChartBins;
  /** Box and whisker: what is shown. */
  box?: ChartBox;
  /** Treemap: how the names of the parent groups are shown. */
  parentLabels?: "banner" | "overlapping" | "none";
  /** Axis scales, gridlines, tick marks and label positions; see `ChartAxis`. */
  axes?: ChartAxes;
  /** Pie, doughnut and of-pie charts: the angle the first slice starts at, in degrees clockwise from twelve o'clock (0 to 359). */
  firstSliceAngle?: number;
  /** Stock charts: the look of the high-low lines and up/down bars. */
  stockLook?: ChartStockLook;
  /** Waterfall charts: connector lines. */
  waterfall?: ChartWaterfall;
  /** What the data labels say, when `labels` is on: the value only if left out. */
  labelShow?: ChartLabelPart[];
  /** Where the data labels sit, for the kinds where Excel lets you choose (see the charts page). */
  labelPosition?: "center" | "insideEnd" | "insideBase" | "outsideEnd" | "above" | "below" | "left" | "right" | "bestFit";
  /** The title in pieces with a look of their own (bold, italic, a colour…); `title` is then their text joined. */
  titleRuns?: ChartTitleRun[];
  /** The font of all the chart's text, and of its title. */
  font?: ChartFont;
  titleFont?: ChartFont;
  /** The font of the legend and of the data labels (the chart's font if left out). */
  legendFont?: ChartFont;
  labelFont?: ChartFont;
  /** In a combined chart of columns, lines and areas: how the series of a kind other than the chart's own pile up (`grouping` is for the chart's own kind). */
  kindGrouping?: Partial<Record<"column" | "line" | "area", "stacked" | "percent">>;
  /** Bubble charts: bubbles drawn as shaded spheres. */
  bubble3d?: boolean;
  /** The cell the chart's top-left corner is in (1-based), and how far into that cell. */
  from: { row: number; col: number; dx?: number; dy?: number };
  width: number;
  height: number;
}

export interface Sheet {
  id: string;
  /** Unique in the workbook (without regard to capitals); formulas refer to the sheet by this name. */
  name: string;
  /** By A1 address (`"B3"`). */
  cells: Record<string, Cell>;
  /** Column widths and hiding, by column letters (`"C"`). */
  columns?: Record<string, Dimension>;
  /** Row heights and hiding, by row number as text (`"3"`). */
  rows?: Record<string, Dimension>;
  /** A filter on a range of the sheet. */
  filter?: SheetFilter;
  /** Saved filters people can switch between (see `FilterView`). Kept in Pli's own JSON; an XLSX file holds only the filter in force. */
  filterViews?: FilterView[];
  /** Charts over the grid, bottom to top. */
  charts?: Chart[];
  /** Slicers over the grid, bottom to top. */
  slicers?: Slicer[];
  /** Timelines over the grid, bottom to top. */
  timelines?: Timeline[];
  /** Pictures over the grid, bottom to top (under the charts). */
  images?: SheetImage[];
  /** Sparklines, in the cells they are drawn in. */
  sparklines?: SparklineGroup[];
  /** Pivot tables drawn on the sheet. */
  pivots?: Pivot[];
  /** Present when the sheet is protected. */
  protection?: SheetProtection;
  /** Ranges that may be edited on a protected sheet, each with its own password or permissions. */
  editRanges?: EditRange[];
  /** Cells that say nothing about being locked, in rows and columns that don't either, are unlocked (Excel's select all, then unlock). */
  unlocked?: true;
  /** Cells that say nothing about hiding their formula, in rows and columns that don't either, hide it (Excel's select all, then Hidden). */
  hiddenFormulas?: true;
  /** How the sheet prints; missing when it prints as Excel's defaults. */
  page?: PageSetup;
  /** Where the summary rows and columns of groups sit; missing for below and right. */
  outline?: OutlineSettings;
  /** Merged ranges such as `B2:D3`: the top-left cell shows over the whole range, and the other cells are covered. */
  merges?: string[];
  /** Conditional formats, the first rule having the most say. */
  conditional?: ConditionalRule[];
  /** Tables on the sheet. */
  tables?: Table[];
  /** Data validation: what may be typed into cells. The first rule that covers a cell is the one that counts. */
  validations?: Validation[];
  /** Rows and columns that stay in view when scrolling. */
  frozen?: { rows: number; cols: number };
  /** `#rrggbb` */
  tabColor?: string;
  /** Not shown among the sheet tabs. Formulas still reach it. A workbook always has a sheet that isn't hidden. */
  hidden?: true;
}

/** Iterative calculation: formulas that refer to themselves are worked out again and again until they settle. Present only when it is on. */
export interface IterationSettings {
  /** The most times a circular chain is worked out (1 to 32767; Excel's default is 100). */
  maxIterations: number;
  /** Stop when no value in the chain changes by more than this (Excel's default is 0.001). */
  maxChange: number;
}

export interface Workbook {
  id: string;
  type: "workbook";
  title: string;
  sheets: Sheet[];
  /** Defined names: the name, and the formula (without `=`) it stands for, such as `Sheet1!$A$1:$A$10`. */
  names?: Record<string, string>;
  /** Table styles of your own, by name; a table's `style` may name one (these win over Excel's built-in names). */
  tableStyles?: Record<string, TableStyleDef>;
  /** Slicer styles of your own, by name; a slicer's `style` can name one (see `SlicerStyleDef`). */
  slicerStyles?: Record<string, SlicerStyleDef>;
  /** Pivot table styles of your own, by name; a pivot table's `style.name` may name one. */
  pivotStyles?: Record<string, PivotStyleDef>;
  /** Data from outside the workbook that pivot tables read, as last read. */
  dataBlocks?: DataBlock[];
  /** The data model: tables, relationships and measures that pivot tables with the source `ThisWorkbookDataModel` read. */
  model?: DataModel;
  /** Present when the workbook's structure is protected. */
  protection?: WorkbookProtection;
  /** Present when iterative calculation is on; without it a formula that refers to itself reads as 0, as in Excel. */
  iteration?: IterationSettings;
  /**
   * The colours of the workbook's theme as `#rrggbb` (lower case), in the order a `theme` number counts them: light 1, dark 1,
   * light 2, dark 2, accent 1 to 6 (ten), then, when the theme has its own, the hyperlink and followed-hyperlink colours (twelve;
   * Office's are `#0563c1` and `#954f72`). Office's own palette without it.
   */
  themeColors?: string[];
  /** The cells last read from other workbooks, which formulas such as `[Prices.xlsx]Sheet1!B2` (and validation rules) read; see `ExternalBook`. */
  externalBooks?: ExternalBook[];
  /**
   * Comment threads kept in the workbook (the default store of `session.comments.enable`), by thread id. A thread is attached to
   * the cell that has its id in `Cell.thread`. Left out when your own `CommentStore` keeps them.
   */
  comments?: Record<string, Thread<CellAnchor>>;
}

/**
 * What a workbook last knew of another workbook it reads (the cached values Excel keeps in an `externalLink` part): the cells
 * a formula such as `=[Prices.xlsx]Sheet1!B2`, a defined name or a validation rule reads, by sheet name and address. Blank cells
 * are left out. A host fills it by answering the session's `externalLists` resolver, or with `session.setExternalCells`.
 */
export interface ExternalBook {
  /** The file as formulas name it: `Prices.xlsx`. */
  name: string;
  /** The path or address of the file as a workbook file named it, when known. */
  path?: string;
  /** The day the cells were last read (`2026-11-09`), when known. */
  read?: string;
  sheets: Record<string, Record<string, string | number | boolean>>;
  /** The tables of that workbook that formulas here name, `[Prices.xlsx]Orders[Total]`: where each is, so that a part of it can be turned into cells. */
  tables?: ExternalTable[];
}

/** A table of another workbook: its name, the sheet and range it covers (header and totals rows included) and its column names. */
export interface ExternalTable {
  name: string;
  sheet: string;
  /** `A1:D9`. */
  range: string;
  columns: string[];
  /** False for a table with no header row (the first row of the range is data). */
  header?: false;
  /** True when the range ends with a totals row. */
  totals?: true;
}

export function emptyCell(cell: Cell | undefined): boolean {
  return !cell || (cell.v === undefined && cell.e === undefined && cell.f === undefined && cell.fmt === undefined && cell.s === undefined && cell.control === undefined && cell.picture === undefined && cell.link === undefined && cell.note === undefined && cell.thread === undefined);
}
