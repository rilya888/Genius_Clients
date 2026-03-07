"use client";

type JsonResult<T> = {
  response: Response;
  payload: T | null;
};

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function refreshSession(): Promise<boolean> {
  const response = await fetch("/api/auth/session", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin"
  });
  return response.ok;
}

export async function fetchJsonWithSessionRetry<T = unknown>(
  input: string,
  init?: RequestInit
): Promise<JsonResult<T>> {
  const requestInit: RequestInit = { ...init, credentials: "same-origin" };
  const firstResponse = await fetch(input, requestInit);
  if (!(firstResponse.status === 401 && input.startsWith("/api/admin"))) {
    return { response: firstResponse, payload: await parseJson<T>(firstResponse) };
  }

  const refreshed = await refreshSession();
  if (!refreshed) {
    window.location.href = "/auth";
    return { response: firstResponse, payload: await parseJson<T>(firstResponse) };
  }

  const retryResponse = await fetch(input, requestInit);
  if (retryResponse.status === 401) {
    window.location.href = "/auth";
  }
  return { response: retryResponse, payload: await parseJson<T>(retryResponse) };
}
