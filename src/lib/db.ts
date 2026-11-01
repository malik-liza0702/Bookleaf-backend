import mongoose from 'mongoose';

/**
 * Strict query filters: unknown fields in a filter are dropped rather than
 * passed to MongoDB, a guard against operator injection via unexpected keys.
 */
mongoose.set('strictQuery', true);

export const DEFAULT_DB_NAME = 'bookleaf';

/** `dbName` wins over any database named in the URI path (which otherwise defaults to `test`). */
export async function connectDatabase(uri: string, dbName = DEFAULT_DB_NAME): Promise<typeof mongoose> {
  return mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000 });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
