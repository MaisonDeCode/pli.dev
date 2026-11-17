import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, isError, type Value } from "../src";

/** A workbook with the given cells on Sheet1, typed as a person would. */
function book(cells: Record<string, string | number | boolean>, options = {}): SheetSession {
  const s = new SheetSession(createWorkbook("t"), { now: () => 45000.5, random: () => 0.25, ...options });
  s.setCells("Sheet1", cells);
  return s;
}

function calc(formula: string, cells: Record<string, string | number | boolean> = {}): Value {
  const s = book({ ...cells, Z99: "=" + formula });
  return s.value("Sheet1", "Z99");
}

const err = (v: Value) => (isError(v) ? v.error : v);

describe("operators", () => {
  it("does arithmetic with Excel's precedence", () => {
    expect(calc("1+2*3")).toBe(7);
    expect(calc("(1+2)*3")).toBe(9);
    expect(calc("2^3^2")).toBe(64); // left to right: (2^3)^2
    expect(calc("-2^2")).toBe(4);
    expect(calc("10%")).toBe(0.1);
    expect(calc("50%*200")).toBe(100);
    expect(calc("2^-1")).toBe(0.5);
    expect(calc("7/2")).toBe(3.5);
  });

  it("gives Excel's errors", () => {
    expect(err(calc("1/0"))).toBe("#DIV/0!");
    expect(err(calc("0^0"))).toBe("#NUM!");
    expect(err(calc('"a"+1'))).toBe("#VALUE!");
    expect(err(calc("NOSUCH(1)"))).toBe("#NAME?");
    expect(err(calc("1+"))).toBe("#NAME?");
    expect(err(calc("A1/0", { A1: 1 }))).toBe("#DIV/0!");
    expect(err(calc("Sheet9!A1"))).toBe("#REF!");
    expect(err(calc("#N/A+1"))).toBe("#N/A");
  });

  it("coerces text, booleans and blanks", () => {
    expect(calc('"3"+4')).toBe(7);
    expect(calc("TRUE+TRUE")).toBe(2);
    expect(calc("A1+1")).toBe(1);
    expect(calc('"5%"+0')).toBe(0.05);
    expect(calc('1&2')).toBe("12");
    expect(calc('"a"&TRUE')).toBe("aTRUE");
    expect(calc('A1&"x"')).toBe("x");
  });

  it("compares like Excel: text ignores case, text sorts above numbers, TRUE above text", () => {
    expect(calc('"a"="A"')).toBe(true);
    expect(calc('"b">"a"')).toBe(true);
    expect(calc('"a">1')).toBe(true);
    expect(calc("TRUE>\"z\"")).toBe(true);
    expect(calc("1<>2")).toBe(true);
    expect(calc("A1=0")).toBe(true);
    expect(calc('A1=""')).toBe(true);
    expect(calc("2>=2")).toBe(true);
  });
});

describe("references", () => {
  it("reads cells, ranges and other sheets", () => {
    const s = book({ A1: 1, A2: 2, A3: 3, B1: "=SUM(A1:A3)", C1: "=Sheet2!A1*2", "D1": "='Sheet 3'!A1" });
    s.addSheet("Sheet2");
    s.setCell("Sheet2", "A1", 21);
    s.addSheet("Sheet 3");
    s.setCell("Sheet 3", "A1", "hi");
    expect(s.value("Sheet1", "B1")).toBe(6);
    expect(s.value("Sheet1", "C1")).toBe(42);
    expect(s.value("Sheet1", "D1")).toBe("hi");
  });

  it("follows chains and updates only what changed", () => {
    const s = book({ A1: 1, A2: "=A1+1", A3: "=A2+1", B1: "=A3*10" });
    expect(s.value("Sheet1", "B1")).toBe(30);
    s.setCell("Sheet1", "A1", 5);
    expect(s.value("Sheet1", "B1")).toBe(70);
    s.setCell("Sheet1", "A2", "=100");
    expect(s.value("Sheet1", "B1")).toBe(1010);
  });

  it("notices cells added to a range or a whole column after it was read", () => {
    const s = book({ A1: 1, A2: 2, B1: "=SUM(A1:A10)", B2: "=SUM(A:A)", B3: "=COUNT(A:A)" });
    expect(s.value("Sheet1", "B2")).toBe(3);
    s.setCell("Sheet1", "A5", 10);
    expect(s.value("Sheet1", "B1")).toBe(13);
    expect(s.value("Sheet1", "B2")).toBe(13);
    s.setCell("Sheet1", "A500", 5);
    expect(s.value("Sheet1", "B2")).toBe(18);
    expect(s.value("Sheet1", "B3")).toBe(4);
  });

  it("handles long chains without running out of stack", () => {
    const cells: Record<string, string | number> = { A1: 1 };
    for (let i = 2; i <= 5000; i++) cells[`A${i}`] = `=A${i - 1}+1`;
    const s = book(cells);
    expect(s.value("Sheet1", "A5000")).toBe(5000);
    s.setCell("Sheet1", "A1", 11);
    expect(s.value("Sheet1", "A5000")).toBe(5010);
  });

  it("reads circular references as 0 and says so", () => {
    const s = book({ A1: "=B1+1", B1: "=A1+1", C1: "=C1" });
    expect(isError(s.value("Sheet1", "A1"))).toBe(false);
    expect(s.value("Sheet1", "C1")).toBe(0);
    expect(s.calculator.isCircular("Sheet1", "C1")).toBe(true);
    expect(s.calculator.isCircular("Sheet1", "A1") || s.calculator.isCircular("Sheet1", "B1")).toBe(true);
  });

  it("defined names", () => {
    const s = book({ A1: 100, A2: 5 });
    s.defineName("Rate", "Sheet1!$A$2");
    s.defineName("Data", "Sheet1!A1:A2");
    s.setCell("Sheet1", "B1", "=A1*Rate");
    s.setCell("Sheet1", "B2", "=SUM(Data)");
    expect(s.value("Sheet1", "B1")).toBe(500);
    expect(s.value("Sheet1", "B2")).toBe(105);
    s.setCell("Sheet1", "A2", 6);
    expect(s.value("Sheet1", "B1")).toBe(600);
  });

  it("array arithmetic over ranges", () => {
    const cells = { A1: 1, A2: 2, A3: 3, B1: 10, B2: 20, B3: 30 };
    expect(calc("SUM(A1:A3*B1:B3)", cells)).toBe(140);
    expect(calc("SUMPRODUCT(A1:A3,B1:B3)", cells)).toBe(140);
    expect(calc("SUM(A1:A3*2)", cells)).toBe(12);
    expect(calc("SUM({1,2;3,4})")).toBe(10);
    expect(calc("SUM(IF(A1:A3>1,A1:A3,0))", cells)).toBe(5);
  });

  it("shows the first value of a formula that gives several (spilling isn't supported yet)", () => {
    const s = book({ A1: 1, A2: 2, A3: 3 });
    s.setCell("Sheet1", "B2", "=A1:A3*10");
    expect(s.value("Sheet1", "B2")).toBe(10);
    s.setCell("Sheet1", "B3", "=A2:A3"); // a bare range takes the cell on its own row, as in older Excel
    expect(s.value("Sheet1", "B3")).toBe(3);
  });

  it("a single-column range as a plain argument takes the cell on the formula's row", () => {
    const s = book({ A1: 1, A2: 2, A3: 3 });
    s.setCell("Sheet1", "B2", "=ABS(A1:A3)");
    expect(s.value("Sheet1", "B2")).toBe(1); // ABS of the array, first item
  });
});

describe("math and statistics", () => {
  it("sums, averages, counts", () => {
    const c = { A1: 1, A2: 2, A3: "x", A4: true, A5: "" };
    expect(calc("SUM(A1:A5)", c)).toBe(3);
    expect(calc("SUM(A1,A2,TRUE)", c)).toBe(4);
    expect(calc('SUM("3",2)')).toBe(5);
    expect(err(calc('SUM("x")'))).toBe("#VALUE!");
    expect(calc("AVERAGE(A1:A4)", c)).toBe(1.5);
    expect(calc("COUNT(A1:A5)", c)).toBe(2);
    expect(calc("COUNTA(A1:A5)", c)).toBe(4);
    expect(calc("COUNTBLANK(A1:A6)", c)).toBe(2);
    expect(calc("MAX(A1:A4)", c)).toBe(2);
    expect(calc("MIN(5,3,9)")).toBe(3);
    expect(calc("MAX(A9:A10)")).toBe(0);
    expect(err(calc("AVERAGE(A9:A10)"))).toBe("#DIV/0!");
  });

  it("rounds like Excel", () => {
    expect(calc("ROUND(2.5,0)")).toBe(3);
    expect(calc("ROUND(-2.5,0)")).toBe(-3);
    expect(calc("ROUND(1.005,2)")).toBe(1.01);
    expect(calc("ROUND(1234.5678,-2)")).toBe(1200);
    expect(calc("ROUNDUP(1.21,1)")).toBe(1.3);
    expect(calc("ROUNDDOWN(-1.29,1)")).toBe(-1.2);
    expect(calc("INT(-1.5)")).toBe(-2);
    expect(calc("TRUNC(-1.5)")).toBe(-1);
    expect(calc("MOD(-3,2)")).toBe(1);
    expect(calc("MOD(3,-2)")).toBe(-1);
    expect(calc("CEILING(2.1,0.5)")).toBe(2.5);
    expect(calc("FLOOR(2.9,0.5)")).toBe(2.5);
    expect(calc("MROUND(10,3)")).toBe(9);
    expect(calc("EVEN(1.5)")).toBe(2);
    expect(calc("ODD(2)")).toBe(3);
  });

  it("more math", () => {
    expect(calc("SQRT(16)")).toBe(4);
    expect(err(calc("SQRT(-1)"))).toBe("#NUM!");
    expect(calc("POWER(2,10)")).toBe(1024);
    expect(calc("ABS(-4)")).toBe(4);
    expect(calc("SIGN(-9)")).toBe(-1);
    expect(calc("FACT(5)")).toBe(120);
    expect(calc("GCD(12,18)")).toBe(6);
    expect(calc("LCM(4,6)")).toBe(12);
    expect(calc("LOG(100,10)")).toBeCloseTo(2);
    expect(calc("LOG10(1000)")).toBeCloseTo(3);
    expect(calc("LN(EXP(2))")).toBeCloseTo(2);
    expect(calc("PI()")).toBeCloseTo(Math.PI);
    expect(calc("PRODUCT(2,3,4)")).toBe(24);
    expect(calc("RAND()")).toBe(0.25);
    expect(calc("RANDBETWEEN(1,10)")).toBe(3);
    expect(calc("SUM(SEQUENCE(4))")).toBe(10);
    expect(calc("ROMAN(1994)")).toBe("MCMXCIV");
    expect(calc('ARABIC("MCMXCIV")')).toBe(1994);
  });

  it("statistics", () => {
    const c = { A1: 2, A2: 4, A3: 4, A4: 4, A5: 5, A6: 5, A7: 7, A8: 9 };
    expect(calc("MEDIAN(A1:A8)", c)).toBe(4.5);
    expect(calc("MODE.SNGL(A1:A8)", c)).toBe(4);
    expect(calc("STDEV.P(A1:A8)", c)).toBe(2);
    expect(calc("STDEV.S(A1:A8)", c)).toBeCloseTo(2.13809, 4);
    expect(calc("VAR.P(A1:A8)", c)).toBe(4);
    expect(calc("LARGE(A1:A8,2)", c)).toBe(7);
    expect(calc("SMALL(A1:A8,1)", c)).toBe(2);
    expect(calc("RANK(7,A1:A8)", c)).toBe(2);
    expect(calc("PERCENTILE(A1:A8,0.5)", c)).toBe(4.5);
    expect(calc("QUARTILE(A1:A8,1)", c)).toBe(4);
    expect(calc("CORREL(A1:A4,A5:A8)", c)).toBeCloseTo(0.5222330, 5);
    expect(calc("SLOPE(A5:A8,A1:A4)", c)).toBeCloseTo(1, 6);
    expect(calc("INTERCEPT(A5:A8,A1:A4)", c)).toBeCloseTo(3, 6);
  });

  it("conditional sums and counts", () => {
    const c = { A1: "apple", A2: "banana", A3: "apple pie", A4: "cherry", B1: 10, B2: 20, B3: 30, B4: 40 };
    expect(calc('COUNTIF(A1:A4,"apple")', c)).toBe(1);
    expect(calc('COUNTIF(A1:A4,"apple*")', c)).toBe(2);
    expect(calc('COUNTIF(A1:A4,"?anana")', c)).toBe(1);
    expect(calc('COUNTIF(B1:B4,">15")', c)).toBe(3);
    expect(calc('COUNTIF(B1:B4,"<>20")', c)).toBe(3);
    expect(calc("COUNTIF(B1:B4,30)", c)).toBe(1);
    expect(calc('SUMIF(A1:A4,"apple*",B1:B4)', c)).toBe(40);
    expect(calc('SUMIF(B1:B4,">=20")', c)).toBe(90);
    expect(calc('SUMIFS(B1:B4,A1:A4,"apple*",B1:B4,">10")', c)).toBe(30);
    expect(calc('COUNTIFS(A1:A4,"*e*",B1:B4,"<40")', c)).toBe(2);
    expect(calc('AVERAGEIF(A1:A4,"apple*",B1:B4)', c)).toBe(20);
    expect(calc('MAXIFS(B1:B4,A1:A4,"apple*")', c)).toBe(30);
    expect(calc('MINIFS(B1:B4,A1:A4,"<>apple")', c)).toBe(20);
  });
});

describe("logic", () => {
  it("IF is lazy and IFERROR catches", () => {
    expect(calc("IF(TRUE,1,1/0)")).toBe(1);
    expect(calc("IF(FALSE,1/0,2)")).toBe(2);
    expect(calc("IF(0,1)")).toBe(false);
    expect(calc('IFERROR(1/0,"bad")')).toBe("bad");
    expect(calc("IFERROR(5,0)")).toBe(5);
    expect(calc('IFNA(NA(),"gone")')).toBe("gone");
    expect(err(calc("IFNA(1/0,1)"))).toBe("#DIV/0!");
    expect(calc('IFS(1>2,"a",2>1,"b")')).toBe("b");
    expect(err(calc("IFS(FALSE,1)"))).toBe("#N/A");
    expect(calc('SWITCH(2,1,"one",2,"two","other")')).toBe("two");
    expect(calc('SWITCH(9,1,"one","other")')).toBe("other");
    expect(calc('CHOOSE(2,"a","b","c")')).toBe("b");
  });

  it("AND, OR, NOT, XOR", () => {
    expect(calc("AND(TRUE,1,2>1)")).toBe(true);
    expect(calc("AND(TRUE,0)")).toBe(false);
    expect(calc("OR(FALSE,0,1)")).toBe(true);
    expect(calc("NOT(TRUE)")).toBe(false);
    expect(calc("XOR(TRUE,TRUE,TRUE)")).toBe(true);
    expect(err(calc("AND(1/0)"))).toBe("#DIV/0!");
  });

  it("information functions", () => {
    expect(calc("ISNUMBER(1)")).toBe(true);
    expect(calc('ISNUMBER("1")')).toBe(false);
    expect(calc('ISTEXT("a")')).toBe(true);
    expect(calc("ISBLANK(A1)")).toBe(true);
    expect(calc("ISERROR(1/0)")).toBe(true);
    expect(calc("ISNA(NA())")).toBe(true);
    expect(calc("ISERR(NA())")).toBe(false);
    expect(calc("ISEVEN(4)")).toBe(true);
    expect(calc("ISODD(4)")).toBe(false);
    expect(calc('TYPE("a")')).toBe(2);
    expect(calc("N(TRUE)")).toBe(1);
  });
});

describe("text", () => {
  it("basic text functions", () => {
    expect(calc('LEN("hello")')).toBe(5);
    expect(calc('LEFT("hello",2)')).toBe("he");
    expect(calc('RIGHT("hello",3)')).toBe("llo");
    expect(calc('MID("hello",2,3)')).toBe("ell");
    expect(calc('UPPER("aB")')).toBe("AB");
    expect(calc('LOWER("aB")')).toBe("ab");
    expect(calc('PROPER("hello wORLD")')).toBe("Hello World");
    expect(calc('TRIM("  a   b  ")')).toBe("a b");
    expect(calc('CONCATENATE("a",1,TRUE)')).toBe("a1TRUE");
    expect(calc('CONCAT("a",A1:A2)', { A1: "b", A2: 3 })).toBe("ab3");
    expect(calc('TEXTJOIN(", ",TRUE,"a","","b")')).toBe("a, b");
    expect(calc('FIND("l","hello")')).toBe(3);
    expect(err(calc('FIND("L","hello")'))).toBe("#VALUE!");
    expect(calc('SEARCH("L","hello")')).toBe(3);
    expect(calc('SEARCH("h*o","say hello")')).toBe(5);
    expect(calc('SUBSTITUTE("a-b-c","-","+")')).toBe("a+b+c");
    expect(calc('SUBSTITUTE("a-b-c","-","+",2)')).toBe("a-b+c");
    expect(calc('REPLACE("abcdef",2,3,"X")')).toBe("aXef");
    expect(calc('REPT("ab",3)')).toBe("ababab");
    expect(calc('EXACT("a","A")')).toBe(false);
    expect(calc("CHAR(65)")).toBe("A");
    expect(calc('CODE("A")')).toBe(65);
    expect(calc('VALUE("1,234.5")')).toBe(1234.5);
    expect(calc('VALUE("12%")')).toBe(0.12);
    expect(err(calc('VALUE("abc")'))).toBe("#VALUE!");
    expect(calc('NUMBERVALUE("1.234,5",",",".")')).toBe(1234.5);
  });

  it("TEXT and FIXED apply formats", () => {
    expect(calc('TEXT(1234.567,"#,##0.00")')).toBe("1,234.57");
    expect(calc('TEXT(0.256,"0.0%")')).toBe("25.6%");
    expect(calc('TEXT(DATE(2024,3,5),"dddd d mmmm yyyy")')).toBe("Tuesday 5 March 2024");
    expect(calc('TEXT("7","000")')).toBe("007");
    expect(calc("FIXED(1234.567,1)")).toBe("1,234.6");
    expect(calc("DOLLAR(-5)")).toBe("($5.00)");
  });

  it("maps over arrays", () => {
    expect(calc('SUM(LEN(A1:A3))', { A1: "a", A2: "bb", A3: "ccc" })).toBe(6);
    expect(calc('SUMPRODUCT(--(A1:A3="b"))', { A1: "a", A2: "b", A3: "b" })).toBe(2);
  });
});

describe("dates", () => {
  it("builds and takes apart dates", () => {
    expect(calc("DATE(2024,3,5)")).toBe(45356);
    expect(calc("DATE(1900,1,1)")).toBe(1);
    expect(calc("DATE(1900,3,1)")).toBe(61);
    expect(calc("DATE(2024,14,1)")).toBe(calc("DATE(2025,2,1)"));
    expect(calc("DATE(2024,1,0)")).toBe(calc("DATE(2023,12,31)"));
    expect(calc("YEAR(45356)")).toBe(2024);
    expect(calc("MONTH(45356)")).toBe(3);
    expect(calc("DAY(45356)")).toBe(5);
    expect(calc("WEEKDAY(45356)")).toBe(3);
    expect(calc("WEEKDAY(45356,2)")).toBe(2);
    expect(calc("HOUR(0.75)")).toBe(18);
    expect(calc("MINUTE(TIME(1,30,0))")).toBe(30);
    expect(calc("TODAY()")).toBe(45000);
    expect(calc("NOW()")).toBe(45000.5);
  });

  it("date arithmetic", () => {
    expect(calc("EDATE(DATE(2024,1,31),1)")).toBe(calc("DATE(2024,2,29)"));
    expect(calc("EOMONTH(DATE(2024,2,10),0)")).toBe(calc("DATE(2024,2,29)"));
    expect(calc("DAYS(DATE(2024,3,1),DATE(2024,2,1))")).toBe(29);
    expect(calc('DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"Y")')).toBe(4);
    expect(calc('DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"M")')).toBe(49);
    expect(calc('DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"MD")')).toBe(24);
    expect(calc("NETWORKDAYS(DATE(2024,3,4),DATE(2024,3,10))")).toBe(5);
    expect(calc("WORKDAY(DATE(2024,3,8),1)")).toBe(calc("DATE(2024,3,11)"));
    expect(calc('DATEVALUE("2024-03-05")')).toBe(45356);
    expect(calc('"2024-03-05"+1')).toBe(45357);
    expect(calc("YEARFRAC(DATE(2024,1,1),DATE(2024,7,1))")).toBe(0.5);
  });
});

describe("lookup", () => {
  const table = { A1: "id", B1: "name", C1: "age", A2: 1, B2: "Ann", C2: 30, A3: 2, B3: "Bo", C3: 25, A4: 3, B4: "Cy", C4: 41 };
  it("VLOOKUP and HLOOKUP", () => {
    expect(calc("VLOOKUP(2,A2:C4,2,FALSE)", table)).toBe("Bo");
    expect(calc("VLOOKUP(2.5,A2:C4,3)", table)).toBe(25);
    expect(err(calc("VLOOKUP(9,A2:C4,2,FALSE)", table))).toBe("#N/A");
    expect(err(calc("VLOOKUP(1,A2:C4,5,FALSE)", table))).toBe("#REF!");
    expect(calc('VLOOKUP("bo",B2:C4,2,FALSE)', table)).toBe(25);
    expect(calc('HLOOKUP("age",A1:C4,3,FALSE)', table)).toBe(25);
    expect(calc("VLOOKUP(3,A:C,3,FALSE)", table)).toBe(41);
  });

  it("MATCH, INDEX, XLOOKUP", () => {
    expect(calc("MATCH(3,A2:A4,0)", table)).toBe(3);
    expect(calc("MATCH(2.5,A2:A4,1)", table)).toBe(2);
    expect(calc('MATCH("C*",B2:B4,0)', table)).toBe(3);
    expect(calc("INDEX(A2:C4,2,3)", table)).toBe(25);
    expect(calc("SUM(INDEX(A2:C4,0,3))", table)).toBe(96);
    expect(calc("SUM(INDEX(A2:C4,2,0))", table)).toBe(27);
    expect(calc("INDEX(B2:B4,3)", table)).toBe("Cy");
    expect(calc("INDEX(A2:C4,MATCH(3,A2:A4,0),2)", table)).toBe("Cy");
    expect(calc('XLOOKUP(2,A2:A4,B2:B4)', table)).toBe("Bo");
    expect(calc('XLOOKUP(9,A2:A4,B2:B4,"none")', table)).toBe("none");
    expect(calc("XLOOKUP(26,C2:C4,A2:A4,0,-1)", table)).toBe(2);
    expect(calc("XLOOKUP(26,C2:C4,A2:A4,0,1)", table)).toBe(1);
    expect(calc("XMATCH(41,C2:C4)", table)).toBe(3);
    expect(calc("LOOKUP(2,A2:A4,C2:C4)", table)).toBe(25);
  });

  it("OFFSET, INDIRECT, ROW, COLUMN, ADDRESS", () => {
    expect(calc("SUM(OFFSET(A1,1,0,3,1))", table)).toBe(6);
    expect(calc('INDIRECT("B3")', table)).toBe("Bo");
    expect(calc('SUM(INDIRECT("A2:A4"))', table)).toBe(6);
    expect(calc('INDIRECT("Sheet1!C"&2)', table)).toBe(30);
    expect(err(calc('INDIRECT("nonsense!")', table))).toBe("#REF!");
    expect(calc("ROW(C7)")).toBe(7);
    expect(calc("COLUMN(C7)")).toBe(3);
    expect(calc("ROWS(A1:C4)")).toBe(4);
    expect(calc("COLUMNS(A1:C4)")).toBe(3);
    expect(calc("ROW()", {})).toBe(99);
    expect(calc("ADDRESS(3,2)")).toBe("$B$3");
    expect(calc("ADDRESS(3,2,4)")).toBe("B3");
    expect(calc("SUM(TRANSPOSE(A2:A4))", table)).toBe(6);
  });

  it("recalculates volatile cells and what depends on dynamic references", () => {
    const s = book({ A1: 1, A2: 2, B1: '=INDIRECT("A"&C1)', C1: 1 });
    expect(s.value("Sheet1", "B1")).toBe(1);
    s.setCell("Sheet1", "C1", 2);
    expect(s.value("Sheet1", "B1")).toBe(2);
    s.setCell("Sheet1", "A2", 20);
    expect(s.value("Sheet1", "B1")).toBe(20);
  });
});

describe("finance", () => {
  it("loans and investments", () => {
    expect(calc("PMT(0.05/12,360,200000)")).toBeCloseTo(-1073.64, 2);
    expect(calc("FV(0.06,10,-100)")).toBeCloseTo(1318.08, 2);
    expect(calc("PV(0.08,20,500)")).toBeCloseTo(-4909.07, 2);
    expect(calc("NPER(0.01,-100,1000)")).toBeCloseTo(10.59, 2);
    expect(calc("RATE(48,-200,8000)")).toBeCloseTo(0.0077, 4);
    expect(calc("NPV(0.1,100,100,100)")).toBeCloseTo(248.69, 2);
    expect(calc("IRR(A1:A4)", { A1: -100, A2: 40, A3: 50, A4: 60 })).toBeCloseTo(0.2165, 3);
    expect(calc("IPMT(0.1/12,1,36,8000)")).toBeCloseTo(-66.67, 2);
    expect(calc("PPMT(0.1/12,1,36,8000)")).toBeCloseTo(-191.47, 2);
    expect(calc("SLN(30000,7500,10)")).toBe(2250);
  });
});
