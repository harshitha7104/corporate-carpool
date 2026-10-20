import { useEffect, useState } from "react";

const TOKEN_KEY = "authToken";
const USER_KEY = "authUser";
const listeners = new Set();

// Storage can be unavailable (private windows, blocked site data).
const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const store = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Session lasts only for this page load.
  }
};

export const getToken = () => read(TOKEN_KEY);

export const getUser = () => {
  try {
    return JSON.parse(read(USER_KEY));
  } catch {
    return null;
  }
};

const notify = () => listeners.forEach((listener) => listener(getUser()));

export const saveSession = (token, user) => {
  store(TOKEN_KEY, token);
  store(USER_KEY, JSON.stringify(user));
  notify();
};

export const clearSession = () => {
  store(TOKEN_KEY, null);
  store(USER_KEY, null);
  notify();
};

export const onSessionChange = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useSession = () => {
  const [user, setUser] = useState(getUser);
  useEffect(() => onSessionChange(setUser), []);
  return user;
};
