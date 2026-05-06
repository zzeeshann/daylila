import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rate-limit';

export const prerender = false;

const TOKEN_EXPIRY_MINUTES = 30;

/**
 * Send a magic link to the user's email.
 * Rate limited: 3 requests per email per hour.
 *
 * If the email exists → sends a login link.
 * If the email doesn't exist → still says "link sent" (prevents email enumeration).
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;

  const body = await request.json();
  const { email } = body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Valid email required' }), { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Rate limit: 3 magic link requests per email per hour
  const limit = await checkRateLimit(locals.runtime.env.RATE_LIMIT_KV, `magic:${normalizedEmail}`, 3, 3600);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests. Check your email or try again later.' }), {
      status: 429,
    });
  }

  // Generate a secure random token
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

  const now = Date.now();
  const expiresAt = now + TOKEN_EXPIRY_MINUTES * 60 * 1000;

  // Check if user exists with this email
  const existingUser = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(normalizedEmail)
    .first<{ id: string }>();

  // Store token (even if user doesn't exist — we'll create on verify if needed)
  await db
    .prepare('INSERT INTO magic_tokens (token, email, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(token, normalizedEmail, existingUser?.id ?? null, expiresAt, now)
    .run();

  // Send email via Resend
  const env = locals.runtime.env as Record<string, string>;
  const RESEND_API_KEY = env.RESEND_API_KEY;
  const EMAIL_FROM = env.EMAIL_FROM ?? 'Daylila <onboarding@resend.dev>';
  const siteUrl = new URL(request.url).origin;
  const magicUrl = `${siteUrl}/auth/verify?token=${token}`;

  if (RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [normalizedEmail],
          subject: 'Your Daylila login link',
          html: `
            <p>Here's your login link for Daylila:</p>
            <p><a href="${magicUrl}" style="display:inline-block;padding:12px 24px;background:#1A6B62;color:white;text-decoration:none;border-radius:8px;font-family:sans-serif;">Log in to Daylila</a></p>
            <p style="color:#6B6B6B;font-size:14px;">This link expires in ${TOKEN_EXPIRY_MINUTES} minutes. If you didn't request this, ignore this email.</p>
          `,
        }),
      });
    } catch {
      // Email send failure — token is still in DB, user can retry
    }
  }

  // Always return success (prevents email enumeration)
  return new Response(JSON.stringify({ status: 'link_sent' }), { status: 200 });
};
