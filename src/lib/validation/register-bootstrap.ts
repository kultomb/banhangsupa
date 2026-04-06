import { z } from "zod";

export const registerBootstrapBodySchema = z
  .object({
    idToken: z.string().min(1),
    /** Gửi kèm để đối chiếu với email trong JWT; phải khớp nếu có. */
    email: z.string().email().optional(),
    shopSlugInput: z.string().optional(),
    isTrial: z.boolean().optional(),
  })
  .strip();

export type RegisterBootstrapBody = z.infer<typeof registerBootstrapBodySchema>;
