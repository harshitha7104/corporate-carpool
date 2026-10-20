import { config } from "../config.js";
import { logger } from "../lib/logger.js";

// Each send resolves to { status, provider, error? } where status is one of
// "sent" (a provider accepted it), "logged_dev" (written to the server log in
// development; nobody received it), "not_configured" or "failed".

const post = async (url, headers, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
};

const sms = {
  log: {
    name: "log",
    async send(to, text) {
      logger.info("SMS (development log only, not delivered)", { to, text });
      return { status: "logged_dev", provider: "log" };
    },
  },
  // MSG91 transactional SMS. Needs an approved DLT template in production.
  msg91: {
    name: "msg91",
    async send(to, text) {
      try {
        await post(
          "https://control.msg91.com/api/v5/flow/",
          { authkey: config.sms.msg91AuthKey },
          { template_id: config.otp.msg91TemplateId, recipients: [{ mobiles: to.replace("+", ""), message: text }] }
        );
        return { status: "sent", provider: "msg91" };
      } catch (err) {
        return { status: "failed", provider: "msg91", error: err.message };
      }
    },
  },
};

const email = {
  log: {
    name: "log",
    async send(to, subject, text) {
      logger.info("Email (development log only, not delivered)", { to, subject, text });
      return { status: "logged_dev", provider: "log" };
    },
  },
  resend: {
    name: "resend",
    async send(to, subject, text) {
      try {
        await post(
          "https://api.resend.com/emails",
          { Authorization: `Bearer ${config.email.resendApiKey}` },
          { from: config.email.from, to: [to], subject, text }
        );
        return { status: "sent", provider: "resend" };
      } catch (err) {
        return { status: "failed", provider: "resend", error: err.message };
      }
    },
  },
};

const whatsapp = {
  async send() {
    return { status: "not_configured", provider: "none" };
  },
};

export const smsProvider = sms[config.sms.provider];
export const emailProvider = email[config.email.provider];
export const whatsappProvider = whatsapp;

// One-time passwords. The dev provider also hands the code back to the API
// response so a developer can sign in; config.js refuses it in production.
export const otpProvider = {
  name: config.otp.provider,
  revealsCode: config.otp.provider === "dev",
  async send(channel, destination, code) {
    const text = `${code} is your Green Way sign-in code. It expires in 10 minutes. Do not share it with anyone.`;
    if (config.otp.provider === "dev") {
      logger.info("Sign-in code (development only, not delivered)", { channel, destination, code });
      return { status: "logged_dev", provider: "dev" };
    }
    return channel === "sms"
      ? sms.msg91.send(destination, text)
      : emailProvider.send(destination, "Your Green Way sign-in code", text);
  },
};
