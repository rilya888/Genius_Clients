import { assertEmail, assertPassword, assertValidSlug, normalizeSlug } from "@genius/shared";
import { randomBytes, randomUUID } from "node:crypto";
import { users, tenants } from "@genius/db";
import { AuthTokenRepository, UserRepository } from "../repositories";
import { hashPassword, verifyPassword } from "../lib/security";
import { appError } from "../lib/http";
import { getDb } from "../lib/db";
import { getApiEnv } from "../lib/env";
import { signSessionToken, verifySessionToken } from "../lib/token";
import { sha256 } from "../lib/hash";

export type RegisterInput = {
  email: string;
  password: string;
  businessName: string;
  slug?: string;
};

export class AuthService {
  private readonly userRepository = new UserRepository();
  private readonly authTokenRepository = new AuthTokenRepository();

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

  async register(input: RegisterInput) {
    assertEmail(input.email);
    assertPassword(input.password);

    const slugSource = input.slug ?? input.businessName;
    const slug = normalizeSlug(slugSource);
    assertValidSlug(slug);

    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await this.userRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw appError("CONFLICT", { reason: "email_already_exists" });
    }

    const db = getDb();
    let transactionResult: { tenant: { id: string }; user: { id: string; tokenVersion: number } };
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

        return { tenant: createdTenant, user: createdUser };
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
    const session = await this.issueSession({
      userId: user.id,
      tenantId: tenant.id,
      tokenVersion: user.tokenVersion
    });
    const verificationTokenPreview =
      process.env.NODE_ENV !== "production"
        ? await this.issueEmailVerificationToken({
            tenantId: tenant.id,
            userId: user.id
          })
        : undefined;

    return {
      userId: user.id ?? randomUUID(),
      tenantId: tenant.id ?? randomUUID(),
      email: normalizedEmail,
      businessName: input.businessName,
      slug,
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

    return {
      userId: user.id,
      tenantId: user.tenantId,
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

    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified
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
