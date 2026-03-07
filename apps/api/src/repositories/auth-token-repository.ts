import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { emailVerificationTokens, passwordResetTokens, refreshTokens } from "@genius/db";
import { getDb } from "../lib/db";

export class AuthTokenRepository {
  async createRefreshToken(input: {
    tenantId: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const db = getDb();
    const [record] = await db
      .insert(refreshTokens)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        familyId: input.familyId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt
      })
      .returning();

    return record ?? null;
  }

  async findActiveRefreshTokenByHash(tokenHash: string) {
    const db = getDb();
    const now = new Date();
    const [record] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now)
        )
      )
      .limit(1);

    return record ?? null;
  }

  async revokeRefreshToken(input: { tokenId: string; replacedByTokenId?: string }) {
    const db = getDb();
    const [record] = await db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
        replacedByTokenId: input.replacedByTokenId,
        updatedAt: new Date()
      })
      .where(and(eq(refreshTokens.id, input.tokenId), isNull(refreshTokens.revokedAt)))
      .returning();

    return record ?? null;
  }

  async revokeAllUserRefreshTokens(userId: string) {
    const db = getDb();
    const result = await db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));

    return result.rowCount ?? 0;
  }

  async createPasswordResetToken(input: {
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const db = getDb();
    const [record] = await db
      .insert(passwordResetTokens)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt
      })
      .returning();

    return record ?? null;
  }

  async createEmailVerificationToken(input: {
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const db = getDb();
    const [record] = await db
      .insert(emailVerificationTokens)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt
      })
      .returning();

    return record ?? null;
  }

  async findUsableEmailVerificationTokenByHash(tokenHash: string) {
    const db = getDb();
    const now = new Date();
    const [record] = await db
      .select()
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, now)
        )
      )
      .limit(1);

    return record ?? null;
  }

  async markEmailVerificationTokenUsed(tokenId: string) {
    const db = getDb();
    const [record] = await db
      .update(emailVerificationTokens)
      .set({
        usedAt: new Date()
      })
      .where(and(eq(emailVerificationTokens.id, tokenId), isNull(emailVerificationTokens.usedAt)))
      .returning();

    return record ?? null;
  }

  async findUsablePasswordResetTokenByHash(tokenHash: string) {
    const db = getDb();
    const now = new Date();
    const [record] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      )
      .limit(1);

    return record ?? null;
  }

  async markPasswordResetTokenUsed(tokenId: string) {
    const db = getDb();
    const [record] = await db
      .update(passwordResetTokens)
      .set({
        usedAt: new Date()
      })
      .where(and(eq(passwordResetTokens.id, tokenId), isNull(passwordResetTokens.usedAt)))
      .returning();

    return record ?? null;
  }

  async revokeActiveRefreshFamily(familyId: string) {
    const db = getDb();
    const result = await db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));

    return result.rowCount ?? 0;
  }

  async deleteExpiredAuthTokens() {
    const db = getDb();
    const now = new Date();
    const refreshResult = await db.delete(refreshTokens).where(sql`${refreshTokens.expiresAt} <= ${now}`);
    const resetResult = await db
      .delete(passwordResetTokens)
      .where(sql`${passwordResetTokens.expiresAt} <= ${now}`);
    const verifyResult = await db
      .delete(emailVerificationTokens)
      .where(sql`${emailVerificationTokens.expiresAt} <= ${now}`);

    return {
      refreshDeleted: refreshResult.rowCount ?? 0,
      resetDeleted: resetResult.rowCount ?? 0,
      verifyDeleted: verifyResult.rowCount ?? 0
    };
  }
}
