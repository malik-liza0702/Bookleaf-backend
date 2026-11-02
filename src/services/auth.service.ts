import bcrypt from 'bcryptjs';
import { Errors } from '../lib/errors.js';
import type { TokenService } from '../lib/jwt.js';
import { toUserDto, type UserDto } from '../mappers/user.mapper.js';
import type { UserRepository } from '../repositories/user.repository.js';

const INVALID_CREDENTIALS = 'Invalid email or password';
const ADMIN_EMAIL_DOMAIN = '@bookleaf.com';

export class AuthService {
  private readonly dummyHash = bcrypt.hashSync('timing-equaliser', 10);

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; user: UserDto }> {
    const user = await this.users.findByEmail(email);
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? this.dummyHash);
    if (!user || !passwordOk) {
      throw Errors.unauthenticated(INVALID_CREDENTIALS);
    }
    if (user.role === 'admin' && !user.email.toLowerCase().endsWith(ADMIN_EMAIL_DOMAIN)) {
      throw Errors.forbidden(`Admin accounts must use a ${ADMIN_EMAIL_DOMAIN} email address`);
    }

    const authorId = user.role === 'author' ? await this.authorIdFor(user._id.toString()) : undefined;
    const token = this.tokens.sign({ id: user._id.toString(), role: user.role, authorId });
    return { token, user: toUserDto(user, authorId) };
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw Errors.unauthenticated('Account no longer exists');
    }
    const authorId = user.role === 'author' ? await this.authorIdFor(userId) : undefined;
    return toUserDto(user, authorId);
  }

  private async authorIdFor(userId: string): Promise<string | undefined> {
    const profile = await this.users.findAuthorProfile(userId);
    return profile?.authorId;
  }
}
