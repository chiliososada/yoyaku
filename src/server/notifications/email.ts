/**
 * メール送信（SMTP / nodemailer）。
 * SMTP_HOST 未設定なら無効（isEmailConfigured=false）。worker 側でログにフォールバックする。
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(env.SMTP_HOST);
}

/**
 * 送信の上限時間（ミリ秒）。
 * notification-service の PROCESSING 回収窓（5分）より必ず短くすること。
 * 長いと「まだ送信中なのに回収されて再送」＝顧客への二重送信になる。
 * nodemailer の既定は socketTimeout=10分で回収窓より長いため、明示的に縮める。
 */
const SMTP_CONNECTION_TIMEOUT_MS = 15_000;
const SMTP_GREETING_TIMEOUT_MS = 15_000;
const SMTP_SOCKET_TIMEOUT_MS = 60_000;

function getTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });
  }
  return transporter;
}

export async function sendEmail(params: { to: string; subject: string; text: string }): Promise<void> {
  if (!isEmailConfigured()) throw new Error('SMTP is not configured');
  await getTransport().sendMail({
    from: env.SMTP_FROM,
    to: params.to,
    subject: params.subject,
    text: params.text,
  });
}
