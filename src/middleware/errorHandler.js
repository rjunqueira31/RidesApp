const logger = require('../logger');
const {requestLogContext} = require('./requestLogging');

function createErrorHandler({isProduction}) {
  return (error, request, response, _next) => {
    const status = error.status || 500;

    logger[status >= 500 ? 'error' : 'warn']('http.request.failed', {
      ...requestLogContext(request),
      status,
      error: logger.serializeError(error),
    });

    const errorMessage = status >= 500 && isProduction ?
        'Unexpected server error.' :
        error.message || 'Unexpected server error.';

    response.status(status).json({
      error: errorMessage,
    });
  };
}

module.exports = {
  createErrorHandler,
};