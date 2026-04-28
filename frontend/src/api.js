const configuredApiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, '');
const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const API_BASE_URL = configuredApiUrl || (isLocalHost ? 'http://localhost:5000' : '');

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}
