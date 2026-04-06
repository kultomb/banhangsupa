import { z } from "zod";

/** Body SePay / ngân hàng — chỉ các field đang dùng; field thừa bị strip. */
export const paymentWebhookBodySchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    referenceCode: z.union([z.string(), z.number()]).optional(),
    /** Mã CK / mã tham chiếu — dùng để khớp payment_ref, không dùng làm txn id. */
    code: z.union([z.string(), z.number()]).optional(),
    txnId: z.union([z.string(), z.number()]).optional(),
    transactionId: z.union([z.string(), z.number()]).optional(),
    transaction_id: z.union([z.string(), z.number()]).optional(),
    transferType: z.string().optional(),
    transferAmount: z.union([z.string(), z.number()]).optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    content: z.string().optional(),
    description: z.string().optional(),
    transferContent: z.string().optional(),
  })
  .strip();

export type PaymentWebhookBody = z.infer<typeof paymentWebhookBodySchema>;
