/**
 * API client for Cairn backend.
 * Handles auth tokens and all CRUD operations.
 */

const TOKEN_KEY = "cairn_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }

  return res.json();
}

export const api = {
  // Auth
  login: async (username, password) => {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    return data;
  },
  logout: async () => {
    try { await apiFetch("/auth/logout", { method: "POST" }); } catch {}
    clearToken();
  },
  checkAuth: async () => {
    try {
      await apiFetch("/auth/check");
      return true;
    } catch {
      return false;
    }
  },
  isLoggedIn: () => !!getToken(),

  // Dashboard (all-in-one)
  getDashboard: () => apiFetch("/dashboard"),

  // Profile
  getProfile: () => apiFetch("/profile"),
  updateProfile: (data) => apiFetch("/profile", { method: "PUT", body: JSON.stringify(data) }),

  // Accounts
  getAccounts: () => apiFetch("/accounts"),
  createAccount: (data) => apiFetch("/accounts", { method: "POST", body: JSON.stringify(data) }),
  updateAccount: (id, data) => apiFetch(`/accounts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAccount: (id) => apiFetch(`/accounts/${id}`, { method: "DELETE" }),

  // Snapshots
  getSnapshots: (limit) => apiFetch(`/snapshots${limit ? `?limit=${limit}` : ""}`),
  takeSnapshot: (date) => apiFetch("/snapshots", { method: "POST", body: JSON.stringify({ date }) }),

  // Settings
  getSettings: () => apiFetch("/settings"),
  updateSettings: (data) => apiFetch("/settings", { method: "PUT", body: JSON.stringify(data) }),

  // Export/Import
  exportData: () => apiFetch("/export"),
  importData: (data) => apiFetch("/import", { method: "POST", body: JSON.stringify(data) }),

  // AI Commentary
  getCommentary: () => apiFetch("/ai/commentary", { method: "POST" }),

  // Tools
  salarySacrifice: (data) => apiFetch("/tools/salary-sacrifice", { method: "POST", body: JSON.stringify(data) }),
  debtPayoff: (data) => apiFetch("/tools/debt-payoff", { method: "POST", body: JSON.stringify(data) }),
};
