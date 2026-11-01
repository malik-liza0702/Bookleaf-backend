import { Schema, model, type Types } from 'mongoose';
import { ROLES, type Role } from '../domain/enums.js';

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ROLES, required: true, index: true },
  },
  { timestamps: true },
);

export const UserModel = model<UserDoc>('User', userSchema);
