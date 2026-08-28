import type { ApiUser } from "~/types/api";

const TOKEN_KEY = "ifc-hub:token";
const USER_KEY = "ifc-hub:user";

function readStored<T>(key: string, parse: (raw: string) => T): T | null {
  if (!import.meta.client) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : parse(raw);
  } catch {
    return null;
  }
}

export function useAuth() {
  const token = useState<string | null>("auth-token", () =>
    readStored(TOKEN_KEY, (raw) => raw),
  );
  const user = useState<ApiUser | null>("auth-user", () =>
    readStored(USER_KEY, (raw) => JSON.parse(raw) as ApiUser),
  );

  function setSession(newToken: string | null, newUser: ApiUser | null): void {
    token.value = newToken;
    user.value = newUser;
    try {
      if (newToken) {
        localStorage.setItem(TOKEN_KEY, newToken);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
      if (newUser) {
        localStorage.setItem(USER_KEY, JSON.stringify(newUser));
      } else {
        localStorage.removeItem(USER_KEY);
      }
    } catch {
      // Private-mode storage failures are non-fatal; the session just
      // won't survive a reload.
    }
  }

  async function logout(): Promise<void> {
    setSession(null, null);
    await navigateTo("/login");
  }

  return { token, user, setSession, logout };
}
