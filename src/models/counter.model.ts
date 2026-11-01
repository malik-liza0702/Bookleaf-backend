import { Schema, model } from 'mongoose';

/** Named monotonic sequences (e.g. "ticketNumber"), incremented atomically with $inc. */
interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export const CounterModel = model<CounterDoc>('Counter', counterSchema);

/** Returns the next value of a sequence, creating it on first use. Safe under concurrency. */
export async function nextSequence(name: string): Promise<number> {
  const counter = await CounterModel.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', lean: true },
  );
  return counter!.seq;
}
