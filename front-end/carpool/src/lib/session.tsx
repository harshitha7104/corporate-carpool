import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type { Me, Meta } from "./types";

export const fetchSession = async (): Promise<Me | null> => {
  try {
    return (await api.get<{ user: Me | null }>("/auth/session")).user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
};

export const useMe = () => useQuery<Me | null>({ queryKey: ["me"], queryFn: fetchSession, staleTime: 60_000 });

export const useMeta = () => useQuery<Meta>({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/meta"), staleTime: 5 * 60_000 });

export const useSignOut = () => {
  const qc = useQueryClient();
  return async () => {
    await api.post("/auth/logout").catch(() => {});
    qc.clear();
    qc.setQueryData(["me"], null);
  };
};

export const can = (me: Me | null | undefined, permission: string) => Boolean(me?.permissions.includes(permission));
export const hasRole = (me: Me | null | undefined, role: string) => Boolean(me?.roles.includes(role));
export const isVerifiedDriver = (me: Me | null | undefined) =>
  me?.verification.government_id.status === "verified" && me?.verification.driving_license.status === "verified";
