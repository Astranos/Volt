export interface Bookmark {
  id: string;
  title: string;
  url: string;
  dateAdded?: number;
}

// @ts-ignore: chrome namespace not found
declare var chrome: any;

export interface BookmarkFolder {
  id: string;
  title: string;
  parentId?: string;
}

/**
 * Recursively traverse bookmark tree and collect all bookmarks
 */
function traverseBookmarks(
  nodes: any[]
): Bookmark[] {
  const bookmarks: Bookmark[] = [];

  for (const node of nodes) {
    // If it's a bookmark (has url), add it
    if (node.url) {
      bookmarks.push({
        id: node.id,
        title: node.title || "Untitled",
        url: node.url,
        dateAdded: node.dateAdded,
      });
    }

    // Recursively process children (folders)
    if (node.children) {
      bookmarks.push(...traverseBookmarks(node.children));
    }
  }

  return bookmarks;
}

/**
 * Get all bookmarks from Chrome
 */
export async function getAllBookmarks(): Promise<Bookmark[]> {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((bookmarkTreeNodes: any[]) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[Bookmarks] Error getting bookmarks:",
          chrome.runtime.lastError
        );
        resolve([]);
        return;
      }

      const bookmarks = traverseBookmarks(bookmarkTreeNodes);
      // Sort by date added (most recent first)
      bookmarks.sort((a: any, b: any) => (b.dateAdded || 0) - (a.dateAdded || 0));

      console.log("[Bookmarks] Found bookmarks:", bookmarks.length);
      resolve(bookmarks);
    });
  });
}

/**
 * Get all bookmark folders
 */
export async function getBookmarkFolders(): Promise<BookmarkFolder[]> {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((bookmarkTreeNodes: any[]) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[Bookmarks] Error getting folders:",
          chrome.runtime.lastError
        );
        resolve([]);
        return;
      }

      const folders: BookmarkFolder[] = [];

      function traverseFolders(nodes: any[]) {
        for (const node of nodes) {
          // If it's a folder (no url), add it
          if (!node.url && node.id !== "0") {
            folders.push({
              id: node.id,
              title: node.title || "Untitled",
              parentId: node.parentId,
            });
          }

          // Recursively process children
          if (node.children) {
            traverseFolders(node.children);
          }
        }
      }

      traverseFolders(bookmarkTreeNodes);
      console.log("[Bookmarks] Found folders:", folders.length);
      resolve(folders);
    });
  });
}

/**
 * Get bookmarks from a specific folder (optionally recursive)
 */
export async function getBookmarksFromFolder(
  folderId?: string,
  recursive: boolean = true
): Promise<Bookmark[]> {
  return new Promise((resolve) => {
    // If no folder specified, get all bookmarks
    if (!folderId) {
      getAllBookmarks().then(resolve);
      return;
    }

    chrome.bookmarks.getSubTree(folderId, (bookmarkTreeNodes: any[]) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[Bookmarks] Error getting folder bookmarks:",
          chrome.runtime.lastError
        );
        resolve([]);
        return;
      }

      const bookmarks = recursive
        ? traverseBookmarks(bookmarkTreeNodes)
        : bookmarkTreeNodes[0]?.children
            ?.filter((node: any) => node.url)
            .map((node: any) => ({
              id: node.id,
              title: node.title || "Untitled",
              url: node.url!,
              dateAdded: node.dateAdded,
            })) || [];

      // Sort by date added (most recent first)
      bookmarks.sort((a: any, b: any) => (b.dateAdded || 0) - (a.dateAdded || 0));

      console.log(
        `[Bookmarks] Found ${bookmarks.length} bookmarks in folder ${folderId}`
      );
      resolve(bookmarks);
    });
  });
}

/**
 * Get bookmarks from multiple folders
 */
export async function getBookmarksFromMultipleFolders(
  folderIds?: string[]
): Promise<Bookmark[]> {
  // If no folder IDs specified or empty array, get all bookmarks
  if (!folderIds || folderIds.length === 0) {
    return getAllBookmarks();
  }

  // Fetch bookmarks from all specified folders
  const bookmarkPromises = folderIds.map((folderId) =>
    getBookmarksFromFolder(folderId, true)
  );
  const bookmarkArrays = await Promise.all(bookmarkPromises);

  // Flatten and deduplicate by ID
  const bookmarkMap = new Map<string, Bookmark>();
  for (const bookmarks of bookmarkArrays) {
    for (const bookmark of bookmarks) {
      if (!bookmarkMap.has(bookmark.id)) {
        bookmarkMap.set(bookmark.id, bookmark);
      }
    }
  }

  // Convert back to array and sort by date
  const allBookmarks = Array.from(bookmarkMap.values());
  allBookmarks.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));

  console.log(
    `[Bookmarks] Found ${allBookmarks.length} bookmarks from ${folderIds.length} folders`
  );
  return allBookmarks;
}

/**
 * Filter bookmarks by search query
 */
export function filterBookmarks(
  bookmarks: Bookmark[],
  query: string
): Bookmark[] {
  if (!query.trim()) return bookmarks;

  const lowerQuery = query.toLowerCase();
  return bookmarks.filter((bookmark) => {
    const title = bookmark.title?.toLowerCase() || "";
    const url = bookmark.url?.toLowerCase() || "";

    return title.includes(lowerQuery) || url.includes(lowerQuery);
  });
}
