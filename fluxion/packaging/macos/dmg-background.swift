// Build-time artwork only. Finder supplies the real draggable app/folder icons.
import AppKit

guard CommandLine.arguments.count == 2 else { fatalError("Expected artwork output directory") }
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let width = 640, height = 420
for scale in [1, 2] {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width * scale,
        pixelsHigh: height * scale, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let context = NSGraphicsContext(bitmapImageRep: bitmap) else { fatalError("Cannot create DMG artwork") }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    let transform = NSAffineTransform()
    transform.scale(by: CGFloat(scale)); transform.concat()
    NSColor(srgbRed: 0.96, green: 0.955, blue: 0.94, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)).fill()
    func text(_ value: String, top: CGFloat, size: CGFloat, weight: NSFont.Weight, color: NSColor) {
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight),
            .foregroundColor: color, .paragraphStyle: paragraph]
        (value as NSString).draw(in: NSRect(x: 32, y: CGFloat(height) - top - size * 1.5,
            width: CGFloat(width) - 64, height: size * 1.5), withAttributes: attributes)
    }
    let ink = NSColor(srgbRed: 0.13, green: 0.15, blue: 0.15, alpha: 1)
    let muted = NSColor(srgbRed: 0.35, green: 0.38, blue: 0.37, alpha: 1)
    text("Install Fluxion", top: 40, size: 28, weight: .semibold, color: ink)
    text("Drag Fluxion to Applications.", top: 85, size: 15, weight: .regular, color: muted)
    let arrow = NSBezierPath(); arrow.lineWidth = 2; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round
    arrow.move(to: NSPoint(x: 298, y: 208)); arrow.line(to: NSPoint(x: 342, y: 208))
    arrow.move(to: NSPoint(x: 333, y: 217)); arrow.line(to: NSPoint(x: 342, y: 208)); arrow.line(to: NSPoint(x: 333, y: 199))
    muted.setStroke(); arrow.stroke()
    text("Then open Fluxion from Applications.", top: 340, size: 13, weight: .regular, color: muted)
    NSGraphicsContext.restoreGraphicsState()
    guard let data = bitmap.representation(using: .png, properties: [:]) else { fatalError("Cannot encode DMG artwork") }
    try data.write(to: output.appendingPathComponent(scale == 1 ? "background.png" : "background@2x.png"), options: .withoutOverwriting)
}
