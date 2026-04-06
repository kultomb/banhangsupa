/** Webhook khác đang xử lý cùng txn_id — trả 503 để provider retry. */
export class PaymentWebhookProcessingError extends Error {
  readonly txnId: string;
  constructor(txnId: string) {
    super("payment_webhook_processing");
    this.name = "PaymentWebhookProcessingError";
    this.txnId = txnId;
  }
}
