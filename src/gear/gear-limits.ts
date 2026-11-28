/**
 * Catalog input limits shared by the API and the provider form.
 * Keeping them here makes the UI counters and the server validation agree.
 */
export const MAX_GEAR_IMAGES = 5;
export const MAX_GEAR_SPECS = 10;
export const MAX_IMAGE_URL_LENGTH = 500;
export const MAX_SPEC_KEY_LENGTH = 60;
export const MAX_SPEC_VALUE_LENGTH = 200;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
