import mongoose from 'mongoose';

/**
 * A reason offered when a ride is cancelled. `audience` says whose app shows it.
 * The defaults below are inserted the first time a list is requested, so the
 * cancel sheet is never empty on a fresh database.
 */
const cancellationReasonSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    audience: { type: String, enum: ['user', 'driver'], default: 'user', index: true },
    // Catch-all entries ("Other") make the rider type what happened.
    requiresNote: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const CancellationReason =
  mongoose.models.TaxiCancellationReason ||
  mongoose.model('TaxiCancellationReason', cancellationReasonSchema);

const DEFAULTS = {
  user: [
    ['Driver is taking too long', false],
    ['Driver asked me to cancel', false],
    ['Booked by mistake', false],
    ['Found another ride', false],
    ['Wrong pickup or drop location', false],
    ['Changed my plans', false],
    ['Other', true],
  ],
  driver: [
    ['Rider is not at the pickup point', false],
    ['Rider asked me to cancel', false],
    ['Vehicle problem', false],
    ['Too far from pickup', false],
    ['Other', true],
  ],
};

export const listCancellationReasons = async (audience = 'user') => {
  const who = audience === 'driver' ? 'driver' : 'user';
  const existing = await CancellationReason.countDocuments({ audience: who });
  if (existing === 0) {
    await CancellationReason.insertMany(
      DEFAULTS[who].map(([title, requiresNote], order) => ({ title, requiresNote, order, audience: who })),
    );
  }

  const rows = await CancellationReason.find({ audience: who, active: true }).sort({ order: 1, createdAt: 1 }).lean();
  return rows.map((row) => ({ id: String(row._id), title: row.title, requiresNote: Boolean(row.requiresNote) }));
};
