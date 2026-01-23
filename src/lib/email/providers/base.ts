// src/lib/email/providers/base.ts
import type { EmailContextType, EmailMessage, EmailProviderKey, EmailSendResult } from "../types";

export type EmailProvider = {
  key: EmailProviderKey;
  send(args: {
    tenantId: string;
    message: EmailMessage;
    context: {
      type: EmailContextType;
      quoteLogId?: string;
    };
  }): Promise<EmailSendResult>;
};