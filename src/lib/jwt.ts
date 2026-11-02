import jwt, { type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import type { AuthUser } from '../types/express.js';

const payloadSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(['author', 'admin']),
  authorId: z.string().optional(),
});

export class TokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresIn: string,
  ) {}

  sign(user: AuthUser): string {
    const payload = { role: user.role, ...(user.authorId ? { authorId: user.authorId } : {}) };
    return jwt.sign(payload, this.secret, {
      subject: user.id,
      expiresIn: this.expiresIn as SignOptions['expiresIn'],
      algorithm: 'HS256',
    });
  }

  verify(token: string): AuthUser | null {
    try {
      const decoded = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      const payload = payloadSchema.parse(decoded);
      return { id: payload.sub, role: payload.role, authorId: payload.authorId };
    } catch {
      return null;
    }
  }
}
