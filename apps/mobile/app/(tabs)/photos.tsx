import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useScanner, type PendingPhotoSummary } from "../../lib/scanner-state";
import { usePairingScanner } from "../../lib/use-pairing-scanner";
import { DisconnectedPairingView, Header, ScreenRoot, styles } from "./index";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(photo: PendingPhotoSummary) {
  if (photo.status === "queued") return "Queued";
  if (photo.status === "sending") return `${Math.round(photo.progress * 100)}%`;
  if (photo.status === "sent") return "Waiting";
  if (photo.status === "failed") return "Retry";
  return photo.status;
}

export default function UploadTab() {
  const scanner = useScanner();
  const {
    cancelPendingPhoto,
    connected,
    pendingPhotos,
    photoError,
    photoProgressLabel,
    photoSending,
    retryPendingPhotos,
    sendPhotoLibraryAssets,
    setActiveMode,
  } = scanner;
  const {
    openPairScanner,
    onPairingQrScanned,
    pairScannerError,
    pairScannerLocked,
    pairScannerOpen,
    resetPairingScanner,
  } = usePairingScanner();
  const [uploadingFromPicker, setUploadingFromPicker] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setActiveMode("photo");
      return () => resetPairingScanner();
    }, [resetPairingScanner, setActiveMode])
  );

  const pendingBatches = useMemo(() => {
    const groups = new Map<string, PendingPhotoSummary[]>();
    for (const photo of pendingPhotos) {
      const group = groups.get(photo.batchId) ?? [];
      group.push(photo);
      groups.set(photo.batchId, group);
    }
    return Array.from(groups.entries()).map(([batchId, photos]) => ({
      batchId,
      photos,
      newestAt: Math.max(...photos.map((photo) => new Date(photo.capturedAt).getTime())),
    })).sort((first, second) => second.newestAt - first.newestAt);
  }, [pendingPhotos]);

  const uploadFromCameraRoll = useCallback(async () => {
    if (!connected || uploadingFromPicker) return;
    setUploadingFromPicker(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Photo access needed", "Allow photo access to upload camera roll images to Chrome.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        allowsMultipleSelection: true,
        mediaTypes: ["images"],
        orderedSelection: true,
        quality: 0.92,
        selectionLimit: 30,
      });
      if (result.canceled) return;
      const count = await sendPhotoLibraryAssets(result.assets);
      if (count === 0) return;
    } catch (err) {
      Alert.alert("Upload unavailable", err instanceof Error ? err.message : "Could not open the photo library.");
    } finally {
      setUploadingFromPicker(false);
    }
  }, [connected, sendPhotoLibraryAssets, uploadingFromPicker]);

  if (!connected) {
    return (
      <ScreenRoot>
        <Header />
        <View style={styles.page}>
          <DisconnectedPairingView
            error={pairScannerError}
            pairingActive={pairScannerOpen || !!scanner.permission?.granted}
            pairingLocked={pairScannerLocked}
            onOpenScanner={openPairScanner}
            onPairingQrScanned={onPairingQrScanned}
          />
        </View>
      </ScreenRoot>
    );
  }

  const uploadDisabled = uploadingFromPicker || photoSending;
  const pendingCount = pendingPhotos.length;

  return (
    <ScreenRoot>
      <Header />
      <View style={styles.page}>
        <ScrollView style={localStyles.scroll} contentContainerStyle={localStyles.scrollContent}>
          <View style={localStyles.heroPanel}>
            <View style={localStyles.heroIcon}>
              <Ionicons name="cloud-upload-outline" size={30} color="#166534" />
            </View>
            <View style={localStyles.heroCopy}>
              <Text style={localStyles.heroTitle}>Upload to Chrome</Text>
              <Text style={localStyles.heroText}>
                Select one or more camera roll photos. They will queue together as a batch in the Chrome sidebar.
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Upload photos from camera roll"
              accessibilityRole="button"
              disabled={uploadDisabled}
              onPress={uploadFromCameraRoll}
              style={({ pressed }) => [
                localStyles.uploadButton,
                uploadDisabled && localStyles.disabled,
                pressed && !uploadDisabled && localStyles.uploadButtonPressed,
              ]}
            >
              <Ionicons name={uploadingFromPicker ? "hourglass-outline" : "images-outline"} size={21} color="#f0fdf4" />
              <Text style={localStyles.uploadButtonText}>
                {uploadingFromPicker ? "Opening Photos" : "Choose Photos"}
              </Text>
            </Pressable>
          </View>

          {photoError ? (
            <View style={localStyles.errorPanel}>
              <Ionicons name="warning-outline" size={18} color="#991b1b" />
              <Text selectable style={localStyles.errorText}>{photoError}</Text>
            </View>
          ) : null}

          <View style={localStyles.summaryRow}>
            <View style={localStyles.summaryPill}>
              <Ionicons name={photoSending ? "sync" : "albums-outline"} size={16} color="#166534" />
              <Text style={localStyles.summaryText}>
                {photoProgressLabel ?? (pendingCount ? `${pendingCount} pending` : "No pending uploads")}
              </Text>
            </View>
            {pendingPhotos.some((photo) => photo.status === "failed" || photo.status === "sent") ? (
              <Pressable style={localStyles.retryButton} onPress={retryPendingPhotos}>
                <Ionicons name="refresh" size={16} color="#166534" />
                <Text style={localStyles.retryText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>

          {pendingBatches.length ? (
            <View style={localStyles.batchList}>
              {pendingBatches.map((batch, batchIndex) => (
                <View key={batch.batchId} style={localStyles.batchCard}>
                  <View style={localStyles.batchHeader}>
                    <View>
                      <Text style={localStyles.batchTitle}>
                        Batch {batchIndex + 1}
                      </Text>
                      <Text style={localStyles.batchMeta}>
                        {batch.photos.length} photo{batch.photos.length === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <Text style={localStyles.batchId} numberOfLines={1}>
                      {batch.batchId}
                    </Text>
                  </View>
                  <View style={localStyles.photoRows}>
                    {batch.photos.map((photo) => (
                      <View key={photo.id} style={localStyles.photoRow}>
                        <View style={localStyles.photoIcon}>
                          <Ionicons name="image-outline" size={18} color="#166534" />
                        </View>
                        <View style={localStyles.photoCopy}>
                          <Text style={localStyles.photoName} numberOfLines={1}>{photo.name}</Text>
                          <Text style={localStyles.photoMeta}>
                            {formatSize(photo.size)} · {statusLabel(photo)}
                          </Text>
                          {photo.error ? <Text selectable style={localStyles.photoError}>{photo.error}</Text> : null}
                        </View>
                        <Pressable
                          accessibilityLabel={`Cancel ${photo.name}`}
                          hitSlop={8}
                          onPress={() => cancelPendingPhoto(photo.id)}
                          style={localStyles.cancelButton}
                        >
                          <Ionicons name="close" size={16} color="#78716c" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={localStyles.emptyPanel}>
              <Ionicons name="images-outline" size={28} color="#a8a29e" />
              <Text style={localStyles.emptyTitle}>Ready for a batch</Text>
              <Text style={localStyles.emptyText}>
                Uploaded photos will appear in the connected Chrome sidebar as one grouped batch.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </ScreenRoot>
  );
}

const localStyles = {
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 122,
    gap: 14,
  },
  heroPanel: {
    gap: 14,
    padding: 18,
    borderRadius: 24,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#f0fdf4",
  },
  heroCopy: {
    gap: 4,
  },
  heroTitle: {
    color: "#1c1917",
    fontSize: 22,
    fontWeight: "900" as const,
  },
  heroText: {
    color: "#57534e",
    fontSize: 14,
    lineHeight: 20,
  },
  uploadButton: {
    minHeight: 52,
    borderRadius: 18,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 9,
    backgroundColor: "#16a34a",
  },
  uploadButtonPressed: {
    transform: [{ scale: 0.99 }],
    backgroundColor: "#15803d",
  },
  uploadButtonText: {
    color: "#f0fdf4",
    fontSize: 16,
    fontWeight: "900" as const,
  },
  disabled: {
    opacity: 0.55,
  },
  errorPanel: {
    minHeight: 44,
    borderRadius: 18,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 9,
    padding: 12,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: {
    flex: 1,
    color: "#991b1b",
    fontSize: 13,
    fontWeight: "700" as const,
  },
  summaryRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 10,
  },
  summaryPill: {
    flex: 1,
    minHeight: 38,
    borderRadius: 19,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 7,
    paddingHorizontal: 13,
    backgroundColor: "#f0fdf4",
  },
  summaryText: {
    flexShrink: 1,
    color: "#166534",
    fontSize: 13,
    fontWeight: "800" as const,
  },
  retryButton: {
    minHeight: 38,
    borderRadius: 19,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#d6d3d1",
  },
  retryText: {
    color: "#166534",
    fontSize: 13,
    fontWeight: "800" as const,
  },
  batchList: {
    gap: 12,
  },
  batchCard: {
    borderRadius: 22,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
    overflow: "hidden" as const,
  },
  batchHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e7e5e4",
  },
  batchTitle: {
    color: "#1c1917",
    fontSize: 15,
    fontWeight: "900" as const,
  },
  batchMeta: {
    color: "#78716c",
    fontSize: 12,
    fontWeight: "700" as const,
    marginTop: 2,
  },
  batchId: {
    flexShrink: 1,
    maxWidth: "48%" as const,
    color: "#a8a29e",
    fontSize: 11,
    fontWeight: "700" as const,
  },
  photoRows: {
    gap: 1,
  },
  photoRow: {
    minHeight: 64,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  photoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#f0fdf4",
  },
  photoCopy: {
    flex: 1,
    minWidth: 0,
  },
  photoName: {
    color: "#1c1917",
    fontSize: 13,
    fontWeight: "800" as const,
  },
  photoMeta: {
    color: "#78716c",
    fontSize: 12,
    fontWeight: "700" as const,
    marginTop: 2,
  },
  photoError: {
    color: "#991b1b",
    fontSize: 11,
    marginTop: 3,
  },
  cancelButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#f5f5f4",
  },
  emptyPanel: {
    minHeight: 180,
    borderRadius: 24,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    padding: 24,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  emptyTitle: {
    color: "#1c1917",
    fontSize: 16,
    fontWeight: "900" as const,
  },
  emptyText: {
    maxWidth: 260,
    textAlign: "center" as const,
    color: "#78716c",
    fontSize: 13,
    lineHeight: 18,
  },
};
