import { Schema, model, type Types } from 'mongoose';

/**
 * Books live in their own collection (not embedded in authors) because admins
 * query them across authors and tickets reference them individually.
 * Money is whole rupees, as in the dataset.
 */
export interface BookDoc {
  _id: Types.ObjectId;
  bookId: string; // business key, e.g. BK001
  authorId: string; // AUTH001
  title: string;
  isbn: string;
  genre: string;
  publicationDate: Date | null;
  status: string; // free text, e.g. "In Production - Cover Design"
  mrp: number | null;
  authorRoyaltyPerCopy: number | null;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: Date | null;
  printPartner: string | null;
  availableOn: string[];
  createdAt: Date;
  updatedAt: Date;
}

const bookSchema = new Schema<BookDoc>(
  {
    bookId: { type: String, required: true, unique: true },
    authorId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    isbn: { type: String, required: true },
    genre: { type: String, required: true },
    publicationDate: { type: Date, default: null },
    status: { type: String, required: true },
    mrp: { type: Number, default: null },
    authorRoyaltyPerCopy: { type: Number, default: null },
    totalCopiesSold: { type: Number, default: 0 },
    totalRoyaltyEarned: { type: Number, default: 0 },
    royaltyPaid: { type: Number, default: 0 },
    royaltyPending: { type: Number, default: 0 },
    lastRoyaltyPayoutDate: { type: Date, default: null },
    printPartner: { type: String, default: null },
    availableOn: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const BookModel = model<BookDoc>('Book', bookSchema);
