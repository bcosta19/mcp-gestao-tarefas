import { describe, expect, it } from 'vitest';
import { getXsrfToken, mergeSetCookies, normalizeCookieHeader } from '../src/services/auth.js';

describe('autenticação por sessão web', () => {
  it('mantém somente o último valor de cada cookie', () => {
    const cookies = normalizeCookieHeader(
      'XSRF-TOKEN=old; gestao_de_tarefas_session=old-session; XSRF-TOKEN=new; gestao_de_tarefas_session=new-session'
    );

    expect(cookies).toBe('XSRF-TOKEN=new; gestao_de_tarefas_session=new-session');
    expect(getXsrfToken(cookies)).toBe('new');
  });

  it('mescla cookies Set-Cookie sem ressuscitar uma sessão antiga', () => {
    const cookies = mergeSetCookies('XSRF-TOKEN=old; gestao_de_tarefas_session=old-session', [
      'gestao_de_tarefas_session=new-session; Path=/; HttpOnly',
      'laravel_session=another-session; Path=/; HttpOnly',
    ]);

    expect(cookies).toBe(
      'XSRF-TOKEN=old; gestao_de_tarefas_session=new-session; laravel_session=another-session'
    );
  });
});
