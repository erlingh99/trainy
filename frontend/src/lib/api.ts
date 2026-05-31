export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PUT", json: body });
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const requestInit: RequestInit = {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : (rest as RequestInit).body,
  };

  const res = await fetch(path, requestInit);

  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data?.detail ?? msg;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}
