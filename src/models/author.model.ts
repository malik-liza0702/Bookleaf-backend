import { Schema, model, type Types } from 'mongoose';

export interface AuthorDoc {
  _id: Types.ObjectId;
  authorId: string;
  user: Types.ObjectId;
  phone: string | null;
  city: string | null;
  joinedDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const authorSchema = new Schema<AuthorDoc>(
  {
    authorId: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    phone: { type: String, default: null },
    city: { type: String, default: null },
    joinedDate: { type: Date, required: true },
  },
  { timestamps: true },
);

export const AuthorModel = model<AuthorDoc>('Author', authorSchema);
