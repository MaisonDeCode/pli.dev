import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { lintPackage } from "./excel-check/lint";
import { written } from "./excel-check/report";
import { SAMPLES } from "./excel-check/samples";

/**
 * The package check for merged cells and conditional formats (`excel-check/lint-format.ts`): it passes what Pli writes
 * and notices each way the schema's order and values can be broken, which Excel answers with a repair message.
 */
let cached: Record<string, Uint8Array> | undefined;
const files = () => ({ ...(cached ??= unzipSync(written(SAMPLES.find((s) => s.file === "33-formatting-rest.xlsx")!))) });
const PARTS = { compare: "xl/worksheets/sheet2.xml", scales: "xl/worksheets/sheet6.xml", icons: "xl/worksheets/sheet7.xml", linked: "xl/worksheets/sheet9.xml", merges: "xl/worksheets/sheet10.xml", pivotSheet: "xl/worksheets/sheet12.xml", pivot: "xl/pivotTables/pivotTable1.xml" };

/** The package with one part changed by a text replacement (which must change it). */
function broken(part: string, from: string | RegExp, to: string | ((m: string, ...groups: string[]) => string)): string {
  const all = files();
  const before = strFromU8(all[part]!);
  const after = before.replace(from, to as never);
  expect(after, `the part ${part} has ${String(from)}`).not.toBe(before);
  return lintPackage(zipSync({ ...all, [part]: strToU8(after) })).join("\n");
}

describe("the package check for formatting", () => {
  it("passes the file Pli writes", () => {
    expect(lintPackage(zipSync(files()))).toEqual([]);
  });

  it("knows which parts the tests below change", () => {
    const all = files();
    expect(strFromU8(all[PARTS.compare]!)).toContain('operator="between"');
    expect(strFromU8(all[PARTS.scales]!)).toContain("<x14:dataBar");
    expect(strFromU8(all[PARTS.icons]!)).toContain("<x14:iconSet");
    expect(strFromU8(all[PARTS.linked]!)).toContain("Limits!");
    expect(strFromU8(all[PARTS.merges]!)).toContain("<mergeCells");
    expect(strFromU8(all[PARTS.pivotSheet]!)).toContain('pivot="1"');
    expect(strFromU8(all[PARTS.pivot]!)).toContain("<conditionalFormats");
  });

  describe("merged cells", () => {
    it("refuses a merge of one cell, an empty list, and a merge that touches a table", () => {
      expect(broken(PARTS.merges, 'ref="A1:C1"', 'ref="A1"')).toMatch(/single cell/);
      expect(broken(PARTS.merges, /<mergeCells count="7">.*<\/mergeCells>/, '<mergeCells count="0"></mergeCells>')).toMatch(/<mergeCells> is empty/);
      expect(broken(PARTS.merges, 'ref="A1:C1"', 'ref="A10:B10"')).toMatch(/touches a table/);
      expect(broken(PARTS.merges, 'ref="A1:C1"', 'ref="A3:B4"')).toMatch(/overlap/);
    });

    it("refuses a part that has the element twice", () => {
      expect(broken(PARTS.merges, "</mergeCells>", '</mergeCells><mergeCells count="1"><mergeCell ref="J1:K1"/></mergeCells>')).toMatch(/<mergeCells> appears 2 times/);
    });
  });

  describe("ordinary rules", () => {
    it("checks the type, the priority and the style", () => {
      expect(broken(PARTS.compare, 'type="top10"', 'type="topTen"')).toMatch(/isn't a conditional formatting type/);
      expect(broken(PARTS.compare, 'priority="2"', 'priority="1"')).toMatch(/priority 1 is used by another rule/);
      expect(broken(PARTS.compare, 'priority="2"', 'priority="0"')).toMatch(/priority "0"/);
      expect(broken(PARTS.compare, 'dxfId="1"', 'dxfId="99"')).toMatch(/dxfId "99"/);
    });

    it("checks each kind of rule has what it needs", () => {
      expect(broken(PARTS.compare, "<formula>20</formula><formula>60</formula>", "<formula>20</formula>")).toMatch(/has 1 formulas, and this type takes 2/);
      expect(broken(PARTS.compare, 'operator="between"', 'operator="beats"')).toMatch(/operator "beats"/);
      expect(broken(PARTS.compare, 'rank="3"', 'rank="0"')).toMatch(/rank "0"/);
      expect(broken(PARTS.compare, 'rank="20" percent="1"', 'rank="200" percent="1"')).toMatch(/rank "200"/);
      expect(broken(PARTS.compare, 'stdDev="1"', 'stdDev="4"')).toMatch(/stdDev "4"/);
      expect(broken("xl/worksheets/sheet3.xml", 'operator="containsText"', 'operator="contains"')).toMatch(/operator is "contains"/);
      expect(broken("xl/worksheets/sheet5.xml", 'timePeriod="today"', 'timePeriod="now"')).toMatch(/timePeriod "now"/);
      expect(broken("xl/worksheets/sheet4.xml", /(<cfRule type="containsBlanks"[^>]*>)<formula>[^<]*<\/formula>/, "$1")).toMatch(/has 0 formulas/);
    });

    it("checks the order inside a rule, and the points of scales, bars and icons", () => {
      expect(broken(PARTS.scales, /<colorScale><cfvo type="min"\/><cfvo type="max"\/><color rgb="FFFFFFFF"\/><color rgb="FF63BE7B"\/><\/colorScale>/, '<colorScale><color rgb="FFFFFFFF"/><cfvo type="min"/><cfvo type="max"/><color rgb="FF63BE7B"/></colorScale>')).toMatch(/<cfvo> comes after <color>/);
      expect(broken(PARTS.scales, /<cfvo type="percentile" val="10"\/>/, '<cfvo type="percentile" val="10"/><cfvo type="max"/>')).toMatch(/a colour scale has 4 points/);
      expect(broken(PARTS.scales, /<cfvo type="percentile" val="50"\/>/, '<cfvo type="percentile" val="150"/>')).toMatch(/150 isn't from 0 to 100/);
      expect(broken(PARTS.scales, /<cfvo type="num" val="40"\/>/, '<cfvo type="num"/>')).toMatch(/type num has no value/);
      expect(broken(PARTS.scales, /<cfvo type="min"\/><cfvo type="max"\/><color rgb="FF638EC6"\/>/, '<cfvo type="autoMin"/><cfvo type="max"/><color rgb="FF638EC6"/>')).toMatch(/autoMin and autoMax are for the extension only/);
      expect(broken(PARTS.scales, 'minLength="20" maxLength="80"', 'minLength="90" maxLength="80"')).toMatch(/minLength is longer than maxLength/);
      expect(broken(PARTS.icons, /(<iconSet iconSet="3Arrows">)(<cfvo type="percent" val="0"\/>)/, "$1$2<cfvo type=\"percent\" val=\"90\"/>")).toMatch(/4 thresholds for the 3Arrows set/);
      expect(broken(PARTS.icons, '<iconSet iconSet="3Arrows">', '<iconSet iconSet="3Stars">')).toMatch(/new in Excel 2010/);
      expect(broken(PARTS.icons, /<iconSet iconSet="4Rating">/, '<iconSet iconSet="4Ratings">')).toMatch(/icon set "4Ratings"/);
    });

    it("wants a point that names another sheet in the extension", () => {
      expect(broken(PARTS.icons, /(<iconSet iconSet="3TrafficLights1"><cfvo type="percent" val="0"\/><cfvo type="percent" val="33"\/>)<cfvo type="percent" val="67"\/>/, (_m, a: string) => `${a}<cfvo type="formula" val="Limits!$A$1"/>`)).toMatch(/names another sheet/);
    });
  });

  describe("Excel 2010's extension", () => {
    it("checks the links between the rules and the extension", () => {
      expect(broken(PARTS.scales, /<x14:id>\{B0000000-0000-4000-8000-000000000005\}<\/x14:id>/, "<x14:id>{B0000000-0000-4000-8000-0000000000FF}</x14:id>")).toMatch(/points at the extension rule .*FF.*, which isn't there/);
      expect(broken(PARTS.scales, /<x14:id>\{B0000000-0000-4000-8000-000000000005\}<\/x14:id>/, "<x14:id>nope</x14:id>")).toMatch(/isn't a GUID in braces/);
      expect(broken(PARTS.scales, /(<x14:cfRule type="dataBar") id="\{B0000000-0000-4000-8000-000000000005\}"/, '$1 id="{B0000000-0000-4000-8000-000000000006}"')).toMatch(/is used twice/);
      expect(broken(PARTS.icons, '<x14:cfRule type="iconSet" priority="5"', '<x14:cfRule type="iconSet"')).toMatch(/needs a priority/);
      expect(broken(PARTS.icons, '<x14:cfRule type="iconSet" priority="5"', '<x14:cfRule type="iconSet" priority="1"')).toMatch(/priority 1 is used by another rule/);
    });

    it("checks the data bar settings and their order", () => {
      expect(broken(PARTS.scales, 'axisPosition="middle"', 'axisPosition="centre"')).toMatch(/axisPosition "centre"/);
      expect(broken(PARTS.scales, 'direction="rightToLeft"', 'direction="backwards"')).toMatch(/direction "backwards"/);
      expect(broken(PARTS.scales, 'gradient="0"', 'gradient="maybe"')).toMatch(/gradient isn't a boolean/);
      expect(broken(PARTS.scales, '<x14:borderColor rgb="FF1F3A68"/>', '<x14:axisColor rgb="FF000000"/><x14:borderColor rgb="FF1F3A68"/>')).toMatch(/<borderColor> comes after <axisColor>/);
      expect(broken(PARTS.scales, ' border="1"', "")).toMatch(/a border colour is given, but border isn't 1/);
      expect(broken(PARTS.scales, '<x14:negativeFillColor rgb="FFFF0000"/>', '<x14:negativeFillColor rgb="FFFF0000"/><x14:negativeFillColor rgb="FF00FF00"/>')).toMatch(/<negativeFillColor> appears 2 times/);
      expect(broken(PARTS.scales, /<x14:cfvo type="min"\/><x14:cfvo type="max"\/><\/x14:dataBar>/, '<x14:cfvo type="min"/></x14:dataBar>')).toMatch(/1 cfvo in an x14:dataBar/);
      expect(broken(PARTS.linked, '<x14:cfvo type="formula"><xm:f>Limits!$A$3</xm:f></x14:cfvo>', '<x14:cfvo type="formula" val="Limits!$A$3"/>')).toMatch(/not a val attribute|has no value/);
    });

    it("checks the icon sets and the icons picked one by one", () => {
      expect(broken(PARTS.icons, 'iconSet="3Stars"', 'iconSet="3Moons"')).toMatch(/icon set "3Moons"/);
      expect(broken(PARTS.icons, '<x14:cfIcon iconSet="3Flags" iconId="0"/>', '<x14:cfIcon iconSet="3Flags" iconId="7"/>')).toMatch(/icon 7 of the 3Flags set, which has 3/);
      expect(broken(PARTS.icons, '<x14:cfIcon iconSet="NoIcons" iconId="0"/>', "")).toMatch(/2 icons for 3 thresholds/);
      expect(broken(PARTS.icons, ' custom="1"', "")).toMatch(/icons are given but custom isn't 1/);
    });

    it("checks the rules that point at other sheets", () => {
      expect(broken(PARTS.linked, '<xm:f>Limits!$A$1</xm:f>', "")).toMatch(/has 0 xm:f formulas/);
      expect(broken(PARTS.linked, /<x14:cfRule type="expression" priority="2" id="[^"]*">/, '<x14:cfRule type="expression" priority="2">')).toMatch(/has no id/);
      expect(broken(PARTS.linked, '<x14:dxf>', '<x14:dxf><fill><patternFill/></fill><font><b/></font>')).toMatch(/<font> comes after <fill>/);
      expect(broken(PARTS.linked, /(<x14:cfRule type="cellIs"[^>]*>)(<xm:f>Limits!\$A\$1<\/xm:f>)/, "$1<x14:dxf></x14:dxf>$2")).toMatch(/<f> comes after <dxf>/);
    });

    it("checks the names and namespaces", () => {
      expect(broken(PARTS.linked, '<xm:sqref>A2:A11</xm:sqref>', '<x14:sqref>A2:A11</x14:sqref>')).toMatch(/belong to the xm: namespace|isn't an element/);
      expect(broken(PARTS.linked, /<x14:conditionalFormatting xmlns:xm="[^"]*">/g, "<x14:conditionalFormatting>")).toMatch(/doesn't declare xmlns:xm/);
      expect(broken(PARTS.linked, /<x14:cfRule type="cellIs"/, "<cfRule type=\"cellIs\"")).toMatch(/missing its x14: prefix/);
      expect(broken(PARTS.linked, /<x14:conditionalFormattings>/, "<x14:conditionalFormattings><x14:note/>")).toMatch(/isn't an element of the conditional formatting extension/);
      expect(broken(PARTS.linked, 'xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormattings>', 'xmlns:x14="http://example.com/x14"><x14:conditionalFormattings>')).toMatch(/doesn't declare xmlns:x14/);
      expect(broken(PARTS.linked, /<extLst><ext uri="\{78C0D931[\s\S]*<\/extLst>/, (m: string) => m + m)).toMatch(/appears 2 times/);
    });
  });

  describe("conditional formats of a pivot table", () => {
    it("checks the format is tied to a rule of the sheet that says it belongs to a pivot table", () => {
      expect(broken(PARTS.pivot, 'priority="1"', 'priority="9"')).toMatch(/the sheet has no rule with that priority/);
      expect(broken(PARTS.pivotSheet, '<conditionalFormatting pivot="1" sqref="B8:C10">', '<conditionalFormatting sqref="B8:C10">')).toMatch(/isn't in a conditionalFormatting with pivot="1"/);
      expect(broken(PARTS.pivot, 'priority="2"', 'priority="1"')).toMatch(/priority is used by another format/);
      expect(broken(PARTS.pivot, '<conditionalFormats count="2">', '<conditionalFormats count="3">')).toMatch(/count="3"\> has 2 formats/);
    });

    it("checks the areas and their references", () => {
      expect(broken(PARTS.pivot, 'scope="field"', 'scope="everywhere"')).toMatch(/scope "everywhere"/);
      expect(broken(PARTS.pivot, '<reference field="1" count="0" selected="0"/>', '<reference field="99" count="0" selected="0"/>')).toMatch(/reference to field 99/);
      expect(broken(PARTS.pivot, '<x v="2"/></reference></references></pivotArea>', '<x v="99"/></reference></references></pivotArea>')).toMatch(/item 99 of field 0/);
      expect(broken(PARTS.pivot, '<references count="2">', '<references count="3">')).toMatch(/references count="3"/);
      expect(broken(PARTS.pivot, '<reference field="4294967294" count="1" selected="0"><x v="1"/></reference>', '<reference field="4294967294" count="1" selected="0"><x v="5"/></reference>')).toMatch(/data field 5, and there are 2/);
      expect(broken(PARTS.pivot, /(<reference field="4294967294"[^>]*>.*?<\/reference>)(<reference field="1" count="0" selected="0"\/>)/, "$2$1")).toMatch(/data field comes after/);
      expect(broken(PARTS.pivot, 'type="data" collapsedLevelsAreSubtotals="1"', 'type="datum" collapsedLevelsAreSubtotals="1"')).toMatch(/pivotArea type "datum"/);
      expect(broken(PARTS.pivot, /<pivotAreas count="1">/, "<pivotAreas count=\"2\">")).toMatch(/<pivotAreas count="2"> has 1/);
    });
  });
});
