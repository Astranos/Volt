import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { SaveExtensionSettings } from "@/src/hooks/useExtensionSettings";
import { getBookmarkFolders, type BookmarkFolder } from "@/src/utils/bookmarks";
import type { CmdkSettings } from "@/src/types/settings";

interface BookmarkFoldersSettingsProps {
  settings: CmdkSettings;
  saveSettings: SaveExtensionSettings;
}

export function BookmarkFoldersSettings({
  settings,
  saveSettings,
}: BookmarkFoldersSettingsProps) {
  const [bookmarkFolders, setBookmarkFolders] = useState<BookmarkFolder[]>([]);

  useEffect(() => {
    getBookmarkFolders().then(setBookmarkFolders);
  }, []);

  const handleBookmarkFolderToggle = (folderId: string) => {
    const currentFolders = settings.bookmarkFolderIds || [];
    const newFolders = currentFolders.includes(folderId)
      ? currentFolders.filter((id) => id !== folderId)
      : [...currentFolders, folderId];

    void saveSettings({
      ...settings,
      bookmarkFolderIds: newFolders,
    });
  };

  const handleSelectAllFolders = () => {
    void saveSettings({
      ...settings,
      bookmarkFolderIds: [],
    });
  };

  return (
    <section id="bookmarks" className="scroll-mt-20">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">Bookmarks</h2>
        <p className="text-muted-foreground">
          Choose which bookmark folders to display in the command menu
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
        <div className="p-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <label className="text-sm font-medium">Bookmark Folders</label>
              <button
                onClick={handleSelectAllFolders}
                className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                {settings.bookmarkFolderIds?.length === 0
                  ? "Selected: All"
                  : "Select All"}
              </button>
            </div>

            {settings.bookmarkFolderIds?.length === 0 && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-700">
                  All bookmarks from all folders are currently shown
                </p>
              </div>
            )}

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {bookmarkFolders.map((folder) => {
                const isSelected =
                  settings.bookmarkFolderIds?.includes(folder.id) ?? false;

                return (
                  <div
                    key={folder.id}
                    onClick={() => handleBookmarkFolderToggle(folder.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? "bg-primary/10 border-primary hover:bg-primary/15"
                        : "bg-muted/30 border-border hover:bg-muted/50"
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center w-5 h-5 rounded border-2 transition-colors ${
                        isSelected
                          ? "bg-primary border-primary"
                          : "bg-background border-muted-foreground/30"
                      }`}
                    >
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-primary-foreground" />
                      )}
                    </div>
                    <span className="text-sm font-medium flex-1">
                      {folder.title}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Select specific folders to show only bookmarks from those folders,
              or click "Select All" to show bookmarks from all folders
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
