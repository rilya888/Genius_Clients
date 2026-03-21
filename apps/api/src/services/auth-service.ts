import { assertEmail, assertPassword, assertValidSlug, normalizeSlug } from "@genius/shared";
import { randomBytes, randomUUID } from "node:crypto";
import { tenantConsents, tenants, users } from "@genius/db";
import { sql } from "drizzle-orm";
import { AuthTokenRepository, UserRepository } from "../repositories";
import { TenantRepository } from "../repositories";
import { hashPassword, verifyPassword } from "../lib/security";
import { AppError, appError } from "../lib/http";
import { getDb } from "../lib/db";
import { getApiEnv } from "../lib/env";
import { signSessionToken, verifySessionToken } from "../lib/token";
import { sha256 } from "../lib/hash";

export type RegisterInput = {
  email: string;
  password: string;
  businessName: string;
  slug?: string;
  privacyAccepted: boolean;
  privacyVersion: string;
  turnstileToken?: string;
  ip?: string;
  userAgent?: string;
};

export class AuthService {
  private readonly userRepository = new UserRepository();
  private readonly authTokenRepository = new AuthTokenRepository();
  private readonly tenantRepository = new TenantRepository();

  private issueAccessToken(input: { userId: string; tenantId: string; tokenVersion: number }) {
    const env = getApiEnv();
    return signSessionToken(
      {
        sub: input.userId,
        tenantId: input.tenantId,
        tokenVersion: input.tokenVersion,
        type: "access",
        ttlSeconds: env.accessTokenTtlSeconds
      },
      env.authTokenSecret
    );
  }

  private async issueRefreshToken(input: {
    userId: string;
    tenantId: string;
    tokenVersion: number;
    familyId?: string;
  }) {
    const env = getApiEnv();
    const ttlSeconds = env.refreshTokenTtlDays * 24 * 60 * 60;
    const refreshToken = signSessionToken(
      {
        sub: input.userId,
        tenantId: input.tenantId,
        tokenVersion: input.tokenVersion,
        type: "refresh",
        ttlSeconds
      },
      env.authTokenSecret
    );
    const tokenHash = sha256(refreshToken);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const familyId = input.familyId ?? randomUUID();

    const persisted = await this.authTokenRepository.createRefreshToken({
      tenantId: input.tenantId,
      userId: input.userId,
      familyId,
      tokenHash,
      expiresAt
    });

    if (!persisted) {
      throw appError("INTERNAL_ERROR", { reason: "refresh_token_persist_failed" });
    }

    return {
      refreshToken,
      refreshTokenId: persisted.id,
      familyId,
      refreshExpiresAt: expiresAt.toISOString()
    };
  }

  private async issueSession(input: { userId: string; tenantId: string; tokenVersion: number }) {
    const accessToken = this.issueAccessToken(input);
    const refresh = await this.issueRefreshToken(input);

    return {
      accessToken,
      refreshToken: refresh.refreshToken,
      accessTokenExpiresInSeconds: getApiEnv().accessTokenTtlSeconds,
      refreshTokenExpiresAt: refresh.refreshExpiresAt
    };
  }

  private async issueEmailVerificationToken(input: { tenantId: string; userId: string }) {
    const env = getApiEnv();
    const rawToken = `${randomUUID()}.${randomBytes(16).toString("hex")}`;
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + env.emailVerificationTokenTtlMinutes * 60 * 1000);

    await this.authTokenRepository.createEmailVerificationToken({
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash,
      expiresAt
    });

    return rawToken;
  }

  private buildAppUrl(pathWithQuery: string): string | null {
    const baseUrl = getApiEnv().appBaseUrl.trim();
    if (!baseUrl) {
      return null;
    }
    try {
      const url = new URL(pathWithQuery, baseUrl);
      return url.toString();
    } catch {
      return null;
    }
  }

  private async verifyTurnstileToken(token: string): Promise<boolean> {
    const env = getApiEnv();
    if (!env.authTurnstileEnabled) {
      return true;
    }
    if (!env.turnstileSecretKey || !token) {
      return false;
    }

    try {
      const body = new URLSearchParams({
        secret: env.turnstileSecretKey,
        response: token
      });
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body
      });
      if (!response.ok) {
        return false;
      }
      const payload = (await response.json().catch(() => null)) as { success?: boolean } | null;
      return payload?.success === true;
    } catch {
      return false;
    }
  }

  private async sendResendEmail(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<boolean> {
    const env = getApiEnv();
    if (!env.resendApiKey || !env.resendFromEmail) {
      return false;
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.resendApiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from: env.resendFromEmail,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text
        })
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async register(input: RegisterInput) {
    assertEmail(input.email);
    assertPassword(input.password);

    const env = getApiEnv();
    if (!input.privacyAccepted) {
      throw appError("VALIDATION_ERROR", { reason: "privacy_consent_required" });
    }
    if (input.privacyVersion.trim() !== env.privacyPolicyVersion) {
      throw appError("VALIDATION_ERROR", { reason: "privacy_version_mismatch" });
    }

    const turnstileOk = await this.verifyTurnstileToken(input.turnstileToken?.trim() ?? "");
    if (!turnstileOk) {
      throw appError("AUTH_FORBIDDEN", { reason: "invalid_turnstile_token" });
    }

    const slugSource = input.slug ?? input.businessName;
    const slug = normalizeSlug(slugSource);
    assertValidSlug(slug);

    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await this.userRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new AppError({
        code: "CONFLICT",
        status: 409,
        message: "Account with this email already exists",
        details: { reason: "email_already_exists" }
      });
    }

    const db = getDb();
    let transactionResult: {
      tenant: { id: string };
      user: { id: string; tokenVersion: number };
      trialEndsAt: string;
    };
    try {
      transactionResult = await db.transaction(async (tx) => {
        const [createdTenant] = await tx
          .insert(tenants)
          .values({
            slug,
            name: input.businessName
          })
          .returning();

        if (!createdTenant) {
          throw appError("INTERNAL_ERROR", { reason: "tenant_create_failed" });
        }

        const [createdUser] = await tx
          .insert(users)
          .values({
            tenantId: createdTenant.id,
            email: normalizedEmail,
            passwordHash: hashPassword(input.password),
            role: "owner"
          })
          .returning();

        if (!createdUser) {
          throw appError("INTERNAL_ERROR", { reason: "user_create_failed" });
        }

        const now = new Date();
        const trialEndsAt = new Date(now.getTime() + env.trialDurationDays * 24 * 60 * 60 * 1000);

        await tx.execute(sql`
          INSERT INTO tenant_subscriptions (
            tenant_id,
            plan_code,
            effective_from,
            effective_to,
            status,
            billing_cycle_anchor,
            change_mode,
            created_at,
            updated_at
          ) VALUES (
            ${createdTenant.id},
            ${env.trialDefaultPlanCode},
            ${now},
            ${trialEndsAt},
            'trialing',
            ${now},
            'immediate_prorate',
            NOW(),
            NOW()
          )
        `);

        await tx.insert(tenantConsents).values({
          tenantId: createdTenant.id,
          userId: createdUser.id,
          consentType: "privacy_policy",
          consentVersion: env.privacyPolicyVersion,
          acceptedAt: now,
          ip: input.ip?.slice(0, 64),
          userAgent: input.userAgent?.slice(0, 512)
        });

        return { tenant: createdTenant, user: createdUser, trialEndsAt: trialEndsAt.toISOString() };
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        const code = String(error.code);
        const constraint = "constraint" in error ? String(error.constraint) : "";

        if (code === "23505" && constraint === "uq_tenants_slug") {
          throw appError("CONFLICT", { reason: "slug_already_exists" });
        }
        if (code === "23505" && constraint === "uq_users_email") {
          throw appError("CONFLICT", { reason: "email_already_exists" });
        }
      }
      throw error;
    }

    const { tenant, user } = transactionResult;
    const verificationToken = await this.issueEmailVerificationToken({
      tenantId: tenant.id,
      userId: user.id
    });
    const verificationUrl = this.buildAppUrl(`/email-verification?token=${encodeURIComponent(verificationToken)}`);
    const verificationSent = await this.sendResendEmail({
      to: normalizedEmail,
      subject: "Verify your email",
      html: `<p>Welcome to Genius Clients.</p><p>Verify your email: <a href="${verificationUrl ?? "#"}">${verificationUrl ?? "open verification page"}</a></p>`,
      text: verificationUrl
        ? `Welcome to Genius Clients. Verify your email: ${verificationUrl}`
        : "Welcome to Genius Clients. Open Email Verification page and use your latest verification token."
    });

    const session = await this.issueSession({
      userId: user.id,
      tenantId: tenant.id,
      tokenVersion: user.tokenVersion
    });
    const verificationTokenPreview =
      process.env.NODE_ENV !== "production" ? verificationToken : undefined;

    return {
      userId: user.id ?? randomUUID(),
      tenantId: tenant.id ?? randomUUID(),
      email: normalizedEmail,
      businessName: input.businessName,
      slug,
      requiresEmailVerification: true,
      isEmailVerified: false,
      trialEndsAt: transactionResult.trialEndsAt,
      whatsappSetupNotice:
        "To connect your WhatsApp booking bot, contact administration. Use a new number: one number cannot be used both as bot and as regular operator chat.",
      verificationEmailDispatched: verificationSent,
      session,
      ...(verificationTokenPreview ? { verificationTokenPreview } : {})
    };
  }

  async login(input?: { email?: string; password?: string }) {
    const email = input?.email?.trim().toLowerCase();
    const password = input?.password;

    if (!email || !password) {
      throw appError("VALIDATION_ERROR", { required: ["email", "password"] });
    }

    const user = await this.userRepository.findByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw appError("AUTH_INVALID_CREDENTIALS");
    }

    const session = await this.issueSession({
      userId: user.id,
      tenantId: user.tenantId,
      tokenVersion: user.tokenVersion
    });
    const tenant = await this.tenantRepository.findById(user.tenantId);

    return {
      userId: user.id,
      tenantId: user.tenantId,
      slug: tenant?.slug,
      isEmailVerified: user.isEmailVerified,
      session
    };
  }

  async me(input?: { accessToken?: string }) {
    const accessToken = input?.accessToken;
    if (!accessToken) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "access_token_required" });
    }

    const payload = verifySessionToken(accessToken, getApiEnv().authTokenSecret);
    if (!payload || payload.type !== "access") {
      throw appError("AUTH_UNAUTHORIZED", { reason: "invalid_access_token" });
    }

    const user = await this.userRepository.findById(payload.sub);
    if (!user || !user.isActive) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "user_not_active" });
    }
    if (user.tokenVersion !== payload.tokenVersion) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "access_token_version_mismatch" });
    }
    const tenant = await this.tenantRepository.findById(user.tenantId);
    const now = new Date();
    const subscriptionSummary = await getDb().execute<{
      planCode: string | null;
      effectiveTo: Date | null;
      status: string | null;
    }>(sql`
      SELECT
        ts.plan_code AS "planCode",
        ts.effective_to AS "effectiveTo",
        ts.status
      FROM tenant_subscriptions ts
      WHERE
        ts.tenant_id = ${user.tenantId}
        AND ts.status IN ('active', 'trialing', 'past_due', 'incomplete')
        AND ts.effective_from <= ${now}
        AND (ts.effective_to IS NULL OR ts.effective_to > ${now})
      ORDER BY ts.effective_from DESC, ts.updated_at DESC
      LIMIT 1
    `);
    const activeSubscription = subscriptionSummary.rows[0];
    const trialEndsAt =
      activeSubscription?.status === "trialing"
        ? activeSubscription.effectiveTo?.toISOString() ?? null
        : null;
    const trialDaysLeft =
      activeSubscription?.status === "trialing" && activeSubscription?.effectiveTo instanceof Date
        ? Math.max(0, Math.ceil((activeSubscription.effectiveTo.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
        : 0;

    return {
      userId: user.id,
      tenantId: user.tenantId,
      slug: tenant?.slug,
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      planCode: activeSubscription?.planCode ?? null,
      trialEndsAt,
      trialDaysLeft
    };
  }

  async refresh(input?: { refreshToken?: string }) {
    const refreshToken = input?.refreshToken;
    if (!refreshToken) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "refresh_token_required" });
    }

    const env = getApiEnv();
    const payload = verifySessionToken(refreshToken, env.authTokenSecret);
    if (!payload || payload.type !== "refresh") {
      throw appError("AUTH_UNAUTHORIZED", { reason: "invalid_refresh_token" });
    }

    const tokenHash = sha256(refreshToken);
    const currentToken = await this.authTokenRepository.findActiveRefreshTokenByHash(tokenHash);
    if (!currentToken) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "refresh_token_not_active" });
    }

    if (currentToken.userId !== payload.sub || currentToken.tenantId !== payload.tenantId) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "refresh_token_subject_mismatch" });
    }

    const user = await this.userRepository.findById(payload.sub);
    if (!user || !user.isActive) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "user_not_active" });
    }

    if (user.tokenVersion !== payload.tokenVersion) {
      await this.authTokenRepository.revokeActiveRefreshFamily(currentToken.familyId);
      throw appError("AUTH_UNAUTHORIZED", { reason: "refresh_token_version_mismatch" });
    }

    const accessToken = this.issueAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      tokenVersion: user.tokenVersion
    });
    const nextRefresh = await this.issueRefreshToken({
      userId: user.id,
      tenantId: user.tenantId,
      tokenVersion: user.tokenVersion,
      familyId: currentToken.familyId
    });
    await this.authTokenRepository.revokeRefreshToken({
      tokenId: currentToken.id,
      replacedByTokenId: nextRefresh.refreshTokenId
    });

    return {
      userId: user.id,
      tenantId: user.tenantId,
      session: {
        accessToken,
        refreshToken: nextRefresh.refreshToken,
        accessTokenExpiresInSeconds: env.accessTokenTtlSeconds,
        refreshTokenExpiresAt: nextRefresh.refreshExpiresAt
      }
    };
  }

  async logout(input?: { refreshToken?: string }) {
    const refreshToken = input?.refreshToken;
    if (!refreshToken) {
      return { revoked: false };
    }

    const tokenHash = sha256(refreshToken);
    const currentToken = await this.authTokenRepository.findActiveRefreshTokenByHash(tokenHash);
    if (!currentToken) {
      return { revoked: false };
    }

    await this.authTokenRepository.revokeRefreshToken({ tokenId: currentToken.id });
    return { revoked: true };
  }

  async forgotPassword(input?: { email?: string }) {
    const email = input?.email?.trim().toLowerCase();
    if (!email) {
      return { accepted: true };
    }

    const user = await this.userRepository.findByEmail(email);
    if (!user || !user.isActive) {
      return { accepted: true };
    }

    const env = getApiEnv();
    const rawToken = `${randomUUID()}.${randomBytes(16).toString("hex")}`;
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + env.passwordResetTokenTtlMinutes * 60 * 1000);

    await this.authTokenRepository.createPasswordResetToken({
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash,
      expiresAt
    });
    const resetUrl = this.buildAppUrl(`/reset-password?token=${encodeURIComponent(rawToken)}`);
    await this.sendResendEmail({
      to: user.email,
      subject: "Reset your password",
      html: `<p>We received a password reset request.</p><p>Reset password: <a href="${resetUrl ?? "#"}">${resetUrl ?? "open reset page"}</a></p>`,
      text: resetUrl
        ? `Reset your password: ${resetUrl}`
        : "Reset your password from the Reset Password page using your latest token."
    });

    return {
      accepted: true,
      ...(process.env.NODE_ENV !== "production" ? { resetTokenPreview: rawToken } : {})
    };
  }

  async resetPassword(input?: { token?: string; password?: string }) {
    const token = input?.token;
    const password = input?.password;

    if (!token || !password) {
      throw appError("VALIDATION_ERROR", { required: ["token", "password"] });
    }

    assertPassword(password);
    const tokenHash = sha256(token);
    const resetTokenRecord = await this.authTokenRepository.findUsablePasswordResetTokenByHash(tokenHash);

    if (!resetTokenRecord) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "invalid_or_expired_reset_token" });
    }

    const updatedUser = await this.userRepository.updatePasswordAndBumpTokenVersion({
      userId: resetTokenRecord.userId,
      passwordHash: hashPassword(password)
    });

    if (!updatedUser) {
      throw appError("INTERNAL_ERROR", { reason: "password_update_failed" });
    }

    await this.authTokenRepository.markPasswordResetTokenUsed(resetTokenRecord.id);
    await this.authTokenRepository.revokeAllUserRefreshTokens(updatedUser.id);

    return { changed: true };
  }

  async requestEmailVerification(input?: { email?: string }) {
    const email = input?.email?.trim().toLowerCase();
    if (!email) {
      return { accepted: true };
    }

    const user = await this.userRepository.findByEmail(email);
    if (!user || !user.isActive || user.isEmailVerified) {
      return { accepted: true };
    }

    const token = await this.issueEmailVerificationToken({
      tenantId: user.tenantId,
      userId: user.id
    });
    const verifyUrl = this.buildAppUrl(`/email-verification?token=${encodeURIComponent(token)}`);
    await this.sendResendEmail({
      to: user.email,
      subject: "Verify your email",
      html: `<p>Please verify your email to unlock all admin actions.</p><p>Verify email: <a href="${verifyUrl ?? "#"}">${verifyUrl ?? "open verification page"}</a></p>`,
      text: verifyUrl
        ? `Verify your email: ${verifyUrl}`
        : "Open Email Verification page and use your latest verification token."
    });

    return {
      accepted: true,
      ...(process.env.NODE_ENV !== "production" ? { verificationTokenPreview: token } : {})
    };
  }

  async verifyEmail(input?: { token?: string }) {
    const token = input?.token;
    if (!token) {
      throw appError("VALIDATION_ERROR", { required: ["token"] });
    }

    const tokenHash = sha256(token);
    const tokenRecord =
      await this.authTokenRepository.findUsableEmailVerificationTokenByHash(tokenHash);

    if (!tokenRecord) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "invalid_or_expired_verification_token" });
    }

    const user = await this.userRepository.findById(tokenRecord.userId);
    if (!user || !user.isActive) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "user_not_active" });
    }

    await this.userRepository.markEmailVerified(user.id);
    await this.authTokenRepository.markEmailVerificationTokenUsed(tokenRecord.id);

    return { verified: true };
  }
}
