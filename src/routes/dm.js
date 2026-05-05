const express = require('express');

const logger = require('../logger');
const {requestLogContext} = require('../middleware/requestLogging');
const {
  createDirectMessage,
  getConversations,
  getConversationMessages,
  getUnreadCount,
  markConversationRead,
} = require('../store');

const router = express.Router();

function assertRequired(value, label) {
  if (!String(value || '').trim()) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
}

router.get('/conversations', async (request, response, next) => {
  try {
    const conversations = await getConversations(request.currentUser.id);
    response.json({conversations});
  } catch (error) {
    next(error);
  }
});

router.get('/unread-count', async (request, response, next) => {
  try {
    const count = await getUnreadCount(request.currentUser.id);
    response.json({count});
  } catch (error) {
    next(error);
  }
});

router.get('/conversations/:userId', async (request, response, next) => {
  try {
    const messages = await getConversationMessages(
        request.currentUser.id,
        request.params.userId,
        {
          limit: Number(request.query.limit) || 50,
          before: request.query.before,
        },
    );
    response.json({messages});
  } catch (error) {
    next(error);
  }
});

router.post('/conversations/:userId', async (request, response, next) => {
  try {
    const {text} = request.body;
    assertRequired(text, 'Message');

    const dm = await createDirectMessage({
      senderId: request.currentUser.id,
      receiverId: request.params.userId,
      text,
    });

    // Emit via Socket.io for real-time delivery
    const io = request.app.get('io');
    io.to(`user:${request.params.userId}`).emit('dm:new', dm);
    io.to(`user:${request.currentUser.id}`).emit('dm:new', dm);

    logger.info('dm.created', {
      ...requestLogContext(request),
      senderId: request.currentUser.id,
      receiverId: request.params.userId,
      messageId: dm.id,
    });
    response.status(201).json({message: dm});
  } catch (error) {
    next(error);
  }
});

router.post('/conversations/:userId/read', async (request, response, next) => {
  try {
    await markConversationRead(request.currentUser.id, request.params.userId);

    // Notify sender's other tabs that messages were read
    const io = request.app.get('io');
    io.to(`user:${request.currentUser.id}`).emit('dm:read', {
      otherUserId: request.params.userId,
    });

    response.json({ok: true});
  } catch (error) {
    next(error);
  }
});

module.exports = router;
