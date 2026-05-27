const memoryObjects = new Map();

function localObjectUrl(key) {
  return `/api/signal/photo/object/${encodeURIComponent(key)}`;
}

export function createMemoryPhotoObjectStore() {
  return {
    async put(input) {
      const body = await input.body.arrayBuffer();
      const url = localObjectUrl(input.key);
      memoryObjects.set(input.key, { body, contentType: input.contentType, url });
      return { key: input.key, url };
    },
  };
}

export async function readMemoryPhotoObject(key) {
  return memoryObjects.get(key);
}

export async function createPhotoObjectStore() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return createMemoryPhotoObjectStore();

  return {
    async put(input) {
      const blobModule = await import("@vercel/blob");
      const result = await blobModule.put(input.key, input.body, {
        access: "public",
        contentType: input.contentType,
        addRandomSuffix: false,
      });
      return { key: input.key, url: result.url };
    },
  };
}
