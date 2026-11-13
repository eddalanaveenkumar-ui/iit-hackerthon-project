import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import config from './config/index.js';
import { AppError } from './utils/errors.js';
import { authenticate } from './middleware/auth.js';
import { dbInfo } from './db/index.js';

import authRoutes from './modules/auth/routes.js';
import classroomRoutes from './modules/classrooms/routes.js';
import syllabusRoutes from './modules/syllabus/routes.js';
import tutorRoutes from './modules/tutor/routes.js';
import assessmentRoutes from './modules/assessments/routes.js';
import practiceRoutes from './modules/practice/routes.js';
import intelligenceRoutes from './modules/intelligence/routes.js';
import aiRoutes from './modules/ai/routes.js';
import dashboardRoutes from './modules/dashboards/routes.js';
import dynamicUiRoutes from './modules/learning/routes.js';
import tracsRoutes from './modules/tracs/routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false, // the SPA loads Monaco workers from same-origin bundles
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const allowedOrigins = config.corsOrigins;
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin / server-to-server requests and proxied preview hosts.
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        if (allowedOrigins.includes('*')) return cb(null, true);
        // Preview + local dev hosts (any *.e2b.app / localhost port).
        if (/^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.e2b\.app$/i.test(origin)) return cb(null, true);
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'learnmate-ai',
      version: '1.0.0',
      env: config.env,
      db: dbInfo(),
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRoutes);

  // Everything else requires a valid session.
  app.use('/api', authenticate);
  app.use('/api/classrooms', classroomRoutes);
  app.use('/api/syllabus', syllabusRoutes);
  app.use('/api/tutor', tutorRoutes);
  app.use('/api/learning', assessmentRoutes);
  // Dynamic UI engine: AI-authored lessons, question forms, quiz grading,
  // sandboxed code execution and learning progress.
  app.use('/api', dynamicUiRoutes);
  // tracs: a syllabus becomes a chat with exactly two commands, /test and /learn.
  app.use('/api', tracsRoutes);
  app.use('/api/practice', practiceRoutes);
  app.use('/api/intelligence', intelligenceRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/ai', aiRoutes);

  // Serve the built SPA when present (single-service deployment).
  const webDist = path.join(config.root, 'web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details || undefined },
      });
    }
    if (err?.name === 'MulterError') {
      return res.status(400).json({
        error: { code: 'UPLOAD_ERROR', message: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 15 MB limit' : err.message },
      });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large' } });
    }
    console.error('[error]', req.method, req.originalUrl, err);
    const message = config.env === 'production' ? 'Something went wrong on our side' : err.message;
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
  });

  return app;
}
