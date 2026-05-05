require('dotenv').config();

const express = require('express');
const http = require('http');
const session = require('express-session');
const {Server: SocketServer} = require('socket.io');
const path = require('path');
const {
  applySecurityMiddleware,
  createSessionMiddleware,
  isProduction,
} = require('./config/security');
const logger = require('./logger');
const {createErrorHandler} = require('./middleware/errorHandler');
const {requestLoggingMiddleware} = require('./middleware/requestLogging');
const {getProfileById} = require('./store');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profiles');
const {rideRoutes, requestRoutes} = require('./routes/rides');
const dmRoutes = require('./routes/dm');

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

applySecurityMiddleware(app);

const sessionMiddleware = createSessionMiddleware(session);
app.use(sessionMiddleware);
app.use(express.json());
app.use(requestLoggingMiddleware);

// --- Auth middleware ---

async function requireAuth(request, response, next) {
  try {
    if (!request.session.userId) {
      response.status(401).json({error: 'Authentication required.'});
      return;
    }

    const profile = await getProfileById(request.session.userId);

    if (!profile) {
      request.session.destroy(() => undefined);
      response.status(401).json({error: 'Authentication required.'});
      return;
    }

    request.currentUser = profile;
    next();
  } catch (error) {
    next(error);
  }
}

// --- Static files ---

app.use(express.static(PUBLIC_DIR));

// --- Public routes ---

app.get('/api/health', (_request, response) => {
  response.json({ok: true});
});

app.get('/api/client-config', (_request, response) => {
  response.json({
    mapboxPublicToken: String(process.env.MAPBOX_PUBLIC_TOKEN || '').trim(),
  });
});

// --- Auth routes ---

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({profile: req.currentUser});
});
app.use('/api/auth', authRoutes);

// --- Protected routes ---

app.use('/api/profiles', requireAuth, profileRoutes);
app.use('/api/rides', requireAuth, rideRoutes);
app.use('/api/requests', requireAuth, requestRoutes);
app.use('/api/dm', requireAuth, dmRoutes);

// --- Error handler ---

app.use(createErrorHandler({isProduction: isProduction()}));

// --- Socket.io setup ---

io.engine.use(sessionMiddleware);

io.use((socket, next) => {
  const userId = socket.request.session?.userId;
  if (!userId) {
    next(new Error('Authentication required.'));
    return;
  }
  socket.userId = userId;
  next();
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.userId}`);
  logger.info('socket.connected', {userId: socket.userId});

  socket.on('disconnect', () => {
    logger.info('socket.disconnected', {userId: socket.userId});
  });
});

app.set('io', io);

server.listen(PORT, () => {
  logger.info('app.started', {
    port: Number(PORT),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: logger.activeLevel,
  });
});
