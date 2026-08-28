interface FetchOptions {
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  body?: unknown;
  query?: Record<string, string | undefined>;
}

/** Extract the server's `{ error }` message from a failed $fetch call. */
export function apiErrorMessage(error: unknown): string {
  const err = error as { data?: { error?: string }; message?: string };
  return err?.data?.error ?? err?.message ?? "Unbekannter Fehler";
}

export function useApi() {
  const { token, setSession } = useAuth();

  async function api<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (token.value) {
      headers.authorization = `Bearer ${token.value}`;
    }
    try {
      return await $fetch<T>(`/api${path}`, {
        method: options.method ?? "GET",
        body: options.body as never,
        query: options.query,
        headers,
      });
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 401 && token.value) {
        // Token expired or revoked — drop the session and re-authenticate.
        setSession(null, null);
        await navigateTo("/login");
      }
      throw error;
    }
  }

  return { api };
}
