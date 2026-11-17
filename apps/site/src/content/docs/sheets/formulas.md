---
title: Formulas
description: The formula language Pli.Sheets reads, how it works out values, and every function it has.
---

Pli.Sheets reads formulas the way Excel does, so a formula written for Excel gives the same answer here, and a workbook saved by Pli opens in Excel with the same formulas. Formulas are checked against [LibreOffice](#how-it-is-checked) on every test run.

A cell's formula is kept without the leading `=`: typing `=SUM(A1:A3)` stores `SUM(A1:A3)`.

## Help while typing

Typing `=` in the [grid editor](/sheets/grid/) lists the functions that match what you've typed, with what each does, its arguments and an example. Inside a function's brackets it shows which argument you are on. The text comes from a catalog you can call yourself: `functionCatalog()` returns all 475 entries (category, summary, arguments with descriptions, syntax, example), `functionInfo("VLOOKUP")` returns one, and `assistFormula(text, caret)` says what completes the word at the caret and which call the caret is in.

## What a formula can contain

| | Examples |
|---|---|
| Numbers, text, `TRUE` and `FALSE` | `42`, `1.5E3`, `"say ""hi"""`, `TRUE` |
| Errors | `#N/A`, `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`, `#NULL!` |
| Cells and ranges | `A1`, `$A$1`, `A1:C5`, `A:A`, `3:3`, `Sheet2!A1`, `'My Sheet'!A1:B2` |
| Defined names | `Rate`, `Sales` (see `defineName`) |
| Array constants | `{1,2,3}`, `{1,2;3,4}` (rows split by `;`) |
| Operators | `+ - * / ^ & = <> < > <= >= %` and unary `-` |
| Functions | `SUM(A1:A3)`, nested to any depth |

Operators follow Excel's order, from tightest to loosest: a sign (`-`), `%`, `^` (left to right, so `2^3^2` is 64), `* /`, `+ -`, `&`, then the comparisons. A sign binds tighter than `^`, so `-2^2` is 4.

## How values are worked out

- **Text that looks like a number counts as one** when a number is expected: `"3"+4` is 7, `"12%"+0` is 0.12. Text that doesn't gives `#VALUE!`.
- **An empty cell is 0 in arithmetic and `""` in text.** `SUM`, `AVERAGE`, `MAX` and the like skip text and empty cells in a range; typed straight in, `TRUE` counts as 1 and numeric text counts.
- **Comparisons**: text ignores capitals, and the order is numbers, then text, then booleans (so `TRUE>5` is true and `TRUE=1` is false).
- **Ranges in arithmetic work on every item**: `SUM(A1:A3*B1:B3)` multiplies pair by pair, and `IF(A1:A3>1,A1:A3,0)` picks item by item. A single row or column repeats to match a larger one.
- **A bare range in a formula that wants one value** takes the cell on the formula's own row or column (`=A1:A3` in B2 is A2), and is `#VALUE!` if there is none. A formula that *gives* several values (`=A1:A3*10`, `=SORT(A1:A3)`) [spills](#arrays-that-spill).
- **Errors spread**: a formula that reads an error gives it back, except `IFERROR`, `IFNA`, `ISERROR` and the others that look for one.
- **Circular references read as 0**, as in Excel. `session.calculator.isCircular(sheet, "A1")` says whether a cell is part of one. With [iterative calculation](#iterative-calculation) on they are worked out instead.
- **Dates are numbers**: the 1900 system, where 1 is 1 January 1900 (including Excel's fictional 29 February 1900). The format makes them look like dates; `DATE(2024,3,5)` is 45356.
- **Rounding works on the 15 digits Excel keeps**, so `ROUND(1.005,2)` is 1.01.

Formulas are worked out when a cell is read, and kept. When a cell changes, only the formulas that depend on it (and those that depend on them) are worked out again, including ranges that gain a cell and references built by `INDIRECT` and `OFFSET`. A chain of 20,000 formulas does not overflow the stack.

## Functions

There are 475 functions. Names are not case-sensitive, and a `_xlfn.` prefix from a file is ignored.

**Math, trigonometry and engineering** (rounding, powers, number bases, units, complex numbers, matrices): `ABS`, `ACOS`, `ACOSH`, `ACOT`, `ACOTH`, `AGGREGATE`, `ARABIC`, `ASIN`, `ASINH`, `ATAN`, `ATAN2`, `ATANH`, `BASE`, `BIN2DEC`, `BIN2HEX`, `BIN2OCT`, `BITAND`, `BITLSHIFT`, `BITOR`, `BITRSHIFT`, `BITXOR`, `CEILING`, `CEILING.MATH`, `CEILING.PRECISE`, `COMBIN`, `COMBINA`, `COMPLEX`, `CONVERT`, `COS`, `COSH`, `COT`, `COTH`, `CSC`, `CSCH`, `DEC2BIN`, `DEC2HEX`, `DEC2OCT`, `DECIMAL`, `DEGREES`, `DELTA`, `ERF`, `ERF.PRECISE`, `ERFC`, `ERFC.PRECISE`, `EVEN`, `EXP`, `FACT`, `FACTDOUBLE`, `FLOOR`, `FLOOR.MATH`, `FLOOR.PRECISE`, `GCD`, `GESTEP`, `HEX2BIN`, `HEX2DEC`, `HEX2OCT`, `IMABS`, `IMAGINARY`, `IMARGUMENT`, `IMCONJUGATE`, `IMCOS`, `IMCOSH`, `IMCOT`, `IMCSC`, `IMCSCH`, `IMDIV`, `IMEXP`, `IMLN`, `IMLOG10`, `IMLOG2`, `IMPOWER`, `IMPRODUCT`, `IMREAL`, `IMSEC`, `IMSECH`, `IMSIN`, `IMSINH`, `IMSQRT`, `IMSUB`, `IMSUM`, `IMTAN`, `INT`, `ISO.CEILING`, `LCM`, `LN`, `LOG`, `LOG10`, `MDETERM`, `MINVERSE`, `MMULT`, `MOD`, `MROUND`, `MULTINOMIAL`, `MUNIT`, `OCT2BIN`, `OCT2DEC`, `OCT2HEX`, `ODD`, `PERCENTOF`, `PERMUT`, `PERMUTATIONA`, `PI`, `POWER`, `PRODUCT`, `QUOTIENT`, `RADIANS`, `RAND`, `RANDARRAY`, `RANDBETWEEN`, `ROMAN`, `ROUND`, `ROUNDDOWN`, `ROUNDUP`, `SEC`, `SECH`, `SEQUENCE`, `SERIESSUM`, `SIGN`, `SIN`, `SINH`, `SQRT`, `SQRTPI`, `SUBTOTAL`, `SUM`, `SUMIF`, `SUMIFS`, `SUMPRODUCT`, `SUMSQ`, `SUMX2MY2`, `SUMX2PY2`, `SUMXMY2`, `TAN`, `TANH`, `TRANSPOSE`, `TRUNC`. `AGGREGATE` skips errors if asked; `CONVERT` knows lengths, mass, time, temperature, volume, area, speed, pressure, force, energy, power, magnetism and information units, with metric prefixes.

**Statistics and distributions**: `AVEDEV`, `AVERAGE`, `AVERAGEA`, `AVERAGEIF`, `AVERAGEIFS`, `BETA.DIST`, `BETA.INV`, `BETADIST`, `BETAINV`, `BINOM.DIST`, `BINOM.INV`, `BINOMDIST`, `CHIDIST`, `CHIINV`, `CHISQ.DIST`, `CHISQ.DIST.RT`, `CHISQ.INV`, `CHISQ.INV.RT`, `CONFIDENCE`, `CONFIDENCE.NORM`, `CONFIDENCE.T`, `CORREL`, `COUNT`, `COUNTA`, `COUNTBLANK`, `COUNTIF`, `COUNTIFS`, `COVAR`, `COVARIANCE.P`, `COVARIANCE.S`, `CRITBINOM`, `DEVSQ`, `EXPON.DIST`, `EXPONDIST`, `F.DIST`, `F.DIST.RT`, `F.INV`, `F.INV.RT`, `FDIST`, `FINV`, `FISHER`, `FISHERINV`, `FORECAST`, `FORECAST.ETS`, `FORECAST.ETS.CONFINT`, `FORECAST.ETS.SEASONALITY`, `FORECAST.ETS.STAT`, `FORECAST.LINEAR`, `FREQUENCY`, `GAMMA`, `GAMMA.DIST`, `GAMMA.INV`, `GAMMADIST`, `GAMMAINV`, `GAMMALN`, `GAMMALN.PRECISE`, `GAUSS`, `GEOMEAN`, `GROWTH`, `HARMEAN`, `HYPGEOM.DIST`, `INTERCEPT`, `KURT`, `LARGE`, `LINEST`, `LOGEST`, `LOGINV`, `LOGNORM.DIST`, `LOGNORM.INV`, `LOGNORMDIST`, `MAX`, `MAXA`, `MAXIFS`, `MEDIAN`, `MIN`, `MINA`, `MINIFS`, `MODE`, `MODE.MULT`, `MODE.SNGL`, `NEGBINOM.DIST`, `NORM.DIST`, `NORM.INV`, `NORM.S.DIST`, `NORM.S.INV`, `NORMDIST`, `NORMINV`, `NORMSDIST`, `NORMSINV`, `PEARSON`, `PERCENTILE`, `PERCENTILE.EXC`, `PERCENTILE.INC`, `PERCENTRANK`, `PERCENTRANK.EXC`, `PERCENTRANK.INC`, `PHI`, `POISSON`, `POISSON.DIST`, `QUARTILE`, `QUARTILE.EXC`, `QUARTILE.INC`, `RANK`, `RANK.AVG`, `RANK.EQ`, `RSQ`, `SKEW`, `SKEW.P`, `SLOPE`, `SMALL`, `STANDARDIZE`, `STDEV`, `STDEV.P`, `STDEV.S`, `STDEVA`, `STDEVP`, `STDEVPA`, `STEYX`, `T.DIST`, `T.DIST.2T`, `T.DIST.RT`, `T.INV`, `T.INV.2T`, `TDIST`, `TINV`, `TREND`, `TRIMMEAN`, `VAR`, `VAR.P`, `VAR.S`, `VARA`, `VARP`, `VARPA`, `WEIBULL`, `WEIBULL.DIST`. Criteria for `COUNTIF`, `SUMIF` and the others are read as in Excel: `">5"`, `"<>apple"`, `"a*"` (`*` any text, `?` one character, `~` to match a literal one), or a plain value. The distributions are accurate to about 12 digits and checked against LibreOffice.

**Logic and functions of your own**: `AND`, `BYCOL`, `BYROW`, `CHOOSE`, `FALSE`, `IF`, `IFERROR`, `IFNA`, `IFS`, `ISOMITTED`, `LAMBDA`, `LET`, `MAKEARRAY`, `MAP`, `NOT`, `OR`, `REDUCE`, `SCAN`, `SWITCH`, `TRUE`, `XOR`. `IF`, `IFS`, `IFERROR`, `IFNA`, `SWITCH` and `CHOOSE` only work out the branch they use. `LET` names values for a calculation, and `LAMBDA` makes a function of your own that can be named with `LET` or given to `MAP`, `REDUCE`, `SCAN`, `BYROW`, `BYCOL`, `MAKEARRAY`, `GROUPBY` and `PIVOTBY` ([below](#arrays-that-spill)). A function can also be given by its name alone, without brackets (`BYROW(A1:C5, SUM)`, `MAP(A1:A5, LEN)`, `GROUPBY(A2:A9, B2:B9, AVERAGE)`).

**Information**: `CELL`, `ERROR.TYPE`, `ISBLANK`, `ISERR`, `ISERROR`, `ISEVEN`, `ISFORMULA`, `ISLOGICAL`, `ISNA`, `ISNONTEXT`, `ISNUMBER`, `ISODD`, `ISREF`, `ISTEXT`, `N`, `NA`, `SHEET`, `SHEETS`, `T`, `TYPE`.

**Text**: `ARRAYTOTEXT`, `CHAR`, `CLEAN`, `CODE`, `CONCAT`, `CONCATENATE`, `DOLLAR`, `EXACT`, `FIND`, `FIXED`, `LEFT`, `LEN`, `LOWER`, `MID`, `NUMBERVALUE`, `PROPER`, `REGEXEXTRACT`, `REGEXREPLACE`, `REGEXTEST`, `REPLACE`, `REPT`, `RIGHT`, `SEARCH`, `SUBSTITUTE`, `TEXT`, `TEXTAFTER`, `TEXTBEFORE`, `TEXTJOIN`, `TEXTSPLIT`, `TRIM`, `UNICHAR`, `UNICODE`, `UPPER`, `VALUE`, `VALUETOTEXT`. `TEXT` takes the same [number formats](/sheets/files/#number-formats) cells do. The regular-expression functions use JavaScript's syntax.

**Date and time**: `DATE`, `DATEDIF`, `DATEVALUE`, `DAY`, `DAYS`, `DAYS360`, `EDATE`, `EOMONTH`, `HOUR`, `ISOWEEKNUM`, `MINUTE`, `MONTH`, `NETWORKDAYS`, `NETWORKDAYS.INTL`, `NOW`, `SECOND`, `TIME`, `TIMEVALUE`, `TODAY`, `WEEKDAY`, `WEEKNUM`, `WORKDAY`, `WORKDAY.INTL`, `YEAR`, `YEARFRAC`.

**Database**: `DAVERAGE`, `DCOUNT`, `DCOUNTA`, `DGET`, `DMAX`, `DMIN`, `DPRODUCT`, `DSTDEV`, `DSTDEVP`, `DSUM`, `DVAR`, `DVARP`. Each takes a table with its headings in the first row, the heading (in quotes) or number of the column to work on, and a block of criteria: headings and, under them, conditions. The cells in a row of conditions must all pass, and any one row may. Plain text matches cells that begin with it, `=text` the whole cell, and `>5`, `<>x` and the other comparisons work as in `COUNTIF`; an empty condition asks nothing. `DGET` gives `#VALUE!` when no record matches and `#NUM!` when several do; the others say `#DIV/0!` when there is nothing to average. A blank heading over a condition (a formula that tests each record) is not read.

**Lookup, reference and dynamic arrays**: `ADDRESS`, `AREAS`, `CHOOSECOLS`, `CHOOSEROWS`, `COLUMN`, `COLUMNS`, `DROP`, `EXPAND`, `FILTER`, `FORMULATEXT`, `GETPIVOTDATA`, `GROUPBY`, `HLOOKUP`, `HSTACK`, `HYPERLINK`, `IMAGE`, `INDEX`, `INDIRECT`, `LOOKUP`, `MATCH`, `OFFSET`, `PIVOTBY`, `ROW`, `ROWS`, `SORT`, `SORTBY`, `SPARKLINE`, `TAKE`, `TOCOL`, `TOROW`, `UNIQUE`, `VLOOKUP`, `VSTACK`, `WRAPCOLS`, `WRAPROWS`, `XLOOKUP`, `XMATCH`. `INDEX` and `OFFSET` give references, so `SUM(INDEX(A1:C5,0,2))` sums a column. `GETPIVOTDATA("Sales",A3,"Region","East")` gives what a [pivot table](/sheets/pivot-tables/#reading-a-pivot-table-from-formulas) shows for a value and some of its items. `IMAGE("https://…","description")` [shows a picture in the cell](/sheets/grid/#pictures-in-cells). `INDIRECT` and `OFFSET` are volatile: they are worked out again after every change.

**Finance**: `ACCRINT`, `ACCRINTM`, `AMORDEGRC`, `AMORLINC`, `COUPDAYBS`, `COUPDAYS`, `COUPDAYSNC`, `COUPNCD`, `COUPNUM`, `COUPPCD`, `CUMIPMT`, `CUMPRINC`, `DB`, `DDB`, `DISC`, `DOLLARDE`, `DOLLARFR`, `DURATION`, `EFFECT`, `FV`, `FVSCHEDULE`, `INTRATE`, `IPMT`, `IRR`, `ISPMT`, `MDURATION`, `MIRR`, `NOMINAL`, `NPER`, `NPV`, `ODDFPRICE`, `ODDFYIELD`, `ODDLPRICE`, `ODDLYIELD`, `PDURATION`, `PMT`, `PPMT`, `PRICE`, `PRICEDISC`, `PRICEMAT`, `PV`, `RATE`, `RECEIVED`, `RRI`, `SLN`, `SYD`, `TBILLEQ`, `TBILLPRICE`, `TBILLYIELD`, `VDB`, `XIRR`, `XNPV`, `YIELD`, `YIELDDISC`, `YIELDMAT`. The bond and security functions take Excel's five day-count bases (0 US 30/360, 1 actual/actual, 2 actual/360, 3 actual/365, 4 European 30/360) and work out coupon dates back from the maturity, using the last day of the month for each when the maturity is on one. Dates are made whole; a frequency other than 1, 2 or 4, a basis outside 0 to 4, a settlement that is not before the maturity, or a negative rate or yield is `#NUM!`. `YIELD`, `ODDFYIELD` and the others that ask for a yield given a price are solved to full precision. Treasury bills are for a year at most (a later maturity is `#NUM!`). `LINEST` and `LOGEST` are described [below](#curve-fitting).

`NOW`, `TODAY`, `RAND`, `RANDBETWEEN` and `RANDARRAY` are volatile. Pass `now` and `random` to the session to fix them, which is how the tests stay repeatable:

```ts
new SheetSession(workbook, { now: () => 45356.5, random: () => 0.25 });
```

## Arrays that spill

A formula that gives several values fills the cells beside and below it, as in Excel 365: `=SORT(A2:C20,3,-1)`, `=FILTER(A2:C20,C2:C20>100)`, `=UNIQUE(A2:A20)`, `=SEQUENCE(5)`, `=A1:A3*10`, `=TRANSPOSE(A1:C3)`, `=TEXTSPLIT(A1,",")`. The cells it fills are results, not cells of their own: they change when the formula's inputs change, and anything that reads them (`=SUM(B1:B5)`) follows. Select the formula's cell and the whole range is outlined.

- If something is in the way (a cell with a value, or another formula's results) the formula gives `#SPILL!`, and works again when the cells are cleared. Typing into a spilled cell blocks the formula that filled it.
- A formula that names a range outright (`=A1:A3`) is read at its own row or column, as in older Excel, rather than spilled.
- In XLSX files such a formula is an array formula over the cells it fills, and it reads back the same way.

`LET` and `LAMBDA` work as in Excel:

```
=LET(rate, 0.08, years, 10, 1000 * (1 + rate) ^ years)
=MAP(A1:A5, LAMBDA(x, x * x))
=REDUCE(0, A1:A5, LAMBDA(total, x, total + x))
=LET(tax, LAMBDA(x, x * 0.2), tax(500))
```

A parameter can be optional: put it in square brackets (`LAMBDA(x, [y], …)`; optional ones come after the others) and leave it out, or leave its place empty, when calling. `ISOMITTED(y)` says whether it was left out; an omitted parameter reads as empty (0 or `""`) if you use it anyway.

```
=LET(add, LAMBDA(x, [y], IF(ISOMITTED(y), x, x + y)), add(5))      5
=LET(add, LAMBDA(x, [y], IF(ISOMITTED(y), x, x + y)), add(5, 2))   7
```

Calling a `LAMBDA` with more values than it has parameters, or fewer than its required ones, is `#VALUE!`. In XLSX files an optional parameter is written `[_xlpm.y]`, as Excel does. A `LAMBDA` can also be called where it is made, `LAMBDA(x,x+1)(5)`.

The **Lambda** sheet in the playground's spreadsheet sample has twelve live examples. Each shows its formula as text above the result, on a small data set you can change.

## Curve fitting

`LINEST(known_y's, [known_x's], [const], [stats])` fits a straight line (or, with several variables, a plane) by least squares and gives the coefficients as a row, last variable first and the intercept last. `LOGEST` does the same for the curve `y = b * m1^x1 * m2^x2…` and `TREND` and `GROWTH` give the values on them at the points you name.

- `known_y's` is one column or one row (anything else is `#REF!`). With a column, each column of `known_x's` is a variable; with a row, each row is. Left out, `known_x's` is 1, 2, 3… A different number of observations is `#REF!`, text or an empty cell in the data is `#VALUE!`, and `LOGEST` needs y values over 0 (else `#NUM!`).
- `const` FALSE forces the intercept to 0 (1 for `LOGEST`). The sums of squares and r² are then measured from zero, as in Excel.
- `stats` TRUE adds four rows: the standard errors; r² and the standard error of y; F and the degrees of freedom; and the regression and residual sums of squares. The cells that don't apply are `#N/A` (the standard error of the intercept when `const` is FALSE too). A fit through every point (no degrees of freedom) has standard errors of 0; F is `#NUM!` when the fit is exact.
- A variable that is a combination of the ones before it (or that never changes, when there is an intercept) is left out: its coefficient and standard error are 0, and it takes no degrees of freedom, as in Excel.
- `TREND` and `GROWTH` give an array the shape of `new_x's` (one variable), or one value for each row (each column, when the y values are in a row) of `new_x's` (several variables). Left out, `new_x's` is `known_x's`.

```
=LINEST(B2:B20, A2:C20, TRUE, TRUE)
=TREND(B2:B20, A2:A20, A21:A23)
```

`LINEST` is checked against LibreOffice on every coefficient and statistic, for one and several variables, rows and columns, with and without an intercept. `SLOPE`, `INTERCEPT`, `RSQ`, `STEYX`, `FORECAST` and `FORECAST.LINEAR` are the single-variable forms.

## Forecasting

`FORECAST.ETS(target_date, values, timeline, [seasonality], [data_completion], [aggregation])` forecasts with the AAA version of exponential triple smoothing (additive error, additive trend, additive seasonality), as Excel's does. Its companions are `FORECAST.ETS.CONFINT(target_date, values, timeline, [confidence_level], …)` (the half-width of the confidence interval around that forecast, 95% if the level is left out), `FORECAST.ETS.SEASONALITY(values, timeline, [data_completion], [aggregation])` (the length of the repeating pattern that was found, 1 if none) and `FORECAST.ETS.STAT(values, timeline, statistic_type, …)` (1 Alpha, 2 Beta, 3 Gamma, 4 MASE, 5 SMAPE, 6 MAE, 7 RMSE, 8 the step found in the timeline: for dates on the same day of each month it is the days most months have, 31, as Excel shows).

- **Timeline**: numbers or dates in any order. The step is the smallest gap, and every gap has to be a whole number of steps (or, for dates on the same day of each month, or all on month ends, whole months: monthly, quarterly and yearly series work). Otherwise `#NUM!`. A timeline and values of different lengths are `#N/A`; text in either is `#VALUE!`.
- **seasonality**: 1 (the default) finds the pattern length itself, 0 means no seasonality, a whole number sets it. A pattern needs two full repeats in the data (`#NUM!` if you ask for fewer; the automatic search then says 1).
- **data_completion**: 1 fills points missing from the timeline by interpolating (the default), 0 with zeros. More than 30% missing is `#NUM!`.
- **aggregation**: points that share a time are combined with 1 AVERAGE (the default), 2 COUNT, 3 COUNTA, 4 MAX, 5 MEDIAN, 6 MIN or 7 SUM.
- A `target_date` after the last point is extrapolated (between steps it is interpolated); one inside the data gives the fitted value; one before the first point is `#NUM!`. The target can be an array.
- `confidence_level` must be above 0 and below 1, and a `statistic_type` between 1 and 8, or the result is `#NUM!`.

The smoothing constants are searched for between 0 and 1, to a resolution of 0.001, by the method LibreOffice uses. Pli and LibreOffice agree to about nine digits on the forecast, the interval, the pattern length and all eight statistics (see [How it is checked](#how-it-is-checked)); Excel's own optimizer is not published, so its numbers can differ slightly from both.

## Complex numbers

Complex numbers are text such as `"3+4i"` or `"3+4j"`, or plain numbers. The functions `IMABS`, `IMAGINARY`, `IMARGUMENT`, `IMCONJUGATE`, `IMDIV`, `IMPRODUCT`, `IMREAL`, `IMSUB`, `IMSUM`, `COMPLEX`, `IMEXP`, `IMLN`, `IMLOG10`, `IMLOG2`, `IMPOWER`, `IMSQRT`, `IMSIN`, `IMCOS`, `IMTAN`, `IMSEC`, `IMCSC`, `IMCOT`, `IMSINH`, `IMCOSH`, `IMSECH` and `IMCSCH` work on them and give text back with the suffix of their arguments. Text that isn't a complex number (including any with a space in it) is `#NUM!`, a mix of `i` and `j` is `#VALUE!`, and a result that does not exist (`IMLN("0")`, `IMCSC("0")`, `IMPOWER("0", -1)`) is `#NUM!`. `IMPOWER` takes any real power; whole powers are worked out by multiplying so that `IMPOWER("2+3i", 3)` is exactly `-46+9i`.

## Grouping and pivoting

`GROUPBY` and `PIVOTBY` summarize a table into an array that spills, without making a pivot table.

```
=GROUPBY(A2:B9, D2:D9, SUM)
=GROUPBY(A1:A9, C1:D9, HSTACK(SUM, AVERAGE), 3, 1, -2)
=PIVOTBY(A1:A9, B1:B9, D1:D9, SUM)
=GROUPBY(A2:A9, D2:D9, PERCENTOF)
```

- `GROUPBY(row_fields, values, function, [field_headers], [total_depth], [sort_order], [filter_array], [field_relationship])` groups the rows by the value in each column of `row_fields` and combines each column of `values` per group.
- `PIVOTBY(row_fields, col_fields, values, function, [field_headers], [row_total_depth], [row_sort_order], [col_total_depth], [col_sort_order], [filter_array], [relative_to])` also spreads the groups of `col_fields` across the top (leave `col_fields` empty, `PIVOTBY(A2:A9,,B2:B9,SUM)`, for none). A combination with no rows is left blank.
- `function` is a function named on its own (`SUM`, `AVERAGE`, `COUNT`, `MAX`, `PERCENTOF`…), a `LAMBDA` of one name (it gets one group's values of one column, as a column), or several of these side by side with `HSTACK(SUM, COUNT)` (or one under the other with `VSTACK(SUM, COUNT)`, which is the same list), which give a column each, under a row with their names (`COUNT`, `SUM`; a `LAMBDA` has no name, so its cell is empty). Stack a row of your own labels under them to name the columns instead: `VSTACK(HSTACK(COUNT, SUM), {"Count", "Cost"})`, one label per function or `#VALUE!`. `PERCENTOF` (and a `LAMBDA` with two names) also gets a second set of values to compare with: in `GROUPBY` all the rows, so `PERCENTOF` gives each group's share of the total; in `PIVOTBY` what `relative_to` says: 0 the column's total (the default), 1 the row's total, 2 everything, 3 the parent column's total, 4 the parent row's total (the parent is the group one field up, or everything for the first field). `PERCENTOF(a, b)` is also a function of its own: the total of `a` over the total of `b`.
- `field_headers`: 0 no headers, 1 there but not shown, 2 none but generate and show them (`Row Field 1`, `Value 1`…), 3 there and shown. Left out, the first row is found as a header if its first value is text and the one under it is a number, and is kept out of the groups but not shown, as in Excel; give 3 to show it.
- `total_depth` (`row_total_depth`, `col_total_depth`): 0 none, 1 a grand total, 2 a grand total and subtotals for the first field, 3 for the second as well…; negative puts the totals first instead of last. Left out, a grand total alone (1), as in Excel. Asking for more levels than there are fields (2 with one field) is `#VALUE!`. A subtotal row carries the group's own name (`East`, with the other field cells empty); the grand total is labelled `Total`, or `Grand Total` once there are subtotals. Groups are matched without regard to capitals.
- `sort_order` is a column number (or an array of them, only when they all name fields), counting the fields first and then the values; negative sorts the other way. Left out, the groups are in ascending order of their fields. A field sorts the groups it makes; a value sorts the groups at every level by that value's total.
- `filter_array` is a column of TRUE and FALSE the height of `row_fields` (the header row's entry is ignored).
- `field_relationship` (`GROUPBY` only) 0 (hierarchy) sorts each group inside its parent; 1 (table) treats the combinations as a flat list, sorted as a whole, with no subtotals (asking for subtotals with it is `#VALUE!`).
- In a `PIVOTBY` with headers shown, each column field's name has a row of its own over its labels (in the first column of values, the corner stays empty), and one more row gives the row field names and the value names.

With several functions and several value columns, each function takes its own value column when there are as many of them (`GROUPBY(A2:A8,C2:D8,HSTACK(SUM,COUNT))` gives the sum of the first and the count of the second, two columns, as Excel does); one function takes every value column, one value column takes every function, and any other pairing is `#VALUE!`.

LibreOffice has no `GROUPBY` or `PIVOTBY`, so these are tested against hand-worked results and against Excel's own answers for the 19 blocks of kit file 42.

## Iterative calculation

Some models refer to themselves on purpose: a balance that includes its own interest, a running total, a figure that settles after a few rounds. With iterative calculation on, such a formula is worked out again and again:

```ts
session.setIteration({ maxIterations: 100, maxChange: 0.001 });   // both are optional: these are Excel's defaults
session.iteration;                                               // the settings, or null when it is off
session.setIteration(null);                                      // circular references read as 0 again
```

In the grid it is **Data > Iterative calculation…**. A chain that reads itself is worked out once with the cell reading its last value (0 the first time), then again with it reading what it came to, until no value in the chain moves by more than `maxChange` or it has been worked out `maxIterations` times. `=(A1+10)/2` in A1 settles on 10; `=A1+1` never settles and counts up to the limit.

- **A cell starts from the value it had last**, as in Excel, so `=A1+B1` with a limit of 1 keeps a running total as B1 changes. A cell is worked out again when something it reads changes, not on every edit, and starting over (undo of a structural change, or opening the workbook) starts from 0 again, because a saved workbook keeps formulas and not their values.
- **The order Excel works in isn't copied.** A loop that settles gives the same answer; one that doesn't (a count, or a loop that depends on which cell is worked out first) can differ from Excel's.
- **Saved** with the workbook (`iteration`) and in XLSX files as `calcPr` `iterate`, `iterateCount` and `iterateDelta`.

## Not there yet

- Functions beyond these. A formula that uses one reads as `#NAME?`, and an imported XLSX lists the missing names in its warnings.
- `GROUPBY` and `PIVOTBY` are checked against Microsoft's documentation and against Excel's own answers for 19 blocks (kit file 42: headers, totals and their labels, subtotals, sort orders, `PERCENTOF` with each `relative_to`, several functions). Still Pli's reading, because Excel's answer has not been seen: the names made for the column fields when `field_headers` is 2 in a `PIVOTBY` (`Column Field 1`), several column fields with headers shown, the rows when a list of functions is paired with several value columns and a labelled list, and whether an empty combination in a `PIVOTBY` is blank or 0 (Excel's file shows blank). The result of a `LAMBDA` that returns an array (rather than one value) is not spread, and an array of functions made any other way than `HSTACK` and `VSTACK` is not accepted.
- `FORECAST.ETS` and its companions give numbers near Excel's but not equal to them: with the sample series of kit file 42 Excel's forecast for step 21 is 21.046 and Pli's 21.137, Excel's smoothing constants are 0.126, 0.001 and 0.001 where Pli finds 0.1, 0.01 and 0.01. Excel's starting states and its search are not published, and its squared errors are not the smallest possible, so Pli takes the best ones. What does match Excel: the pattern length found (4), the step (1, and 31 for dates on the 1st of each month), constants in steps of 0.001 and never 0. Excel's documentation is also silent on a few edges that Pli settles as the documentation says (a `target_date` between two steps is interpolated; more than 30% of the points missing is `#NUM!`; `seasonality` over half the data is `#NUM!`).
- The treasury bill and bond functions follow Excel's formulas; `TBILLEQ` for a bill of exactly half a year in a leap year takes the limit of the formula (LibreOffice gives a slightly different value there), and Excel's own answer for that case, and for `YIELD` with a negative yield, has not been checked.
- The intersection operator (a space between ranges), and 3D references (`Sheet1:Sheet3!A1`).

## How it is checked

- `FORECAST.ETS`, `FORECAST.ETS.CONFINT`, `FORECAST.ETS.SEASONALITY` and `FORECAST.ETS.STAT` are compared with LibreOffice (which has them) on six random series, with and without a repeating pattern and the options, and on monthly, quarterly, daily, month-end and stepped timelines with gaps, repeated and unordered times: about 400 values agree to nine digits. The complex-number functions are compared the same way on 16 numbers each (and on `IMPOWER` for eight powers); the eight LibreOffice lacks (`IMTAN`, `IMSEC`, `IMCSC`, `IMCOT`, `IMSINH`, `IMCOSH`, `IMSECH`, `IMCSCH`) are compared with the same thing built from the ones it has.
- Over 500 formulas are written to an XLSX file, worked out by Pli, and compared with LibreOffice's answers on the same file (the test runs where LibreOffice is installed): everything from `SUM` to the distributions, base conversions, units, array functions and `LET`. The few places LibreOffice differs from Excel (`0^0` is `#NUM!` in Excel, `TRUE>5` is true) are listed in the test, and Pli follows Excel there. Functions LibreOffice doesn't have are tested on their own.
- The bond and security functions (`PRICE`, `YIELD`, `ODDFPRICE`, `ACCRINT`, `AMORDEGRC`, `VDB`…) are compared with LibreOffice on about 3,000 formulas: fourteen settlement and maturity pairs (month ends, leap days, one-period bonds), every frequency and all five bases, and they reproduce the examples in Excel's help. Treasury bills are compared for periods up to a year (LibreOffice also accepts longer ones; Excel gives `#NUM!`). `LINEST`, `LOGEST`, `TREND` and `GROWTH` are compared on over 300 coefficients, statistics and predictions. `GROUPBY` and `PIVOTBY` have no LibreOffice counterpart and are tested against hand-worked results.
- A random test makes changes (typing, inserting and deleting rows and columns, undo and redo) and checks after every step that the incrementally updated values equal those from starting over.
- Reference rewriting on insert and delete follows Excel: a range that loses some of its rows shrinks, one that loses them all becomes `#REF!`.
