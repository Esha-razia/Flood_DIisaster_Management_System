export const MAX_REPORT_IMAGE_BYTES = 50 * 1024 * 1024;
export const REPORT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const capitalizeDescription = value => value.replace(/^(\s*)(\p{L})/u, (_, space, first) => space + first.toLocaleUpperCase());
export function getReportImageSource(imageUrl) {
  if (typeof imageUrl !== 'string') return null;
  const source = imageUrl.trim();
  if (/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(source)) return source;
  if (/^https?:\/\/\S+$/i.test(source) || /^\/(?!\/)\S*$/.test(source)) return source;
  return null;
}

export function validateReportFields({location = '', description = '', contact = '', severity = '', imageUrl = '', imagePreview = ''}) {
  const errors = {};
  if (location.trim().length < 3) errors.location = 'Enter an incident location or use your current location.';
  const text = description.trim();
  if (text.length < 10) errors.description = 'Description must contain at least 10 characters.';
  else if (!/^\p{L}/u.test(text) || /^[a-z]/.test(text)) errors.description = 'Start the description with a capital letter.';
  if (!/^03\d{9}$/.test(contact.trim())) errors.contact = 'Enter an 11-digit mobile number, e.g. 03001234567.';
  if (!['Low','Medium','High'].includes(severity)) errors.severity = 'Select a severity.';
  if (!(imageUrl || imagePreview)) errors.image = 'Upload a JPG, PNG, WebP or GIF image (maximum 50 MB).';
  return errors;
}
export function reportImageError(file) {
  if (!REPORT_IMAGE_TYPES.includes(file.type)) return 'Use JPG, PNG, WebP or GIF images only.';
  if (file.size > MAX_REPORT_IMAGE_BYTES) return 'Image must be 50 MB or smaller.';
  return '';
}
