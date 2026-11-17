// Prints the text of each page of a PDF, pages separated by a line of "=====PAGE=====" (PDFKit, so no other tool is needed).
import Foundation
import PDFKit

guard CommandLine.arguments.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
  FileHandle.standardError.write("cannot open the PDF\n".data(using: .utf8)!)
  exit(1)
}
for i in 0..<doc.pageCount {
  print("=====PAGE=====")
  print(doc.page(at: i)?.string ?? "")
}
