#!/usr/bin/env swift

import AppKit
import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import Foundation

private let canvasWidth = 1920
private let canvasHeight = 1080
private let frameRate: Int32 = 24
private let transitionSeconds = 0.42
private let gapSeconds = 0.18

private let backgroundA = NSColor(calibratedRed: 0.025, green: 0.055, blue: 0.085, alpha: 1)
private let backgroundB = NSColor(calibratedRed: 0.035, green: 0.105, blue: 0.145, alpha: 1)
private let surface = NSColor(calibratedRed: 0.055, green: 0.115, blue: 0.16, alpha: 0.96)
private let surface2 = NSColor(calibratedRed: 0.07, green: 0.145, blue: 0.195, alpha: 0.94)
private let teal = NSColor(calibratedRed: 0.36, green: 0.85, blue: 0.79, alpha: 1)
private let blue = NSColor(calibratedRed: 0.35, green: 0.65, blue: 1, alpha: 1)
private let white = NSColor(calibratedWhite: 0.97, alpha: 1)
private let muted = NSColor(calibratedWhite: 0.72, alpha: 1)
private let red = NSColor(calibratedRed: 1, green: 0.38, blue: 0.43, alpha: 1)
private let amber = NSColor(calibratedRed: 1, green: 0.76, blue: 0.28, alpha: 1)

private enum VideoMode {
    case buildWeek
    case dataHub

    var footer: String {
        switch self {
        case .buildWeek:
            return "OPENAI BUILD WEEK  ·  LOCAL DEMO  ·  USD 0"
        case .dataHub:
            return "DATAHUB AGENT HACKATHON  ·  LOCAL PROOF  ·  USD 0"
        }
    }

    var sayRate: String {
        switch self {
        case .buildWeek:
            return "165"
        case .dataHub:
            return "140"
        }
    }
}

private var videoMode: VideoMode = .buildWeek

private enum SceneKind {
    case screenshot(String, String)
    case product
    case deterministic
    case authority
    case collaboration
    case tests
    case close
    case mcpProof
    case dataHubClose
}

private struct Scene {
    let title: String
    let eyebrow: String
    let narration: String
    let kind: SceneKind
}

private struct TimedScene {
    let scene: Scene
    let audioURL: URL
    let start: Double
    let audioDuration: Double
    let end: Double
}

private func color(_ value: NSColor, alpha: CGFloat = 1) -> NSColor {
    value.withAlphaComponent(value.alphaComponent * alpha)
}

private func font(_ size: CGFloat, weight: NSFont.Weight = .regular, mono: Bool = false) -> NSFont {
    if mono {
        return NSFont.monospacedSystemFont(ofSize: size, weight: weight)
    }
    return NSFont.systemFont(ofSize: size, weight: weight)
}

private func paragraphStyle(alignment: NSTextAlignment = .left, lineSpacing: CGFloat = 6) -> NSMutableParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.alignment = alignment
    style.lineBreakMode = .byWordWrapping
    style.lineSpacing = lineSpacing
    return style
}

private func drawText(
    _ text: String,
    rect: NSRect,
    size: CGFloat,
    weight: NSFont.Weight = .regular,
    color textColor: NSColor = white,
    mono: Bool = false,
    alignment: NSTextAlignment = .left,
    lineSpacing: CGFloat = 6
) {
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font(size, weight: weight, mono: mono),
        .foregroundColor: textColor,
        .paragraphStyle: paragraphStyle(alignment: alignment, lineSpacing: lineSpacing),
    ]
    NSAttributedString(string: text, attributes: attributes).draw(
        with: rect,
        options: [.usesLineFragmentOrigin, .usesFontLeading]
    )
}

private func roundedRect(_ rect: NSRect, radius: CGFloat, fill: NSColor, stroke: NSColor? = nil, lineWidth: CGFloat = 1) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    fill.setFill()
    path.fill()
    if let stroke {
        stroke.setStroke()
        path.lineWidth = lineWidth
        path.stroke()
    }
}

private func drawPill(_ text: String, rect: NSRect, fill: NSColor, textColor: NSColor = white) {
    roundedRect(rect, radius: rect.height / 2, fill: fill, stroke: color(white, alpha: 0.12))
    drawText(text, rect: NSRect(x: rect.minX + 14, y: rect.minY + 7, width: rect.width - 28, height: rect.height - 12), size: 16, weight: .semibold, color: textColor, alignment: .center, lineSpacing: 0)
}

private func drawBackground() {
    NSGradient(colors: [backgroundA, backgroundB])!.draw(
        in: NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight),
        angle: -20
    )
    color(teal, alpha: 0.055).setFill()
    NSBezierPath(ovalIn: NSRect(x: 1260, y: 570, width: 760, height: 760)).fill()
    color(blue, alpha: 0.04).setFill()
    NSBezierPath(ovalIn: NSRect(x: -280, y: -240, width: 900, height: 900)).fill()
}

private func drawChrome(_ scene: Scene, index: Int, total: Int) {
    roundedRect(NSRect(x: 72, y: 982, width: 54, height: 54), radius: 15, fill: NSGradient(colors: [teal, blue])!.interpolatedColor(atLocation: 0.45))
    drawText("LG", rect: NSRect(x: 72, y: 997, width: 54, height: 28), size: 18, weight: .bold, color: backgroundA, alignment: .center, lineSpacing: 0)
    drawText("LineageGuard", rect: NSRect(x: 144, y: 995, width: 360, height: 36), size: 27, weight: .bold, lineSpacing: 0)
    drawText(scene.eyebrow.uppercased(), rect: NSRect(x: 1170, y: 1000, width: 670, height: 28), size: 16, weight: .semibold, color: teal, alignment: .right, lineSpacing: 0)

    color(white, alpha: 0.11).setFill()
    NSBezierPath(rect: NSRect(x: 72, y: 42, width: 1776, height: 4)).fill()
    let progress = CGFloat(index + 1) / CGFloat(total)
    NSGradient(colors: [teal, blue])!.draw(in: NSRect(x: 72, y: 42, width: 1776 * progress, height: 4), angle: 0)
    drawText(videoMode.footer, rect: NSRect(x: 72, y: 62, width: 780, height: 24), size: 14, weight: .medium, color: color(muted, alpha: 0.75), lineSpacing: 0)
    drawText("\(index + 1) / \(total)", rect: NSRect(x: 1720, y: 62, width: 128, height: 24), size: 14, weight: .medium, color: color(muted, alpha: 0.75), alignment: .right, lineSpacing: 0)
}

private func drawSceneTitle(_ scene: Scene, subtitle: String? = nil) {
    drawText(scene.title, rect: NSRect(x: 96, y: 882, width: 1400, height: 76), size: 55, weight: .bold, lineSpacing: 0)
    if let subtitle {
        drawText(subtitle, rect: NSRect(x: 102, y: 830, width: 1550, height: 48), size: 24, weight: .regular, color: muted, lineSpacing: 2)
    }
}

private func drawScreenshotScene(_ path: String, disclosure: String, scene: Scene) {
    drawSceneTitle(scene, subtitle: disclosure)
    let frame = NSRect(x: 182, y: 104, width: 1556, height: 700)
    roundedRect(frame.insetBy(dx: -14, dy: -14), radius: 24, fill: color(surface, alpha: 0.78), stroke: color(teal, alpha: 0.35), lineWidth: 2)
    if let image = NSImage(contentsOfFile: path) {
        let sourceRatio = image.size.width / image.size.height
        let targetRatio = frame.width / frame.height
        var source = NSRect(origin: .zero, size: image.size)
        if sourceRatio > targetRatio {
            let width = image.size.height * targetRatio
            source.origin.x = (image.size.width - width) / 2
            source.size.width = width
        } else {
            let height = image.size.width / targetRatio
            source.origin.y = (image.size.height - height) / 2
            source.size.height = height
        }
        image.draw(in: frame, from: source, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    } else {
        drawText("Missing visual: \(path)", rect: frame, size: 30, color: red, alignment: .center)
    }
    drawPill("SYNTHETIC DATAHUB-SHAPED SNAPSHOT", rect: NSRect(x: 1280, y: 780, width: 430, height: 42), fill: color(backgroundA, alpha: 0.9), textColor: teal)
}

private func drawProductScene(_ scene: Scene) {
    drawSceneTitle(scene, subtitle: "The Build Week extension is a reusable Codex skill—not a chat-only demo.")

    let treeRect = NSRect(x: 96, y: 128, width: 1040, height: 660)
    roundedRect(treeRect, radius: 28, fill: surface, stroke: color(teal, alpha: 0.28), lineWidth: 2)
    drawPill("REPOSITORY", rect: NSRect(x: 134, y: 710, width: 180, height: 40), fill: color(teal, alpha: 0.17), textColor: teal)
    let tree = """
    lineageguard-datahub-agent/
    ├── skills/lineageguard-schema-review/
    │   ├── SKILL.md
    │   ├── scripts/score_change.py
    │   └── references/
    │       ├── risk-policy.md
    │       └── datahub-mcp.md
    ├── test/skill-scorer.test.mjs
    └── README.md
    """
    drawText(tree, rect: NSRect(x: 142, y: 250, width: 930, height: 420), size: 29, weight: .medium, color: white, mono: true, lineSpacing: 11)

    let cardX: CGFloat = 1180
    let cardW: CGFloat = 644
    let entries: [(String, String, NSColor)] = [
        ("5 surfaces", "Database · Warehouse · Event\nAPI · Data contract", teal),
        ("3 decisions", "APPROVE · CONDITIONAL · BLOCK", blue),
        ("$0 to test", "Python standard library\nNo API key or credentials", amber),
    ]
    for (offset, entry) in entries.enumerated() {
        let y = 580 - CGFloat(offset) * 210
        let rect = NSRect(x: cardX, y: y, width: cardW, height: 170)
        roundedRect(rect, radius: 24, fill: surface2, stroke: color(entry.2, alpha: 0.38), lineWidth: 2)
        drawText(entry.0, rect: NSRect(x: rect.minX + 34, y: rect.minY + 101, width: rect.width - 68, height: 42), size: 29, weight: .bold, color: entry.2, lineSpacing: 0)
        drawText(entry.1, rect: NSRect(x: rect.minX + 34, y: rect.minY + 28, width: rect.width - 68, height: 70), size: 22, weight: .medium, color: white, lineSpacing: 5)
    }
}

private func drawDecisionCard(rect: NSRect, label: String, score: String, detail: String, accent: NSColor) {
    roundedRect(rect, radius: 30, fill: surface2, stroke: color(accent, alpha: 0.5), lineWidth: 2)
    drawPill(label, rect: NSRect(x: rect.minX + 34, y: rect.maxY - 70, width: 210, height: 40), fill: color(accent, alpha: 0.18), textColor: accent)
    drawText(score, rect: NSRect(x: rect.minX + 36, y: rect.minY + 168, width: rect.width - 72, height: 124), size: 90, weight: .bold, color: accent, lineSpacing: 0)
    drawText(detail, rect: NSRect(x: rect.minX + 38, y: rect.minY + 52, width: rect.width - 76, height: 108), size: 23, weight: .medium, color: white, lineSpacing: 7)
}

private func drawDeterministicScene(_ scene: Scene) {
    drawSceneTitle(scene, subtitle: "Same manifest, same public policy, same result—entirely local.")
    drawDecisionCard(
        rect: NSRect(x: 96, y: 376, width: 810, height: 405),
        label: "BREAKING RENAME",
        score: "BLOCK  ·  72 / 100",
        detail: "12 downstream assets  ·  3 critical consumers\n5,000 weekly queries  ·  1 quality incident",
        accent: red
    )
    drawDecisionCard(
        rect: NSRect(x: 1014, y: 376, width: 810, height: 405),
        label: "NULLABLE ADDITION",
        score: "APPROVE  ·  0 / 100",
        detail: "1 downstream asset  ·  0 critical consumers\nFull tests  ·  rollback ready  ·  30-day window",
        accent: teal
    )
    let unknown = NSRect(x: 96, y: 126, width: 1728, height: 190)
    roundedRect(unknown, radius: 28, fill: color(surface, alpha: 0.98), stroke: color(amber, alpha: 0.42), lineWidth: 2)
    drawText("UNKNOWN ≠ SAFE", rect: NSRect(x: 134, y: 226, width: 420, height: 50), size: 29, weight: .bold, color: amber, lineSpacing: 0)
    drawText("Missing lineage, criticality, usage, incidents, owner, tests, rollback, or deprecation evidence adds risk—and can produce BLOCK.", rect: NSRect(x: 134, y: 155, width: 1570, height: 66), size: 24, weight: .medium, color: white, lineSpacing: 5)
}

private func drawArrow(x: CGFloat, y: CGFloat, width: CGFloat) {
    color(teal, alpha: 0.7).setStroke()
    let line = NSBezierPath()
    line.move(to: NSPoint(x: x, y: y))
    line.line(to: NSPoint(x: x + width - 24, y: y))
    line.lineWidth = 5
    line.stroke()
    color(teal, alpha: 0.9).setFill()
    let head = NSBezierPath()
    head.move(to: NSPoint(x: x + width, y: y))
    head.line(to: NSPoint(x: x + width - 30, y: y + 18))
    head.line(to: NSPoint(x: x + width - 30, y: y - 18))
    head.close()
    head.fill()
}

private func drawAuthorityScene(_ scene: Scene) {
    drawSceneTitle(scene, subtitle: "The model can explain and plan. It cannot silently change production.")
    let cards: [(String, String, NSColor)] = [
        ("1  READ", "DataHub MCP\nor redacted manifest", teal),
        ("2  REASON", "Deterministic score\n+ Codex explanation", blue),
        ("3  APPROVE", "Human authorizes\nany mutation", amber),
    ]
    let xs: [CGFloat] = [96, 674, 1252]
    for i in 0..<cards.count {
        let rect = NSRect(x: xs[i], y: 350, width: 480, height: 380)
        roundedRect(rect, radius: 30, fill: surface2, stroke: color(cards[i].2, alpha: 0.45), lineWidth: 2)
        drawText(cards[i].0, rect: NSRect(x: rect.minX + 38, y: rect.maxY - 92, width: rect.width - 76, height: 52), size: 30, weight: .bold, color: cards[i].2, lineSpacing: 0)
        drawText(cards[i].1, rect: NSRect(x: rect.minX + 38, y: rect.minY + 110, width: rect.width - 76, height: 140), size: 28, weight: .medium, color: white, alignment: .center, lineSpacing: 12)
    }
    drawArrow(x: 590, y: 540, width: 66)
    drawArrow(x: 1168, y: 540, width: 66)
    drawPill("READS ARE AUTOMATIC", rect: NSRect(x: 260, y: 224, width: 360, height: 50), fill: color(teal, alpha: 0.17), textColor: teal)
    drawPill("MUTATIONS ARE APPROVAL-GATED", rect: NSRect(x: 1080, y: 224, width: 560, height: 50), fill: color(amber, alpha: 0.16), textColor: amber)
    drawText("No production SQL is executed by this demo.", rect: NSRect(x: 96, y: 128, width: 1728, height: 54), size: 28, weight: .bold, color: white, alignment: .center, lineSpacing: 0)
}

private func drawConstraint(rect: NSRect, number: String, text: String) {
    roundedRect(rect, radius: 22, fill: surface, stroke: color(teal, alpha: 0.25), lineWidth: 2)
    roundedRect(NSRect(x: rect.minX + 22, y: rect.minY + 34, width: 64, height: 64), radius: 18, fill: color(teal, alpha: 0.18))
    drawText(number, rect: NSRect(x: rect.minX + 22, y: rect.minY + 52, width: 64, height: 30), size: 23, weight: .bold, color: teal, alignment: .center, lineSpacing: 0)
    drawText(text, rect: NSRect(x: rect.minX + 108, y: rect.minY + 28, width: rect.width - 134, height: 80), size: 22, weight: .semibold, color: white, lineSpacing: 5)
}

private func drawCollaborationScene(_ scene: Scene) {
    drawSceneTitle(scene, subtitle: "Owner-set constraints became an inspectable, tested implementation.")
    drawConstraint(rect: NSRect(x: 96, y: 648, width: 540, height: 132), number: "1", text: "Never execute a schema\nchange automatically")
    drawConstraint(rect: NSRect(x: 690, y: 648, width: 540, height: 132), number: "2", text: "Missing evidence must\nincrease risk")
    drawConstraint(rect: NSRect(x: 1284, y: 648, width: 540, height: 132), number: "3", text: "Judges test locally\nwith no paid infrastructure")

    let pipeline = NSRect(x: 96, y: 374, width: 1728, height: 208)
    roundedRect(pipeline, radius: 28, fill: surface2, stroke: color(blue, alpha: 0.35), lineWidth: 2)
    drawPill("PRODUCT OWNER", rect: NSRect(x: 142, y: 454, width: 260, height: 48), fill: color(teal, alpha: 0.18), textColor: teal)
    drawArrow(x: 438, y: 478, width: 118)
    drawPill("GPT-5.6 THROUGH CODEX", rect: NSRect(x: 598, y: 454, width: 420, height: 48), fill: color(blue, alpha: 0.18), textColor: blue)
    drawArrow(x: 1054, y: 478, width: 118)
    drawPill("SKILL · SCORER · POLICY · TESTS · DOCS", rect: NSRect(x: 1212, y: 454, width: 560, height: 48), fill: color(teal, alpha: 0.18), textColor: teal)

    let terminal = NSRect(x: 96, y: 120, width: 1728, height: 194)
    roundedRect(terminal, radius: 24, fill: NSColor(calibratedWhite: 0.018, alpha: 0.95), stroke: color(white, alpha: 0.14), lineWidth: 2)
    drawText("$ git log --oneline --date-order", rect: NSRect(x: 134, y: 248, width: 900, height: 28), size: 20, weight: .medium, color: muted, mono: true, lineSpacing: 0)
    drawText("2468482  Document Build Week Codex evidence\n00a0d00  Add LineageGuard Codex schema-review skill", rect: NSRect(x: 134, y: 150, width: 1180, height: 86), size: 24, weight: .medium, color: white, mono: true, lineSpacing: 10)
    drawPill("PERSISTED CODEX SESSION IN README", rect: NSRect(x: 1330, y: 178, width: 420, height: 46), fill: color(blue, alpha: 0.18), textColor: blue)
}

private func drawTestsScene(_ scene: Scene) {
    drawSceneTitle(scene, subtitle: "Clone, run, and inspect the new extension without an API key.")
    let terminal = NSRect(x: 96, y: 122, width: 1000, height: 650)
    roundedRect(terminal, radius: 28, fill: NSColor(calibratedWhite: 0.018, alpha: 0.96), stroke: color(teal, alpha: 0.3), lineWidth: 2)
    drawPill("LOCAL VERIFICATION", rect: NSRect(x: 132, y: 700, width: 250, height: 42), fill: color(teal, alpha: 0.15), textColor: teal)
    let output = """
    $ npm test

    ✔ serverless endpoints
    ✔ breaking migration blocked
    ✔ nullable field approved
    ✔ unknown evidence raises risk
    ✔ ambiguous boolean rejected

    tests 9
    pass  9
    fail  0
    """
    drawText(output, rect: NSRect(x: 142, y: 260, width: 850, height: 396), size: 25, weight: .medium, color: white, mono: true, lineSpacing: 8)
    drawPill("9 / 9 PASS", rect: NSRect(x: 748, y: 672, width: 280, height: 56), fill: color(teal, alpha: 0.18), textColor: teal)

    let quick = NSRect(x: 1140, y: 122, width: 684, height: 650)
    roundedRect(quick, radius: 28, fill: surface2, stroke: color(blue, alpha: 0.32), lineWidth: 2)
    drawText("Fastest test path", rect: NSRect(x: 1182, y: 694, width: 560, height: 52), size: 32, weight: .bold, color: white, lineSpacing: 0)
    let commands = """
    git clone \\
      github.com/ult666666/\\
      lineageguard-datahub-agent.git

    cd lineageguard-datahub-agent

    git checkout \\
      codex/lineageguard-codex-skill

    npm test
    """
    drawText(commands, rect: NSRect(x: 1182, y: 350, width: 570, height: 316), size: 20, weight: .medium, color: white, mono: true, lineSpacing: 8)
    drawPill("NO API KEY", rect: NSRect(x: 1182, y: 224, width: 180, height: 44), fill: color(teal, alpha: 0.17), textColor: teal)
    drawPill("NO CREDENTIALS", rect: NSRect(x: 1380, y: 224, width: 230, height: 44), fill: color(teal, alpha: 0.17), textColor: teal)
    drawPill("$0", rect: NSRect(x: 1628, y: 224, width: 110, height: 44), fill: color(amber, alpha: 0.17), textColor: amber)
}

private func drawCloseScene(_ scene: Scene) {
    drawText("LineageGuard", rect: NSRect(x: 96, y: 700, width: 1728, height: 120), size: 88, weight: .bold, color: white, alignment: .center, lineSpacing: 0)
    drawText("Stop breaking schema changes before they reach production.", rect: NSRect(x: 200, y: 618, width: 1520, height: 70), size: 34, weight: .medium, color: teal, alignment: .center, lineSpacing: 0)
    roundedRect(NSRect(x: 270, y: 354, width: 1380, height: 186), radius: 28, fill: surface, stroke: color(teal, alpha: 0.3), lineWidth: 2)
    drawText("github.com/ult666666/lineageguard-datahub-agent", rect: NSRect(x: 330, y: 448, width: 1260, height: 44), size: 28, weight: .semibold, color: white, mono: true, alignment: .center, lineSpacing: 0)
    drawText("lineageguard-datahub-agent.vercel.app", rect: NSRect(x: 330, y: 390, width: 1260, height: 40), size: 25, weight: .medium, color: blue, mono: true, alignment: .center, lineSpacing: 0)
    drawPill("PORTABLE CODEX SKILL", rect: NSRect(x: 420, y: 248, width: 340, height: 52), fill: color(teal, alpha: 0.17), textColor: teal)
    drawPill("DETERMINISTIC", rect: NSRect(x: 790, y: 248, width: 300, height: 52), fill: color(blue, alpha: 0.17), textColor: blue)
    drawPill("APPROVAL-GATED", rect: NSRect(x: 1120, y: 248, width: 360, height: 52), fill: color(amber, alpha: 0.17), textColor: amber)
    drawText("Public repository  ·  Local test path  ·  No paid infrastructure", rect: NSRect(x: 300, y: 162, width: 1320, height: 42), size: 23, weight: .medium, color: muted, alignment: .center, lineSpacing: 0)
}

private func drawMCPProofScene(_ scene: Scene) {
    drawSceneTitle(scene, subtitle: "A bounded Streamable HTTP check validates the real adapter contract without credentials.")

    let terminal = NSRect(x: 96, y: 122, width: 1100, height: 660)
    roundedRect(terminal, radius: 28, fill: NSColor(calibratedWhite: 0.018, alpha: 0.97), stroke: color(teal, alpha: 0.35), lineWidth: 2)
    drawPill("npm run mcp:smoke", rect: NSRect(x: 134, y: 708, width: 290, height: 42), fill: color(teal, alpha: 0.17), textColor: teal)
    let output = """
    $ npm run mcp:smoke

    {
      "ok": true,
      "transport": "local Streamable HTTP mock",
      "initializeCalls": 1,
      "tools": [
        "get_entities",
        "get_lineage"
      ],
      "downstreamAssets": 3,
      "decision": "block"
    }
    """
    drawText(output, rect: NSRect(x: 144, y: 190, width: 960, height: 480), size: 24, weight: .medium, color: white, mono: true, lineSpacing: 7)
    drawPill("SUCCESS", rect: NSRect(x: 938, y: 704, width: 190, height: 48), fill: color(teal, alpha: 0.18), textColor: teal)

    let proof = NSRect(x: 1240, y: 122, width: 584, height: 660)
    roundedRect(proof, radius: 28, fill: surface2, stroke: color(blue, alpha: 0.34), lineWidth: 2)
    drawText("What this proves", rect: NSRect(x: 1282, y: 700, width: 500, height: 50), size: 31, weight: .bold, color: white, lineSpacing: 0)
    let checks: [(String, String)] = [
        ("01", "One initialized MCP session"),
        ("02", "Official get_entities arguments"),
        ("03", "Downstream get_lineage normalization"),
        ("04", "JSON + event-stream responses"),
        ("05", "No tenant, API key, or paid service"),
    ]
    for (index, check) in checks.enumerated() {
        let y = 606 - CGFloat(index) * 102
        roundedRect(NSRect(x: 1280, y: y, width: 502, height: 78), radius: 18, fill: color(surface, alpha: 0.92), stroke: color(teal, alpha: 0.2))
        drawText(check.0, rect: NSRect(x: 1300, y: y + 24, width: 50, height: 30), size: 18, weight: .bold, color: teal, mono: true, alignment: .center, lineSpacing: 0)
        drawText(check.1, rect: NSRect(x: 1372, y: y + 17, width: 380, height: 45), size: 19, weight: .semibold, color: white, lineSpacing: 3)
    }
}

private func drawDataHubCloseScene(_ scene: Scene) {
    drawSceneTitle(scene, subtitle: "Public proof, reproducible tests, and an approval-gated production boundary.")

    let terminal = NSRect(x: 96, y: 244, width: 760, height: 530)
    roundedRect(terminal, radius: 28, fill: NSColor(calibratedWhite: 0.018, alpha: 0.97), stroke: color(teal, alpha: 0.34), lineWidth: 2)
    drawPill("npm test", rect: NSRect(x: 132, y: 704, width: 190, height: 42), fill: color(teal, alpha: 0.17), textColor: teal)
    let tests = """
    $ npm test

    ✔ serverless endpoints
    ✔ DataHub MCP smoke flow
    ✔ risky migration blocked
    ✔ safe addition approved
    ✔ unknown evidence raises risk
    ✔ ambiguous input rejected

    tests   10
    pass    10
    fail     0
    """
    drawText(tests, rect: NSRect(x: 142, y: 276, width: 650, height: 390), size: 22, weight: .medium, color: white, mono: true, lineSpacing: 5)
    drawPill("10 / 10 PASS", rect: NSRect(x: 570, y: 700, width: 230, height: 48), fill: color(teal, alpha: 0.18), textColor: teal)

    let links = NSRect(x: 900, y: 244, width: 924, height: 530)
    roundedRect(links, radius: 28, fill: surface2, stroke: color(blue, alpha: 0.34), lineWidth: 2)
    drawPill("PUBLIC", rect: NSRect(x: 944, y: 704, width: 150, height: 42), fill: color(blue, alpha: 0.18), textColor: blue)
    drawText("Live demo", rect: NSRect(x: 944, y: 630, width: 500, height: 34), size: 20, weight: .bold, color: muted, lineSpacing: 0)
    drawText("lineageguard-datahub-agent.vercel.app", rect: NSRect(x: 944, y: 578, width: 820, height: 42), size: 25, weight: .semibold, color: blue, mono: true, lineSpacing: 0)
    drawText("Repository", rect: NSRect(x: 944, y: 500, width: 500, height: 34), size: 20, weight: .bold, color: muted, lineSpacing: 0)
    drawText("github.com/ult666666/lineageguard-datahub-agent", rect: NSRect(x: 944, y: 448, width: 820, height: 42), size: 24, weight: .semibold, color: white, mono: true, lineSpacing: 0)
    drawPill("APACHE-2.0", rect: NSRect(x: 944, y: 354, width: 230, height: 48), fill: color(teal, alpha: 0.17), textColor: teal)
    drawPill("READ-ONLY DATAHUB", rect: NSRect(x: 1200, y: 354, width: 310, height: 48), fill: color(blue, alpha: 0.17), textColor: blue)
    drawPill("MUTATIONS GATED", rect: NSRect(x: 1536, y: 354, width: 244, height: 48), fill: color(amber, alpha: 0.17), textColor: amber)
    drawText("Merge-ready migration code from DataHub context.", rect: NSRect(x: 944, y: 282, width: 820, height: 42), size: 24, weight: .bold, color: white, lineSpacing: 0)

    drawText("Synthetic demo snapshot disclosed  ·  USD 0 to verify  ·  No production mutation", rect: NSRect(x: 96, y: 142, width: 1728, height: 50), size: 24, weight: .semibold, color: teal, alignment: .center, lineSpacing: 0)
}

private func renderScene(_ scene: Scene, index: Int, total: Int) -> CGImage {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: canvasWidth,
        pixelsHigh: canvasHeight,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    rep.size = NSSize(width: canvasWidth, height: canvasHeight)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    drawBackground()
    drawChrome(scene, index: index, total: total)
    switch scene.kind {
    case let .screenshot(path, disclosure):
        drawScreenshotScene(path, disclosure: disclosure, scene: scene)
    case .product:
        drawProductScene(scene)
    case .deterministic:
        drawDeterministicScene(scene)
    case .authority:
        drawAuthorityScene(scene)
    case .collaboration:
        drawCollaborationScene(scene)
    case .tests:
        drawTestsScene(scene)
    case .close:
        drawCloseScene(scene)
    case .mcpProof:
        drawMCPProofScene(scene)
    case .dataHubClose:
        drawDataHubCloseScene(scene)
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep.cgImage!
}

private func blend(_ first: CGImage, _ second: CGImage, alpha: CGFloat) -> CGImage {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: canvasWidth,
        pixelsHigh: canvasHeight,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    rep.size = NSSize(width: canvasWidth, height: canvasHeight)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.cgContext.draw(first, in: NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight))
    NSGraphicsContext.current?.cgContext.setAlpha(alpha)
    NSGraphicsContext.current?.cgContext.draw(second, in: NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight))
    NSGraphicsContext.restoreGraphicsState()
    return rep.cgImage!
}

private func assetDuration(_ url: URL) -> Double {
    let seconds = CMTimeGetSeconds(AVURLAsset(url: url).duration)
    return seconds.isFinite ? seconds : 0
}

private func runSay(text: String, output: URL) throws {
    try? FileManager.default.removeItem(at: output)
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/say")
    process.arguments = ["-v", "Samantha", "-r", videoMode.sayRate, "-o", output.path, text]
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw NSError(domain: "LineageGuardVideo", code: 1, userInfo: [NSLocalizedDescriptionKey: "say failed for \(output.lastPathComponent)"])
    }
}

private func appendFrame(
    _ image: CGImage,
    at seconds: Double,
    adaptor: AVAssetWriterInputPixelBufferAdaptor,
    input: AVAssetWriterInput,
    context: CIContext,
    colorSpace: CGColorSpace
) throws {
    while !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.005)
    }
    guard let pool = adaptor.pixelBufferPool else {
        throw NSError(domain: "LineageGuardVideo", code: 2, userInfo: [NSLocalizedDescriptionKey: "Pixel buffer pool unavailable"])
    }
    var maybeBuffer: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybeBuffer)
    guard status == kCVReturnSuccess, let buffer = maybeBuffer else {
        throw NSError(domain: "LineageGuardVideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not allocate pixel buffer: \(status)"])
    }
    context.render(
        CIImage(cgImage: image),
        to: buffer,
        bounds: CGRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight),
        colorSpace: colorSpace
    )
    let time = CMTime(seconds: max(0, seconds), preferredTimescale: 600)
    guard adaptor.append(buffer, withPresentationTime: time) else {
        throw NSError(domain: "LineageGuardVideo", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to append frame at \(seconds)s"])
    }
}

private func createSilentVideo(images: [CGImage], timed: [TimedScene], output: URL) throws {
    try? FileManager.default.removeItem(at: output)
    let writer = try AVAssetWriter(outputURL: output, fileType: .mov)
    let settings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: canvasWidth,
        AVVideoHeightKey: canvasHeight,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 8_000_000,
            AVVideoExpectedSourceFrameRateKey: frameRate,
            AVVideoMaxKeyFrameIntervalKey: frameRate * 2,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let attributes: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: canvasWidth,
        kCVPixelBufferHeightKey as String: canvasHeight,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:],
    ]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
    guard writer.canAdd(input) else {
        throw NSError(domain: "LineageGuardVideo", code: 5, userInfo: [NSLocalizedDescriptionKey: "Cannot add video writer input"])
    }
    writer.add(input)
    guard writer.startWriting() else {
        throw writer.error ?? NSError(domain: "LineageGuardVideo", code: 6, userInfo: [NSLocalizedDescriptionKey: "Writer failed to start"])
    }
    writer.startSession(atSourceTime: .zero)
    let ciContext = CIContext(options: [.cacheIntermediates: true])
    let colorSpace = CGColorSpaceCreateDeviceRGB()

    let total = timed.last!.end
    let frameCount = Int(ceil(total * Double(frameRate)))
    var sceneIndex = 0
    for frameIndex in 0..<frameCount {
        let seconds = Double(frameIndex) / Double(frameRate)
        while sceneIndex + 1 < timed.count && seconds >= timed[sceneIndex + 1].start {
            sceneIndex += 1
        }
        let sceneStart = timed[sceneIndex].start
        let frame: CGImage
        if sceneIndex > 0 && seconds < sceneStart + transitionSeconds {
            let fraction = CGFloat(max(0, min(1, (seconds - sceneStart) / transitionSeconds)))
            frame = blend(images[sceneIndex - 1], images[sceneIndex], alpha: fraction)
        } else {
            frame = images[sceneIndex]
        }
        try appendFrame(frame, at: seconds, adaptor: adaptor, input: input, context: ciContext, colorSpace: colorSpace)
        if frameIndex > 0 && frameIndex % Int(frameRate * 15) == 0 {
            print(String(format: "Rendered video: %.0f / %.0f seconds", seconds, total))
        }
    }
    writer.endSession(atSourceTime: CMTime(seconds: total, preferredTimescale: 600))
    input.markAsFinished()
    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { semaphore.signal() }
    semaphore.wait()
    guard writer.status == .completed else {
        throw writer.error ?? NSError(domain: "LineageGuardVideo", code: 7, userInfo: [NSLocalizedDescriptionKey: "Silent video render failed"])
    }
}

private func exportFinalVideo(silentVideo: URL, timed: [TimedScene], output: URL) throws {
    try? FileManager.default.removeItem(at: output)
    let composition = AVMutableComposition()
    let videoAsset = AVURLAsset(url: silentVideo)
    guard let sourceVideo = videoAsset.tracks(withMediaType: .video).first,
          let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw NSError(domain: "LineageGuardVideo", code: 8, userInfo: [NSLocalizedDescriptionKey: "Could not create composition video track"])
    }
    let total = CMTime(seconds: timed.last!.end, preferredTimescale: 600)
    try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: total), of: sourceVideo, at: .zero)
    videoTrack.preferredTransform = sourceVideo.preferredTransform

    guard let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw NSError(domain: "LineageGuardVideo", code: 9, userInfo: [NSLocalizedDescriptionKey: "Could not create composition audio track"])
    }
    for item in timed {
        let asset = AVURLAsset(url: item.audioURL)
        guard let sourceAudio = asset.tracks(withMediaType: .audio).first else {
            throw NSError(domain: "LineageGuardVideo", code: 10, userInfo: [NSLocalizedDescriptionKey: "Missing narration track: \(item.audioURL.lastPathComponent)"])
        }
        let duration = CMTime(seconds: item.audioDuration, preferredTimescale: 600)
        try audioTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: sourceAudio, at: CMTime(seconds: item.start, preferredTimescale: 600))
    }

    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset1920x1080) else {
        throw NSError(domain: "LineageGuardVideo", code: 11, userInfo: [NSLocalizedDescriptionKey: "Could not create export session"])
    }
    exporter.outputURL = output
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    exporter.timeRange = CMTimeRange(start: .zero, duration: total)
    let semaphore = DispatchSemaphore(value: 0)
    exporter.exportAsynchronously { semaphore.signal() }
    semaphore.wait()
    guard exporter.status == .completed else {
        throw exporter.error ?? NSError(domain: "LineageGuardVideo", code: 12, userInfo: [NSLocalizedDescriptionKey: "Final MP4 export failed"])
    }
}

private func saveContactSheet(assetURL: URL, times: [Double], output: URL) throws {
    let asset = AVURLAsset(url: assetURL)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(seconds: 0.15, preferredTimescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.15, preferredTimescale: 600)
    let columns = 4
    let rows = Int(ceil(Double(times.count) / Double(columns)))
    let thumbW = 440
    let thumbH = 248
    let labelH = 42
    let margin = 20
    let sheetW = columns * thumbW + (columns + 1) * margin
    let sheetH = rows * (thumbH + labelH) + (rows + 1) * margin
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: sheetW,
        pixelsHigh: sheetH,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    rep.size = NSSize(width: sheetW, height: sheetH)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor(calibratedWhite: 0.03, alpha: 1).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: sheetW, height: sheetH)).fill()
    for (index, seconds) in times.enumerated() {
        var actual = CMTime.zero
        let image = try generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: &actual)
        let col = index % columns
        let row = rows - 1 - index / columns
        let x = margin + col * (thumbW + margin)
        let y = margin + row * (thumbH + labelH + margin)
        NSGraphicsContext.current?.cgContext.draw(image, in: NSRect(x: x, y: y + labelH, width: thumbW, height: thumbH))
        drawText(String(format: "%02d  ·  %05.1f s", index + 1, CMTimeGetSeconds(actual)), rect: NSRect(x: x, y: y + 8, width: thumbW, height: 26), size: 17, weight: .medium, color: muted, mono: true, alignment: .center, lineSpacing: 0)
    }
    NSGraphicsContext.restoreGraphicsState()
    guard let data = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "LineageGuardVideo", code: 13, userInfo: [NSLocalizedDescriptionKey: "Could not encode contact sheet"])
    }
    try data.write(to: output)
}

private func inspect(_ output: URL) {
    let asset = AVURLAsset(url: output)
    let duration = CMTimeGetSeconds(asset.duration)
    let video = asset.tracks(withMediaType: .video).first
    let audio = asset.tracks(withMediaType: .audio).first
    let size = video?.naturalSize.applying(video?.preferredTransform ?? .identity) ?? .zero
    let resolved = CGSize(width: abs(size.width), height: abs(size.height))
    var audioCodec = "none"
    if let description = audio?.formatDescriptions.first {
        let basic = CMAudioFormatDescriptionGetStreamBasicDescription(description as! CMAudioFormatDescription)
        if let basic {
            let formatID = basic.pointee.mFormatID
            let chars = [
                Character(UnicodeScalar((formatID >> 24) & 0xff)!),
                Character(UnicodeScalar((formatID >> 16) & 0xff)!),
                Character(UnicodeScalar((formatID >> 8) & 0xff)!),
                Character(UnicodeScalar(formatID & 0xff)!),
            ]
            audioCodec = String(chars)
        }
    }
    print(String(format: "OUTPUT=%@", output.path))
    print(String(format: "DURATION=%.3f", duration))
    print("RESOLUTION=\(Int(resolved.width))x\(Int(resolved.height))")
    print("VIDEO_CODEC=H.264")
    print("AUDIO_CODEC=\(audioCodec)")
    print("AUDIO_TRACKS=\(audio == nil ? 0 : 1)")
}

private func main() throws {
    let repo = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true).standardizedFileURL
    let assets = repo.appendingPathComponent("assets", isDirectory: true)
    let isDataHub = CommandLine.arguments.contains("--datahub")
    videoMode = isDataHub ? .dataHub : .buildWeek
    let narrationURL = assets.appendingPathComponent(isDataHub ? "datahub-demo-narration.txt" : "build-week-demo-narration.txt")
    let output = assets.appendingPathComponent(isDataHub ? "lineageguard-datahub-demo.mp4" : "lineageguard-openai-build-week-demo.mp4")
    let silent = assets.appendingPathComponent(isDataHub ? ".lineageguard-datahub-silent.mov" : ".lineageguard-build-week-silent.mov")
    let audioDir = assets.appendingPathComponent(isDataHub ? ".datahub-narration" : ".build-week-narration", isDirectory: true)
    let contactSheet = assets.appendingPathComponent(isDataHub ? "lineageguard-datahub-demo-contact-sheet.png" : "lineageguard-openai-build-week-demo-contact-sheet.png")

    let narration = try String(contentsOf: narrationURL, encoding: .utf8)
    let paragraphs = narration
        .components(separatedBy: "\n\n")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    let expectedParagraphs = isDataHub ? 7 : 8
    guard paragraphs.count == expectedParagraphs else {
        throw NSError(domain: "LineageGuardVideo", code: 14, userInfo: [NSLocalizedDescriptionKey: "Expected \(expectedParagraphs) narration paragraphs, found \(paragraphs.count)"])
    }

    let scenes: [Scene]
    if isDataHub {
        scenes = [
            Scene(title: "Reveal schema blast radius before merge", eyebrow: "DataHub advantage", narration: paragraphs[0], kind: .screenshot(assets.appendingPathComponent("demo-landing.jpg").path, "LineageGuard reads DataHub context before a small edit becomes a production incident.")),
            Scene(title: "One structured change request", eyebrow: "Synthetic snapshot disclosed", narration: paragraphs[1], kind: .screenshot(assets.appendingPathComponent("demo-request.jpg").path, "Dataset URN plus rename, breaking type change, and destructive column removal.")),
            Scene(title: "BLOCK · CRITICAL · 100 / 100", eyebrow: "Context-aware decision", narration: paragraphs[2], kind: .screenshot(assets.appendingPathComponent("demo-impact.jpg").path, "Four downstream assets, active usage, sensitive data, ownership gaps, and quality context.")),
            Scene(title: "Generate a staged migration—not just a warning", eyebrow: "Merge-ready code", narration: paragraphs[3], kind: .screenshot(assets.appendingPathComponent("demo-artifacts.jpg").path, "Additive compatibility window, shadow conversion, validation gate, and deferred removal.")),
            Scene(title: "Evidence packaged for review", eyebrow: "PR artifact + authority boundary", narration: paragraphs[4], kind: .screenshot(assets.appendingPathComponent("demo-trace.jpg").path, "DataHub reads are automatic; production SQL and catalog mutations remain approval-gated.")),
            Scene(title: "DataHub MCP contract, verified locally", eyebrow: "Transport proof", narration: paragraphs[5], kind: .mcpProof),
            Scene(title: "Public, reproducible, and ready to inspect", eyebrow: "Proof and close", narration: paragraphs[6], kind: .dataHubClose),
        ]
    } else {
        scenes = [
            Scene(title: "Hidden blast radius, visible before merge", eyebrow: "Problem", narration: paragraphs[0], kind: .screenshot(assets.appendingPathComponent("demo-result-top.jpg").path, "One local edit can break dashboards, pipelines, models, and alerts downstream.")),
            Scene(title: "A portable Codex schema-review skill", eyebrow: "Build Week extension", narration: paragraphs[1], kind: .product),
            Scene(title: "From DataHub context to a safe decision", eyebrow: "Working output", narration: paragraphs[2], kind: .screenshot(assets.appendingPathComponent("demo-impact.jpg").path, "Read-only evidence in; decision, critical paths, and migration artifacts out.")),
            Scene(title: "Deterministic safety—not a hidden model score", eyebrow: "Local scorer", narration: paragraphs[3], kind: .deterministic),
            Scene(title: "Interpretation without production authority", eyebrow: "Safety boundary", narration: paragraphs[4], kind: .authority),
            Scene(title: "How GPT-5.6 and Codex were used", eyebrow: "Collaboration", narration: paragraphs[5], kind: .collaboration),
            Scene(title: "Nine tests. One command. No paid service.", eyebrow: "Easy verification", narration: paragraphs[6], kind: .tests),
            Scene(title: "Ready to inspect and run locally", eyebrow: "Proof and close", narration: paragraphs[7], kind: .close),
        ]
    }

    try FileManager.default.createDirectory(at: audioDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: audioDir) }
    var timed: [TimedScene] = []
    var cursor = 0.0
    let dataHubMinimumDurations: [Double] = [18, 24, 28, 24, 21, 25, 14]
    for (index, scene) in scenes.enumerated() {
        let audioURL = audioDir.appendingPathComponent(String(format: "scene-%02d.aiff", index + 1))
        try runSay(text: scene.narration, output: audioURL)
        let duration = assetDuration(audioURL)
        guard duration > 0 else {
            throw NSError(domain: "LineageGuardVideo", code: 15, userInfo: [NSLocalizedDescriptionKey: "Narration duration is zero for scene \(index + 1)"])
        }
        let naturalDuration = duration + (index == scenes.count - 1 ? 0.8 : gapSeconds)
        let sceneDuration = isDataHub ? max(naturalDuration, dataHubMinimumDurations[index]) : naturalDuration
        let end = cursor + sceneDuration
        timed.append(TimedScene(scene: scene, audioURL: audioURL, start: cursor, audioDuration: duration, end: end))
        cursor = end
        print(String(format: "Scene %d: %.2fs", index + 1, duration))
    }
    guard cursor < 180 else {
        throw NSError(domain: "LineageGuardVideo", code: 16, userInfo: [NSLocalizedDescriptionKey: String(format: "Narration is too long: %.2fs", cursor)])
    }

    let images = scenes.enumerated().map { renderScene($0.element, index: $0.offset, total: scenes.count) }
    try createSilentVideo(images: images, timed: timed, output: silent)
    try exportFinalVideo(silentVideo: silent, timed: timed, output: output)
    let midpoints = timed.map { $0.start + min($0.audioDuration * 0.55, max(1, $0.audioDuration - 0.5)) }
    try saveContactSheet(assetURL: output, times: midpoints, output: contactSheet)
    try? FileManager.default.removeItem(at: silent)
    inspect(output)
    print("CONTACT_SHEET=\(contactSheet.path)")
}

do {
    try main()
} catch {
    fputs("render-build-week-video: \(error.localizedDescription)\n", stderr)
    exit(1)
}
