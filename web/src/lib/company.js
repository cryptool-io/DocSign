import { create } from 'zustand';
import api from './api.js';

/**
 * Active-company state. The selected company scopes what the sender sees and
 * becomes the default companyId on create/list calls. `null` = "All companies"
 * (personal/unscoped view across everything the account owns).
 */
export const useCompany = create((set, get) => ({
  companies: [],
  activeId: localStorage.getItem('docsign_company') || null,
  loaded: false,

  active() {
    return get().companies.find((c) => c.id === get().activeId) || null;
  },

  async load() {
    const { data } = await api.get('/companies');
    // Drop a stale active id if the company no longer exists.
    const activeId = data.data.some((c) => c.id === get().activeId) ? get().activeId : null;
    set({ companies: data.data, activeId, loaded: true });
    return data.data;
  },

  setActive(id) {
    if (id) localStorage.setItem('docsign_company', id);
    else localStorage.removeItem('docsign_company');
    set({ activeId: id });
  }
}));

// Query-string fragment for the active company, used by scoped list calls.
export const companyParam = () => {
  const id = useCompany.getState().activeId;
  return id ? `companyId=${id}` : '';
};

// Merge the active companyId into a create body when one is selected.
export const withCompany = (body = {}) => {
  const id = useCompany.getState().activeId;
  return id ? { ...body, companyId: id } : body;
};
