const helmet = require('helmet');
const connectPgSimple = require('connect-pg-simple');

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function applySecurityMiddleware(app) {
  if (isProduction()) {
    app.set('trust proxy', 1);
  }

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
}

function createSessionMiddleware(session) {
  const pgSession = connectPgSimple(session);


  const port = process.env.PORT || '3000';
  const cookieName = port === '3000' ? 'connect.sid' : `connect.sid.${port}`;

  return session({
    name: cookieName,
    store: new pgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction(),
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
}

module.exports = {
  applySecurityMiddleware,
  createSessionMiddleware,
  isProduction,
};