import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { fromDateOnly } from '../lib/dates.js';
import { connectDatabase, DEFAULT_DB_NAME, disconnectDatabase } from '../lib/db.js';
import { AiCallLogModel } from '../models/ai-call-log.model.js';
import { AuthorModel } from '../models/author.model.js';
import { BookModel } from '../models/book.model.js';
import { NotificationModel } from '../models/notification.model.js';
import { TicketModel } from '../models/ticket.model.js';
import { UserModel } from '../models/user.model.js';

const AUTHOR_PASSWORD = 'Author@123';
const ADMIN_PASSWORD = 'Admin@123';
const ADMINS = [
  { email: 'admin@bookleaf.com', name: 'Aisha Verma' },
  { email: 'ops@bookleaf.com', name: 'Karan Mehta' },
];

const here = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = join(here, '..', '..', 'data', 'bookleaf_sample_data.json');

const bookSchema = z.object({
  book_id: z.string(),
  title: z.string(),
  isbn: z.string(),
  genre: z.string(),
  publication_date: z.string().nullable(),
  status: z.string(),
  mrp: z.number().nullable(),
  author_royalty_per_copy: z.number().nullable(),
  total_copies_sold: z.number(),
  total_royalty_earned: z.number(),
  royalty_paid: z.number(),
  royalty_pending: z.number(),
  last_royalty_payout_date: z.string().nullable(),
  print_partner: z.string().nullable(),
  available_on: z.array(z.string()),
});
const datasetSchema = z.object({
  authors: z.array(
    z.object({
      author_id: z.string(),
      name: z.string(),
      email: z.string(),
      phone: z.string(),
      city: z.string(),
      joined_date: z.string(),
      books: z.array(bookSchema),
    }),
  ),
});

async function seedPeople(dataset: z.infer<typeof datasetSchema>) {
  const authorHash = await bcrypt.hash(AUTHOR_PASSWORD, 10);
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  for (const admin of ADMINS) {
    await UserModel.updateOne(
      { email: admin.email },
      { $set: { name: admin.name, role: 'admin', passwordHash: adminHash } },
      { upsert: true },
    );
  }

  for (const entry of dataset.authors) {
    const user = await UserModel.findOneAndUpdate(
      { email: entry.email.toLowerCase() },
      { $set: { name: entry.name, role: 'author', passwordHash: authorHash } },
      { upsert: true, returnDocument: 'after' },
    );
    await AuthorModel.updateOne(
      { authorId: entry.author_id },
      {
        $set: {
          user: user!._id,
          phone: entry.phone,
          city: entry.city,
          joinedDate: fromDateOnly(entry.joined_date),
        },
      },
      { upsert: true },
    );
    for (const book of entry.books) {
      await BookModel.updateOne(
        { bookId: book.book_id },
        {
          $set: {
            authorId: entry.author_id,
            title: book.title,
            isbn: book.isbn,
            genre: book.genre,
            publicationDate: fromDateOnly(book.publication_date),
            status: book.status,
            mrp: book.mrp,
            authorRoyaltyPerCopy: book.author_royalty_per_copy,
            totalCopiesSold: book.total_copies_sold,
            totalRoyaltyEarned: book.total_royalty_earned,
            royaltyPaid: book.royalty_paid,
            royaltyPending: book.royalty_pending,
            lastRoyaltyPayoutDate: fromDateOnly(book.last_royalty_payout_date),
            printPartner: book.print_partner,
            availableOn: book.available_on,
          },
        },
        { upsert: true },
      );
    }
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const dbName = process.env.MONGODB_DB_NAME?.trim() || DEFAULT_DB_NAME;

  const dataset = datasetSchema.parse(JSON.parse(readFileSync(DATASET_PATH, 'utf8')));
  await connectDatabase(uri, dbName);
  try {
    await Promise.all(
      [UserModel, AuthorModel, BookModel, TicketModel, AiCallLogModel, NotificationModel].map((model) =>
        model.syncIndexes(),
      ),
    );
    await seedPeople(dataset);
    const bookCount = dataset.authors.reduce((sum, author) => sum + author.books.length, 0);
    console.log(
      `Seed complete (database "${dbName}"): ${ADMINS.length} admins, ${dataset.authors.length} authors, ${bookCount} books.`,
    );
    console.log(`Logins: admin@bookleaf.com / ${ADMIN_PASSWORD}, authors (e.g. priya.sharma@email.com) / ${AUTHOR_PASSWORD}`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
