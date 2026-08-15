// pdf2png.swift — PDF 每页转 PNG（macOS PDFKit，零依赖）
// 用法: swift scripts/pdf2png.swift <pdf路径> <输出目录> [起始页] [结束页]
import PDFKit
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write(Data("用法: swift scripts/pdf2png.swift <pdf路径> <输出目录> [起始页] [结束页]\n".utf8))
    exit(1)
}
let pdfURL = URL(fileURLWithPath: args[1])
let outDir = args[2]
let start = args.count >= 4 ? Int(args[3]) ?? 1 : 1
let end = args.count >= 5 ? Int(args[4]) ?? Int.max : Int.max

guard let doc = PDFDocument(url: pdfURL) else {
    FileHandle.standardError.write(Data("无法打开 PDF: \(pdfURL.path)\n".utf8))
    exit(1)
}
try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
let pageCount = doc.pageCount
print("总页数: \(pageCount)")
let last = min(end, pageCount)
for i in start...last {
    guard let page = doc.page(at: i - 1) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2.0   // 2x 分辨率，OCR 更稳
    let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    let img = NSImage(size: size)
    img.lockFocus()
    NSColor.white.setFill()
    NSRect(origin: .zero, size: size).fill()
    guard let ctx = NSGraphicsContext.current?.cgContext else { continue }
    ctx.saveGState()
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()
    img.unlockFocus()
    guard let tiff = img.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { continue }
    let name = String(format: "page-%04d.png", i)
    try png.write(to: URL(fileURLWithPath: "\(outDir)/\(name)"))
    print("✓ \(name)")
}
print("完成: 共 \(last - start + 1) 页")
