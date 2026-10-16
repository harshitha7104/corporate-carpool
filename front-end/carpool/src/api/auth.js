import { useEffect, useState } from "react";

const TOKEN_KEY = "authToken";
const USER_KEY = "authUser";
const listeners = new Set();

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
};

const notify = () => listeners.forEach((listener) => listener(getUser()));

export const saveSession = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  notify();
};

export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
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
