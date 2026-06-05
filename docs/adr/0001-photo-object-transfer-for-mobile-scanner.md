# Photo Object Transfer for Mobile Scanner

## Status

Obsolete for the full mobile app scanner. ADR 0002 supersedes this architecture with mobile-app-only WebRTC delivery for OCR, barcode, dictation, and photos. Keep this ADR only as historical context for the retired App Clip/object-transfer direction.

Mobile Scanner Photo Capture uses scanner-signal as a short-lived transfer broker, not as the photo byte store. The full mobile app and App Clip receive per-photo upload grants from scanner-signal, upload bytes to Vercel Blob through a small object-store adapter, post photo manifests back to photo-specific session endpoints, and the creating Chrome profile downloads and acknowledges each photo. This keeps the existing `/result` relay for OCR, barcode, and dictation, avoids storing large base64 images in scanner-signal session storage, gives both mobile surfaces one reliability model, supports multi-photo recovery for 24 hours, and keeps browser downloads as the durable completion path.
