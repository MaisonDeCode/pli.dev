import { BONDS } from "./catalog-bonds";
import { FORECAST } from "./catalog-forecast";
import { MORE } from "./catalog-more";
import { getFunction } from "./functions";

/** One argument of a function. */
export interface FunctionParam {
  name: string;
  description: string;
  /** Can be left out. */
  optional: boolean;
  /** Can be repeated (the last argument of `SUM`). */
  repeats: boolean;
}

/** What a person typing a formula needs to know about a function. */
export interface FunctionInfo {
  /** In capitals. */
  name: string;
  category: FunctionCategory;
  /** What it does, in a sentence. */
  summary: string;
  params: FunctionParam[];
  /** The syntax, as in `SUM(number1, [number2], …)`. */
  syntax: string;
  /** A formula that shows it at work. */
  example: string;
  /** What the example gives, in words. */
  result: string;
  /** Whether it is worked out again on every change (`NOW`, `RAND`, `OFFSET`…). */
  volatile: boolean;
}

export type FunctionCategory = "Math" | "Statistical" | "Logical" | "Information" | "Text" | "Date and time" | "Lookup and reference" | "Financial";

// name | category | summary | params | example | result
// Params are "name: what it is" separated by "|"; [brackets] mean optional and a trailing … means it can repeat.
const TABLE = `
ABS|Math|Gives a number without its sign.|number: The number.|=ABS(-4)|4
ACOS|Math|Gives the angle, in radians, whose cosine is a number.|number: A cosine from -1 to 1.|=ACOS(0.5)|1.047, which is 60 degrees
ADDRESS|Lookup and reference|Writes a cell's address as text.|row: The row number.|column: The column number.|[abs]: 1 for $A$1 (the default), 2 for A$1, 3 for $A1, 4 for A1.|[a1]: TRUE for A1 style (the default).|[sheet]: A sheet name to put in front.|=ADDRESS(3,2)|"$B$3"
AND|Logical|Is TRUE when all its arguments are true.|logical1: A condition, or a range of them.|[logical2]…: More conditions.|=AND(A1>0,B1<10)|TRUE when both conditions hold
ARABIC|Math|Turns a Roman numeral into a number.|text: The Roman numeral.|=ARABIC("MCMXCIV")|1994
ASIN|Math|Gives the angle, in radians, whose sine is a number.|number: A sine from -1 to 1.|=ASIN(0.5)|0.5236, which is 30 degrees
ATAN|Math|Gives the angle, in radians, whose tangent is a number.|number: A tangent.|=ATAN(1)|0.7854, which is 45 degrees
ATAN2|Math|Gives the angle, in radians, of the point (x, y) from the x axis.|x: The x coordinate.|y: The y coordinate.|=ATAN2(1,1)|0.7854
AVERAGE|Statistical|Gives the average of the numbers in its arguments.|number1: A number or range.|[number2]…: More numbers or ranges.|=AVERAGE(A1:A10)|The mean of the numbers in A1:A10
AVERAGEA|Statistical|Gives the average, counting text as 0 and TRUE as 1.|value1: A value or range.|[value2]…: More values or ranges.|=AVERAGEA(A1:A5)|The mean, with text counted as 0
AVERAGEIF|Statistical|Gives the average of the cells that meet a condition.|range: The cells to test.|criteria: The condition, such as ">5" or "apple*".|[average_range]: The cells to average, if not the same as range.|=AVERAGEIF(A1:A9,">5",B1:B9)|The average of B where A is over 5
AVERAGEIFS|Statistical|Gives the average of the cells that meet all of several conditions.|average_range: The cells to average.|criteria_range1: The first cells to test.|criteria1: The first condition.|[criteria_range2, criteria2]…: More pairs.|=AVERAGEIFS(C:C,A:A,"East",B:B,">100")|The average of C for East rows over 100
CEILING|Math|Rounds a number up to a multiple of another.|number: The number to round.|significance: The multiple to round to.|=CEILING(2.1,0.5)|2.5
CEILING.MATH|Math|Rounds a number up to the next multiple, with a sign-aware rule.|number: The number to round.|[significance]: The multiple, 1 by default.|=CEILING.MATH(4.3)|5
CHAR|Text|Gives the character with a code from 1 to 255.|number: The code.|=CHAR(65)|"A"
CHOOSE|Logical|Picks one of its values by position.|index: Which value to give, counting from 1.|value1: The first value.|[value2]…: More values.|=CHOOSE(2,"a","b","c")|"b"
CLEAN|Text|Takes the unprintable characters out of text.|text: The text to clean.|=CLEAN(A1)|The text in A1 without control characters
CODE|Text|Gives the code of the first character of text.|text: The text.|=CODE("A")|65
COLUMN|Lookup and reference|Gives the column number of a cell.|[reference]: A cell. The formula's own column if left out.|=COLUMN(C7)|3
COLUMNS|Lookup and reference|Counts the columns in a range.|array: A range or array.|=COLUMNS(A1:C4)|3
CONCAT|Text|Joins text from cells and ranges.|text1: Text, a cell or a range.|[text2]…: More text.|=CONCAT(A1:A3)|The three cells run together
CONCATENATE|Text|Joins pieces of text.|text1: The first text.|[text2]…: More text.|=CONCATENATE(A1," ",B1)|The two cells with a space between
CORREL|Statistical|Gives how closely two sets of numbers move together, from -1 to 1.|array1: The first set.|array2: The second set.|=CORREL(A1:A9,B1:B9)|The correlation of the two columns
COS|Math|Gives the cosine of an angle in radians.|angle: The angle in radians.|=COS(0)|1
COSH|Math|Gives the hyperbolic cosine of a number.|number: The number.|=COSH(0)|1
COUNT|Statistical|Counts the cells that hold numbers.|value1: A value or range.|[value2]…: More values or ranges.|=COUNT(A1:A10)|How many of A1:A10 are numbers
COUNTA|Statistical|Counts the cells that are not empty.|value1: A value or range.|[value2]…: More values or ranges.|=COUNTA(A1:A10)|How many of A1:A10 have something in them
COUNTBLANK|Statistical|Counts the empty cells in a range.|range: The cells to look at.|=COUNTBLANK(A1:A10)|How many of A1:A10 are empty
COUNTIF|Statistical|Counts the cells that meet a condition.|range: The cells to test.|criteria: The condition, such as ">5", "<>x" or "ab*".|=COUNTIF(A1:A10,">5")|How many of A1:A10 are over 5
COUNTIFS|Statistical|Counts the rows that meet all of several conditions.|criteria_range1: The first cells to test.|criteria1: The first condition.|[criteria_range2, criteria2]…: More pairs.|=COUNTIFS(A:A,"East",B:B,">100")|East rows over 100
DATE|Date and time|Makes a date from a year, month and day.|year: The year.|month: The month, 1 to 12 (others roll over).|day: The day of the month (others roll over).|=DATE(2024,3,5)|5 March 2024
DATEDIF|Date and time|Gives the time between two dates in years, months or days.|start_date: The earlier date.|end_date: The later date.|unit: "Y", "M", "D", "MD", "YM" or "YD".|=DATEDIF(A1,B1,"Y")|The whole years from A1 to B1
DATEVALUE|Date and time|Turns text that looks like a date into a date.|date_text: The text, such as "2024-03-05".|=DATEVALUE("2024-03-05")|45356
DAY|Date and time|Gives the day of the month of a date.|serial_number: The date.|=DAY(A1)|The day of the month in A1
DAYS|Date and time|Counts the days between two dates.|end_date: The later date.|start_date: The earlier date.|=DAYS(B1,A1)|The days from A1 to B1
DAYS360|Date and time|Counts the days between two dates in a year of twelve 30-day months.|start_date: The first date.|end_date: The last date.|[method]: TRUE for the European method.|=DAYS360(A1,B1)|The days on a 360-day year
DEGREES|Math|Turns radians into degrees.|angle: The angle in radians.|=DEGREES(PI())|180
DOLLAR|Text|Writes a number as currency text.|number: The number.|[decimals]: Decimal places, 2 by default.|=DOLLAR(1234.5)|"$1,234.50"
EDATE|Date and time|Gives the date some months before or after another.|start_date: The date.|months: How many months to move, negative for earlier.|=EDATE(A1,3)|Three months after A1
EOMONTH|Date and time|Gives the last day of the month, some months away.|start_date: The date.|months: How many months to move (0 for this month).|=EOMONTH(A1,0)|The last day of A1's month
ERROR.TYPE|Information|Gives a number for the kind of error a cell has.|error_val: The error.|=ERROR.TYPE(#N/A)|7
EVEN|Math|Rounds a number away from zero to the next even number.|number: The number.|=EVEN(1.5)|2
EXACT|Text|Is TRUE when two texts are the same, capitals included.|text1: The first text.|text2: The second text.|=EXACT("a","A")|FALSE
EXP|Math|Gives e raised to a power.|number: The power.|=EXP(1)|2.71828
FACT|Math|Gives the factorial of a number.|number: A whole number from 0 to 170.|=FACT(5)|120
FALSE|Logical|Gives the value FALSE.|=FALSE()|FALSE
FIND|Text|Gives where some text starts inside other text, matching capitals.|find_text: The text to find.|within_text: The text to look in.|[start_num]: Where to start looking, 1 by default.|=FIND("l","hello")|3
FIXED|Text|Writes a number as text with a set number of decimals.|number: The number.|[decimals]: Decimal places, 2 by default.|[no_commas]: TRUE to leave out thousands separators.|=FIXED(1234.567,1)|"1,234.6"
FLOOR|Math|Rounds a number down to a multiple of another.|number: The number to round.|significance: The multiple to round to.|=FLOOR(2.9,0.5)|2.5
FLOOR.MATH|Math|Rounds a number down to the next multiple.|number: The number to round.|[significance]: The multiple, 1 by default.|=FLOOR.MATH(4.7)|4
FORECAST|Statistical|Predicts a value along a straight line fitted to known values.|x: The point to predict for.|known_ys: The known y values.|known_xs: The known x values.|=FORECAST(10,B1:B9,A1:A9)|The y value expected at x = 10
FV|Financial|Gives the future value of regular payments at a fixed interest rate.|rate: The interest rate for each period.|nper: The number of periods.|pmt: The payment each period (negative for money you pay).|[pv]: The present value, 0 by default.|[type]: 1 if payments are at the start of a period, 0 (the default) for the end.|=FV(0.06,10,-100)|1318.08
GCD|Math|Gives the greatest common divisor of whole numbers.|number1: A whole number.|[number2]…: More numbers.|=GCD(12,18)|6
GEOMEAN|Statistical|Gives the geometric mean of positive numbers.|number1: A number or range.|[number2]…: More numbers or ranges.|=GEOMEAN(A1:A5)|The geometric mean
HLOOKUP|Lookup and reference|Looks for a value in the top row of a table and gives a value from the same column.|lookup_value: The value to find.|table_array: The table, with the values to find in its first row.|row_index_num: Which row of the table to take the answer from.|[range_lookup]: FALSE for an exact match, TRUE (the default) for the nearest smaller.|=HLOOKUP("Q2",A1:D3,2,FALSE)|The value under Q2 on the second row
HOUR|Date and time|Gives the hour of a time, 0 to 23.|serial_number: The time.|=HOUR(0.75)|18
IF|Logical|Gives one value if a condition is true and another if it is not.|logical_test: The condition.|value_if_true: What to give when it is true.|[value_if_false]: What to give when it is false (FALSE if left out).|=IF(A1>10,"big","small")|"big" when A1 is over 10
IFERROR|Logical|Gives a fallback value if a formula gives an error.|value: The formula to try.|value_if_error: What to give if it fails.|=IFERROR(A1/B1,0)|0 when B1 is 0
IFNA|Logical|Gives a fallback value if a formula gives #N/A.|value: The formula to try.|value_if_na: What to give if it is #N/A.|=IFNA(VLOOKUP(A1,D:E,2,FALSE),"none")|"none" when A1 isn't found
IFS|Logical|Checks conditions in order and gives the value for the first that is true.|logical_test1: The first condition.|value_if_true1: What to give if it is true.|[logical_test2, value_if_true2]…: More pairs.|=IFS(A1>90,"A",A1>80,"B",TRUE,"C")|A grade for the score in A1
INDEX|Lookup and reference|Gives the cell at a row and column of a range.|array: The range.|row_num: The row, counting from 1 (0 for the whole column).|[column_num]: The column, counting from 1 (0 for the whole row).|[area_num]: Not used; for compatibility.|=INDEX(A1:C5,2,3)|The cell in the second row, third column
INDIRECT|Lookup and reference|Turns text into a reference.|ref_text: Text such as "B3" or "Sheet2!A1:A5".|[a1]: Always TRUE (A1 style).|=INDIRECT("B"&A1)|The cell in column B on the row A1 names
INT|Math|Rounds a number down to a whole number.|number: The number.|=INT(-1.5)|-2
INTERCEPT|Statistical|Gives where a straight line through known values crosses the y axis.|known_ys: The known y values.|known_xs: The known x values.|=INTERCEPT(B1:B9,A1:A9)|The y intercept
IPMT|Financial|Gives the interest part of a loan payment.|rate: The interest rate for each period.|per: Which period, counting from 1.|nper: The number of periods.|pv: The loan amount.|[fv]: The balance wanted at the end, 0 by default.|[type]: 1 for payments at the start of a period, 0 (the default) for the end.|=IPMT(0.1/12,1,36,8000)|-66.67
IRR|Financial|Gives the internal rate of return of a series of cash flows.|values: A range of cash flows, with at least one negative and one positive.|[guess]: A starting guess, 0.1 by default.|=IRR(A1:A5)|The rate that makes the flows' value 0
ISBLANK|Information|Is TRUE when a cell is empty.|value: The cell.|=ISBLANK(A1)|TRUE when A1 is empty
ISERR|Information|Is TRUE for any error except #N/A.|value: The value.|=ISERR(A1)|TRUE when A1 is an error other than #N/A
ISERROR|Information|Is TRUE for any error.|value: The value.|=ISERROR(A1/B1)|TRUE when the division fails
ISEVEN|Information|Is TRUE when a number is even.|number: The number.|=ISEVEN(4)|TRUE
ISFORMULA|Information|Is TRUE when a cell holds a formula.|reference: The cell.|=ISFORMULA(A1)|TRUE when A1 is a formula
ISLOGICAL|Information|Is TRUE when a value is TRUE or FALSE.|value: The value.|=ISLOGICAL(A1)|TRUE when A1 is TRUE or FALSE
ISNA|Information|Is TRUE when a value is #N/A.|value: The value.|=ISNA(A1)|TRUE when A1 is #N/A
ISNONTEXT|Information|Is TRUE when a value is not text.|value: The value.|=ISNONTEXT(A1)|TRUE when A1 isn't text
ISNUMBER|Information|Is TRUE when a value is a number.|value: The value.|=ISNUMBER(A1)|TRUE when A1 is a number
ISODD|Information|Is TRUE when a number is odd.|number: The number.|=ISODD(3)|TRUE
ISREF|Information|Is TRUE when a value is a reference.|value: The value.|=ISREF(A1)|TRUE
ISTEXT|Information|Is TRUE when a value is text.|value: The value.|=ISTEXT(A1)|TRUE when A1 is text
LARGE|Statistical|Gives the nth largest number in a set.|array: The numbers.|k: Which one, 1 for the largest.|=LARGE(A1:A9,2)|The second largest
LCM|Math|Gives the least common multiple of whole numbers.|number1: A whole number.|[number2]…: More numbers.|=LCM(4,6)|12
LEFT|Text|Gives the first characters of text.|text: The text.|[num_chars]: How many, 1 by default.|=LEFT("hello",2)|"he"
LEN|Text|Counts the characters in text.|text: The text.|=LEN("hello")|5
LN|Math|Gives the natural logarithm of a number.|number: A positive number.|=LN(EXP(2))|2
LOG|Math|Gives the logarithm of a number to a base.|number: A positive number.|[base]: The base, 10 by default.|=LOG(8,2)|3
LOG10|Math|Gives the base 10 logarithm of a number.|number: A positive number.|=LOG10(1000)|3
LOOKUP|Lookup and reference|Looks for a value in a sorted row or column and gives the matching value from another.|lookup_value: The value to find.|lookup_vector: A sorted row or column to look in.|[result_vector]: The row or column to take the answer from.|=LOOKUP(45,A1:A9,B1:B9)|The B value for the largest A not over 45
LOWER|Text|Turns text into lower case.|text: The text.|=LOWER("Hello")|"hello"
MATCH|Lookup and reference|Gives the position of a value in a row or column.|lookup_value: The value to find.|lookup_array: The row or column to look in.|[match_type]: 0 for an exact match, 1 (the default) for the largest not over the value in sorted data, -1 for the smallest not under it.|=MATCH("b",A1:A9,0)|The position of "b"
MAX|Statistical|Gives the largest number.|number1: A number or range.|[number2]…: More numbers or ranges.|=MAX(A1:A10)|The largest in A1:A10
MAXIFS|Statistical|Gives the largest number among the cells that meet conditions.|max_range: The cells to take the largest of.|criteria_range1: The first cells to test.|criteria1: The first condition.|[criteria_range2, criteria2]…: More pairs.|=MAXIFS(B:B,A:A,"East")|The largest B on East rows
MEDIAN|Statistical|Gives the middle number of a set.|number1: A number or range.|[number2]…: More numbers or ranges.|=MEDIAN(A1:A9)|The middle value
MID|Text|Gives some characters from the middle of text.|text: The text.|start_num: The position of the first character, 1 for the first.|num_chars: How many characters.|=MID("hello",2,3)|"ell"
MIN|Statistical|Gives the smallest number.|number1: A number or range.|[number2]…: More numbers or ranges.|=MIN(A1:A10)|The smallest in A1:A10
MINIFS|Statistical|Gives the smallest number among the cells that meet conditions.|min_range: The cells to take the smallest of.|criteria_range1: The first cells to test.|criteria1: The first condition.|[criteria_range2, criteria2]…: More pairs.|=MINIFS(B:B,A:A,"East")|The smallest B on East rows
MINUTE|Date and time|Gives the minute of a time, 0 to 59.|serial_number: The time.|=MINUTE(A1)|The minutes of A1
MMULT|Math|Multiplies two arrays as matrices.|array1: The first matrix.|array2: The second; it needs as many rows as the first has columns.|=MMULT(A1:B2,D1:E2)|The matrix product
MOD|Math|Gives the remainder after dividing.|number: The number to divide.|divisor: The number to divide by.|=MOD(10,3)|1
MODE.SNGL|Statistical|Gives the number that occurs most often.|number1: A number or range.|[number2]…: More numbers or ranges.|=MODE.SNGL(A1:A9)|The most common value
MONTH|Date and time|Gives the month of a date, 1 to 12.|serial_number: The date.|=MONTH(A1)|The month of A1
MROUND|Math|Rounds a number to the nearest multiple of another.|number: The number.|multiple: The multiple.|=MROUND(10,3)|9
N|Information|Turns a value into a number (TRUE is 1, text is 0).|value: The value.|=N(TRUE)|1
NA|Information|Gives the error #N/A, "no value available".|=NA()|#N/A
NETWORKDAYS|Date and time|Counts the weekdays between two dates.|start_date: The first date.|end_date: The last date.|[holidays]: Dates to leave out.|=NETWORKDAYS(A1,B1)|The working days from A1 to B1
NOT|Logical|Turns TRUE into FALSE and FALSE into TRUE.|logical: The condition.|=NOT(A1)|The opposite of A1
NOW|Date and time|Gives the current date and time.|=NOW()|The date and time right now
NPER|Financial|Gives how many periods a loan or investment lasts.|rate: The interest rate for each period.|pmt: The payment each period.|pv: The present value.|[fv]: The value wanted at the end, 0 by default.|[type]: 1 for payments at the start of a period, 0 (the default) for the end.|=NPER(0.01,-100,1000)|10.59
NPV|Financial|Gives the present value of cash flows at a discount rate.|rate: The discount rate for each period.|value1: A cash flow or range.|[value2]…: More cash flows.|=NPV(0.1,A1:A5)|The present value of A1:A5
NUMBERVALUE|Text|Turns text into a number, with the separators you say.|text: The text.|[decimal_separator]: The decimal mark, "." by default.|[group_separator]: The thousands mark, "," by default.|=NUMBERVALUE("1.234,5",",",".")|1234.5
ODD|Math|Rounds a number away from zero to the next odd number.|number: The number.|=ODD(2)|3
OFFSET|Lookup and reference|Gives a range some rows and columns away from a cell.|reference: The starting cell or range.|rows: How many rows down (negative for up).|cols: How many columns across.|[height]: How many rows in the result.|[width]: How many columns in the result.|=OFFSET(A1,2,1,3,1)|B3:B5
OR|Logical|Is TRUE when any of its arguments is true.|logical1: A condition, or a range of them.|[logical2]…: More conditions.|=OR(A1>0,B1>0)|TRUE when either is true
PERCENTILE|Statistical|Gives the value below which a share of the data falls.|array: The data.|k: The share, from 0 to 1.|=PERCENTILE(A1:A9,0.9)|The 90th percentile
PERCENTILE.INC|Statistical|Gives the value below which a share of the data falls (inclusive).|array: The data.|k: The share, from 0 to 1.|=PERCENTILE.INC(A1:A9,0.5)|The median
PI|Math|Gives the number pi.|=PI()|3.14159
PMT|Financial|Gives the payment on a loan.|rate: The interest rate for each period.|nper: The number of periods.|pv: The loan amount.|[fv]: The balance wanted at the end, 0 by default.|[type]: 1 for payments at the start of a period, 0 (the default) for the end.|=PMT(0.05/12,360,200000)|-1073.64
POWER|Math|Raises a number to a power.|number: The base.|power: The exponent.|=POWER(2,10)|1024
PPMT|Financial|Gives the principal part of a loan payment.|rate: The interest rate for each period.|per: Which period, counting from 1.|nper: The number of periods.|pv: The loan amount.|[fv]: The balance wanted at the end, 0 by default.|[type]: 1 for payments at the start of a period, 0 (the default) for the end.|=PPMT(0.1/12,1,36,8000)|-191.47
PRODUCT|Math|Multiplies numbers together.|number1: A number or range.|[number2]…: More numbers or ranges.|=PRODUCT(2,3,4)|24
PROPER|Text|Capitalises the first letter of each word.|text: The text.|=PROPER("hello world")|"Hello World"
PV|Financial|Gives the present value of regular payments.|rate: The interest rate for each period.|nper: The number of periods.|pmt: The payment each period.|[fv]: The value wanted at the end, 0 by default.|[type]: 1 for payments at the start of a period, 0 (the default) for the end.|=PV(0.08,20,500)|-4909.07
QUARTILE|Statistical|Gives a quartile of the data.|array: The data.|quart: 0 minimum, 1 first quartile, 2 median, 3 third quartile, 4 maximum.|=QUARTILE(A1:A9,3)|The third quartile
QUARTILE.INC|Statistical|Gives a quartile of the data (inclusive).|array: The data.|quart: 0 to 4.|=QUARTILE.INC(A1:A9,1)|The first quartile
QUOTIENT|Math|Gives the whole part of a division.|numerator: The number to divide.|denominator: The number to divide by.|=QUOTIENT(7,2)|3
RADIANS|Math|Turns degrees into radians.|angle: The angle in degrees.|=RADIANS(180)|3.14159
RAND|Math|Gives a random number from 0 up to 1.|=RAND()|A new random number each time
RANDBETWEEN|Math|Gives a random whole number between two numbers.|bottom: The smallest.|top: The largest.|=RANDBETWEEN(1,6)|A whole number from 1 to 6
RANK|Statistical|Gives where a number stands in a set.|number: The number.|ref: The set.|[order]: 0 or left out for largest first, 1 for smallest first.|=RANK(A1,A1:A9)|1 for the largest
RANK.AVG|Statistical|Gives where a number stands in a set, averaging ties.|number: The number.|ref: The set.|[order]: 0 or left out for largest first, 1 for smallest first.|=RANK.AVG(A1,A1:A9)|The rank, with ties averaged
RANK.EQ|Statistical|Gives where a number stands in a set; ties share the top rank.|number: The number.|ref: The set.|[order]: 0 or left out for largest first, 1 for smallest first.|=RANK.EQ(A1,A1:A9)|The rank
RATE|Financial|Gives the interest rate per period of a loan or investment.|nper: The number of periods.|pmt: The payment each period.|pv: The present value.|[fv]: The value wanted at the end, 0 by default.|[type]: 1 for payments at the start of a period, 0 (the default) for the end.|[guess]: A starting guess, 0.1 by default.|=RATE(48,-200,8000)|0.0077 a month
REPLACE|Text|Swaps part of text, by position, for other text.|old_text: The text.|start_num: Where to start replacing.|num_chars: How many characters to replace.|new_text: What to put in.|=REPLACE("abcdef",2,3,"X")|"aXef"
REPT|Text|Repeats text.|text: The text.|number_times: How many times.|=REPT("ab",3)|"ababab"
RIGHT|Text|Gives the last characters of text.|text: The text.|[num_chars]: How many, 1 by default.|=RIGHT("hello",3)|"llo"
ROMAN|Math|Turns a number into a Roman numeral.|number: A whole number from 0 to 3999.|[form]: Not used; for compatibility.|=ROMAN(1994)|"MCMXCIV"
ROUND|Math|Rounds a number to a number of decimals.|number: The number.|num_digits: Decimal places (negative rounds to tens, hundreds…).|=ROUND(2.675,2)|2.68
ROUNDDOWN|Math|Rounds a number towards zero.|number: The number.|num_digits: Decimal places.|=ROUNDDOWN(-1.29,1)|-1.2
ROUNDUP|Math|Rounds a number away from zero.|number: The number.|num_digits: Decimal places.|=ROUNDUP(1.21,1)|1.3
ROW|Lookup and reference|Gives the row number of a cell.|[reference]: A cell. The formula's own row if left out.|=ROW(C7)|7
ROWS|Lookup and reference|Counts the rows in a range.|array: A range or array.|=ROWS(A1:C4)|4
SEARCH|Text|Gives where some text starts inside other text, ignoring capitals; wildcards work.|find_text: The text to find ("?" is any character, "*" any run).|within_text: The text to look in.|[start_num]: Where to start looking, 1 by default.|=SEARCH("h*o","say hello")|5
SECOND|Date and time|Gives the second of a time, 0 to 59.|serial_number: The time.|=SECOND(A1)|The seconds of A1
SEQUENCE|Math|Gives a grid of numbers in order.|rows: How many rows.|[columns]: How many columns, 1 by default.|[start]: The first number, 1 by default.|[step]: The step between numbers, 1 by default.|=SUM(SEQUENCE(4))|10
SIGN|Math|Gives 1 for a positive number, -1 for a negative one and 0 for zero.|number: The number.|=SIGN(-9)|-1
SIN|Math|Gives the sine of an angle in radians.|angle: The angle in radians.|=SIN(PI()/2)|1
SINH|Math|Gives the hyperbolic sine of a number.|number: The number.|=SINH(0)|0
SLN|Financial|Gives the straight-line depreciation of an asset for one period.|cost: What the asset cost.|salvage: What it is worth at the end.|life: The number of periods.|=SLN(30000,7500,10)|2250
SLOPE|Statistical|Gives the slope of a straight line through known values.|known_ys: The known y values.|known_xs: The known x values.|=SLOPE(B1:B9,A1:A9)|The slope
SMALL|Statistical|Gives the nth smallest number in a set.|array: The numbers.|k: Which one, 1 for the smallest.|=SMALL(A1:A9,2)|The second smallest
SQRT|Math|Gives the square root of a number.|number: A number that is not negative.|=SQRT(16)|4
STDEV|Statistical|Gives the standard deviation of a sample.|number1: A number or range.|[number2]…: More numbers or ranges.|=STDEV(A1:A9)|The sample standard deviation
STDEV.P|Statistical|Gives the standard deviation of a whole population.|number1: A number or range.|[number2]…: More numbers or ranges.|=STDEV.P(A1:A9)|The population standard deviation
STDEV.S|Statistical|Gives the standard deviation of a sample.|number1: A number or range.|[number2]…: More numbers or ranges.|=STDEV.S(A1:A9)|The sample standard deviation
STDEVP|Statistical|Gives the standard deviation of a whole population.|number1: A number or range.|[number2]…: More numbers or ranges.|=STDEVP(A1:A9)|The population standard deviation
SUBSTITUTE|Text|Swaps text for other text wherever it appears.|text: The text.|old_text: What to replace.|new_text: What to put in.|[instance_num]: Replace only this occurrence; all if left out.|=SUBSTITUTE("a-b-c","-","+")|"a+b+c"
SUBTOTAL|Math|Gives a total, average, count and so on of a range.|function_num: 1 average, 2 count, 3 counta, 4 max, 5 min, 6 product, 9 sum (101 to 109 are the same).|ref1: A range.|[ref2]…: More ranges.|=SUBTOTAL(9,A1:A9)|The sum of A1:A9
SUM|Math|Adds numbers.|number1: A number, cell or range.|[number2]…: More numbers, cells or ranges.|=SUM(A1:A3)|The three cells added
SUMIF|Math|Adds the cells that meet a condition.|range: The cells to test.|criteria: The condition, such as ">5" or "apple*".|[sum_range]: The cells to add, if not the same as range.|=SUMIF(A1:A9,">5",B1:B9)|The sum of B where A is over 5
SUMIFS|Math|Adds the cells that meet all of several conditions.|sum_range: The cells to add.|criteria_range1: The first cells to test.|criteria1: The first condition.|[criteria_range2, criteria2]…: More pairs.|=SUMIFS(C:C,A:A,"East",B:B,">100")|The sum of C for East rows over 100
SUMPRODUCT|Math|Multiplies ranges item by item and adds the results.|array1: The first range.|[array2]…: More ranges of the same size.|=SUMPRODUCT(A1:A3,B1:B3)|A1*B1 + A2*B2 + A3*B3
SUMSQ|Math|Adds the squares of numbers.|number1: A number or range.|[number2]…: More numbers or ranges.|=SUMSQ(3,4)|25
SWITCH|Logical|Compares a value with a list and gives the result for the first match.|expression: The value to compare.|value1: The first value to match.|result1: What to give for it.|[value2, result2]…: More pairs, and a final default.|=SWITCH(A1,1,"one",2,"two","other")|"two" when A1 is 2
T|Information|Gives text as it is and anything else as empty text.|value: The value.|=T("a")|"a"
TAN|Math|Gives the tangent of an angle in radians.|angle: The angle in radians.|=TAN(0)|0
TANH|Math|Gives the hyperbolic tangent of a number.|number: The number.|=TANH(0)|0
TEXT|Text|Writes a value as text in a number format.|value: The number or date.|format_text: The format, such as "0.00", "#,##0", "0%" or "yyyy-mm-dd".|=TEXT(A1,"0.0%")|A1 as a percentage with one decimal
TEXTJOIN|Text|Joins text with a separator between the pieces.|delimiter: The text to put between pieces.|ignore_empty: TRUE to skip empty cells.|text1: Text, a cell or a range.|[text2]…: More text.|=TEXTJOIN(", ",TRUE,A1:A5)|The cells joined with commas
TIME|Date and time|Makes a time from hours, minutes and seconds.|hour: The hour.|minute: The minute.|second: The second.|=TIME(14,30,0)|2:30 PM
TIMEVALUE|Date and time|Turns text that looks like a time into a time.|time_text: The text, such as "6:00 PM".|=TIMEVALUE("6:00 PM")|0.75
TODAY|Date and time|Gives today's date.|=TODAY()|Today's date
TRANSPOSE|Math|Turns rows into columns and columns into rows.|array: The range.|=SUM(TRANSPOSE(A1:A3))|The sum, with the range turned on its side
TRIM|Text|Takes extra spaces out of text.|text: The text.|=TRIM("  a   b ")|"a b"
TRUE|Logical|Gives the value TRUE.|=TRUE()|TRUE
TRUNC|Math|Cuts a number off at a number of decimals.|number: The number.|[num_digits]: Decimal places, 0 by default.|=TRUNC(-1.57,1)|-1.5
TYPE|Information|Gives a number for the kind of value: 1 number, 2 text, 4 logical, 16 error, 64 array.|value: The value.|=TYPE(A1)|1 when A1 is a number
UNICHAR|Text|Gives the character with a Unicode number.|number: The code point.|=UNICHAR(9731)|"☃"
UNICODE|Text|Gives the Unicode number of the first character of text.|text: The text.|=UNICODE("A")|65
UPPER|Text|Turns text into capitals.|text: The text.|=UPPER("hello")|"HELLO"
VALUE|Text|Turns text that looks like a number into a number.|text: The text, such as "1,234.5" or "12%".|=VALUE("12%")|0.12
VAR|Statistical|Gives the variance of a sample.|number1: A number or range.|[number2]…: More numbers or ranges.|=VAR(A1:A9)|The sample variance
VAR.P|Statistical|Gives the variance of a whole population.|number1: A number or range.|[number2]…: More numbers or ranges.|=VAR.P(A1:A9)|The population variance
VAR.S|Statistical|Gives the variance of a sample.|number1: A number or range.|[number2]…: More numbers or ranges.|=VAR.S(A1:A9)|The sample variance
VARP|Statistical|Gives the variance of a whole population.|number1: A number or range.|[number2]…: More numbers or ranges.|=VARP(A1:A9)|The population variance
VLOOKUP|Lookup and reference|Looks for a value in the first column of a table and gives a value from the same row.|lookup_value: The value to find.|table_array: The table, with the values to find in its first column.|col_index_num: Which column of the table to take the answer from.|[range_lookup]: FALSE for an exact match, TRUE (the default) for the nearest smaller.|=VLOOKUP(A1,D:F,3,FALSE)|The third column of the row where D matches A1
WEEKDAY|Date and time|Gives the day of the week of a date.|serial_number: The date.|[return_type]: 1 Sunday is 1 (the default), 2 Monday is 1, 3 Monday is 0.|=WEEKDAY(A1,2)|1 for Monday through 7 for Sunday
WEEKNUM|Date and time|Gives the week of the year of a date.|serial_number: The date.|[return_type]: 1 weeks start on Sunday (the default), 2 on Monday.|=WEEKNUM(A1)|The week number
WORKDAY|Date and time|Gives the date some working days from another.|start_date: The date.|days: How many working days to move, negative for earlier.|[holidays]: Dates to skip.|=WORKDAY(A1,10)|Ten working days after A1
XLOOKUP|Lookup and reference|Looks for a value in one range and gives the matching value from another.|lookup_value: The value to find.|lookup_array: The row or column to look in.|return_array: The row or column to take the answer from.|[if_not_found]: What to give if it isn't found (otherwise #N/A).|[match_mode]: 0 exact (the default), -1 exact or next smaller, 1 exact or next larger, 2 wildcards.|[search_mode]: 1 first to last (the default), -1 last to first.|=XLOOKUP(A1,D:D,E:E,"none")|The E value beside the D that matches A1
XMATCH|Lookup and reference|Gives the position of a value in a row or column.|lookup_value: The value to find.|lookup_array: The row or column to look in.|[match_mode]: 0 exact (the default), -1 exact or next smaller, 1 exact or next larger, 2 wildcards.|[search_mode]: 1 first to last (the default), -1 last to first.|=XMATCH("b",A1:A9)|The position of "b"
XOR|Logical|Is TRUE when an odd number of its arguments are true.|logical1: A condition, or a range of them.|[logical2]…: More conditions.|=XOR(TRUE,TRUE,TRUE)|TRUE
YEAR|Date and time|Gives the year of a date.|serial_number: The date.|=YEAR(A1)|The year of A1
YEARFRAC|Date and time|Gives the part of a year between two dates.|start_date: The first date.|end_date: The last date.|[basis]: 0 30/360 (the default), 1 actual/actual, 2 actual/360, 3 actual/365, 4 European 30/360.|=YEARFRAC(A1,B1)|0.5 for six months
`;

const CACHE = new Map<string, FunctionInfo>();

function parse(line: string): FunctionInfo {
  const parts = line.split("|");
  const [name, category, summary] = parts as [string, FunctionCategory, string];
  // The last two cells are the example and what it gives; everything between is a parameter.
  const result = parts[parts.length - 1]!;
  const example = parts[parts.length - 2]!;
  const params: FunctionParam[] = parts.slice(3, -2).map((p) => {
    const colon = p.indexOf(":");
    let label = p.slice(0, colon).trim();
    const description = p.slice(colon + 1).trim();
    const optional = label.startsWith("[");
    const repeats = label.endsWith("…");
    label = label.replace(/…$/, "").replace(/^\[|\]$/g, "");
    return { name: label, description, optional, repeats };
  });
  // A bare "=NAME()" line has no parameters: its example sits where a parameter would.
  const syntax = `${name}(${params.map((p, i) => (p.optional ? `[${p.name}]` : p.name) + (p.repeats ? ", …" : "") + (i < params.length - 1 ? "" : "")).join(", ")})`;
  return { name, category, summary, params, syntax, example, result, volatile: !!getFunction(name)?.volatile };
}

for (const line of (TABLE + MORE + BONDS + FORECAST).split("\n")) {
  if (!line.trim()) continue;
  const info = parse(line);
  CACHE.set(info.name, info);
}

/** Everything known about the functions, in alphabetical order. */
export function functionCatalog(): FunctionInfo[] {
  return [...CACHE.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** What is known about one function, or undefined. */
export function functionInfo(name: string): FunctionInfo | undefined {
  return CACHE.get(name.toUpperCase().replace(/^_XL(FN|WS)\./, ""));
}
