/**
 * Mantém apenas o último valor de cada cookie.
 *
 * O Laravel normalmente devolve um novo valor para o cookie de sessão depois
 * do login. Concatenar os cookies antigo e novo produz um Header Cookie
 * ambíguo e o PHP pode autenticar com o valor antigo.
 */
export function normalizeCookieHeader(cookieHeader: string): string {
  const cookies = new Map<string, string>();

  for (const part of cookieHeader.split(';')) {
    const cookie = part.trim();
    const separator = cookie.indexOf('=');
    if (separator <= 0) continue;

    const name = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();
    cookies.set(name, `${name}=${value}`);
  }

  return [...cookies.values()].join('; ');
}

export function isSessionCookie(value: string): boolean {
  return /(?:^|;\s*)(?:XSRF-TOKEN|laravel_session|[^=;]*_session)=/i.test(value);
}

export function getXsrfToken(cookieHeader: string): string | undefined {
  const match = normalizeCookieHeader(cookieHeader).match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/i);
  if (!match) return undefined;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function mergeSetCookies(currentCookieHeader: string, setCookies: string[]): string {
  const incoming = setCookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
  return normalizeCookieHeader([currentCookieHeader, incoming].filter(Boolean).join('; '));
}
