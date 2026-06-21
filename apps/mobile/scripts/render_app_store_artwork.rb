#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "open3"

ROOT = File.expand_path("..", __dir__)
LANGUAGE = ENV.fetch("VOLT_SCREENSHOT_LANGUAGE", "en-US")
FRAME_SOURCE = File.join(ROOT, "build/framed-screenshots", LANGUAGE)
OUTPUT = File.join(ROOT, "build/app-store-artwork", LANGUAGE)
TMP = File.join(ROOT, "build/app-store-artwork-tmp")
WIDTH = 1320
HEIGHT = 2868
FONT = "/System/Library/Fonts/SFNS.ttf"

Scene = Struct.new(
  :source,
  :output,
  :eyebrow,
  :title,
  :subtitle,
  :theme,
  :phone_width,
  :phone_y,
  :phone_x,
  :tilt,
  keyword_init: true
)

SCENES = [
  Scene.new(
    source: "iPhone 17 Pro Max-01-connected-sessions_framed_transparent.png",
    output: "01-connected-sessions.png",
    eyebrow: "Volt for Chrome",
    title: "Pair once. Capture into any browser tab.",
    subtitle: "Reconnect to saved Chrome sessions and send scans straight to the focused field.",
    theme: :light,
    phone_width: 900,
    phone_y: 870,
    phone_x: 210,
    tilt: -3
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-02-capture-text-chip_framed_transparent.png",
    output: "02-capture-text-chip.png",
    eyebrow: "Live device text",
    title: "Spot serials before you capture.",
    subtitle: "Volt surfaces model, serial, and IMEI chips while the camera is still open.",
    theme: :product,
    phone_width: 920,
    phone_y: 840,
    phone_x: 200,
    tilt: 2
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-03-capture-text-extracted_framed_transparent.png",
    output: "03-capture-text-extracted.png",
    eyebrow: "Precise OCR",
    title: "Tap only the identifier you need.",
    subtitle: "Post-capture highlights focus on model, serial, and IMEI values instead of whole lines.",
    theme: :dark,
    phone_width: 930,
    phone_y: 830,
    phone_x: 195,
    tilt: -2
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-04-capture-send-popup_framed_transparent.png",
    output: "04-capture-send-popup.png",
    eyebrow: "Review before send",
    title: "Clean up OCR text on device.",
    subtitle: "Send the raw capture, polish it first, or close the action sheet and keep reviewing.",
    theme: :light,
    phone_width: 900,
    phone_y: 850,
    phone_x: 210,
    tilt: 3
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-05-capture-barcode-detected_framed_transparent.png",
    output: "05-capture-barcode-detected.png",
    eyebrow: "Barcode capture",
    title: "Scan UPCs without leaving inventory.",
    subtitle: "Guide the camera, confirm the code, and send it back to Chrome instantly.",
    theme: :product,
    phone_width: 890,
    phone_y: 855,
    phone_x: 215,
    tilt: -3
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-06-capture-photo-viewfinder_framed_transparent.png",
    output: "06-capture-photo-viewfinder.png",
    eyebrow: "Photo capture",
    title: "Take listing photos in the same flow.",
    subtitle: "Move from identifiers to product photos without changing tools.",
    theme: :dark,
    phone_width: 900,
    phone_y: 865,
    phone_x: 210,
    tilt: 2
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-07-capture-results_framed_transparent.png",
    output: "07-capture-results.png",
    eyebrow: "Capture history",
    title: "Keep every scan visible.",
    subtitle: "Text, barcodes, and photos stay organized after the session ends.",
    theme: :light,
    phone_width: 900,
    phone_y: 850,
    phone_x: 210,
    tilt: -2
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-08-dictation_framed_transparent.png",
    output: "08-dictation.png",
    eyebrow: "Hands-free entry",
    title: "Dictate descriptions directly to Chrome.",
    subtitle: "Capture condition notes and listing copy while your hands stay on the item.",
    theme: :product,
    phone_width: 900,
    phone_y: 850,
    phone_x: 210,
    tilt: 3
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-09-upload-batches_framed_transparent.png",
    output: "09-upload-batches.png",
    eyebrow: "Batch uploads",
    title: "Send photo batches with delivery status.",
    subtitle: "Track upload progress and recover failed sends without losing work.",
    theme: :dark,
    phone_width: 900,
    phone_y: 850,
    phone_x: 210,
    tilt: -3
  )
].freeze

def run!(*args)
  stdout, stderr, status = Open3.capture3(*args)
  return if status.success?

  warn stdout unless stdout.empty?
  warn stderr unless stderr.empty?
  abort "Command failed: #{args.join(' ')}"
end

def theme_colors(theme)
  case theme
  when :dark
    {
      gradient_a: "#03170d",
      gradient_b: "#0a3a21",
      card: "#f5fff8",
      title: "#f7fff9",
      subtitle: "#cdebd7",
      eyebrow_bg: "#35c765",
      eyebrow_text: "#062112"
    }
  when :product
    {
      gradient_a: "#eafff1",
      gradient_b: "#35c765",
      card: "#062112",
      title: "#062112",
      subtitle: "#1f4f32",
      eyebrow_bg: "#062112",
      eyebrow_text: "#f7fff9"
    }
  else
    {
      gradient_a: "#f7fff9",
      gradient_b: "#d8f8e3",
      card: "#0f2f1d",
      title: "#062112",
      subtitle: "#315c40",
      eyebrow_bg: "#35c765",
      eyebrow_text: "#062112"
    }
  end
end

def draw_background(path, colors)
  run!(
    "magick",
    "-size", "#{WIDTH}x#{HEIGHT}",
    "gradient:#{colors.fetch(:gradient_a)}-#{colors.fetch(:gradient_b)}",
    "-fill", "#ffffff33",
    "-draw", "circle 1130,220 1420,220",
    "-fill", "#06211218",
    "-draw", "circle 120,2520 520,2520",
    "-fill", "#ffffff24",
    "-draw", "roundrectangle 86,690 1234,2600 88,88",
    "-fill", "#06211212",
    "-draw", "roundrectangle 160,790 1160,2520 76,76",
    path
  )
end

def text_image(text, path, width:, height:, point_size:, fill:, gravity: "center", font: FONT)
  run!(
    "magick",
    "-background", "none",
    "-fill", fill,
    "-font", font,
    "-pointsize", point_size.to_s,
    "-interline-spacing", "-8",
    "-size", "#{width}x#{height}",
    "-gravity", gravity,
    "caption:#{text}",
    path
  )
end

def pill_image(text, path, colors)
  label = File.join(TMP, "pill-label.png")
  text_image(
    text.upcase,
    label,
    width: 720,
    height: 70,
    point_size: 34,
    fill: colors.fetch(:eyebrow_text)
  )
  run!(
    "magick",
    "-size", "780x92",
    "xc:none",
    "-fill", colors.fetch(:eyebrow_bg),
    "-draw", "roundrectangle 0,0 779,91 46,46",
    label,
    "-gravity", "center",
    "-compose", "over",
    "-composite",
    path
  )
end

def phone_image(source, path, width, tilt)
  resized = File.join(TMP, "phone-resized.png")
  run!("magick", source, "-resize", "#{width}x", resized)
  input = resized
  if tilt && tilt != 0
    rotated = File.join(TMP, "phone-rotated.png")
    run!("magick", resized, "-background", "none", "-distort", "SRT", tilt.to_s, rotated)
    input = rotated
  end

  run!(
    "magick",
    input,
    "(",
    "+clone",
    "-background", "#00000080",
    "-shadow", "58x24+0+34",
    ")",
    "+swap",
    "-background", "none",
    "-layers", "merge",
    "+repage",
    path
  )
end

def render_scene(scene)
  colors = theme_colors(scene.theme)
  source = File.join(FRAME_SOURCE, scene.source)
  abort "Missing framed screenshot: #{source}" unless File.exist?(source)

  FileUtils.mkdir_p(TMP)
  background = File.join(TMP, "background.png")
  eyebrow = File.join(TMP, "eyebrow.png")
  title = File.join(TMP, "title.png")
  subtitle = File.join(TMP, "subtitle.png")
  phone = File.join(TMP, "phone.png")
  output = File.join(OUTPUT, scene.output)

  draw_background(background, colors)
  pill_image(scene.eyebrow, eyebrow, colors)
  text_image(scene.title, title, width: 1120, height: 320, point_size: 84, fill: colors.fetch(:title))
  text_image(scene.subtitle, subtitle, width: 1040, height: 180, point_size: 38, fill: colors.fetch(:subtitle))
  phone_image(source, phone, scene.phone_width, scene.tilt)

  FileUtils.mkdir_p(File.dirname(output))
  run!(
    "magick",
    background,
    eyebrow, "-geometry", "+270+128", "-compose", "over", "-composite",
    title, "-geometry", "+100+245", "-compose", "over", "-composite",
    subtitle, "-geometry", "+140+560", "-compose", "over", "-composite",
    phone, "-geometry", "+#{scene.phone_x}+#{scene.phone_y}", "-compose", "over", "-composite",
    output
  )
end

FileUtils.rm_rf(OUTPUT)
FileUtils.rm_rf(TMP)
SCENES.each { |scene| render_scene(scene) }
FileUtils.rm_rf(TMP)

puts "Rendered #{SCENES.length} App Store artwork screenshots to #{OUTPUT}"
