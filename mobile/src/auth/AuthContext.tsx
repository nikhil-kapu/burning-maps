import { useAuth as useClerkAuth } from "@clerk/expo";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { AuthSession, User } from "../types";

type AuthValue = {
  status: "loading" | "signedOut" | "signedIn" | "error";
  user: User | null;
  error: string | null;
  retry: () => void;
  signOut: () => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  refreshUser: () => Promise<User>;
  deleteLocalSession: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const { isLoaded, isSignedIn, sessionId, getToken, signOut: clerkSignOut } = useClerkAuth();
  const [status, setStatus] = useState<AuthValue["status"]>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const getTokenRef = useRef(getToken);
  const syncRunRef = useRef(0);

  // Clerk can return a new getToken function as its internal state changes. Keeping
  // the latest function in a ref prevents those identity changes from restarting
  // the backend exchange and remounting the signed-in navigator.
  getTokenRef.current = getToken;

  const applySession = useCallback((session: AuthSession) => {
    setUser(session.user);
    setError(null);
    setStatus("signedIn");
  }, []);

  useEffect(() => {
    const runId = ++syncRunRef.current;
    let active = true;
    const isCurrentRun = () => active && syncRunRef.current === runId;

    if (!isLoaded) {
      setStatus("loading");
      const loadingTimeout = setTimeout(() => {
        if (!isCurrentRun()) return;
        setError("Authentication is taking too long. Check your connection and try again.");
        setStatus("error");
      }, 15_000);
      return () => {
        active = false;
        clearTimeout(loadingTimeout);
      };
    }

    if (!isSignedIn || !sessionId) {
      void api.setSession(null).finally(() => {
        if (!isCurrentRun()) return;
        setUser(null);
        setError(null);
        setStatus("signedOut");
      });
      return () => { active = false; };
    }

    setStatus("loading");
    void (async () => {
      const restored = await api.restore().catch(() => null);
      if (restored?.clerkSessionId === sessionId) {
        try {
          const currentUser = await api.me();
          // api.me() may refresh an expired backend access token. Preserve that
          // newly issued session instead of writing the stale restored token
          // back to SecureStore after the request succeeds.
          const refreshedSession = { ...(api.getSession() ?? restored), user: currentUser };
          await api.setSession(refreshedSession);
          if (isCurrentRun()) applySession(refreshedSession);
          return;
        } catch {
          await api.setSession(null);
        }
      }
      const token = await getTokenRef.current();
      if (!token) throw new Error("Clerk did not provide a session token.");
      const session = await api.clerkExchange(token);
      await api.setSession(session);
      if (isCurrentRun()) applySession(session);
    })().catch((value: unknown) => {
      if (!isCurrentRun()) return;
      setUser(null);
      setError(value instanceof Error ? value.message : "We could not connect your account to Turtle Maps.");
      setStatus("error");
    });

    return () => { active = false; };
  }, [applySession, isLoaded, isSignedIn, sessionId, syncAttempt]);

  const signOut = useCallback(async () => {
    syncRunRef.current += 1;
    setStatus("loading");
    await api.signOut();
    await clerkSignOut();
    setUser(null);
    setError(null);
    setStatus("signedOut");
  }, [clerkSignOut]);

  const updateUser = useCallback(async (next: User) => {
    const current = api.getSession();
    if (current) await api.setSession({ ...current, user: next });
    setUser(next);
  }, []);

  const refreshUser = useCallback(async () => {
    const next = await api.me();
    await updateUser(next);
    return next;
  }, [updateUser]);

  const deleteLocalSession = useCallback(async () => {
    syncRunRef.current += 1;
    await api.setSession(null);
    await clerkSignOut();
    setUser(null);
    setError(null);
    setStatus("signedOut");
  }, [clerkSignOut]);

  const retry = useCallback(() => setSyncAttempt((value) => value + 1), []);
  const value = useMemo<AuthValue>(() => ({ status, user, error, retry, signOut, updateUser, refreshUser, deleteLocalSession }), [status, user, error, retry, signOut, updateUser, refreshUser, deleteLocalSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
