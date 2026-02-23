import { eq, and } from 'drizzle-orm';
import { db, verifications, users } from '../../db/index.js';
import type { VerificationType } from '@repo/shared/types';

export class VerificationService {
  async createVerification(userId: string, type: VerificationType) {
    const [verification] = await db
      .insert(verifications)
      .values({
        userId,
        type,
        status: 'pending',
      })
      .returning();

    return verification;
  }

  async getVerification(userId: string, type: VerificationType) {
    const [verification] = await db
      .select()
      .from(verifications)
      .where(and(eq(verifications.userId, userId), eq(verifications.type, type)))
      .limit(1);

    return verification ?? null;
  }

  async updateVerificationStatus(
    verificationId: string,
    status: 'verified' | 'failed',
    metadata?: Record<string, unknown>
  ) {
    const [updated] = await db
      .update(verifications)
      .set({
        status,
        metadata,
        verifiedAt: status === 'verified' ? new Date() : undefined,
      })
      .where(eq(verifications.id, verificationId))
      .returning();

    return updated;
  }

  async isUserVerified(userId: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user?.isVerified ?? false;
  }
}

export const verificationService = new VerificationService();
