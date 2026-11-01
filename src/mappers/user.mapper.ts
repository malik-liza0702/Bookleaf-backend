import type { Role } from '../domain/enums.js';
import type { UserDoc } from '../models/user.model.js';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  authorId?: string;
}

export function toUserDto(user: UserDoc, authorId?: string): UserDto {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    ...(authorId ? { authorId } : {}),
  };
}
