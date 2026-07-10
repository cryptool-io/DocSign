import { create } from 'zustand';
import api, { setAccessToken } from './api';
import * as keystore from './keystore.js';

export const useAuth = create((set, get) => ({
  user: null,
  ready: false,
  // A one-time recovery key to surface to the user right after setup.
  pendingRecoveryKey: null,
  clearRecoveryKey: () => set({ pendingRecoveryKey: null }),

  async bootstrap() {
    try {
      const { data } = await api.get('/auth/me');
      // Restore the account key from sessionStorage if present (survives refresh).
      await keystore.ensureUnlocked();
      set({ user: data.user, ready: true });
    } catch {
      try {
        const { data } = await api.post('/auth/refresh', {});
        setAccessToken(data.accessToken);
        await keystore.ensureUnlocked();
        set({ user: data.user, ready: true });
      } catch {
        set({ user: null, ready: true });
      }
    }
  },

  async login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    // Unlock the account key with the password (never leaves the browser).
    if (data.user.encryption?.enabled) {
      try {
        await keystore.unlock(password, data.user.encryption);
      } catch {
        /* wrong-key edge; user can recover from Settings */
      }
    }
    set({ user: data.user });
    return data.user;
  },

  async register(payload) {
    const { data } = await api.post('/auth/register', payload);
    if (data.accessToken) {
      setAccessToken(data.accessToken);
      set({ user: data.user });
      // Turn on zero-knowledge encryption immediately; show the recovery key once.
      try {
        const recoveryKey = await keystore.setupEncryption(payload.password);
        const { data: me } = await api.get('/auth/me');
        set({ user: me.user, pendingRecoveryKey: recoveryKey });
      } catch {
        /* encryption optional; proceed without */
      }
    }
    return data;
  },

  // Enable encryption for an existing (older) account.
  async enableEncryption(password) {
    const recoveryKey = await keystore.setupEncryption(password);
    const { data: me } = await api.get('/auth/me');
    set({ user: me.user, pendingRecoveryKey: recoveryKey });
    return recoveryKey;
  },

  async logout() {
    try {
      await api.post('/auth/logout', {});
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    keystore.forget();
    set({ user: null });
  }
}));
