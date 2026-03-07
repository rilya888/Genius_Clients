import { eq, sql } from "drizzle-orm";
import { users } from "@genius/db";
import { getDb } from "../lib/db";

export class UserRepository {
  async createOwner(input: { tenantId: string; email: string; passwordHash: string }) {
    const db = getDb();
    const [user] = await db
      .insert(users)
      .values({
        tenantId: input.tenantId,
        email: input.email,
        passwordHash: input.passwordHash,
        role: "owner"
      })
      .returning();

    return user;
  }

  async findByEmail(email: string) {
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user ?? null;
  }

  async findById(id: string) {
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async updatePasswordAndBumpTokenVersion(input: { userId: string; passwordHash: string }) {
    const db = getDb();
    const [user] = await db
      .update(users)
      .set({
        passwordHash: input.passwordHash,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date()
      })
      .where(eq(users.id, input.userId))
      .returning();

    return user ?? null;
  }

  async markEmailVerified(userId: string) {
    const db = getDb();
    const [user] = await db
      .update(users)
      .set({
        isEmailVerified: true,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();

    return user ?? null;
  }
}
