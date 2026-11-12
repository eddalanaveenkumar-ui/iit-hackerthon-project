import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { unauthorized, forbidden } from '../utils/errors.js';
import { ObjectId } from 'mongodb';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role || 'user' }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.auth.jwtSecret);
}

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token;
    if (!token) throw unauthorized();
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw unauthorized('Session expired, please sign in again');
    }
    const db = getDb();
    const user = await db.collection('users').findOne({ _id: new ObjectId(payload.sub) });
    if (!user) throw unauthorized('Account no longer exists');
    req.user = user;
    req.userId = user._id;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Platform administrator access required'));
  return next();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    avatarColor: user.avatarColor,
    headline: user.headline,
    preferences: user.preferences,
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt,
  };
}
