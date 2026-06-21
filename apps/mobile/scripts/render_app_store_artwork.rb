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
TITLE_FONT = File.exist?("/Library/Fonts/SF-Pro-Display-Heavy.otf") ? "/Library/Fonts/SF-Pro-Display-Heavy.otf" : FONT

Scene = Struct.new(
  :source,
  :output,
  :title,
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
    title: "Pair and swap between multiple sessions",
    theme: :light,
    phone_width: 1100,
    phone_y: 590,
    phone_x: 80,
    tilt: -3
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-02-capture-text-chip_framed_transparent.png",
    output: "02-capture-text-chip.png",
    title: "Detect details instantly",
    theme: :product,
    phone_width: 1100,
    phone_y: 590,
    phone_x: 80,
    tilt: 2
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-03-capture-text-extracted_framed_transparent.png",
    output: "03-capture-text-extracted.png",
    title: "Extract serial numbers, model numbers, and IMEIs",
    theme: :dark,
    phone_width: 1100,
    phone_y: 590,
    phone_x: 80,
    tilt: -2
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-04-capture-send-popup_framed_transparent.png",
    output: "04-capture-send-popup.png",
    title: "Send directly to your desktop.",
    theme: :light,
    phone_width: 1100,
    phone_y: 590,
    phone_x: 80,
    tilt: 3
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-05-capture-barcode-detected_framed_transparent.png",
    output: "05-capture-barcode-detected.png",
    title: "Scan and send any barcode",
    theme: :product,
    phone_width: 1100,
    phone_y: 590,
    phone_x: 80,
    tilt: -3
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-06-capture-photo-viewfinder_framed_transparent.png",
    output: "06-capture-photo-viewfinder.png",
    title: "Take listing photos in the same flow",
    theme: :dark,
    phone_width: 1100,
    phone_y: 590,
    phone_x: 80,
    tilt: 2
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-07-capture-results_framed_transparent.png",
    output: "07-capture-results.png",
    title: "All captures are sent to your desktop",
    theme: :light,
    phone_width: 1100,
    phone_y: 590,
    phone_x: 80,
    tilt: -2
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-08-dictation_framed_transparent.png",
    output: "08-dictation.png",
    title: "Dictate anything directly to your desktop",
    theme: :product,
    phone_width: 1100,
    phone_y: 590,
    phone_x: 80,
    tilt: 3
  ),
  Scene.new(
    source: "iPhone 17 Pro Max-09-upload-batches_framed_transparent.png",
    output: "09-upload-batches.png",
    title: "Easily upload photos to your desktop",
    theme: :dark,
    phone_width: 1100,
    phone_y: 590,
    phone_x: 80,
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
      title: "#f7fff9"
    }
  when :product
    {
      gradient_a: "#eafff1",
      gradient_b: "#35c765",
      card: "#062112",
      title: "#062112"
    }
  else
    {
      gradient_a: "#f7fff9",
      gradient_b: "#d8f8e3",
      card: "#0f2f1d",
      title: "#062112"
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
    "-draw", "roundrectangle 86,760 1234,2600 88,88",
    "-fill", "#06211212",
    "-draw", "roundrectangle 160,870 1160,2520 76,76",
    path
  )
end

def text_image(text, path, width:, height:, point_size:, fill:, gravity: "center", font: FONT, weight: 400)
  run!(
    "magick",
    "-background", "none",
    "-fill", fill,
    "-font", font,
    "-weight", weight.to_s,
    "-pointsize", point_size.to_s,
    "-interline-spacing", "-4",
    "-size", "#{width}x#{height}",
    "-gravity", gravity,
    "caption:#{text}",
    path
  )
end

def phone_image(source, path, width, tilt)
  resized = File.join(TMP, "phone-resized.png")
  run!("magick", source, "-resize", "#{width}x", resized)
  input = resized
  if tilt && tilt != 0
    rotated = File.join(TMP, "phone-rotated.png")
    run!(
      "magick",
      resized,
      "-background", "none",
      "-virtual-pixel", "transparent",
      "+distort", "SRT", tilt.to_s,
      "+repage",
      rotated
    )
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
  title = File.join(TMP, "title.png")
  phone = File.join(TMP, "phone.png")
  output = File.join(OUTPUT, scene.output)

  draw_background(background, colors)
  text_image(
    scene.title,
    title,
    width: 1160,
    height: 430,
    point_size: 118,
    fill: colors.fetch(:title),
    font: TITLE_FONT,
    weight: 800
  )
  phone_image(source, phone, scene.phone_width, scene.tilt)

  FileUtils.mkdir_p(File.dirname(output))
  args = [
    "magick",
    background,
    title, "-geometry", "+80+105", "-compose", "over", "-composite"
  ]
  args.concat([phone, "-geometry", "+#{scene.phone_x}+#{scene.phone_y}", "-compose", "over", "-composite", output])
  run!(*args)
end

FileUtils.rm_rf(OUTPUT)
FileUtils.rm_rf(TMP)
SCENES.each { |scene| render_scene(scene) }
FileUtils.rm_rf(TMP)

puts "Rendered #{SCENES.length} App Store artwork screenshots to #{OUTPUT}"
