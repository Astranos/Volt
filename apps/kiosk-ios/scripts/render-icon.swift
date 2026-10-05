import AppKit

// Code-drawn tablet and store bag, with no scanner artwork or remote assets.
let size = 1024
let renderer = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: renderer, flipped: false)
let green = NSColor(srgbRed: 0.14, green: 0.43, blue: 0.21, alpha: 1)
green.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: size, height: size)).fill()
let tablet = NSBezierPath(roundedRect: NSRect(x: 176, y: 198, width: 672, height: 628), xRadius: 70, yRadius: 70)
NSColor.white.setFill()
tablet.fill()
green.setFill()
NSBezierPath(roundedRect: NSRect(x: 207, y: 246, width: 610, height: 549), xRadius: 42, yRadius: 42).fill()
let bag = NSBezierPath()
bag.move(to: NSPoint(x: 359, y: 360))
bag.line(to: NSPoint(x: 382, y: 581))
bag.line(to: NSPoint(x: 642, y: 581))
bag.line(to: NSPoint(x: 665, y: 360))
bag.close()
NSColor.white.setFill()
bag.fill()
let handle = NSBezierPath()
handle.move(to: NSPoint(x: 435, y: 557))
handle.curve(to: NSPoint(x: 589, y: 557), controlPoint1: NSPoint(x: 422, y: 728), controlPoint2: NSPoint(x: 602, y: 728))
handle.lineWidth = 25
handle.lineCapStyle = .round
NSColor.white.setStroke()
handle.stroke()
green.setStroke()
let check = NSBezierPath()
check.move(to: NSPoint(x: 450, y: 463))
check.line(to: NSPoint(x: 494, y: 419))
check.line(to: NSPoint(x: 574, y: 506))
check.lineWidth = 26
check.lineCapStyle = .round
check.lineJoinStyle = .round
check.stroke()
green.setFill()
NSBezierPath(ovalIn: NSRect(x: 502, y: 216, width: 20, height: 20)).fill()
NSGraphicsContext.restoreGraphicsState()
let output = URL(fileURLWithPath: "ios/VoltKiosk/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
let bitmap = NSBitmapImageRep(cgImage: renderer.makeImage()!)
try bitmap.representation(using: .png, properties: [:])!.write(to: output)
print("Rendered native kiosk icon to \(output.path)")
