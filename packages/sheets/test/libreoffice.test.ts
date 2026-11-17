import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, isError, parseCsv, toXlsx, type Value } from "../src";

/**
 * Differential test: LibreOffice is an independent spreadsheet engine that reads the same XLSX file. Where it and
 * Pli disagree on a formula, one of them is wrong (usually Pli, since LibreOffice has had years of testing against
 * Excel). Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);

const DATA: Record<string, string | number | boolean> = {
  C1: 3, C2: 1, C3: 4, C4: 1, C5: 5, C6: 9, C7: 2, C8: 6,
  D1: "'apple", D2: "'Banana", D3: "'cherry", D4: "'apple pie", D5: "'fig", D6: "'date", D7: "'elder", D8: "'grape",
  E1: 10, E2: 20, E3: 30, E4: 40, E5: 50, E6: 60, E7: 70, E8: 80,
  F1: true, F2: "'text", F3: 7, G1: 45356, G2: 45000.75, H1: "'  padded   text ",
};

/** Where LibreOffice is known to differ from Excel; Pli follows Excel, and the test checks that it does. */
const EXCEL_DIFFERS: Record<string, Value> = {
  "0^0": { error: "#NUM!" },
  "POWER(0,0)": { error: "#NUM!" },
  '"a"&TRUE': "aTRUE",
  'CONCATENATE("a",1,TRUE)': "a1TRUE",
  "TRUE>5": true, // booleans sort above numbers
  "F1=1": false, // TRUE is not equal to 1
  "DOLLAR(-5)": "($5.00)",
};

const MORE_FORMULAS = [
  // statistics and distributions
  "AVEDEV(C1:C8)", "DEVSQ(C1:C8)", "HARMEAN(C1:C8)", "TRIMMEAN(C1:C8,0.25)", "SKEW(C1:C8)", "SKEW.P(C1:C8)", "KURT(C1:C8)", "STANDARDIZE(5,3,2)", "FISHER(0.5)", "FISHERINV(0.5)",
  "PERCENTILE.EXC(C1:C8,0.25)", "QUARTILE.EXC(C1:C8,1)", "PERCENTRANK(C1:C8,4)", "PERCENTRANK.EXC(C1:C8,4)", "PERCENTRANK.INC(C1:C8,2.5)", "RSQ(E1:E8,C1:C8)", "PEARSON(C1:C8,E1:E8)", "STEYX(E1:E8,C1:C8)",
  "COVAR(C1:C8,E1:E8)", "COVARIANCE.P(C1:C8,E1:E8)", "COVARIANCE.S(C1:C8,E1:E8)", "MODE(C1:C8)", "SUM(FREQUENCY(C1:C8,{2,4,6}))", "SUM(TREND(E1:E8,C1:C8,{10,11}))", "MAXA(C1:C8,D1:D2)", "MINA(C1:C8,D1:D2)", "STDEVA(C1:C4)", "VARA(C1:C4)",
  "NORM.S.DIST(1.5,TRUE)", "NORM.S.DIST(1.5,FALSE)", "NORM.S.INV(0.9)", "NORM.DIST(42,40,1.5,TRUE)", "NORM.DIST(42,40,1.5,FALSE)", "NORM.INV(0.8,10,2)", "NORMSDIST(0.3)", "NORMSINV(0.3)", "GAUSS(1.2)", "PHI(0.7)",
  "LOGNORM.DIST(4,3.5,1.2,TRUE)", "LOGNORM.DIST(4,3.5,1.2,FALSE)", "LOGNORM.INV(0.3,1,0.5)", "CONFIDENCE.NORM(0.05,2.5,50)", "CONFIDENCE.T(0.05,2.5,50)",
  "BINOM.DIST(6,10,0.5,FALSE)", "BINOM.DIST(6,10,0.5,TRUE)", "BINOM.INV(10,0.3,0.7)", "POISSON.DIST(3,4,FALSE)", "POISSON.DIST(3,4,TRUE)", "NEGBINOM.DIST(4,3,0.4,FALSE)", "NEGBINOM.DIST(4,3,0.4,TRUE)", "HYPGEOM.DIST(2,5,8,20,FALSE)", "HYPGEOM.DIST(2,5,8,20,TRUE)",
  "EXPON.DIST(0.3,2,TRUE)", "EXPON.DIST(0.3,2,FALSE)", "WEIBULL.DIST(2,1.5,3,TRUE)", "WEIBULL.DIST(2,1.5,3,FALSE)", "GAMMA(4.5)", "GAMMALN(7.3)", "GAMMA.DIST(5,3,2,TRUE)", "GAMMA.DIST(5,3,2,FALSE)", "GAMMA.INV(0.6,3,2)",
  "BETA.DIST(0.4,2,3,TRUE)", "BETA.DIST(0.4,2,3,FALSE)", "BETA.DIST(5,2,3,TRUE,2,8)", "BETA.INV(0.5,2,3)", "T.DIST(1.5,10,TRUE)", "T.DIST(1.5,10,FALSE)", "T.DIST.RT(2.1,15)", "T.DIST.2T(2.1,15)", "T.INV(0.9,12)", "T.INV.2T(0.05,20)", "TDIST(2.1,15,2)", "TINV(0.1,15)",
  "CHISQ.DIST(4,3,TRUE)", "CHISQ.DIST(4,3,FALSE)", "CHISQ.DIST.RT(4,3)", "CHISQ.INV(0.8,5)", "CHISQ.INV.RT(0.1,5)", "F.DIST(2.5,4,9,TRUE)", "F.DIST(2.5,4,9,FALSE)", "F.DIST.RT(2.5,4,9)", "F.INV(0.9,4,9)", "F.INV.RT(0.05,4,9)",
  "COMBIN(10,3)", "COMBINA(5,3)", "PERMUT(8,3)", "PERMUTATIONA(4,3)",
  // math
  "ACOSH(2)", "ASINH(1.5)", "ATANH(0.4)", "ACOT(2)", "ACOTH(3)", "COT(0.7)", "COTH(0.7)", "CSC(0.7)", "CSCH(0.7)", "SEC(0.7)", "SECH(0.7)", "FACTDOUBLE(9)", "MULTINOMIAL(2,3,4)", "SQRTPI(3)", "SUMX2MY2(C1:C4,E1:E4)", "SUMX2PY2(C1:C4,E1:E4)", "SUMXMY2(C1:C4,E1:E4)",
  "CEILING.PRECISE(-4.1,2)", "FLOOR.PRECISE(-4.1,2)", "ISO.CEILING(4.3,2)", 'BASE(255,16,4)', 'DECIMAL("FF",16)', "MDETERM({1,2;3,4})", "SUM(MINVERSE({4,7;2,6}))", "SUM(MUNIT(3))", "SERIESSUM(2,0,1,C1:C3)",
  "AGGREGATE(9,6,C1:C8)", "AGGREGATE(4,6,C1:C8)", "AGGREGATE(14,6,C1:C8,2)", "AGGREGATE(12,6,C1:C8)",
  // engineering
  'BIN2DEC("1010")', 'BIN2DEC("1111111111")', 'BIN2HEX("11111111")', 'BIN2OCT("1001")', 'OCT2DEC("17")', 'OCT2BIN("17")', 'OCT2HEX("77")', 'HEX2DEC("FF")', 'HEX2DEC("FFFFFFFFFF")', 'HEX2BIN("F")', 'HEX2OCT("1F")',
  "DEC2BIN(9)", "DEC2BIN(-9)", "DEC2BIN(9,8)", "DEC2OCT(58)", "DEC2HEX(255)", "DEC2HEX(-1)", "DEC2HEX(255,6)", "BITAND(13,25)", "BITOR(13,25)", "BITXOR(5,3)", "BITLSHIFT(4,3)", "BITRSHIFT(40,2)", "DELTA(5,5)", "GESTEP(3,4)",
  "ERF(0.5)", "ERF(0.5,1.5)", "ERF.PRECISE(0.8)", "ERFC(0.8)", 'CONVERT(1,"mi","km")', 'CONVERT(100,"C","F")', 'CONVERT(1,"gal","l")', 'CONVERT(5,"kg","lbm")', 'CONVERT(2,"hr","mn")', 'CONVERT(1,"m","ft")',
  'COMPLEX(3,4)', 'IMREAL("3+4i")', 'IMAGINARY("3+4i")', 'IMABS("3+4i")', 'IMARGUMENT("3+4i")', 'IMCONJUGATE("3+4i")', 'IMSUM("3+4i","5-3i")', 'IMSUB("13+4i","5+3i")', 'IMPRODUCT("3+4i","5-3i")', 'IMDIV("-238+240i","10+24i")',
  // text and dates
  'TEXTBEFORE("a-b-c","-",2)', 'TEXTAFTER("a-b-c","-",-1)', 'TEXTBEFORE("a-b-c","x",1,0,0,"none")', 'TEXTAFTER("abc","x")', 'TEXTJOIN("|",TRUE,TEXTSPLIT("a,b,c",","))',
  "ISOWEEKNUM(G1)", "ISOWEEKNUM(DATE(2021,1,3))", "ISOWEEKNUM(DATE(2020,12,31))", 'NETWORKDAYS.INTL(DATE(2024,3,4),DATE(2024,3,17),11)', 'NETWORKDAYS.INTL(DATE(2024,3,4),DATE(2024,3,17),"0000011")', 'WORKDAY.INTL(DATE(2024,3,8),5,"0000001")', "WORKDAY.INTL(DATE(2024,3,8),-4,2)",
  // finance
  "XNPV(0.09,{-1000,300,400,500},{45000,45100,45200,45400})", "XIRR({-1000,300,400,500},{45000,45100,45200,45400})", "MIRR({-100,40,50,60},0.1,0.12)", "CUMIPMT(0.09/12,360,125000,1,12,0)", "CUMPRINC(0.09/12,360,125000,1,12,0)", "CUMIPMT(0.09/12,360,125000,13,24,1)",
  "DB(1000000,100000,6,1,7)", "DB(1000000,100000,6,3,7)", "DDB(2400,300,10,1)", "DDB(2400,300,10,3,1.5)", "SYD(30000,7500,10,3)", "EFFECT(0.0525,4)", "NOMINAL(0.0535,4)", "FVSCHEDULE(1000,{0.09,0.11,0.1})", "PDURATION(0.025,2000,2200)", "RRI(96,10000,11000)", "ISPMT(0.1/12,3,36,8000)",
  "DOLLARDE(1.02,16)", "DOLLARFR(1.125,16)", "TBILLPRICE(DATE(2024,3,31),DATE(2024,6,1),0.09)", "TBILLYIELD(DATE(2024,3,31),DATE(2024,6,1),98.45)", "TBILLEQ(DATE(2024,3,31),DATE(2024,6,1),0.0914)",
  // dynamic arrays and LET
  "SUM(FILTER(E1:E8,C1:C8>3))", "ROWS(UNIQUE(C1:C8))", "INDEX(SORT(C1:C8),3)", "INDEX(SORT(C1:C8,1,-1),3)", "INDEX(SORTBY(D1:D8,C1:C8),2)", "SUM(TAKE(E1:E8,3))", "SUM(DROP(E1:E8,6))", "SUM(CHOOSEROWS(E1:E8,1,-1))", "SUM(VSTACK(C1:C2,E1:E2))", "COLUMNS(HSTACK(C1:C2,E1:E2))",
  "ROWS(TOCOL(C1:E2))", "COLUMNS(TOROW(C1:C4))", "ROWS(WRAPROWS(C1:C8,3))", "SUM(EXPAND(C1:C2,3,2,1))", "SUM(SEQUENCE(3,2,5,2))", "LET(x,3,y,4,SQRT(x^2+y^2))", "SUM(MAP(C1:C4,LAMBDA(v,v*v)))", "REDUCE(0,C1:C4,LAMBDA(a,v,a+v))", "SUM(SCAN(0,C1:C4,LAMBDA(a,v,a+v)))",
];

const FORMULAS = [
  // arithmetic and precedence
  "1+2*3", "(1+2)*3", "2^3^2", "-2^2", "10%", "2^-1", "7/2", "1/0", "0^0", '"a"+1', '"3"+4', "TRUE+1", "C1+C2*C3", "-C1^2", "5-3-1", "2*3%",
  "1&2", '"a"&TRUE', 'C1&"x"', '"a"="A"', '"b">"a"', '"a">1', "TRUE>5", "1<>2", "C1>=3", '"10"=10', "F1=1",
  // math
  "SUM(C1:C8)", "SUM(C1:C8,E1:E2,5)", "SUM(F1:F3)", 'SUM("3",2)', "SUM(F1,F3)", "PRODUCT(C1:C3)", "SUMSQ(C1:C3)", "SUMPRODUCT(C1:C8,E1:E8)", "SUMPRODUCT((C1:C8>2)*(E1:E8))",
  "AVERAGE(C1:C8)", "AVERAGE(F1:F3)", "MAX(C1:C8)", "MIN(C1:C8)", "MAX(D1:D3)", "COUNT(C1:F3)", "COUNTA(C1:F3)", "COUNTBLANK(C1:H8)", "MEDIAN(C1:C8)", "MODE.SNGL(C1:C8)",
  "STDEV.S(C1:C8)", "STDEV.P(C1:C8)", "VAR.S(C1:C8)", "VAR.P(C1:C8)", "LARGE(C1:C8,3)", "SMALL(C1:C8,3)", "RANK(4,C1:C8)", "RANK(4,C1:C8,1)", "PERCENTILE(C1:C8,0.3)", "QUARTILE(C1:C8,3)",
  "CORREL(C1:C8,E1:E8)", "SLOPE(E1:E8,C1:C8)", "INTERCEPT(E1:E8,C1:C8)", "FORECAST(10,E1:E8,C1:C8)", "GEOMEAN(C1:C8)",
  "ROUND(2.5,0)", "ROUND(-2.5,0)", "ROUND(1.005,2)", "ROUND(1234.5678,-2)", "ROUND(2.675,2)", "ROUNDUP(1.21,1)", "ROUNDDOWN(-1.29,1)", "ROUNDUP(-1.21,1)", "INT(-1.5)", "TRUNC(-1.57,1)", "TRUNC(1234.5,-2)",
  "MOD(-3,2)", "MOD(3,-2)", "MOD(5.5,2)", "MOD(1,0)", "QUOTIENT(-7,2)", "CEILING(2.1,0.5)", "FLOOR(2.9,0.5)", "CEILING(-2.1,-1)", "MROUND(10,3)", "MROUND(-10,-3)", "EVEN(1.5)", "ODD(2)", "EVEN(-1)", "ODD(-2)",
  "SQRT(16)", "SQRT(-1)", "POWER(2,10)", "POWER(0,0)", "ABS(-4)", "SIGN(-9)", "FACT(5)", "FACT(-1)", "GCD(12,18)", "LCM(4,6)", "LOG(100,10)", "LOG(8,2)", "LOG10(1000)", "LN(EXP(2))", "EXP(1)", "PI()", "ATAN2(1,1)",
  "SIN(1)", "COS(1)", "TAN(1)", "ASIN(0.5)", "ACOS(0.5)", "ATAN(1)", "DEGREES(PI())", "RADIANS(180)", "ROMAN(1994)", "ARABIC(\"MCMXCIV\")", "SUM(SEQUENCE(4))",
  'COUNTIF(D1:D8,"apple")', 'COUNTIF(D1:D8,"apple*")', 'COUNTIF(D1:D8,"?????")', 'COUNTIF(E1:E8,">35")', 'COUNTIF(E1:E8,"<>30")', "COUNTIF(E1:E8,30)", 'COUNTIF(D1:D8,"*e*")', 'COUNTIF(C1:C8,">=3")', 'COUNTIF(D1:D8,"<>apple")',
  'SUMIF(D1:D8,"apple*",E1:E8)', 'SUMIF(E1:E8,">=30")', 'SUMIFS(E1:E8,D1:D8,"*e*",C1:C8,">1")', 'COUNTIFS(D1:D8,"*e*",E1:E8,"<50")', 'AVERAGEIF(D1:D8,"*e*",E1:E8)', 'MAXIFS(E1:E8,D1:D8,"*e*")', 'MINIFS(E1:E8,C1:C8,">1")',
  "SUBTOTAL(9,C1:C8)", "SUBTOTAL(1,C1:C8)", "SUBTOTAL(4,C1:C8)",
  // logic and information
  "IF(TRUE,1,1/0)", "IF(FALSE,1/0,2)", "IF(0,1)", "IF(C1>2,\"big\",\"small\")", 'IFERROR(1/0,"bad")', "IFERROR(5,0)", 'IFNA(NA(),"gone")', 'IFNA(1/0,1)', 'IFS(1>2,"a",2>1,"b")', "IFS(FALSE,1)",
  'SWITCH(2,1,"one",2,"two","other")', 'SWITCH(9,1,"one","other")', 'CHOOSE(2,"a","b","c")', "AND(TRUE,1,2>1)", "AND(TRUE,0)", "OR(FALSE,0,1)", "NOT(TRUE)", "XOR(TRUE,TRUE,TRUE)", "AND(1/0)", "AND(C1:C3)", "OR(D1:D3)",
  "ISNUMBER(1)", 'ISNUMBER("1")', 'ISTEXT("a")', "ISBLANK(Z1)", "ISBLANK(D1)", "ISERROR(1/0)", "ISNA(NA())", "ISERR(NA())", "ISEVEN(4)", "ISODD(4)", "ISLOGICAL(F1)", 'TYPE("a")', "TYPE(1)", "TYPE(TRUE)", "TYPE(1/0)", "N(TRUE)", "N(\"a\")", 'T("a")', "T(1)", "ERROR.TYPE(1/0)", "ERROR.TYPE(NA())",
  // text
  'LEN("hello")', "LEN(H1)", 'LEFT("hello",2)', 'RIGHT("hello",3)', 'MID("hello",2,3)', "LEFT(D1)", 'UPPER("aB")', 'LOWER("aB")', 'PROPER("hello wORLD it\'s")', "TRIM(H1)", 'CONCATENATE("a",1,TRUE)', 'CONCAT("a",D1:D2)', 'TEXTJOIN(", ",TRUE,"a","","b")', 'TEXTJOIN("-",FALSE,"a","","b")',
  'FIND("l","hello")', 'FIND("L","hello")', 'SEARCH("L","hello")', 'SEARCH("h*o","say hello")', 'SUBSTITUTE("a-b-c","-","+")', 'SUBSTITUTE("a-b-c","-","+",2)', 'REPLACE("abcdef",2,3,"X")', 'REPT("ab",3)', 'EXACT("a","A")', "CHAR(65)", 'CODE("A")', 'VALUE("1,234.5")', 'VALUE("12%")', 'VALUE("abc")', 'NUMBERVALUE("1.234,5",",",".")',
  'TEXT(1234.567,"#,##0.00")', 'TEXT(0.256,"0.0%")', 'TEXT(G1,"dddd d mmmm yyyy")', 'TEXT(G1,"yyyy-mm-dd")', 'TEXT(G2,"h:mm AM/PM")', 'TEXT(7,"000")', 'TEXT(-5,"0;(0)")', 'TEXT(0,"0;-0;""zero""")', 'TEXT(12345.678,"0.00E+00")', 'TEXT(1234567,"#,##0,")', 'TEXT(0.5,"#.00")', 'TEXT(1234.5,"$#,##0.00")',
  "FIXED(1234.567,1)", "FIXED(1234.567,1,TRUE)", "DOLLAR(-5)", "DOLLAR(1234.567,1)", "SUM(LEN(D1:D4))", 'SUMPRODUCT(--(D1:D8="apple"))',
  // dates
  "DATE(2024,3,5)", "DATE(1900,1,1)", "DATE(2024,14,1)", "DATE(2024,1,0)", "DATE(2024,-1,15)", "YEAR(G1)", "MONTH(G1)", "DAY(G1)", "WEEKDAY(G1)", "WEEKDAY(G1,2)", "WEEKDAY(G1,3)", "WEEKDAY(G1,11)", "HOUR(G2)", "MINUTE(G2)", "SECOND(G2)", "TIME(25,30,0)", "WEEKNUM(G1)",
  "EDATE(DATE(2024,1,31),1)", "EDATE(DATE(2024,3,31),-1)", "EOMONTH(DATE(2024,2,10),0)", "EOMONTH(DATE(2024,2,10),-2)", "DAYS(DATE(2024,3,1),DATE(2024,2,1))", "DAYS360(DATE(2024,1,31),DATE(2024,3,31))", 'DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"Y")',
  'DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"M")', 'DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"MD")', 'DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"YM")', 'DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"YD")', "NETWORKDAYS(DATE(2024,3,4),DATE(2024,3,10))", "NETWORKDAYS(DATE(2024,3,10),DATE(2024,3,4))",
  "WORKDAY(DATE(2024,3,8),1)", "WORKDAY(DATE(2024,3,8),-3)", 'DATEVALUE("2024-03-05")', '"2024-03-05"+1', 'TIMEVALUE("6:00 PM")', "YEARFRAC(DATE(2024,1,1),DATE(2024,7,1))", "YEARFRAC(DATE(2024,1,31),DATE(2024,3,1),1)", "YEARFRAC(DATE(2023,1,1),DATE(2024,3,1),3)",
  // lookup
  "VLOOKUP(4,C1:E8,3,FALSE)", "VLOOKUP(4,C1:E8,3)", 'VLOOKUP("fig",D1:E8,2,FALSE)', 'VLOOKUP("FIG",D1:E8,2,FALSE)', 'VLOOKUP("f*",D1:E8,2,FALSE)', "VLOOKUP(99,C1:E8,2,FALSE)", "VLOOKUP(1,C1:E8,9,FALSE)", 'HLOOKUP(10,E1:E8,1,FALSE)', "MATCH(4,C1:C8,0)", "MATCH(40,E1:E8,1)", "MATCH(35,E1:E8,1)", 'MATCH("g*",D1:D8,0)', "MATCH(9,C1:C8,0)",
  "INDEX(C1:E8,2,3)", "SUM(INDEX(C1:E8,0,3))", "SUM(INDEX(C1:E8,2,0))", "INDEX(D1:D8,3)", "INDEX(C1:E8,9,1)", "INDEX(C1:E8,MATCH(5,C1:C8,0),2)", "XLOOKUP(5,C1:C8,D1:D8)", 'XLOOKUP(99,C1:C8,D1:D8,"none")', "XLOOKUP(45,E1:E8,C1:C8,0,-1)", "XLOOKUP(45,E1:E8,C1:C8,0,1)", "XMATCH(50,E1:E8)", "LOOKUP(45,E1:E8,C1:C8)",
  "SUM(OFFSET(C1,1,0,3,1))", 'INDIRECT("D3")', 'SUM(INDIRECT("C1:C3"))', "ROW(C7)", "COLUMN(C7)", "ROWS(C1:E8)", "COLUMNS(C1:E8)", "ADDRESS(3,2)", "ADDRESS(3,2,4)", "SUM(TRANSPOSE(C1:C3))", "SUM(MMULT(C1:C2,TRANSPOSE(C1:C2)))",
  // finance
  "PMT(0.05/12,360,200000)", "PMT(0.05/12,360,200000,0,1)", "FV(0.06,10,-100)", "FV(0.06,10,-100,-1000,1)", "PV(0.08,20,500)", "NPER(0.01,-100,1000)", "RATE(48,-200,8000)", "NPV(0.1,100,100,100)", "IRR(Z1:Z4)", "IPMT(0.1/12,1,36,8000)", "IPMT(0.1/12,5,36,8000)", "PPMT(0.1/12,1,36,8000)", "SLN(30000,7500,10)",
];

const ALL = [...FORMULAS, ...MORE_FORMULAS];

function same(a: Value, b: string): boolean {
  if (isError(a)) return a.error === b || (b.startsWith("Err:") && true) || b === "#NAME?";
  if (typeof a === "boolean") return b === (a ? "TRUE" : "FALSE") || b === (a ? "1" : "0");
  if (typeof a === "number") {
    const n = Number(b);
    if (b.trim() === "" || !Number.isFinite(n)) return false;
    return Math.abs(a - n) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(n));
  }
  return (a ?? "") === b;
}

const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-lo-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("agrees with LibreOffice", () => {
  it("on a few hundred formulas", () => {
    const s = new SheetSession(createWorkbook("diff"), { now: () => 45000.5 });
    s.setCells("Sheet1", DATA);
    // IRR needs cash flows
    s.setCells("Sheet1", { Z1: -100, Z2: 40, Z3: 50, Z4: 60 });
    // Formulas go in column A from row 20 so they don't overlap the data.
    ALL.forEach((f, i) => s.setCell("Sheet1", `A${20 + i}`, "=" + f));
    writeFileSync(join(dir, "diff.xlsx"), toXlsx(s.state, { now: () => 45000.5 }));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,false,false", "--outdir", dir, join(dir, "diff.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const rows = parseCsv(readFileSync(join(dir, "diff.csv"), "utf8"));
    expect(rows.length).toBeGreaterThanOrEqual(19 + ALL.length);
    expect(ALL.length).toBeGreaterThan(500);
    const problems: string[] = [];
    ALL.forEach((f, i) => {
      const mine = s.value("Sheet1", `A${20 + i}`);
      const theirs = rows[19 + i]?.[0] ?? "";
      if (f in EXCEL_DIFFERS) {
        expect(mine, f).toEqual(EXCEL_DIFFERS[f]);
        return;
      }
      if (!same(mine, theirs)) problems.push(`${f}\n    Pli: ${isError(mine) ? mine.error : JSON.stringify(mine)}   LibreOffice: ${theirs}`);
    });
    expect(problems.join("\n")).toBe("");
  }, 150_000);

  it("reads a file LibreOffice saved, with the same formulas, values and formats", () => {
    const s = new SheetSession(createWorkbook("roundtrip"), { now: () => 45000.5 });
    s.setCells("Sheet1", { A1: "Name", B1: "Qty", C1: "Price", D1: "Total", A2: "Pens", B2: 3, C2: 1.5, D2: "=B2*C2", A3: "Paper", B3: 10, C3: 0.25, D3: "=B3*C3", A4: "Sum", D4: "=SUM(D2:D3)", F1: "3/5/2024", F2: "=F1+30", F3: "=IF(D4>5,\"big\",\"small\")", F4: "=VLOOKUP(\"Paper\",A2:C3,3,FALSE)" });
    s.setFormat("Sheet1", "C2:D4", "$#,##0.00");
    s.setStyle("Sheet1", "A1:D1", { bold: true, fill: "#ffee00", color: "#112233" });
    s.setColumnWidth("Sheet1", 1, 20);
    s.addSheet("Second");
    s.setCell("Second", "A1", "=Sheet1!D4*2");
    writeFileSync(join(dir, "rt.xlsx"), toXlsx(s.state, { now: () => 45000.5 }));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "rt.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const { workbook } = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "rt.xlsx"))));
    const t = new SheetSession(workbook, { now: () => 45000.5 });
    expect(t.state.sheets.map((x) => x.name)).toEqual(["Sheet1", "Second"]);
    for (const a of ["A1", "B2", "C3", "D2", "D4", "F1", "F2", "F3", "F4"]) {
      expect(t.value("Sheet1", a), a).toEqual(s.value("Sheet1", a));
      expect(t.cell("Sheet1", a)?.f?.replace("FALSE()", "FALSE"), a).toEqual(s.cell("Sheet1", a)?.f); // LibreOffice writes FALSE() for FALSE
    }
    expect(t.value("Second", "A1")).toBe(s.value("Second", "A1"));
    expect(t.cell("Sheet1", "D2")?.fmt?.replace(/\\/g, "")).toBe("$#,##0.00"); // LibreOffice writes \$
    expect(t.display("Sheet1", "D4").text).toBe("$7.00");
    expect(t.cell("Sheet1", "F1")?.fmt).toBe("m/d/yyyy");
    expect(t.cell("Sheet1", "A1")?.s).toMatchObject({ bold: true, fill: "#ffee00", color: "#112233" });
    expect(t.state.sheets[0]!.columns?.["A"]?.size).toBeGreaterThan(19);
  }, 150_000);
});
