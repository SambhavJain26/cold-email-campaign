// Auth endpoints (docs/10 §Auth, decision I).
import { z } from 'zod';

export const loginBodySchema = z
  .object({
    email: z.email(),
    password: z.string().min(1),
  })
  .strict();
export type LoginBody = z.infer<typeof loginBodySchema>;

export const meResponseSchema = z.object({ email: z.string() }).strict();
export type MeResponse = z.infer<typeof meResponseSchema>;

export const changePasswordBodySchema = z
  .object({
    current: z.string().min(1),
    next: z.string().min(8),
  })
  .strict();
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
