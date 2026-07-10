import { create } from 'zustand';
import api, { setAccessToken } from './api';

export const useAuth = create((set) => ({
  user: null,
  ready: false,

  async bootstrap() {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user, ready: true });
    } catch {
      // Try a refresh once before giving up (cookie may still be valid).
      try {
        const { data } = await api.post('/auth/refresh', {});
        setAccessToken(data.accessToken);
        set({ user: data.user, ready: true });
      } catch {
        set({ user: null, ready: true });
      }
    }
  },

  async login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    set({ user: data.user });
    return data.user;
  },

  async register(payload) {
    const { data } = await api.post('/auth/register', payload);
    if (data.accessToken) {
      setAccessToken(data.accessToken);
      set({ user: data.user });
    }
    return data;
  },

  async logout() {
    try {
      await api.post('/auth/logout', {});
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    set({ user: null });
  }
}));
