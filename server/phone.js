export function sanitizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}
