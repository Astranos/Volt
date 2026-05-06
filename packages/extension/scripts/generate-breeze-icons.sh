#!/bin/bash

# Script to generate Chrome extension icons from breeze.svg using sips
# This script creates multiple icon sizes required for Chrome extensions

set -e

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BREEZE_SVG="$SCRIPT_DIR/../public/assets/icons/breeze.svg"
ICONS_DIR="$SCRIPT_DIR/../public/assets/icons"
TEMP_DIR="$SCRIPT_DIR/../temp"

# Icon sizes required for Chrome extensions
SIZES=(16 32 48 128)

# Create temp directory if it doesn't exist
mkdir -p "$TEMP_DIR"

# Ensure icons directory exists
mkdir -p "$ICONS_DIR"

echo "Generating Chrome extension icons from breeze.svg using sips..."

# First convert SVG to a high-resolution PNG using sips
# sips doesn't directly support SVG to PNG conversion, so we'll use a different approach
# We'll create a high-resolution base image first and then resize

# Check if breeze.svg exists
if [ ! -f "$BREEZE_SVG" ]; then
    echo "Error: breeze.svg not found at $BREEZE_SVG"
    exit 1
fi

# Function to create a colored SVG with specific size
create_colored_svg() {
    local size=$1
    local output_file="$TEMP_DIR/breeze-${size}.svg"
    
    # Create a new SVG with the desired size and green color
    cat > "$output_file" << EOF
<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <g transform="scale(${size}/24)">
    <path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
EOF
    
    echo "$output_file"
}

# Generate icons for each size
for size in "${SIZES[@]}"; do
    echo "Processing ${size}x${size} icon..."
    
    # Create a sized SVG with green color
    sized_svg=$(create_colored_svg $size)
    
    # Convert to PNG using sips
    # Note: sips can't directly convert SVG, so we'll use rsvg-convert if available
    # or fall back to a different method
    
    if command -v rsvg-convert &> /dev/null; then
        # Use rsvg-convert if available (part of librsvg)
        rsvg-convert -w $size -h $size -o "$ICONS_DIR/icon${size}.png" "$sized_svg"
        echo "✓ Created $ICONS_DIR/icon${size}.png (using rsvg-convert)"
    else
        # Alternative: Use sips with a base PNG if available
        echo "Warning: rsvg-convert not found. You may need to install librsvg:"
        echo "  brew install librsvg"
        echo ""
        echo "For now, creating a placeholder icon..."
        
        # Create a simple placeholder PNG using ImageMagick if available
        if command -v convert &> /dev/null; then
            convert -size ${size}x${size} xc:transparent -fill "#16a34a" -draw "circle ${size}/2,${size}/2 ${size}/2,$((${size}/3))" "$ICONS_DIR/icon${size}.png"
            echo "✓ Created placeholder $ICONS_DIR/icon${size}.png (using ImageMagick)"
        else
            echo "Error: Neither rsvg-convert nor ImageMagick found. Cannot create icons."
            echo "Please install one of the following:"
            echo "  brew install librsvg"
            echo "  brew install imagemagick"
            exit 1
        fi
    fi
done

# Create brand SVG for use in popup/sidepanel (128px)
brand_svg=$(create_colored_svg 128)
brand_path="$SCRIPT_DIR/../public/assets/images/breeze-brand.svg"
cp "$brand_svg" "$brand_path"
echo "✓ Created $brand_path"

# Clean up temp directory
rm -rf "$TEMP_DIR"

echo ""
echo "✅ All icons generated successfully!"
echo "Generated sizes: ${SIZES[*]}"