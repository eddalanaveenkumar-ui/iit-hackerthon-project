import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import config from '../../config/index.js';
import { authenticate, signToken, publicUser } from '../../middleware/auth.js';
import { validate } from '../../utils/validation.js';
import { badRequest, conflict, unauthorized } from '../../utils/errors.js';
import { asyncHandler } from '../../utils/errors.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  headline: z.string().trim().max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#059669', '#4f46e5', '#b45309'];

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = validate(registerSchema, req.body);
    const db = getDb();
    const existing = await db.collection('users').findOne({ email: data.email });
    if (existing) throw conflict('An account with this email already exists');

    const userCount = await db.collection('users').countDocuments();
    const passwordHash = await bcrypt.hash(data.password, config.auth.bcryptRounds);
    const doc = {
      name: data.name,
      email: data.email,
      passwordHash,
      avatarColor: AVATAR_COLORS[userCount % AVATAR_COLORS.length],
      // Platform administrator flag only. Classroom capabilities come from
      // classroom-scoped memberships, never from this field.
      role: userCount === 0 && data.email === 'admin@learnmate.ai' ? 'admin' : 'user',
      headline: data.headline || '',
      preferences: { theme: 'light', notifications: true },
      lastActiveAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { insertedId } = await db.collection('users').insertOne(doc);
    const user = { _id: insertedId, ...doc };
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const data = validate(loginSchema, req.body);
    const db = getDb();
    const user = await db.collection('users').findOne({ email: data.email });
    if (!user) throw unauthorized('Incorrect email or password');
    const ok = await bcrypt.compare(data.password, user.passwordHash || '');
    if (!ok) throw unauthorized('Incorrect email or password');
    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } });
    res.json({ token: signToken(user), user: publicUser(user) });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  }),
);

router.patch(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().trim().min(2).max(60).optional(),
      headline: z.string().trim().max(120).optional(),
      avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      preferences: z
        .object({ theme: z.enum(['light', 'dark']).optional(), notifications: z.boolean().optional() })
        .optional(),
    });
    const data = validate(schema, req.body);
    const db = getDb();
    const update = { updatedAt: new Date() };
    if (data.name) update.name = data.name;
    if (data.headline !== undefined) update.headline = data.headline;
    if (data.avatarColor) update.avatarColor = data.avatarColor;
    if (data.preferences) {
      update.preferences = { ...(req.user.preferences || {}), ...data.preferences };
    }
    await db.collection('users').updateOne({ _id: req.user._id }, { $set: update });
    const user = await db.collection('users').findOne({ _id: req.user._id });
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) });
    const data = validate(schema, req.body);
    const db = getDb();
    const ok = await bcrypt.compare(data.currentPassword, req.user.passwordHash || '');
    if (!ok) throw badRequest('Current password is incorrect');
    const passwordHash = await bcrypt.hash(data.newPassword, config.auth.bcryptRounds);
    await db.collection('users').updateOne({ _id: req.user._id }, { $set: { passwordHash, updatedAt: new Date() } });
    res.json({ ok: true });
  }),
);

/** Directory lookup used by classroom owners to invite people by email. */
router.get(
  '/directory',
  authenticate,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json({ users: [] });
    const db = getDb();
    const users = await db
      .collection('users')
      .find({ $or: [{ email: { $regex: q, $options: 'i' } }, { name: { $regex: q, $options: 'i' } }] })
      .limit(8)
      .toArray();
    res.json({
      users: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, avatarColor: u.avatarColor })),
    });
  }),
);

export default router;
