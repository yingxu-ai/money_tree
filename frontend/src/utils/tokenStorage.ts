const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";
const REMEMBER_KEY = "login_remember";
const USERNAME_KEY = "login_remember_username";

export function isRememberLogin(): boolean {
  return localStorage.getItem(REMEMBER_KEY) !== "0";
}

export function setRememberLogin(remember: boolean) {
  localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
}

export function getRememberedUsername(): string {
  if (!isRememberLogin()) return "";
  return localStorage.getItem(USERNAME_KEY) || "";
}

export function setRememberedUsername(username: string | null) {
  if (username) {
    localStorage.setItem(USERNAME_KEY, username);
  } else {
    localStorage.removeItem(USERNAME_KEY);
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY) || sessionStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY) || sessionStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string, remember: boolean) {
  clearTokens();
  const store = remember ? localStorage : sessionStorage;
  store.setItem(ACCESS_KEY, accessToken);
  store.setItem(REFRESH_KEY, refreshToken);
  setRememberLogin(remember);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}
