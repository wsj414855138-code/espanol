// extract-frames.swift — 从视频/录屏中抽取 PNG 帧（macOS AVFoundation，零依赖）
// 用法: swift scripts/extract-frames.swift <视频路径> <输出目录> [间隔秒数=2] [最长秒数=0不限]
// 输出: <输出目录>/frame-0001.png ...（按时间排序）
import AVFoundation
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write(Data("用法: swift scripts/extract-frames.swift <视频路径> <输出目录> [间隔秒数] [最长秒数]\n".utf8))
    exit(1)
}

let videoPath = args[1]
let outDir = args[2]
let interval = args.count >= 4 ? Double(args[3]) ?? 2.0 : 2.0
let maxSeconds = args.count >= 5 ? Double(args[4]) ?? 0 : 0

let asset = AVURLAsset(url: URL(fileURLWithPath: videoPath))
let duration = try await asset.load(.duration)
let total = CMTimeGetSeconds(duration)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
generator.maximumSize = CGSize(width: 1920, height: 1080)

try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let end = maxSeconds > 0 ? min(total, maxSeconds) : total
var time = 0.0
var index = 1
while time <= end {
    let cm = CMTime(seconds: time, preferredTimescale: 600)
    do {
        let cg = try await generator.image(at: cm)
        let rep = NSBitmapImageRep(cgImage: cg.image)
        if let data = rep.representation(using: .png, properties: [:]) {
            let name = String(format: "frame-%04d.png", index)
            try data.write(to: URL(fileURLWithPath: "\(outDir)/\(name)"))
            print("\(name) @ \(String(format: "%.1f", time))s")
        }
    } catch {
        print("跳过 \(String(format: "%.1f", time))s: \(error)")
    }
    index += 1
    time += interval
}
print("完成: 共抽取 \(index - 1) 帧，总时长 \(String(format: "%.1f", total))s")
