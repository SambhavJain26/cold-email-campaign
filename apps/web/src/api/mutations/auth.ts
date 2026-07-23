import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  meResponseSchema,
  okResponseSchema,
  type ChangePasswordBody,
  type LoginBody,
} from '@coldemail/shared';
import { apiFetch } from '../client';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginBody) =>
      apiFetch('/auth/login', meResponseSchema, {
        method: 'POST',
        body,
        skipUnauthorizedHandler: true, // a wrong password is not a session expiry
      }),
    onSuccess: (me) => {
      qc.setQueryData(['me'], me);
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
