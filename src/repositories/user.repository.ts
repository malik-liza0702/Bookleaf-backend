import { isValidObjectId, type PipelineStage } from 'mongoose';
import { escapeRegex } from '../lib/regex.js';
import { AuthorModel, type AuthorDoc } from '../models/author.model.js';
import { UserModel, type UserDoc } from '../models/user.model.js';

export type AuthorRecord = Pick<AuthorDoc, '_id' | 'authorId' | 'phone' | 'city' | 'joinedDate'> & {
  user: Pick<UserDoc, 'name' | 'email'>;
};

export interface AuthorTicketCounts {
  total: number;
  unresolved: number;
}

const AUTHOR_WITH_USER: PipelineStage[] = [
  { $lookup: { from: UserModel.collection.name, localField: 'user', foreignField: '_id', as: 'user' } },
  { $unwind: '$user' },
  {
    $project: {
      authorId: 1,
      phone: 1,
      city: 1,
      joinedDate: 1,
      'user.name': 1,
      'user.email': 1,
    },
  },
];

export class UserRepository {
  findByEmail(email: string) {
    return UserModel.findOne({ email: email.toLowerCase() }).lean();
  }

  findById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return UserModel.findById(id).lean();
  }

  findAuthorProfile(userId: string) {
    return AuthorModel.findOne({ user: userId }).lean();
  }

  findAuthorByAuthorId(authorId: string) {
    return AuthorModel.findOne({ authorId }).lean();
  }

  async listAuthors(params: { search?: string; page: number; limit: number }) {
    const regex = params.search ? { $regex: escapeRegex(params.search), $options: 'i' } : null;
    const match: PipelineStage[] = regex
      ? [
          {
            $match: {
              $or: [{ 'user.name': regex }, { 'user.email': regex }, { authorId: regex }, { city: regex }],
            },
          },
        ]
      : [];
    const [result] = await AuthorModel.aggregate<{ rows: AuthorRecord[]; total: { count: number }[] }>([
      ...AUTHOR_WITH_USER,
      ...match,
      {
        $facet: {
          rows: [
            { $sort: { 'user.name': 1, authorId: 1 } },
            { $skip: (params.page - 1) * params.limit },
            { $limit: params.limit },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ]).collation({ locale: 'en', strength: 2 });
    return { rows: result?.rows ?? [], total: result?.total[0]?.count ?? 0 };
  }

  async findAuthorRecord(authorId: string) {
    const [author] = await AuthorModel.aggregate<AuthorRecord>([
      { $match: { authorId } },
      ...AUTHOR_WITH_USER,
    ]);
    return author ?? null;
  }

  findAdminById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return UserModel.findOne({ _id: id, role: 'admin' }).lean();
  }

  listAdmins() {
    return UserModel.find({ role: 'admin' }).select({ name: 1, email: 1 }).sort({ name: 1 }).lean();
  }
}
