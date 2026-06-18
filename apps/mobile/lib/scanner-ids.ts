const PHOTO_CONTRIBUTOR_KEY = "volt-photo-contributor";

export function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createPhotoContributorId() {
  return `${PHOTO_CONTRIBUTOR_KEY}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
