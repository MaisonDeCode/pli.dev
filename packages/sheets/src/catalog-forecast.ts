// Exponential-smoothing forecasts, the rest of the complex-number functions and ISOMITTED, in the form of the table in catalog.ts:
// name | category | summary | params | example | result
const TAIL = "[seasonality]: 1 finds the length of the repeating pattern itself (the default), 0 means there is none, a whole number gives its length.|[data_completion]: 1 fills gaps in the timeline by interpolating (the default), 0 fills them with zeros.|[aggregation]: How to combine values that share a time: 1 AVERAGE (the default), 2 COUNT, 3 COUNTA, 4 MAX, 5 MEDIAN, 6 MIN, 7 SUM.";
const COMPLETE = "[data_completion]: 1 fills gaps in the timeline by interpolating (the default), 0 fills them with zeros.";
const AGG = "[aggregation]: How to combine values that share a time: 1 AVERAGE (the default), 2 COUNT, 3 COUNTA, 4 MAX, 5 MEDIAN, 6 MIN, 7 SUM.";
const Z = "inumber: A complex number such as \"3+4i\".";

export const FORECAST = `
FORECAST.ETS|Statistical|Forecasts a value from past values with exponential smoothing (AAA), allowing for a trend and a repeating pattern.|target_date: The time to forecast for.|values: The known values.|timeline: The times of the known values, with a constant step between them.|${TAIL}|=FORECAST.ETS(100,B1:B9,A1:A9)|The forecast for the time 100, one step after the last of the times in A1:A9
FORECAST.ETS.CONFINT|Statistical|Gives the confidence interval of a FORECAST.ETS forecast: the forecast plus or minus this.|target_date: The time to forecast for.|values: The known values.|timeline: The times of the known values.|[confidence_level]: Between 0 and 1 (0.95 if left out).|${TAIL}|=FORECAST.ETS.CONFINT(100,B1:B9,A1:A9,0.9)|The half-width of the interval
FORECAST.ETS.SEASONALITY|Statistical|Gives the length of the repeating pattern that FORECAST.ETS finds in the values.|values: The known values.|timeline: The times of the known values.|${COMPLETE}|${AGG}|=FORECAST.ETS.SEASONALITY(B1:B9,A1:A9)|The number of points in the pattern, 1 if there is none
FORECAST.ETS.STAT|Statistical|Gives a statistic of the exponential-smoothing forecast.|values: The known values.|timeline: The times of the known values.|statistic_type: 1 Alpha, 2 Beta, 3 Gamma, 4 MASE, 5 SMAPE, 6 MAE, 7 RMSE, 8 step size found.|${TAIL}|=FORECAST.ETS.STAT(B1:B9,A1:A9,7)|The root mean squared error
ISOMITTED|Logical|Says whether a LAMBDA was called without a value for one of its optional parameters.|argument: The name of a parameter of the LAMBDA.|=LET(f,LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y)),f(1))|1
IMCOS|Math|Gives the cosine of a complex number.|${Z}|=IMCOS("1+i")|"0.833730025131149-0.988897705762865i"
IMCOSH|Math|Gives the hyperbolic cosine of a complex number.|${Z}|=IMCOSH("1+i")|"0.833730025131149+0.988897705762865i"
IMCOT|Math|Gives the cotangent of a complex number.|${Z}|=IMCOT("1+i")|"0.217621561854403-0.868014142895925i"
IMCSC|Math|Gives the cosecant of a complex number.|${Z}|=IMCSC("1+i")|"0.621518017170428-0.303931001628426i"
IMCSCH|Math|Gives the hyperbolic cosecant of a complex number.|${Z}|=IMCSCH("1+i")|"0.303931001628426-0.621518017170428i"
IMEXP|Math|Gives e raised to a complex power.|${Z}|=IMEXP("1+i")|"1.46869393991589+2.28735528717884i"
IMLN|Math|Gives the natural logarithm of a complex number.|${Z}|=IMLN("3+4i")|"1.6094379124341+0.927295218001612i"
IMLOG10|Math|Gives the base-10 logarithm of a complex number.|${Z}|=IMLOG10("3+4i")|"0.698970004336019+0.402719196273373i"
IMLOG2|Math|Gives the base-2 logarithm of a complex number.|${Z}|=IMLOG2("3+4i")|"2.32192809488736+1.33780421245098i"
IMPOWER|Math|Raises a complex number to a power.|inumber: A complex number.|number: The power, any real number.|=IMPOWER("2+3i",3)|"-46+9i"
IMSEC|Math|Gives the secant of a complex number.|${Z}|=IMSEC("1+i")|"0.498337030555187+0.591083841721045i"
IMSECH|Math|Gives the hyperbolic secant of a complex number.|${Z}|=IMSECH("1+i")|"0.498337030555187-0.591083841721045i"
IMSIN|Math|Gives the sine of a complex number.|${Z}|=IMSIN("1+i")|"1.29845758141598+0.634963914784736i"
IMSINH|Math|Gives the hyperbolic sine of a complex number.|${Z}|=IMSINH("1+i")|"0.634963914784736+1.29845758141598i"
IMSQRT|Math|Gives the square root of a complex number.|${Z}|=IMSQRT("3+4i")|"2+i"
IMTAN|Math|Gives the tangent of a complex number.|${Z}|=IMTAN("1+i")|"0.271752585319512+1.08392332733869i"
`;
