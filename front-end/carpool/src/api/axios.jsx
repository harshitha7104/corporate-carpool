import axios from "axios";
import { clearSession, getToken } from "./auth";
import hostedClient from "./hosted";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && getToken()) {
      clearSession();
    }
    return Promise.reject(error);
  }
);

// The claude.ai-hosted build (`npm run build:hosted`) has no Express server.
export default import.meta.env.MODE === "hosted" ? hostedClient : apiClient;
