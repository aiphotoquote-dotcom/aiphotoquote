// src/lib/email/providers/base.ts
import type { EmailContextType, EmailMessage, EmailProviderKey, EmailSendResult } from "../types";

export type EmailProviderCapabilities = {
  /**
   * Whether provider supports multiple Reply-To values.
   * (Example: Resend effectively supports one reply_to string)
   */
  replyTo: "single" | "multi";

  /**
   * Whether provider supports message tags/labels (provider-specific analytics)
   */
  tags: boolean;

  /**
   * Whether provider supports arbitrary headers
   */
  headers: boolean;
};

export type EmailProviderSendArgs = {
  tenantId: string;
  message: EmailMessage;
  context: {
    type: EmailContextType;
    quoteLogId?: string;
  };
};

export type EmailProvider = {
  key: EmailProviderKey;

  /**
   * Optional provider self-description so routing/logging can be consistent
   * across providers without importing provider-specific code.
   */
  capabilities?: Partial<EmailProviderCapabilities>;

  send(args: EmailProviderSendArgs): Promise<EmailSendResult>;
};