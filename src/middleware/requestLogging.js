const {randomUUID} = require('crypto');
const logger = require('../logger');

function requestLogContext(request) {
  return {
    requestId: request.requestId,
    method: request.method,
    path: request.path,
    userId: request.currentUser?.id || request.session?.userId || null,
    userRole: request.currentUser?.role || request.session?.userRole || null,
    ip: request.ip,
  };
}

function requestLoggingMiddleware(request, response, next) {
  request.requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = response.statusCode >= 500 ? 'error' :
        response.statusCode >= 400           ? 'warn' :
                                               'info';

    logger[level]('http.request.completed', {
      requestId: request.requestId,
      method: request.method,
      path: request.originalUrl,
      statusCode: response.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
      userId: request.currentUser?.id || request.session?.userId || null,
      userRole: request.currentUser?.role || request.session?.userRole || null,
      ip: request.ip,
    });
  });

  next();
}

module.exports = {
  requestLogContext,
  requestLoggingMiddleware,
};