// Verify the embedded artwork really survives compression/remounting in Finder.
// Finder's background-picture AppleScript getter fails on macOS 14, even when
// the picture is visible. Compare its rendered type and arrow, not that getter.
import AppKit

guard CommandLine.arguments.count == 3,
      let expected = NSBitmapImageRep(contentsOfFile: CommandLine.arguments[1]),
      let actual = NSBitmapImageRep(contentsOfFile: CommandLine.arguments[2]) else {
    fatalError("Expected embedded TIFF and actual Finder window screenshot")
}
let expectedScale = Double(expected.pixelsWide) / 640
let actualScale = Double(actual.pixelsWide) / 640
guard expectedScale >= 1, actualScale >= 1,
      abs(Double(actual.pixelsHigh) / actualScale - 444) <= 2 else {
    fatalError("Unexpected Finder screenshot dimensions")
}
func rgb(_ image: NSBitmapImageRep, _ x: Int, _ y: Int) -> [Double] {
    guard x >= 0, y >= 0, x < image.pixelsWide, y < image.pixelsHigh,
          let c = image.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else {
        fatalError("Cannot sample Finder artwork")
    }
    return [Double(c.redComponent), Double(c.greenComponent), Double(c.blueComponent)]
}
// Only artwork regions: never compare the real app/Applications icons or labels.
let regions = [(150, 35, 490, 115), (290, 198, 350, 226), (160, 335, 480, 365)]
let samples: [(Int, Int, [Double])] = regions.flatMap { x0, y0, x1, y1 in
    (y0..<y1).flatMap { y in
        (x0..<x1).compactMap { x -> (Int, Int, [Double])? in
            let color = rgb(expected, Int(Double(x) * expectedScale), Int(Double(y) * expectedScale))
            // Require actual lettering/arrow, not a match on blank white areas.
            return color.max()! < 0.65 ? (x, y, color) : nil
        }
    }
}
guard samples.count > 400 else { fatalError("Embedded artwork contains no readable foreground") }
// Finder title bars vary by OS. Find only a tightly bounded title-bar offset;
// retain exact horizontal alignment and scale from the captured window width.
var bestError = Double.infinity, bestOffset = 0, bestMatches = 0
for offset in 20...36 {
    var total = 0.0, matches = 0
    for (x, y, color) in samples {
        let pixel = rgb(actual, Int(Double(x) * actualScale), Int(Double(y + offset) * actualScale))
        let error = zip(color, pixel).map { abs($0 - $1) }.max()!
        total += error
        if error < 0.12 { matches += 1 }
    }
    let mean = total / Double(samples.count)
    if mean < bestError { bestError = mean; bestOffset = offset; bestMatches = matches }
}
guard bestError < 0.10, Double(bestMatches) / Double(samples.count) > 0.90 else {
    fatalError("Reopened Finder artwork differs: error=\(bestError), matched=\(bestMatches)/\(samples.count)")
}
print("Reopened Finder background verified: \(bestMatches)/\(samples.count) foreground pixels, mean error \(bestError), title-bar offset \(bestOffset).")
