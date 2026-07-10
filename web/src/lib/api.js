import axios from 'axios';

// Same-origin in production (the Node server serves the built SPA); the Vite
// dev proxy forwards /api to the Node server in development.
const api = axios.create({ baseURL: '/api', withCredentials: true });

let accessToken = localStorage.getItem('docsign_access') || null;
export const setAccessToken = (token) => {
  accessToken = token;
  if (token) localStorage.setItem('docsign_access', token);
  else localStorage.removeItem('docsign_access');
};
export const getAccessToken = () => accessToken;

api.interceptors.request.use((config) => {
  if (accessToken && !config.skipAuth) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// On a 401, try one refresh (cookie-based) and replay the original request.
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    if (status === 401 && !original._retried && !original.skipAuth && !original.url.includes('/auth/')) {
      original._retried = true;
      try {
        refreshing = refreshing || api.post('/auth/refresh', {}, { skipAuth: true });
        const { data } = await refreshing;
        refreshing = null;
        setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (e) {
        refreshing = null;
        setAccessToken(null);
        if (!location.pathname.startsWith('/login')) location.href = '/login';
        return Promise.reject(e);
      }
    }
    return Promise.reject(error);
  }
);

export const apiError = (err) =>
  err?.response?.data?.error || err?.message || 'Something went wrong';

export default api;
