#!/usr/bin/env swift
/**
 * ocr.swift — 教材拍照 OCR 命令行工具（macOS 自带 Vision 框架，零依赖）
 *
 * 用法：
 *   swift scripts/ocr.swift <图片路径> [识别语言...]
 *
 *   <图片路径>         必填，支持 png/jpg/heic 等系统可解码的图片（含 iPhone 拍照的 HEIC）
 *   [识别语言...]      可选，BCP-47 语言标签，可传多个
 *
 * 输出：
 *   按"行号: 文本"逐行打印识别结果到 stdout（按图片从上到下、同行从左到右排序）。
 *   出错时打印错误信息到 stderr 并以非 0 退出码结束。
 *
 * 识别策略（默认，不传语言时）——双通道合并：
 *   教材页通常是"西语正文 + 中文注释"混排，单语言一次识别会顾此失彼：
 *   - 通道 A：zh-Hans + es-ES  → 中文完整，但西语重音（é/í/á/¿¡）会被"校正"掉
 *   - 通道 B：es-ES 单独        → 西语重音完美，但中文完全丢失
 *   因此默认跑两遍，按行位置（归一化 y 坐标）合并：中文行用通道 A，
 *   西语行用通道 B 的正确重音版本。传了自定义语言则单通道识别。
 *
 * 实现要点：
 *   - VNRecognizeTextRequest，accurate 级别（中文必须 accurate）。
 *   - 通过 VNImageRequestHandler(url:) 读图，自动处理 EXIF 方向（手机拍照不怕转 90°）。
 */
import Foundation
import Vision

// ---------- 参数解析 ----------
let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write(
        Data("用法：swift scripts/ocr.swift <图片路径> [识别语言...]\n".utf8))
    exit(2)
}

// 展开 ~ 并转为绝对路径
let rawPath = (args[1] as NSString).expandingTildeInPath
let imageURL = URL(fileURLWithPath: rawPath).absoluteURL

// 默认语言组合（见文件头注释）
let DEFAULT_LANGS = ["zh-Hans", "es-ES"]
let SPANISH_ONLY = ["es-ES"]

var languages = Array(args.dropFirst(2))
let isDefaultMode = languages.isEmpty
if languages.isEmpty {
    languages = DEFAULT_LANGS
}

guard FileManager.default.fileExists(atPath: imageURL.path) else {
    FileHandle.standardError.write(Data("错误：图片不存在：\(imageURL.path)\n".utf8))
    exit(1)
}

// ---------- 单通道识别 ----------
struct TextLine {
    let text: String
    let y: CGFloat   // 归一化坐标，越大越靠上（Vision 原点在左下）
    let x: CGFloat
}

func recognize(languages: [String]) throws -> [TextLine] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate   // 高质量识别（中文/西语都要求 accurate）
    request.recognitionLanguages = languages
    request.usesLanguageCorrection = true  // 语言模型纠错，减少拼写噪声
    let handler = VNImageRequestHandler(url: imageURL, options: [:])
    try handler.perform([request])
    return (request.results ?? []).compactMap { obs in
        guard let candidate = obs.topCandidates(1).first else { return nil }
        return TextLine(
            text: candidate.string,
            y: obs.boundingBox.midY,
            x: obs.boundingBox.minX
        )
    }
}

// 是否含中日韩文字（含 CJK 的行视为中文行，保留通道 A 的结果）
func containsCJK(_ s: String) -> Bool {
    for scalar in s.unicodeScalars {
        if (0x4E00...0x9FFF).contains(scalar.value)  // 常用汉字
            || (0x3400...0x4DBF).contains(scalar.value) // 扩展 A
            || (0x3000...0x303F).contains(scalar.value) // 中文标点
        {
            return true
        }
    }
    return false
}

// ---------- 双通道合并 ----------
// 把通道 B（es-ES）中同位置的西语行替换掉通道 A 里重音丢失的版本。
// 匹配规则：取 y 距离最近（且 < 0.006）的通道 A 行；中文行不替换。
func merge(mixed: [TextLine], spanish: [TextLine]) -> [TextLine] {
    var result = mixed
    var matched = Set<Int>()

    for esLine in spanish {
        // 找通道 A 中 y 最接近且在同一条容差内的行
        var bestIdx: Int? = nil
        var bestDy = CGFloat.greatestFiniteMagnitude
        for (i, m) in result.enumerated() where !matched.contains(i) {
            let dy = abs(m.y - esLine.y)
            if dy < 0.006 && dy < bestDy {
                bestIdx = i
                bestDy = dy
            }
        }
        if let idx = bestIdx {
            matched.insert(idx)
            // 中文行保留通道 A 原文；西语行替换为带正确重音的版本
            if !containsCJK(result[idx].text) {
                result[idx] = esLine
            }
        } else {
            // 通道 B 独有、通道 A 漏掉的行 → 直接补进来
            result.append(esLine)
        }
    }
    return result
}

// ---------- 执行识别 ----------
var lines: [TextLine]
do {
    if isDefaultMode {
        let mixed = try recognize(languages: DEFAULT_LANGS)
        let spanish = try recognize(languages: SPANISH_ONLY)
        lines = merge(mixed: mixed, spanish: spanish)
    } else {
        lines = try recognize(languages: languages)
    }
} catch {
    FileHandle.standardError.write(Data("错误：OCR 识别失败：\(error.localizedDescription)\n".utf8))
    exit(1)
}

// ---------- 按阅读顺序排序输出 ----------
// y 大的（靠上的）行放前面；同一行内（y 相差很小）按 x 从左到右排。
// 行间距阈值 0.004：整页照片一行约占 0.02，足够区分相邻行。
let sorted = lines.sorted { a, b in
    if abs(a.y - b.y) > 0.004 { return a.y > b.y }
    return a.x < b.x
}

for (index, line) in sorted.enumerated() {
    print("\(index + 1): \(line.text)")
}

if sorted.isEmpty {
    FileHandle.standardError.write(Data("提示：未识别到任何文字，请检查图片是否清晰、是否包含文字区域。\n".utf8))
}
