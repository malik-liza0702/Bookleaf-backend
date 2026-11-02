import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

export const DEFAULT_DB_NAME = 'bookleaf';

export async function connectDatabase(uri: string, dbName = DEFAULT_DB_NAME): Promise<typeof mongoose> {
  return mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000 });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
