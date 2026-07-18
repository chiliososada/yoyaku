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

function getTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
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
