import { useMutation, useQueryClient } from '@tanstack/react-query';
import { okResponseSchema, type ChangePasswordBody, type LoginBody } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    // The contract returns {ok:true} - the session cookie carries identity;
    // /auth/me is the source of truth for who is signed in.
    mutationFn: (body: LoginBody) =>
      apiFetch('/auth/login', okResponseSchema, {
        method: 'POST',
        body,
        skipUnauthorizedHandler: true, // a wrong password is not a session expiry
      }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['me'] }); // drop the 401 state → guard refetches
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/auth/logout', okResponseSchema, { method: 'POST' }),
    onSuccess: () => {
      qc.clear(); // drop ALL cached server state on logout
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordBody) =>
      apiFetch('/auth/change-password', okResponseSchema, { method: 'POST', body }),
  });
}
